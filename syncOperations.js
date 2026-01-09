/**
 * syncOperations.js - Optimized Sync/Restore Operations
 * 
 * Handles sync/restore operations for StealthCloud and Local/Remote servers.
 * Features:
 * - Proper phased progress (fetch server, scan local, analyze, download)
 * - Per-file status messages
 * - UI yielding with requestAnimationFrame
 * - Handles 100s to 10000s of files efficiently
 * - Uses server-side hash metadata for fast deduplication (no decrypt needed)
 * - Proper temp/cache cleanup
 * - No race conditions (sequential analysis, parallel downloads with limits)
 */

import { Platform, AppState, InteractionManager } from 'react-native';
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
  normalizeFilePath,
  computeFileIdentity,
} from './utils';

import {
  computeExactFileHash,
  computePerceptualHash,
  findPerceptualHashMatch,
  extractBaseFilename,
  normalizeDateForCompare,
  CROSS_PLATFORM_DHASH_THRESHOLD,
} from './duplicateScanner';

import {
  chooseStealthCloudMaxParallelChunkUploads,
  createConcurrencyLimiter,
} from './backgroundTask';

import { getMediaLibraryAccessPrivileges } from './autoUpload';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const PROGRESS_THROTTLE_MS = 200; // Slower updates to reduce UI load
const PAGE_SIZE = 250; // Assets per page when scanning

// Throttle settings for thermal management
const getAssetCooldownMs = (fastMode) => fastMode ? 0 : (Platform.OS === 'ios' ? 300 : 200);
const getBatchLimit = (fastMode) => fastMode ? 100 : 25;
const getBatchCooldownMs = (fastMode) => fastMode ? 0 : 5000;

// Concurrency limits for downloads
const getMaxParallelDownloads = (fastMode) => {
  if (fastMode) {
    return Platform.OS === 'android' ? 8 : 6;
  }
  return Platform.OS === 'android' ? 4 : 3;
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

// ============================================================================
// UI YIELDING
// ============================================================================

// Yield to UI - use requestAnimationFrame for true frame-based yielding
const yieldToUi = () => new Promise(resolve => {
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => resolve());
  } else {
    setTimeout(resolve, 16);
  }
});

// Quick yield for inside tight loops
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
 * Fetch all StealthCloud manifests with metadata (no decryption needed for dedup)
 * Uses ?meta=true to get filename, size, hashes in single request
 */
const fetchManifestsWithMeta = async (serverUrl, config, onProgress) => {
  const PAGE_LIMIT = 500;
  const allManifests = [];
  let offset = 0;
  let estimatedTotal = null;

  while (true) {
    const response = await axios.get(`${serverUrl}/api/cloud/manifests`, {
      ...config,
      params: { offset, limit: PAGE_LIMIT, meta: true }
    });

    const manifests = response.data?.manifests || [];
    allManifests.push(...manifests);

    if (estimatedTotal === null && typeof response.data?.total === 'number') {
      estimatedTotal = response.data.total;
    }

    if (onProgress) {
      onProgress(allManifests.length, estimatedTotal || allManifests.length);
    }

    if (!manifests || manifests.length < PAGE_LIMIT) break;
    offset += manifests.length;
    if (typeof estimatedTotal === 'number' && offset >= estimatedTotal) break;
    
    await quickYield();
  }

  return allManifests;
};

/**
 * Fetch all Local/Remote server files with pagination
 */
const fetchServerFilesPaged = async (serverUrl, config, onProgress) => {
  const PAGE_LIMIT = 500;
  const allFiles = [];
  let offset = 0;
  let estimatedTotal = null;

  while (true) {
    const response = await axios.get(`${serverUrl}/api/files`, {
      ...config,
      params: { offset, limit: PAGE_LIMIT }
    });

    const files = response.data?.files || [];
    allFiles.push(...files);

    if (estimatedTotal === null && typeof response.data?.total === 'number') {
      estimatedTotal = response.data.total;
    }

    if (onProgress) {
      onProgress(allFiles.length, estimatedTotal || allFiles.length);
    }

    if (!files || files.length < PAGE_LIMIT) break;
    offset += files.length;
    if (typeof estimatedTotal === 'number' && offset >= estimatedTotal) break;
    
    await quickYield();
  }

  return allFiles;
};

// ============================================================================
// DEDUPLICATION HELPERS
// ============================================================================

/**
 * Build dedup sets from server manifests metadata (instant, no decryption)
 */
const buildDedupSetsFromServerMeta = (manifests) => {
  const manifestIds = new Set();
  const filenames = new Set();
  const fileHashes = new Set();
  const perceptualHashes = new Set();
  const baseNameSizes = new Map();
  const baseNameDates = new Map();

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
        }
      }
    }
    
    if (m.fileHash) fileHashes.add(m.fileHash);
    if (m.perceptualHash) perceptualHashes.add(m.perceptualHash);
  }

  return { manifestIds, filenames, fileHashes, perceptualHashes, baseNameSizes, baseNameDates };
};

/**
 * Check if a server file should be skipped (already exists locally)
 */
const shouldSkipServerFile = (serverFile, localSets) => {
  const { manifestId, filename, fileHash, perceptualHash, originalSize, creationTime } = serverFile;
  
  // Check by manifestId
  if (manifestId && localSets.manifestIds.has(manifestId)) {
    return { skip: true, reason: 'manifestId' };
  }
  
  // Check by filename
  const normalized = filename ? normalizeFilenameForCompare(filename) : null;
  if (normalized && localSets.filenames.has(normalized)) {
    return { skip: true, reason: 'filename' };
  }
  
  // Check by file hash (videos)
  if (fileHash && localSets.fileHashes.has(fileHash)) {
    return { skip: true, reason: 'fileHash' };
  }
  
  // Check by perceptual hash (images)
  if (perceptualHash && localSets.perceptualHashes.size > 0) {
    if (findPerceptualHashMatch(perceptualHash, localSets.perceptualHashes, CROSS_PLATFORM_DHASH_THRESHOLD)) {
      return { skip: true, reason: 'perceptualHash' };
    }
  }
  
  // Fallback: base filename + size
  const baseName = filename ? extractBaseFilename(filename) : null;
  if (baseName && originalSize && localSets.baseNameSizes.has(baseName)) {
    const existingSizes = localSets.baseNameSizes.get(baseName);
    for (const existingSize of existingSizes) {
      const sizeDiff = Math.abs(originalSize - existingSize) / Math.max(originalSize, existingSize);
      if (sizeDiff < 0.20) {
        return { skip: true, reason: 'baseNameSize' };
      }
    }
  }
  
  // Fallback: base filename + date
  if (baseName && creationTime && localSets.baseNameDates.has(baseName)) {
    const dateStr = normalizeDateForCompare(creationTime);
    if (dateStr && localSets.baseNameDates.get(baseName).has(dateStr)) {
      return { skip: true, reason: 'baseNameDate' };
    }
  }
  
  return { skip: false };
};

// ============================================================================
// LOCAL DEVICE SCANNING
// ============================================================================

/**
 * Scan local device photos and build dedup sets
 * Optimized with parallel processing and proper yielding
 */
const scanLocalPhotosForDedup = async (onStatus, onProgress, progressStart, progressEnd) => {
  const localSets = {
    manifestIds: new Set(),
    filenames: new Set(),
    fileHashes: new Set(),
    perceptualHashes: new Set(),
    baseNameSizes: new Map(),
    baseNameDates: new Map(),
  };

  const mediaTypeQuery = Platform.OS === 'ios'
    ? [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video]
    : ['photo', 'video'];

  let after = null;
  let totalCount = null;
  let scanned = 0;

  while (true) {
    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      after: after || undefined,
      mediaType: mediaTypeQuery,
    });

    if (totalCount === null && page?.totalCount) {
      totalCount = page.totalCount;
    }

    const assets = page?.assets || [];
    if (assets.length === 0) break;

    for (const asset of assets) {
      scanned++;
      
      // Get filename
      let filename = asset.filename;
      if (Platform.OS === 'ios') {
        try {
          const info = await MediaLibrary.getAssetInfoAsync(asset.id);
          filename = info?.filename || filename;
        } catch (e) {}
      }
      
      if (filename) {
        const normalized = normalizeFilenameForCompare(filename);
        if (normalized) localSets.filenames.add(normalized);
        
        // Compute manifestId (filename + size)
        const fileSize = asset.fileSize || null;
        if (fileSize) {
          const fileIdentity = computeFileIdentity(filename, fileSize);
          if (fileIdentity) {
            const manifestId = sha256(`file:${fileIdentity}`);
            localSets.manifestIds.add(manifestId);
          }
          
          // Base name + size
          const baseName = extractBaseFilename(filename);
          if (baseName) {
            if (!localSets.baseNameSizes.has(baseName)) localSets.baseNameSizes.set(baseName, new Set());
            localSets.baseNameSizes.get(baseName).add(fileSize);
            
            // Base name + date
            if (asset.creationTime) {
              const dateStr = normalizeDateForCompare(asset.creationTime);
              if (dateStr) {
                if (!localSets.baseNameDates.has(baseName)) localSets.baseNameDates.set(baseName, new Set());
                localSets.baseNameDates.get(baseName).add(dateStr);
              }
            }
          }
        }
      }
      
      // Progress update
      if (scanned % 50 === 0 || scanned === totalCount) {
        const progress = progressStart + (scanned / (totalCount || scanned)) * (progressEnd - progressStart);
        updateProgress(onProgress, progress);
        updateStatus(onStatus, `Scanning ${scanned} of ${totalCount || '?'} local photos...`);
        await quickYield();
      }
    }

    after = page?.endCursor;
    if (!page?.hasNextPage) break;
    await quickYield();
  }

  console.log(`[Sync] Local scan: ${localSets.filenames.size} filenames, ${localSets.manifestIds.size} manifestIds`);
  return localSets;
};

/**
 * Build full local dedup index with hashes (for StealthCloud restore)
 * This is slower but more accurate - computes actual file/perceptual hashes
 */
const buildLocalHashIndex = async (resolveReadableFilePath, onStatus, onProgress, progressStart, progressEnd) => {
  const localSets = {
    manifestIds: new Set(),
    filenames: new Set(),
    fileHashes: new Set(),
    perceptualHashes: new Set(),
    baseNameSizes: new Map(),
    baseNameDates: new Map(),
  };

  const mediaTypeQuery = Platform.OS === 'ios'
    ? [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video]
    : ['photo', 'video'];

  let after = null;
  let totalCount = null;
  let scanned = 0;

  while (true) {
    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      after: after || undefined,
      mediaType: mediaTypeQuery,
    });

    if (totalCount === null && page?.totalCount) {
      totalCount = page.totalCount;
    }

    const assets = page?.assets || [];
    if (assets.length === 0) break;

    for (const asset of assets) {
      scanned++;
      
      try {
        const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
        const filename = assetInfo?.filename || asset.filename;
        
        if (filename) {
          const normalized = normalizeFilenameForCompare(filename);
          if (normalized) localSets.filenames.add(normalized);
        }
        
        // Get file path for hashing
        const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo });
        const filePath = resolved?.filePath;
        
        if (filePath) {
          // Get file size
          let fileSize = null;
          try {
            const fileUri = filePath.startsWith('/') ? `file://${filePath}` : filePath;
            const info = await FileSystem.getInfoAsync(fileUri);
            fileSize = info?.size || null;
          } catch (e) {}
          
          // Compute manifestId
          if (filename && fileSize) {
            const fileIdentity = computeFileIdentity(filename, fileSize);
            if (fileIdentity) {
              const manifestId = sha256(`file:${fileIdentity}`);
              localSets.manifestIds.add(manifestId);
            }
            
            // Base name + size/date
            const baseName = extractBaseFilename(filename);
            if (baseName) {
              if (!localSets.baseNameSizes.has(baseName)) localSets.baseNameSizes.set(baseName, new Set());
              localSets.baseNameSizes.get(baseName).add(fileSize);
              
              if (asset.creationTime) {
                const dateStr = normalizeDateForCompare(asset.creationTime);
                if (dateStr) {
                  if (!localSets.baseNameDates.has(baseName)) localSets.baseNameDates.set(baseName, new Set());
                  localSets.baseNameDates.get(baseName).add(dateStr);
                }
              }
            }
          }
          
          // Compute hashes (only every 5th file to save time, or if small scan)
          const shouldComputeHash = (totalCount && totalCount < 500) || scanned % 5 === 0;
          if (shouldComputeHash) {
            const isImage = asset.mediaType === 'photo' || asset.mediaType === MediaLibrary.MediaType.photo;
            
            await quickYield();
            
            if (isImage) {
              try {
                const pHash = await computePerceptualHash(filePath, asset, assetInfo);
                if (pHash) localSets.perceptualHashes.add(pHash);
              } catch (e) {}
            } else {
              try {
                const fHash = await computeExactFileHash(filePath);
                if (fHash) localSets.fileHashes.add(fHash);
              } catch (e) {}
            }
          }
        }
        
        // Cleanup temp file if created
        if (resolved?.tmpCopied && resolved?.tmpUri) {
          try {
            await FileSystem.deleteAsync(resolved.tmpUri, { idempotent: true });
          } catch (e) {}
        }
      } catch (e) {
        // Skip failed assets
      }
      
      // Progress update
      if (scanned % 20 === 0 || scanned === totalCount) {
        const progress = progressStart + (scanned / (totalCount || scanned)) * (progressEnd - progressStart);
        updateProgress(onProgress, progress);
        updateStatus(onStatus, `Analyzing ${scanned} of ${totalCount || '?'} local photos...`);
        await quickYield();
      }
    }

    after = page?.endCursor;
    if (!page?.hasNextPage) break;
    await quickYield();
  }

  console.log(`[Sync] Local hash index: ${localSets.filenames.size} filenames, ${localSets.manifestIds.size} manifestIds, ${localSets.perceptualHashes.size} pHashes, ${localSets.fileHashes.size} fHashes`);
  return localSets;
};

// ============================================================================
// STEALTHCLOUD RESTORE
// ============================================================================

/**
 * Optimized StealthCloud restore
 * 
 * Phases:
 * 1. Permissions (0%)
 * 2. Fetch server manifests with metadata (0-5%)
 * 3. Scan local photos for dedup (5-15%)
 * 4. Filter files to download (15-20%)
 * 5. Download, decrypt, save each file (20-100%)
 */
export const stealthCloudRestoreCore = async ({
  config,
  SERVER_URL,
  masterKey,
  resolveReadableFilePath,
  restoreHistory,
  saveRestoreHistory,
  makeHistoryKey,
  manifestIds = null, // Optional: specific manifests to restore (Choose Files mode)
  fastMode = false,
  onStatus = () => {},
  onProgress = () => {},
  abortRef,
}) => {
  resetProgress();
  
  // ========== PHASE 1: Setup ==========
  onStatus('Preparing sync...');
  onProgress(0);
  await yieldToUi();

  // ========== PHASE 2: Fetch Server Manifests with Metadata (0-5%) ==========
  onStatus('Fetching server files...');
  updateProgress(onProgress, 0.01, true);

  let serverManifests = [];
  try {
    serverManifests = await fetchManifestsWithMeta(SERVER_URL, config, (fetched, total) => {
      const progress = 0.01 + (fetched / (total || fetched)) * 0.04;
      updateProgress(onProgress, progress);
      updateStatus(onStatus, `Fetching ${fetched}${total > fetched ? ` of ${total}` : ''} server files...`);
    });
  } catch (e) {
    console.error('Failed to fetch manifests:', e?.message);
    return { restored: 0, skipped: 0, failed: 0, error: e?.message };
  }

  updateProgress(onProgress, 0.05, true);
  await yieldToUi();

  // Filter to specific manifests if provided
  if (manifestIds && Array.isArray(manifestIds) && manifestIds.length > 0) {
    const allowed = new Set(manifestIds.map(v => String(v)));
    serverManifests = serverManifests.filter(m => m?.manifestId && allowed.has(String(m.manifestId)));
  }

  if (serverManifests.length === 0) {
    onProgress(1);
    return { restored: 0, skipped: 0, failed: 0, noBackups: true };
  }

  onStatus(`Found ${serverManifests.length} server files...`);
  await yieldToUi();

  // ========== PHASE 3: Scan Local Photos (5-15%) ==========
  onStatus('Scanning local photos...');
  updateProgress(onProgress, 0.05, true);

  const localSets = await buildLocalHashIndex(resolveReadableFilePath, onStatus, onProgress, 0.05, 0.15);
  
  updateProgress(onProgress, 0.15, true);
  await yieldToUi();

  // ========== PHASE 4: Filter Files to Download (15-20%) ==========
  onStatus('Comparing files...');
  updateProgress(onProgress, 0.15, true);

  const toDownload = [];
  let skipped = 0;

  for (let i = 0; i < serverManifests.length; i++) {
    const manifest = serverManifests[i];
    
    // Check restore history
    const historyKey = makeHistoryKey('sc', manifest.manifestId);
    if (restoreHistory.has(historyKey)) {
      skipped++;
      continue;
    }
    
    // Check local dedup
    const check = shouldSkipServerFile(manifest, localSets);
    if (check.skip) {
      skipped++;
      continue;
    }
    
    toDownload.push(manifest);
    
    if (i % 100 === 0) {
      const progress = 0.15 + (i / serverManifests.length) * 0.05;
      updateProgress(onProgress, progress);
      updateStatus(onStatus, `Comparing ${i + 1} of ${serverManifests.length} files...`);
      await quickYield();
    }
  }

  updateProgress(onProgress, 0.20, true);
  onStatus(`${toDownload.length} files to sync, ${skipped} already on device`);
  await yieldToUi();

  if (toDownload.length === 0) {
    onProgress(1);
    return { restored: 0, skipped, failed: 0, allSynced: true };
  }

  // ========== PHASE 5: Download Each File (20-100%) ==========
  let restored = 0;
  let failed = 0;
  let historyWrites = 0;

  const shouldRetryDownload = (e) => {
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('404') || msg.includes('not found')) return false;
    return shouldRetryChunkUpload(e);
  };

  for (let i = 0; i < toDownload.length; i++) {
    // Check abort
    if (abortRef?.current) {
      console.log('Sync aborted by user');
      return { restored, skipped, failed, aborted: true };
    }

    const manifest = toDownload[i];
    const fileNum = i + 1;
    const mid = manifest.manifestId;

    // Progress: 20-100%
    const progress = 0.20 + (fileNum / toDownload.length) * 0.80;
    updateProgress(onProgress, progress);
    updateStatus(onStatus, `Syncing ${fileNum} of ${toDownload.length}: ${manifest.filename || 'file'}...`, true);

    // Yield every few files
    if (i % 3 === 0) await yieldToUi();

    try {
      // Fetch full manifest (need encrypted data)
      const manRes = await withRetries(async () => {
        return await axios.get(`${SERVER_URL}/api/cloud/manifests/${mid}`, { 
          headers: config.headers, 
          timeout: 30000 
        });
      }, { retries: 10, baseDelayMs: 1000, maxDelayMs: 30000, shouldRetry: shouldRetryDownload });

      const payload = manRes.data;
      const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
      const enc = JSON.parse(parsed.encryptedManifest);
      
      // Decrypt manifest
      const manifestNonce = naclUtil.decodeBase64(enc.manifestNonce);
      const manifestBox = naclUtil.decodeBase64(enc.manifestBox);
      const manifestPlain = nacl.secretbox.open(manifestBox, manifestNonce, masterKey);
      
      if (!manifestPlain) {
        failed++;
        continue;
      }

      const fullManifest = JSON.parse(naclUtil.encodeUTF8(manifestPlain));
      const filename = fullManifest.filename || `${mid}.bin`;
      
      // Decrypt file key
      const wrapNonce = naclUtil.decodeBase64(fullManifest.wrapNonce);
      const wrappedFileKey = naclUtil.decodeBase64(fullManifest.wrappedFileKey);
      const fileKey = nacl.secretbox.open(wrappedFileKey, wrapNonce, masterKey);
      
      if (!fileKey) {
        failed++;
        continue;
      }

      const baseNonce16 = naclUtil.decodeBase64(fullManifest.baseNonce16);

      // Prepare output file
      const safeFilename = String(filename).replace(/[\\/\n\r\t\0]/g, '_');
      const outUri = `${FileSystem.cacheDirectory}${safeFilename}`;
      const outPath = normalizeFilePath(outUri);
      await FileSystem.deleteAsync(outUri, { idempotent: true });
      await FileSystem.writeAsStringAsync(outUri, '', { encoding: FileSystem.EncodingType.Base64 });

      // Get blob util for appending
      let ReactNativeBlobUtil = null;
      try {
        const mod = require('react-native-blob-util');
        ReactNativeBlobUtil = mod?.default || mod;
      } catch (e) {}
      
      if (!ReactNativeBlobUtil?.fs?.appendFile) {
        throw new Error('StealthCloud restore requires a development build (react-native-blob-util).');
      }

      // Download and decrypt chunks
      const maxParallel = Math.max(1, getMaxParallelDownloads(fastMode));
      const chunkIds = fullManifest.chunkIds || [];

      for (let batchStart = 0; batchStart < chunkIds.length; batchStart += maxParallel) {
        const batchEnd = Math.min(batchStart + maxParallel, chunkIds.length);
        const batchMap = new Map();

        // Download batch in parallel
        const batchPromises = [];
        for (let c = batchStart; c < batchEnd; c++) {
          batchPromises.push((async () => {
            const chunkId = chunkIds[c];
            const tmpPath = `${FileSystem.cacheDirectory}sc_dl_${chunkId}.bin`;
            await FileSystem.deleteAsync(tmpPath, { idempotent: true });
            
            await withRetries(async () => {
              await FileSystem.downloadAsync(`${SERVER_URL}/api/cloud/chunks/${chunkId}`, tmpPath, { 
                headers: config.headers 
              });
            }, { retries: 20, baseDelayMs: 2000, maxDelayMs: 30000, shouldRetry: shouldRetryDownload });
            
            const chunkB64 = await FileSystem.readAsStringAsync(tmpPath, { encoding: FileSystem.EncodingType.Base64 });
            await FileSystem.deleteAsync(tmpPath, { idempotent: true });
            batchMap.set(c, chunkB64);
          })());
        }
        await Promise.all(batchPromises);

        // Decrypt and append in order
        for (let c = batchStart; c < batchEnd; c++) {
          await quickYield();
          
          const chunkB64 = batchMap.get(c);
          const boxed = naclUtil.decodeBase64(chunkB64);
          const nonce = makeChunkNonce(baseNonce16, c);
          const plaintext = nacl.secretbox.open(boxed, nonce, fileKey);
          
          if (!plaintext) throw new Error('Chunk decrypt failed');

          const p64 = naclUtil.encodeBase64(plaintext);
          await ReactNativeBlobUtil.fs.appendFile(outPath, p64, 'base64');
        }
      }

      // Save to media library
      await MediaLibrary.saveToLibraryAsync(outUri);
      await FileSystem.deleteAsync(outUri, { idempotent: true });
      
      restored++;

      // Update history
      const historyKey = makeHistoryKey('sc', mid);
      restoreHistory.add(historyKey);
      historyWrites++;
      
      if (historyWrites % 10 === 0) {
        await saveRestoreHistory(restoreHistory);
      }

      // Thermal management
      const cooldown = getAssetCooldownMs(fastMode);
      if (cooldown > 0) await sleep(cooldown);

      const batchLimit = getBatchLimit(fastMode);
      if (restored > 0 && restored % batchLimit === 0) {
        const batchCooldown = getBatchCooldownMs(fastMode);
        if (batchCooldown > 0) {
          onStatus(`Cooling down (batch ${Math.floor(restored / batchLimit)})...`);
          await sleep(batchCooldown);
        }
      }

    } catch (e) {
      console.warn('Restore failed for manifest:', mid, e?.message);
      failed++;
    }
  }

  // Final history save
  if (historyWrites > 0) {
    try {
      await saveRestoreHistory(restoreHistory);
    } catch (e) {}
  }

  updateProgress(onProgress, 1.0, true);
  updateStatus(onStatus, `Sync complete: ${restored} restored, ${skipped} skipped, ${failed} failed`, true);

  return { restored, skipped, failed };
};

// ============================================================================
// LOCAL/REMOTE RESTORE
// ============================================================================

/**
 * Optimized Local/Remote restore
 * 
 * Phases:
 * 1. Fetch server files (0-5%)
 * 2. Scan local photos (5-15%)
 * 3. Filter files to download (15-20%)
 * 4. Download and save each file (20-100%)
 */
export const localRemoteRestoreCore = async ({
  config,
  SERVER_URL,
  onlyFilenames = null, // Optional: specific filenames to restore
  fastMode = false,
  onStatus = () => {},
  onProgress = () => {},
  abortRef,
}) => {
  resetProgress();
  
  // ========== PHASE 1: Fetch Server Files (0-5%) ==========
  onStatus('Fetching server files...');
  onProgress(0);

  let serverFiles = [];
  try {
    serverFiles = await fetchServerFilesPaged(SERVER_URL, config, (fetched, total) => {
      const progress = (fetched / (total || fetched)) * 0.05;
      updateProgress(onProgress, progress);
      updateStatus(onStatus, `Fetching ${fetched}${total > fetched ? ` of ${total}` : ''} server files...`);
    });
  } catch (e) {
    console.error('Failed to fetch server files:', e?.message);
    return { restored: 0, skipped: 0, failed: 0, error: e?.message };
  }

  updateProgress(onProgress, 0.05, true);
  await yieldToUi();

  // Filter to specific filenames if provided
  if (onlyFilenames && Array.isArray(onlyFilenames) && onlyFilenames.length > 0) {
    const allowed = new Set(onlyFilenames.map(v => normalizeFilenameForCompare(v)).filter(Boolean));
    serverFiles = serverFiles.filter(f => {
      const nf = normalizeFilenameForCompare(f?.filename);
      return nf ? allowed.has(nf) : false;
    });
  }

  if (serverFiles.length === 0) {
    onProgress(1);
    return { restored: 0, skipped: 0, failed: 0, noFiles: true };
  }

  onStatus(`Found ${serverFiles.length} server files...`);
  await yieldToUi();

  // ========== PHASE 2: Scan Local Photos (5-15%) ==========
  onStatus('Scanning local photos...');
  updateProgress(onProgress, 0.05, true);

  const localSets = await scanLocalPhotosForDedup(onStatus, onProgress, 0.05, 0.15);
  
  updateProgress(onProgress, 0.15, true);
  await yieldToUi();

  // ========== PHASE 3: Filter Files to Download (15-20%) ==========
  onStatus('Comparing files...');
  
  const toDownload = [];
  let skipped = 0;

  for (const file of serverFiles) {
    const normalized = normalizeFilenameForCompare(file?.filename);
    if (normalized && localSets.filenames.has(normalized)) {
      skipped++;
    } else {
      toDownload.push(file);
    }
  }

  updateProgress(onProgress, 0.20, true);
  onStatus(`${toDownload.length} files to sync, ${skipped} already on device`);
  await yieldToUi();

  if (toDownload.length === 0) {
    onProgress(1);
    return { restored: 0, skipped, failed: 0, allSynced: true };
  }

  // ========== PHASE 4: Download Each File (20-100%) ==========
  let restored = 0;
  let failed = 0;

  const maxParallel = getMaxParallelDownloads(fastMode);
  const runDownload = createConcurrencyLimiter(maxParallel);
  let processed = 0;

  const downloadTasks = toDownload.map((file, idx) => runDownload(async () => {
    // Check abort
    if (abortRef?.current) return;

    try {
      const downloadUrl = `${SERVER_URL}/api/files/${encodeURIComponent(file.filename)}`;
      const localUri = `${FileSystem.cacheDirectory}${file.filename}`;
      
      await FileSystem.deleteAsync(localUri, { idempotent: true });
      
      const result = await FileSystem.downloadAsync(downloadUrl, localUri, {
        headers: config.headers
      });

      if (result.status === 200) {
        await MediaLibrary.saveToLibraryAsync(localUri);
        await FileSystem.deleteAsync(localUri, { idempotent: true });
        restored++;
        
        // Add to local set
        const normalized = normalizeFilenameForCompare(file.filename);
        if (normalized) localSets.filenames.add(normalized);
      } else {
        console.warn(`Download failed for ${file.filename}: HTTP ${result.status}`);
        failed++;
      }
    } catch (e) {
      console.warn(`Failed to download ${file.filename}:`, e?.message);
      failed++;
    } finally {
      processed++;
      const progress = 0.20 + (processed / toDownload.length) * 0.80;
      updateProgress(onProgress, progress);
      updateStatus(onStatus, `Syncing ${processed} of ${toDownload.length}...`);
    }
  }));

  await Promise.all(downloadTasks);

  updateProgress(onProgress, 1.0, true);
  updateStatus(onStatus, `Sync complete: ${restored} restored, ${skipped} skipped, ${failed} failed`, true);

  return { restored, skipped, failed, serverTotal: serverFiles.length };
};

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  stealthCloudRestoreCore,
  localRemoteRestoreCore,
};
