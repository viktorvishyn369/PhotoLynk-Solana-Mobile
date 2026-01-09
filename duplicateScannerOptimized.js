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

const { PixelHash, MediaDelete } = NativeModules;

// ============================================================================
// CONSTANTS
// ============================================================================

const PAGE_SIZE = 250; // Assets per page for collection
const PROGRESS_THROTTLE_MS = 150; // Throttle progress updates
const YIELD_EVERY_N_FILES = 3; // Yield to UI every N files
const YIELD_EVERY_N_COMPARISONS = 500; // Yield during O(n²) comparison
const THERMAL_COOLDOWN_MS = 50; // Cooldown after heavy batches
const MAX_SIMILAR_SCAN = 5000; // Max files for similar scan (O(n²) is expensive)

// Hash thresholds
const SIMILAR_THRESHOLD = 24;
const CROSS_PLATFORM_DHASH_THRESHOLD = 6;
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
  return /\.(jpe?g|png|heic|heif|webp)$/i.test(name);
};

const isVideoAsset = (info, asset) => {
  const mt = (info && info.mediaType) || asset.mediaType;
  if (mt === 'video') return true;
  const name = (info && info.filename) || asset.filename || '';
  return /\.(mp4|mov|m4v|avi|mkv|webm|3gp)$/i.test(name);
};

const computeExactFileHash = async (filePath) => {
  try {
    const b64 = await FileSystem.readAsStringAsync(filePath, { encoding: FileSystem.EncodingType.Base64 });
    const bytes = naclUtil.decodeBase64(b64);
    return sha256(bytes);
  } catch (e) {
    return null;
  }
};

const getHashTarget = async ({ asset, info, resolveReadableFilePath }) => {
  let hashTarget = null;
  let tmpCopied = false;
  let tmpUri = null;
  let rawUri = null;

  try {
    rawUri = info?.localUri || info?.uri || asset.uri;
    
    if (resolveReadableFilePath && typeof resolveReadableFilePath === 'function') {
      const resolved = await resolveReadableFilePath(asset, info);
      if (resolved && resolved.filePath) {
        hashTarget = resolved.filePath;
        tmpCopied = !!resolved.tmpCopied;
        tmpUri = resolved.tmpUri || null;
      }
    }
    
    if (!hashTarget && rawUri) {
      if (rawUri.startsWith('file://')) {
        hashTarget = rawUri.replace('file://', '');
      } else if (rawUri.startsWith('/')) {
        hashTarget = rawUri;
      }
    }
  } catch (e) {
    // Silent fail
  }

  return { hashTarget, tmpCopied, tmpUri, rawUri };
};

// ============================================================================
// OPTIMIZED ASSET COLLECTION
// ============================================================================

/**
 * Collect assets with pagination and proper yielding
 */
const collectAssetsPaged = async ({
  includeVideos = true,
  onStatus,
  onProgress,
  progressStart = 0,
  progressEnd = 0.1,
  abortRef,
}) => {
  const mediaTypes = includeVideos ? ['photo', 'video'] : ['photo'];
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

  updateStatus(onStatus, `Collecting 0 of ${totalCount} items...`, true);
  updateProgress(onProgress, progressStart, true);

  while (true) {
    if (abortRef?.current) return { assets: allAssets, aborted: true };

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
    const progress = progressStart + (allAssets.length / Math.max(totalCount, 1)) * (progressEnd - progressStart);
    updateProgress(onProgress, Math.min(progress, progressEnd));
    updateStatus(onStatus, `Collecting ${allAssets.length} of ${totalCount} items...`);

    await yieldToUi();

    after = page?.endCursor;
    if (!page?.hasNextPage) break;
    if (assets.length === 0) break;
  }

  // Also scan albums for Screenshots, Downloads, etc.
  try {
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    for (let i = 0; i < albums.length; i++) {
      if (abortRef?.current) return { assets: allAssets, aborted: true };

      const album = albums[i];
      try {
        const albumAssets = await MediaLibrary.getAssetsAsync({
          first: PAGE_SIZE * 2,
          album: album.id,
          mediaType: mediaTypes,
        });
        if (albumAssets?.assets) {
          for (const asset of albumAssets.assets) {
            if (!seenIds.has(asset.id)) {
              seenIds.add(asset.id);
              allAssets.push(asset);
            }
          }
        }
      } catch (e) {
        // Skip failed albums
      }

      // Yield every few albums
      if (i % 5 === 0) {
        await yieldToUi();
        updateStatus(onStatus, `Scanning albums... ${allAssets.length} items found`);
      }
    }
  } catch (e) {
    console.log('[DupScanner] Album scan error:', e?.message);
  }

  updateProgress(onProgress, progressEnd, true);
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
  
  const hasPixelHash = PixelHash && typeof PixelHash.hashImagePixels === 'function';
  if (!hasPixelHash) {
    console.warn('[DupScanner] PixelHash not available - videos only');
  }

  // Reset throttle timestamps
  lastProgressUpdate = 0;
  lastStatusUpdate = 0;

  // ========== PHASE 1: Collect Assets (0-10%) ==========
  updateStatus(onStatus, 'Collecting photos & videos...', true);
  updateProgress(onProgress, 0, true);

  const { assets: allAssets, aborted: collectAborted } = await collectAssetsPaged({
    includeVideos,
    onStatus,
    onProgress,
    progressStart: 0,
    progressEnd: 0.10,
    abortRef,
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
  updateStatus(onStatus, `Analyzing 1 of ${totalAssets} items...`, true);
  updateProgress(onProgress, 0.10, true);

  const hashGroups = {};
  let hashedCount = 0;
  let hashSkipped = 0;
  let hashFailed = 0;
  let inspectFailed = 0;
  let photoCount = 0;
  let videoCount = 0;

  for (let i = 0; i < totalAssets; i++) {
    if (abortRef?.current) {
      return { duplicateGroups: [], stats: {}, aborted: true };
    }

    const asset = allAssets[i];

    // Yield every N files
    if (i % YIELD_EVERY_N_FILES === 0) {
      await yieldToUi();
    }

    // Update progress
    const fileProgress = 0.10 + (i / totalAssets) * 0.80;
    updateProgress(onProgress, fileProgress);
    updateStatus(onStatus, `Analyzing ${i + 1} of ${totalAssets}: ${asset.filename || 'file'}...`);

    // Get asset info
    let info;
    try {
      info = Platform.OS === 'ios'
        ? await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: true })
        : await MediaLibrary.getAssetInfoAsync(asset.id);
    } catch (e) {
      inspectFailed++;
      continue;
    }

    await quickYield();

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

    await quickYield();

    try {
      let hashHex = null;

      if (isVideo) {
        hashHex = await computeExactFileHash(hashTarget);
        if (hashHex) {
          hashHex = 'video:' + hashHex;
          videoCount++;
        }
      } else {
        hashHex = await PixelHash.hashImagePixels(hashTarget);
        if (hashHex) {
          hashHex = 'image:' + hashHex;
          photoCount++;
        }
      }

      await quickYield();

      if (hashHex) {
        hashedCount++;
        if (!hashGroups[hashHex]) hashGroups[hashHex] = [];
        hashGroups[hashHex].push({ asset, info });
      } else {
        hashFailed++;
      }
    } catch (e) {
      hashFailed++;
    } finally {
      if (tmpCopied && tmpUri) {
        try { await FileSystem.deleteAsync(tmpUri, { idempotent: true }); } catch (e) {}
      }
    }

    // Thermal cooldown every 50 files
    if (i > 0 && i % 50 === 0) {
      await thermalCooldown();
    }
  }

  // ========== PHASE 3: Group Duplicates (90-95%) ==========
  updateStatus(onStatus, 'Finding duplicate groups...', true);
  updateProgress(onProgress, 0.90, true);
  await yieldToUi();

  const duplicateGroups = [];
  const hashKeys = Object.keys(hashGroups);
  
  for (let i = 0; i < hashKeys.length; i++) {
    const group = hashGroups[hashKeys[i]];
    if (group.length > 1) {
      // Sort by creation time (oldest first)
      group.sort((a, b) => {
        const aTime = a.info?.creationTime || a.asset.creationTime || 0;
        const bTime = b.info?.creationTime || b.asset.creationTime || 0;
        return aTime - bTime;
      });
      duplicateGroups.push(group);
    }

    if (i % 100 === 0) await quickYield();
  }

  // ========== PHASE 4: Finalize (95-100%) ==========
  updateStatus(onStatus, `Found ${duplicateGroups.length} duplicate groups`, true);
  updateProgress(onProgress, 1, true);

  console.log('[DupScanner] Exact scan complete:', {
    totalAssets,
    hashedCount,
    photoCount,
    videoCount,
    hashSkipped,
    hashFailed,
    duplicateGroups: duplicateGroups.length,
  });

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

  const hasPixelHash = PixelHash && typeof PixelHash.hashImagePixels === 'function';
  if (!hasPixelHash) {
    console.warn('[DupScanner] PixelHash not available - videos only');
  }

  // Reset throttle timestamps
  lastProgressUpdate = 0;
  lastStatusUpdate = 0;

  // ========== PHASE 1: Collect Assets (0-10%) ==========
  if (onCollecting) onCollecting();
  updateStatus(onStatus, 'Collecting photos & videos...', true);
  updateProgress(onProgress, 0, true);

  const { assets: allAssets, aborted: collectAborted } = await collectAssetsPaged({
    includeVideos,
    onStatus,
    onProgress,
    progressStart: 0,
    progressEnd: 0.10,
    abortRef,
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
  updateStatus(onStatus, `Analyzing 1 of ${totalAssets} items...`, true);
  updateProgress(onProgress, 0.10, true);

  const items = [];
  let hashed = 0;
  let hashFailed = 0;

  for (let i = 0; i < totalAssets; i++) {
    if (abortRef?.current) {
      return { groups: [], aborted: true };
    }

    const asset = assets[i];

    // Yield every N files
    if (i % YIELD_EVERY_N_FILES === 0) {
      await yieldToUi();
    }

    // Update progress (10-60%)
    const fileProgress = 0.10 + (i / totalAssets) * 0.50;
    updateProgress(onProgress, fileProgress);
    updateStatus(onStatus, `Analyzing ${i + 1} of ${totalAssets}: ${asset.filename || 'file'}...`);

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

      await quickYield();

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
        await quickYield();

        try {
          if (isVideo) {
            hash = await computeExactFileHash(hashTarget);
            if (hash) {
              hash = 'video:' + hash;
              hashed++;
            }
          } else if (hasPixelHash) {
            hash = await PixelHash.hashImagePixels(hashTarget);
            if (hash) {
              hash = 'image:' + hash;
              hashed++;
            }

            // Edge hash (optional)
            if (PixelHash.hashImageEdges) {
              try {
                edgeHash = await PixelHash.hashImageEdges(hashTarget);
              } catch (e) {}
            }

            // Corner hash (optional)
            if (PixelHash.hashImageCorners) {
              try {
                cornerHash = await PixelHash.hashImageCorners(hashTarget);
              } catch (e) {}
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
      items.push({
        asset,
        info,
        hash,
        isVideo,
        edgeHash: edgeHash || null,
        cornerHash: cornerHash || null,
        createdTs: asset.creationTime || 0,
        filename: info?.filename || asset.filename || '',
      });
    }

    // Thermal cooldown every 50 files
    if (i > 0 && i % 50 === 0) {
      await thermalCooldown();
    }
  }

  console.log('[DupScanner] Hashed', hashed, 'items, failed', hashFailed);

  // ========== PHASE 3: Compare Hashes (60-90%) ==========
  if (onFindingMatches) onFindingMatches();
  updateStatus(onStatus, 'Comparing for similar items...', true);
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
        updateStatus(onStatus, `Comparing ${Math.round(comparisonsDone / 1000)}k of ${Math.round(totalComparisons / 1000)}k pairs...`);
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

      const dt = Math.abs((b.createdTs || 0) - (a.createdTs || 0));
      const dist = hammingDistance64(aHash, bHash);

      // Edge and corner comparison
      const edgeDist = (a.edgeHash && b.edgeHash) ? hammingDistance32(a.edgeHash, b.edgeHash) : Number.MAX_SAFE_INTEGER;
      const edgesMatch = edgeDist <= EDGE_MATCH_THRESHOLD;
      const cornerDist = (a.cornerHash && b.cornerHash) ? hammingDistance16(a.cornerHash, b.cornerHash) : Number.MAX_SAFE_INTEGER;
      const cornersMatch = cornerDist <= CORNER_MATCH_THRESHOLD;

      // Dynamic threshold based on time proximity
      let threshold;
      if (dt <= 5000) threshold = 8;
      else if (dt <= 30000) threshold = 7;
      else if (dt <= 60000) threshold = 6;
      else if (dt <= 300000) threshold = 5;
      else threshold = 4;

      // Boost threshold if edges/corners match
      if (edgesMatch) threshold = Math.max(threshold, 10);
      if (cornersMatch) threshold = Math.max(threshold, 11);
      if (edgesMatch && cornersMatch) threshold = Math.max(threshold, 12);

      if (dist > threshold) continue;

      const key = [a.asset.id, b.asset.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);

      similarPairs.push({ a, b, dist, dt, edgesMatch, cornersMatch });
    }

    // Thermal cooldown every 100 outer iterations
    if (i > 0 && i % 100 === 0) {
      await thermalCooldown();
    }
  }

  console.log('[DupScanner] Found', similarPairs.length, 'similar pairs');

  // ========== PHASE 4: Cluster Groups (90-100%) ==========
  updateStatus(onStatus, 'Grouping similar items...', true);
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
  for (const item of items) {
    assetMap.set(item.asset.id, item.asset);
  }

  for (const pair of similarPairs) {
    union(pair.a.asset.id, pair.b.asset.id);
  }

  await quickYield();

  const groupMap = new Map();
  for (const pair of similarPairs) {
    const rootA = find(pair.a.asset.id);
    if (!groupMap.has(rootA)) groupMap.set(rootA, new Set());
    groupMap.get(rootA).add(pair.a.asset.id);
    groupMap.get(rootA).add(pair.b.asset.id);
  }

  const finalGroups = [];
  for (const [root, idSet] of groupMap) {
    const group = [];
    for (const id of idSet) {
      const asset = assetMap.get(id);
      if (asset) group.push(asset);
    }
    if (group.length >= 2) {
      group.sort((a, b) => (a.creationTime || 0) - (b.creationTime || 0));
      finalGroups.push(group);
    }
  }

  finalGroups.sort((a, b) => b.length - a.length);

  updateStatus(onStatus, `Found ${finalGroups.length} similar groups`, true);
  updateProgress(onProgress, 1, true);

  console.log('[DupScanner] Similar scan complete:', finalGroups.length, 'groups');

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

export const deleteAssets = async (ids) => {
  if (!ids || ids.length === 0) {
    return { success: true, deleted: 0 };
  }

  try {
    if (Platform.OS === 'android' && MediaDelete && typeof MediaDelete.deleteAssets === 'function') {
      const result = await MediaDelete.deleteAssets(ids);
      return { success: result === true, deleted: result === true ? ids.length : 0 };
    } else {
      const result = await MediaLibrary.deleteAssetsAsync(ids);
      return { success: result === true || typeof result === 'undefined', deleted: ids.length };
    }
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
