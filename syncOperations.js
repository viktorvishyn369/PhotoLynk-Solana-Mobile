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

import { t } from './i18n';
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
  normalizeFullTimestamp,
} from './duplicateScanner';

// Sync-specific dHash threshold (6 bits = ~9% tolerance for cross-platform decoder differences)
// This is more lenient than backup dedup (0 bits) to handle HEIC/JPEG conversion differences
const SYNC_DHASH_THRESHOLD = 6;

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
// ASSET COLLECTION (All Albums + iCloud/Google Cloud Download)
// ============================================================================

/**
 * Collect all assets from device including all albums (Screenshots, Downloads, WhatsApp, etc.)
 * Also triggers iCloud/Google Cloud download for cloud-only items before dedup
 * @returns {Promise<Array>} Array of all assets
 */
const collectAllAssetsFromAllAlbums = async (onStatus, onProgress, progressStart, progressEnd) => {
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

  updateStatus(onStatus, t('status.syncScanning', { current: 0, total: totalCount }), true);
  updateProgress(onProgress, progressStart, true);

  // Phase 1: Collect from main library (paged)
  while (true) {
    const page = await MediaLibrary.getAssetsAsync({
      first: PAGE_SIZE,
      after: after || undefined,
      mediaType: mediaTypes,
    });

    const assets = page?.assets || [];
    for (const asset of assets) {
      if (!seenIds.has(asset.id)) {
        seenIds.add(asset.id);
        allAssets.push(asset);
      }
    }

    // Update progress
    const scanProgress = progressStart + (allAssets.length / Math.max(totalCount, 1)) * (progressEnd - progressStart) * 0.6;
    updateProgress(onProgress, Math.min(scanProgress, progressEnd));
    updateStatus(onStatus, t('status.syncScanning', { current: allAssets.length, total: totalCount }));

    after = page?.endCursor;
    if (!page?.hasNextPage) break;
    if (assets.length === 0) break;
    await quickYield();
  }

  // Phase 2: Scan all albums to catch Screenshots, Downloads, WhatsApp, user folders, etc.
  try {
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    updateStatus(onStatus, t('status.syncScanningAlbums', { count: albums.length }));
    
    for (let i = 0; i < albums.length; i++) {
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

      // Yield every few albums
      if (i % 5 === 0) {
        await quickYield();
        const albumProgress = progressStart + (progressEnd - progressStart) * (0.6 + 0.2 * (i / albums.length));
        updateProgress(onProgress, Math.min(albumProgress, progressEnd));
        updateStatus(onStatus, t('status.syncScanningAlbumsFound', { count: allAssets.length }));
      }
    }
  } catch (e) {
    console.log('[Sync] Album scan error:', e?.message);
  }

  // Phase 3: Trigger iCloud/Google Cloud download for cloud-only items (iOS mainly)
  // Also store localUri back into asset objects for later hash computation
  if (Platform.OS === 'ios') {
    updateStatus(onStatus, t('status.syncCheckingCloud', { count: allAssets.length }));
    let cloudDownloadCount = 0;
    let localUriCount = 0;
    
    for (let i = 0; i < allAssets.length; i++) {
      try {
        const asset = allAssets[i];
        // getAssetInfoAsync triggers iCloud download if needed and returns localUri
        const info = await MediaLibrary.getAssetInfoAsync(asset.id);
        
        // Store localUri back into asset for later use in hash computation
        if (info?.localUri) {
          asset.localUri = info.localUri;
          localUriCount++;
        } else if (info?.uri) {
          asset.uri = info.uri;
          cloudDownloadCount++;
        }
      } catch (e) {
        // Skip items that fail
        if (i < 5) console.log(`[Sync] iOS asset ${i} info error: ${e.message}`);
      }
      
      // Yield and update progress periodically
      if (i % 50 === 0) {
        await quickYield();
        const dlProgress = progressStart + (progressEnd - progressStart) * (0.8 + 0.2 * (i / allAssets.length));
        updateProgress(onProgress, Math.min(dlProgress, progressEnd));
        if (cloudDownloadCount > 0) {
          updateStatus(onStatus, t('status.syncDownloadingICloud', { count: cloudDownloadCount }));
        }
      }
    }
    
    console.log(`[Sync] iOS: ${localUriCount} local files, ${cloudDownloadCount} cloud-only items`);
  }

  updateProgress(onProgress, progressEnd, true);
  console.log(`[Sync] Collected ${allAssets.length} assets from all albums`);
  return allAssets;
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

// Yield to UI - use InteractionManager + setImmediate for best React Native responsiveness
const yieldToUi = () => new Promise(resolve => {
  InteractionManager.runAfterInteractions(() => {
    if (typeof setImmediate !== 'undefined') {
      setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
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
const fetchServerFilesPaged = async (serverUrl, config, onProgress, includeMeta = true) => {
  const PAGE_LIMIT = 500;
  const allFiles = [];
  let offset = 0;
  let estimatedTotal = null;

  while (true) {
    const params = { offset, limit: PAGE_LIMIT };
    if (includeMeta) params.meta = 'true';
    
    const response = await axios.get(`${serverUrl}/api/files`, {
      ...config,
      params
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
    if (findPerceptualHashMatch(perceptualHash, localSets.perceptualHashes, SYNC_DHASH_THRESHOLD)) {
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
 * Scan local device files and build dedup sets
 * Scans ALL albums (Screenshots, Downloads, WhatsApp, user folders) + triggers iCloud download
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

  // Collect all assets from all albums + trigger iCloud download
  const allAssets = await collectAllAssetsFromAllAlbums(onStatus, onProgress, progressStart, progressStart + (progressEnd - progressStart) * 0.7);
  
  // Build dedup sets from collected assets
  updateStatus(onStatus, t('status.syncBuildingIndex', { count: allAssets.length }), true);
  
  for (let i = 0; i < allAssets.length; i++) {
    const asset = allAssets[i];
    const filename = asset.filename;
    
    if (filename) {
      const normalized = normalizeFilenameForCompare(filename);
      if (normalized) localSets.filenames.add(normalized);
      
      // Compute manifestId (filename + size) - use asset metadata
      const fileSize = asset.width && asset.height ? (asset.width * asset.height) : null;
      const duration = asset.duration || 0;
      
      const fileIdentity = computeFileIdentity(filename, duration > 0 ? Math.round(duration * 1000) : (fileSize || 0));
      if (fileIdentity) {
        const manifestId = sha256(`file:${fileIdentity}`);
        localSets.manifestIds.add(manifestId);
      }
      
      // Base name + size/date for fallback dedup
      const baseName = extractBaseFilename(filename);
      if (baseName) {
        if (fileSize) {
          if (!localSets.baseNameSizes.has(baseName)) localSets.baseNameSizes.set(baseName, new Set());
          localSets.baseNameSizes.get(baseName).add(fileSize);
        }
        
        if (asset.creationTime) {
          const dateStr = normalizeDateForCompare(asset.creationTime);
          if (dateStr) {
            if (!localSets.baseNameDates.has(baseName)) localSets.baseNameDates.set(baseName, new Set());
            localSets.baseNameDates.get(baseName).add(dateStr);
          }
        }
      }
    }
    
    // Progress update every 100 files
    if (i % 100 === 0) {
      const progress = progressStart + (progressEnd - progressStart) * (0.7 + 0.3 * (i / allAssets.length));
      updateProgress(onProgress, Math.min(progress, progressEnd));
      updateStatus(onStatus, t('status.syncIndexing', { current: i, total: allAssets.length }));
      await quickYield();
    }
  }

  // Final progress update
  updateProgress(onProgress, progressEnd, true);
  updateStatus(onStatus, t('status.syncIndexed', { count: allAssets.length }), true);

  console.log(`[Sync] Local scan: ${localSets.filenames.size} filenames, ${localSets.manifestIds.size} manifestIds`);
  return localSets;
};

/**
 * Build local dedup index for StealthCloud restore
 * Scans ALL albums (Screenshots, Downloads, WhatsApp, user folders) + triggers iCloud download
 * Computes actual file hashes for cross-device dedup
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

  // Collect all assets from all albums + trigger iCloud download
  const allAssets = await collectAllAssetsFromAllAlbums(onStatus, onProgress, progressStart, progressStart + (progressEnd - progressStart) * 0.3);
  
  // Build dedup sets from collected assets - compute hashes for cross-device dedup
  console.log(`[Sync] ${Platform.OS}: Starting hash computation for ${allAssets.length} assets`);
  updateStatus(onStatus, t('status.syncBuildingIndex', { count: allAssets.length }), true);
  
  let hashedCount = 0;
  let hashErrors = 0;
  let resolveErrors = 0;
  
  for (let i = 0; i < allAssets.length; i++) {
    const asset = allAssets[i];
    const filename = asset.filename;
    
    if (filename) {
      // Primary dedup: exact filename match (fast and reliable)
      const normalized = normalizeFilenameForCompare(filename);
      if (normalized) localSets.filenames.add(normalized);
      
      // Base name for cross-platform variant matching
      const baseName = extractBaseFilename(filename);
      
      // Try to get actual file path and compute hashes for cross-device dedup
      try {
        // resolveReadableFilePath expects { assetId, assetInfo } format
        if (typeof resolveReadableFilePath !== 'function') {
          throw new Error('resolveReadableFilePath is not a function');
        }
        const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo: asset });
        const filePath = resolved?.filePath || resolved;
        
        if (filePath && typeof filePath === 'string') {
          // Log first few files for debugging
          if (i < 3) console.log(`[Sync] File ${i}: ${filename} -> ${filePath.substring(0, 80)}...`);
          
          // Get actual file size
          let fileSize = null;
          try {
            const fileUri = filePath.startsWith('file://') ? filePath : (filePath.startsWith('/') ? `file://${filePath}` : filePath);
            const info = await FileSystem.getInfoAsync(fileUri);
            fileSize = info?.size ? Number(info.size) : null;
            if (i < 3) console.log(`[Sync] File ${i}: size=${fileSize}`);
          } catch (e) {
            if (i < 3) console.log(`[Sync] File ${i}: size error: ${e.message}`);
          }
          
          // Compute manifestId with actual file size
          if (fileSize) {
            const fileIdentity = computeFileIdentity(filename, fileSize);
            if (fileIdentity) {
              const manifestId = sha256(`file:${fileIdentity}`);
              localSets.manifestIds.add(manifestId);
              if (i < 3) console.log(`[Sync] File ${i}: manifestId=${manifestId.substring(0, 16)}...`);
            }
            
            // Base name + actual size for fallback
            if (baseName) {
              if (!localSets.baseNameSizes.has(baseName)) localSets.baseNameSizes.set(baseName, new Set());
              localSets.baseNameSizes.get(baseName).add(fileSize);
            }
          }
          
          // Compute file hash for videos (cross-device dedup)
          const isVideo = asset.mediaType === 'video' || (asset.duration && asset.duration > 0);
          if (isVideo) {
            try {
              if (i < 5) console.log(`[Sync] File ${i}: computing video hash...`);
              const fileHash = await computeExactFileHash(filePath);
              if (fileHash) {
                localSets.fileHashes.add(fileHash);
                hashedCount++;
                if (i < 5) console.log(`[Sync] File ${i}: videoHash=${fileHash.substring(0, 16)}...`);
              } else {
                if (i < 5) console.log(`[Sync] File ${i}: videoHash=null`);
              }
            } catch (e) { 
              hashErrors++;
              if (i < 10) console.log(`[Sync] File ${i}: videoHash error: ${e.message}`);
            }
          } else {
            // Compute perceptual hash for images (cross-device dedup)
            try {
              if (i < 5) console.log(`[Sync] File ${i}: computing perceptual hash...`);
              const phash = await computePerceptualHash(filePath);
              if (phash) {
                localSets.perceptualHashes.add(phash);
                hashedCount++;
                if (i < 5) console.log(`[Sync] File ${i}: phash=${phash}`);
              } else {
                if (i < 5) console.log(`[Sync] File ${i}: phash=null`);
              }
            } catch (e) { 
              hashErrors++;
              if (i < 10) console.log(`[Sync] File ${i}: phash error: ${e.message}`);
            }
          }
        } else {
          if (i < 5) console.log(`[Sync] File ${i}: ${filename} - no valid filePath`);
          resolveErrors++;
        }
      } catch (e) {
        resolveErrors++;
        if (i < 10) console.log(`[Sync] File ${i}: ${filename} - resolve error: ${e.message}`);
        // Fall back to metadata-only if file access fails
        const duration = asset.duration || 0;
        const approxSize = asset.width && asset.height ? (asset.width * asset.height) : 0;
        if (baseName && approxSize > 0) {
          if (!localSets.baseNameSizes.has(baseName)) localSets.baseNameSizes.set(baseName, new Set());
          localSets.baseNameSizes.get(baseName).add(approxSize);
        }
      }
      
      // Base name + date for fallback dedup
      if (baseName && asset.creationTime) {
        const dateStr = normalizeDateForCompare(asset.creationTime);
        if (dateStr) {
          if (!localSets.baseNameDates.has(baseName)) localSets.baseNameDates.set(baseName, new Set());
          localSets.baseNameDates.get(baseName).add(dateStr);
        }
      }
    }
    
    // Progress update every file (hashing can be slow for large files)
    const progress = progressStart + (progressEnd - progressStart) * (0.3 + 0.7 * (i / allAssets.length));
    updateProgress(onProgress, Math.min(progress, progressEnd));
    updateStatus(onStatus, t('status.syncHashing', { current: i + 1, total: allAssets.length, filename: filename || 'file' }));
    await quickYield();
  }

  // Final progress update
  updateProgress(onProgress, progressEnd, true);
  updateStatus(onStatus, t('status.syncIndexed', { count: allAssets.length }), true);

  console.log(`[Sync] Local index: ${localSets.filenames.size} filenames, ${localSets.manifestIds.size} manifestIds, ${localSets.fileHashes.size} fileHashes, ${localSets.perceptualHashes.size} perceptualHashes (hashed=${hashedCount}, hashErrors=${hashErrors}, resolveErrors=${resolveErrors})`);
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
  
  // ========== PHASE 1: Setup (0-1%) ==========
  onStatus(t('status.syncPreparing'));
  onProgress(0.01);
  await yieldToUi();

  // ========== PHASE 2: Fetch Server Manifests (1-5%) ==========
  onStatus(t('status.fetchingServerState'));

  let serverManifests = [];
  try {
    serverManifests = await fetchManifestsWithMeta(SERVER_URL, config, (fetched, total) => {
      const progress = 0.01 + (fetched / (total || fetched)) * 0.04;
      updateProgress(onProgress, progress);
      updateStatus(onStatus, total > fetched ? t('status.syncFetching', { fetched, total }) : t('status.syncFetchingSimple', { fetched }));
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
    // No backups - animate to 100%
    for (let p = 0.05; p <= 1.0; p += 0.15) {
      onProgress(Math.min(p, 1.0));
      await sleep(40);
    }
    onProgress(1);
    return { restored: 0, skipped: 0, failed: 0, noBackups: true };
  }

  onStatus(t('status.syncFoundFiles', { count: serverManifests.length }));
  await yieldToUi();

  // ========== PHASE 3: Scan Local Photos (5-10%) ==========
  onStatus(t('status.syncScanningLocal'));

  const localSets = await buildLocalHashIndex(resolveReadableFilePath, onStatus, onProgress, 0.05, 0.10);
  
  updateProgress(onProgress, 0.10, true);
  await yieldToUi();

  // ========== PHASE 4: Filter Files to Download (10-15%) ==========
  onStatus(t('status.syncComparing', { current: 0, total: serverManifests.length }));

  const toDownload = [];
  let skipped = 0;

  const skipReasons = {};
  let historySkipped = 0;
  
  for (let i = 0; i < serverManifests.length; i++) {
    const manifest = serverManifests[i];
    
    // Check restore history
    const historyKey = makeHistoryKey('sc', manifest.manifestId);
    if (restoreHistory.has(historyKey)) {
      historySkipped++;
      skipped++;
      continue;
    }
    
    // Check local dedup
    const check = shouldSkipServerFile(manifest, localSets);
    if (check.skip) {
      skipped++;
      skipReasons[check.reason] = (skipReasons[check.reason] || 0) + 1;
      if (i < 10) console.log(`[Sync] Skip ${manifest.filename}: ${check.reason}`);
      continue;
    }
    
    // Log files that will be downloaded
    if (toDownload.length < 5) console.log(`[Sync] Will download: ${manifest.filename} (no local match)`);
    toDownload.push(manifest);
    
    if (i % 100 === 0) {
      updateStatus(onStatus, t('status.syncComparing', { current: i + 1, total: serverManifests.length }));
      await quickYield();
    }
  }
  
  console.log(`[Sync] Comparison done: toDownload=${toDownload.length}, skipped=${skipped} (history=${historySkipped})`, skipReasons);

  updateProgress(onProgress, 0.15, true);

  if (toDownload.length === 0) {
    // All files already synced - animate progress 15% to 100% smoothly
    onStatus(t('status.allFilesSynced', { count: skipped }));
    for (let p = 0.20; p <= 1.0; p += 0.10) {
      onProgress(Math.min(p, 1.0));
      await sleep(30);
    }
    onProgress(1);
    await sleep(100);
    return { restored: 0, skipped, failed: 0, allSynced: true };
  }

  // ========== PHASE 5: Download Each File (15-100%) ==========
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

    // Progress: 15-100%
    const progress = 0.15 + (fileNum / toDownload.length) * 0.85;
    updateProgress(onProgress, progress);
    updateStatus(onStatus, t('status.syncDownloadingFile', { current: fileNum, total: toDownload.length, filename: manifest.filename || 'file' }), true);

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

      // Prepare output file - sanitize for local storage
      const safeFilename = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
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

      // Retrieve and apply EXIF if available (for cross-platform preservation)
      const fileHash = fullManifest.fileHash;
      if (fileHash && /\.(jpg|jpeg|png|heic|heif|gif|bmp|webp|tiff?)$/i.test(filename || '')) {
        try {
          const exifRes = await axios.get(`${SERVER_URL}/api/exif/${fileHash}`, {
            headers: config.headers,
            timeout: 10000,
            validateStatus: (status) => status < 500, // Don't throw on 404
          });
          if (exifRes.status === 200 && exifRes.data?.exif) {
            // TODO: Apply EXIF to file using native module (ExifWriter)
            // For now, log that EXIF was retrieved for this file
            console.log(`[EXIF] Retrieved EXIF for ${filename} (hash: ${fileHash.slice(0, 16)}...)`);
            // Future: await ExifWriter.writeExif(outPath, exifRes.data.exif);
          }
        } catch (e) {
          // Non-critical - don't fail restore if EXIF retrieval fails
          console.log('[EXIF] Retrieve failed (non-critical):', e?.message);
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
          onStatus(`Sync: Cooling down (batch ${Math.floor(restored / batchLimit)})...`);
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
  updateStatus(onStatus, t('status.syncCompleteStats', { restored, skipped, failed }), true);

  return { restored, skipped, failed };
};

// ============================================================================
// LOCAL/REMOTE RESTORE
// ============================================================================

/**
 * Optimized Local/Remote restore
 * 
 * Phases:
 * 1. Fetch server files (progress hidden)
 * 2. Scan local photos (progress hidden)
 * 3. Filter files to download (progress hidden)
 * 4. Download and save each file (0-100%)
 */
export const localRemoteRestoreCore = async ({
  config,
  SERVER_URL,
  resolveReadableFilePath, // Required for hash computation
  onlyFilenames = null, // Optional: specific filenames to restore
  fastMode = false,
  onStatus = () => {},
  onProgress = () => {},
  abortRef,
  appStateRef, // For pausing when backgrounded
}) => {
  resetProgress();
  
  // ========== PHASE 1: Fetch Server Files (0-5%) ==========
  onStatus(t('status.fetchingServerState'));
  onProgress(0.01);

  let serverFiles = [];
  try {
    // Fetch with meta=true to get hash metadata for cross-device dedup
    serverFiles = await fetchServerFilesPaged(SERVER_URL, config, (fetched, total) => {
      const progress = 0.01 + (fetched / (total || fetched)) * 0.04;
      updateProgress(onProgress, progress);
      updateStatus(onStatus, total > fetched ? t('status.syncFetching', { fetched, total }) : t('status.syncFetchingSimple', { fetched }));
    }, true); // includeMeta=true
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
    // No files - animate to 100%
    for (let p = 0.05; p <= 1.0; p += 0.15) {
      onProgress(Math.min(p, 1.0));
      await sleep(40);
    }
    onProgress(1);
    return { restored: 0, skipped: 0, failed: 0, noFiles: true };
  }

  onStatus(t('status.syncFoundFiles', { count: serverFiles.length }));
  await yieldToUi();

  // ========== PHASE 2: Scan Local Photos (5-10%) ==========
  onStatus(t('status.syncScanningLocal'));

  // Use buildLocalHashIndex for perceptual hash matching (handles iOS file renaming)
  const localSets = await buildLocalHashIndex(resolveReadableFilePath, onStatus, onProgress, 0.05, 0.10);
  
  updateProgress(onProgress, 0.10, true);
  await yieldToUi();

  // ========== PHASE 3: Filter Files to Download (10-15%) ==========
  onStatus(t('status.syncComparing', { current: 0, total: serverFiles.length }));
  
  // Debug: count server files with hashes
  const serverWithPhash = serverFiles.filter(f => f?.perceptualHash).length;
  const serverWithFhash = serverFiles.filter(f => f?.fileHash).length;
  console.log(`[Sync] Server files: ${serverFiles.length} total, ${serverWithPhash} with perceptualHash, ${serverWithFhash} with fileHash`);
  console.log(`[Sync] Local sets: ${localSets.perceptualHashes?.size || 0} perceptualHashes, ${localSets.fileHashes?.size || 0} fileHashes`);
  
  const toDownload = [];
  let skipped = 0;
  const skipReasons = {};

  for (let i = 0; i < serverFiles.length; i++) {
    const file = serverFiles[i];
    const normalized = normalizeFilenameForCompare(file?.filename);
    const baseName = extractBaseFilename(file?.filename);
    
    // Log first few files for debugging
    if (i < 5) {
      console.log(`[Sync] Server file ${i}: "${file?.filename}" -> normalized: "${normalized}", baseName: "${baseName}", phash: ${file?.perceptualHash || 'none'}`);
      console.log(`[Sync] Local has filename: ${normalized ? localSets.filenames.has(normalized) : 'N/A'}, baseName: ${baseName ? localSets.baseNameSizes.has(baseName) : 'N/A'}`);
    }
    
    // Check by exact filename first
    if (normalized && localSets.filenames.has(normalized)) {
      skipped++;
      skipReasons.filename = (skipReasons.filename || 0) + 1;
      if (i < 10) console.log(`[Sync] Skip ${file?.filename}: filename`);
      continue;
    }
    
    // Check by base filename (handles iOS renaming: IMG_1413.JPG -> IMG_3618.JPG but same base pattern)
    // This catches files with same base name but different numbering
    if (baseName && localSets.baseNameSizes.has(baseName)) {
      skipped++;
      skipReasons.baseName = (skipReasons.baseName || 0) + 1;
      if (i < 10) console.log(`[Sync] Skip ${file?.filename}: baseName`);
      continue;
    }
    
    // Check by perceptual hash (cross-device dedup for images)
    const serverPhash = file?.perceptualHash;
    if (serverPhash && localSets.perceptualHashes && localSets.perceptualHashes.size > 0) {
      if (findPerceptualHashMatch(serverPhash, localSets.perceptualHashes, SYNC_DHASH_THRESHOLD)) {
        skipped++;
        skipReasons.perceptualHash = (skipReasons.perceptualHash || 0) + 1;
        if (i < 10) console.log(`[Sync] Skip ${file?.filename}: perceptualHash`);
        continue;
      }
    }
    
    // Check by file hash (cross-device dedup for videos)
    const serverFileHash = file?.fileHash;
    if (serverFileHash && localSets.fileHashes && localSets.fileHashes.has(serverFileHash)) {
      skipped++;
      skipReasons.fileHash = (skipReasons.fileHash || 0) + 1;
      if (i < 10) console.log(`[Sync] Skip ${file?.filename}: fileHash`);
      continue;
    }
    
    // FALLBACK: Check ALL platform-specific hashes (double-confirm before download)
    // Check current platform first, then other platforms
    const platformOrder = Platform.OS === 'ios' ? ['ios', 'android'] : ['android', 'ios'];
    let platformSkipped = false;
    for (const plat of platformOrder) {
      const platformHash = file?.platformHashes?.[plat];
      if (platformHash) {
        // Check platform-specific perceptual hash
        if (platformHash.perceptualHash && localSets.perceptualHashes?.size > 0) {
          if (findPerceptualHashMatch(platformHash.perceptualHash, localSets.perceptualHashes, SYNC_DHASH_THRESHOLD)) {
            skipped++;
            skipReasons[`platform_${plat}_phash`] = (skipReasons[`platform_${plat}_phash`] || 0) + 1;
            if (i < 10) console.log(`[Sync] Skip ${file?.filename}: platformPhash (${plat})`);
            platformSkipped = true;
            break;
          }
        }
        // Check platform-specific file hash
        if (platformHash.fileHash && localSets.fileHashes?.has(platformHash.fileHash)) {
          skipped++;
          skipReasons[`platform_${plat}_fhash`] = (skipReasons[`platform_${plat}_fhash`] || 0) + 1;
          if (i < 10) console.log(`[Sync] Skip ${file?.filename}: platformFileHash (${plat})`);
          platformSkipped = true;
          break;
        }
      }
    }
    if (platformSkipped) continue;
    
    if (toDownload.length < 5) console.log(`[Sync] Will download: ${file?.filename} (no local match)`);
    toDownload.push(file);
  }

  console.log(`[Sync] Comparison done: toDownload=${toDownload.length}, skipped=${skipped}`, skipReasons);

  updateProgress(onProgress, 0.15, true);

  if (toDownload.length === 0) {
    // All files already synced - animate progress 15% to 100% smoothly
    onStatus(t('status.allFilesSynced', { count: skipped }));
    for (let p = 0.20; p <= 1.0; p += 0.10) {
      onProgress(Math.min(p, 1.0));
      await sleep(30);
    }
    onProgress(1);
    await sleep(100);
    return { restored: 0, skipped, failed: 0, allSynced: true, serverTotal: serverFiles.length };
  }

  // ========== PHASE 4: Download Each File (15-100%) ==========
  let restored = 0;
  let failed = 0;
  
  // Collect computed hashes to submit to server for future fast dedup
  const computedPlatformHashes = [];

  const maxParallel = getMaxParallelDownloads(fastMode);
  const runDownload = createConcurrencyLimiter(maxParallel);
  let processed = 0;

  const downloadTasks = toDownload.map((file, idx) => runDownload(async () => {
    // Check abort
    if (abortRef?.current) return;
    
    // Wait if app is backgrounded (pause instead of failing)
    if (appStateRef) {
      while (appStateRef.current !== 'active') {
        await sleep(1000);
      }
    }

    try {
      const downloadUrl = `${SERVER_URL}/api/files/${encodeURIComponent(file.filename)}`;
      // Sanitize filename for local storage - replace spaces and special chars
      const safeFilename = file.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const localUri = `${FileSystem.cacheDirectory}${safeFilename}`;
      
      await FileSystem.deleteAsync(localUri, { idempotent: true });
      
      const result = await FileSystem.downloadAsync(downloadUrl, localUri, {
        headers: config.headers
      });

      if (result.status === 200) {
        // Check perceptual hash BEFORE saving to detect duplicates (handles iOS renaming)
        const filePath = localUri.startsWith('file://') ? localUri.slice(7) : localUri;
        const isVideo = /\.(mov|mp4|m4v|avi|mkv|webm|3gp)$/i.test(file.filename);
        
        let isDuplicate = false;
        let computedHash = null;
        try {
          if (isVideo) {
            computedHash = await computeExactFileHash(filePath);
            const hasMatch = computedHash && localSets.fileHashes.has(computedHash);
            if (idx < 10) console.log(`[Sync] Video ${file.filename}: hash=${computedHash?.substring(0,16)}..., localHashes=${localSets.fileHashes.size}, match=${hasMatch}`);
            if (hasMatch) {
              isDuplicate = true;
            }
          } else {
            computedHash = await computePerceptualHash(filePath);
            const hasMatch = computedHash && findPerceptualHashMatch(computedHash, localSets.perceptualHashes, SYNC_DHASH_THRESHOLD);
            if (idx < 10) console.log(`[Sync] Image ${file.filename}: phash=${computedHash}, localPhashes=${localSets.perceptualHashes.size}, match=${hasMatch}`);
            if (hasMatch) {
              isDuplicate = true;
            }
          }
        } catch (hashErr) {
          // Hash computation failed, proceed with save
          if (idx < 5) console.log(`[Sync] Hash check failed for ${file.filename}: ${hashErr.message}`);
        }
        
        if (isDuplicate) {
          await FileSystem.deleteAsync(localUri, { idempotent: true });
          skipped++;
          skipReasons.hashMatch = (skipReasons.hashMatch || 0) + 1;
        } else {
          // Retrieve and apply EXIF if available (for cross-platform preservation)
          const fileHash = file.fileHash || computedHash;
          if (fileHash && /\.(jpg|jpeg|png|heic|heif|gif|bmp|webp|tiff?)$/i.test(file.filename || '')) {
            try {
              const exifRes = await axios.get(`${SERVER_URL}/api/exif/${fileHash}`, {
                headers: config.headers,
                timeout: 10000,
                validateStatus: (status) => status < 500,
              });
              if (exifRes.status === 200 && exifRes.data?.exif) {
                console.log(`[EXIF] Retrieved EXIF for ${file.filename} (hash: ${fileHash.slice(0, 16)}...)`);
                // TODO: Apply EXIF to file using native module (ExifWriter)
                // Future: await ExifWriter.writeExif(filePath, exifRes.data.exif);
              }
            } catch (e) {
              // Non-critical
            }
          }
          
          await MediaLibrary.saveToLibraryAsync(localUri);
          await FileSystem.deleteAsync(localUri, { idempotent: true });
          restored++;
          
          // Add computed hash to localSets to prevent duplicate downloads in same session
          if (computedHash) {
            if (isVideo) {
              localSets.fileHashes.add(computedHash);
              // Collect for server submission
              computedPlatformHashes.push({ filename: file.filename, fileHash: computedHash });
            } else {
              localSets.perceptualHashes.add(computedHash);
              // Collect for server submission
              computedPlatformHashes.push({ filename: file.filename, perceptualHash: computedHash });
            }
          }
          
          // Add filename to local set
          const normalized = normalizeFilenameForCompare(file.filename);
          if (normalized) localSets.filenames.add(normalized);
        }
      } else {
        console.warn(`Download failed for ${file.filename}: HTTP ${result.status}`);
        failed++;
      }
    } catch (e) {
      console.warn(`Failed to download ${file.filename}:`, e?.message);
      failed++;
    } finally {
      processed++;
      // Progress: 15-100%
      const progress = 0.15 + (processed / toDownload.length) * 0.85;
      updateProgress(onProgress, progress);
      updateStatus(onStatus, t('status.syncDownloadingProgress', { current: processed, total: toDownload.length }));
    }
  }));

  await Promise.all(downloadTasks);

  // Submit computed platform hashes to server for future fast dedup
  if (computedPlatformHashes.length > 0) {
    try {
      const platform = Platform.OS;
      console.log(`[Sync] Submitting ${computedPlatformHashes.length} platform hashes to server (${platform})`);
      await axios.post(`${SERVER_URL}/api/files/platform-hashes`, {
        platform,
        hashes: computedPlatformHashes
      }, config);
    } catch (e) {
      console.warn('[Sync] Failed to submit platform hashes:', e?.message);
      // Non-fatal, continue
    }
  }

  updateProgress(onProgress, 1.0, true);
  updateStatus(onStatus, t('status.syncCompleteStats', { restored, skipped, failed }), true);

  return { restored, skipped, failed, serverTotal: serverFiles.length };
};

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  stealthCloudRestoreCore,
  localRemoteRestoreCore,
};
