// BackupOperationsOptimized - Optimized backup with per-file progress
// Eliminates slow "Analyzing server files" phase by using server-side metadata
// All dedup checks happen instantly using pre-fetched hash sets

import { Platform, AppState, InteractionManager } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import axios from 'axios';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { sha256 } from 'js-sha256';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { t } from './i18n';
import {
  sleep,
  withRetries,
  shouldRetryChunkUpload,
  makeChunkNonce,
  normalizeFilenameForCompare,
  computeFileIdentity,
} from './utils';

import {
  MB,
  resolveReadableFilePath,
  getStealthCloudMasterKey,
  chooseStealthCloudChunkBytes,
  chooseStealthCloudMaxParallelChunkUploads,
  createConcurrencyLimiter,
  trackInFlightPromise,
  drainInFlightPromises,
} from './backgroundTask';

import {
  getMediaLibraryAccessPrivileges,
  findFirstAlbumByTitle,
} from './autoUpload';

import {
  stealthCloudUploadEncryptedChunk,
  PHOTO_ALBUM_NAME,
  LEGACY_PHOTO_ALBUM_NAME,
} from './backupManager';

import {
  computeExactFileHash,
  computePerceptualHash,
  findPerceptualHashMatch,
  extractBaseFilename,
  normalizeDateForCompare,
  normalizeFullTimestamp,
  extractExifForDedup,
  CROSS_PLATFORM_DHASH_THRESHOLD,
} from './duplicateScanner';

import { extractFullExif } from './exifExtractor';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const YIELD_INTERVAL_MS = 0; // Immediate yield
const PROGRESS_THROTTLE_MS = 200; // Slower updates to reduce UI load
const PAGE_SIZE = 250; // Assets per page when scanning

// Throttle settings
const getThrottleAssetCooldownMs = (fastMode) => fastMode ? 0 : (Platform.OS === 'ios' ? 2000 : 1500);
const getThrottleBatchLimit = (fastMode) => fastMode ? 999999 : 10;
const getThrottleBatchCooldownMs = (fastMode) => fastMode ? 0 : 30000;
const getThrottleChunkCooldownMs = (fastMode) => fastMode ? 0 : 300;

// ============================================================================
// ASSET COLLECTION (All Albums + iCloud/Google Cloud Download)
// ============================================================================

/**
 * Collect all assets from device including all albums (Screenshots, Downloads, WhatsApp, etc.)
 * Also triggers iCloud/Google Cloud download for cloud-only items before dedup
 */
const collectAllAssetsWithCloudDownload = async ({
  onStatus,
  onProgress,
  progressStart = 0.02,
  progressEnd = 0.08,
  abortRef,
}) => {
  const mediaTypes = Platform.OS === 'ios'
    ? [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video]
    : ['photo', 'video'];
  
  const allAssets = [];
  const seenIds = new Set();
  let after = null;
  
  // Get total count first
  let totalCount = 0;
  try {
    const countPage = await MediaLibrary.getAssetsAsync({ first: 1, mediaType: mediaTypes });
    totalCount = countPage?.totalCount || 0;
  } catch (e) {
    totalCount = 1000;
  }

  updateStatus(onStatus, t('status.scanningPhotos', { current: 0, total: totalCount }), true);
  // Don't update progress during scanning - keep progress bar hidden

  // Phase 1: Collect from main library (paged)
  while (true) {
    if (abortRef?.current) return { assets: allAssets, aborted: true };

    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      after: after || undefined,
      mediaType: mediaTypes,
      sortBy: Platform.OS === 'ios' ? [MediaLibrary.SortBy.creationTime] : undefined,
    });

    const assets = page?.assets || [];
    for (const asset of assets) {
      if (!seenIds.has(asset.id)) {
        seenIds.add(asset.id);
        allAssets.push(asset);
      }
    }

    // Don't update progress during scanning - keep progress bar hidden
    updateStatus(onStatus, t('status.scanningPhotos', { current: allAssets.length, total: totalCount }));

    after = page?.endCursor;
    if (!page?.hasNextPage) break;
    if (assets.length === 0) break;
    await yieldToUi();
  }

  // Phase 2: Scan all albums to catch Screenshots, Downloads, WhatsApp, user folders, etc.
  try {
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    updateStatus(onStatus, t('status.scanningAlbums', { count: albums.length }));
    
    for (let i = 0; i < albums.length; i++) {
      if (abortRef?.current) return { assets: allAssets, aborted: true };

      const album = albums[i];
      try {
        let albumAfter = null;
        while (true) {
          const albumPage = await MediaLibrary.getAssetsAsync({
            first: PAGE_SIZE,
            after: albumAfter || undefined,
            album: album.id,
            mediaType: mediaTypes,
          });
          
          const albumAssets = albumPage?.assets || [];
          for (const asset of albumAssets) {
            if (!seenIds.has(asset.id)) {
              seenIds.add(asset.id);
              allAssets.push(asset);
            }
          }
          
          albumAfter = albumPage?.endCursor;
          if (!albumPage?.hasNextPage || albumAssets.length === 0) break;
        }
      } catch (e) {
        // Skip failed albums
      }

      if (i % 5 === 0) {
        await yieldToUi();
        // Don't update progress during scanning - keep progress bar hidden
        updateStatus(onStatus, t('status.scanningAlbumsFound', { count: allAssets.length }));
      }
    }
  } catch (e) {
    console.log('[Backup] Album scan error:', e?.message);
  }

  // Phase 3: Trigger iCloud/Google Cloud download for cloud-only items (iOS mainly)
  if (Platform.OS === 'ios') {
    updateStatus(onStatus, t('status.checkingCloudAvailability', { count: allAssets.length }));
    let cloudDownloadCount = 0;
    const total = allAssets.length;
    
    for (let i = 0; i < allAssets.length; i++) {
      if (abortRef?.current) return { assets: allAssets, aborted: true };
      
      try {
        const asset = allAssets[i];
        const info = await MediaLibrary.getAssetInfoAsync(asset.id);
        
        if (!info?.localUri && info?.uri) {
          cloudDownloadCount++;
        }
      } catch (e) {
        // Skip items that fail
      }
      
      // Update progress every 5 items for better feedback
      if (i % 5 === 0 || i === total - 1) {
        await yieldToUi();
        const current = i + 1;
        if (cloudDownloadCount > 0) {
          updateStatus(onStatus, t('status.downloadingFromICloud', { current, total, count: cloudDownloadCount }));
        } else {
          updateStatus(onStatus, t('status.preparingPhotos', { current, total }));
        }
        // Update progress bar during iCloud phase (0-5%)
        const icloudProgress = (current / total) * 0.05;
        updateProgress(onProgress, progressStart + icloudProgress);
      }
    }
    
    if (cloudDownloadCount > 0) {
      console.log(`[Backup] Triggered iCloud download for ${cloudDownloadCount} items`);
    }
  }

  // Don't update progress here - keep progress bar hidden until actual backup starts
  return { assets: allAssets, aborted: false };
};

// ============================================================================
// PROGRESS TRACKING (Module-level, reset per operation)
// ============================================================================

let lastProgressValue = 0;
let lastProgressTime = 0;
let lastStatusTime = 0;

const resetProgress = () => {
  lastProgressValue = 0;
  lastProgressTime = 0;
  lastStatusTime = 0;
};

const updateProgress = (onProgress, value, force = false) => {
  if (value < lastProgressValue) return; // Never go backwards
  const now = Date.now();
  if (force || (now - lastProgressTime) >= PROGRESS_THROTTLE_MS) {
    lastProgressTime = now;
    lastProgressValue = value;
    onProgress(value);
  }
};

const updateStatus = (onStatus, text, force = false) => {
  const now = Date.now();
  if (force || (now - lastStatusTime) >= PROGRESS_THROTTLE_MS) {
    lastStatusTime = now;
    onStatus(text);
  }
};

// Yield to UI - use InteractionManager + setImmediate for best React Native responsiveness
const yieldToUi = () => new Promise(resolve => {
  // Use InteractionManager to wait for animations/interactions to complete
  InteractionManager.runAfterInteractions(() => {
    // Then use setImmediate to yield to the event loop
    if (typeof setImmediate !== 'undefined') {
      setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
});

// Longer yield for navigation - waits for animations
const yieldForNavigation = () => new Promise(resolve => {
  InteractionManager.runAfterInteractions(() => {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
});

// Quick yield for inside tight loops - still use requestAnimationFrame
const quickYield = () => new Promise(r => {
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => r());
  } else {
    setTimeout(r, 0);
  }
});

// ============================================================================
// SERVER COMMUNICATION
// ============================================================================

/**
 * Fetch all manifests with metadata for fast dedup (no decryption needed)
 * Uses ?meta=true to get filename, size, hashes in single request
 */
const fetchManifestsWithMeta = async (serverUrl, config, onProgress) => {
  const PAGE_LIMIT = 500;
  const allManifests = [];
  let offset = 0;
  let total = null;

  while (true) {
    const response = await axios.get(`${serverUrl}/api/cloud/manifests`, {
      ...config,
      params: { offset, limit: PAGE_LIMIT, meta: 'true' }
    });

    const manifests = response.data?.manifests || [];
    allManifests.push(...manifests);
    
    if (total === null && typeof response.data?.total === 'number') {
      total = response.data.total;
    }
    
    if (onProgress) {
      onProgress(allManifests.length, total || allManifests.length);
    }

    if (manifests.length < PAGE_LIMIT) break;
    offset += manifests.length;
    if (total && offset >= total) break;
  }

  return allManifests;
};

/**
 * Build dedup sets from manifest metadata (instant, no HTTP per file)
 */
const buildDedupSetsFromMeta = (manifests) => {
  const manifestIds = new Set();
  const filenames = new Set();
  const fileHashes = new Set();
  const perceptualHashes = new Set();
  const baseNameSizes = new Map();
  const baseNameDates = new Map();
  const baseNameTimestamps = new Map();

  for (const m of manifests) {
    if (m.manifestId) manifestIds.add(m.manifestId);
    
    if (m.filename) {
      const normalized = normalizeFilenameForCompare(m.filename);
      if (normalized) filenames.add(normalized);
      
      const baseName = extractBaseFilename(m.filename);
      if (baseName) {
        if (m.originalSize) {
          if (!baseNameSizes.has(baseName)) baseNameSizes.set(baseName, new Set());
          baseNameSizes.get(baseName).add(m.originalSize);
        }
        if (m.creationTime) {
          const dateStr = normalizeDateForCompare(m.creationTime);
          if (dateStr) {
            if (!baseNameDates.has(baseName)) baseNameDates.set(baseName, new Set());
            baseNameDates.get(baseName).add(dateStr);
          }
          const fullTs = normalizeFullTimestamp(m.creationTime);
          if (fullTs) {
            if (!baseNameTimestamps.has(baseName)) baseNameTimestamps.set(baseName, new Set());
            baseNameTimestamps.get(baseName).add(fullTs);
          }
        }
      }
    }
    
    if (m.fileHash) fileHashes.add(m.fileHash);
    if (m.perceptualHash) perceptualHashes.add(m.perceptualHash);
  }

  return {
    manifestIds,
    filenames,
    fileHashes,
    perceptualHashes,
    baseNameSizes,
    baseNameDates,
    baseNameTimestamps,
  };
};

// ============================================================================
// DEDUPLICATION CHECKS
// ============================================================================

/**
 * Quick dedup check using pre-built sets (no network, instant)
 */
const checkDedupQuick = (manifestId, filename, originalSize, creationTime, dedupSets) => {
  const { manifestIds, filenames, baseNameSizes, baseNameDates, baseNameTimestamps } = dedupSets;

  // Check 1: ManifestId (most reliable - hash of filename+size)
  if (manifestIds.has(manifestId)) {
    return { skip: true, reason: 'manifestId' };
  }

  // Check 2: Exact filename
  const normalizedFilename = filename ? normalizeFilenameForCompare(filename) : null;
  if (normalizedFilename && filenames.has(normalizedFilename)) {
    return { skip: true, reason: 'filename' };
  }

  const baseName = filename ? extractBaseFilename(filename) : null;
  if (!baseName) return { skip: false };

  // Check 3: Full timestamp match (HEIC priority)
  const fullTs = creationTime ? normalizeFullTimestamp(creationTime) : null;
  if (fullTs && baseNameTimestamps.has(baseName)) {
    if (baseNameTimestamps.get(baseName).has(fullTs)) {
      return { skip: true, reason: 'timestamp' };
    }
  }

  // Check 4: Base filename + size (within 20% tolerance)
  if (originalSize && baseNameSizes.has(baseName)) {
    for (const existingSize of baseNameSizes.get(baseName)) {
      const diff = Math.abs(originalSize - existingSize) / Math.max(originalSize, existingSize);
      if (diff < 0.20) {
        return { skip: true, reason: 'size' };
      }
    }
  }

  // Check 5: Base filename + date
  const dateStr = creationTime ? normalizeDateForCompare(creationTime) : null;
  if (dateStr && baseNameDates.has(baseName)) {
    if (baseNameDates.get(baseName).has(dateStr)) {
      return { skip: true, reason: 'date' };
    }
  }

  return { skip: false };
};

/**
 * Hash-based dedup check (requires computing hashes first)
 */
const checkDedupByHash = (fileHash, perceptualHash, dedupSets, sessionHashes) => {
  const { fileHashes, perceptualHashes } = dedupSets;
  const { sessionFileHashes, sessionPerceptualHashes } = sessionHashes;

  // Check server hashes
  if (fileHash && fileHashes.has(fileHash)) {
    return { skip: true, reason: 'fileHash' };
  }
  if (perceptualHash && findPerceptualHashMatch(perceptualHash, perceptualHashes, CROSS_PLATFORM_DHASH_THRESHOLD)) {
    return { skip: true, reason: 'perceptualHash' };
  }

  // Check session hashes (within current backup batch)
  if (fileHash && sessionFileHashes.has(fileHash)) {
    return { skip: true, reason: 'sessionFileHash' };
  }
  if (perceptualHash && findPerceptualHashMatch(perceptualHash, sessionPerceptualHashes, CROSS_PLATFORM_DHASH_THRESHOLD)) {
    return { skip: true, reason: 'sessionPerceptualHash' };
  }

  return { skip: false };
};

// ============================================================================
// FILE PROCESSING
// ============================================================================

/**
 * Get file info and path for an asset
 */
const getAssetFileInfo = async (asset) => {
  const assetInfo = await withRetries(async () => {
    // shouldDownloadFromNetwork: true ensures iCloud photos are fully downloaded before hashing
    // This is critical for cross-device deduplication - without it, iOS may hash a low-res placeholder
    return await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: true });
  }, { retries: 5, baseDelayMs: 1000, maxDelayMs: 15000, shouldRetry: () => true });

  const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo });
  const { filePath, tmpCopied, tmpUri } = resolved;

  // Get file size
  let originalSize = assetInfo?.fileSize ? Number(assetInfo.fileSize) : null;
  
  if (!originalSize) {
    if (Platform.OS === 'ios') {
      const fileUri = filePath.startsWith('/') ? `file://${filePath}` : (filePath || tmpUri);
      try {
        const info = await FileSystem.getInfoAsync(fileUri);
        originalSize = info?.size ? Number(info.size) : null;
      } catch (e) {}
    } else {
      let ReactNativeBlobUtil = null;
      try {
        const mod = require('react-native-blob-util');
        ReactNativeBlobUtil = mod?.default || mod;
      } catch (e) {}
      if (ReactNativeBlobUtil?.fs?.stat) {
        try {
          const stat = await ReactNativeBlobUtil.fs.stat(filePath);
          originalSize = stat?.size ? Number(stat.size) : null;
        } catch (e) {}
      }
    }
  }

  const filename = assetInfo?.filename || asset.filename || null;
  const fileIdentity = computeFileIdentity(filename, originalSize);
  const manifestId = fileIdentity ? sha256(`file:${fileIdentity}`) : sha256(`asset:${asset.id}`);
  const isImage = asset.mediaType === 'photo' || assetInfo?.mediaType === 'photo';

  return {
    assetInfo,
    filePath,
    tmpCopied,
    tmpUri,
    originalSize,
    filename,
    manifestId,
    isImage,
    creationTime: asset.creationTime,
  };
};

/**
 * Compute hashes for an asset
 */
const computeHashes = async (filePath, asset, assetInfo, isImage) => {
  let fileHash = null;
  let perceptualHash = null;

  if (isImage) {
    // Yield before each heavy operation
    await quickYield();
    try {
      perceptualHash = await computePerceptualHash(filePath, asset, assetInfo);
    } catch (e) {
      console.warn('computePerceptualHash failed:', asset.id, e?.message);
    }
    // Yield between operations
    await quickYield();
    try {
      fileHash = await computeExactFileHash(filePath);
    } catch (e) {
      console.warn('computeExactFileHash failed:', asset.id, e?.message);
    }
  } else {
    // Video - use file hash only
    await quickYield();
    try {
      fileHash = await computeExactFileHash(filePath);
    } catch (e) {
      console.warn('computeExactFileHash failed:', asset.id, e?.message);
    }
  }

  return { fileHash, perceptualHash };
};

/**
 * Encrypt and upload a single file
 */
const encryptAndUpload = async ({
  asset, assetInfo, filePath, tmpCopied, tmpUri, originalSize, filename, manifestId,
  fileHash, perceptualHash, masterKey, config, SERVER_URL, fastMode
}) => {
  // Generate per-file key and nonces
  const fileKey = new Uint8Array(32);
  global.crypto.getRandomValues(fileKey);
  const baseNonce16 = new Uint8Array(16);
  global.crypto.getRandomValues(baseNonce16);
  const wrapNonce = new Uint8Array(24);
  global.crypto.getRandomValues(wrapNonce);
  const wrappedKey = nacl.secretbox(fileKey, wrapNonce, masterKey);

  const chunkIds = [];
  const chunkSizes = [];
  const chunkUploadsInFlight = new Set();
  let chunkIndex = 0;

  const throttleChunk = async (idx) => {
    const cooldown = getThrottleChunkCooldownMs(fastMode);
    if (cooldown > 0 && idx > 0) await sleep(cooldown);
  };

  if (Platform.OS === 'ios') {
    const fileUri = filePath.startsWith('/') ? `file://${filePath}` : (filePath || tmpUri);
    const maxParallel = Math.max(1, chooseStealthCloudMaxParallelChunkUploads({ platform: 'ios', originalSize, fastMode }));
    const runChunkUpload = createConcurrencyLimiter(maxParallel);
    const chunkPlainBytes = chooseStealthCloudChunkBytes({ platform: 'ios', originalSize, fastMode });
    const effectiveBytes = chunkPlainBytes - (chunkPlainBytes % 3);

    let position = 0;
    while (true) {
      // Yield before file read
      await quickYield();
      
      let nextB64 = '';
      try {
        nextB64 = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.Base64,
          position,
          length: effectiveBytes
        });
      } catch (e) {
        const allB64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
        const b64Offset = Math.floor((position / 3) * 4);
        const chunkB64Len = (effectiveBytes / 3) * 4;
        nextB64 = allB64.slice(b64Offset, b64Offset + chunkB64Len);
      }
      if (!nextB64) break;
      
      // Yield after file read, before base64 decode
      await quickYield();
      
      const plaintext = naclUtil.decodeBase64(nextB64);
      if (!plaintext || plaintext.length === 0) break;

      const nonce = makeChunkNonce(baseNonce16, chunkIndex);
      await throttleChunk(chunkIndex);
      
      // Yield before encryption (CPU intensive)
      await quickYield();
      
      const boxed = nacl.secretbox(plaintext, nonce, fileKey);
      
      // Yield after encryption, before hash
      await quickYield();
      
      const chunkId = sha256.create().update(boxed).hex();
      
      // Yield after hash, before upload
      await quickYield();
      
      await trackInFlightPromise(
        chunkUploadsInFlight,
        runChunkUpload(() => stealthCloudUploadEncryptedChunk({ SERVER_URL, config, chunkId, encryptedBytes: boxed })),
        maxParallel
      );
      
      chunkIds.push(chunkId);
      chunkSizes.push(plaintext.length);
      chunkIndex++;
      position += plaintext.length;

      if (plaintext.length < effectiveBytes) break;
    }
  } else {
    // Android: use react-native-blob-util
    let ReactNativeBlobUtil = null;
    try {
      const mod = require('react-native-blob-util');
      ReactNativeBlobUtil = mod?.default || mod;
    } catch (e) {}
    
    if (!ReactNativeBlobUtil?.fs?.readStream) {
      throw new Error('StealthCloud backup requires a development build (react-native-blob-util).');
    }

    const stat = await ReactNativeBlobUtil.fs.stat(filePath);
    const fileSize = stat?.size ? Number(stat.size) : originalSize;

    const maxParallel = Math.max(1, chooseStealthCloudMaxParallelChunkUploads({ platform: 'android', originalSize: fileSize, fastMode }));
    const runChunkUpload = createConcurrencyLimiter(maxParallel);
    const chunkPlainBytes = chooseStealthCloudChunkBytes({ platform: 'android', originalSize: fileSize, fastMode });
    const stream = await ReactNativeBlobUtil.fs.readStream(filePath, 'base64', chunkPlainBytes);

    await new Promise((resolve, reject) => {
      const queue = [];
      let draining = false;
      let ended = false;

      stream.open();

      stream.onData((chunkB64) => {
        queue.push(chunkB64);
        if (draining) return;
        draining = true;

        (async () => {
          try {
            while (queue.length) {
              // Yield before processing
              await quickYield();
              
              const nextB64 = queue.shift();
              
              // Yield after queue access, before decode
              await quickYield();
              
              const plaintext = naclUtil.decodeBase64(nextB64);
              const nonce = makeChunkNonce(baseNonce16, chunkIndex);
              await throttleChunk(chunkIndex);
              
              // Yield before encryption (CPU intensive)
              await quickYield();
              
              const boxed = nacl.secretbox(plaintext, nonce, fileKey);
              
              // Yield after encryption, before hash
              await quickYield();
              
              const chunkId = sha256.create().update(boxed).hex();
              
              // Yield after hash, before upload
              await quickYield();
              
              await trackInFlightPromise(
                chunkUploadsInFlight,
                runChunkUpload(() => stealthCloudUploadEncryptedChunk({ SERVER_URL, config, chunkId, encryptedBytes: boxed })),
                maxParallel
              );
              
              chunkIds.push(chunkId);
              chunkSizes.push(plaintext.length);
              chunkIndex++;
            }
          } catch (e) {
            reject(e);
            return;
          } finally {
            draining = false;
          }
          if (ended && queue.length === 0) resolve();
        })();
      });

      stream.onError((e) => reject(e));
      stream.onEnd(() => {
        ended = true;
        if (!draining && queue.length === 0) resolve();
      });
    });
  }

  await drainInFlightPromises(chunkUploadsInFlight);

  if (!chunkIds.length) {
    throw new Error('StealthCloud backup read 0 bytes (no chunks).');
  }

  // Generate and upload a small encrypted thumbnail for Sync Select previews (best-effort)
  // Thumbnail is encrypted with masterKey so it can be fetched without downloading the full file.
  let thumbChunkId = null;
  let thumbNonceB64 = null;
  let thumbSize = null;
  let thumbW = null;
  let thumbH = null;
  const thumbMime = 'image/jpeg';
  try {
    const THUMB_WIDTH = 220;
    const THUMB_COMPRESS = 0.6;
    const isVideo = (asset && asset.mediaType === 'video') || /\.(mp4|mov|avi|mkv|m4v|3gp|webm)$/i.test(filename || '');
    const isPhoto = !isVideo;
    let thumbSourceUri = null;
    let tempVideoFrameUri = null;

    if (isVideo) {
      const fileUri = filePath && filePath.startsWith('/') ? `file://${filePath}` : (filePath || tmpUri);
      if (fileUri) {
        for (const time of [0, 500, 1000, 2000]) {
          try {
            const frame = await VideoThumbnails.getThumbnailAsync(fileUri, { time });
            if (frame?.uri) {
              thumbSourceUri = frame.uri;
              tempVideoFrameUri = frame.uri;
              break;
            }
          } catch (e) {
            // Try another timestamp
          }
        }
      }
    } else if (isPhoto) {
      thumbSourceUri = (filePath && filePath.startsWith('/')) ? `file://${filePath}` : (filePath || tmpUri);
    }

    if (thumbSourceUri) {
      const manip = await ImageManipulator.manipulateAsync(
        thumbSourceUri,
        [{ resize: { width: THUMB_WIDTH } }],
        { compress: THUMB_COMPRESS, format: ImageManipulator.SaveFormat.JPEG }
      );
      if (manip?.uri) {
        thumbW = typeof manip.width === 'number' ? manip.width : null;
        thumbH = typeof manip.height === 'number' ? manip.height : null;

        const b64 = await FileSystem.readAsStringAsync(manip.uri, { encoding: FileSystem.EncodingType.Base64 });
        const plain = naclUtil.decodeBase64(b64);
        thumbSize = plain?.length || null;
        if (plain && plain.length > 0) {
          const thumbNonce = new Uint8Array(24);
          global.crypto.getRandomValues(thumbNonce);
          const boxed = nacl.secretbox(plain, thumbNonce, masterKey);
          thumbChunkId = sha256.create().update(boxed).hex();
          thumbNonceB64 = naclUtil.encodeBase64(thumbNonce);
          await stealthCloudUploadEncryptedChunk({ SERVER_URL, config, chunkId: thumbChunkId, encryptedBytes: boxed });
        }

        try { await FileSystem.deleteAsync(manip.uri, { idempotent: true }); } catch (e) {}
      }
    }

    if (tempVideoFrameUri) {
      try { await FileSystem.deleteAsync(tempVideoFrameUri, { idempotent: true }); } catch (e) {}
    }
  } catch (e) {
    // Best-effort: thumbnail failures must not fail backup
  }

  // Build and encrypt manifest
  const exifData = extractExifForDedup(assetInfo, asset);
  const manifest = {
    v: 1,
    assetId: asset.id,
    filename,
    mediaType: asset.mediaType || null,
    originalSize,
    creationTime: asset.creationTime || null,
    exifCaptureTime: exifData.captureTime || null,
    exifMake: exifData.make || null,
    exifModel: exifData.model || null,
    baseNonce16: naclUtil.encodeBase64(baseNonce16),
    wrapNonce: naclUtil.encodeBase64(wrapNonce),
    wrappedFileKey: naclUtil.encodeBase64(wrappedKey),
    chunkIds,
    chunkSizes,
    fileHash,
    perceptualHash,
  };

  const manifestPlain = naclUtil.decodeUTF8(JSON.stringify(manifest));
  const manifestNonce = new Uint8Array(24);
  global.crypto.getRandomValues(manifestNonce);
  const manifestBox = nacl.secretbox(manifestPlain, manifestNonce, masterKey);
  const encryptedManifest = JSON.stringify({
    manifestNonce: naclUtil.encodeBase64(manifestNonce),
    manifestBox: naclUtil.encodeBase64(manifestBox)
  });

  // Upload manifest with metadata for future fast dedup
  const manifestResponse = await withRetries(async () => {
    return await axios.post(
      `${SERVER_URL}/api/cloud/manifests`,
      { 
        manifestId, 
        encryptedManifest, 
        chunkCount: chunkIds.length,
        // Include metadata for fast dedup on future backups
        filename,
        mediaType: asset?.mediaType || null,
        originalSize,
        fileHash,
        perceptualHash,
        creationTime: asset.creationTime,
        // EXIF metadata for cross-platform HEIC deduplication
        exifCaptureTime: exifData?.captureTime || null,
        exifMake: exifData?.make || null,
        exifModel: exifData?.model || null,
        thumbChunkId,
        thumbNonce: thumbNonceB64,
        thumbSize,
        thumbW,
        thumbH,
        thumbMime,
      },
      { headers: config.headers, timeout: 30000 }
    );
  }, { retries: 20, baseDelayMs: 2000, maxDelayMs: 30000, shouldRetry: shouldRetryChunkUpload });

  // Store full EXIF to server for universal cross-platform preservation
  // This runs in parallel with cleanup - non-blocking, fire-and-forget
  if (fileHash && !manifestResponse?.data?.skipped) {
    const isImage = asset.mediaType === 'photo' || /\.(jpg|jpeg|png|heic|heif|gif|bmp|webp|tiff?)$/i.test(filename || '');
    if (isImage) {
      try {
        const fullExif = extractFullExif(assetInfo, asset);
        // Only store if we have meaningful EXIF data
        if (fullExif.captureTime || fullExif.make || fullExif.gpsLatitude != null) {
          axios.post(
            `${SERVER_URL}/api/exif/store`,
            { fileHash, exif: fullExif, platform: Platform.OS },
            { headers: config.headers, timeout: 10000 }
          ).catch(e => console.log('[EXIF] Store failed (non-critical):', e?.message));
        }
      } catch (e) {
        // Non-critical - don't fail upload if EXIF storage fails
        console.log('[EXIF] Extract failed (non-critical):', e?.message);
      }
    }
  }

  // Cleanup temp file
  if (tmpCopied && tmpUri) {
    await FileSystem.deleteAsync(tmpUri, { idempotent: true });
  }

  return {
    success: !manifestResponse?.data?.skipped,
    skippedByServer: manifestResponse?.data?.skipped || false,
  };
};

// ============================================================================
// MAIN BACKUP FUNCTION
// ============================================================================

/**
 * Optimized StealthCloud backup - processes files one by one with accurate progress
 * 
 * Flow:
 * 1. Scan local photos (fast, with progress)
 * 2. Fetch server manifest list with metadata (single request per page)
 * 3. Build dedup sets from metadata (instant, no decryption)
 * 4. For each local file:
 *    - Quick dedup check (instant)
 *    - If not duplicate: compute hashes, check hash dedup, encrypt, upload
 *    - Update progress after each file
 */
export const stealthCloudBackupCore = async ({
  getAuthHeaders,
  getServerUrl,
  ensureStealthCloudUploadAllowed,
  ensureAutoUploadPolicyAllowsWorkIfBackgrounded,
  appStateRef,
  fastMode,
  onStatus,
  onProgress,
  abortRef,
}) => {
  resetProgress();
  
  // ========== PHASE 1: Permissions (instant) ==========
  onStatus(t('status.requestingPhotosPermission'));
  onProgress(0);
  
  const permission = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
  if (!permission || permission.status !== 'granted') {
    return { uploaded: 0, skipped: 0, failed: 0, permissionDenied: true };
  }

  // Wait for iOS to return from permission dialog
  if (Platform.OS === 'ios' && appStateRef?.current !== 'active') {
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 10000);
      const sub = AppState.addEventListener('change', (st) => {
        if (st === 'active') {
          clearTimeout(timeout);
          sub?.remove?.();
          resolve();
        }
      });
    });
  }

  if (Platform.OS === 'ios') {
    const ap = await getMediaLibraryAccessPrivileges(permission);
    if (ap && ap !== 'all') {
      onStatus(t('status.limitedPhotosAccess'));
      await yieldToUi();
    }
  }

  // ========== PHASE 2: Auth & Setup (instant) ==========
  onStatus(t('status.backupPreparing'));
  updateProgress(onProgress, 0.01, true);
  await yieldToUi();

  const config = await getAuthHeaders();
  const SERVER_URL = getServerUrl();

  const allowed = await ensureStealthCloudUploadAllowed();
  if (!allowed) {
    return { uploaded: 0, skipped: 0, failed: 0, notAllowed: true };
  }

  onStatus(t('status.loadingEncryptionKey'));
  const masterKey = await getStealthCloudMasterKey();
  await yieldToUi();

  // ========== PHASE 3: Scan All Local Photos + Albums + iCloud Download (0-8%) ==========
  // Scans main library + all albums (Screenshots, Downloads, WhatsApp, user folders)
  // Also triggers iCloud/Google Cloud download for cloud-only items before dedup
  const { assets: allAssets, aborted: scanAborted } = await collectAllAssetsWithCloudDownload({
    onStatus,
    onProgress,
    progressStart: 0.02,
    progressEnd: 0.08,
    abortRef,
  });

  if (scanAborted) {
    return { uploaded: 0, skipped: 0, failed: 0, aborted: true };
  }

  if (allAssets.length === 0) {
    updateProgress(onProgress, 1.0, true);
    onStatus(t('status.noPhotosFound'));
    return { uploaded: 0, skipped: 0, failed: 0, noFiles: true };
  }

  console.log(`[Backup] Collected ${allAssets.length} assets from all albums`);

  // ========== PHASE 4: Fetch Server State ==========
  // Progress stays at 0 during fetching (progress bar hidden)
  onStatus(t('status.fetchingServerState'));

  let serverManifests = [];
  try {
    serverManifests = await fetchManifestsWithMeta(SERVER_URL, config, (fetched, total) => {
      // Don't update progress during fetching - keep progress bar hidden
      updateStatus(onStatus, total > fetched ? t('status.fetchingServerFiles', { fetched, total }) : t('status.fetchingServerFilesSimple', { fetched }));
    });
  } catch (e) {
    console.warn('Failed to fetch server manifests:', e?.message);
    serverManifests = [];
  }

  // ========== PHASE 5: Build Dedup Sets (instant) ==========
  onStatus(t('status.preparingDeduplication'));
  
  const dedupSets = buildDedupSetsFromMeta(serverManifests);
  console.log(`[Backup] Server: ${serverManifests.length} files, Dedup sets: manifestIds=${dedupSets.manifestIds.size}, filenames=${dedupSets.filenames.size}, fileHashes=${dedupSets.fileHashes.size}, perceptualHashes=${dedupSets.perceptualHashes.size}`);
  
  await yieldToUi();

  // ========== PHASE 6: Process Each File (0-100%) ==========
  const sessionHashes = {
    sessionFileHashes: new Set(),
    sessionPerceptualHashes: new Set(),
  };

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const totalFiles = allAssets.length;

  for (let i = 0; i < totalFiles; i++) {
    // Check abort
    if (abortRef?.current) {
      console.log('Backup aborted by user');
      return { uploaded, skipped, failed, aborted: true };
    }

    const asset = allAssets[i];
    const fileNum = i + 1;
    
    // Progress: 0-100% (starts at beginning of file, ends after last file)
    const fileProgress = i / totalFiles;
    updateProgress(onProgress, fileProgress);
    const displayFilename = asset?.filename || 'file';
    updateStatus(onStatus, t('status.backingUp', { current: fileNum, total: totalFiles, filename: displayFilename }));

    // Yield every few files to keep UI responsive
    if (i % 5 === 0) await yieldToUi();

    // Check background policy
    if (ensureAutoUploadPolicyAllowsWorkIfBackgrounded) {
      if (!(await ensureAutoUploadPolicyAllowsWorkIfBackgrounded())) {
        break;
      }
    }

    try {
      // Yield before heavy file operations
      await yieldToUi();
      
      // Get file info
      const fileInfo = await getAssetFileInfo(asset);
      const { assetInfo, filePath, tmpCopied, tmpUri, originalSize, filename, manifestId, isImage, creationTime } = fileInfo;

      // Quick dedup check (instant)
      const quickCheck = checkDedupQuick(manifestId, filename, originalSize, creationTime, dedupSets);
      if (quickCheck.skip) {
        skipped++;
        if (tmpCopied && tmpUri) await FileSystem.deleteAsync(tmpUri, { idempotent: true });
        continue;
      }

      // Yield before hashing (CPU intensive)
      await yieldToUi();
      
      // Compute hashes
      updateStatus(onStatus, t('status.hashing', { current: fileNum, total: totalFiles, filename: filename || displayFilename }), true);
      const { fileHash, perceptualHash } = await computeHashes(filePath, asset, assetInfo, isImage);

      // Yield after hashing
      await yieldToUi();

      // Hash-based dedup check
      const hashCheck = checkDedupByHash(fileHash, perceptualHash, dedupSets, sessionHashes);
      if (hashCheck.skip) {
        skipped++;
        if (tmpCopied && tmpUri) await FileSystem.deleteAsync(tmpUri, { idempotent: true });
        continue;
      }

      // Yield before upload (network + encryption intensive)
      await yieldToUi();
      
      // Upload
      updateStatus(onStatus, t('status.uploading', { current: fileNum, total: totalFiles, filename: filename || displayFilename }), true);
      const result = await encryptAndUpload({
        asset, assetInfo, filePath, tmpCopied, tmpUri, originalSize, filename, manifestId,
        fileHash, perceptualHash, masterKey, config, SERVER_URL, fastMode
      });

      if (result.success) {
        uploaded++;
        
        // Add to dedup sets for future checks
        dedupSets.manifestIds.add(manifestId);
        if (fileHash) {
          dedupSets.fileHashes.add(fileHash);
          sessionHashes.sessionFileHashes.add(fileHash);
        }
        if (perceptualHash) {
          dedupSets.perceptualHashes.add(perceptualHash);
          sessionHashes.sessionPerceptualHashes.add(perceptualHash);
        }

        // Thermal management
        const cooldown = getThrottleAssetCooldownMs(fastMode);
        if (cooldown > 0) await sleep(cooldown);

        const batchLimit = getThrottleBatchLimit(fastMode);
        if (uploaded > 0 && uploaded % batchLimit === 0) {
          const batchCooldown = getThrottleBatchCooldownMs(fastMode);
          if (batchCooldown > 0) {
            onStatus(`Cooling down (batch ${Math.floor(uploaded / batchLimit)})...`);
            await sleep(batchCooldown);
          }
        }
      } else {
        skipped++; // Server rejected as duplicate
      }

    } catch (e) {
      failed++;
      console.warn('Backup failed for asset:', asset?.id, e?.message);
    }
  }

  updateProgress(onProgress, 1.0, true);
  updateStatus(onStatus, t('status.backupCompleteStats', { uploaded, skipped, failed }), true);

  return { uploaded, skipped, failed };
};

// ============================================================================
// SELECTED ASSETS BACKUP
// ============================================================================

/**
 * Backup selected assets to StealthCloud
 */
export const stealthCloudBackupSelectedCore = async ({
  assets,
  getAuthHeaders,
  getServerUrl,
  ensureStealthCloudUploadAllowed,
  ensureAutoUploadPolicyAllowsWorkIfBackgrounded,
  fastMode,
  onStatus,
  onProgress,
  abortRef,
}) => {
  const list = Array.isArray(assets) ? assets.filter(a => a && a.id) : [];
  if (list.length === 0) {
    return { uploaded: 0, skipped: 0, failed: 0, noAssets: true };
  }

  resetProgress();
  onProgress(0);
  onStatus(t('status.backupPreparing'));

  const config = await getAuthHeaders();
  const SERVER_URL = getServerUrl();
  await yieldToUi();

  const allowed = await ensureStealthCloudUploadAllowed();
  if (!allowed) {
    return { uploaded: 0, skipped: 0, failed: 0, notAllowed: true };
  }

  onStatus(t('status.loadingEncryptionKey'));
  const masterKey = await getStealthCloudMasterKey();
  await yieldToUi();

  // Fetch server manifests with metadata for fast dedup
  onStatus(t('status.fetchingServerState'));
  updateProgress(onProgress, 0.02, true);

  let serverManifests = [];
  try {
    serverManifests = await fetchManifestsWithMeta(SERVER_URL, config, (fetched, total) => {
      const fetchProgress = 0.02 + (fetched / (total || fetched)) * 0.08;
      updateProgress(onProgress, fetchProgress);
      updateStatus(onStatus, total > fetched ? t('status.fetchingServerFiles', { fetched, total }) : t('status.fetchingServerFilesSimple', { fetched }));
    });
  } catch (e) {
    console.warn('Failed to fetch server manifests:', e?.message);
    serverManifests = [];
  }

  // Build dedup sets from metadata (instant)
  updateProgress(onProgress, 0.10, true);
  const dedupSets = buildDedupSetsFromMeta(serverManifests);
  
  const sessionHashes = {
    sessionFileHashes: new Set(),
    sessionPerceptualHashes: new Set(),
  };

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const totalFiles = list.length;

  for (let i = 0; i < totalFiles; i++) {
    if (abortRef?.current) {
      return { uploaded, skipped, failed, aborted: true };
    }

    const asset = list[i];
    const fileNum = i + 1;
    
    const fileProgress = 0.10 + (fileNum / totalFiles) * 0.90;
    updateProgress(onProgress, fileProgress);
    updateStatus(onStatus, t('status.processing', { current: fileNum, total: totalFiles }));

    if (i % 5 === 0) await yieldToUi();

    if (ensureAutoUploadPolicyAllowsWorkIfBackgrounded) {
      if (!(await ensureAutoUploadPolicyAllowsWorkIfBackgrounded())) break;
    }

    try {
      // Yield before heavy file operations
      await yieldToUi();
      
      const fileInfo = await getAssetFileInfo(asset);
      const { assetInfo, filePath, tmpCopied, tmpUri, originalSize, filename, manifestId, isImage, creationTime } = fileInfo;

      const quickCheck = checkDedupQuick(manifestId, filename, originalSize, creationTime, dedupSets);
      if (quickCheck.skip) {
        skipped++;
        if (tmpCopied && tmpUri) await FileSystem.deleteAsync(tmpUri, { idempotent: true });
        continue;
      }

      // Yield before hashing (CPU intensive)
      await yieldToUi();
      
      updateStatus(onStatus, t('status.hashing', { current: fileNum, total: totalFiles, filename: filename || 'file' }), true);
      const { fileHash, perceptualHash } = await computeHashes(filePath, asset, assetInfo, isImage);

      // Yield after hashing
      await yieldToUi();

      const hashCheck = checkDedupByHash(fileHash, perceptualHash, dedupSets, sessionHashes);
      if (hashCheck.skip) {
        skipped++;
        if (tmpCopied && tmpUri) await FileSystem.deleteAsync(tmpUri, { idempotent: true });
        continue;
      }

      // Yield before upload (network + encryption intensive)
      await yieldToUi();
      
      updateStatus(onStatus, t('status.uploading', { current: fileNum, total: totalFiles, filename: filename || 'file' }), true);
      const result = await encryptAndUpload({
        asset, assetInfo, filePath, tmpCopied, tmpUri, originalSize, filename, manifestId,
        fileHash, perceptualHash, masterKey, config, SERVER_URL, fastMode
      });

      if (result.success) {
        uploaded++;
        dedupSets.manifestIds.add(manifestId);
        if (fileHash) {
          dedupSets.fileHashes.add(fileHash);
          sessionHashes.sessionFileHashes.add(fileHash);
        }
        if (perceptualHash) {
          dedupSets.perceptualHashes.add(perceptualHash);
          sessionHashes.sessionPerceptualHashes.add(perceptualHash);
        }

        const cooldown = getThrottleAssetCooldownMs(fastMode);
        if (cooldown > 0) await sleep(cooldown);

        const batchLimit = getThrottleBatchLimit(fastMode);
        if (uploaded > 0 && uploaded % batchLimit === 0) {
          const batchCooldown = getThrottleBatchCooldownMs(fastMode);
          if (batchCooldown > 0) {
            onStatus(`Cooling down (batch ${Math.floor(uploaded / batchLimit)})...`);
            await sleep(batchCooldown);
          }
        }
      } else {
        skipped++;
      }
    } catch (e) {
      failed++;
      console.warn('Backup failed for asset:', asset?.id, e?.message);
    }
  }

  updateProgress(onProgress, 1.0, true);
  return { uploaded, skipped, failed };
};

export default {
  stealthCloudBackupCore,
  stealthCloudBackupSelectedCore,
};
