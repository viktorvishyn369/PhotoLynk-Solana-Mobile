/**
 * uploadOperations.js
 * 
 * Handles upload operations for local/remote servers (non-StealthCloud).
 * Extracted from App.js to keep codebase modular.
 */

import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { normalizeFilenameForCompare, getMimeFromFilename } from './utils';
import { createConcurrencyLimiter } from './backgroundTask';
import { buildLocalAssetIdSetPaged, fetchAllServerFilesPaged } from './mediaHelpers';
import { PHOTO_ALBUM_NAME, LEGACY_PHOTO_ALBUM_NAME } from './backupManager';
import { findFirstAlbumByTitle } from './autoUpload';
import { computePerceptualHash, computeExactFileHash, findPerceptualHashMatch } from './duplicateScanner';
import { extractFullExif } from './exifExtractor';
import axios from 'axios';

// dHash threshold for backup dedup (6 bits = ~9% tolerance for cross-platform differences)
const BACKUP_DHASH_THRESHOLD = 6;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Core backup logic for local/remote servers (non-StealthCloud).
 * Uploads photos to a configured server endpoint.
 * 
 * @param {Object} params - Parameters
 * @param {Function} params.getAuthHeaders - Function to get auth headers
 * @param {Function} params.getServerUrl - Function to get server URL
 * @param {Function} params.resolveReadableFilePath - Function to resolve file paths
 * @param {Function} params.ensureAutoUploadPolicyAllowsWorkIfBackgrounded - Policy check function
 * @param {boolean} params.fastMode - Whether fast mode is enabled
 * @param {Function} params.onStatus - Status update callback
 * @param {Function} params.onProgress - Progress update callback
 * @returns {Promise<Object>} Result with uploaded, skipped, failed counts
 */
// Throttle helpers for progress updates
let lastProgressValue = 0;
let lastProgressTime = 0;
let lastStatusTime = 0;
const PROGRESS_THROTTLE_MS = 100;

const resetProgressTracking = () => {
  lastProgressValue = 0;
  lastProgressTime = 0;
  lastStatusTime = 0;
};

const throttledProgress = (onProgress, value) => {
  const now = Date.now();
  if (value > lastProgressValue && (now - lastProgressTime) >= PROGRESS_THROTTLE_MS) {
    lastProgressValue = value;
    lastProgressTime = now;
    onProgress(value);
  }
};

const throttledStatus = (onStatus, msg) => {
  const now = Date.now();
  if ((now - lastStatusTime) >= PROGRESS_THROTTLE_MS) {
    lastStatusTime = now;
    onStatus(msg);
  }
};

export const localRemoteBackupCore = async ({
  getAuthHeaders,
  getServerUrl,
  resolveReadableFilePath,
  ensureAutoUploadPolicyAllowsWorkIfBackgrounded,
  appStateRef,
  fastMode,
  onStatus,
  onProgress,
}) => {
  resetProgressTracking();
  onStatus('Preparing backup...');
  onProgress(0);

  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission || permission.status !== 'granted') {
    return { permissionDenied: true };
  }

  if (Platform.OS === 'ios' && permission.accessPrivileges && permission.accessPrivileges !== 'all') {
    return { limitedAccess: true };
  }

  try {
    console.log('\n🔍 ===== BACKUP TRACE START =====');

    // 1. Get Server List with hash metadata (for cross-device dedup)
    const config = await getAuthHeaders();
    const SERVER_URL = getServerUrl();
    console.log('Using server URL for backup:', SERVER_URL);
    onStatus('Fetching server files...');
    onProgress(0.01);
    
    // Fetch with meta=true to get hash metadata for cross-device dedup
    const allServerFiles = await fetchAllServerFilesPaged(SERVER_URL, config, (fetched, total) => {
      // Progress fills 1-5% during fetch
      const fetchProgress = total > 0 ? (fetched / total) * 0.04 : 0;
      throttledProgress(onProgress, 0.01 + fetchProgress);
      throttledStatus(onStatus, `Fetching ${fetched}${total > fetched ? ` of ${total}` : ''} server files...`);
    }, true); // includeMeta=true
    
    onProgress(0.05);

    console.log(`\n☁️  Server response: ${allServerFiles.length} files`);

    // Build dedup sets from server files
    const serverFiles = new Set();
    const serverFileHashes = new Set();
    const serverPerceptualHashes = new Set();
    // Platform-specific hashes for double-confirm dedup
    const platformFileHashes = { ios: new Set(), android: new Set() };
    const platformPerceptualHashes = { ios: new Set(), android: new Set() };
    
    for (const f of allServerFiles) {
      const normalized = normalizeFilenameForCompare(f && f.filename ? f.filename : null);
      if (normalized) serverFiles.add(normalized);
      if (f.fileHash) serverFileHashes.add(f.fileHash);
      if (f.perceptualHash) serverPerceptualHashes.add(f.perceptualHash);
      // Collect platform-specific hashes
      if (f.platformHashes) {
        for (const plat of ['ios', 'android']) {
          const ph = f.platformHashes[plat];
          if (ph?.fileHash) platformFileHashes[plat].add(ph.fileHash);
          if (ph?.perceptualHash) platformPerceptualHashes[plat].add(ph.perceptualHash);
        }
      }
    }

    const platformPhashCount = platformPerceptualHashes.ios.size + platformPerceptualHashes.android.size;
    const platformFhashCount = platformFileHashes.ios.size + platformFileHashes.android.size;
    console.log(`📊 Server files: ${serverFiles.size} filenames, ${serverFileHashes.size} fileHashes, ${serverPerceptualHashes.size} perceptualHashes, ${platformPhashCount} platformPhashes, ${platformFhashCount} platformFhashes`);

    // 2. Exclude files already in app album to prevent re-uploading restored files
    const albums = await MediaLibrary.getAlbumsAsync();
    console.log(`📂 All albums: ${albums.map(a => `${a.title} (${a.assetCount})`).join(', ')}`);

    const photoSyncAlbum = findFirstAlbumByTitle(albums, [PHOTO_ALBUM_NAME, LEGACY_PHOTO_ALBUM_NAME]);
    let excludedIds = new Set();

    if (photoSyncAlbum) {
      excludedIds = await buildLocalAssetIdSetPaged({ album: photoSyncAlbum });
      console.log(`📂 Album "${photoSyncAlbum.title}" has ${excludedIds.size} files (will exclude)`);
    }

    // 3. Scan local assets (paged) and decide which are missing on the server
    let after = null;
    let totalCount = null;
    let checkedCount = 0;
    const toUpload = [];
    const duplicateFilenames = {};

    while (true) {
      const page = await MediaLibrary.getAssetsAsync({
        first: 500,
        after: after || undefined,
        mediaType: ['photo', 'video'],
      });

      if (totalCount === null && page && typeof page.totalCount === 'number') {
        totalCount = page.totalCount;
      }

      const pageAssets = page && Array.isArray(page.assets) ? page.assets : [];
      if (pageAssets.length === 0) {
        if (checkedCount === 0) {
          return { noFiles: true };
        }
        break;
      }

      for (const asset of pageAssets) {
        if (excludedIds.has(asset.id)) continue;
        checkedCount += 1;
        // Analyzing phase: 5-20% progress
        throttledStatus(onStatus, `Analyzing ${checkedCount} of ${totalCount || '?'}`);
        if (totalCount) {
          const analyzeProgress = 0.05 + (checkedCount / totalCount) * 0.15;
          throttledProgress(onProgress, analyzeProgress);
        }

        let actualFilename = normalizeFilenameForCompare(asset && asset.filename ? asset.filename : null);
        if (Platform.OS === 'ios' || !actualFilename) {
          try {
            const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
            actualFilename = normalizeFilenameForCompare(assetInfo && assetInfo.filename ? assetInfo.filename : null) || actualFilename;
          } catch (e) {
            actualFilename = actualFilename;
          }
        }

        if (!actualFilename) continue;

        if (duplicateFilenames[actualFilename]) {
          duplicateFilenames[actualFilename]++;
        } else {
          duplicateFilenames[actualFilename] = 1;
        }

        const exists = serverFiles.has(actualFilename);
        if (!exists) {
          toUpload.push(asset);
        }
      }

      after = page && page.endCursor ? page.endCursor : null;
      if (!page || page.hasNextPage !== true) break;
    }

    console.log(`📊 Assets to backup (after excluding album): ${checkedCount}`);

    if (checkedCount === 0) {
      return { noFilesToBackup: true };
    }

    // Log device duplicates
    const deviceDuplicates = Object.entries(duplicateFilenames).filter(([_, count]) => count > 1);
    if (deviceDuplicates.length > 0) {
      console.log(`\n📱 Device has ${deviceDuplicates.length} duplicate filenames:`);
      deviceDuplicates.forEach(([filename, count]) => {
        console.log(`  - ${filename}: ${count} copies`);
      });
    }

    console.log(`Local: ${checkedCount}, Server: ${serverFiles.size}, To upload: ${toUpload.length}`);

    if (toUpload.length === 0) {
      return { alreadyBackedUp: true, checkedCount };
    }

    // Brief pause before starting uploads
    await sleep(500);

    // 4. Upload Loop with per-file error handling (parallel)
    // Session hash tracking for cross-device dedup (same content, different filename)
    const sessionPerceptualHashes = new Set();
    const sessionFileHashes = new Set();
    let hashDedupCount = 0;
    
    let successCount = 0;
    let duplicateCount = 0;
    let failedCount = 0;
    const failedFiles = [];
    let processedCount = 0;

    // Concurrency: Fast Mode Android=10 / iOS=8; Slow Mode Android=5 / iOS=4
    const maxParallelUploads = fastMode
      ? (Platform.OS === 'android' ? 10 : 8)
      : (Platform.OS === 'android' ? 5 : 4);
    const runUpload = createConcurrencyLimiter(maxParallelUploads);

    const uploadTasks = toUpload.map((asset, idx) => runUpload(async () => {
      try {
        // Wait if app is backgrounded (pause instead of failing)
        if (appStateRef) {
          while (appStateRef.current !== 'active') {
            await sleep(1000);
          }
        }
        // Only check background policy if function is provided (auto-upload only)
        if (ensureAutoUploadPolicyAllowsWorkIfBackgrounded && !(await ensureAutoUploadPolicyAllowsWorkIfBackgrounded())) return;

        // Get file info
        const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
        const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo });
        const filePath = resolved && resolved.filePath ? resolved.filePath : null;

        if (!filePath) {
          console.warn(`Skipping ${asset.filename}: no URI`);
          failedCount++;
          failedFiles.push(asset.filename);
          return;
        }

        // iOS fix: Use the actual filename from assetInfo, not the UUID
        const actualFilename = assetInfo.filename || asset.filename;
        const isVideo = /\.(mov|mp4|m4v|avi|mkv|webm|3gp)$/i.test(actualFilename);

        // Compute hash for cross-device dedup (same content, different filename)
        let skipByHash = false;
        let skipReason = null;
        try {
          if (isVideo) {
            const fileHash = await computeExactFileHash(filePath);
            if (fileHash) {
              // Check against server hashes first (cross-device dedup)
              if (serverFileHashes.has(fileHash)) {
                skipByHash = true;
                skipReason = 'server fileHash';
              } else if (sessionFileHashes.has(fileHash)) {
                skipByHash = true;
                skipReason = 'session fileHash';
              } else {
                // FALLBACK: Check ALL platform hashes (double-confirm before upload)
                for (const plat of ['ios', 'android']) {
                  if (platformFileHashes[plat].has(fileHash)) {
                    skipByHash = true;
                    skipReason = `platform_${plat} fileHash`;
                    break;
                  }
                }
                if (!skipByHash) sessionFileHashes.add(fileHash);
              }
            }
          } else {
            const phash = await computePerceptualHash(filePath);
            if (phash) {
              // Check against server hashes first (cross-device dedup)
              if (findPerceptualHashMatch(phash, serverPerceptualHashes, BACKUP_DHASH_THRESHOLD)) {
                skipByHash = true;
                skipReason = 'server perceptualHash';
              } else if (findPerceptualHashMatch(phash, sessionPerceptualHashes, BACKUP_DHASH_THRESHOLD)) {
                skipByHash = true;
                skipReason = 'session perceptualHash';
              } else {
                // FALLBACK: Check ALL platform hashes (double-confirm before upload)
                for (const plat of ['ios', 'android']) {
                  if (findPerceptualHashMatch(phash, platformPerceptualHashes[plat], BACKUP_DHASH_THRESHOLD)) {
                    skipByHash = true;
                    skipReason = `platform_${plat} perceptualHash`;
                    break;
                  }
                }
                if (!skipByHash) sessionPerceptualHashes.add(phash);
              }
            }
          }
        } catch (hashErr) {
          console.warn(`Hash computation failed for ${actualFilename}:`, hashErr.message);
          // Continue with upload if hash fails
        }

        if (skipByHash) {
          console.log(`⊘ Skipped (${skipReason}): ${actualFilename}`);
          hashDedupCount++;
          return;
        }

        const mime = getMimeFromFilename(actualFilename, asset.mediaType);
        const fileUri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;

        // Mobile: use FOREGROUND uploads
        const sessionTypeUpload = FileSystem.FileSystemSessionType.FOREGROUND;
        const uploadRes = await FileSystem.uploadAsync(`${SERVER_URL}/api/upload/raw`, fileUri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          sessionType: sessionTypeUpload,
          headers: {
            ...config.headers,
            'Content-Type': mime,
            'X-Filename': actualFilename,
          }
        });

        if (!uploadRes || uploadRes.status < 200 || uploadRes.status >= 300) {
          console.error(`✗ Upload failed for ${actualFilename}: HTTP ${uploadRes?.status || 'unknown'} - ${uploadRes?.body || 'no response'}`);
          failedCount++;
          failedFiles.push(actualFilename);
          return;
        }

        let parsed = null;
        try {
          parsed = uploadRes && uploadRes.body ? JSON.parse(uploadRes.body) : null;
        } catch (e) { parsed = null; }

        if (parsed && parsed.duplicate) {
          duplicateCount++;
          console.log(`⊘ Skipped (duplicate): ${actualFilename}`);
        } else {
          successCount++;
          console.log(`✓ Uploaded: ${actualFilename}`);
          
          // Store full EXIF to server for universal cross-platform preservation
          // Non-blocking, fire-and-forget
          const isImage = asset.mediaType === 'photo' || /\.(jpg|jpeg|png|heic|heif|gif|bmp|webp|tiff?)$/i.test(actualFilename || '');
          if (isImage && parsed?.fileHash) {
            try {
              const fullExif = extractFullExif(assetInfo, asset);
              if (fullExif.captureTime || fullExif.make || fullExif.gpsLatitude != null) {
                axios.post(
                  `${SERVER_URL}/api/exif/store`,
                  { fileHash: parsed.fileHash, exif: fullExif, platform: Platform.OS },
                  { headers: config.headers, timeout: 10000 }
                ).catch(e => console.log('[EXIF] Store failed (non-critical):', e?.message));
              }
            } catch (e) {
              // Non-critical
            }
          }
        }
      } catch (fileError) {
        // If connection failed and app was backgrounded, wait and retry once
        if (fileError.message?.includes('Failed to connect') && appStateRef?.current !== 'active') {
          console.log(`⏸ Upload paused (backgrounded): ${asset.filename}, waiting to retry...`);
          while (appStateRef?.current !== 'active') {
            await sleep(1000);
          }
          // Retry the upload once after coming back to foreground
          try {
            const retryRes = await FileSystem.uploadAsync(uploadUrl, fileUri, {
              uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
              sessionType: sessionTypeUpload,
              headers: {
                ...config.headers,
                'Content-Type': mime,
                'X-Filename': actualFilename,
              }
            });
            if (retryRes && retryRes.status >= 200 && retryRes.status < 300) {
              successCount++;
              console.log(`✓ Uploaded (retry): ${actualFilename}`);
            } else {
              failedCount++;
              failedFiles.push(asset.filename);
            }
          } catch (retryErr) {
            console.error(`✗ Retry failed for ${asset.filename}:`, retryErr.message);
            failedCount++;
            failedFiles.push(asset.filename);
          }
        } else {
          console.error(`✗ Failed to upload ${asset.filename}:`, fileError.message);
          failedCount++;
          failedFiles.push(asset.filename);
        }
      } finally {
        processedCount++;
        // Upload phase: 20-100% progress
        const uploadProgress = 0.2 + (processedCount / toUpload.length) * 0.8;
        throttledStatus(onStatus, `Backing up ${processedCount} of ${toUpload.length}`);
        throttledProgress(onProgress, uploadProgress);
      }
    }));

    await Promise.all(uploadTasks);

    // Show detailed completion status
    console.log('\n📊 ===== BACKUP SUMMARY =====');
    console.log(`Total on device: ${totalCount || checkedCount}`);
    console.log(`Album excluded: ${excludedIds.size}`);
    console.log(`To check: ${checkedCount}`);
    console.log(`On server before: ${serverFiles.size}`);
    console.log(`Marked for upload: ${toUpload.length}`);
    console.log(`Actually uploaded: ${successCount}`);
    console.log(`Duplicates skipped (filename): ${duplicateCount}`);
    console.log(`Duplicates skipped (hash): ${hashDedupCount}`);
    console.log(`Failed: ${failedCount}`);
    console.log('===== END BACKUP TRACE =====\n');

    const skippedCount = checkedCount - toUpload.length + duplicateCount + hashDedupCount;

    return {
      uploaded: successCount,
      skipped: skippedCount,
      failed: failedCount,
      checkedCount,
      totalCount: totalCount || checkedCount,
    };
  } catch (error) {
    console.error('Backup error:', error);
    throw error;
  }
};

/**
 * Core backup logic for selected assets to local/remote servers (non-StealthCloud).
 * 
 * @param {Object} params - Parameters
 * @param {Array} params.assets - Array of assets to backup
 * @param {Function} params.getAuthHeaders - Function to get auth headers
 * @param {Function} params.getServerUrl - Function to get server URL
 * @param {Function} params.resolveReadableFilePath - Function to resolve file paths
 * @param {Function} params.ensureAutoUploadPolicyAllowsWorkIfBackgrounded - Policy check function
 * @param {Function} params.onStatus - Status update callback
 * @param {Function} params.onProgress - Progress update callback
 * @returns {Promise<Object>} Result with uploaded, skipped, failed counts
 */
export const localRemoteBackupSelectedCore = async ({
  assets,
  getAuthHeaders,
  getServerUrl,
  resolveReadableFilePath,
  ensureAutoUploadPolicyAllowsWorkIfBackgrounded,
  appStateRef,
  onStatus,
  onProgress,
}) => {
  const list = Array.isArray(assets) ? assets.filter(a => a && a.id) : [];
  if (list.length === 0) {
    return { noSelection: true };
  }

  const permission = await MediaLibrary.requestPermissionsAsync();
  if (!permission || permission.status !== 'granted') {
    return { permissionDenied: true };
  }

  resetProgressTracking();
  onStatus?.('Preparing backup...');
  onProgress?.(0);

  try {
    const config = await getAuthHeaders();
    const SERVER_URL = getServerUrl();
    
    onStatus?.('Fetching server files...');
    onProgress?.(0.01);
    
    // Fetch with meta=true to get hash metadata for cross-device dedup
    const allServerFiles = await fetchAllServerFilesPaged(SERVER_URL, config, (fetched, total) => {
      // Progress fills 1-5% during fetch
      const fetchProgress = total > 0 ? (fetched / total) * 0.04 : 0;
      throttledProgress(onProgress, 0.01 + fetchProgress);
      throttledStatus(onStatus, `Fetching ${fetched}${total > fetched ? ` of ${total}` : ''} server files...`);
    }, true); // includeMeta=true
    
    onProgress?.(0.05);
    
    // Build dedup sets from server files
    const serverFiles = new Set();
    const serverFileHashes = new Set();
    const serverPerceptualHashes = new Set();
    // Platform-specific hashes for double-confirm dedup
    const platformFileHashes = { ios: new Set(), android: new Set() };
    const platformPerceptualHashes = { ios: new Set(), android: new Set() };
    
    for (const f of allServerFiles) {
      const normalized = normalizeFilenameForCompare(f && f.filename ? f.filename : null);
      if (normalized) serverFiles.add(normalized);
      if (f.fileHash) serverFileHashes.add(f.fileHash);
      if (f.perceptualHash) serverPerceptualHashes.add(f.perceptualHash);
      // Collect platform-specific hashes
      if (f.platformHashes) {
        for (const plat of ['ios', 'android']) {
          const ph = f.platformHashes[plat];
          if (ph?.fileHash) platformFileHashes[plat].add(ph.fileHash);
          if (ph?.perceptualHash) platformPerceptualHashes[plat].add(ph.perceptualHash);
        }
      }
    }

    const albums = await MediaLibrary.getAlbumsAsync();
    const photoSyncAlbum = findFirstAlbumByTitle(albums, [PHOTO_ALBUM_NAME, LEGACY_PHOTO_ALBUM_NAME]);
    let excludedIds = new Set();
    if (photoSyncAlbum) {
      excludedIds = await buildLocalAssetIdSetPaged({ album: photoSyncAlbum });
    }

    const toUpload = [];
    for (let i = 0; i < list.length; i++) {
      const asset = list[i];
      // Analyzing phase: 5-20% progress
      const analyzeProgress = 0.05 + ((i + 1) / list.length) * 0.15;
      throttledStatus(onStatus, `Analyzing ${i + 1} of ${list.length}`);
      throttledProgress(onProgress, analyzeProgress);
      if (excludedIds.has(asset.id)) continue;

      let actualFilename = normalizeFilenameForCompare(asset && asset.filename ? asset.filename : null);
      if (Platform.OS === 'ios' || !actualFilename) {
        try {
          const info = await MediaLibrary.getAssetInfoAsync(asset.id);
          actualFilename = normalizeFilenameForCompare(info && info.filename ? info.filename : null) || actualFilename;
        } catch (e) {
          actualFilename = actualFilename;
        }
      }

      if (!actualFilename) continue;
      if (serverFiles.has(actualFilename)) continue;
      toUpload.push(asset);
    }

    if (toUpload.length === 0) {
      return { alreadyBackedUp: true, total: list.length, skipped: list.length };
    }

    // Brief pause before starting uploads
    await sleep(500);

    // Session hash tracking for cross-device dedup
    const sessionPerceptualHashes = new Set();
    const sessionFileHashes = new Set();
    let hashDedupCount = 0;

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < toUpload.length; i++) {
      const asset = toUpload[i];
      try {
        // Wait if app is backgrounded (pause instead of failing)
        if (appStateRef) {
          while (appStateRef.current !== 'active') {
            await sleep(1000);
          }
        }
        // Only check background policy if function is provided (auto-upload only)
        if (ensureAutoUploadPolicyAllowsWorkIfBackgrounded && !(await ensureAutoUploadPolicyAllowsWorkIfBackgrounded())) {
          break;
        }
        // Upload phase: 20-100% progress
        const uploadProgress = 0.2 + ((i + 1) / toUpload.length) * 0.8;
        throttledStatus(onStatus, `Backing up ${i + 1} of ${toUpload.length}`);
        throttledProgress(onProgress, uploadProgress);

        const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
        const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo });
        const filePath = resolved && resolved.filePath ? resolved.filePath : null;
        if (!filePath) {
          failedCount++;
          continue;
        }

        const actualFilename = assetInfo.filename || asset.filename;
        const isVideo = /\.(mov|mp4|m4v|avi|mkv|webm|3gp)$/i.test(actualFilename);

        // Compute hash for cross-device dedup
        let skipByHash = false;
        try {
          if (isVideo) {
            const fileHash = await computeExactFileHash(filePath);
            if (fileHash) {
              // Check against server hashes first (cross-device dedup)
              if (serverFileHashes.has(fileHash)) {
                skipByHash = true;
              } else if (sessionFileHashes.has(fileHash)) {
                skipByHash = true;
              } else {
                // FALLBACK: Check ALL platform hashes (double-confirm before upload)
                for (const plat of ['ios', 'android']) {
                  if (platformFileHashes[plat].has(fileHash)) {
                    skipByHash = true;
                    break;
                  }
                }
                if (!skipByHash) sessionFileHashes.add(fileHash);
              }
            }
          } else {
            const phash = await computePerceptualHash(filePath);
            if (phash) {
              // Check against server hashes first (cross-device dedup)
              if (findPerceptualHashMatch(phash, serverPerceptualHashes, BACKUP_DHASH_THRESHOLD)) {
                skipByHash = true;
              } else if (findPerceptualHashMatch(phash, sessionPerceptualHashes, BACKUP_DHASH_THRESHOLD)) {
                skipByHash = true;
              } else {
                // FALLBACK: Check ALL platform hashes (double-confirm before upload)
                for (const plat of ['ios', 'android']) {
                  if (findPerceptualHashMatch(phash, platformPerceptualHashes[plat], BACKUP_DHASH_THRESHOLD)) {
                    skipByHash = true;
                    break;
                  }
                }
                if (!skipByHash) sessionPerceptualHashes.add(phash);
              }
            }
          }
        } catch (hashErr) {
          // Continue with upload if hash fails
        }

        if (skipByHash) {
          hashDedupCount++;
          continue;
        }

        const mime = getMimeFromFilename(actualFilename, asset.mediaType);
        const fileUri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;

        // iOS: use FOREGROUND for HTTP since background sessions require HTTPS
        const isHttps = SERVER_URL.startsWith('https://');
        const sessionType = (Platform.OS === 'ios' && !isHttps)
          ? FileSystem.FileSystemSessionType.FOREGROUND
          : FileSystem.FileSystemSessionType.BACKGROUND;
        const uploadRes = await FileSystem.uploadAsync(`${SERVER_URL}/api/upload/raw`, fileUri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          sessionType,
          headers: {
            ...config.headers,
            'Content-Type': mime,
            'X-Filename': actualFilename,
          }
        });

        // Check HTTP status - uploadAsync doesn't throw on 4xx/5xx errors
        if (!uploadRes || uploadRes.status < 200 || uploadRes.status >= 300) {
          console.error(`✗ Upload failed for ${actualFilename}: HTTP ${uploadRes?.status || 'unknown'} - ${uploadRes?.body || 'no response'}`);
          failedCount++;
          continue;
        }

        successCount++;
      } catch (e) {
        // If connection failed and app was backgrounded, wait and retry once
        if (e.message?.includes('Failed to connect') && appStateRef?.current !== 'active') {
          console.log(`⏸ Upload paused (backgrounded): ${actualFilename}, waiting to retry...`);
          while (appStateRef?.current !== 'active') {
            await sleep(1000);
          }
          try {
            const retryRes = await FileSystem.uploadAsync(`${SERVER_URL}/api/upload/raw`, fileUri, {
              httpMethod: 'POST',
              uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
              sessionType,
              headers: {
                ...config.headers,
                'Content-Type': mime,
                'X-Filename': actualFilename,
              }
            });
            if (retryRes && retryRes.status >= 200 && retryRes.status < 300) {
              successCount++;
              console.log(`✓ Uploaded (retry): ${actualFilename}`);
            } else {
              failedCount++;
            }
          } catch (retryErr) {
            failedCount++;
          }
        } else {
          failedCount++;
        }
      }
    }

    const skippedCount = list.length - toUpload.length + hashDedupCount;
    return { uploaded: successCount, skipped: skippedCount, failed: failedCount };
  } catch (error) {
    console.error('Backup selected error:', error);
    throw error;
  }
};

export default {
  localRemoteBackupCore,
  localRemoteBackupSelectedCore,
};
