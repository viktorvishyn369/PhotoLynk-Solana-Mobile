// BackupOperations - Core backup logic extracted from App.js
// Contains stealthCloudBackupCore, stealthCloudBackupSelectedCore, backupPhotosCore

import { Platform, AppState } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import axios from 'axios';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { sha256 } from 'js-sha256';

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

import { fetchAllManifestsPaged } from './mediaHelpers';

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

// ============================================================================
// HELPERS
// ============================================================================

// Yield to UI thread - use longer delay to actually let UI breathe
const yieldToUi = () => new Promise(r => setTimeout(r, 16)); // ~1 frame at 60fps

// Throttled status update - only update UI every N ms to prevent render thrashing
let lastStatusUpdateMs = 0;
const throttledStatus = (onStatus, text, forceUpdate = false) => {
  const now = Date.now();
  if (forceUpdate || (now - lastStatusUpdateMs) >= 100) { // Max 10 updates/sec
    lastStatusUpdateMs = now;
    onStatus(text);
  }
};

// Throttled progress update with monotonic guard (never goes backwards)
let lastProgressUpdateMs = 0;
let lastProgressValue = 0;
const throttledProgress = (onProgress, value, forceUpdate = false) => {
  // Never allow progress to go backwards
  if (value < lastProgressValue) return;
  
  const now = Date.now();
  if (forceUpdate || (now - lastProgressUpdateMs) >= 100) { // Max 10 updates/sec
    lastProgressUpdateMs = now;
    lastProgressValue = value;
    onProgress(value);
  }
};

// Reset progress tracking for new operation
const resetProgressTracking = () => {
  lastProgressValue = 0;
  lastProgressUpdateMs = 0;
  lastStatusUpdateMs = 0;
};

// Throttle functions
const getThrottleAssetCooldownMs = (fastMode) => fastMode ? 0 : (Platform.OS === 'ios' ? 2000 : 1500);
const getThrottleBatchLimit = (fastMode) => fastMode ? 999999 : 10;
const getThrottleBatchCooldownMs = (fastMode) => fastMode ? 0 : 30000;
const getThrottleChunkCooldownMs = (fastMode) => fastMode ? 0 : 300;

const throttleEncryption = async (chunkIndex, fastMode) => {
  const chunkCooldown = getThrottleChunkCooldownMs(fastMode);
  if (chunkCooldown <= 0) return;
  if (chunkIndex > 0) {
    await new Promise((resolve) => setTimeout(resolve, chunkCooldown));
  }
};

const thermalCooldownPause = async (batchCount, fastMode, onStatus) => {
  const cooldownMs = getThrottleBatchCooldownMs(fastMode);
  if (cooldownMs <= 0) return;
  if (onStatus) onStatus(`Cooling down (batch ${batchCount})...`);
  console.log(`Thermal: cooling pause after batch ${batchCount}, waiting ${cooldownMs}ms`);
  await sleep(cooldownMs);
};

// Wait for iOS app to become active after permission dialog
const waitForIosActive = async (appStateRef, onStatus) => {
  if (Platform.OS !== 'ios') return;
  if (appStateRef.current === 'active') return;

  const SHOW_DELAY_MS = 250;
  const MIN_VISIBLE_MS = 900;
  let shownAtMs = null;

  await new Promise((resolve) => {
    let done = false;
    let sub = null;

    const showTimer = setTimeout(() => {
      if (done) return;
      shownAtMs = Date.now();
      if (onStatus) onStatus('Finalizing Photos permission...');
    }, SHOW_DELAY_MS);

    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      clearTimeout(showTimer);
      try { sub && sub.remove && sub.remove(); } catch (e) {}
      resolve();
    }, 10000);

    sub = AppState.addEventListener('change', (st) => {
      if (done) return;
      if (String(st) === 'active') {
        done = true;
        clearTimeout(timeout);
        clearTimeout(showTimer);
        try { sub && sub.remove && sub.remove(); } catch (e) {}
        resolve();
      }
    });
  });

  if (shownAtMs !== null) {
    const elapsed = Date.now() - shownAtMs;
    if (elapsed < MIN_VISIBLE_MS) {
      await new Promise((r) => setTimeout(r, MIN_VISIBLE_MS - elapsed));
    }
  }

  await yieldToUi();
};

// Build deduplication sets from existing manifests
const buildDeduplicationSets = async (existingManifests, SERVER_URL, config, masterKey, onProgress = null, onStatus = null) => {
  const alreadyFilenames = new Set();
  const alreadyBaseFilenames = new Set();
  const alreadyBaseNameSizes = new Map();
  const alreadyBaseNameDates = new Map();
  const alreadyBaseNameTimestamps = new Map();
  const alreadyFileHashes = new Set();
  const alreadyPerceptualHashes = new Set();
  const alreadyExifFull = new Set();
  const alreadyExifTimeModel = new Set();
  const alreadyExifTimeMake = new Set();

  if (existingManifests.length > 0) {
    const MAX_CONCURRENT = 5;
    let idx = 0;
    let processed = 0;
    const total = existingManifests.length;
    let lastStatusUpdate = 0;

    const getNext = () => {
      if (idx < existingManifests.length) {
        return existingManifests[idx++];
      }
      return null;
    };

    const worker = async () => {
      let m;
      while ((m = getNext()) !== null) {
        try {
          const manRes = await axios.get(`${SERVER_URL}/api/cloud/manifests/${m.manifestId}`, { headers: config.headers, timeout: 15000 });
          const payload = manRes.data;
          const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
          const enc = JSON.parse(parsed.encryptedManifest);
          const manifestNonce = naclUtil.decodeBase64(enc.manifestNonce);
          const manifestBox = naclUtil.decodeBase64(enc.manifestBox);
          const manifestPlain = nacl.secretbox.open(manifestBox, manifestNonce, masterKey);
          if (manifestPlain) {
            const manifest = JSON.parse(naclUtil.encodeUTF8(manifestPlain));
            if (manifest.filename) {
              alreadyFilenames.add(normalizeFilenameForCompare(manifest.filename));
              const baseName = extractBaseFilename(manifest.filename);
              if (baseName) {
                alreadyBaseFilenames.add(baseName);
                if (manifest.originalSize) {
                  if (!alreadyBaseNameSizes.has(baseName)) alreadyBaseNameSizes.set(baseName, new Set());
                  alreadyBaseNameSizes.get(baseName).add(manifest.originalSize);
                }
                if (manifest.creationTime) {
                  const dateStr = normalizeDateForCompare(manifest.creationTime);
                  if (dateStr) {
                    if (!alreadyBaseNameDates.has(baseName)) alreadyBaseNameDates.set(baseName, new Set());
                    alreadyBaseNameDates.get(baseName).add(dateStr);
                  }
                  const fullTimestamp = normalizeFullTimestamp(manifest.creationTime);
                  if (fullTimestamp) {
                    if (!alreadyBaseNameTimestamps.has(baseName)) alreadyBaseNameTimestamps.set(baseName, new Set());
                    alreadyBaseNameTimestamps.get(baseName).add(fullTimestamp);
                  }
                }
              }
            }
            if (manifest.perceptualHash) alreadyPerceptualHashes.add(manifest.perceptualHash);
            if (manifest.fileHash) alreadyFileHashes.add(manifest.fileHash);
            if (manifest.exifCaptureTime) {
              const ct = manifest.exifCaptureTime;
              const mk = manifest.exifMake;
              const md = manifest.exifModel;
              if (ct && mk && md) alreadyExifFull.add(`${ct}|${mk}|${md}`);
              if (ct && md) alreadyExifTimeModel.add(`${ct}|${md}`);
              if (ct && mk) alreadyExifTimeMake.add(`${ct}|${mk}`);
            }
          }
        } catch (e) {
          // Skip manifests we can't decrypt
        } finally {
          // Update progress after each manifest (safe - runs after async work completes)
          processed++;
          const now = Date.now();
          if (now - lastStatusUpdate > 100) {
            lastStatusUpdate = now;
            if (onStatus) onStatus(`Analyzing ${processed} of ${total} server files...`);
            if (onProgress) onProgress(processed / total);
            await new Promise(r => setTimeout(r, 16)); // Yield to UI
          }
        }
      }
    };

    const workers = [];
    const poolSize = Math.min(MAX_CONCURRENT, existingManifests.length);
    for (let i = 0; i < poolSize; i++) workers.push(worker());
    await Promise.all(workers);
    console.log(`StealthCloud: found ${alreadyFilenames.size} filenames, ${alreadyBaseFilenames.size} base names, ${alreadyBaseNameSizes.size} name+size, ${alreadyBaseNameDates.size} name+date, ${alreadyBaseNameTimestamps.size} name+timestamp, ${alreadyFileHashes.size} file hashes, ${alreadyPerceptualHashes.size} perceptual hashes, ${alreadyExifFull.size} EXIF keys for deduplication`);
  }

  return {
    alreadyFilenames,
    alreadyBaseFilenames,
    alreadyBaseNameSizes,
    alreadyBaseNameDates,
    alreadyBaseNameTimestamps,
    alreadyFileHashes,
    alreadyPerceptualHashes,
    alreadyExifFull,
    alreadyExifTimeModel,
    alreadyExifTimeMake,
  };
};

// Check if asset should be skipped based on deduplication
const shouldSkipAsset = async ({
  asset, assetInfo, assetFilename, originalSize, manifestId, already, dedupSets, shouldSkipDeduplication, filePath, tmpCopied, tmpUri
}) => {
  if (shouldSkipDeduplication) return { skip: false };

  const {
    alreadyFilenames, alreadyBaseNameSizes, alreadyBaseNameDates, alreadyBaseNameTimestamps,
    alreadyFileHashes, alreadyPerceptualHashes
  } = dedupSets;

  // Skip if already uploaded (by stable manifestId)
  if (already.has(manifestId)) {
    if (tmpCopied && tmpUri) await FileSystem.deleteAsync(tmpUri, { idempotent: true });
    return { skip: true, reason: 'manifestId' };
  }

  // Skip if filename already exists on server
  const normalizedFilename = assetFilename ? normalizeFilenameForCompare(assetFilename) : null;
  if (normalizedFilename && alreadyFilenames.has(normalizedFilename)) {
    console.log(`Skipping ${assetFilename} - filename already on server`);
    if (tmpCopied && tmpUri) await FileSystem.deleteAsync(tmpUri, { idempotent: true });
    return { skip: true, reason: 'filename' };
  }

  const baseFilename = assetFilename ? extractBaseFilename(assetFilename) : null;

  // HEIC PRIORITY: Full timestamp match
  const assetTimestamp = asset.creationTime ? normalizeFullTimestamp(asset.creationTime) : null;
  if (baseFilename && assetTimestamp && alreadyBaseNameTimestamps.has(baseFilename)) {
    const existingTimestamps = alreadyBaseNameTimestamps.get(baseFilename);
    if (existingTimestamps.has(assetTimestamp)) {
      console.log(`Skipping ${assetFilename} - baseFilename+timestamp match (${baseFilename}, ${assetTimestamp})`);
      if (tmpCopied && tmpUri) await FileSystem.deleteAsync(tmpUri, { idempotent: true });
      return { skip: true, reason: 'timestamp' };
    }
  }

  // Fallback 1: base filename + size match
  if (baseFilename && alreadyBaseNameSizes.has(baseFilename)) {
    const existingSizes = alreadyBaseNameSizes.get(baseFilename);
    for (const existingSize of existingSizes) {
      const sizeDiff = Math.abs(originalSize - existingSize) / Math.max(originalSize, existingSize);
      if (sizeDiff < 0.20) {
        console.log(`Skipping ${assetFilename} - baseFilename+size match (${baseFilename}, size diff ${(sizeDiff * 100).toFixed(1)}%)`);
        if (tmpCopied && tmpUri) await FileSystem.deleteAsync(tmpUri, { idempotent: true });
        return { skip: true, reason: 'size' };
      }
    }
  }

  // Fallback 2: base filename + creation date match
  const assetDate = asset.creationTime ? normalizeDateForCompare(asset.creationTime) : null;
  if (baseFilename && assetDate && alreadyBaseNameDates.has(baseFilename)) {
    const existingDates = alreadyBaseNameDates.get(baseFilename);
    if (existingDates.has(assetDate)) {
      console.log(`Skipping ${assetFilename} - baseFilename+date match (${baseFilename}, ${assetDate})`);
      if (tmpCopied && tmpUri) await FileSystem.deleteAsync(tmpUri, { idempotent: true });
      return { skip: true, reason: 'date' };
    }
  }

  return { skip: false };
};

// Compute hashes for an asset
const computeAssetHashes = async ({ asset, assetInfo, assetFilename, filePath, isImage, shouldSkipDeduplication, dedupSets, sessionFileHashes, sessionPerceptualHashes }) => {
  let exactFileHash = null;
  let perceptualHash = null;
  const { alreadyFileHashes, alreadyPerceptualHashes } = dedupSets;

  // Always compute hashes - needed for both dedup and manifest storage
  if (isImage) {
    try {
      perceptualHash = await computePerceptualHash(filePath, asset, assetInfo);
      if (perceptualHash) {
        console.log(`[PerceptualHash] ${assetFilename}: ${perceptualHash} (${perceptualHash.length} chars)`);
      }
    } catch (e) {
      console.warn('computePerceptualHash failed:', asset.id, e?.message);
    }

    try {
      exactFileHash = await computeExactFileHash(filePath);
    } catch (e) {
      console.warn('computeExactFileHash failed:', asset.id, e?.message);
    }

    // Check against server hashes (if available)
    if (!shouldSkipDeduplication && perceptualHash && findPerceptualHashMatch(perceptualHash, alreadyPerceptualHashes, CROSS_PLATFORM_DHASH_THRESHOLD)) {
      return { skip: true, reason: 'perceptualHash' };
    }

    // Check against session hashes (catches duplicates within same batch)
    if (sessionPerceptualHashes && perceptualHash && findPerceptualHashMatch(perceptualHash, sessionPerceptualHashes, CROSS_PLATFORM_DHASH_THRESHOLD)) {
      console.log(`⊘ Skipped (duplicate): ${assetFilename} - perceptual hash matches file in current batch`);
      return { skip: true, reason: 'sessionPerceptualHash' };
    }
    if (sessionFileHashes && exactFileHash && sessionFileHashes.has(exactFileHash)) {
      console.log(`⊘ Skipped (duplicate): ${assetFilename} - exact file hash matches file in current batch`);
      return { skip: true, reason: 'sessionFileHash' };
    }
  } else {
    // Video - use file hash
    try {
      exactFileHash = await computeExactFileHash(filePath);
      console.log(`[FileHash] ${assetFilename}: ${exactFileHash ? exactFileHash.substring(0, 16) + '...' : 'null'}`);
    } catch (e) {
      console.warn('computeExactFileHash failed:', asset.id, e?.message);
    }

    // Check against server hashes (if available)
    if (!shouldSkipDeduplication && exactFileHash && alreadyFileHashes.has(exactFileHash)) {
      console.log(`Skipping ${assetFilename} - exact file hash already on server`);
      return { skip: true, reason: 'fileHash' };
    }

    // Check against session hashes (catches duplicates within same batch)
    if (sessionFileHashes && exactFileHash && sessionFileHashes.has(exactFileHash)) {
      console.log(`⊘ Skipped (duplicate): ${assetFilename} - exact file hash matches file in current batch`);
      return { skip: true, reason: 'sessionFileHash' };
    }
  }

  return { skip: false, exactFileHash, perceptualHash };
};

// Upload a single asset to StealthCloud
const uploadSingleAssetToStealthCloud = async ({
  asset, config, SERVER_URL, masterKey, already, dedupSets, shouldSkipDeduplication, fastMode,
  processedIndex, totalCount, onStatus, onProgress, sessionFileHashes, sessionPerceptualHashes
}) => {
  let assetInfo;
  try {
    assetInfo = await withRetries(async () => {
      return Platform.OS === 'android'
        ? await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: true })
        : await MediaLibrary.getAssetInfoAsync(asset.id);
    }, { retries: 5, baseDelayMs: 1000, maxDelayMs: 15000, shouldRetry: () => true });
  } catch (e) {
    console.warn('getAssetInfoAsync failed after retries:', asset.id, e?.message);
    return { uploaded: 0, skipped: 0, failed: 1 };
  }

  let filePath, tmpCopied, tmpUri;
  try {
    const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo });
    filePath = resolved.filePath;
    tmpCopied = resolved.tmpCopied;
    tmpUri = resolved.tmpUri;
  } catch (e) {
    console.warn('resolveReadableFilePath failed:', asset.id, e?.message);
    return { uploaded: 0, skipped: 0, failed: 1 };
  }

  // Get file size
  let originalSize = null;
  try {
    originalSize = assetInfo && typeof assetInfo.fileSize === 'number' ? Number(assetInfo.fileSize) : null;
  } catch (e) {}

  if (!originalSize) {
    if (Platform.OS === 'ios') {
      const fileUri = filePath.startsWith('/') ? `file://${filePath}` : (filePath || tmpUri);
      try {
        const info = await FileSystem.getInfoAsync(fileUri);
        originalSize = info && typeof info.size === 'number' ? Number(info.size) : null;
      } catch (e) {}
    } else {
      let ReactNativeBlobUtil = null;
      try {
        const mod = require('react-native-blob-util');
        ReactNativeBlobUtil = mod && (mod.default || mod);
      } catch (e) {}
      if (ReactNativeBlobUtil?.fs?.stat) {
        try {
          const stat = await ReactNativeBlobUtil.fs.stat(filePath);
          originalSize = stat && stat.size ? Number(stat.size) : null;
        } catch (e) {}
      }
    }
  }

  const assetFilename = assetInfo.filename || asset.filename || null;
  const fileIdentity = computeFileIdentity(assetFilename, originalSize);
  const manifestId = fileIdentity ? sha256(`file:${fileIdentity}`) : sha256(`asset:${asset.id}`);
  
  // Debug: log manifestId computation for first few files
  if (processedIndex < 5) {
    console.log(`[Dedup Debug] ${Platform.OS} file=${assetFilename} size=${originalSize} identity=${fileIdentity} manifestId=${manifestId?.substring(0, 16)}...`);
  }

  // Check deduplication
  const skipResult = await shouldSkipAsset({
    asset, assetInfo, assetFilename, originalSize, manifestId, already, dedupSets, shouldSkipDeduplication, filePath, tmpCopied, tmpUri
  });
  if (skipResult.skip) {
    if (processedIndex < 10) {
      console.log(`[Dedup Debug] ${Platform.OS}: SKIPPED ${assetFilename} reason=${skipResult.reason}`);
    }
    return { uploaded: 0, skipped: 1, failed: 0 };
  }
  if (processedIndex < 5) {
    console.log(`[Dedup Debug] ${Platform.OS}: NOT SKIPPED ${assetFilename} - will upload`);
  }

  const isImage = asset.mediaType === 'photo' || (assetInfo && assetInfo.mediaType === 'photo');

  // Compute hashes and check for duplicates (including within current batch)
  const hashResult = await computeAssetHashes({
    asset, assetInfo, assetFilename, filePath, isImage, shouldSkipDeduplication, dedupSets,
    sessionFileHashes, sessionPerceptualHashes
  });
  if (hashResult.skip) {
    if (tmpCopied && tmpUri) await FileSystem.deleteAsync(tmpUri, { idempotent: true });
    return { uploaded: 0, skipped: 1, failed: 0 };
  }
  const { exactFileHash, perceptualHash } = hashResult;

  // Generate per-file key and base nonce
  const fileKey = new Uint8Array(32);
  global.crypto.getRandomValues(fileKey);
  const baseNonce16 = new Uint8Array(16);
  global.crypto.getRandomValues(baseNonce16);
  const wrapNonce = new Uint8Array(24);
  global.crypto.getRandomValues(wrapNonce);
  const wrappedKey = nacl.secretbox(fileKey, wrapNonce, masterKey);

  // Upload chunks
  let chunkIndex = 0;
  const chunkIds = [];
  const chunkSizes = [];
  const chunkUploadsInFlight = new Set();

  if (Platform.OS === 'ios') {
    const fileUri = filePath.startsWith('/') ? `file://${filePath}` : (filePath || tmpUri);
    const maxChunkUploadsInFlight = Math.max(1, chooseStealthCloudMaxParallelChunkUploads({ platform: 'ios', originalSize, fastMode }));
    const runChunkUpload = createConcurrencyLimiter(maxChunkUploadsInFlight);
    const chunkPlainBytes = chooseStealthCloudChunkBytes({ platform: 'ios', originalSize, fastMode });
    const effectiveBytes = chunkPlainBytes - (chunkPlainBytes % 3);

    let position = 0;
    while (true) {
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
      const plaintext = naclUtil.decodeBase64(nextB64);
      if (!plaintext || plaintext.length === 0) break;

      const nonce = makeChunkNonce(baseNonce16, chunkIndex);
      await throttleEncryption(chunkIndex, fastMode);
      const boxed = nacl.secretbox(plaintext, nonce, fileKey);
      const chunkId = sha256.create().update(boxed).hex();
      await trackInFlightPromise(
        chunkUploadsInFlight,
        runChunkUpload(() => stealthCloudUploadEncryptedChunk({ SERVER_URL, config, chunkId, encryptedBytes: boxed })),
        maxChunkUploadsInFlight
      );
      chunkIds.push(chunkId);
      chunkSizes.push(plaintext.length);
      chunkIndex += 1;
      position += plaintext.length;

      // Note: Per-chunk progress removed to prevent bar jumping back
      // Main backup loop handles progress updates at file level

      if (plaintext.length < effectiveBytes) break;
    }
  } else {
    // Android: use react-native-blob-util
    let ReactNativeBlobUtil = null;
    try {
      const mod = require('react-native-blob-util');
      ReactNativeBlobUtil = mod && (mod.default || mod);
    } catch (e) {}
    if (!ReactNativeBlobUtil || !ReactNativeBlobUtil.fs || typeof ReactNativeBlobUtil.fs.readStream !== 'function') {
      throw new Error('StealthCloud backup requires a development build (react-native-blob-util).');
    }

    const stat = await ReactNativeBlobUtil.fs.stat(filePath);
    originalSize = stat && stat.size ? Number(stat.size) : null;

    const maxChunkUploadsInFlight = Math.max(1, chooseStealthCloudMaxParallelChunkUploads({ platform: 'android', originalSize, fastMode }));
    const runChunkUpload = createConcurrencyLimiter(maxChunkUploadsInFlight);
    const chunkPlainBytes = chooseStealthCloudChunkBytes({ platform: 'android', originalSize, fastMode });
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
              const nextB64 = queue.shift();
              const plaintext = naclUtil.decodeBase64(nextB64);
              const nonce = makeChunkNonce(baseNonce16, chunkIndex);
              await throttleEncryption(chunkIndex, fastMode);
              const boxed = nacl.secretbox(plaintext, nonce, fileKey);
              const chunkId = sha256.create().update(boxed).hex();
              await trackInFlightPromise(
                chunkUploadsInFlight,
                runChunkUpload(() => stealthCloudUploadEncryptedChunk({ SERVER_URL, config, chunkId, encryptedBytes: boxed })),
                maxChunkUploadsInFlight
              );
              chunkIds.push(chunkId);
              chunkSizes.push(plaintext.length);
              chunkIndex += 1;
              // Note: Per-chunk progress removed to prevent bar jumping back
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

  // Extract EXIF data and build manifest
  const exifData = extractExifForDedup(assetInfo, asset);
  const manifest = {
    v: 1,
    assetId: asset.id,
    filename: assetInfo.filename || asset.filename || null,
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
    fileHash: exactFileHash,
    perceptualHash: perceptualHash,
  };

  const manifestPlain = naclUtil.decodeUTF8(JSON.stringify(manifest));
  const manifestNonce = new Uint8Array(24);
  global.crypto.getRandomValues(manifestNonce);
  const manifestBox = nacl.secretbox(manifestPlain, manifestNonce, masterKey);
  const encryptedManifest = JSON.stringify({
    manifestNonce: naclUtil.encodeBase64(manifestNonce),
    manifestBox: naclUtil.encodeBase64(manifestBox)
  });

  const manifestResponse = await withRetries(async () => {
    return await axios.post(
      `${SERVER_URL}/api/cloud/manifests`,
      { 
        manifestId, 
        encryptedManifest, 
        chunkCount: chunkIds.length,
        // Include metadata for fast dedup on future backups (server stores unencrypted)
        filename: assetFilename,
        originalSize,
        fileHash: exactFileHash,
        perceptualHash,
        creationTime: asset.creationTime,
      },
      { headers: config.headers, timeout: 30000 }
    );
  }, { retries: 20, baseDelayMs: 2000, maxDelayMs: 30000, shouldRetry: shouldRetryChunkUpload });

  if (manifestResponse?.data?.skipped) {
    console.log(`Server rejected ${assetFilename} as duplicate (reason: ${manifestResponse.data.reason || 'unknown'})`);
    if (tmpCopied && tmpUri) await FileSystem.deleteAsync(tmpUri, { idempotent: true });
    return { uploaded: 0, skipped: 1, failed: 0 };
  }

  already.add(manifestId);
  if (exactFileHash) dedupSets.alreadyFileHashes.add(exactFileHash);
  if (perceptualHash) dedupSets.alreadyPerceptualHashes.add(perceptualHash);
  
  // Also add to session sets for within-batch deduplication
  if (sessionFileHashes && exactFileHash) sessionFileHashes.add(exactFileHash);
  if (sessionPerceptualHashes && perceptualHash) sessionPerceptualHashes.add(perceptualHash);

  if (tmpCopied && tmpUri) {
    await FileSystem.deleteAsync(tmpUri, { idempotent: true });
  }

  return { uploaded: 1, skipped: 0, failed: 0 };
};

// ============================================================================
// MAIN EXPORT: stealthCloudBackupCore
// ============================================================================

/**
 * Core StealthCloud backup logic - backs up all photos/videos to StealthCloud
 * @param {Object} params
 * @param {Function} params.getAuthHeaders - Function to get auth headers
 * @param {Function} params.getServerUrl - Function to get server URL
 * @param {Function} params.ensureStealthCloudUploadAllowed - Function to check upload permission
 * @param {Function} params.ensureAutoUploadPolicyAllowsWorkIfBackgrounded - Function to check background policy
 * @param {Object} params.appStateRef - Ref to app state
 * @param {boolean} params.fastMode - Whether fast mode is enabled
 * @param {Function} params.onStatus - Status callback
 * @param {Function} params.onProgress - Progress callback (0-1)
 * @returns {Promise<{uploaded: number, skipped: number, failed: number}>}
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
  onStatus('Requesting Photos permission...');
  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission || permission.status !== 'granted') {
    return { uploaded: 0, skipped: 0, failed: 0, permissionDenied: true };
  }

  await waitForIosActive(appStateRef, onStatus);

  if (Platform.OS === 'ios') {
    const ap = await getMediaLibraryAccessPrivileges(permission);
    if (ap && ap !== 'all') {
      onStatus('Limited Photos access (Selected Photos). Backing up accessible items...');
    }
  }

  // Reset progress tracking for this new operation
  resetProgressTracking();
  
  onProgress(0);
  onStatus('Preparing backup...');

  const config = await getAuthHeaders();
  const SERVER_URL = getServerUrl();
  
  // Yield to UI after auth
  await new Promise(r => setTimeout(r, 16));
  onStatus('Checking permissions...');

  const allowed = await ensureStealthCloudUploadAllowed();
  if (!allowed) {
    return { uploaded: 0, skipped: 0, failed: 0, notAllowed: true };
  }
  
  // Yield to UI
  await new Promise(r => setTimeout(r, 16));
  onStatus('Loading encryption key...');

  const masterKey = await getStealthCloudMasterKey();
  
  // Yield to UI
  await new Promise(r => setTimeout(r, 16));
  onStatus('Fetching server state...');
  onProgress(0.01);

  let existingManifests = [];
  try {
    existingManifests = await fetchAllManifestsPaged(SERVER_URL, config, (fetched, total) => {
      // Progress fills 1-4% during fetch (proportional to fetched/total)
      const fetchProgress = total > 0 ? (fetched / total) * 0.03 : 0;
      throttledProgress(onProgress, 0.01 + fetchProgress);
      throttledStatus(onStatus, `Fetching ${fetched}${total > fetched ? ` of ${total}` : ''} server files...`);
    });
  } catch (e) {
    existingManifests = [];
  }
  onProgress(0.04);
  const already = new Set(existingManifests.map(m => m.manifestId));
  console.log(`[Dedup Debug] ${Platform.OS}: Found ${existingManifests.length} existing manifests, ${already.size} unique manifestIds`);
  
  // Get local file count first to calculate proportional progress
  // Quick count without fetching all assets
  let estimatedLocalCount = 0;
  try {
    const countPage = await MediaLibrary.getAssetsAsync({ first: 1, mediaType: Platform.OS === 'ios' ? [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video] : ['photo', 'video'] });
    estimatedLocalCount = countPage?.totalCount || 500; // Default estimate if unavailable
  } catch (e) {
    estimatedLocalCount = 500;
  }
  
  // Calculate proportional progress split based on file counts
  // Analyzing is ~1 unit of work per file (HTTP + decrypt)
  // Backing up is ~10 units of work per file (hash + encrypt + upload chunks)
  const analyzeWeight = existingManifests.length * 1;
  const backupWeight = estimatedLocalCount * 10;
  const totalWeight = analyzeWeight + backupWeight;
  const analyzePhaseEnd = totalWeight > 0 ? Math.min(0.4, Math.max(0.05, analyzeWeight / totalWeight)) : 0;
  
  // Phase: Analyzing server files (with progress)
  if (existingManifests.length > 0) {
    onStatus(`Analyzing 0 of ${existingManifests.length} server files...`);
    onProgress(0);
  }

  const dedupSets = await buildDeduplicationSets(
    existingManifests, 
    SERVER_URL, 
    config, 
    masterKey,
    // Progress callback for analyzing phase (0 to analyzePhaseEnd)
    (p) => onProgress(p * analyzePhaseEnd),
    (msg) => onStatus(msg)
  );
  console.log(`[Dedup Debug] ${Platform.OS}: Built dedup sets - filenames=${dedupSets.alreadyFilenames.size}, perceptualHashes=${dedupSets.alreadyPerceptualHashes.size}, fileHashes=${dedupSets.alreadyFileHashes.size}`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  const hasServerFiles = existingManifests.length > 0;
  const shouldSkipDeduplication = !hasServerFiles;

  // Session-level hash tracking to catch duplicates across the ENTIRE backup operation
  // Persists across all batches/pages - if file A uploads in batch 1, file B with same hash in batch 5 will be skipped
  // This works even when shouldSkipDeduplication is true (no server files yet)
  const sessionFileHashes = new Set();
  const sessionPerceptualHashes = new Set();

  if (shouldSkipDeduplication) {
    console.log('StealthCloud: No server files found - will still check for duplicates across entire operation');
  }

  // Phase: Scanning local photos
  // Progress range: analyzePhaseEnd to (analyzePhaseEnd + scanPhaseRange)
  const scanPhaseRange = 0.1; // 10% for scanning
  const scanPhaseEnd = Math.min(analyzePhaseEnd + scanPhaseRange, 0.5); // Cap at 50%
  
  onStatus('Scanning local photos...');
  onProgress(analyzePhaseEnd);
  await new Promise(r => setTimeout(r, 16));

  const PAGE_SIZE = 250;
  const mediaTypeQuery = Platform.OS === 'ios'
    ? [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video]
    : ['photo', 'video'];
  const sortByQuery = Platform.OS === 'ios'
    ? [MediaLibrary.SortBy.creationTime]
    : undefined;

  // First pass: collect all assets with progress
  const allAssets = [];
  let after = null;
  let totalCount = null;
  let scannedCount = 0;

  while (true) {
    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      after: after || undefined,
      mediaType: mediaTypeQuery,
      sortBy: sortByQuery,
    });

    if (totalCount === null && page && typeof page.totalCount === 'number') {
      totalCount = page.totalCount;
    }

    const assets = page && Array.isArray(page.assets) ? page.assets : [];
    if (assets.length === 0) {
      if (scannedCount === 0) {
        return { uploaded: 0, skipped: 0, failed: 0, noFiles: true };
      }
      break;
    }

    allAssets.push(...assets);
    scannedCount += assets.length;
    
    // Update progress during scanning phase
    if (totalCount) {
      const scanProgress = analyzePhaseEnd + (scannedCount / totalCount) * (scanPhaseEnd - analyzePhaseEnd);
      throttledProgress(onProgress, scanProgress);
      throttledStatus(onStatus, `Scanning ${scannedCount} of ${totalCount} local photos...`);
    } else {
      throttledStatus(onStatus, `Scanning ${scannedCount} local photos...`);
    }

    after = page && page.endCursor ? page.endCursor : null;
    if (!page || page.hasNextPage !== true) break;
    
    // Yield to UI between pages
    await new Promise(r => setTimeout(r, 16));
  }

  // Backup phase uses remaining progress (scanPhaseEnd to 1.0)
  const backupPhaseStart = scanPhaseEnd;
  const backupPhaseRange = 1.0 - scanPhaseEnd;
  let processedIndex = 0;

  onStatus(`Backing up 0 of ${allAssets.length}`);
  onProgress(backupPhaseStart);
  await new Promise(r => setTimeout(r, 16));

  for (let j = 0; j < allAssets.length; j++) {
    // Check abort signal
    if (abortRef && abortRef.current) {
      console.log('StealthCloud backup aborted by user');
      return { uploaded, skipped, failed, aborted: true };
    }

    const asset = allAssets[j];
    processedIndex += 1;

    if (ensureAutoUploadPolicyAllowsWorkIfBackgrounded && !(await ensureAutoUploadPolicyAllowsWorkIfBackgrounded())) {
      break;
    }

    try {
      // Throttle UI updates to prevent render thrashing
      // Progress: backupPhaseStart to 1.0 (proportional to file counts)
      throttledStatus(onStatus, `Backing up ${processedIndex} of ${allAssets.length}`);
      throttledProgress(onProgress, backupPhaseStart + (processedIndex / allAssets.length) * backupPhaseRange);

      // Yield to UI thread every few assets to keep UI responsive
      if (processedIndex % 3 === 0) await yieldToUi();

      const result = await uploadSingleAssetToStealthCloud({
        asset, config, SERVER_URL, masterKey, already, dedupSets, shouldSkipDeduplication, fastMode,
        processedIndex, totalCount: allAssets.length, onStatus, onProgress, sessionFileHashes, sessionPerceptualHashes
      });

      uploaded += result.uploaded;
      skipped += result.skipped;
      failed += result.failed;

      if (result.uploaded > 0) {
        const assetCooldown = getThrottleAssetCooldownMs(fastMode);
        if (assetCooldown > 0) await sleep(assetCooldown);

        const batchLimit = getThrottleBatchLimit(fastMode);
        if (uploaded > 0 && uploaded % batchLimit === 0) {
          await thermalCooldownPause(Math.floor(uploaded / batchLimit), fastMode, onStatus);
        }
      }
    } catch (e) {
      failed += 1;
      console.warn('StealthCloud asset failed:', asset?.id || 'unknown', e?.message || String(e));
    }
  }

  return { uploaded, skipped, failed };
};

// ============================================================================
// MAIN EXPORT: stealthCloudBackupSelectedCore
// ============================================================================

/**
 * Core StealthCloud backup logic for selected assets
 * @param {Object} params
 * @param {Array} params.assets - Array of assets to backup
 * @param {Function} params.getAuthHeaders - Function to get auth headers
 * @param {Function} params.getServerUrl - Function to get server URL
 * @param {Function} params.ensureStealthCloudUploadAllowed - Function to check upload permission
 * @param {Function} params.ensureAutoUploadPolicyAllowsWorkIfBackgrounded - Function to check background policy
 * @param {boolean} params.fastMode - Whether fast mode is enabled
 * @param {Function} params.onStatus - Status callback
 * @param {Function} params.onProgress - Progress callback (0-1)
 * @returns {Promise<{uploaded: number, skipped: number, failed: number}>}
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

  // Reset progress tracking for this new operation
  resetProgressTracking();
  
  onProgress(0);
  onStatus('Preparing backup...');

  const config = await getAuthHeaders();
  const SERVER_URL = getServerUrl();
  
  // Yield to UI
  await new Promise(r => setTimeout(r, 16));
  onStatus('Checking permissions...');

  const allowed = await ensureStealthCloudUploadAllowed();
  if (!allowed) {
    return { uploaded: 0, skipped: 0, failed: 0, notAllowed: true };
  }
  
  // Yield to UI
  await new Promise(r => setTimeout(r, 16));
  onStatus('Loading encryption key...');

  const masterKey = await getStealthCloudMasterKey();
  
  // Yield to UI
  await new Promise(r => setTimeout(r, 16));
  onStatus('Fetching server state...');
  onProgress(0.01);

  let existingManifests = [];
  try {
    existingManifests = await fetchAllManifestsPaged(SERVER_URL, config, (fetched, total) => {
      // Progress fills 1-4% during fetch (proportional to fetched/total)
      const fetchProgress = total > 0 ? (fetched / total) * 0.03 : 0;
      throttledProgress(onProgress, 0.01 + fetchProgress);
      throttledStatus(onStatus, `Fetching ${fetched}${total > fetched ? ` of ${total}` : ''} server files...`);
    });
  } catch (e) {
    existingManifests = [];
  }
  onProgress(0.04);
  const already = new Set(existingManifests.map(m => m.manifestId));
  
  const totalCount = list.length;
  
  // Calculate proportional progress split based on file counts
  const analyzeWeight = existingManifests.length * 1;
  const backupWeight = totalCount * 10;
  const totalWeight = analyzeWeight + backupWeight;
  const analyzePhaseEnd = totalWeight > 0 ? Math.min(0.4, Math.max(0.05, analyzeWeight / totalWeight)) : 0;
  
  // Phase: Analyzing server files (with progress)
  if (existingManifests.length > 0) {
    onStatus(`Analyzing 0 of ${existingManifests.length} server files...`);
    onProgress(0);
  }

  const dedupSets = await buildDeduplicationSets(
    existingManifests, 
    SERVER_URL, 
    config, 
    masterKey,
    // Progress callback for analyzing phase (0 to analyzePhaseEnd)
    (p) => onProgress(p * analyzePhaseEnd),
    (msg) => onStatus(msg)
  );

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  const hasServerFiles = existingManifests.length > 0;
  const shouldSkipDeduplication = !hasServerFiles;

  // Session-level hash tracking to catch duplicates across the ENTIRE backup operation
  const sessionFileHashes = new Set();
  const sessionPerceptualHashes = new Set();

  if (shouldSkipDeduplication) {
    console.log('StealthCloud: No server files found - will still check for duplicates across entire operation');
  }

  // Transition to backup phase
  const backupPhaseStart = analyzePhaseEnd;
  const backupPhaseRange = 1.0 - analyzePhaseEnd;
  onStatus(`Backing up 0 of ${totalCount}`);
  onProgress(analyzePhaseEnd);
  await new Promise(r => setTimeout(r, 16));

  for (let j = 0; j < list.length; j++) {
    // Check abort signal
    if (abortRef && abortRef.current) {
      console.log('StealthCloud backup selected aborted by user');
      return { uploaded, skipped, failed, aborted: true };
    }

    const asset = list[j];
    const processedIndex = j + 1;

    if (ensureAutoUploadPolicyAllowsWorkIfBackgrounded && !(await ensureAutoUploadPolicyAllowsWorkIfBackgrounded())) {
      break;
    }

    try {
      // Throttle UI updates to prevent render thrashing
      // Progress: backupPhaseStart to 1.0 (proportional to file counts)
      throttledStatus(onStatus, `Backing up ${processedIndex} of ${totalCount}`);
      throttledProgress(onProgress, backupPhaseStart + (processedIndex / totalCount) * backupPhaseRange);

      // Yield to UI thread every few assets to keep UI responsive
      if (processedIndex % 3 === 0) await yieldToUi();

      const result = await uploadSingleAssetToStealthCloud({
        asset, config, SERVER_URL, masterKey, already, dedupSets, shouldSkipDeduplication, fastMode,
        processedIndex, totalCount, onStatus, onProgress, sessionFileHashes, sessionPerceptualHashes
      });

      uploaded += result.uploaded;
      skipped += result.skipped;
      failed += result.failed;

      if (result.uploaded > 0) {
        const assetCooldown = getThrottleAssetCooldownMs(fastMode);
        if (assetCooldown > 0) await sleep(assetCooldown);

        const batchLimit = getThrottleBatchLimit(fastMode);
        if (uploaded > 0 && uploaded % batchLimit === 0) {
          await thermalCooldownPause(Math.floor(uploaded / batchLimit), fastMode, onStatus);
        }
      }
    } catch (e) {
      failed += 1;
      console.warn('StealthCloud asset failed:', asset?.id || 'unknown', e?.message || String(e));
    }
  }

  return { uploaded, skipped, failed };
};

// ============================================================================
// EXPORTS
// ============================================================================

export {
  waitForIosActive,
  buildDeduplicationSets,
  uploadSingleAssetToStealthCloud,
  getThrottleAssetCooldownMs,
  getThrottleBatchLimit,
  getThrottleBatchCooldownMs,
  thermalCooldownPause,
  throttleEncryption,
  yieldToUi,
};
