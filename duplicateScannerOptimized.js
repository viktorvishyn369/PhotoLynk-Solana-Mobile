/**
 * duplicateScannerOptimized.js
 * 
 * Optimized duplicate scanning with proper yielding, progress updates, and UI responsiveness.
 * Handles 100s to 10,000s of files without freezing.
 * 
 * Key optimizations:
 * - requestAnimationFrame yielding for true UI responsiveness
 * - Paginated asset collection (250 per page)
 * - Per-file progress updates with throttling
 * - Batched comparison with yields
 * - Proper abort handling
 * - Thermal cooldowns for heavy operations
 */

import { Platform, NativeModules } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { sha256 } from 'js-sha256';
import naclUtil from 'tweetnacl-util';
import { t } from './i18n';
import {
  extractExifForDedup,
  generateExifDedupKeys,
  extractBaseFilename,
  normalizeDateForCompare,
} from './duplicateScanner';
import {
  loadHashCache,
  getCachedHash,
  setCachedHash,
  getAllCachedHashes,
  setAllCachedHashes,
  getCacheStatus,
  flushHashCache,
  abortPreAnalysis,
} from './hashCache';
const { PixelHash, MediaDelete } = NativeModules;

// ============================================================================
// CONSTANTS
// ============================================================================

const PAGE_SIZE = 500; // Assets per page for collection (larger = fewer API calls)
const PROGRESS_THROTTLE_MS = 300; // Throttle progress updates (less frequent = faster)
const YIELD_EVERY_N_FILES = 25; // Yield to UI every N files (higher = faster, less responsive)
const YIELD_EVERY_N_COMPARISONS = 2000; // Yield during O(n²) comparison (higher = faster)
const THERMAL_COOLDOWN_MS = 10; // Cooldown after heavy batches (shorter = faster)
const MAX_SIMILAR_SCAN = 5000; // Max files for similar scan (O(n²) is expensive)

// Hash thresholds
const SIMILAR_THRESHOLD = 24;
const CROSS_PLATFORM_DHASH_THRESHOLD = 1; // 1 bit = ~1.5% tolerance, stricter matching for identical
const EDGE_MATCH_THRESHOLD = 4;
const CORNER_MATCH_THRESHOLD = 3;

// ============================================================================
// YIELDING UTILITIES
// ============================================================================

/**
 * Yield to UI using requestAnimationFrame for true frame-based yielding
 */
const yieldToUi = () => new Promise(resolve => {
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  } else {
    setTimeout(resolve, 16);
  }
});

/**
 * Quick yield for tight loops
 */
const quickYield = () => new Promise(resolve => {
  if (typeof setImmediate !== 'undefined') {
    setImmediate(resolve);
  } else {
    setTimeout(resolve, 0);
  }
});

/**
 * Thermal cooldown after heavy operations
 */
const thermalCooldown = (ms = THERMAL_COOLDOWN_MS) => new Promise(r => setTimeout(r, ms));

// ============================================================================
// PROGRESS UTILITIES
// ============================================================================

let lastProgressUpdate = 0;
let lastStatusUpdate = 0;

const updateProgress = (onProgress, value, force = false) => {
  if (!onProgress) return;
  const now = Date.now();
  if (force || now - lastProgressUpdate >= PROGRESS_THROTTLE_MS) {
    lastProgressUpdate = now;
    onProgress(Math.min(1, Math.max(0, value)));
  }
};

const updateStatus = (onStatus, message, force = false) => {
  if (!onStatus) return;
  const now = Date.now();
  if (force || now - lastStatusUpdate >= PROGRESS_THROTTLE_MS) {
    lastStatusUpdate = now;
    onStatus(message);
  }
};

// ============================================================================
// HASH UTILITIES (copied from original)
// ============================================================================

const hammingDistance64 = (a, b) => {
  if (!a || !b || a.length !== 16 || b.length !== 16) return Number.MAX_SAFE_INTEGER;
  let dist = 0;
  for (let i = 0; i < 16; i += 8) {
    const valA = parseInt(a.substring(i, i + 8), 16);
    const valB = parseInt(b.substring(i, i + 8), 16);
    let x = valA ^ valB;
    while (x) {
      dist += x & 1;
      x >>>= 1;
    }
  }
  return dist;
};

const hammingDistance32 = (a, b) => {
  if (!a || !b || a.length !== 8 || b.length !== 8) return Number.MAX_SAFE_INTEGER;
  const valA = parseInt(a, 16);
  const valB = parseInt(b, 16);
  let x = valA ^ valB;
  let dist = 0;
  while (x) {
    dist += x & 1;
    x >>>= 1;
  }
  return dist;
};

const hammingDistance16 = (a, b) => {
  if (!a || !b || a.length !== 4 || b.length !== 4) return Number.MAX_SAFE_INTEGER;
  const valA = parseInt(a, 16);
  const valB = parseInt(b, 16);
  let x = valA ^ valB;
  let dist = 0;
  while (x) {
    dist += x & 1;
    x >>>= 1;
  }
  return dist;
};

// ============================================================================
// FILE UTILITIES (copied from original)
// ============================================================================

const isImageAsset = (info, asset) => {
  const mt = (info && info.mediaType) || asset.mediaType;
  if (mt === 'photo' || mt === 'image') return true;
  const name = (info && info.filename) || asset.filename || '';
  return /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?|raw|cr2|nef|arw|dng|orf|rw2|pef|srw|raf|psd|psb|exr|hdr|avif)$/i.test(name);
};

const isVideoAsset = (info, asset) => {
  const mt = (info && info.mediaType) || asset.mediaType;
  if (mt === 'video') return true;
  const name = (info && info.filename) || asset.filename || '';
  return /\.(mp4|mov|m4v|avi|mkv|webm|3gp)$/i.test(name);
};

/**
 * Compute exact file hash using chunked streaming (handles large videos)
 */
const computeExactFileHash = async (filePath) => {
  try {
    const hashCtx = sha256.create();
    const HASH_CHUNK_BYTES = 256 * 1024; // 256KB chunks

    if (Platform.OS === 'ios') {
      const fileUri = filePath.startsWith('/') ? `file://${filePath}` : filePath;
      let position = 0;
      // Ensure chunk size is divisible by 3 for base64
      const effectiveBytes = HASH_CHUNK_BYTES - (HASH_CHUNK_BYTES % 3);
      
      while (true) {
        let nextB64 = '';
        try {
          nextB64 = await FileSystem.readAsStringAsync(fileUri, {
            encoding: FileSystem.EncodingType.Base64,
            position,
            length: effectiveBytes
          });
        } catch (e) {
          // Fallback: read entire file (for older expo-file-system)
          const allB64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
          const b64Offset = Math.floor((position / 3) * 4);
          const chunkB64Len = (effectiveBytes / 3) * 4;
          nextB64 = allB64.slice(b64Offset, b64Offset + chunkB64Len);
        }
        if (!nextB64) break;
        const plaintext = naclUtil.decodeBase64(nextB64);
        if (!plaintext || plaintext.length === 0) break;
        hashCtx.update(plaintext);
        position += plaintext.length;
        if (plaintext.length < effectiveBytes) break;
        
        // Yield between chunks for large files
        await quickYield();
      }
    } else {
      // Android: use react-native-blob-util for streaming
      let ReactNativeBlobUtil = null;
      try {
        const mod = require('react-native-blob-util');
        ReactNativeBlobUtil = mod && (mod.default || mod);
      } catch (e) {}
      
      if (!ReactNativeBlobUtil || !ReactNativeBlobUtil.fs || typeof ReactNativeBlobUtil.fs.readStream !== 'function') {
        // Fallback: read entire file (may fail for large videos)
        const fileUri = filePath.startsWith('/') ? `file://${filePath}` : filePath;
        const b64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
        const bytes = naclUtil.decodeBase64(b64);
        return sha256(bytes);
      }
      
      const stream = await ReactNativeBlobUtil.fs.readStream(filePath, 'base64', HASH_CHUNK_BYTES);
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
                hashCtx.update(plaintext);
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
    return hashCtx.hex();
  } catch (e) {
    console.warn('[DupScanner] computeExactFileHash failed:', e?.message || e);
    return null;
  }
};

/**
 * Resolve readable file path for an asset
 * Handles ph://, content://, file:// URIs properly
 */
const getHashTarget = async ({ asset, info, resolveReadableFilePath }) => {
  let hashTarget = null;
  let tmpCopied = false;
  let tmpUri = null;
  const rawUri = (info && (info.localUri || info.uri)) || asset.uri || null;

  const asFileUri = (p) => {
    if (!p || typeof p !== 'string') return null;
    if (p.startsWith('file://')) return p;
    if (p.startsWith('/')) return `file://${p}`;
    return p;
  };

  const hasNonEmptyFile = async (p) => {
    try {
      const uri = asFileUri(p);
      if (!uri) return false;
      const inf = await FileSystem.getInfoAsync(uri, { size: true });
      if (!inf?.exists) return false;
      if (typeof inf?.size === 'number' && inf.size <= 0) return false;
      return true;
    } catch (e) {
      return true;
    }
  };

  try {
    if (rawUri && typeof rawUri === 'string') {
      if (rawUri.startsWith('file://') || rawUri.startsWith('/')) {
        // Direct file path - use as-is
        hashTarget = rawUri.startsWith('file://') ? rawUri.replace('file://', '') : rawUri;
        // Clean up query/fragment
        const hashIdx = hashTarget.indexOf('#');
        if (hashIdx !== -1) hashTarget = hashTarget.slice(0, hashIdx);
        const qIdx = hashTarget.indexOf('?');
        if (qIdx !== -1) hashTarget = hashTarget.slice(0, qIdx);
        try { hashTarget = decodeURI(hashTarget); } catch (e) {}
      } else if (rawUri.startsWith('ph://') || rawUri.startsWith('content://')) {
        // Need to stage to temp file via resolveReadableFilePath
        if (resolveReadableFilePath && typeof resolveReadableFilePath === 'function') {
          try {
            const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo: info });
            if (resolved && resolved.filePath) {
              hashTarget = resolved.filePath;
              tmpCopied = !!resolved.tmpCopied;
              tmpUri = resolved.tmpUri || null;
            }
          } catch (e) {
            // iOS fallback: try with shouldDownloadFromNetwork
            if (Platform.OS === 'ios') {
              try {
                const infoDownloaded = await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: true });
                const dlUri = infoDownloaded?.localUri || infoDownloaded?.uri;
                if (dlUri && typeof dlUri === 'string' && (dlUri.startsWith('file://') || dlUri.startsWith('/'))) {
                  hashTarget = dlUri.startsWith('file://') ? dlUri.replace('file://', '') : dlUri;
                } else {
                  const resolved2 = await resolveReadableFilePath({ assetId: asset.id, assetInfo: infoDownloaded });
                  if (resolved2 && resolved2.filePath) {
                    hashTarget = resolved2.filePath;
                    tmpCopied = !!resolved2.tmpCopied;
                    tmpUri = resolved2.tmpUri || null;
                  }
                }
              } catch (e2) {
                // Failed to get readable path
              }
            }
          }
        }
      }
    }
    
    // Fallback: try resolveReadableFilePath directly
    if (!hashTarget && resolveReadableFilePath && typeof resolveReadableFilePath === 'function') {
      try {
        const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo: info });
        if (resolved && resolved.filePath) {
          hashTarget = resolved.filePath;
          tmpCopied = !!resolved.tmpCopied;
          tmpUri = resolved.tmpUri || null;
        }
      } catch (e) {
        // Silent fail
      }
    }
  } catch (e) {
    // Silent fail
  }

  if (hashTarget) {
    const ok = await hasNonEmptyFile(hashTarget);
    if (!ok && resolveReadableFilePath && typeof resolveReadableFilePath === 'function') {
      try {
        const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo: info });
        if (resolved && resolved.filePath) {
          hashTarget = resolved.filePath;
          tmpCopied = !!resolved.tmpCopied;
          tmpUri = resolved.tmpUri || null;
        }
      } catch (e) {
        // Silent fail
      }
    }
    const ok2 = await hasNonEmptyFile(hashTarget);
    if (!ok2) {
      hashTarget = null;
      tmpCopied = false;
      tmpUri = null;
    }
  }

  return { hashTarget, tmpCopied, tmpUri, rawUri };
};

// ============================================================================
// OPTIMIZED ASSET COLLECTION
// ============================================================================

/**
 * Collect assets with pagination and proper yielding
 * Excludes PhotoLynkDeleted album (Android only) to avoid re-detecting moved duplicates
 * Matches backup collection logic exactly for consistent file counts
 */
const collectAssetsPaged = async ({
  includeVideos = true,
  onStatus,
  onProgress,
  progressStart = 0,
  progressEnd = 0.1,
  analyzingTotalStatusKey = 'status.scanningAnalyzingTotal',
  abortRef,
  statusPrefix = 'Comparing',
}) => {
  const mediaTypes = includeVideos ? ['photo', 'video'] : ['photo'];
  const allAssets = [];
  const seenIds = new Set();
  let after = null;
  
  // Get PhotoLynkDeleted album asset IDs to exclude (Android only - iOS uses Recently Deleted which is auto-excluded)
  let photoLynkDeletedAssetIds = new Set();
  if (Platform.OS === 'android') {
    try {
      const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: false });
      const deletedAlbum = albums.find(a => a.title === 'PhotoLynkDeleted');
      if (deletedAlbum) {
        let deletedAfter = null;
        while (true) {
          const deletedPage = await MediaLibrary.getAssetsAsync({
            first: PAGE_SIZE,
            after: deletedAfter || undefined,
            album: deletedAlbum.id,
            mediaType: mediaTypes,
          });
          if (deletedPage?.assets) {
            for (const asset of deletedPage.assets) {
              photoLynkDeletedAssetIds.add(asset.id);
            }
          }
          deletedAfter = deletedPage?.endCursor;
          if (!deletedPage?.hasNextPage) break;
          if (!deletedPage?.assets?.length) break;
        }
        console.log('[DupScanner] Excluding', photoLynkDeletedAssetIds.size, 'assets from PhotoLynkDeleted');
      }
    } catch (e) {
      console.log('[DupScanner] Could not get PhotoLynkDeleted album:', e?.message);
    }
  }
  
  // Show scanning status
  updateStatus(onStatus, t('status.scanningCollecting'), true);
  updateProgress(onProgress, progressStart, true);

  // Phase 1: Collect from main library (paged) - matches backup exactly
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
      // Skip assets in PhotoLynkDeleted album (Android)
      if (photoLynkDeletedAssetIds.has(asset.id)) continue;
      if (!seenIds.has(asset.id)) {
        seenIds.add(asset.id);
        allAssets.push(asset);
      }
    }

    // Update status with actual collected count
    updateStatus(onStatus, t(analyzingTotalStatusKey, { total: allAssets.length }));

    after = page?.endCursor;
    if (!page?.hasNextPage) break;
    if (assets.length === 0) break;
    await yieldToUi();
  }

  // Phase 2: Scan ALL albums to catch Screenshots, Downloads, WhatsApp, user folders, etc.
  try {
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    for (let i = 0; i < albums.length; i++) {
      if (abortRef?.current) return { assets: allAssets, aborted: true };

      const album = albums[i];
      
      // Skip PhotoLynkDeleted album entirely (Android)
      if (album.title === 'PhotoLynkDeleted') continue;
      
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
            // Skip assets in PhotoLynkDeleted album (Android)
            if (photoLynkDeletedAssetIds.has(asset.id)) continue;
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

      // Yield every few albums and update status
      if (i % 5 === 0) {
        await yieldToUi();
        updateStatus(onStatus, t(analyzingTotalStatusKey, { total: allAssets.length }));
      }
    }
  } catch (e) {
    console.log('[DupScanner] Album scan error:', e?.message);
  }

  // Final status with actual total
  updateStatus(onStatus, t(analyzingTotalStatusKey, { total: allAssets.length }));
  updateProgress(onProgress, progressEnd, true);
  console.log('[DupScanner] Total assets collected:', allAssets.length);
  return { assets: allAssets, aborted: false };
};

// ============================================================================
// OPTIMIZED EXACT DUPLICATES SCAN
// ============================================================================

/**
 * Scan for exact duplicates with proper yielding and progress
 * 
 * Progress phases:
 * - 0-10%: Collecting assets
 * - 10-90%: Hashing files (per-file progress)
 * - 90-95%: Grouping duplicates
 * - 95-100%: Finalizing
 */
export const scanExactDuplicates = async ({
  resolveReadableFilePath,
  onProgress,
  onStatus,
  abortRef,
  includeVideos = true,
}) => {
  console.log('[DupScanner] Starting optimized exact duplicate scan');
  
  // Abort any running background pre-analysis to avoid race conditions
  abortPreAnalysis();
  
  // Load hash cache for faster subsequent runs
  await loadHashCache();
  
  const hasPixelHash = PixelHash && typeof PixelHash.hashImagePixels === 'function';
  if (!hasPixelHash) {
    console.warn('[DupScanner] PixelHash not available - videos only');
  }

  // Reset throttle timestamps
  lastProgressUpdate = 0;
  lastStatusUpdate = 0;

  // ========== PHASE 1: Collect Assets (0-10%) ==========
  updateStatus(onStatus, t('status.scanningCollecting'), true);
  updateProgress(onProgress, 0.01, true);

  const { assets: allAssets, aborted: collectAborted } = await collectAssetsPaged({
    includeVideos,
    onStatus,
    onProgress,
    progressStart: 0.01,
    progressEnd: 0.10,
    analyzingTotalStatusKey: 'status.scanningAnalyzingTotalPhotos',
    abortRef,
    statusPrefix: 'Scanning',
  });

  if (collectAborted) {
    return { duplicateGroups: [], stats: {}, aborted: true };
  }

  const totalAssets = allAssets.length;
  console.log('[DupScanner] Collected', totalAssets, 'assets');

  if (totalAssets === 0) {
    updateProgress(onProgress, 1, true);
    return { duplicateGroups: [], stats: { totalAssets: 0, hashedCount: 0 }, aborted: false };
  }

  // ========== PHASE 2: Hash Files (10-90%) ==========
  updateStatus(onStatus, t('status.scanningAnalyzingTotalPhotos', { total: totalAssets }), true);
  updateProgress(onProgress, 0.10, true);

  // Memory-optimized: Store only minimal data needed for grouping
  // Full asset/info objects are fetched only for final duplicate groups
  const allHashedItems = []; // Minimal items: { id, fileHashHex, rawDHash, isVideo, exifKeys, baseName, originalSize, dateStr, filename, creationTime }
  const assetLookup = new Map(); // id -> { asset, info } - only populated for items in duplicate groups later
  let hashedCount = 0;
  let hashSkipped = 0;
  let hashFailed = 0;
  let inspectFailed = 0;
  let photoCount = 0;
  let videoCount = 0;

  let icloudDownloadCount = 0;

  for (let i = 0; i < totalAssets; i++) {
    if (abortRef?.current) {
      return { duplicateGroups: [], stats: {}, aborted: true };
    }

    const asset = allAssets[i];
    const current = i + 1;

    // Update progress every 5 files, yield every 25 (fast but responsive)
    // Progress: 10% to 90% during hashing
    if (i % 5 === 0 || i === totalAssets - 1) {
      const fileProgress = 0.10 + (i / totalAssets) * 0.80;
      updateProgress(onProgress, fileProgress);
      // Show iCloud download count if any files are being downloaded
      if (Platform.OS === 'ios' && icloudDownloadCount > 0) {
        updateStatus(onStatus, t('status.scanningWithICloud', { current, total: totalAssets, icloudCount: icloudDownloadCount }));
      } else {
        updateStatus(onStatus, t('status.scanningAnalyzingProgress', { current, total: totalAssets }));
      }
      if (i % 25 === 0) await yieldToUi();
    }

    // Get asset info
    let info;
    try {
      // First check if file is local (quick check without download)
      if (Platform.OS === 'ios') {
        const quickInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
        if (!quickInfo?.localUri && quickInfo?.uri) {
          // File needs iCloud download
          icloudDownloadCount++;
          updateStatus(onStatus, t('status.scanningWithICloud', { current, total: totalAssets, icloudCount: icloudDownloadCount }));
          await yieldToUi();
        }
        // Now download if needed
        info = await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: true });
      } else {
        info = await MediaLibrary.getAssetInfoAsync(asset.id);
      }
    } catch (e) {
      inspectFailed++;
      continue;
    }

    const isVideo = isVideoAsset(info, asset);
    const isImage = isImageAsset(info, asset);

    if (!isImage && !isVideo) {
      hashSkipped++;
      continue;
    }

    if (isVideo && !includeVideos) {
      hashSkipped++;
      continue;
    }

    if (isImage && !hasPixelHash) {
      hashSkipped++;
      continue;
    }

    // Get readable file path
    const { hashTarget, tmpCopied, tmpUri } = await getHashTarget({
      asset,
      info,
      resolveReadableFilePath,
    });

    if (!hashTarget) {
      hashSkipped++;
      continue;
    }

    try {
      let fileHashHex = null;
      let dHashHex = null;

      // Check cache first for faster subsequent runs
      const cachedFileHash = getCachedHash(asset, 'file');
      const cachedDHash = getCachedHash(asset, 'perceptual');

      if (isVideo) {
        // Videos: use exact file hash (SHA-256) only
        if (cachedFileHash) {
          fileHashHex = 'video:' + cachedFileHash;
          videoCount++;
        } else {
          fileHashHex = await computeExactFileHash(hashTarget);
          if (fileHashHex) {
            setCachedHash(asset, 'file', fileHashHex); // Cache for next run
            fileHashHex = 'video:' + fileHashHex;
            videoCount++;
          }
        }
      } else {
        // Images: use perceptual dHash only (catches visually identical photos)
        // dHash is resistant to compression, re-encoding, and minor edits
        if (hasPixelHash) {
          if (cachedDHash) {
            dHashHex = 'dhash:' + cachedDHash;
            photoCount++;
          } else {
            try {
              const dHash = await PixelHash.hashImagePixels(hashTarget);
              if (dHash) {
                setCachedHash(asset, 'perceptual', dHash); // Cache for next run
                dHashHex = 'dhash:' + dHash;
                photoCount++;
              }
            } catch (e) {
              // dHash failed
            }
          }
        }

        if (!dHashHex) {
          if (cachedFileHash) {
            fileHashHex = 'file:' + cachedFileHash;
          } else {
            const fh = await computeExactFileHash(hashTarget);
            if (fh) {
              setCachedHash(asset, 'file', fh);
              fileHashHex = 'file:' + fh;
            }
          }
        }
      }

      // Group by BOTH hashes - an image can be in multiple groups
      // This allows matching by either file hash OR perceptual hash
      if (!fileHashHex && !dHashHex) {
        hashFailed++;
        // Debug log for hash failures
        if (hashFailed <= 5) {
          console.log('[DupScanner] Hash failed for:', info?.filename || asset.filename, isVideo ? '(video)' : '(image)');
        }
      } else {
        hashedCount++;
        
        // Store item with both hashes for later grouping
        const rawDHash = dHashHex ? dHashHex.substring(6) : null;
        const rawFileHash = fileHashHex ? fileHashHex.substring(fileHashHex.indexOf(':') + 1) : null;
        const filename = info?.filename || asset.filename || '';
        const creationTime = info?.creationTime || asset.creationTime || 0;
        const originalSize = info?.fileSize || asset.fileSize || 0;
        const itemId = asset.id;
        
        allHashedItems.push({
          id: itemId,
          fileHashHex,
          rawFileHash,
          rawDHash,
          isVideo: fileHashHex && fileHashHex.startsWith('video:'),
          creationTime,
        });
        
        // Store minimal asset reference for later (only id and uri needed for review)
        assetLookup.set(itemId, {
          id: itemId,
          uri: info?.localUri || info?.uri || asset.uri || '',
          filename,
          creationTime,
          fileSize: originalSize,
        });
      }
    } catch (e) {
      hashFailed++;
      console.warn('[DupScanner] Hash error:', info?.filename || asset.filename, e?.message);
    } finally {
      if (tmpCopied && tmpUri) {
        try { await FileSystem.deleteAsync(tmpUri, { idempotent: true }); } catch (e) {}
      }
    }

    // Thermal cooldown every 100 files
    if (i > 0 && i % 100 === 0) {
      await thermalCooldown();
    }
  }

  // ========== PHASE 3: Group Duplicates using Union-Find (90-95%) ==========
  updateStatus(onStatus, t('status.scanningFindingGroups'), true);
  updateProgress(onProgress, 0.90, true);
  await yieldToUi();

  // Union-Find for proper transitive grouping
  const parent = new Map();
  const rank = new Map();
  
  const find = (x) => {
    if (!parent.has(x)) { parent.set(x, x); rank.set(x, 0); }
    if (parent.get(x) !== x) { parent.set(x, find(parent.get(x))); }
    return parent.get(x);
  };
  
  const union = (x, y) => {
    const px = find(x);
    const py = find(y);
    if (px === py) return;
    const rx = rank.get(px) || 0;
    const ry = rank.get(py) || 0;
    if (rx < ry) { parent.set(px, py); }
    else if (rx > ry) { parent.set(py, px); }
    else { parent.set(py, px); rank.set(px, rx + 1); }
  };

  // Group by exact file hash first (O(n) - fast)
  const fileHashGroups = {};
  for (const item of allHashedItems) {
    if (item.fileHashHex) {
      if (!fileHashGroups[item.fileHashHex]) fileHashGroups[item.fileHashHex] = [];
      fileHashGroups[item.fileHashHex].push(item);
    }
  }
  
  // Union items with same file hash
  for (const group of Object.values(fileHashGroups)) {
    if (group.length > 1) {
      for (let i = 1; i < group.length; i++) {
        union(group[0].id, group[i].id);
      }
    }
  }

  await quickYield();

  // Fuzzy dHash comparison (O(n²) but only for images with dHash)
  // Limit to prevent memory/CPU exhaustion with very large libraries
  const MAX_DHASH_COMPARE = 3000;
  let itemsWithDHash = allHashedItems.filter(item => item.rawDHash && !item.isVideo);
  
  if (itemsWithDHash.length > MAX_DHASH_COMPARE) {
    console.log(`[DupScanner] Limiting dHash comparison from ${itemsWithDHash.length} to ${MAX_DHASH_COMPARE} items`);
    // Sort by creation time and take most recent
    itemsWithDHash.sort((a, b) => (b.creationTime || 0) - (a.creationTime || 0));
    itemsWithDHash = itemsWithDHash.slice(0, MAX_DHASH_COMPARE);
  }
  
  console.log('[DupScanner] Items with dHash for comparison:', itemsWithDHash.length, 'out of', allHashedItems.length, 'total');
  let comparisons = 0;
  let matchesFound = 0;
  
  // Process in batches to avoid memory pressure
  const BATCH_SIZE = 500;
  for (let batchStart = 0; batchStart < itemsWithDHash.length; batchStart += BATCH_SIZE) {
    if (abortRef?.current) break;
    
    const batchEnd = Math.min(batchStart + BATCH_SIZE, itemsWithDHash.length);
    
    for (let i = batchStart; i < batchEnd; i++) {
      for (let j = i + 1; j < itemsWithDHash.length; j++) {
        const dist = hammingDistance64(itemsWithDHash[i].rawDHash, itemsWithDHash[j].rawDHash);
        
        if (dist <= CROSS_PLATFORM_DHASH_THRESHOLD) {
          union(itemsWithDHash[i].id, itemsWithDHash[j].id);
          matchesFound++;
          if (matchesFound <= 5) {
            console.log('[DupScanner] Match found:', itemsWithDHash[i].filename, 'vs', itemsWithDHash[j].filename, 'dist:', dist);
          }
        }
        comparisons++;
        
        // Yield less frequently for better performance
        if (comparisons % 5000 === 0) {
          await quickYield();
        }
      }
    }
    
    // Yield and update progress between batches
    await yieldToUi();
    const batchProgress = 0.90 + (batchEnd / itemsWithDHash.length) * 0.05;
    updateProgress(onProgress, batchProgress);
  }

  console.log('[DupScanner] Comparisons:', comparisons, 'Matches found:', matchesFound, 'Threshold:', CROSS_PLATFORM_DHASH_THRESHOLD);

  // Build groups from Union-Find
  const groupMap = new Map();
  
  for (const item of allHashedItems) {
    const root = find(item.id);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root).push(item);
  }

  // Convert to duplicate groups (only groups with >1 item)
  const duplicateGroups = [];
  for (const group of groupMap.values()) {
    if (group.length > 1) {
      // Sort by creation time (oldest first)
      group.sort((a, b) => {
        const aTime = a.creationTime || 0;
        const bTime = b.creationTime || 0;
        return aTime - bTime;
      });
      
      // Enrich with asset lookup data for review UI
      // assetLookup contains: { id, uri, filename, creationTime, fileSize }
      const enrichedGroup = group.map(item => {
        const lookup = assetLookup.get(item.id);
        return {
          asset: { id: item.id, uri: lookup?.uri || '' },
          info: {
            filename: lookup?.filename || item.filename,
            creationTime: lookup?.creationTime || item.creationTime,
            fileSize: lookup?.fileSize || item.originalSize,
            uri: lookup?.uri || '',
            localUri: lookup?.uri || '',
          },
          creationTime: item.creationTime,
        };
      });
      duplicateGroups.push(enrichedGroup);
      
      // Debug: log first few duplicate groups found
      if (duplicateGroups.length <= 3) {
        console.log('[DupScanner] Duplicate group found:', {
          count: group.length,
          files: group.map(g => g.filename).join(', '),
        });
      }
    }
  }

  // ========== PHASE 4: Finalize (95-100%) ==========
  updateStatus(onStatus, t('status.scanningFinalizing'), true);
  updateProgress(onProgress, 0.95, true);
  await yieldToUi();
  
  // Memory cleanup: clear large arrays/maps before UI renders
  // This frees significant memory with large photo libraries
  allHashedItems.length = 0;
  assetLookup.clear();
  groupMap.clear();
  parent.clear();
  rank.clear();
  itemsWithDHash.length = 0;
  
  // Small delay before final result for smooth UX
  await new Promise(r => setTimeout(r, 200));
  
  updateStatus(onStatus, duplicateGroups.length > 0 ? t('status.scanningFoundDuplicates', { count: duplicateGroups.length }) : t('status.scanningNoDuplicates'), true);
  updateProgress(onProgress, 1, true);

  const dHashCount = comparisons > 0 ? Math.ceil(Math.sqrt(comparisons * 2)) : 0; // Approximate from comparisons
  console.log('[DupScanner] Exact scan complete:', {
    totalAssets,
    hashedCount,
    photoCount,
    videoCount,
    hashSkipped,
    hashFailed,
    dHashCompared: dHashCount,
    comparisons,
    duplicateGroups: duplicateGroups.length,
  });

  // Flush cache to disk
  await flushHashCache();

  return {
    duplicateGroups,
    stats: {
      totalAssets,
      hashedCount,
      hashSkipped,
      hashFailed,
      inspectFailed,
      photoCount,
      videoCount,
    },
    aborted: false,
  };
};

// ============================================================================
// OPTIMIZED SIMILAR PHOTOS SCAN
// ============================================================================

/**
 * Scan for similar photos with proper yielding and progress
 * 
 * Progress phases:
 * - 0-10%: Collecting assets
 * - 10-60%: Hashing files (per-file progress)
 * - 60-90%: Comparing hashes (O(n²) with yields)
 * - 90-100%: Clustering and finalizing
 */
export const scanSimilarPhotos = async ({
  resolveReadableFilePath,
  onProgress,
  onStatus,
  onCollecting,
  onFindingMatches,
  abortRef,
  includeVideos = true,
}) => {
  console.log('[DupScanner] Starting optimized similar photos scan');

  // Abort any running background pre-analysis to avoid race conditions
  abortPreAnalysis();

  // Load hash cache for faster subsequent runs
  await loadHashCache();

  const hasPixelHash = PixelHash && typeof PixelHash.hashImagePixels === 'function';
  if (!hasPixelHash) {
    console.warn('[DupScanner] PixelHash not available - videos only');
  }

  // Reset throttle timestamps
  lastProgressUpdate = 0;
  lastStatusUpdate = 0;

  // ========== PHASE 1: Collect Assets (0-10%) ==========
  if (onCollecting) onCollecting();
  updateStatus(onStatus, t('status.scanningCollecting'), true);
  updateProgress(onProgress, 0.01, true);

  const { assets: allAssets, aborted: collectAborted } = await collectAssetsPaged({
    includeVideos,
    onStatus,
    onProgress,
    progressStart: 0.01,
    progressEnd: 0.10,
    analyzingTotalStatusKey: 'status.scanningAnalyzingTotalPhotos',
    abortRef,
    statusPrefix: 'Scanning',
  });

  if (collectAborted) {
    return { groups: [], aborted: true };
  }

  // Limit for O(n²) comparison
  let assets = allAssets;
  if (assets.length > MAX_SIMILAR_SCAN) {
    console.log(`[DupScanner] Limiting to ${MAX_SIMILAR_SCAN} most recent files`);
    // Sort by creation time descending, take most recent
    assets.sort((a, b) => (b.creationTime || 0) - (a.creationTime || 0));
    assets = assets.slice(0, MAX_SIMILAR_SCAN);
  }

  // Sort by creation time ascending for burst detection
  assets.sort((a, b) => (a.creationTime || 0) - (b.creationTime || 0));

  const totalAssets = assets.length;
  console.log('[DupScanner] Processing', totalAssets, 'assets for similar scan');

  if (totalAssets === 0) {
    updateProgress(onProgress, 1, true);
    return { groups: [], aborted: false };
  }

  // ========== PHASE 2: Hash Files (10-60%) ==========
  updateStatus(onStatus, t('status.scanningAnalyzingTotalPhotos', { total: totalAssets }), true);
  updateProgress(onProgress, 0.10, true);

  const items = [];
  let hashed = 0;
  let hashFailed = 0;

  for (let i = 0; i < totalAssets; i++) {
    if (abortRef?.current) {
      return { groups: [], aborted: true };
    }

    const asset = assets[i];

    // Update progress every 5 files, yield every 25 (fast but responsive)
    // Progress: 10% to 60% during hashing
    if (i % 5 === 0) {
      const fileProgress = 0.10 + (i / totalAssets) * 0.50;
      updateProgress(onProgress, fileProgress);
      updateStatus(onStatus, t('status.scanningAnalyzingProgressPhotos', { current: i + 1, total: totalAssets }));
      if (i % 25 === 0) await yieldToUi();
    }

    let info = null;
    let hash = null;
    let edgeHash = null;
    let cornerHash = null;
    let isVideo = false;

    try {
      info = await MediaLibrary.getAssetInfoAsync(
        asset.id,
        Platform.OS === 'ios' ? { shouldDownloadFromNetwork: true } : undefined
      );

      isVideo = isVideoAsset(info, asset);
      const isImage = isImageAsset(info, asset);

      if (!isImage && !isVideo) continue;
      if (isImage && !hasPixelHash) continue;

      const { hashTarget, tmpCopied, tmpUri } = await getHashTarget({
        asset,
        info,
        resolveReadableFilePath,
      });

      if (hashTarget) {
        try {
          // Check cache first for faster subsequent runs
          const cachedHash = isVideo ? getCachedHash(asset, 'file') : getCachedHash(asset, 'perceptual');
          
          if (cachedHash) {
            hash = isVideo ? 'video:' + cachedHash : 'image:' + cachedHash;
            hashed++;
          } else if (isVideo) {
            hash = await computeExactFileHash(hashTarget);
            if (hash) {
              setCachedHash(asset, 'file', hash); // Cache for next run
              hash = 'video:' + hash;
              hashed++;
            }
          } else if (hasPixelHash) {
            hash = await PixelHash.hashImagePixels(hashTarget);
            if (hash) {
              setCachedHash(asset, 'perceptual', hash); // Cache for next run
              hash = 'image:' + hash;
              hashed++;
              
            }
          }
        } catch (e) {
          hashFailed++;
        } finally {
          if (tmpCopied && tmpUri) {
            try { await FileSystem.deleteAsync(tmpUri, { idempotent: true }); } catch (e) {}
          }
        }
      }
    } catch (e) {
      hashFailed++;
    }

    if (hash) {
      // Try to get EXIF DateTimeOriginal for accurate capture time
      // Falls back to asset.creationTime (OS file time) if EXIF not available
      let createdTs = 0;
      let hasExifTime = false; // Only true if we found actual EXIF date fields
      const exif = info?.exif;
      if (exif) {
        // Try various EXIF date fields (different naming conventions on iOS/Android)
        const exifDate = exif.DateTimeOriginal || exif.DateTimeDigitized || exif.DateTime ||
                         exif.dateTimeOriginal || exif.dateTimeDigitized || exif.dateTime ||
                         exif['{Exif}']?.DateTimeOriginal || exif['{Exif}']?.DateTimeDigitized ||
                         exif.CreateDate || exif.createDate;
        if (exifDate && typeof exifDate === 'string') {
          // EXIF format: "2024:01:15 14:30:00" or "2024-01-15T14:30:00"
          try {
            const parsed = new Date(exifDate.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
            if (!isNaN(parsed.getTime())) {
              createdTs = parsed.getTime();
              hasExifTime = true; // Only set true when actual EXIF date found
            }
          } catch (e) {}
        }
      }
      // Fallback to info.creationTime (NOT reliable EXIF - just file system time)
      if (!createdTs && info?.creationTime) {
        const ct = typeof info.creationTime === 'number' ? info.creationTime : 
                   (info.creationTime ? new Date(info.creationTime).getTime() : 0);
        if (ct > 0) createdTs = ct;
        // hasExifTime stays false - this is file system time, not EXIF
      }
      
      // Helper to parse timestamp from various formats (ms, seconds, Date string)
      const parseTs = (val) => {
        if (!val) return 0;
        if (typeof val === 'number') {
          // Android MediaStore uses seconds, JS uses milliseconds
          // If value is less than year 2000 in ms, it's probably seconds
          if (val > 0 && val < 946684800000) return val * 1000; // Convert seconds to ms
          return val > 0 ? val : 0;
        }
        const parsed = new Date(val).getTime();
        return (!isNaN(parsed) && parsed > 0) ? parsed : 0;
      };
      
      // Try multiple timestamp sources (different Android manufacturers use different fields)
      // Priority: asset.creationTime -> info.modificationTime -> asset.modificationTime
      if (!createdTs) createdTs = parseTs(asset.creationTime);
      if (!createdTs) createdTs = parseTs(info?.modificationTime);
      if (!createdTs) createdTs = parseTs(asset.modificationTime);
      
      // Debug log first few items to verify timestamp detection
      if (hashed <= 3) {
        console.log(`[DupScanner] Time debug for ${info?.filename || asset.filename}: hasExifTime=${hasExifTime}, createdTs=${createdTs}, asset.creationTime=${asset.creationTime}, asset.modificationTime=${asset.modificationTime}`);
      }
      
      items.push({
        asset,
        info,
        hash,
        isVideo,
        edgeHash: edgeHash || null,
        cornerHash: cornerHash || null,
        createdTs,
        hasExifTime, // Track if we have reliable EXIF timestamp
        filename: info?.filename || asset.filename || '',
      });
    }

    // Thermal cooldown every 100 files
    if (i > 0 && i % 100 === 0) {
      await thermalCooldown();
    }
  }

  console.log('[DupScanner] Hashed', hashed, 'items, failed', hashFailed);

  // ========== PHASE 3: Compare Hashes (60-90%) ==========
  if (onFindingMatches) onFindingMatches();
  updateStatus(onStatus, t('status.scanningComparingSimilar'), true);
  updateProgress(onProgress, 0.60, true);

  const similarPairs = [];
  const seen = new Set();
  const totalComparisons = (items.length * (items.length - 1)) / 2;
  let comparisonsDone = 0;

  for (let i = 0; i < items.length; i++) {
    if (abortRef?.current) {
      return { groups: [], aborted: true };
    }

    const a = items[i];

    for (let j = i + 1; j < items.length; j++) {
      comparisonsDone++;

      // Yield every N comparisons
      if (comparisonsDone % YIELD_EVERY_N_COMPARISONS === 0) {
        await quickYield();
        
        // Update progress (60-90%)
        const compareProgress = 0.60 + (comparisonsDone / totalComparisons) * 0.30;
        updateProgress(onProgress, compareProgress);
        updateStatus(onStatus, t('status.scanningComparingPairs', { current: Math.round(comparisonsDone / 1000), total: Math.round(totalComparisons / 1000) }));
      }

      const b = items[j];

      // Videos: exact match only
      if (a.isVideo || b.isVideo) {
        if (a.isVideo && b.isVideo && a.hash === b.hash) {
          const key = [a.asset.id, b.asset.id].sort().join('|');
          if (!seen.has(key)) {
            seen.add(key);
            similarPairs.push({ a, b, dist: 0, isVideoMatch: true });
          }
        }
        continue;
      }

      // Images: perceptual hash comparison
      const aHash = a.hash.startsWith('image:') ? a.hash.substring(6) : a.hash;
      const bHash = b.hash.startsWith('image:') ? b.hash.substring(6) : b.hash;

      const dist = hammingDistance64(aHash, bHash);
      
      // Calculate time difference for threshold selection
      const dt = Math.abs((a.createdTs || 0) - (b.createdTs || 0));
      
      // Determine threshold based on time proximity (scaled for 64-bit dHash)
      // More lenient for burst shots, stricter for photos taken far apart
      const bothHaveExif = a.hasExifTime && b.hasExifTime;
      
      let threshold;
      if (bothHaveExif) {
        // Both have reliable EXIF timestamps - use full time-based thresholds
        if (dt <= 30000) {
          // Within 30 seconds - burst shots
          threshold = 18;
        } else if (dt <= 1800000) {
          // Within 30 minutes
          threshold = 14;
        } else if (dt <= 14400000) {
          // Within 4 hours
          threshold = 10;
        } else {
          // More than 4 hours apart
          threshold = 6;
        }
      } else {
        // No EXIF - use system timestamp with same timings but existing stricter thresholds
        if (dt <= 30000) {
          // Within 30 seconds
          threshold = 12;
        } else if (dt <= 1800000) {
          // Within 30 minutes
          threshold = 9;
        } else if (dt <= 14400000) {
          // Within 4 hours
          threshold = 6;
        } else {
          // More than 4 hours apart
          threshold = 3;
        }
      }
      
      // Check if similar by dHash with time-based threshold
      let isSimilar = dist <= threshold;

      if (!isSimilar) continue;

      // Debug log matches to verify thresholds are working
      if (similarPairs.length < 5) {
        console.log(`[DupScanner] MATCH: ${a.filename} vs ${b.filename} dist=${dist} threshold=${threshold} bothExif=${bothHaveExif} dt=${Math.round(dt/1000)}s`);
      }

      const key = [a.asset.id, b.asset.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);

      similarPairs.push({ a, b, dist, dt });
    }

    // Thermal cooldown every 200 outer iterations
    if (i > 0 && i % 200 === 0) {
      await thermalCooldown();
    }
  }

  console.log('[DupScanner] Found', similarPairs.length, 'similar pairs');

  // ========== PHASE 4: Cluster Groups (90-100%) ==========
  updateStatus(onStatus, t('status.scanningGroupingSimilar'), true);
  updateProgress(onProgress, 0.90, true);
  await yieldToUi();

  // Union-Find clustering
  const parent = new Map();
  const rank = new Map();

  const find = (x) => {
    if (!parent.has(x)) { parent.set(x, x); rank.set(x, 0); }
    if (parent.get(x) !== x) { parent.set(x, find(parent.get(x))); }
    return parent.get(x);
  };

  const union = (x, y) => {
    const px = find(x);
    const py = find(y);
    if (px === py) return;
    const rx = rank.get(px) || 0;
    const ry = rank.get(py) || 0;
    if (rx < ry) parent.set(px, py);
    else if (rx > ry) parent.set(py, px);
    else { parent.set(py, px); rank.set(px, rx + 1); }
  };

  const assetMap = new Map();
  const itemMap = new Map(); // Map asset.id -> item (with hash info)
  for (const item of items) {
    assetMap.set(item.asset.id, item.asset);
    itemMap.set(item.asset.id, item);
  }

  // Build adjacency list of direct matches (not transitive)
  const directMatches = new Map(); // id -> Set of directly matched ids
  for (const pair of similarPairs) {
    const aId = pair.a.asset.id;
    const bId = pair.b.asset.id;
    if (!directMatches.has(aId)) directMatches.set(aId, new Set());
    if (!directMatches.has(bId)) directMatches.set(bId, new Set());
    directMatches.get(aId).add(bId);
    directMatches.get(bId).add(aId);
  }

  await quickYield();

  // Build groups where ALL members are similar to each other (clique-based)
  // Start with each pair and only add items that match ALL existing group members
  const usedIds = new Set();
  const finalGroups = [];
  
  // Sort pairs by distance (tightest matches first)
  const sortedPairs = [...similarPairs].sort((a, b) => a.dist - b.dist);
  
  for (const pair of sortedPairs) {
    const aId = pair.a.asset.id;
    const bId = pair.b.asset.id;
    
    // Skip if either item is already used in a group
    // This prevents items from being in multiple groups
    if (usedIds.has(aId) || usedIds.has(bId)) continue;
    
    // Start a new group with this pair
    const group = [aId, bId];
    const groupSet = new Set(group);
    
    // Try to expand group with items that match ALL current members
    const candidates = new Set();
    for (const id of group) {
      const matches = directMatches.get(id);
      if (matches) {
        for (const matchId of matches) {
          if (!groupSet.has(matchId) && !usedIds.has(matchId)) {
            candidates.add(matchId);
          }
        }
      }
    }
    
    for (const candidateId of candidates) {
      // Check if candidate matches ALL items in group
      const candidateMatches = directMatches.get(candidateId);
      if (!candidateMatches) continue;
      
      let matchesAll = true;
      for (const groupId of group) {
        if (!candidateMatches.has(groupId)) {
          matchesAll = false;
          break;
        }
      }
      
      if (matchesAll) {
        group.push(candidateId);
        groupSet.add(candidateId);
      }
    }
    
    // Mark all as used and add group
    for (const id of group) {
      usedIds.add(id);
    }
    
    if (group.length >= 2) {
      const assets = group.map(id => assetMap.get(id)).filter(Boolean);
      assets.sort((a, b) => (a.creationTime || 0) - (b.creationTime || 0));
      finalGroups.push(assets);
    }
  }

  finalGroups.sort((a, b) => b.length - a.length);

  updateProgress(onProgress, 0.95, true);
  await yieldToUi();
  
  // Small delay before final result for smooth UX
  await new Promise(r => setTimeout(r, 200));
  
  updateStatus(onStatus, finalGroups.length > 0 ? t('status.scanningFoundSimilarGroups', { count: finalGroups.length }) : t('status.scanningNoSimilarPhotos'), true);
  updateProgress(onProgress, 1, true);

  console.log('[DupScanner] Similar scan complete:', finalGroups.length, 'groups');

  // Flush cache to disk
  await flushHashCache();

  return { groups: finalGroups, aborted: false };
};

// ============================================================================
// HELPER EXPORTS (same as original)
// ============================================================================

export const formatDuplicateGroupsForReview = (duplicateGroups) => {
  return duplicateGroups.map((group, idx) => {
    const sorted = [...group].sort((a, b) => {
      const at = a.info?.creationTime || a.asset?.creationTime || a.creationTime || 0;
      const bt = b.info?.creationTime || b.asset?.creationTime || b.creationTime || 0;
      return at - bt;
    });
    const items = sorted.map((it, itemIdx) => ({
      id: it.asset?.id || it.id,
      filename: it.info?.filename || it.asset?.filename || it.filename || it.id,
      created: it.info?.creationTime || it.asset?.creationTime || it.creationTime || 0,
      size: it.info?.fileSize || null,
      uri: it.info?.localUri || it.info?.uri || it.asset?.uri || it.uri || '',
      delete: itemIdx > 0,
    }));
    return { type: 'exact', groupIndex: idx + 1, items };
  });
};

export const countDuplicates = (duplicateGroups) => {
  let count = 0;
  duplicateGroups.forEach(group => {
    count += (group.length - 1);
  });
  return count;
};

export const buildNoResultsNote = (stats) => {
  const noteParts = [];
  noteParts.push(`Analyzed ${stats.hashedCount || 0} items.`);
  if (stats.hashSkipped > 0) noteParts.push(`Skipped: ${stats.hashSkipped}`);
  if (stats.hashFailed > 0) noteParts.push(`Analysis failures: ${stats.hashFailed}`);
  return noteParts.length > 0 ? `\n${noteParts.join('\n')}` : '';
};

export const deleteAssets = async (ids, onProgress) => {
  if (!ids || ids.length === 0) {
    return { success: true, deleted: 0 };
  }

  // Batch deletions to avoid crashes with large numbers of files
  // iOS and Android can timeout/crash when deleting 100+ files at once
  const BATCH_SIZE = 20;
  let totalDeleted = 0;
  let hasError = false;

  try {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(ids.length / BATCH_SIZE);
      
      console.log(`[DupScanner] Deleting batch ${batchNum}/${totalBatches} (${batch.length} items)`);
      
      // Report progress if callback provided
      if (onProgress) {
        onProgress(i / ids.length, totalDeleted, ids.length);
      }

      try {
        // Use native MediaDelete module on both iOS and Android for proper deletion
        // iOS: moves to Recently Deleted (30-day recovery)
        // Android: moves to PhotoLynkDeleted album
        if (MediaDelete && typeof MediaDelete.deleteAssets === 'function') {
          const result = await MediaDelete.deleteAssets(batch);
          // iOS returns count of deleted assets, Android returns boolean
          if (typeof result === 'number') {
            totalDeleted += result;
          } else if (result === true) {
            totalDeleted += batch.length;
          }
        } else {
          // Fallback to MediaLibrary (less reliable on iOS)
          const result = await MediaLibrary.deleteAssetsAsync(batch);
          if (result === true || typeof result === 'undefined') {
            totalDeleted += batch.length;
          }
        }
      } catch (batchError) {
        console.log(`[DupScanner] Batch ${batchNum} error:`, batchError?.message);
        hasError = true;
        // Continue with next batch instead of failing completely
      }

      // Small delay between batches to prevent overwhelming the system
      if (i + BATCH_SIZE < ids.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Final progress update
    if (onProgress) {
      onProgress(1, totalDeleted, ids.length);
    }

    return { 
      success: totalDeleted > 0, 
      deleted: totalDeleted,
      partial: hasError && totalDeleted > 0,
    };
  } catch (e) {
    console.log('[DupScanner] Delete error:', e?.message);
    throw e;
  }
};

export default {
  scanExactDuplicates,
  scanSimilarPhotos,
  formatDuplicateGroupsForReview,
  countDuplicates,
  buildNoResultsNote,
  deleteAssets,
};
