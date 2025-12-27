// SyncManager - Handles sync/restore operations for Local, Remote, and StealthCloud
// Supports both "Sync All" and "Choose Files" modes

import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import axios from 'axios';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

import {
  sleep,
  withRetries,
  shouldRetryChunkUpload,
  makeChunkNonce,
  normalizeFilenameForCompare,
  normalizeFilePath,
} from './utils';

import {
  chooseStealthCloudMaxParallelChunkUploads,
} from './backgroundTask';

// ============================================================================
// CONSTANTS
// ============================================================================

// Throttle settings (matching App.js)
const getThrottleAssetCooldownMs = (fastMode) => fastMode ? 0 : (Platform.OS === 'ios' ? 300 : 200);
const getThrottleBatchLimit = (fastMode) => fastMode ? 100 : (Platform.OS === 'ios' ? 25 : 30);
const getThrottleBatchCooldownMs = (fastMode) => fastMode ? 0 : (Platform.OS === 'ios' ? 3000 : 2000);
const getThrottleChunkCooldownMs = (fastMode) => fastMode ? 0 : (Platform.OS === 'ios' ? 100 : 50);

const throttleEncryption = async (chunkIndex, fastMode) => {
  const chunkCooldown = getThrottleChunkCooldownMs(fastMode);
  if (chunkCooldown <= 0) return;
  if (chunkIndex > 0 && chunkIndex % 4 === 0) {
    await sleep(chunkCooldown);
  }
};

const thermalCooldownPause = async (batchCount, fastMode) => {
  const cooldownMs = getThrottleBatchCooldownMs(fastMode);
  if (cooldownMs <= 0) return;
  await sleep(cooldownMs);
};

// ============================================================================
// STEALTHCLOUD RESTORE (Sync from Cloud)
// ============================================================================

/**
 * Restores photos from StealthCloud to device gallery.
 * Downloads encrypted chunks, decrypts them, and saves to media library.
 * 
 * @param {Object} params
 * @param {Object} params.config - Auth headers config
 * @param {string} params.SERVER_URL - Server URL
 * @param {Uint8Array} params.masterKey - StealthCloud master key
 * @param {Set} params.localFilenames - Set of normalized filenames already on device
 * @param {Set} params.restoreHistory - Set of already restored history keys
 * @param {Function} params.saveRestoreHistory - Function to persist restore history
 * @param {Function} params.makeHistoryKey - Function to create history key
 * @param {Array<string>|null} params.manifestIds - Optional list of specific manifests to restore
 * @param {boolean} params.fastMode - Whether fast mode is enabled
 * @param {Function} params.onStatus - Callback for status updates
 * @param {Function} params.onProgress - Callback for progress updates (0-1)
 * @returns {Promise<{restored: number, skipped: number, failed: number}>}
 */
export const stealthCloudRestoreCore = async ({
  config,
  SERVER_URL,
  masterKey,
  localFilenames,
  restoreHistory,
  saveRestoreHistory,
  makeHistoryKey,
  manifestIds = null,
  fastMode = false,
  onStatus = () => {},
  onProgress = () => {},
}) => {
  const shouldRetryRestoreDownload = (e) => {
    const msg = (e && e.message ? e.message : '').toLowerCase();
    if (msg.includes(' 404') || msg.includes('not found')) return false;
    return shouldRetryChunkUpload(e);
  };

  onStatus('Checking server files...');
  const listRes = await withRetries(async () => {
    return await axios.get(`${SERVER_URL}/api/cloud/manifests`, { headers: config.headers, timeout: 30000 });
  }, {
    retries: 10,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    shouldRetry: shouldRetryRestoreDownload
  });

  let manifests = (listRes.data && listRes.data.manifests) ? listRes.data.manifests : [];
  console.log(`SyncManager: fetched ${manifests.length} manifests from server`);

  // Filter to specific manifests if provided (Choose Files mode)
  if (manifestIds && Array.isArray(manifestIds) && manifestIds.length > 0) {
    const allowed = new Set(manifestIds.map(v => String(v)));
    manifests = manifests.filter(m => m && m.manifestId && allowed.has(String(m.manifestId)));
  }

  if (manifests.length === 0) {
    return { restored: 0, skipped: 0, failed: 0, noBackups: true };
  }

  onStatus('Comparing local files...');
  onProgress(0);

  let restored = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < manifests.length; i++) {
    const mid = manifests[i].manifestId;
    
    try {
      const manRes = await withRetries(async () => {
        return await axios.get(`${SERVER_URL}/api/cloud/manifests/${mid}`, { headers: config.headers, timeout: 30000 });
      }, {
        retries: 10,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        shouldRetry: shouldRetryRestoreDownload
      });

      const payload = manRes.data;
      const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
      const enc = JSON.parse(parsed.encryptedManifest);
      const manifestNonce = naclUtil.decodeBase64(enc.manifestNonce);
      const manifestBox = naclUtil.decodeBase64(enc.manifestBox);
      const manifestPlain = nacl.secretbox.open(manifestBox, manifestNonce, masterKey);
      
      if (!manifestPlain) {
        failed++;
        onProgress((i + 1) / manifests.length);
        continue;
      }

      const manifest = JSON.parse(naclUtil.encodeUTF8(manifestPlain));

      const filename = manifest.filename || `${mid}.bin`;
      const normalizedFilename = normalizeFilenameForCompare(filename);
      const historyKey = makeHistoryKey('sc', mid);
      const alreadyRestored = restoreHistory.has(historyKey);
      
      if ((normalizedFilename && localFilenames.has(normalizedFilename)) || alreadyRestored) {
        skipped++;
        onProgress((i + 1) / manifests.length);
        continue;
      }

      const wrapNonce = naclUtil.decodeBase64(manifest.wrapNonce);
      const wrappedFileKey = naclUtil.decodeBase64(manifest.wrappedFileKey);
      const fileKey = nacl.secretbox.open(wrappedFileKey, wrapNonce, masterKey);
      
      if (!fileKey) {
        failed++;
        onProgress((i + 1) / manifests.length);
        continue;
      }

      const baseNonce16 = naclUtil.decodeBase64(manifest.baseNonce16);

      // Reconstruct plaintext to a temp file (append per chunk)
      const outUri = `${FileSystem.cacheDirectory}sc_restore_${filename}`;
      const outPath = normalizeFilePath(outUri);
      await FileSystem.deleteAsync(outUri, { idempotent: true });
      await FileSystem.writeAsStringAsync(outUri, '', { encoding: FileSystem.EncodingType.Base64 });

      let ReactNativeBlobUtil = null;
      try {
        const mod = require('react-native-blob-util');
        ReactNativeBlobUtil = mod && (mod.default || mod);
      } catch (e) {
        ReactNativeBlobUtil = null;
      }
      
      if (!ReactNativeBlobUtil || !ReactNativeBlobUtil.fs || typeof ReactNativeBlobUtil.fs.appendFile !== 'function') {
        throw new Error('StealthCloud restore requires a development build (react-native-blob-util).');
      }

      // Download chunks concurrently, then decrypt+append in order
      const restoreOriginalSize = typeof manifest.originalSize === 'number'
        ? manifest.originalSize
        : (manifest.originalSize ? Number(manifest.originalSize) : (manifest.size ? Number(manifest.size) : null));
      const restorePlatform = Platform.OS === 'android' ? 'android' : 'ios';
      const maxParallel = Math.max(1, chooseStealthCloudMaxParallelChunkUploads({
        platform: restorePlatform,
        originalSize: restoreOriginalSize,
        fastMode
      }));

      const downloadChunk = async (chunkIndex) => {
        const chunkId = manifest.chunkIds[chunkIndex];
        const tmpChunkPath = `${FileSystem.cacheDirectory}sc_dl_${chunkId}.bin`;
        await FileSystem.deleteAsync(tmpChunkPath, { idempotent: true });
        await withRetries(async () => {
          await FileSystem.downloadAsync(`${SERVER_URL}/api/cloud/chunks/${chunkId}`, tmpChunkPath, { headers: config.headers });
        }, { retries: 10, baseDelayMs: 1000, maxDelayMs: 30000, shouldRetry: shouldRetryRestoreDownload });
        const chunkB64 = await FileSystem.readAsStringAsync(tmpChunkPath, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.deleteAsync(tmpChunkPath, { idempotent: true });
        return chunkB64;
      };

      onStatus(`Downloading ${i + 1}/${manifests.length}`);

      for (let batchStart = 0; batchStart < manifest.chunkIds.length; batchStart += maxParallel) {
        const batchEnd = Math.min(batchStart + maxParallel, manifest.chunkIds.length);
        const batchMap = new Map();

        const batchPromises = [];
        for (let c = batchStart; c < batchEnd; c++) {
          batchPromises.push(
            (async () => {
              const chunkB64 = await downloadChunk(c);
              batchMap.set(c, chunkB64);
            })()
          );
        }
        await Promise.all(batchPromises);

        // Decrypt and append this batch in order
        for (let c = batchStart; c < batchEnd; c++) {
          const chunkB64 = batchMap.get(c);
          const boxed = naclUtil.decodeBase64(chunkB64);
          const nonce = makeChunkNonce(baseNonce16, c);
          await throttleEncryption(c, fastMode);
          const plaintext = nacl.secretbox.open(boxed, nonce, fileKey);
          if (!plaintext) throw new Error('Chunk decrypt failed');

          const p64 = naclUtil.encodeBase64(plaintext);
          await ReactNativeBlobUtil.fs.appendFile(outPath, p64, 'base64');
        }
      }

      await MediaLibrary.saveToLibraryAsync(outUri);
      await FileSystem.deleteAsync(outUri, { idempotent: true });
      restored++;
      
      if (normalizedFilename) {
        localFilenames.add(normalizedFilename);
      }
      restoreHistory.add(historyKey);
      await saveRestoreHistory(restoreHistory);
      onProgress((i + 1) / manifests.length);

      // CPU cooldown between files
      const assetCooldown = getThrottleAssetCooldownMs(fastMode);
      if (assetCooldown > 0) await sleep(assetCooldown);

      // Thermal batch limit
      const batchLimit = getThrottleBatchLimit(fastMode);
      if (restored > 0 && restored % batchLimit === 0) {
        await thermalCooldownPause(Math.floor(restored / batchLimit), fastMode);
      }
    } catch (e) {
      console.warn('StealthCloud restore failed for manifest:', mid, e?.message);
      failed++;
      onProgress((i + 1) / manifests.length);
    }
  }

  return { restored, skipped, failed, noBackups: false };
};

// ============================================================================
// LOCAL/REMOTE RESTORE (Sync from Server)
// ============================================================================

/**
 * Restores photos from Local/Remote server to device gallery.
 * Downloads files and saves to media library.
 * 
 * @param {Object} params
 * @param {Object} params.config - Auth headers config
 * @param {string} params.SERVER_URL - Server URL
 * @param {Set} params.localFilenames - Set of normalized filenames already on device
 * @param {Array<string>|null} params.onlyFilenames - Optional list of specific filenames to restore
 * @param {Function} params.onStatus - Callback for status updates
 * @param {Function} params.onProgress - Callback for progress updates (0-1)
 * @returns {Promise<{restored: number, skipped: number, failed: number, serverTotal: number}>}
 */
export const localRemoteRestoreCore = async ({
  config,
  SERVER_URL,
  localFilenames,
  onlyFilenames = null,
  onStatus = () => {},
  onProgress = () => {},
}) => {
  onStatus('Checking server files...');
  
  const serverRes = await axios.get(`${SERVER_URL}/api/files`, config);
  let serverFiles = serverRes.data.files || [];

  // Filter to specific filenames if provided (Choose Files mode)
  if (onlyFilenames && Array.isArray(onlyFilenames) && onlyFilenames.length > 0) {
    const allowed = new Set(onlyFilenames.map(v => normalizeFilenameForCompare(v)).filter(Boolean));
    serverFiles = serverFiles.filter(f => {
      const nf = normalizeFilenameForCompare(f && f.filename ? f.filename : null);
      return nf ? allowed.has(nf) : false;
    });
  }

  console.log(`☁️  Server has ${serverFiles.length} files`);

  if (serverFiles.length === 0) {
    return { restored: 0, skipped: 0, failed: 0, serverTotal: 0, noFiles: true };
  }

  // Filter out files that already exist locally
  const toDownload = serverFiles.filter(f => {
    const normalizedFilename = normalizeFilenameForCompare(f && f.filename ? f.filename : null);
    const exists = normalizedFilename ? localFilenames.has(normalizedFilename) : false;
    if (exists) {
      console.log(`✓ Skipping ${f.filename} - already exists locally`);
    }
    return !exists;
  });

  const skippedCount = serverFiles.length - toDownload.length;
  console.log(`📊 To download: ${toDownload.length}, Skipped: ${skippedCount}`);

  if (toDownload.length === 0) {
    return { restored: 0, skipped: skippedCount, failed: 0, serverTotal: serverFiles.length, allSynced: true };
  }

  onStatus(`Downloading ${toDownload.length} files...`);
  onProgress(0);

  let successCount = 0;
  const downloadedUris = [];

  for (let i = 0; i < toDownload.length; i++) {
    const file = toDownload[i];
    try {
      onStatus(`Downloading ${i + 1}/${toDownload.length}: ${file.filename}`);
      
      const downloadUrl = `${SERVER_URL}/api/files/${encodeURIComponent(file.filename)}`;
      const localUri = `${FileSystem.cacheDirectory}${file.filename}`;
      
      await FileSystem.deleteAsync(localUri, { idempotent: true });
      
      const downloadResult = await FileSystem.downloadAsync(downloadUrl, localUri, {
        headers: config.headers
      });

      if (downloadResult.status === 200) {
        await MediaLibrary.saveToLibraryAsync(localUri);
        await FileSystem.deleteAsync(localUri, { idempotent: true });
        downloadedUris.push(localUri);
        successCount++;
        
        // Add to local filenames to prevent re-download in same session
        const normalizedFilename = normalizeFilenameForCompare(file.filename);
        if (normalizedFilename) {
          localFilenames.add(normalizedFilename);
        }
      } else {
        console.warn(`Download failed for ${file.filename}: HTTP ${downloadResult.status}`);
      }
      
      onProgress((i + 1) / toDownload.length);
    } catch (e) {
      console.warn(`Failed to download ${file.filename}:`, e?.message);
    }
  }

  const failedCount = toDownload.length - successCount;
  
  return { 
    restored: successCount, 
    skipped: skippedCount, 
    failed: failedCount, 
    serverTotal: serverFiles.length,
    noFiles: false,
    allSynced: false
  };
};

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  stealthCloudRestoreCore,
  localRemoteRestoreCore,
};
