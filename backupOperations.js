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

const yieldToUi = () => new Promise(r => setTimeout(r, 0));

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
const buildDeduplicationSets = async (existingManifests, SERVER_URL, config, masterKey) => {
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
    for (const m of existingManifests) {
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
      }
    }
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
const computeAssetHashes = async ({ asset, assetInfo, assetFilename, filePath, isImage, shouldSkipDeduplication, dedupSets }) => {
  let exactFileHash = null;
  let perceptualHash = null;
  const { alreadyFileHashes, alreadyPerceptualHashes } = dedupSets;

  if (!shouldSkipDeduplication) {
    if (isImage) {
      try {
        perceptualHash = await computePerceptualHash(filePath, asset, assetInfo);
        if (perceptualHash) {
          console.log(`[PerceptualHash] ${assetFilename}: ${perceptualHash} (${perceptualHash.length} chars)`);
        }
      } catch (e) {
        console.warn('computePerceptualHash failed:', asset.id, e?.message);
      }

      if (perceptualHash && findPerceptualHashMatch(perceptualHash, alreadyPerceptualHashes, CROSS_PLATFORM_DHASH_THRESHOLD)) {
        return { skip: true, reason: 'perceptualHash' };
      }

      try {
        exactFileHash = await computeExactFileHash(filePath);
      } catch (e) {
        console.warn('computeExactFileHash failed:', asset.id, e?.message);
      }
    } else {
      try {
        exactFileHash = await computeExactFileHash(filePath);
        console.log(`[FileHash] ${assetFilename}: ${exactFileHash ? exactFileHash.substring(0, 16) + '...' : 'null'}`);
      } catch (e) {
        console.warn('computeExactFileHash failed:', asset.id, e?.message);
      }

      if (exactFileHash && alreadyFileHashes.has(exactFileHash)) {
        console.log(`Skipping ${assetFilename} - exact file hash already on server`);
        return { skip: true, reason: 'fileHash' };
      }
    }
  }

  // Always compute hashes for manifest storage
  if (shouldSkipDeduplication) {
    if (isImage) {
      try {
        perceptualHash = await computePerceptualHash(filePath, asset, assetInfo);
      } catch (e) {}
      try {
        exactFileHash = await computeExactFileHash(filePath);
      } catch (e) {}
    } else {
      try {
        exactFileHash = await computeExactFileHash(filePath);
      } catch (e) {}
    }
  }

  return { skip: false, exactFileHash, perceptualHash };
};

// Upload a single asset to StealthCloud
const uploadSingleAssetToStealthCloud = async ({
  asset, config, SERVER_URL, masterKey, already, dedupSets, shouldSkipDeduplication, fastMode,
  processedIndex, totalCount, onStatus, onProgress
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

  // Check deduplication
  const skipResult = await shouldSkipAsset({
    asset, assetInfo, assetFilename, originalSize, manifestId, already, dedupSets, shouldSkipDeduplication, filePath, tmpCopied, tmpUri
  });
  if (skipResult.skip) {
    return { uploaded: 0, skipped: 1, failed: 0 };
  }

  const isImage = asset.mediaType === 'photo' || (assetInfo && assetInfo.mediaType === 'photo');

  // Compute hashes
  const hashResult = await computeAssetHashes({
    asset, assetInfo, assetFilename, filePath, isImage, shouldSkipDeduplication, dedupSets
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

      if (totalCount && onProgress) {
        const fileProgress = (processedIndex - 1) / totalCount;
        const chunkProgress = originalSize ? (position / originalSize) / totalCount : 0;
        onProgress(Math.min(fileProgress + chunkProgress, 1));
      }

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
              if (totalCount && onProgress) onProgress(processedIndex / totalCount);
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
      { manifestId, encryptedManifest, chunkCount: chunkIds.length },
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

  onProgress(0);
  onStatus('Preparing backup...');

  const config = await getAuthHeaders();
  const SERVER_URL = getServerUrl();

  const allowed = await ensureStealthCloudUploadAllowed();
  if (!allowed) {
    return { uploaded: 0, skipped: 0, failed: 0, notAllowed: true };
  }

  const masterKey = await getStealthCloudMasterKey();

  let existingManifests = [];
  try {
    existingManifests = await fetchAllManifestsPaged(SERVER_URL, config);
  } catch (e) {
    existingManifests = [];
  }
  const already = new Set(existingManifests.map(m => m.manifestId));

  const dedupSets = await buildDeduplicationSets(existingManifests, SERVER_URL, config, masterKey);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  const hasServerFiles = existingManifests.length > 0;
  const shouldSkipDeduplication = !hasServerFiles;

  if (shouldSkipDeduplication) {
    console.log('StealthCloud: No server files found - skipping deduplication checks for faster upload');
  }

  const PAGE_SIZE = 250;
  let after = null;
  let totalCount = null;
  let processedIndex = 0;

  const mediaTypeQuery = Platform.OS === 'ios'
    ? [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video]
    : ['photo', 'video'];
  const sortByQuery = Platform.OS === 'ios'
    ? [MediaLibrary.SortBy.creationTime]
    : undefined;

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
      if (processedIndex === 0) {
        return { uploaded: 0, skipped: 0, failed: 0, noFiles: true };
      }
      break;
    }

    for (let j = 0; j < assets.length; j++) {
      // Check abort signal
      if (abortRef && abortRef.current) {
        console.log('StealthCloud backup aborted by user');
        return { uploaded, skipped, failed, aborted: true };
      }

      const asset = assets[j];
      processedIndex += 1;

      if (ensureAutoUploadPolicyAllowsWorkIfBackgrounded && !(await ensureAutoUploadPolicyAllowsWorkIfBackgrounded())) {
        break;
      }

      try {
        onStatus(`Backing up ${processedIndex} of ${totalCount || '?'}`);
        if (totalCount) onProgress(processedIndex / totalCount);

        const result = await uploadSingleAssetToStealthCloud({
          asset, config, SERVER_URL, masterKey, already, dedupSets, shouldSkipDeduplication, fastMode,
          processedIndex, totalCount, onStatus, onProgress
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

    after = page && page.endCursor ? page.endCursor : null;
    if (!page || page.hasNextPage !== true) break;
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

  onProgress(0);
  onStatus('Preparing backup...');

  const config = await getAuthHeaders();
  const SERVER_URL = getServerUrl();

  const allowed = await ensureStealthCloudUploadAllowed();
  if (!allowed) {
    return { uploaded: 0, skipped: 0, failed: 0, notAllowed: true };
  }

  const masterKey = await getStealthCloudMasterKey();

  let existingManifests = [];
  try {
    existingManifests = await fetchAllManifestsPaged(SERVER_URL, config);
  } catch (e) {
    existingManifests = [];
  }
  const already = new Set(existingManifests.map(m => m.manifestId));

  // Build deduplication sets with progress for iOS
  if (Platform.OS === 'ios' && existingManifests.length > 0) {
    onStatus('Analyzing existing files...');
  }
  const dedupSets = await buildDeduplicationSets(existingManifests, SERVER_URL, config, masterKey);
  if (Platform.OS === 'ios') {
    onProgress(0);
  }

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  const totalCount = list.length;
  const hasServerFiles = existingManifests.length > 0;
  const shouldSkipDeduplication = !hasServerFiles;

  if (shouldSkipDeduplication) {
    console.log('StealthCloud: No server files found - skipping deduplication checks for faster upload');
  }

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
      onStatus(`Backing up ${processedIndex} of ${totalCount}`);
      onProgress((processedIndex - 1) / totalCount);

      const result = await uploadSingleAssetToStealthCloud({
        asset, config, SERVER_URL, masterKey, already, dedupSets, shouldSkipDeduplication, fastMode,
        processedIndex, totalCount, onStatus, onProgress
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
