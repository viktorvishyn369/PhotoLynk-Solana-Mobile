/**
 * hashCache.js
 * 
 * Persistent cache for computed file hashes to avoid re-hashing on every scan.
 * Uses expo-file-system to store cache in app's document directory.
 * Cache key: asset.id + modificationTime to detect changed files.
 * 
 * Supports:
 * - File hash (MD5/SHA256) for identical duplicate detection
 * - Perceptual hash (pHash) for similar photo detection
 * - Edge hash for similar photo detection
 * - Corner hash for similar photo detection
 * 
 * Background pre-analysis runs on app start to prepare hashes silently.
 */

import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';

const CACHE_FILE = `${FileSystem.documentDirectory}hash_cache_v2.json`;
const CACHE_VERSION = 2;

// In-memory cache loaded from disk
let memoryCache = null;
let cacheLoaded = false;
let savePending = false;
let saveTimeout = null;

/**
 * Load hash cache from disk into memory
 */
export const loadHashCache = async () => {
  if (cacheLoaded && memoryCache) return memoryCache;
  
  try {
    const info = await FileSystem.getInfoAsync(CACHE_FILE);
    if (info.exists) {
      const content = await FileSystem.readAsStringAsync(CACHE_FILE);
      const data = JSON.parse(content);
      if (data.version === CACHE_VERSION) {
        memoryCache = data.hashes || {};
        console.log(`[HashCache] Loaded ${Object.keys(memoryCache).length} cached hashes`);
      } else {
        // Version mismatch, start fresh
        memoryCache = {};
        console.log('[HashCache] Version mismatch, starting fresh');
      }
    } else {
      memoryCache = {};
      console.log('[HashCache] No cache file, starting fresh');
    }
  } catch (e) {
    console.warn('[HashCache] Failed to load cache:', e?.message);
    memoryCache = {};
  }
  
  cacheLoaded = true;
  return memoryCache;
};

/**
 * Save hash cache to disk (debounced to avoid excessive writes)
 */
const saveHashCache = async () => {
  if (!memoryCache) return;
  
  try {
    const data = {
      version: CACHE_VERSION,
      hashes: memoryCache,
      savedAt: Date.now(),
    };
    await FileSystem.writeAsStringAsync(CACHE_FILE, JSON.stringify(data));
    console.log(`[HashCache] Saved ${Object.keys(memoryCache).length} hashes to disk`);
  } catch (e) {
    console.warn('[HashCache] Failed to save cache:', e?.message);
  }
};

/**
 * Schedule a debounced save (waits 2 seconds after last update)
 */
const scheduleSave = () => {
  if (saveTimeout) clearTimeout(saveTimeout);
  savePending = true;
  saveTimeout = setTimeout(() => {
    savePending = false;
    saveHashCache();
  }, 2000);
};

/**
 * Force save immediately (call before app closes)
 */
export const flushHashCache = async () => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (savePending || memoryCache) {
    savePending = false;
    await saveHashCache();
  }
};

/**
 * Generate cache key from asset
 * Uses asset.id + modificationTime to detect changed files
 */
const getCacheKey = (asset) => {
  if (!asset || !asset.id) return null;
  // Use modificationTime if available, otherwise creationTime
  const mtime = asset.modificationTime || asset.creationTime || 0;
  return `${asset.id}_${mtime}`;
};

/**
 * Get cached hash for an asset
 * @param {Object} asset - MediaLibrary asset
 * @param {string} hashType - 'perceptual', 'edge', 'corner', or 'file'
 * @returns {string|null} Cached hash or null if not cached
 */
export const getCachedHash = (asset, hashType = 'perceptual') => {
  if (!memoryCache || !asset) return null;
  const key = getCacheKey(asset);
  if (!key) return null;
  
  const entry = memoryCache[key];
  if (!entry) return null;
  
  switch (hashType) {
    case 'perceptual': return entry.phash || null;
    case 'edge': return entry.ehash || null;
    case 'corner': return entry.chash || null;
    case 'file': return entry.fhash || null;
    default: return null;
  }
};

/**
 * Get all cached hashes for an asset at once
 * @param {Object} asset - MediaLibrary asset
 * @returns {Object|null} { phash, ehash, chash, fhash } or null
 */
export const getAllCachedHashes = (asset) => {
  if (!memoryCache || !asset) return null;
  const key = getCacheKey(asset);
  if (!key) return null;
  return memoryCache[key] || null;
};

/**
 * Store computed hash in cache
 * @param {Object} asset - MediaLibrary asset
 * @param {string} hashType - 'perceptual', 'edge', 'corner', or 'file'
 * @param {string} hash - The computed hash value
 */
export const setCachedHash = (asset, hashType, hash) => {
  if (!asset || !hash) return;
  
  // Ensure cache is loaded
  if (!memoryCache) memoryCache = {};
  
  const key = getCacheKey(asset);
  if (!key) return;
  
  if (!memoryCache[key]) {
    memoryCache[key] = {};
  }
  
  switch (hashType) {
    case 'perceptual': memoryCache[key].phash = hash; break;
    case 'edge': memoryCache[key].ehash = hash; break;
    case 'corner': memoryCache[key].chash = hash; break;
    case 'file': memoryCache[key].fhash = hash; break;
  }
  
  scheduleSave();
};

/**
 * Store multiple hashes for an asset at once
 * @param {Object} asset - MediaLibrary asset
 * @param {Object} hashes - { phash, ehash, chash, fhash }
 */
export const setAllCachedHashes = (asset, hashes) => {
  if (!asset || !hashes) return;
  
  if (!memoryCache) memoryCache = {};
  
  const key = getCacheKey(asset);
  if (!key) return;
  
  if (!memoryCache[key]) {
    memoryCache[key] = {};
  }
  
  if (hashes.phash) memoryCache[key].phash = hashes.phash;
  if (hashes.ehash) memoryCache[key].ehash = hashes.ehash;
  if (hashes.chash) memoryCache[key].chash = hashes.chash;
  if (hashes.fhash) memoryCache[key].fhash = hashes.fhash;
  
  scheduleSave();
};

/**
 * Get cache statistics
 */
export const getHashCacheStats = () => {
  if (!memoryCache) return { total: 0, perceptual: 0, file: 0 };
  
  let perceptual = 0;
  let file = 0;
  
  for (const entry of Object.values(memoryCache)) {
    if (entry.phash) perceptual++;
    if (entry.fhash) file++;
  }
  
  return {
    total: Object.keys(memoryCache).length,
    perceptual,
    file,
  };
};

/**
 * Clear the entire cache (for debugging/reset)
 */
export const clearHashCache = async () => {
  memoryCache = {};
  cacheLoaded = true;
  try {
    await FileSystem.deleteAsync(CACHE_FILE, { idempotent: true });
    console.log('[HashCache] Cache cleared');
  } catch (e) {
    console.warn('[HashCache] Failed to delete cache file:', e?.message);
  }
};

/**
 * Prune cache entries for files that no longer exist
 * Call this periodically to prevent memory bloat from deleted files
 * @param {Set} currentAssetIds - Set of asset IDs currently on device
 * @returns {number} Number of entries removed
 */
export const pruneHashCache = (currentAssetIds) => {
  if (!memoryCache || !currentAssetIds) return 0;
  
  let removed = 0;
  const keysToRemove = [];
  
  for (const key of Object.keys(memoryCache)) {
    // Key format: assetId_modificationTime
    const assetId = key.split('_')[0];
    if (!currentAssetIds.has(assetId)) {
      keysToRemove.push(key);
    }
  }
  
  for (const key of keysToRemove) {
    delete memoryCache[key];
    removed++;
  }
  
  if (removed > 0) {
    console.log(`[HashCache] Pruned ${removed} stale entries`);
    scheduleSave();
  }
  
  return removed;
};

// ============================================================================
// BACKGROUND PRE-ANALYSIS
// ============================================================================

let preAnalysisRunning = false;
let preAnalysisAbort = false;

/**
 * Check if pre-analysis is currently running
 */
export const isPreAnalysisRunning = () => preAnalysisRunning;

/**
 * Abort any running pre-analysis
 */
export const abortPreAnalysis = () => {
  preAnalysisAbort = true;
};

/**
 * Get list of asset IDs that need hashing (not in cache)
 * @param {Array} assets - Array of MediaLibrary assets
 * @param {string} hashType - 'file' for identical, 'perceptual' for similar
 * @returns {Array} Assets that need hashing
 */
export const getUncachedAssets = (assets, hashType = 'file') => {
  if (!memoryCache || !assets) return assets;
  
  return assets.filter(asset => {
    const cached = getCachedHash(asset, hashType);
    return !cached;
  });
};

/**
 * Check how many assets are already cached
 * @param {Array} assets - Array of MediaLibrary assets
 * @param {string} hashType - 'file' for identical, 'perceptual' for similar
 * @returns {Object} { cached, uncached, total }
 */
export const getCacheStatus = (assets, hashType = 'file') => {
  if (!assets) return { cached: 0, uncached: 0, total: 0 };
  if (!memoryCache) return { cached: 0, uncached: assets.length, total: assets.length };
  
  let cached = 0;
  for (const asset of assets) {
    if (getCachedHash(asset, hashType)) cached++;
  }
  
  return {
    cached,
    uncached: assets.length - cached,
    total: assets.length,
  };
};

/**
 * Run background pre-analysis to hash files silently
 * Call this on app start when user is logged in
 * 
 * @param {Object} params
 * @param {Function} params.resolveReadableFilePath - Function to get readable file path
 * @param {Function} params.computeFileHash - Function to compute file hash (for identical)
 * @param {Function} params.computePerceptualHashes - Function to compute perceptual hashes (for similar)
 * @param {number} params.batchSize - Files to process per batch (default 5 for low memory)
 * @param {number} params.delayBetweenBatches - MS delay between batches (default 100 for low CPU)
 * @param {boolean} params.includeVideos - Include videos in pre-analysis (default true)
 * @param {Function} params.onProgress - Optional progress callback ({ processed, total, cached })
 */
export const runBackgroundPreAnalysis = async ({
  resolveReadableFilePath,
  computeFileHash,
  computePerceptualHashes,
  batchSize = 5,
  delayBetweenBatches = 100,
  includeVideos = true,
  onProgress,
}) => {
  if (preAnalysisRunning) {
    console.log('[HashCache] Pre-analysis already running');
    return { alreadyRunning: true };
  }
  
  preAnalysisRunning = true;
  preAnalysisAbort = false;
  
  console.log('[HashCache] Starting background pre-analysis...');
  
  try {
    // Ensure cache is loaded
    await loadHashCache();
    
    // Check permissions
    const permission = await MediaLibrary.getPermissionsAsync();
    if (permission.status !== 'granted') {
      console.log('[HashCache] No media permission for pre-analysis');
      preAnalysisRunning = false;
      return { noPermission: true };
    }
    
    // Collect assets (paginated, low memory)
    const mediaTypes = includeVideos ? ['photo', 'video'] : ['photo'];
    const allAssets = [];
    let after = null;
    const PAGE_SIZE = 100; // Small pages for low memory
    
    while (!preAnalysisAbort) {
      const page = await MediaLibrary.getAssetsAsync({
        first: PAGE_SIZE,
        after: after || undefined,
        mediaType: mediaTypes,
      });
      
      if (page?.assets) {
        allAssets.push(...page.assets);
      }
      
      after = page?.endCursor;
      if (!page?.hasNextPage) break;
      
      // Yield to prevent blocking
      await new Promise(r => setTimeout(r, 10));
    }
    
    if (preAnalysisAbort) {
      console.log('[HashCache] Pre-analysis aborted during collection');
      preAnalysisRunning = false;
      return { aborted: true };
    }
    
    console.log(`[HashCache] Collected ${allAssets.length} assets for pre-analysis`);

    try {
      const currentAssetIds = new Set(allAssets.map(a => String(a?.id)).filter(Boolean));
      pruneHashCache(currentAssetIds);
    } catch (e) {
      // ignore
    }
    
    // Check what's already cached
    const status = getCacheStatus(allAssets, 'file');
    console.log(`[HashCache] Cache status: ${status.cached} cached, ${status.uncached} need hashing`);
    
    if (status.uncached === 0) {
      console.log('[HashCache] All files already cached, pre-analysis complete');
      preAnalysisRunning = false;
      return { complete: true, cached: status.cached, processed: 0 };
    }
    
    // Get uncached assets
    const uncachedAssets = getUncachedAssets(allAssets, 'file');
    let processed = 0;
    let errors = 0;
    
    // Process in small batches for low memory/CPU
    for (let i = 0; i < uncachedAssets.length; i += batchSize) {
      if (preAnalysisAbort) {
        console.log('[HashCache] Pre-analysis aborted');
        break;
      }
      
      const batch = uncachedAssets.slice(i, i + batchSize);
      
      for (const asset of batch) {
        if (preAnalysisAbort) break;
        
        try {
          // Get asset info
          const info = await MediaLibrary.getAssetInfoAsync(asset.id);
          if (!info) {
            if (errors < 3) console.log('[HashCache] Pre-analysis: no info for asset', asset?.id);
            errors++;
            continue;
          }
          
          // Get readable file path
          const resolveResult = await resolveReadableFilePath({ assetId: asset.id, assetInfo: info });
          const filePath = resolveResult?.filePath;
          if (!filePath) {
            if (errors < 3) console.log('[HashCache] Pre-analysis: no filePath for', info?.filename);
            errors++;
            continue;
          }
          
          let hashSuccess = false;
          
          // Compute file hash (for identical duplicates)
          if (computeFileHash) {
            try {
              const fileHash = await computeFileHash(filePath);
              if (fileHash) {
                setCachedHash(asset, 'file', fileHash);
                hashSuccess = true;
              } else if (errors < 3) {
                console.log('[HashCache] Pre-analysis: fileHash null for', info?.filename);
              }
            } catch (hashErr) {
              if (errors < 3) console.log('[HashCache] Pre-analysis: fileHash error', info?.filename, hashErr?.message);
            }
          }
          
          // Compute perceptual hashes (for similar photos) - only for images
          const isImage = info.mediaType === 'photo' || 
            (info.filename && /\.(jpg|jpeg|png|heic|heif|webp|gif|bmp)$/i.test(info.filename));
          
          if (computePerceptualHashes && isImage) {
            try {
              const hashes = await computePerceptualHashes(filePath, asset, info);
              if (hashes) {
                if (hashes.phash) { setCachedHash(asset, 'perceptual', hashes.phash); hashSuccess = true; }
                if (hashes.ehash) { setCachedHash(asset, 'edge', hashes.ehash); hashSuccess = true; }
                if (hashes.chash) { setCachedHash(asset, 'corner', hashes.chash); hashSuccess = true; }
              } else if (errors < 3) {
                console.log('[HashCache] Pre-analysis: perceptualHash null for', info?.filename);
              }
            } catch (phashErr) {
              if (errors < 3) console.log('[HashCache] Pre-analysis: perceptualHash error', info?.filename, phashErr?.message);
            }
          }
          
          if (hashSuccess) {
            processed++;
          } else {
            errors++;
          }
        } catch (e) {
          if (errors < 3) console.log('[HashCache] Pre-analysis: exception', e?.message);
          errors++;
        }
      }
      
      // Report progress
      if (onProgress) {
        onProgress({
          processed,
          total: uncachedAssets.length,
          cached: status.cached,
          errors,
        });
      }
      
      // Delay between batches for low CPU usage
      await new Promise(r => setTimeout(r, delayBetweenBatches));
    }
    
    // Force save at end
    await flushHashCache();
    
    console.log(`[HashCache] Pre-analysis complete: ${processed} processed, ${errors} errors`);
    preAnalysisRunning = false;
    
    return {
      complete: true,
      processed,
      cached: status.cached,
      errors,
      aborted: preAnalysisAbort,
    };
    
  } catch (e) {
    console.error('[HashCache] Pre-analysis error:', e?.message);
    preAnalysisRunning = false;
    return { error: e?.message };
  }
};

/**
 * Pre-filter assets using cached hashes against server dedup sets.
 * Returns only assets that need uploading (not already on server).
 * 
 * @param {Array} assets - Array of MediaLibrary assets
 * @param {Object} serverDedupSets - { fileHashes: Set, perceptualHashes: Set, manifestIds: Set }
 * @param {Function} getManifestId - Function to compute manifestId from asset
 * @param {number} dhashThreshold - dHash threshold for perceptual matching (default 1)
 * @returns {Object} { toUpload: Array, alreadyOnServer: number, uncached: number }
 */
export const preFilterAssetsWithCache = (assets, serverDedupSets, getManifestId, dhashThreshold = 1) => {
  if (!assets || !serverDedupSets) return { toUpload: assets || [], alreadyOnServer: 0, uncached: 0 };
  if (!memoryCache) return { toUpload: assets, alreadyOnServer: 0, uncached: assets.length };
  
  const { fileHashes: serverFileHashes, perceptualHashes: serverPHashes, manifestIds: serverManifestIds } = serverDedupSets;
  
  const toUpload = [];
  let alreadyOnServer = 0;
  let uncached = 0;
  
  // Hamming distance for dHash comparison
  const hammingDistance = (a, b) => {
    if (!a || !b || a.length !== 16 || b.length !== 16) return Number.MAX_SAFE_INTEGER;
    let dist = 0;
    for (let i = 0; i < 16; i += 8) {
      const valA = parseInt(a.substring(i, i + 8), 16);
      const valB = parseInt(b.substring(i, i + 8), 16);
      let x = valA ^ valB;
      while (x) { dist += x & 1; x >>>= 1; }
    }
    return dist;
  };
  
  const findPHashMatch = (hash, hashSet) => {
    if (!hash || !hashSet || hashSet.size === 0) return false;
    if (hashSet.has(hash)) return true;
    for (const existing of hashSet) {
      if (existing && hammingDistance(hash, existing) <= dhashThreshold) return true;
    }
    return false;
  };
  
  for (const asset of assets) {
    // Check manifestId first (quick check)
    if (getManifestId && serverManifestIds) {
      try {
        const manifestId = getManifestId(asset);
        if (manifestId && serverManifestIds.has(manifestId)) {
          alreadyOnServer++;
          continue;
        }
      } catch (e) { /* ignore */ }
    }
    
    // Check cached hashes against server
    const cached = getAllCachedHashes(asset);
    if (!cached || (!cached.fhash && !cached.phash)) {
      uncached++;
      toUpload.push(asset);
      continue;
    }
    
    // Check file hash (exact match)
    if (cached.fhash && serverFileHashes && serverFileHashes.has(cached.fhash)) {
      alreadyOnServer++;
      continue;
    }
    
    // Check perceptual hash (fuzzy match with threshold)
    if (cached.phash && serverPHashes && findPHashMatch(cached.phash, serverPHashes)) {
      alreadyOnServer++;
      continue;
    }
    
    // Not on server - needs upload
    toUpload.push(asset);
  }
  
  console.log(`[HashCache] Pre-filter: ${assets.length} total, ${alreadyOnServer} on server, ${toUpload.length} to upload, ${uncached} uncached`);
  
  return { toUpload, alreadyOnServer, uncached };
};
