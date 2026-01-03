/**
 * duplicateScanner.js
 * 
 * Handles scanning device photos for exact duplicates using pixel-based hashing.
 * Moved from App.js to keep codebase clean and modular.
 */

import { Platform, NativeModules } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { sha256 } from 'js-sha256';
import naclUtil from 'tweetnacl-util';

const { PixelHash, MediaDelete } = NativeModules;

// ============================================================================
// SIMILAR PHOTOS - Simplified perceptual hashing (like image-hash library)
// ============================================================================

// Hamming distance for 64-char hex hash (256 bits)
const hammingDistance256 = (a, b) => {
  if (!a || !b || a.length !== 64 || b.length !== 64) return Number.MAX_SAFE_INTEGER;
  let dist = 0;
  // Process 16 chars (64 bits) at a time to avoid BigInt overflow
  for (let i = 0; i < 64; i += 16) {
    const chunkA = BigInt('0x' + a.substring(i, i + 16));
    const chunkB = BigInt('0x' + b.substring(i, i + 16));
    let x = chunkA ^ chunkB;
    while (x) {
      dist++;
      x &= x - 1n;
    }
  }
  return dist;
};

// Similar detection thresholds (like image-hash library)
const SIMILAR_THRESHOLD = 24; // Max hamming distance for similar (out of 256 bits)
const SIMILAR_TIME_WINDOW_MS = 60000; // 60 seconds - burst shots are usually within this

// Hamming distance for 16-char hex hash (64 bits) - for dHash cross-platform deduplication
// Different JPEG decoders (iOS vs Android) produce slightly different pixel values
// so we need fuzzy matching instead of exact hash comparison
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

// Cross-platform deduplication threshold for 64-bit dHash
// Threshold of 6 bits to account for HEIC decoder differences across platforms
// (heic-convert on desktop vs native ImageIO on iOS vs ImageDecoder on Android)
// 6 bits = ~9% difference tolerance, still strict enough to avoid false positives
const CROSS_PLATFORM_DHASH_THRESHOLD = 6;

// Extract base filename for cross-platform variant deduplication
// Handles iOS, Android/Google Photos, Windows, and Linux naming patterns:
// iOS: IMG_1234_1_105_c.jpeg, IMG_1234_4_5005_c.jpeg
// Android/Google: IMG_20231225_123456_1.jpg, PXL_20231225_123456~2.jpg
// Windows: IMG_1234 (2).jpg, IMG_1234 - Copy.jpg
// Linux: IMG_1234 (copy).jpg, IMG_1234_copy.jpg
const extractBaseFilename = (name) => {
  if (!name || typeof name !== 'string') return null;
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return null;
  
  // Remove extension first
  const extMatch = trimmed.match(/^(.+)\.(\w+)$/);
  if (!extMatch) return trimmed;
  let nameWithoutExt = extMatch[1];
  
  // iOS variant patterns: _1_105_c, _4_5005_c, _1_201_a, _2_100_a, etc.
  nameWithoutExt = nameWithoutExt.replace(/_\d+_\d+_[a-z]$/, '');
  
  // Android/Google Photos burst/edit patterns:
  // Only strip _1, _2 after 6+ digit timestamp (not image numbers like _5730)
  nameWithoutExt = nameWithoutExt.replace(/(_\d{6,})_\d{1,2}$/, '$1');
  nameWithoutExt = nameWithoutExt.replace(/~\d+$/, '');           // ~2, ~3 (Google edited)
  nameWithoutExt = nameWithoutExt.replace(/-(edit|edited|collage|animation)$/i, '');
  nameWithoutExt = nameWithoutExt.replace(/_burst\d*$/i, '');     // _BURST001
  
  // Windows patterns:
  nameWithoutExt = nameWithoutExt.replace(/ \(\d+\)$/, '');       // " (2)" with space
  nameWithoutExt = nameWithoutExt.replace(/\(\d+\)$/, '');        // "(2)" no space
  nameWithoutExt = nameWithoutExt.replace(/ - copy( \(\d+\))?$/i, ''); // " - Copy"
  
  // Linux patterns:
  nameWithoutExt = nameWithoutExt.replace(/ \(copy\)$/i, '');     // " (copy)"
  nameWithoutExt = nameWithoutExt.replace(/_copy\d*$/i, '');      // "_copy", "_copy2"
  nameWithoutExt = nameWithoutExt.replace(/\.bak$/i, '');         // ".bak"
  
  // Generic patterns:
  nameWithoutExt = nameWithoutExt.replace(/_backup$/i, '');
  nameWithoutExt = nameWithoutExt.replace(/-backup$/i, '');
  nameWithoutExt = nameWithoutExt.replace(/_original$/i, '');
  
  return nameWithoutExt.trim();
};

// Normalize date for comparison - extracts YYYY-MM-DD format
const normalizeDateForCompare = (dateVal) => {
  if (!dateVal) return null;
  try {
    let date;
    if (typeof dateVal === 'number') {
      date = new Date(dateVal > 9999999999 ? dateVal : dateVal * 1000);
    } else if (typeof dateVal === 'string') {
      date = new Date(dateVal);
    } else if (dateVal instanceof Date) {
      date = dateVal;
    } else {
      return null;
    }
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
  } catch (e) {
    return null;
  }
};

// Normalize full timestamp for HEIC deduplication - extracts YYYY-MM-DDTHH:MM:SS format
// This provides second-level precision for matching identical photos across platforms
// HEIC files from iPhone and desktop have same EXIF timestamp even if bytes differ
const normalizeFullTimestamp = (dateVal) => {
  if (!dateVal) return null;
  try {
    let date;
    if (typeof dateVal === 'number') {
      date = new Date(dateVal > 9999999999 ? dateVal : dateVal * 1000);
    } else if (typeof dateVal === 'string') {
      date = new Date(dateVal);
    } else if (dateVal instanceof Date) {
      date = dateVal;
    } else {
      return null;
    }
    if (isNaN(date.getTime())) return null;
    // Return YYYY-MM-DDTHH:MM:SS format (second precision, no milliseconds)
    return date.toISOString().replace(/\.\d{3}Z$/, '');
  } catch (e) {
    return null;
  }
};

// ============================================================================
// EXIF-BASED DEDUPLICATION - Extract real EXIF data for cross-platform matching
// ============================================================================

/**
 * Extract EXIF data from assetInfo for deduplication.
 * Returns normalized EXIF fields: captureTime, make (manufacturer), model (camera/phone)
 * @param {Object} assetInfo - expo-media-library AssetInfo with exif property
 * @param {Object} asset - expo-media-library Asset with creationTime
 * @returns {Object} { captureTime, make, model } - normalized EXIF data
 */
const extractExifForDedup = (assetInfo, asset) => {
  const result = {
    captureTime: null,  // EXIF DateTimeOriginal (second precision)
    make: null,         // EXIF Make (e.g., "Apple", "Samsung")
    model: null,        // EXIF Model (e.g., "iPhone 14 Pro", "SM-G998B")
  };

  try {
    const exif = assetInfo?.exif;
    
    // Extract capture time from EXIF DateTimeOriginal or DateTimeDigitized
    // Format: "YYYY:MM:DD HH:MM:SS" -> normalize to "YYYY-MM-DDTHH:MM:SS"
    let captureTimeStr = exif?.DateTimeOriginal || exif?.DateTimeDigitized || exif?.DateTime;
    if (captureTimeStr && typeof captureTimeStr === 'string') {
      // EXIF format: "2024:01:15 14:32:45" -> ISO: "2024-01-15T14:32:45"
      const normalized = captureTimeStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(normalized)) {
        result.captureTime = normalized.slice(0, 19); // Trim to second precision
      }
    }
    
    // Fallback to asset.creationTime if no EXIF timestamp
    if (!result.captureTime && asset?.creationTime) {
      result.captureTime = normalizeFullTimestamp(asset.creationTime);
    }

    // Extract make (manufacturer) - normalize to lowercase for comparison
    if (exif?.Make && typeof exif.Make === 'string') {
      result.make = exif.Make.trim().toLowerCase();
    }

    // Extract model - normalize to lowercase for comparison
    if (exif?.Model && typeof exif.Model === 'string') {
      result.model = exif.Model.trim().toLowerCase();
    }
  } catch (e) {
    // Silently fail - EXIF extraction is best-effort
  }

  return result;
};

/**
 * Generate EXIF-based deduplication key for matching across platforms.
 * Priority: captureTime+make+model > captureTime+model > captureTime+make > captureTime only
 * @param {Object} exifData - { captureTime, make, model } from extractExifForDedup
 * @returns {Object} { full, timeModel, timeMake, timeOnly } - dedup keys at different precision levels
 */
const generateExifDedupKeys = (exifData) => {
  const { captureTime, make, model } = exifData || {};
  
  return {
    // Highest confidence: all 3 fields match
    full: (captureTime && make && model) ? `${captureTime}|${make}|${model}` : null,
    // High confidence: captureTime + model (different makes can have same model name, rare)
    timeModel: (captureTime && model) ? `${captureTime}|${model}` : null,
    // Medium confidence: captureTime + make
    timeMake: (captureTime && make) ? `${captureTime}|${make}` : null,
    // Lower confidence: captureTime only (still useful with baseFilename)
    timeOnly: captureTime || null,
  };
};

// Hamming distance for 8-char hex hash (32 bits) - for edge hash
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

// Edge hash threshold - if edges match within 4 bits, same scene/background
const EDGE_MATCH_THRESHOLD = 4;

// Hamming distance for 4-char hex hash (16 bits) - for corner hash
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

// Corner hash threshold - if corners match within 2 bits, same scene/background (grayscale)
const CORNER_MATCH_THRESHOLD = 2;

// ============================================================================
// EXACT DUPLICATES - Full file hashing for upload deduplication
// ============================================================================

/**
 * Compute exact file hash (SHA-256 of full file contents) for deduplication.
 * Used by StealthCloud upload to skip files that already exist on server regardless of filename.
 * @param {string} filePath - Path to the file
 * @returns {Promise<string|null>} SHA-256 hex string or null on error
 */
/**
 * Compute perceptual hash (visual content hash) for images.
 * This hash is based on image pixels and is resistant to transcoding, compression, metadata changes.
 * Used to detect visually identical images even if file bytes differ.
 * @param {string} filePath - Path to the image file
 * @param {Object} asset - MediaLibrary asset object (optional, for type checking)
 * @param {Object} info - Asset info object (optional, for type checking)
 * @returns {Promise<string|null>} Perceptual hash hex string or null if not an image or error
 */
/**
 * Find a matching perceptual hash in a set using Hamming distance
 * Returns true if any hash in the set is within threshold distance
 * @param {string} hash - The hash to check
 * @param {Set<string>} hashSet - Set of existing hashes
 * @param {number} threshold - Max Hamming distance for match (default 5)
 * @returns {boolean} True if a close match exists
 */
export { extractBaseFilename, normalizeDateForCompare, normalizeFullTimestamp, extractExifForDedup, generateExifDedupKeys, CROSS_PLATFORM_DHASH_THRESHOLD };

export const findPerceptualHashMatch = (hash, hashSet, threshold = CROSS_PLATFORM_DHASH_THRESHOLD) => {
  if (!hash || hash.length !== 16 || !hashSet || hashSet.size === 0) return false;
  
  // First check exact match (fast path)
  if (hashSet.has(hash)) return true;
  
  // Check Hamming distance for fuzzy match
  for (const existingHash of hashSet) {
    if (existingHash && existingHash.length === 16) {
      const dist = hammingDistance64(hash, existingHash);
      if (dist <= threshold) {
        return true;
      }
    }
  }
  return false;
};

export const computePerceptualHash = async (filePath, asset = null, info = null) => {
  try {
    // Check if PixelHash native module is available
    if (!PixelHash || typeof PixelHash.hashImagePixels !== 'function') {
      console.warn('PixelHash native module not available for perceptual hashing');
      return null;
    }

    // Only compute for images (photos), not videos
    if (asset && info && !isImageAsset(info, asset)) {
      return null;
    }

    // Normalize path exactly like getHashTarget does for scanSimilarPhotos
    // This ensures backup dedup uses identical path handling as clean duplicates
    let hashTarget = filePath;
    if (hashTarget && typeof hashTarget === 'string') {
      // Strip file:// prefix
      if (hashTarget.startsWith('file://')) {
        hashTarget = hashTarget.replace('file://', '');
      }
      // Remove query params and fragments
      const hashIdx = hashTarget.indexOf('#');
      if (hashIdx !== -1) hashTarget = hashTarget.slice(0, hashIdx);
      const qIdx = hashTarget.indexOf('?');
      if (qIdx !== -1) hashTarget = hashTarget.slice(0, qIdx);
      // Decode URI-encoded characters (important for filenames with special chars)
      try { hashTarget = decodeURI(hashTarget); } catch (e) {}
    }

    // Compute pixel-based perceptual hash (same as scanSimilarPhotos)
    const hashHex = await PixelHash.hashImagePixels(hashTarget);
    console.log(`[PixelHash-JS] Native module returned: ${hashHex ? hashHex.length : 0} chars for ${hashTarget}`);
    return hashHex || null;
  } catch (e) {
    console.warn('computePerceptualHash failed:', e?.message);
    return null;
  }
};

export const computeExactFileHash = async (filePath) => {
  try {
    const hashCtx = sha256.create();
    const HASH_CHUNK_BYTES = 256 * 1024;

    if (Platform.OS === 'ios') {
      const fileUri = filePath.startsWith('/') ? `file://${filePath}` : filePath;
      let position = 0;
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
      }
    } else {
      let ReactNativeBlobUtil = null;
      try {
        const mod = require('react-native-blob-util');
        ReactNativeBlobUtil = mod && (mod.default || mod);
      } catch (e) {}
      if (!ReactNativeBlobUtil || !ReactNativeBlobUtil.fs || typeof ReactNativeBlobUtil.fs.readStream !== 'function') {
        throw new Error('Exact file hash requires react-native-blob-util on Android.');
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
    console.warn('computeExactFileHash failed:', e?.message || e);
    return null;
  }
};

// ============================================================================
// EXACT DUPLICATES - Pixel hashing helpers
// ============================================================================

/**
 * Resolves a readable file path for an asset.
 * Handles ph://, content://, file:// URIs.
 * @param {Object} params
 * @param {string} params.assetId - The asset ID
 * @param {Object} params.assetInfo - The asset info object
 * @param {Function} params.resolveReadableFilePath - Function to resolve readable file path
 * @returns {Promise<{filePath: string|null, tmpCopied: boolean, tmpUri: string|null}>}
 */
const getHashTarget = async ({ asset, info, resolveReadableFilePath }) => {
  let hashTarget = null;
  let tmpCopied = false;
  let tmpUri = null;
  const rawUri = (info && (info.localUri || info.uri)) || null;
  
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
      // Always stage to temp file for consistent hashing
      // Android content:// URIs can return different pixel data (e.g., Google Photos cloud re-encoding)
      {
        // Need to stage to temp file
        try {
          const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo: info });
          hashTarget = resolved && resolved.filePath ? resolved.filePath : null;
          tmpCopied = resolved && resolved.tmpCopied ? resolved.tmpCopied : false;
          tmpUri = resolved && resolved.tmpUri ? resolved.tmpUri : null;
        } catch (e) {
          // iOS fallback: try with shouldDownloadFromNetwork
          if (Platform.OS === 'ios') {
            try {
              const infoDownloaded = await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: true });
              const dlUri = (infoDownloaded && (infoDownloaded.localUri || infoDownloaded.uri)) || null;
              if (dlUri && typeof dlUri === 'string' && (dlUri.startsWith('file://') || dlUri.startsWith('/'))) {
                hashTarget = dlUri.startsWith('file://') ? dlUri.replace('file://', '') : dlUri;
              } else {
                const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo: infoDownloaded });
                hashTarget = resolved && resolved.filePath ? resolved.filePath : null;
                tmpCopied = resolved && resolved.tmpCopied ? resolved.tmpCopied : false;
                tmpUri = resolved && resolved.tmpUri ? resolved.tmpUri : null;
              }
            } catch (e2) {
              // Failed to get readable path
            }
          }
        }
      }
    }
  }
  
  return { hashTarget, tmpCopied, tmpUri, rawUri };
};

/**
 * Checks if an asset is an image based on mediaType or filename.
 * @param {Object} info - Asset info
 * @param {Object} asset - Asset object
 * @returns {boolean}
 */
const isImageAsset = (info, asset) => {
  const mt = (info && info.mediaType) || asset.mediaType;
  if (mt === 'photo' || mt === 'image') return true;
  const name = (info && info.filename) || asset.filename || '';
  return /\.(jpe?g|png|heic|heif|webp)$/i.test(name);
};

/**
 * Collects all photo assets from device, including all albums.
 * @returns {Promise<Array>} Array of assets
 */
export const collectAllPhotoAssets = async () => {
  const allAssetsArray = [];
  const seenIds = new Set();
  
  // First get assets without album filter (main camera roll)
  let mainAssets = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    mainAssets = await MediaLibrary.getAssetsAsync({
      first: 10000,
      mediaType: ['photo'],
    });
    if (mainAssets && mainAssets.assets && mainAssets.assets.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (mainAssets && mainAssets.assets) {
    for (const asset of mainAssets.assets) {
      if (!seenIds.has(asset.id)) {
        seenIds.add(asset.id);
        allAssetsArray.push(asset);
      }
    }
  }
  
  // Scan all albums to catch Screenshots, Downloads, WhatsApp, etc.
  try {
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    for (const album of albums) {
      try {
        const albumAssets = await MediaLibrary.getAssetsAsync({
          first: 5000,
          album: album.id,
          mediaType: ['photo'],
        });
        if (albumAssets && albumAssets.assets) {
          for (const asset of albumAssets.assets) {
            if (!seenIds.has(asset.id)) {
              seenIds.add(asset.id);
              allAssetsArray.push(asset);
            }
          }
        }
      } catch (e) {
        // Skip albums that fail
      }
    }
  } catch (e) {
    console.log('DuplicateScanner: Could not scan albums:', e?.message || e);
  }
  
  return allAssetsArray;
};

/**
 * Scans for exact duplicate photos using pixel-based SHA256 hashing.
 * 
 * @param {Object} params
 * @param {Array} params.assets - Array of assets to scan
 * @param {Function} params.resolveReadableFilePath - Function to resolve readable file path
 * @param {Function} params.onProgress - Progress callback (hashedCount, totalCount, lastHash)
 * @returns {Promise<{duplicateGroups: Array, stats: Object}>}
 */
export const scanExactDuplicates = async ({ assets, resolveReadableFilePath, onProgress }) => {
  console.log('DuplicateScanner: Starting exact duplicate scan with pixel hashing');
  
  // Check if PixelHash native module is available
  if (!PixelHash || typeof PixelHash.hashImagePixels !== 'function') {
    throw new Error('PixelHash native module not available. Please rebuild the app.');
  }
  
  const hashGroups = {};
  let hashedCount = 0;
  let inspectFailed = 0;
  let hashSkipped = 0;
  let skippedNoUri = 0;
  let hashFailed = 0;
  const sampleSkipped = [];

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    let info;
    try {
      // On iOS, request download from network to get local file
      info = Platform.OS === 'ios' 
        ? await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: true })
        : await MediaLibrary.getAssetInfoAsync(asset.id);
    } catch (e) {
      inspectFailed++;
      continue;
    }

    // Photos-only: skip anything that isn't an image
    if (!isImageAsset(info, asset)) {
      hashSkipped++;
      if (sampleSkipped.length < 5) {
        sampleSkipped.push({ filename: info?.filename || asset.filename, reason: 'not an image' });
      }
      continue;
    }

    // Get a readable file path
    const { hashTarget, tmpCopied, tmpUri, rawUri } = await getHashTarget({ 
      asset, 
      info, 
      resolveReadableFilePath 
    });
    
    if (!hashTarget) {
      hashSkipped++;
      skippedNoUri++;
      if (sampleSkipped.length < 5 && !sampleSkipped.find(s => s.filename === (info?.filename || asset.filename))) {
        sampleSkipped.push({ filename: info?.filename || asset.filename, reason: 'no readable path', uri: rawUri || '' });
      }
      continue;
    }

    try {
      // Compute 16-char dHash (perceptual hash) - fast and consistent for identical images
      // Groups by exact hash match (no fuzzy threshold)
      const hashHex = await PixelHash.hashImagePixels(hashTarget);
      
      if (hashedCount < 3) {
        console.log('DuplicateScanner: dHash computed', {
          filename: info?.filename || asset.filename,
          hashStart: hashHex ? hashHex.substring(0, 8) + '...' : 'none',
        });
      }

      hashedCount++;

      // Progress callback
      if (hashedCount % 10 === 0 && onProgress) {
        onProgress(hashedCount, assets.length, hashHex ? hashHex.substring(0, 12) : '');
      }

      // Group by hash - skip if hash is null/empty
      if (!hashHex) {
        hashSkipped++;
        hashFailed++;
        if (sampleSkipped.length < 5) {
          sampleSkipped.push({ filename: info?.filename || asset.filename, reason: 'hash returned empty' });
        }
        continue;
      }
      if (!hashGroups[hashHex]) hashGroups[hashHex] = [];
      hashGroups[hashHex].push({ asset, info });

    } catch (e) {
      hashSkipped++;
      hashFailed++;
      if (sampleSkipped.length < 5) {
        sampleSkipped.push({ filename: info?.filename || asset.filename, reason: 'hash failed: ' + (e?.message || e) });
      }
    } finally {
      // Clean up temp file if created
      if (tmpCopied && tmpUri) {
        try {
          await FileSystem.deleteAsync(tmpUri, { idempotent: true });
        } catch (e2) {
          // ignore
        }
      }
    }
  }

  console.log('DuplicateScanner: Scan complete', {
    totalAssets: assets.length,
    hashedCount,
    hashSkipped,
    inspectFailed,
    hashGroupsCount: Object.keys(hashGroups).length
  });

  // Convert hash groups to duplicate groups (groups with >1 item)
  // Sort each group by creation time: oldest first (keep oldest, delete newer)
  const duplicateGroups = [];
  Object.values(hashGroups).forEach(group => {
    if (group.length > 1) {
      group.sort((a, b) => {
        const aTime = (a.info && a.info.creationTime) || a.asset.creationTime || 0;
        const bTime = (b.info && b.info.creationTime) || b.asset.creationTime || 0;
        return aTime - bTime;
      });
      duplicateGroups.push(group);
      console.log('DuplicateScanner: Found duplicate group, size:', group.length, 
        'keeping oldest:', (group[0].info?.filename || group[0].asset.filename));
    }
  });

  return {
    duplicateGroups,
    stats: {
      totalAssets: assets.length,
      hashedCount,
      hashSkipped,
      hashFailed,
      inspectFailed,
      skippedNoUri,
      sampleSkipped
    }
  };
};

/**
 * Formats duplicate groups for review UI.
 * @param {Array} duplicateGroups - Array of duplicate groups
 * @returns {Array} Formatted review groups
 */
export const formatDuplicateGroupsForReview = (duplicateGroups) => {
  return duplicateGroups.map((group, idx) => {
    const sorted = [...group].sort((a, b) => {
      const at = a.info?.creationTime || a.asset.creationTime || 0;
      const bt = b.info?.creationTime || b.asset.creationTime || 0;
      return at - bt;
    });
    const items = sorted.map((it, itemIdx) => ({
      id: it.asset.id,
      filename: it.info?.filename || it.asset.filename || it.asset.id,
      created: it.info?.creationTime || it.asset.creationTime || 0,
      size: it.info?.fileSize || null,
      uri: it.info?.localUri || it.info?.uri || it.asset.uri || '',
      delete: itemIdx > 0 // keep oldest (index 0)
    }));
    return { type: 'exact', groupIndex: idx + 1, items };
  });
};

/**
 * Counts total duplicates (items to delete) from groups.
 * @param {Array} duplicateGroups - Array of duplicate groups
 * @returns {number} Total duplicate count
 */
export const countDuplicates = (duplicateGroups) => {
  let count = 0;
  duplicateGroups.forEach(group => {
    count += (group.length - 1); // Keep 1, delete rest
  });
  return count;
};

/**
 * Builds a summary note for when no duplicates are found.
 * @param {Object} stats - Stats from scanExactDuplicates
 * @returns {string} Summary note
 */
export const buildNoResultsNote = (stats) => {
  const noteParts = [];
  noteParts.push(`Analyzed ${stats.hashedCount} photos.`);
  if (stats.hashSkipped > 0) noteParts.push(`Skipped: ${stats.hashSkipped}`);
  if (stats.hashFailed > 0) noteParts.push(`Analysis failures: ${stats.hashFailed}`);
  if (stats.inspectFailed > 0) noteParts.push(`Asset-info failures: ${stats.inspectFailed}`);
  if (stats.sampleSkipped && stats.sampleSkipped.length > 0) {
    noteParts.push('Examples (max 3):');
    stats.sampleSkipped.slice(0, 3).forEach(s => {
      noteParts.push(`- ${s.filename}${s.reason ? ' — ' + s.reason : ''}`);
    });
  }
  return noteParts.length > 0 ? `\n${noteParts.join('\n')}` : '';
};

// ============================================================================
// SIMILAR PHOTOS - Main scanning function (simplified like image-hash library)
// ============================================================================

/**
 * Scans for similar photos using 16x16 perceptual hash + time proximity.
 * Detects burst shots: same scene, slight differences (hand moved, posture, emotion, wind, etc.)
 * 
 * @param {Object} params
 * @param {Function} params.resolveReadableFilePath - Function to resolve readable file path
 * @param {Function} params.onProgress - Progress callback (current, total, status)
 * @returns {Promise<Array>} Array of similar photo groups (each group is array of assets)
 */
export const scanSimilarPhotos = async ({ resolveReadableFilePath, onProgress }) => {
  console.log('DuplicateScanner: Starting similar photos scan (simplified)...');
  
  // Check if PixelHash native module is available
  if (!PixelHash || typeof PixelHash.hashImagePixels !== 'function') {
    throw new Error('PixelHash native module not available. Please rebuild the app.');
  }
  
  const MAX_SCAN = 2000;
  let after = null;
  let scanned = 0;
  let all = [];

  while (scanned < MAX_SCAN) {
    const page = await MediaLibrary.getAssetsAsync({
      first: Math.min(500, MAX_SCAN - scanned),
      after: after || undefined,
      mediaType: ['photo'],
    });
    const assets = page && Array.isArray(page.assets) ? page.assets : [];
    all = all.concat(assets);
    scanned += assets.length;
    after = page && page.endCursor ? page.endCursor : null;
    if (!page || page.hasNextPage !== true) break;
    if (assets.length === 0) break;
  }

  console.log('DuplicateScanner: Loaded', all.length, 'photos for similar scan');
  if (onProgress) onProgress(0, all.length, `Scanning ${all.length} photos...`);

  // Filter and sort by creation time (important for burst detection)
  all = all.filter(a => a && a.id && typeof a.creationTime === 'number');
  all.sort((a, b) => (a.creationTime || 0) - (b.creationTime || 0));

  // Compute 16x16 perceptual hash for each photo (same as exact duplicates)
  const items = [];
  let hashed = 0;
  let hashFailed = 0;

  for (let i = 0; i < all.length; i++) {
    const asset = all[i];
    if (i % 20 === 0 && onProgress) {
      onProgress(i, all.length, `Analyzing ${i + 1}/${all.length} photos...`);
    }
    
    let info = null;
    let hash = null;
    let edgeHash = null;
    let cornerHash = null;
    
    try {
      info = await MediaLibrary.getAssetInfoAsync(asset.id, Platform.OS === 'ios' ? { shouldDownloadFromNetwork: true } : undefined);

      // Get readable file path
      const { hashTarget, tmpCopied, tmpUri } = await getHashTarget({ 
        asset, 
        info, 
        resolveReadableFilePath 
      });

      if (hashTarget) {
        try {
          // Use same 16x16 hash as exact duplicates
          hash = await PixelHash.hashImagePixels(hashTarget);
          // Also compute edge hash (5% border from all 4 sides)
          if (PixelHash.hashImageEdges) {
            try {
              edgeHash = await PixelHash.hashImageEdges(hashTarget);
            } catch (e) {
              // Edge hash is optional, continue without it
            }
          }
          // Also compute corner hash (4 corners, grayscale)
          if (PixelHash.hashImageCorners) {
            try {
              cornerHash = await PixelHash.hashImageCorners(hashTarget);
            } catch (e) {
              // Corner hash is optional, continue without it
            }
          }
          if (hash) hashed++;
        } catch (e) {
          hashFailed++;
        } finally {
          if (tmpCopied && tmpUri) {
            try { await FileSystem.deleteAsync(tmpUri, { idempotent: true }); } catch (e2) {}
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
        edgeHash: edgeHash || null,
        cornerHash: cornerHash || null,
        createdTs: asset.creationTime || 0,
        filename: (info && info.filename) || asset.filename || '',
      });
    }
  }

  console.log('DuplicateScanner: Similar hash summary', { total: all.length, hashed, hashFailed });
  if (onProgress) onProgress(all.length, all.length, 'Finding similar groups...');

  // Find similar pairs using hamming distance + time proximity + edge matching
  // Similar shots: same lighting/colors but slight differences (hand moved, posture, emotion, wind, leaves, water)
  const similarPairs = [];
  const seen = new Set();

  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      
      // Time difference
      const dt = Math.abs((b.createdTs || 0) - (a.createdTs || 0));
      
      // Hamming distance between 64-bit dHash (16-char hex from native module)
      const dist = hammingDistance64(a.hash, b.hash);
      
      // Edge hash comparison (5% border from all 4 sides)
      // If edges match exactly, photos have same background/scene
      const edgeDist = (a.edgeHash && b.edgeHash) ? hammingDistance32(a.edgeHash, b.edgeHash) : Number.MAX_SAFE_INTEGER;
      const edgesMatch = edgeDist <= EDGE_MATCH_THRESHOLD;
      
      // Corner hash comparison (4 corners, grayscale)
      // If corners match, photos have same scene framing
      const cornerDist = (a.cornerHash && b.cornerHash) ? hammingDistance16(a.cornerHash, b.cornerHash) : Number.MAX_SAFE_INTEGER;
      const cornersMatch = cornerDist <= CORNER_MATCH_THRESHOLD;
      
      // Determine threshold based on time proximity (scaled for 64-bit dHash)
      // Burst shots (within 60s): allow more difference (hand shake, posture change)
      // Longer apart: require more similarity
      let threshold;
      if (dt <= 5000) {
        // Within 5 seconds - very likely burst, allow up to 8 bits different
        threshold = 8;
      } else if (dt <= 30000) {
        // Within 30 seconds - likely burst, allow up to 7 bits
        threshold = 7;
      } else if (dt <= 60000) {
        // Within 1 minute - possible burst, allow up to 6 bits
        threshold = 6;
      } else if (dt <= 300000) {
        // Within 5 minutes - maybe same session, allow up to 5 bits
        threshold = 5;
      } else {
        // More than 5 minutes apart - require very similar (4 bits)
        threshold = 4;
      }
      
      // EDGE MATCH BOOST: If edges match (same background/scene), relax threshold significantly
      // This catches cases where subject moved but background is identical
      if (edgesMatch) {
        threshold = Math.max(threshold, 10); // Allow up to 10 bits different if edges match
      }
      
      // CORNER MATCH BOOST: If corners match (same scene framing in B&W), relax threshold
      // This catches cases where center changed but corners are identical
      if (cornersMatch) {
        threshold = Math.max(threshold, 11); // Allow up to 11 bits different if corners match
      }
      
      // DOUBLE MATCH: If both edges AND corners match, very likely same scene
      if (edgesMatch && cornersMatch) {
        threshold = Math.max(threshold, 12); // Allow up to 12 bits different
      }
      
      if (dist > threshold) continue;
      
      const key = [a.asset.id, b.asset.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      
      similarPairs.push({ a, b, dist, dt, edgeDist, edgesMatch, cornerDist, cornersMatch });
      
      if (similarPairs.length <= 5) {
        console.log('DuplicateScanner: Similar pair found', {
          dist,
          edgeDist,
          edgesMatch,
          cornerDist,
          cornersMatch,
          dt: Math.round(dt / 1000) + 's',
          threshold,
          aName: a.filename,
          bName: b.filename
        });
      }
    }
  }
  
  console.log('DuplicateScanner: Found', similarPairs.length, 'similar pairs');

  // Union-Find clustering to group all connected similar photos
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
  
  const assetMap = new Map();
  for (const item of items) { assetMap.set(item.asset.id, item.asset); }
  
  for (const pair of similarPairs) { union(pair.a.asset.id, pair.b.asset.id); }
  
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
      // Sort by creation time (oldest first - keep oldest, delete newer)
      group.sort((a, b) => (a.creationTime || 0) - (b.creationTime || 0));
      finalGroups.push(group);
    }
  }
  
  // Sort groups by size (largest first)
  finalGroups.sort((a, b) => b.length - a.length);
  console.log('DuplicateScanner: Final similar groups:', finalGroups.length);
  return finalGroups;
};

// ============================================================================
// DELETE ASSETS HELPER
// ============================================================================

/**
 * Deletes assets using native MediaDelete on Android, MediaLibrary on iOS.
 * @param {Array<string>} ids - Array of asset IDs to delete
 * @returns {Promise<{success: boolean, deleted: number}>}
 */
export const deleteAssets = async (ids) => {
  if (!ids || ids.length === 0) {
    return { success: true, deleted: 0 };
  }
  
  try {
    if (Platform.OS === 'android' && MediaDelete && typeof MediaDelete.deleteAssets === 'function') {
      console.log('DuplicateScanner: Using native MediaDelete for', ids.length, 'items');
      const result = await MediaDelete.deleteAssets(ids);
      if (result === true) {
        return { success: true, deleted: ids.length };
      } else {
        return { success: false, deleted: 0 };
      }
    } else {
      // iOS or fallback
      const result = await MediaLibrary.deleteAssetsAsync(ids);
      if (result === true || typeof result === 'undefined') {
        return { success: true, deleted: ids.length };
      } else {
        return { success: false, deleted: 0 };
      }
    }
  } catch (e) {
    console.log('DuplicateScanner: Delete error', e?.message || e);
    throw e;
  }
};

export default {
  collectAllPhotoAssets,
  scanExactDuplicates,
  scanSimilarPhotos,
  formatDuplicateGroupsForReview,
  countDuplicates,
  buildNoResultsNote,
  deleteAssets
};
