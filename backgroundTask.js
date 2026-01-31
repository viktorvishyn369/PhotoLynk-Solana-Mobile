// PhotoLynk Mobile App - Background Task & Crypto Helpers

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as MediaLibrary from 'expo-media-library';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as ImageManipulator from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import axios from 'axios';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { sha256 } from 'js-sha256';

import {
  normalizeFilePath,
  makeChunkNonce,
  sanitizeHeaders,
  stripContentType,
  withRetries,
  shouldRetryChunkUpload,
  computeFileIdentity,
} from './utils';

import {
  computeExactFileHash,
  computePerceptualHash,
  findPerceptualHashMatch,
  CROSS_PLATFORM_DHASH_THRESHOLD,
} from './duplicateScanner';

import {
  AUTO_UPLOAD_BACKGROUND_TASK,
  autoUploadEligibilityForBackground,
  autoUploadGetAuthHeadersFromSecureStore
} from './autoUpload';

// Constants
export const MB = 1024 * 1024;
export const AUTO_UPLOAD_CURSOR_KEY = 'auto_upload_cursor_v1';

// Resolve readable file path (stages asset if needed)
export const resolveReadableFilePath = async ({ assetId, assetInfo }) => {
  let localUri = (assetInfo && (assetInfo.localUri || assetInfo.uri)) || null;
  
  // If no localUri, try to get it via getAssetInfoAsync (needed for Android)
  if (!localUri && assetId) {
    try {
      const fullInfo = await MediaLibrary.getAssetInfoAsync(assetId);
      localUri = fullInfo?.localUri || fullInfo?.uri || null;
    } catch (e) {
      // Fall through to error
    }
  }
  
  if (!localUri) throw new Error('Missing localUri');
  if (localUri.startsWith('file://') || localUri.startsWith('/')) {
    const p = normalizeFilePath(localUri);
    if (!p) throw new Error('Invalid file path');
    return { filePath: p, tmpCopied: false };
  }
  const ext = (assetInfo && (assetInfo.filename || '').includes('.'))
    ? `.${assetInfo.filename.split('.').pop()}`
    : '';
  const tmpUri = `${FileSystem.cacheDirectory}sc_src_${assetId}${ext}`;
  await FileSystem.deleteAsync(tmpUri, { idempotent: true });
  if (typeof FileSystem.copyAsync === 'function') {
    await FileSystem.copyAsync({ from: localUri, to: tmpUri });
  } else {
    const data = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
    await FileSystem.writeAsStringAsync(tmpUri, data, { encoding: FileSystem.EncodingType.Base64 });
  }
  const p = normalizeFilePath(tmpUri);
  if (!p) throw new Error('Failed to stage asset');
  return { filePath: p, tmpCopied: true, tmpUri };
};

// PBKDF2-HMAC-SHA256 implementation using js-sha256
// Matches Node.js crypto.pbkdf2Sync(password, salt, iterations, keylen, 'sha256')
const pbkdf2Sha256 = (password, salt, iterations, keyLen) => {
  const encoder = new TextEncoder();
  const passwordBytes = typeof password === 'string' ? encoder.encode(password) : password;
  const saltBytes = typeof salt === 'string' ? encoder.encode(salt) : salt;
  
  // HMAC-SHA256 helper
  const hmacSha256 = (key, data) => {
    const blockSize = 64;
    let keyBytes = key;
    if (keyBytes.length > blockSize) {
      keyBytes = new Uint8Array(sha256.arrayBuffer(keyBytes));
    }
    if (keyBytes.length < blockSize) {
      const padded = new Uint8Array(blockSize);
      padded.set(keyBytes);
      keyBytes = padded;
    }
    const oKeyPad = new Uint8Array(blockSize);
    const iKeyPad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      oKeyPad[i] = keyBytes[i] ^ 0x5c;
      iKeyPad[i] = keyBytes[i] ^ 0x36;
    }
    const inner = new Uint8Array(iKeyPad.length + data.length);
    inner.set(iKeyPad);
    inner.set(data, iKeyPad.length);
    const innerHash = new Uint8Array(sha256.arrayBuffer(inner));
    const outer = new Uint8Array(oKeyPad.length + innerHash.length);
    outer.set(oKeyPad);
    outer.set(innerHash, oKeyPad.length);
    return new Uint8Array(sha256.arrayBuffer(outer));
  };
  
  const hashLen = 32; // SHA-256 output length
  const numBlocks = Math.ceil(keyLen / hashLen);
  const result = new Uint8Array(numBlocks * hashLen);
  
  for (let blockNum = 1; blockNum <= numBlocks; blockNum++) {
    // U1 = HMAC(password, salt || INT_32_BE(blockNum))
    const blockBytes = new Uint8Array(4);
    blockBytes[0] = (blockNum >>> 24) & 0xff;
    blockBytes[1] = (blockNum >>> 16) & 0xff;
    blockBytes[2] = (blockNum >>> 8) & 0xff;
    blockBytes[3] = blockNum & 0xff;
    const saltBlock = new Uint8Array(saltBytes.length + 4);
    saltBlock.set(saltBytes);
    saltBlock.set(blockBytes, saltBytes.length);
    
    let u = hmacSha256(passwordBytes, saltBlock);
    const block = new Uint8Array(u);
    
    for (let i = 1; i < iterations; i++) {
      u = hmacSha256(passwordBytes, u);
      for (let j = 0; j < hashLen; j++) {
        block[j] ^= u[j];
      }
    }
    
    result.set(block, (blockNum - 1) * hashLen);
  }
  
  return result.slice(0, keyLen);
};

// Derive StealthCloud master encryption key from user credentials
// Uses PBKDF2 with email as salt, matching desktop app's deriveMasterKey()
// This ensures same user on different devices gets the same encryption key
// Cache the derived master key in SecureStore so we don't need biometrics on every backup
const DERIVED_MASTER_KEY_CACHE = 'stealthcloud_derived_key_v2';

export const getStealthCloudMasterKey = async () => {
  // First check if we have a cached derived key (set during login)
  try {
    const cached = await SecureStore.getItemAsync(DERIVED_MASTER_KEY_CACHE);
    if (cached) {
      console.log('StealthCloud: using cached derived key');
      return naclUtil.decodeBase64(cached);
    }
  } catch (e) {
    // Ignore
  }

  // Try to derive from credentials (this path is mainly for login flow)
  const email = await SecureStore.getItemAsync('user_email');
  let password = null;
  // Password is stored with key 'user_password_v1' (SAVED_PASSWORD_KEY from autoUpload.js)
  // On iOS it may be stored with requireAuthentication: true, so try without auth first
  try {
    password = await SecureStore.getItemAsync('user_password_v1');
  } catch (e) {
    // Ignore
  }
  if (!password) {
    try {
      password = await SecureStore.getItemAsync('user_password_v1', {
        requireAuthentication: false
      });
    } catch (e) {
      // Ignore
    }
  }

  console.log('StealthCloud masterKey: email=', email ? 'present' : 'missing', 'password=', password ? 'present' : 'missing');

  if (!email || !password) {
    // Fallback to legacy random key if credentials not available
    // This handles edge cases like background tasks before login
    const keyName = 'stealthcloud_master_key_v1';
    const existing = await SecureStore.getItemAsync(keyName);
    if (existing) {
      console.log('StealthCloud: using legacy random key (credentials missing)');
      return naclUtil.decodeBase64(existing);
    }
    const key = new Uint8Array(32);
    global.crypto.getRandomValues(key);
    await SecureStore.setItemAsync(keyName, naclUtil.encodeBase64(key));
    console.log('StealthCloud: created new legacy random key (no credentials)');
    return key;
  }

  // Derive key from credentials using PBKDF2 (same as desktop app)
  const salt = email.toLowerCase().trim();
  console.log('StealthCloud: deriving key from credentials, salt=', salt);
  const derivedKey = pbkdf2Sha256(password, salt, 30000, 32);
  
  // Cache the derived key so we don't need password again (avoids biometrics prompt)
  try {
    await SecureStore.setItemAsync(DERIVED_MASTER_KEY_CACHE, naclUtil.encodeBase64(derivedKey));
    console.log('StealthCloud: cached derived key');
  } catch (e) {
    console.log('StealthCloud: failed to cache derived key', e.message);
  }
  
  return derivedKey;
};

// Call this during login to pre-derive and cache the master key
// Returns a Promise that resolves after key derivation completes
// Uses setTimeout to yield to the UI thread during heavy PBKDF2 computation
export const cacheStealthCloudMasterKey = async (email, password) => {
  if (!email || !password) return;
  // If already cached, skip re-deriving to avoid extra PBKDF2 cost
  try {
    const existing = await SecureStore.getItemAsync(DERIVED_MASTER_KEY_CACHE);
    if (existing) {
      console.log('StealthCloud: derived key already cached, skipping PBKDF2');
      return;
    }
  } catch (e) {
    // ignore and derive below
  }
  
  // Yield to UI thread before starting heavy computation
  await new Promise(resolve => setTimeout(resolve, 50));
  
  const salt = email.toLowerCase().trim();
  const derivedKey = pbkdf2Sha256(password, salt, 30000, 32);
  
  // Yield again after computation
  await new Promise(resolve => setTimeout(resolve, 10));
  
  try {
    await SecureStore.setItemAsync(DERIVED_MASTER_KEY_CACHE, naclUtil.encodeBase64(derivedKey));
    console.log('StealthCloud: pre-cached derived key during login');
  } catch (e) {
    console.log('StealthCloud: failed to pre-cache derived key', e.message);
  }
};

// Call this on logout to clear the cached key
export const clearStealthCloudMasterKeyCache = async () => {
  try {
    await SecureStore.deleteItemAsync(DERIVED_MASTER_KEY_CACHE);
    console.log('StealthCloud: cleared cached derived key');
  } catch (e) {
    // Ignore
  }
};

// Upload encrypted chunk (background task version - simpler)
export const uploadEncryptedChunk = async ({ SERVER_URL, config, chunkId, encryptedBytes }) => {
  const tmpUri = `${FileSystem.cacheDirectory}sc_${chunkId}.bin`;
  const b64 = naclUtil.encodeBase64(encryptedBytes);
  await FileSystem.writeAsStringAsync(tmpUri, b64, { encoding: FileSystem.EncodingType.Base64 });
  const url = `${SERVER_URL}/api/cloud/chunks`;
  const baseHeaders = sanitizeHeaders({ 'X-Chunk-Id': chunkId, ...(config && config.headers ? config.headers : {}) });
  const headers = { ...stripContentType(baseHeaders), 'Content-Type': 'application/octet-stream' };
  await withRetries(async () => {
    const res = await FileSystem.uploadAsync(url, tmpUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      sessionType: Platform.OS === 'ios' ? FileSystem.FileSystemSessionType.BACKGROUND : FileSystem.FileSystemSessionType.FOREGROUND,
      headers
    });
    const status = res && typeof res.status === 'number' ? res.status : 0;
    if (status >= 300) throw new Error(`Chunk upload failed: HTTP ${status}`);
    return res;
  }, { retries: 10, baseDelayMs: 1000, maxDelayMs: 30000, shouldRetry: shouldRetryChunkUpload });
  await FileSystem.deleteAsync(tmpUri, { idempotent: true });
};

// Upload single asset to StealthCloud (background task version)
export const autoUploadStealthCloudUploadOneAsset = async ({ 
  asset, config, SERVER_URL, existingManifestIds, 
  alreadyFilenames, alreadyBaseNameSizes, alreadyBaseNameDates, alreadyBaseNameTimestamps,
  alreadyPerceptualHashes, alreadyFileHashes,
  alreadyExifFull, alreadyExifTimeModel, alreadyExifTimeMake,
  onStatus, fastMode = false 
}) => {
  const logStep = (step, extra = '') => console.log(`[AutoUpload:${asset?.id?.substring(0,8)}] ${step}${extra ? ': ' + extra : ''}`);
  
  if (!asset || !asset.id) return { uploaded: 0, skipped: 0, failed: 0 };

  logStep('START', `mediaType=${asset.mediaType}, fastMode=${fastMode}`);
  
  if (onStatus) onStatus('encrypting');
  
  logStep('STEP1', 'Getting master key');
  const masterKey = await getStealthCloudMasterKey();
  logStep('STEP1', 'Master key obtained');

  logStep('STEP2', 'Getting asset info');
  let assetInfo = null;
  try {
    // Retry getAssetInfoAsync up to 6 times (iCloud/network issues)
    assetInfo = await withRetries(async () => {
      return Platform.OS === 'android'
        ? await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: true })
        : await MediaLibrary.getAssetInfoAsync(asset.id);
    }, { retries: 5, baseDelayMs: 1000, maxDelayMs: 15000, shouldRetry: () => true });
    logStep('STEP2', `Asset info obtained: filename=${assetInfo?.filename}`);
  } catch (e) {
    logStep('STEP2', `FAILED: ${e?.message}`);
    console.warn('Background: getAssetInfoAsync failed after retries:', asset.id, e?.message);
    return { uploaded: 0, skipped: 0, failed: 1 };
  }

  logStep('STEP3', 'Resolving file path');
  let staged = null;
  try {
    staged = await resolveReadableFilePath({ assetId: asset.id, assetInfo });
    logStep('STEP3', `File path resolved: ${staged?.filePath?.substring(0, 50)}...`);
  } catch (e) {
    logStep('STEP3', `FAILED: ${e?.message}`);
    return { uploaded: 0, skipped: 0, failed: 1 };
  }

  const filePath = staged && staged.filePath ? staged.filePath : null;
  if (!filePath) return { uploaded: 0, skipped: 0, failed: 1 };

  // Get file size for stable manifestId
  // CRITICAL: Use original asset size from MediaLibrary, not temporary copy size
  // Temporary copies may have different sizes (metadata stripped, compression, etc.)
  // which would create different manifestIds and cause duplicate uploads
  let originalSize = null;
  try {
    originalSize = assetInfo && typeof assetInfo.fileSize === 'number' ? Number(assetInfo.fileSize) : null;
  } catch (e) {
    originalSize = null;
  }
  
  // Fallback to file system size if assetInfo.fileSize not available
  if (!originalSize) {
    const fileUri = filePath.startsWith('/') ? `file://${filePath}` : filePath;
    try {
      const info = await FileSystem.getInfoAsync(fileUri);
      originalSize = info?.size || null;
    } catch (e) {}
  }

  // Compute stable cross-device manifestId from filename + size
  const filename = assetInfo.filename || asset.filename || null;
  const fileIdentity = computeFileIdentity(filename, originalSize);
  const manifestId = fileIdentity ? sha256(`file:${fileIdentity}`) : sha256(`asset:${asset.id}`);
  
  logStep('DEDUP', 'Checking deduplication');
  
  // Skip if already uploaded (by stable manifestId)
  if (existingManifestIds && existingManifestIds.has(manifestId)) {
    logStep('SKIP', 'manifestId already exists');
    if (staged && staged.tmpCopied && staged.tmpUri) {
      try { await FileSystem.deleteAsync(staged.tmpUri, { idempotent: true }); } catch (e) {}
    }
    return { uploaded: 0, skipped: 1, failed: 0, manifestId };
  }

  // Cross-platform deduplication checks
  const { normalizeFilenameForCompare } = require('./utils');
  const { extractBaseFilename, normalizeDateForCompare } = require('./duplicateScanner');
  
  // Skip if filename already exists on server
  const normalizedFilename = filename ? normalizeFilenameForCompare(filename) : null;
  if (normalizedFilename && alreadyFilenames && alreadyFilenames.has(normalizedFilename)) {
    logStep('SKIP', `filename already on server: ${filename}`);
    if (staged && staged.tmpCopied && staged.tmpUri) {
      try { await FileSystem.deleteAsync(staged.tmpUri, { idempotent: true }); } catch (e) {}
    }
    return { uploaded: 0, skipped: 1, failed: 0, manifestId };
  }

  // Cross-platform variant matching using base filename
  const baseFilename = filename ? extractBaseFilename(filename) : null;

  // HEIC PRIORITY: Full timestamp match (most reliable for cross-platform HEIC dedup)
  // HEIC files from iPhone and desktop have identical EXIF timestamps even if bytes differ
  const { normalizeFullTimestamp } = require('./duplicateScanner');
  const assetTimestamp = asset.creationTime ? normalizeFullTimestamp(asset.creationTime) : null;
  if (baseFilename && assetTimestamp && alreadyBaseNameTimestamps && alreadyBaseNameTimestamps.has(baseFilename)) {
    const existingTimestamps = alreadyBaseNameTimestamps.get(baseFilename);
    if (existingTimestamps.has(assetTimestamp)) {
      console.log(`AutoUpload: Skipping ${filename} - baseFilename+timestamp match (${baseFilename}, ${assetTimestamp})`);
      if (staged && staged.tmpCopied && staged.tmpUri) {
        try { await FileSystem.deleteAsync(staged.tmpUri, { idempotent: true }); } catch (e) {}
      }
      return { uploaded: 0, skipped: 1, failed: 0, manifestId };
    }
  }

  // EXIF-based deduplication for cross-platform HEIC matching
  // Extract real EXIF data from the file and compare with manifest EXIF data
  const isHEIC = filename && /\.(heic|heif)$/i.test(filename);
  if (isHEIC && (alreadyExifFull || alreadyExifTimeModel || alreadyExifTimeMake)) {
    try {
      const { extractExifFromHEIC } = require('./exifExtractor');
      const exifData = await extractExifFromHEIC(filePath);
      if (exifData && exifData.captureTime) {
        const ct = exifData.captureTime;
        const mk = exifData.make;
        const md = exifData.model;
        // Check EXIF matches in priority order (highest confidence first)
        if (ct && mk && md && alreadyExifFull && alreadyExifFull.has(`${ct}|${mk}|${md}`)) {
          console.log(`AutoUpload: Skipping ${filename} - EXIF full match (time+make+model)`);
          if (staged && staged.tmpCopied && staged.tmpUri) {
            try { await FileSystem.deleteAsync(staged.tmpUri, { idempotent: true }); } catch (e) {}
          }
          return { uploaded: 0, skipped: 1, failed: 0, manifestId };
        }
        if (ct && md && alreadyExifTimeModel && alreadyExifTimeModel.has(`${ct}|${md}`)) {
          console.log(`AutoUpload: Skipping ${filename} - EXIF time+model match`);
          if (staged && staged.tmpCopied && staged.tmpUri) {
            try { await FileSystem.deleteAsync(staged.tmpUri, { idempotent: true }); } catch (e) {}
          }
          return { uploaded: 0, skipped: 1, failed: 0, manifestId };
        }
        if (ct && mk && alreadyExifTimeMake && alreadyExifTimeMake.has(`${ct}|${mk}`)) {
          console.log(`AutoUpload: Skipping ${filename} - EXIF time+make match`);
          if (staged && staged.tmpCopied && staged.tmpUri) {
            try { await FileSystem.deleteAsync(staged.tmpUri, { idempotent: true }); } catch (e) {}
          }
          return { uploaded: 0, skipped: 1, failed: 0, manifestId };
        }
      }
    } catch (e) {
      console.warn('AutoUpload: EXIF extraction failed for', filename, e?.message);
    }
  }
  
  // Fallback 1: base filename + size match (within 20% tolerance for re-compression)
  if (baseFilename && alreadyBaseNameSizes && alreadyBaseNameSizes.has(baseFilename)) {
    const existingSizes = alreadyBaseNameSizes.get(baseFilename);
    for (const existingSize of existingSizes) {
      const sizeDiff = Math.abs(originalSize - existingSize) / Math.max(originalSize, existingSize);
      if (sizeDiff < 0.20) {
        console.log(`AutoUpload: Skipping ${filename} - baseFilename+size match (${baseFilename}, size diff ${(sizeDiff * 100).toFixed(1)}%)`);
        if (staged && staged.tmpCopied && staged.tmpUri) {
          try { await FileSystem.deleteAsync(staged.tmpUri, { idempotent: true }); } catch (e) {}
        }
        return { uploaded: 0, skipped: 1, failed: 0, manifestId };
      }
    }
  }

  // Fallback 2: base filename + creation date match
  const assetDate = asset.creationTime ? normalizeDateForCompare(asset.creationTime) : null;
  if (baseFilename && assetDate && alreadyBaseNameDates && alreadyBaseNameDates.has(baseFilename)) {
    const existingDates = alreadyBaseNameDates.get(baseFilename);
    if (existingDates.has(assetDate)) {
      console.log(`AutoUpload: Skipping ${filename} - baseFilename+date match (${baseFilename}, ${assetDate})`);
      if (staged && staged.tmpCopied && staged.tmpUri) {
        try { await FileSystem.deleteAsync(staged.tmpUri, { idempotent: true }); } catch (e) {}
      }
      return { uploaded: 0, skipped: 1, failed: 0, manifestId };
    }
  }

  // Compute hashes for deduplication (same as main upload)
  const isImage = asset.mediaType === 'photo';
  let exactFileHash = null;
  let perceptualHash = null;

  logStep('STEP4', `Computing hashes (isImage=${isImage})`);
  if (isImage) {
    // Images: compute perceptual hash for transcoding-resistant deduplication
    try {
      logStep('STEP4a', 'Computing perceptual hash');
      perceptualHash = await computePerceptualHash(filePath, asset, assetInfo);
      logStep('STEP4a', `Perceptual hash: ${perceptualHash ? 'computed' : 'null'}`);
    } catch (e) {
      logStep('STEP4a', `FAILED: ${e?.message}`);
      console.warn('Background: computePerceptualHash failed:', asset.id, e?.message);
    }
    // Skip if perceptual hash already exists on server
    if (perceptualHash && alreadyPerceptualHashes && findPerceptualHashMatch(perceptualHash, alreadyPerceptualHashes, CROSS_PLATFORM_DHASH_THRESHOLD)) {
      console.log(`AutoUpload: Skipping ${filename} - perceptual hash match on server`);
      if (staged && staged.tmpCopied && staged.tmpUri) {
        try { await FileSystem.deleteAsync(staged.tmpUri, { idempotent: true }); } catch (e) {}
      }
      return { uploaded: 0, skipped: 1, failed: 0, manifestId };
    }
    // Also compute exact hash for manifest storage and byte-identical dedup (AirDrop)
    try {
      logStep('STEP4b', 'Computing exact file hash');
      exactFileHash = await computeExactFileHash(filePath);
      logStep('STEP4b', `Exact hash: ${exactFileHash ? 'computed' : 'null'}`);
    } catch (e) {
      logStep('STEP4b', `FAILED: ${e?.message}`);
    }
    // Skip if exact file hash already exists on server (byte-identical, e.g. AirDrop)
    if (exactFileHash && alreadyFileHashes && alreadyFileHashes.has(exactFileHash)) {
      console.log(`AutoUpload: Skipping ${filename} - exact file hash match on server`);
      if (staged && staged.tmpCopied && staged.tmpUri) {
        try { await FileSystem.deleteAsync(staged.tmpUri, { idempotent: true }); } catch (e) {}
      }
      return { uploaded: 0, skipped: 1, failed: 0, manifestId };
    }
  } else {
    // Videos: compute exact file hash
    try {
      logStep('STEP4c', 'Computing exact file hash for video');
      exactFileHash = await computeExactFileHash(filePath);
      logStep('STEP4c', `Exact hash: ${exactFileHash ? 'computed' : 'null'}`);
    } catch (e) {
      logStep('STEP4c', `FAILED: ${e?.message}`);
      console.warn('Background: computeExactFileHash failed:', asset.id, e?.message);
    }
    // Skip if exact file hash already exists on server
    if (exactFileHash && alreadyFileHashes && alreadyFileHashes.has(exactFileHash)) {
      console.log(`AutoUpload: Skipping ${filename} - exact file hash match on server`);
      if (staged && staged.tmpCopied && staged.tmpUri) {
        try { await FileSystem.deleteAsync(staged.tmpUri, { idempotent: true }); } catch (e) {}
      }
      return { uploaded: 0, skipped: 1, failed: 0, manifestId };
    }
  }

  const fileKey = new Uint8Array(32);
  global.crypto.getRandomValues(fileKey);
  const baseNonce16 = new Uint8Array(16);
  global.crypto.getRandomValues(baseNonce16);
  const wrapNonce = new Uint8Array(24);
  global.crypto.getRandomValues(wrapNonce);
  const wrappedKey = nacl.secretbox(fileKey, wrapNonce, masterKey);

  // Convert filePath to file:// URI for FileSystem operations
  const fileUri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
  if (!fileUri) return { uploaded: 0, skipped: 0, failed: 1 };

  logStep('STEP5', `Starting chunked upload, size=${originalSize}, chunks=${Math.ceil(originalSize / 512000)}`);

  let chunkIndex = 0;
  const chunkIds = [];
  const chunkSizes = [];
  // Use dynamic chunk size based on fast mode
  const chunkPlainBytes = chooseStealthCloudChunkBytes({ platform: Platform.OS, originalSize: null, fastMode });
  const effectiveBytes = chunkPlainBytes - (chunkPlainBytes % 3);
  let position = 0;

  // CPU management: add delay between chunks to reduce CPU pressure and phone heating
  // Fast mode: no delay for maximum speed
  // Progressive yields: even fast mode needs small yields to prevent ANR/crash on weak phones
  // Large files (videos) get bigger cooldowns to prevent overheating
  const isLargeFile = originalSize > 10 * 1024 * 1024; // >10MB = large file (video)
  // Increase cooldowns for memory stability on weak phones
  const baseCooldown = fastMode ? 50 : (Platform.OS === 'ios' ? 600 : 500);
  const CPU_COOLDOWN_MS = isLargeFile ? baseCooldown * 2 : baseCooldown;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  
  // Memory pressure relief: hint GC periodically (every 5 chunks)
  const hintGC = () => {
    try {
      if (global.gc) global.gc();
    } catch (e) {}
  };
  
  // Quick yield to event loop - matches manual backup pattern to prevent crashes
  const quickYield = () => new Promise(r => setImmediate ? setImmediate(r) : setTimeout(r, 0));

  // Concurrency for fast mode: parallel chunk uploads
  const maxParallel = chooseStealthCloudMaxParallelChunkUploads({ platform: Platform.OS, originalSize: null, fastMode });
  const runChunkUpload = createConcurrencyLimiter(maxParallel);
  const inFlightUploads = [];

  while (true) {
    // Yield before file read (matches manual backup)
    await quickYield();
    
    let nextB64 = '';
    try {
      nextB64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64, position, length: effectiveBytes });
    } catch (e) { nextB64 = ''; }
    if (!nextB64) break;
    
    // Yield after file read, before decode (matches manual backup)
    await quickYield();
    
    // CPU cooldown before encryption (skip if fast mode)
    // Always yield to prevent ANR - progressive: larger files get more frequent yields
    const shouldYield = chunkIndex > 0 && (CPU_COOLDOWN_MS > 0 || chunkIndex % 5 === 0);
    if (shouldYield) await sleep(Math.max(CPU_COOLDOWN_MS, 10));
    
    // Memory relief: hint GC every 5 chunks to prevent memory buildup
    if (chunkIndex > 0 && chunkIndex % 5 === 0) hintGC();
    
    const plaintext = naclUtil.decodeBase64(nextB64);
    if (!plaintext || plaintext.length === 0) break;
    
    // Yield before encryption (CPU intensive - matches manual backup)
    await quickYield();
    
    const nonce = makeChunkNonce(baseNonce16, chunkIndex);
    const boxed = nacl.secretbox(plaintext, nonce, fileKey);
    
    // Yield after encryption, before hash (matches manual backup)
    await quickYield();
    
    const chunkId = sha256.create().update(boxed).hex();
    
    // Yield after hash, before upload (matches manual backup)
    await quickYield();
    
    if (onStatus) onStatus('uploading');
    
    // Use concurrent upload via limiter
    console.log(`AutoUpload: Uploading chunk ${chunkIndex + 1}, size=${plaintext.length} bytes, position=${position}`);
    const uploadPromise = runChunkUpload(() => uploadEncryptedChunk({ SERVER_URL, config, chunkId, encryptedBytes: boxed }));
    inFlightUploads.push(uploadPromise);
    
    chunkIds.push(chunkId);
    chunkSizes.push(plaintext.length);
    chunkIndex += 1;
    position += plaintext.length;
    if (plaintext.length < effectiveBytes) break;
  }

  // Wait for all in-flight uploads to complete
  logStep('STEP5', `Waiting for ${inFlightUploads.length} in-flight uploads`);
  try {
    await Promise.all(inFlightUploads);
    logStep('STEP5', `All chunks uploaded: ${chunkIds.length} chunks`);
  } catch (e) {
    logStep('STEP5', `CHUNK UPLOAD FAILED: ${e?.message}`);
    return { uploaded: 0, skipped: 0, failed: 1 };
  }

  if (!chunkIds.length) {
    logStep('STEP5', 'FAILED: No chunks uploaded');
    return { uploaded: 0, skipped: 0, failed: 1 };
  }

  logStep('STEP6', 'Extracting EXIF data');
  // Extract EXIF data for all images to store in manifest for cross-platform deduplication
  let exifCaptureTime = null, exifMake = null, exifModel = null;
  if (isImage) {
    try {
      // On iOS, assetInfo.exif is populated; on Android, we need native module
      if (Platform.OS === 'ios') {
        const { extractExifForDedup } = require('./duplicateScanner');
        const exifData = extractExifForDedup(assetInfo, asset);
        if (exifData) {
          exifCaptureTime = exifData.captureTime || null;
          exifMake = exifData.make || null;
          exifModel = exifData.model || null;
        }
      } else {
        // Android: use native ExifExtractor module
        const { NativeModules } = require('react-native');
        const ExifExtractor = NativeModules.ExifExtractor;
        if (ExifExtractor && typeof ExifExtractor.extractExif === 'function') {
          const result = await ExifExtractor.extractExif(filePath);
          if (result) {
            exifCaptureTime = result.captureTime || null;
            exifMake = result.make ? result.make.trim().toLowerCase() : null;
            exifModel = result.model ? result.model.trim().toLowerCase() : null;
          }
        }
      }
    } catch (e) {
      logStep('STEP6', `EXIF extraction failed (non-critical): ${e?.message}`);
      console.warn('AutoUpload: EXIF extraction failed (non-critical):', filename, e?.message);
    }
  }
  logStep('STEP6', `EXIF done: captureTime=${exifCaptureTime}, make=${exifMake}, model=${exifModel}`);

  logStep('STEP7', 'Generating thumbnail');
  // Generate and upload encrypted thumbnail for Sync Select previews (best-effort, matches manual backup)
  let thumbChunkId = null;
  let thumbNonceB64 = null;
  let thumbSize = null;
  let thumbW = null;
  let thumbH = null;
  const thumbMime = 'image/jpeg';
  try {
    const THUMB_WIDTH = 220;
    const THUMB_COMPRESS = 0.6;
    const isVideo = (asset && asset.mediaType === 'video') || /\.(mp4|mov|avi|mkv|m4v|3gp|webm)$/i.test(filename || '');
    const isPhoto = !isVideo;
    let thumbSourceUri = null;
    let tempVideoFrameUri = null;

    if (isVideo) {
      const videoFileUri = filePath && filePath.startsWith('/') ? `file://${filePath}` : filePath;
      if (videoFileUri) {
        for (const time of [0, 500, 1000, 2000]) {
          try {
            const frame = await VideoThumbnails.getThumbnailAsync(videoFileUri, { time });
            if (frame?.uri) {
              thumbSourceUri = frame.uri;
              tempVideoFrameUri = frame.uri;
              break;
            }
          } catch (e) {
            // Try another timestamp
          }
        }
      }
    } else if (isPhoto) {
      thumbSourceUri = filePath && filePath.startsWith('/') ? `file://${filePath}` : filePath;
    }

    if (thumbSourceUri) {
      const manip = await ImageManipulator.manipulateAsync(
        thumbSourceUri,
        [{ resize: { width: THUMB_WIDTH } }],
        { compress: THUMB_COMPRESS, format: ImageManipulator.SaveFormat.JPEG }
      );
      if (manip?.uri) {
        thumbW = typeof manip.width === 'number' ? manip.width : null;
        thumbH = typeof manip.height === 'number' ? manip.height : null;

        const b64 = await FileSystem.readAsStringAsync(manip.uri, { encoding: FileSystem.EncodingType.Base64 });
        const plain = naclUtil.decodeBase64(b64);
        thumbSize = plain?.length || null;
        if (plain && plain.length > 0) {
          const thumbNonce = new Uint8Array(24);
          global.crypto.getRandomValues(thumbNonce);
          const boxed = nacl.secretbox(plain, thumbNonce, masterKey);
          thumbChunkId = sha256.create().update(boxed).hex();
          thumbNonceB64 = naclUtil.encodeBase64(thumbNonce);
          await uploadEncryptedChunk({ SERVER_URL, config, chunkId: thumbChunkId, encryptedBytes: boxed });
          console.log(`AutoUpload: uploaded thumbnail for ${filename}, size=${thumbSize}`);
        }

        try { await FileSystem.deleteAsync(manip.uri, { idempotent: true }); } catch (e) {}
      }
    }

    if (tempVideoFrameUri) {
      try { await FileSystem.deleteAsync(tempVideoFrameUri, { idempotent: true }); } catch (e) {}
    }
  } catch (e) {
    // Best-effort: thumbnail failures must not fail backup
    logStep('STEP7', `Thumbnail FAILED (non-fatal): ${e?.message}`);
    console.warn('AutoUpload: thumbnail generation failed (non-fatal):', filename, e?.message);
  }
  logStep('STEP7', `Thumbnail done: ${thumbChunkId ? 'uploaded' : 'skipped'}, ${thumbW}x${thumbH}`);

  logStep('STEP8', 'Building and uploading manifest');
  const manifest = {
    v: 1, assetId: asset.id, filename: assetInfo.filename || asset.filename || null,
    mediaType: asset.mediaType || null, originalSize: originalSize,
    creationTime: asset.creationTime || null,
    baseNonce16: naclUtil.encodeBase64(baseNonce16), wrapNonce: naclUtil.encodeBase64(wrapNonce),
    wrappedFileKey: naclUtil.encodeBase64(wrappedKey), chunkIds, chunkSizes,
    fileHash: exactFileHash, perceptualHash: perceptualHash,
    exifCaptureTime, exifMake, exifModel,
    thumbChunkId, thumbNonce: thumbNonceB64, thumbSize, thumbW, thumbH, thumbMime
  };
  const manifestPlain = naclUtil.decodeUTF8(JSON.stringify(manifest));
  const manifestNonce = new Uint8Array(24);
  global.crypto.getRandomValues(manifestNonce);
  const manifestBox = nacl.secretbox(manifestPlain, manifestNonce, masterKey);
  const encryptedManifest = JSON.stringify({ manifestNonce: naclUtil.encodeBase64(manifestNonce), manifestBox: naclUtil.encodeBase64(manifestBox) });

  try {
    // Retry manifest upload up to 11 times with exponential backoff
    await withRetries(async () => {
      await axios.post(`${SERVER_URL}/api/cloud/manifests`, { 
        manifestId, 
        encryptedManifest, 
        chunkCount: chunkIds.length,
        // Include metadata for fast dedup (matches manual backup)
        filename,
        mediaType: asset?.mediaType || null,
        originalSize,
        fileHash: exactFileHash,
        perceptualHash,
        creationTime: asset.creationTime,
        // EXIF metadata for cross-platform HEIC deduplication
        exifCaptureTime,
        exifMake,
        exifModel,
        thumbChunkId,
        thumbNonce: thumbNonceB64,
        thumbSize,
        thumbW,
        thumbH,
        thumbMime
      }, { headers: config.headers, timeout: 30000 });
    }, { retries: 10, baseDelayMs: 1000, maxDelayMs: 30000, shouldRetry: shouldRetryChunkUpload });
  } catch (e) {
    logStep('STEP8', `Manifest upload FAILED: ${e?.message}`);
    console.warn('Background: manifest upload failed after retries:', manifestId, e?.message);
    return { uploaded: 0, skipped: 0, failed: 1 };
  }
  logStep('STEP8', 'Manifest uploaded successfully');

  logStep('STEP9', 'Storing full EXIF (fire-and-forget)');
  // Store full EXIF to server for universal cross-platform preservation (matches manual backup)
  // Fire-and-forget, non-blocking - store full EXIF to server
  const isImageForExif = asset.mediaType === 'photo' || /\.(jpg|jpeg|png|heic|heif|gif|bmp|webp|tiff?)$/i.test(filename || '');
  if (exactFileHash && isImageForExif) {
    try {
      let fullExif = null;
      if (Platform.OS === 'ios') {
        const { extractFullExif } = require('./exifExtractor');
        fullExif = extractFullExif(assetInfo, asset);
      } else {
        // Android: use native ExifExtractor for full EXIF
        const { NativeModules } = require('react-native');
        const ExifExtractor = NativeModules.ExifExtractor;
        if (ExifExtractor && typeof ExifExtractor.extractExif === 'function') {
          const nativeExif = await ExifExtractor.extractExif(filePath);
          if (nativeExif) {
            fullExif = {
              captureTime: nativeExif.captureTime || null,
              make: nativeExif.make || null,
              model: nativeExif.model || null,
              offsetTimeOriginal: nativeExif.offsetTimeOriginal || null,
              subSecTimeOriginal: nativeExif.subSecTimeOriginal || null,
              exposureTime: nativeExif.exposureTime || null,
              fNumber: nativeExif.fNumber || null,
              iso: nativeExif.iso || null,
              focalLength: nativeExif.focalLength || null,
              focalLengthIn35mm: nativeExif.focalLengthIn35mm || null,
              flash: nativeExif.flash || null,
              whiteBalance: nativeExif.whiteBalance || null,
              meteringMode: nativeExif.meteringMode || null,
              exposureProgram: nativeExif.exposureProgram || null,
              exposureBias: nativeExif.exposureBias || null,
              width: nativeExif.width || null,
              height: nativeExif.height || null,
              orientation: nativeExif.orientation || null,
              colorSpace: nativeExif.colorSpace || null,
              gpsLatitude: nativeExif.gpsLatitude || asset.location?.latitude || null,
              gpsLongitude: nativeExif.gpsLongitude || asset.location?.longitude || null,
              gpsAltitude: nativeExif.gpsAltitude || null,
              gpsDateStamp: nativeExif.gpsDateStamp || null,
              gpsTimestamp: nativeExif.gpsTimestamp || null,
              software: nativeExif.software || null,
              lensMake: nativeExif.lensMake || null,
              lensModel: nativeExif.lensModel || null,
            };
          }
        }
      }
      if (fullExif && (fullExif.captureTime || fullExif.make || fullExif.gpsLatitude != null)) {
        axios.post(
          `${SERVER_URL}/api/exif/store`,
          { fileHash: exactFileHash, exif: fullExif, platform: Platform.OS },
          { headers: config.headers, timeout: 10000 }
        ).catch(e => console.log('[AutoUpload EXIF] Store failed (non-critical):', e?.message));
      }
    } catch (e) {
      // Non-critical - don't fail upload if EXIF storage fails
    }
  }

  // Cleanup temp file
  if (staged && staged.tmpCopied && staged.tmpUri) {
    try { await FileSystem.deleteAsync(staged.tmpUri, { idempotent: true }); } catch (e) {}
  }

  logStep('COMPLETE', `Successfully uploaded ${filename}`);
  return { uploaded: 1, skipped: 0, failed: 0, manifestId, perceptualHash, fileHash: exactFileHash, filename };
};

// Concurrency helpers
export const chooseStealthCloudChunkBytes = ({ platform, originalSize, fastMode = false }) => {
  // Fast mode: use larger chunks for maximum speed (phone may get warm)
  if (fastMode) {
    const size = typeof originalSize === 'number' ? originalSize : null;
    if (size !== null && size >= 1024 * MB) return 1 * MB; // Large files: 1MB
    return 512 * 1024; // Normal files: 512KB
  }
  // Default: moderate chunks - cooldowns between files give UI time to breathe
  // 512KB encrypts in ~80-150ms but cooldowns compensate
  return 512 * 1024; // 512KB - balanced speed and responsiveness with cooldowns
};

export const chooseStealthCloudMaxParallelChunkUploads = ({ platform, originalSize, fastMode = false }) => {
  // Fast mode: moderate concurrency for speed
  if (fastMode) {
    return platform === 'android' ? 6 : 5;
  }
  // Slow mode: conservative to prevent phone heating
  return platform === 'android' ? 3 : 2;
};

export const createConcurrencyLimiter = (maxParallel) => {
  const max = Math.max(1, Number(maxParallel) || 1);
  const queue = [];
  let active = 0;
  const pump = () => {
    while (active < max && queue.length) {
      const next = queue.shift();
      if (!next) break;
      active += 1;
      Promise.resolve().then(next.fn).then(next.resolve, next.reject).finally(() => { active -= 1; pump(); });
    }
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); });
};

export const trackInFlightPromise = async (inFlight, p, maxInFlight) => {
  inFlight.add(p);
  const cleanup = () => { try { inFlight.delete(p); } catch (e) {} };
  p.then(cleanup, cleanup);
  if (inFlight.size >= maxInFlight) await Promise.race(inFlight);
};

export const drainInFlightPromises = async (inFlight) => {
  if (!inFlight || inFlight.size === 0) return;
  await Promise.all(Array.from(inFlight));
};

// Register background task
export const registerBackgroundTask = () => {
  TaskManager.defineTask(AUTO_UPLOAD_BACKGROUND_TASK, async () => {
    try {
      console.log('Background task called');
      const enabled = await SecureStore.getItemAsync('auto_upload_enabled');
      if (enabled !== 'true') return BackgroundFetch.BackgroundFetchResult.NoData;

      const serverType = await SecureStore.getItemAsync('server_type');
      console.log('Server type:', serverType);
      if (serverType !== 'stealthcloud') return BackgroundFetch.BackgroundFetchResult.NoData;

      const perm = await MediaLibrary.getPermissionsAsync();
      console.log('Perm:', perm);
      if (!perm || perm.status !== 'granted') return BackgroundFetch.BackgroundFetchResult.NoData;

      const el = await autoUploadEligibilityForBackground();
      console.log('Eligibility:', el);
      if (!el.ok) return BackgroundFetch.BackgroundFetchResult.NoData;

      const config = await autoUploadGetAuthHeadersFromSecureStore();
      console.log('Config:', config ? 'ok' : 'null');
      if (!config) return BackgroundFetch.BackgroundFetchResult.NoData;

      console.log('Policy ok, starting background upload');

      const SERVER_URL = 'https://stealthlynk.io';

      const startedAt = Date.now();
      const timeBudgetMs = Platform.OS === 'ios' ? 25000 : 4 * 60 * 1000;
      const maxUploadsPerRun = Platform.OS === 'ios' ? 8 : 1000000;
      const pageSize = Platform.OS === 'ios' ? 60 : 120;

      let existingManifests = [];
      try {
        const listRes = await axios.get(`${SERVER_URL}/api/cloud/manifests`, config);
        existingManifests = (listRes.data && listRes.data.manifests) ? listRes.data.manifests : [];
      } catch (e) {
        existingManifests = [];
      }
      console.log('Existing manifests:', existingManifests.length);
      const already = new Set(existingManifests.map(m => m.manifestId));

      let after = null;
      try {
        const savedCursor = await SecureStore.getItemAsync(AUTO_UPLOAD_CURSOR_KEY);
        after = savedCursor ? savedCursor : null;
      } catch (e) {
        after = null;
      }
      let uploaded = 0;
      let skipped = 0;
      let failed = 0;
      console.log('Starting upload loop');
      while (true) {
        if (uploaded >= maxUploadsPerRun) break;
        if (Date.now() - startedAt >= timeBudgetMs) break;

        const page = await MediaLibrary.getAssetsAsync({
          mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
          first: pageSize,
          after: after || undefined,
          sortBy: [MediaLibrary.SortBy.creationTime]
        });
        const assets = page && Array.isArray(page.assets) ? page.assets : [];
        if (!assets.length) break;

        for (const asset of assets) {
          if (uploaded >= maxUploadsPerRun) break;
          if (Date.now() - startedAt >= timeBudgetMs) break;
          if (!asset || !asset.id) continue;
          const manifestId = sha256(`asset:${asset.id}`);
          if (already.has(manifestId)) {
            skipped += 1;
            continue;
          }
          const r = await autoUploadStealthCloudUploadOneAsset({ asset, config, SERVER_URL, existingManifestIds: already });
          if (r && r.uploaded) {
            uploaded += 1;
            already.add(manifestId);
          } else if (r && r.skipped) {
            skipped += 1;
            already.add(manifestId);
          } else {
            failed += 1;
          }
        }

        after = page && page.endCursor ? page.endCursor : null;
        try {
          if (after) await SecureStore.setItemAsync(AUTO_UPLOAD_CURSOR_KEY, after);
        } catch (e) {}
        if (!page || page.hasNextPage !== true || !after) break;
      }

      try {
        if (!after) await SecureStore.deleteItemAsync(AUTO_UPLOAD_CURSOR_KEY);
      } catch (e) {}

      try {
        await SecureStore.setItemAsync('auto_upload_last_run', new Date().toISOString());
        await SecureStore.setItemAsync('auto_upload_last_summary', JSON.stringify({ uploaded, skipped, failed }));
      } catch (e) {}

      if (uploaded > 0) return BackgroundFetch.BackgroundFetchResult.NewData;
      return BackgroundFetch.BackgroundFetchResult.NoData;
    } catch (e) {
      try {
        await SecureStore.setItemAsync('auto_upload_last_run', new Date().toISOString());
        await SecureStore.setItemAsync('auto_upload_last_summary', JSON.stringify({ error: (e && e.message) ? e.message : 'failed' }));
      } catch (err) {}
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
};

// Call this at module load to register the task
registerBackgroundTask();
