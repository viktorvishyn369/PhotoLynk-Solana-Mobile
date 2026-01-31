/**
 * hashCache.js
 * 
 * Persistent cache for computed file hashes to avoid re-hashing on every backup.
 * Uses expo-file-system to store cache in app's document directory.
 * Cache key: asset.id + modificationTime to detect changed files.
 */

import * as FileSystem from 'expo-file-system';

const CACHE_FILE = `${FileSystem.documentDirectory}hash_cache.json`;
const CACHE_VERSION = 1;

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
 * @param {string} hashType - 'perceptual' or 'file'
 * @returns {string|null} Cached hash or null if not cached
 */
export const getCachedHash = (asset, hashType = 'perceptual') => {
  if (!memoryCache || !asset) return null;
  const key = getCacheKey(asset);
  if (!key) return null;
  
  const entry = memoryCache[key];
  if (!entry) return null;
  
  return hashType === 'perceptual' ? entry.phash : entry.fhash;
};

/**
 * Store computed hash in cache
 * @param {Object} asset - MediaLibrary asset
 * @param {string} hashType - 'perceptual' or 'file'
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
  
  if (hashType === 'perceptual') {
    memoryCache[key].phash = hash;
  } else {
    memoryCache[key].fhash = hash;
  }
  
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
