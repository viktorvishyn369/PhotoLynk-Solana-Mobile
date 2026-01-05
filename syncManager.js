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
  computeFileIdentity,
} from './utils';

import { computeExactFileHash, computePerceptualHash, findPerceptualHashMatch, extractBaseFilename, normalizeDateForCompare } from './duplicateScanner';

import {
  chooseStealthCloudMaxParallelChunkUploads,
  createConcurrencyLimiter,
} from './backgroundTask';

// ============================================================================
// PAGINATION HELPERS
// ============================================================================

// Fetch all StealthCloud manifests with pagination
const fetchAllManifestsPaged = async (serverUrl, config) => {
  const PAGE_LIMIT = 500;
  const allManifests = [];
  let offset = 0;

  while (true) {
    const response = await axios.get(`${serverUrl}/api/cloud/manifests`, {
      ...config,
      params: { offset, limit: PAGE_LIMIT }
    });

    const manifests = (response.data && response.data.manifests) ? response.data.manifests : [];
    allManifests.push(...manifests);

    if (!manifests || manifests.length < PAGE_LIMIT) break;
    offset += manifests.length;
    const total = typeof response.data?.total === 'number' ? response.data.total : null;
    if (typeof total === 'number' && offset >= total) break;
  }

  return allManifests;
};

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
  localManifestIds = new Set(),
  localFileHashes = new Set(),
  localPerceptualHashes = new Set(),
  localBaseNameSizes = new Map(),
  localBaseNameDates = new Map(),
  restoreHistory,
  saveRestoreHistory,
  makeHistoryKey,
  manifestIds = null,
  fastMode = false,
  onStatus = () => {},
  onProgress = () => {},
}) => {
  let historyWrites = 0;
  const shouldRetryRestoreDownload = (e) => {
    const msg = (e && e.message ? e.message : '').toLowerCase();
    if (msg.includes(' 404') || msg.includes('not found')) return false;
    return shouldRetryChunkUpload(e);
  };

  // Don't override status/progress - App.js manages unified progress bar
  let manifests = [];
  try {
    manifests = await fetchAllManifestsPaged(SERVER_URL, config);
  } catch (e) {
    console.error('SyncManager: failed to fetch manifests:', e.message);
    manifests = [];
  }
  console.log(`SyncManager: fetched ${manifests.length} manifests from server (paginated)`);

  // Filter to specific manifests if provided (Choose Files mode)
  if (manifestIds && Array.isArray(manifestIds) && manifestIds.length > 0) {
    const allowed = new Set(manifestIds.map(v => String(v)));
    manifests = manifests.filter(m => m && m.manifestId && allowed.has(String(m.manifestId)));
  }

  if (manifests.length === 0) {
    return { restored: 0, skipped: 0, failed: 0, noBackups: true };
  }

  let restored = 0;
  let skipped = 0;
  let failed = 0;
  let downloadNum = 0;  // Counts actual downloads for status

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
        continue;
      }

      const manifest = JSON.parse(naclUtil.encodeUTF8(manifestPlain));

      const filename = manifest.filename || `${mid}.bin`;
      const normalizedFilename = normalizeFilenameForCompare(filename);
      const historyKey = makeHistoryKey('sc', mid);
      const restoreOriginalSize = typeof manifest.originalSize === 'number'
        ? manifest.originalSize
        : (manifest.originalSize ? Number(manifest.originalSize) : (manifest.size ? Number(manifest.size) : null));
      // Use computeFileIdentity for consistent cross-device identity
      const fileIdentity = computeFileIdentity(filename, restoreOriginalSize);
      const fileHistoryKey = fileIdentity ? makeHistoryKey('scf', fileIdentity) : null;
      const alreadyRestored = restoreHistory.has(historyKey) || (fileHistoryKey ? restoreHistory.has(fileHistoryKey) : false);
      
      // === DEDUPLICATION (4 steps, same as upload but reversed) ===
      
      // Step 1: Check by manifestId (stable ID from filename + size)
      // This catches files that were already restored (even if iOS renamed them)
      const serverManifestId = mid;
      const fileExistsByManifestId = localManifestIds.has(serverManifestId);
      
      // Step 2: Check by exact filename match
      const fileExistsByFilename = normalizedFilename && localFilenames.has(normalizedFilename);
      
      // Step 3 & 4: Check by content hash (iOS assigns new filenames)
      // Images: use perceptual hash (transcoding-resistant)
      // Videos: use exact file hash
      let fileExistsByPerceptualHash = false;
      let fileExistsByFileHash = false;
      const manifestPerceptualHash = manifest.perceptualHash || null;
      const manifestFileHash = manifest.fileHash || null;
      
      // Step 3 & 4: Hash-based deduplication (works on both iOS and Android)
      // iOS assigns new filenames when saving, Android can too with Google Photos sync
      if (!fileExistsByFilename && (localPerceptualHashes.size > 0 || localFileHashes.size > 0)) {
        // Step 3: Perceptual hash for images
        if (manifestPerceptualHash && localPerceptualHashes.size > 0) {
          if (findPerceptualHashMatch(manifestPerceptualHash, localPerceptualHashes, 3)) {
            fileExistsByPerceptualHash = true;
            console.log(`[Hash Match] Server: ${filename} - perceptual hash match found locally`);
          }
        }
        
        // Step 4: Exact file hash for videos
        if (manifestFileHash && localFileHashes.size > 0) {
          if (localFileHashes.has(manifestFileHash)) {
            fileExistsByFileHash = true;
            console.log(`[Hash Match] Server: ${filename} - exact file hash match found locally`);
          }
        }
      }
      
      // Fallback matching: base filename + size or base filename + date
      // Handles cross-platform variants (iOS HEIC vs JPG, Android Google Photos renaming, etc.)
      let fileExistsByBaseNameSize = false;
      let fileExistsByBaseNameDate = false;
      const baseFilename = filename ? extractBaseFilename(filename) : null;
      
      if (baseFilename && !fileExistsByFilename && !fileExistsByPerceptualHash && !fileExistsByFileHash) {
        // Fallback 1: base filename + size match (within 20% tolerance for re-compression)
        if (localBaseNameSizes.size > 0 && localBaseNameSizes.has(baseFilename) && restoreOriginalSize) {
          const existingSizes = localBaseNameSizes.get(baseFilename);
          for (const existingSize of existingSizes) {
            const sizeDiff = Math.abs(restoreOriginalSize - existingSize) / Math.max(restoreOriginalSize, existingSize);
            if (sizeDiff < 0.20) {
              fileExistsByBaseNameSize = true;
              console.log(`[Fallback Match] Server: ${filename} - baseFilename+size match (${baseFilename}, size diff ${(sizeDiff * 100).toFixed(1)}%)`);
              break;
            }
          }
        }
        
        // Fallback 2: base filename + creation date match
        const manifestDate = manifest.creationTime ? normalizeDateForCompare(manifest.creationTime) : null;
        if (!fileExistsByBaseNameSize && localBaseNameDates.size > 0 && localBaseNameDates.has(baseFilename) && manifestDate) {
          const existingDates = localBaseNameDates.get(baseFilename);
          if (existingDates.has(manifestDate)) {
            fileExistsByBaseNameDate = true;
            console.log(`[Fallback Match] Server: ${filename} - baseFilename+date match (${baseFilename}, ${manifestDate})`);
          }
        }
      }
      
      const shouldSkip = fileExistsByManifestId || fileExistsByFilename || fileExistsByPerceptualHash || fileExistsByFileHash || fileExistsByBaseNameSize || fileExistsByBaseNameDate;
      
      if (shouldSkip) {
        console.log(`[Restore Skip] ${filename}:`, {
          skipByManifestId: fileExistsByManifestId,
          skipByFilename: fileExistsByFilename,
          skipByPerceptualHash: fileExistsByPerceptualHash,
          skipByFileHash: fileExistsByFileHash,
          skipByBaseNameSize: fileExistsByBaseNameSize,
          skipByBaseNameDate: fileExistsByBaseNameDate,
          skipByHistory: alreadyRestored,
          localFilenamesSize: localFilenames.size,
          localManifestIdsSize: localManifestIds.size,
          localFileHashesSize: localFileHashes.size,
          localPerceptualHashesSize: localPerceptualHashes.size,
          localBaseNameSizesSize: localBaseNameSizes.size,
          localBaseNameDatesSize: localBaseNameDates.size,
          restoreHistorySize: restoreHistory.size
        });
        skipped++;
        continue;
      }

      const wrapNonce = naclUtil.decodeBase64(manifest.wrapNonce);
      const wrappedFileKey = naclUtil.decodeBase64(manifest.wrappedFileKey);
      const fileKey = nacl.secretbox.open(wrappedFileKey, wrapNonce, masterKey);
      
      if (!fileKey) {
        failed++;
        continue;
      }

      const baseNonce16 = naclUtil.decodeBase64(manifest.baseNonce16);

      // Reconstruct plaintext to a temp file (append per chunk)
      const safeFilename = String(filename || `${mid}.bin`).replace(/[\\/\n\r\t\0]/g, '_');
      const outUri = `${FileSystem.cacheDirectory}${safeFilename}`;
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

      downloadNum++;
      onStatus(`Syncing ${downloadNum} of ${manifests.length}`);

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
      if (fileHistoryKey) {
        restoreHistory.add(fileHistoryKey);
      }
      historyWrites++;
      if (historyWrites % 10 === 0) {
        await saveRestoreHistory(restoreHistory);
      }
      // Progress based on actual downloads, not manifest index
      const totalToDownload = manifests.length - skipped;
      onProgress(totalToDownload > 0 ? downloadNum / totalToDownload : 1);

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
    }
  }

  if (historyWrites > 0) {
    try {
      await saveRestoreHistory(restoreHistory);
    } catch (e) {
      // ignore
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
// Fetch all server files with pagination
const fetchAllServerFilesPaged = async (serverUrl, config) => {
  const PAGE_LIMIT = 500;
  const allFiles = [];
  let offset = 0;

  while (true) {
    const response = await axios.get(`${serverUrl}/api/files`, {
      ...config,
      params: { offset, limit: PAGE_LIMIT }
    });

    const files = (response.data && response.data.files) ? response.data.files : [];
    allFiles.push(...files);

    if (!files || files.length < PAGE_LIMIT) break;
    offset += files.length;
    const total = typeof response.data?.total === 'number' ? response.data.total : null;
    if (typeof total === 'number' && offset >= total) break;
  }

  return allFiles;
};

export const localRemoteRestoreCore = async ({
  config,
  SERVER_URL,
  localFilenames,
  onlyFilenames = null,
  onStatus = () => {},
  onProgress = () => {},
}) => {
  onStatus('Preparing sync...');
  
  let serverFiles = await fetchAllServerFilesPaged(SERVER_URL, config);

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

  onStatus(`Syncing 0 of ${toDownload.length}`);
  onProgress(0);

  let successCount = 0;
  let failedCount = 0;
  let processedCount = 0;

  // Parallel file downloads: 4 on iOS, 6 on Android
  const maxParallelDownloads = Platform.OS === 'android' ? 6 : 4;
  const runDownload = createConcurrencyLimiter(maxParallelDownloads);

  const downloadTasks = toDownload.map((file, idx) => runDownload(async () => {
    try {
      const downloadUrl = `${SERVER_URL}/api/files/${encodeURIComponent(file.filename)}`;
      const localUri = `${FileSystem.cacheDirectory}${file.filename}`;
      
      await FileSystem.deleteAsync(localUri, { idempotent: true });
      
      const downloadResult = await FileSystem.downloadAsync(downloadUrl, localUri, {
        headers: config.headers
      });

      if (downloadResult.status === 200) {
        await MediaLibrary.saveToLibraryAsync(localUri);
        await FileSystem.deleteAsync(localUri, { idempotent: true });
        successCount++;
        
        // Add to local filenames to prevent re-download in same session
        const normalizedFilename = normalizeFilenameForCompare(file.filename);
        if (normalizedFilename) {
          localFilenames.add(normalizedFilename);
        }
      } else {
        console.warn(`Download failed for ${file.filename}: HTTP ${downloadResult.status}`);
        failedCount++;
      }
    } catch (e) {
      console.warn(`Failed to download ${file.filename}:`, e?.message);
      failedCount++;
    } finally {
      processedCount++;
      onStatus(`Syncing ${processedCount} of ${toDownload.length}`);
      onProgress(processedCount / toDownload.length);
    }
  }));

  await Promise.all(downloadTasks);
  
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
// LOCAL DEDUPLICATION INDEX BUILDER
// ============================================================================

/**
 * Builds local deduplication sets by scanning device photos.
 * Used by stealthCloudRestore to detect files already on device.
 * 
 * @param {Object} params
 * @param {number} params.totalToScan - Total number of assets to scan
 * @param {Function} params.resolveReadableFilePath - Function to get readable file path
 * @param {Function} params.onStatus - Callback for status updates
 * @param {Function} params.onProgress - Callback for progress updates (0-1)
 * @returns {Promise<{localManifestIds: Set, localFileHashes: Set, localPerceptualHashes: Set, localBaseNameSizes: Map, localBaseNameDates: Map}>}
 */
export const buildLocalDeduplicationIndex = async ({
  totalToScan,
  resolveReadableFilePath,
  onStatus = () => {},
  onProgress = () => {},
}) => {
  const localManifestIds = new Set();
  const localFileHashes = new Set();
  const localPerceptualHashes = new Set();
  const localBaseNameSizes = new Map();
  const localBaseNameDates = new Map();

  if (totalToScan === 0) {
    return { localManifestIds, localFileHashes, localPerceptualHashes, localBaseNameSizes, localBaseNameDates };
  }

  let hashScanned = 0;
  let after = null;
  const PAGE_SIZE = 100;

  while (true) {
    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      after: after || undefined,
      mediaType: ['photo', 'video'],
    });

    const assets = page && Array.isArray(page.assets) ? page.assets : [];
    if (assets.length === 0) break;

    for (const asset of assets) {
      try {
        const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
        const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo });
        const filePath = resolved?.filePath;
        if (!filePath) {
          console.warn('[LocalDedup] Missing filePath for asset', asset?.id, assetInfo?.filename || asset?.filename);
          hashScanned++;
          continue;
        }

        // Step 1: Compute manifestId (filename + size)
        const assetFilename = assetInfo.filename || asset.filename || null;
        let originalSize = null;

        if (Platform.OS === 'ios') {
          try {
            const fileUri = filePath.startsWith('/') ? `file://${filePath}` : filePath;
            const info = await FileSystem.getInfoAsync(fileUri);
            originalSize = info && typeof info.size === 'number' ? Number(info.size) : null;
          } catch (e) {}
        } else {
          // Android: use react-native-blob-util for accurate size
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

        const fileIdentity = computeFileIdentity(assetFilename, originalSize);
        if (fileIdentity) {
          const { sha256 } = require('js-sha256');
          const manifestId = sha256(`file:${fileIdentity}`);
          localManifestIds.add(manifestId);
        }

        // Build base filename + size/date maps for fallback matching
        const baseName = assetFilename ? extractBaseFilename(assetFilename) : null;
        if (baseName) {
          if (originalSize) {
            if (!localBaseNameSizes.has(baseName)) localBaseNameSizes.set(baseName, new Set());
            localBaseNameSizes.get(baseName).add(originalSize);
          }
          if (asset.creationTime) {
            const dateStr = normalizeDateForCompare(asset.creationTime);
            if (dateStr) {
              if (!localBaseNameDates.has(baseName)) localBaseNameDates.set(baseName, new Set());
              localBaseNameDates.get(baseName).add(dateStr);
            }
          }
        }

        const isImage = asset.mediaType === 'photo';

        if (isImage) {
          // Step 3: Images - compute perceptual hash
          const pHash = await computePerceptualHash(filePath, asset, assetInfo);
          if (pHash) {
            localPerceptualHashes.add(pHash);
          }
        } else {
          // Step 4: Videos - compute exact file hash
          const fHash = await computeExactFileHash(filePath);
          if (fHash) {
            localFileHashes.add(fHash);
          }
        }

        hashScanned++;
        onProgress(hashScanned / totalToScan);
        // Show count: first 10 by 1, then every 5 (15, 20, 25...)
        if (hashScanned <= 10 || hashScanned % 5 === 0 || hashScanned === totalToScan) {
          onStatus(`Analyzing ${hashScanned} of ${totalToScan}`);
        }
      } catch (e) {
        // Skip files we can't hash
        hashScanned++;
      }
    }

    after = page && page.endCursor ? page.endCursor : null;
    if (!page || page.hasNextPage !== true) break;
  }

  console.log(`[Dedup Index] Built: ${localManifestIds.size} manifestIds, ${localPerceptualHashes.size} image hashes, ${localFileHashes.size} video hashes, ${localBaseNameSizes.size} name+size, ${localBaseNameDates.size} name+date`);

  return { localManifestIds, localFileHashes, localPerceptualHashes, localBaseNameSizes, localBaseNameDates };
};

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  stealthCloudRestoreCore,
  localRemoteRestoreCore,
  buildLocalDeduplicationIndex,
};
