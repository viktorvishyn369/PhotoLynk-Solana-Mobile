/**
 * uploadOperations.js
 * 
 * Handles upload operations for local/remote servers (non-StealthCloud).
 * Extracted from App.js to keep codebase modular.
 */

import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { normalizeFilenameForCompare, getMimeFromFilename, detectRealFormatFromMagic, withSimpleRetries, formatFilenameForStatus } from './utils';
import { createConcurrencyLimiter } from './backgroundTask';
import { buildLocalAssetIdSetPaged, fetchAllServerFilesPaged } from './mediaHelpers';
import { PHOTO_ALBUM_NAME, LEGACY_PHOTO_ALBUM_NAME } from './backupManager';
import { findFirstAlbumByTitle, SAVED_PASSWORD_KEY } from './autoUpload';
import { computePerceptualHash, computeExactFileHash, findPerceptualHashMatch } from './duplicateScanner';
import { getCachedHash, setCachedHash, loadHashCache, flushHashCache } from './hashCache';
import { extractFullExif } from './exifExtractor';
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { getDeviceUUID } from './authHelpers';

// dHash threshold for backup dedup (6 bits = ~9% tolerance for cross-platform differences)
const BACKUP_DHASH_THRESHOLD = 3;

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
  t,
}) => {
  resetProgressTracking();
  onStatus(t('status.backupPreparing'));
  onProgress(0);

  const permission = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
  if (!permission || permission.status !== 'granted') {
    return { permissionDenied: true };
  }

  if (Platform.OS === 'ios' && permission.accessPrivileges && permission.accessPrivileges !== 'all') {
    return { limitedAccess: true };
  }

  try {
    console.log('\n🔍 ===== BACKUP TRACE START =====');

    // Load hash cache for faster dedup (avoids re-hashing files)
    await loadHashCache();

    // Re-authenticate against the target server to ensure token matches its JWT_SECRET.
    // The stored auth_token may be from StealthCloud (different secret) if user switched modes.
    const SERVER_URL = getServerUrl();
    let config = await getAuthHeaders();
    try {
      const storedEmail = await SecureStore.getItemAsync('user_email');
      const storedPassword = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY);
      if (storedEmail && storedPassword) {
        const deviceId = await getDeviceUUID(storedEmail, storedPassword);
        const loginRes = await axios.post(`${SERVER_URL}/api/login`, {
          email: storedEmail,
          password: storedPassword,
          device_uuid: deviceId,
          device_name: Platform.OS + ' ' + Platform.Version,
        }, { timeout: 10000 });
        if (loginRes.data && loginRes.data.token) {
          const freshToken = loginRes.data.token;
          config = { headers: { Authorization: `Bearer ${freshToken}`, 'X-Device-UUID': deviceId } };
          console.log('[Backup] Re-authenticated against target server');
        }
      }
    } catch (reAuthErr) {
      console.log('[Backup] Re-auth failed, using existing token:', reAuthErr.message);
    }
    console.log('Using server URL for backup:', SERVER_URL);
    onStatus(t('status.fetchingServerFilesSimple', { fetched: 0 }));
    onProgress(0.01);
    
    // Fetch with meta=true to get hash metadata for cross-device dedup
    const allServerFiles = await fetchAllServerFilesPaged(SERVER_URL, config, (fetched, total) => {
      // Progress fills 1-5% during fetch
      const fetchProgress = total > 0 ? (fetched / total) * 0.04 : 0;
      throttledProgress(onProgress, 0.01 + fetchProgress);
      throttledStatus(onStatus, total > fetched ? t('status.fetchingServerFiles', { fetched, total }) : t('status.fetchingServerFilesSimple', { fetched }));
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

      const normalizedOriginal = normalizeFilenameForCompare(f && f.originalName ? f.originalName : null);
      if (normalizedOriginal) serverFiles.add(normalizedOriginal);
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

    // Android: exclude PhotoLynkDeleted album (our local "trash") from backup
    if (Platform.OS === 'android') {
      try {
        const deletedAlbum = albums.find(a => a && a.title === 'PhotoLynkDeleted');
        if (deletedAlbum) {
          const deletedIds = await buildLocalAssetIdSetPaged({ album: deletedAlbum });
          const before = excludedIds.size;
          for (const id of deletedIds) excludedIds.add(id);
          console.log(`📂 Album "${deletedAlbum.title}" has ${deletedIds.size} files (excluded). Total excluded now: ${excludedIds.size} (was ${before})`);
        }
      } catch (e) {}
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
        // Subtract excluded IDs from total so status shows correct count from start
        totalCount = Math.max(0, page.totalCount - excludedIds.size);
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

        // Scanning phase: 5-20% progress - show filename
        throttledStatus(onStatus, t('status.analyzing', { current: checkedCount, total: totalCount || '?', filename: formatFilenameForStatus(actualFilename) }));
        if (totalCount) {
          const analyzeProgress = 0.05 + (checkedCount / totalCount) * 0.15;
          throttledProgress(onProgress, analyzeProgress);
        }

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
      let serverTotal = allServerFiles.length;
      try {
        for (let i = 0; i < 2; i++) {
          const latest = await fetchAllServerFilesPaged(SERVER_URL, config, null, false);
          if (Array.isArray(latest)) serverTotal = Math.max(serverTotal, latest.length);
          await sleep(250);
        }
      } catch (e) {}
      return { alreadyBackedUp: true, checkedCount, serverTotal };
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

    // Concurrency per platform recommendations:
    // iOS: Apple httpMaximumConnectionsPerHost default=4, safe max=6
    // Android: OkHttp maxRequestsPerHost default=5, safe max=10
    const maxParallelUploads = fastMode
      ? (Platform.OS === 'android' ? 10 : 6)
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
        let actualFilename = assetInfo.filename || asset.filename;
        const isVideo = /\.(mov|mp4|m4v|avi|mkv|webm|3gp)$/i.test(actualFilename);
        
        // Detect real format from magic bytes and fix extension if mismatched
        // Android sometimes reports screenshots as .jpg when they're actually PNG
        if (!isVideo) {
          actualFilename = await detectRealFormatFromMagic(filePath, actualFilename);
        }

        // Compute hash for cross-device dedup (same content, different filename)
        // IMPORTANT: Add hash to session set IMMEDIATELY after computing to prevent race conditions
        // with parallel uploads (two similar files checking before either adds their hash)
        // USE CACHE: Check if hash was already computed for this asset to avoid re-hashing
        let skipByHash = false;
        let skipReason = null;
        let computedPhash = null; // Store for sending to server
        try {
          if (isVideo) {
            // Try cache first for video file hash
            let fileHash = getCachedHash(asset, 'file');
            if (!fileHash) {
              fileHash = await computeExactFileHash(filePath);
              if (fileHash) setCachedHash(asset, 'file', fileHash);
            }
            if (fileHash) {
              // Check if already in session (exact match for same device)
              const alreadyInSession = sessionFileHashes.has(fileHash);
              
              // Check against server hashes first (cross-device dedup)
              if (serverFileHashes.has(fileHash)) {
                skipByHash = true;
                skipReason = 'server fileHash';
              } else if (alreadyInSession) {
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
              }
              
              // Only add to session if we're NOT skipping (will upload)
              if (!skipByHash) {
                sessionFileHashes.add(fileHash);
              }
            }
          } else {
            // Try cache first for perceptual hash
            computedPhash = getCachedHash(asset, 'perceptual');
            if (!computedPhash) {
              computedPhash = await computePerceptualHash(filePath);
              if (computedPhash) setCachedHash(asset, 'perceptual', computedPhash);
            }
            if (computedPhash) {
              // Check if already in session (exact match for same device)
              const alreadyInSession = sessionPerceptualHashes.has(computedPhash);
              
              // Check against server hashes first (cross-device dedup with threshold)
              if (findPerceptualHashMatch(computedPhash, serverPerceptualHashes, BACKUP_DHASH_THRESHOLD)) {
                skipByHash = true;
                skipReason = 'server perceptualHash';
              } else if (alreadyInSession) {
                skipByHash = true;
                skipReason = 'session perceptualHash';
              } else {
                // FALLBACK: Check ALL platform hashes (double-confirm before upload)
                for (const plat of ['ios', 'android']) {
                  if (findPerceptualHashMatch(computedPhash, platformPerceptualHashes[plat], BACKUP_DHASH_THRESHOLD)) {
                    skipByHash = true;
                    skipReason = `platform_${plat} perceptualHash`;
                    break;
                  }
                }
              }
              
              // Only add to session if we're NOT skipping (will upload)
              // This prevents race conditions where parallel uploads all skip each other
              if (!skipByHash) {
                sessionPerceptualHashes.add(computedPhash);
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
        // Include perceptual hash in header so server can use it for HEIC files (sharp can't compute)
        const sessionTypeUpload = FileSystem.FileSystemSessionType.FOREGROUND;
        const uploadHeaders = {
          ...config.headers,
          'Content-Type': mime,
          'X-Filename': encodeURIComponent(String(actualFilename || '')),
        };
        // Send client's perceptual hash for server-side dedup (critical for HEIC where sharp fails)
        if (computedPhash) {
          uploadHeaders['X-Perceptual-Hash'] = computedPhash;
        }
        const uploadRes = await FileSystem.uploadAsync(`${SERVER_URL}/api/upload/raw`, fileUri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          sessionType: sessionTypeUpload,
          headers: uploadHeaders
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
          // Add uploaded file's hashes to server sets to prevent race conditions
          // when user starts another backup immediately after this one finishes
          if (parsed?.fileHash) serverFileHashes.add(parsed.fileHash);
          if (parsed?.perceptualHash) serverPerceptualHashes.add(parsed.perceptualHash);
          
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
                'X-Filename': encodeURIComponent(String(actualFilename || '')),
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
        const displayFilename = asset.filename || 'file';
        throttledStatus(onStatus, t('status.backingUp', { current: processedCount, total: toUpload.length, filename: formatFilenameForStatus(displayFilename) }));
        throttledProgress(onProgress, uploadProgress);
      }
    }));

    await Promise.all(uploadTasks);

    // Show detailed completion status
    // Re-fetch after uploads so the completion popup matches the real server count.
    // We avoid arithmetic with duplicateCount because the server may dedupe by hash even when
    // filenames differ or our client-side filename set missed an existing server item.
    let serverFilesOnServer = allServerFiles.length;
    try {
      const latestServerFiles = await fetchAllServerFilesPaged(SERVER_URL, config, null, false);
      if (Array.isArray(latestServerFiles)) serverFilesOnServer = latestServerFiles.length;
    } catch (e) {
      serverFilesOnServer = allServerFiles.length + successCount;
    }
    console.log('\n📊 ===== BACKUP SUMMARY =====');
    console.log(`Total on device: ${totalCount || checkedCount}`);
    console.log(`Album excluded: ${excludedIds.size}`);
    console.log(`To check: ${checkedCount}`);
    console.log(`On server before: ${allServerFiles.length}`);
    console.log(`Marked for upload: ${toUpload.length}`);
    console.log(`Actually uploaded: ${successCount}`);
    console.log(`Server rejected (duplicate): ${duplicateCount}`);
    console.log(`Client skipped (hash): ${hashDedupCount}`);
    console.log(`Failed: ${failedCount}`);
    console.log(`Now on server: ${serverFilesOnServer}`);
    console.log('===== END BACKUP TRACE =====\n');

    const skippedCount = checkedCount - toUpload.length + duplicateCount + hashDedupCount;

    // Flush hash cache to disk
    await flushHashCache();

    return {
      uploaded: successCount,
      skipped: skippedCount,
      failed: failedCount,
      checkedCount,
      totalCount: totalCount || checkedCount,
      serverTotal: serverFilesOnServer, // Actual count on server after backup
    };
  } catch (error) {
    console.error('Backup error:', error);
    await flushHashCache(); // Save cache even on error
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
  t,
}) => {
  const list = Array.isArray(assets) ? assets.filter(a => a && a.id) : [];
  if (list.length === 0) {
    return { noSelection: true };
  }

  const permission = await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
  if (!permission || permission.status !== 'granted') {
    return { permissionDenied: true };
  }

  resetProgressTracking();
  onStatus?.(t('status.backupPreparing'));
  onProgress?.(0);

  try {
    // Load hash cache for faster dedup (avoids re-hashing files)
    await loadHashCache();
    
    // Re-authenticate against the target server (same as localRemoteBackupCore)
    const SERVER_URL = getServerUrl();
    let config = await getAuthHeaders();
    try {
      const storedEmail = await SecureStore.getItemAsync('user_email');
      const storedPassword = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY);
      if (storedEmail && storedPassword) {
        const deviceId = await getDeviceUUID(storedEmail, storedPassword);
        const loginRes = await axios.post(`${SERVER_URL}/api/login`, {
          email: storedEmail,
          password: storedPassword,
          device_uuid: deviceId,
          device_name: Platform.OS + ' ' + Platform.Version,
        }, { timeout: 10000 });
        if (loginRes.data && loginRes.data.token) {
          const freshToken = loginRes.data.token;
          config = { headers: { Authorization: `Bearer ${freshToken}`, 'X-Device-UUID': deviceId } };
          console.log('[Backup] Re-authenticated against target server');
        }
      }
    } catch (reAuthErr) {
      console.log('[Backup] Re-auth failed, using existing token:', reAuthErr.message);
    }
    
    onStatus?.(t('status.fetchingServerFilesSimple', { fetched: 0 }));
    onProgress?.(0.01);
    
    // Fetch with meta=true to get hash metadata for cross-device dedup
    const allServerFiles = await fetchAllServerFilesPaged(SERVER_URL, config, (fetched, total) => {
      // Progress fills 1-5% during fetch
      const fetchProgress = total > 0 ? (fetched / total) * 0.04 : 0;
      throttledProgress(onProgress, 0.01 + fetchProgress);
      throttledStatus(onStatus, total > fetched ? t('status.fetchingServerFiles', { fetched, total }) : t('status.fetchingServerFilesSimple', { fetched }));
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

      const normalizedOriginal = normalizeFilenameForCompare(f && f.originalName ? f.originalName : null);
      if (normalizedOriginal) serverFiles.add(normalizedOriginal);
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

    // Android: exclude PhotoLynkDeleted album (our local "trash") from backup
    if (Platform.OS === 'android') {
      try {
        const deletedAlbum = albums.find(a => a && a.title === 'PhotoLynkDeleted');
        if (deletedAlbum) {
          const deletedIds = await buildLocalAssetIdSetPaged({ album: deletedAlbum });
          for (const id of deletedIds) excludedIds.add(id);
        }
      } catch (e) {}
    }

    const toUpload = [];
    for (let i = 0; i < list.length; i++) {
      const asset = list[i];
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

      // Scanning phase: 5-20% progress - show filename
      const analyzeProgress = 0.05 + ((i + 1) / list.length) * 0.15;
      throttledStatus(onStatus, t('status.analyzing', { current: i + 1, total: list.length, filename: formatFilenameForStatus(actualFilename) }));
      throttledProgress(onProgress, analyzeProgress);
      
      if (serverFiles.has(actualFilename)) continue;
      toUpload.push(asset);
    }

    if (toUpload.length === 0) {
      let serverTotal = allServerFiles.length;
      try {
        for (let i = 0; i < 2; i++) {
          const latest = await fetchAllServerFilesPaged(SERVER_URL, config, null, false);
          if (Array.isArray(latest)) serverTotal = Math.max(serverTotal, latest.length);
          await sleep(250);
        }
      } catch (e) {}
      return { alreadyBackedUp: true, total: list.length, skipped: list.length, serverTotal };
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
        const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
        const displayFilename = assetInfo.filename || asset.filename || 'file';

        // Upload phase: 20-100% progress
        const uploadProgress = 0.2 + ((i + 1) / toUpload.length) * 0.8;
        throttledStatus(onStatus, t('status.backingUp', { current: i + 1, total: toUpload.length, filename: formatFilenameForStatus(displayFilename) }));
        throttledProgress(onProgress, uploadProgress);
        const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo });
        const filePath = resolved && resolved.filePath ? resolved.filePath : null;
        if (!filePath) {
          failedCount++;
          continue;
        }

        let actualFilename = assetInfo.filename || asset.filename;
        const isVideo = /\.(mov|mp4|m4v|avi|mkv|webm|3gp)$/i.test(actualFilename);
        
        // Detect real format from magic bytes and fix extension if mismatched
        if (!isVideo) {
          actualFilename = await detectRealFormatFromMagic(filePath, actualFilename);
        }

        // Compute hash for cross-device dedup
        // IMPORTANT: Add hash to session set IMMEDIATELY after computing to prevent race conditions
        // USE CACHE: Check if hash was already computed for this asset to avoid re-hashing
        let skipByHash = false;
        let computedPhash = null; // Store for sending to server
        try {
          if (isVideo) {
            // Try cache first for video file hash
            let fileHash = getCachedHash(asset, 'file');
            if (!fileHash) {
              fileHash = await computeExactFileHash(filePath);
              if (fileHash) setCachedHash(asset, 'file', fileHash);
            }
            if (fileHash) {
              // Check if already in session (exact match for same device)
              const alreadyInSession = sessionFileHashes.has(fileHash);
              
              // Check against server hashes first (cross-device dedup)
              if (serverFileHashes.has(fileHash)) {
                skipByHash = true;
              } else if (alreadyInSession) {
                skipByHash = true;
              } else {
                // FALLBACK: Check ALL platform hashes (double-confirm before upload)
                for (const plat of ['ios', 'android']) {
                  if (platformFileHashes[plat].has(fileHash)) {
                    skipByHash = true;
                    break;
                  }
                }
              }
              
              // Only add to session if we're NOT skipping (will upload)
              if (!skipByHash) {
                sessionFileHashes.add(fileHash);
              }
            }
          } else {
            // Try cache first for perceptual hash
            computedPhash = getCachedHash(asset, 'perceptual');
            if (!computedPhash) {
              computedPhash = await computePerceptualHash(filePath);
              if (computedPhash) setCachedHash(asset, 'perceptual', computedPhash);
            }
            if (computedPhash) {
              // Check if already in session (exact match for same device)
              const alreadyInSession = sessionPerceptualHashes.has(computedPhash);
              
              // Check against server hashes first (cross-device dedup with threshold)
              if (findPerceptualHashMatch(computedPhash, serverPerceptualHashes, BACKUP_DHASH_THRESHOLD)) {
                skipByHash = true;
              } else if (alreadyInSession) {
                skipByHash = true;
              } else {
                // FALLBACK: Check ALL platform hashes (double-confirm before upload)
                for (const plat of ['ios', 'android']) {
                  if (findPerceptualHashMatch(computedPhash, platformPerceptualHashes[plat], BACKUP_DHASH_THRESHOLD)) {
                    skipByHash = true;
                    break;
                  }
                }
              }
              
              // Only add to session if we're NOT skipping (will upload)
              if (!skipByHash) {
                sessionPerceptualHashes.add(computedPhash);
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
        const uploadHeaders = {
          ...config.headers,
          'Content-Type': mime,
          'X-Filename': encodeURIComponent(String(actualFilename || '')),
        };
        // Send client's perceptual hash for server-side dedup (critical for HEIC where sharp fails)
        if (computedPhash) {
          uploadHeaders['X-Perceptual-Hash'] = computedPhash;
        }
        const uploadRes = await FileSystem.uploadAsync(`${SERVER_URL}/api/upload/raw`, fileUri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          sessionType,
          headers: uploadHeaders
        });

        // Check HTTP status - uploadAsync doesn't throw on 4xx/5xx errors
        if (!uploadRes || uploadRes.status < 200 || uploadRes.status >= 300) {
          console.error(`✗ Upload failed for ${actualFilename}: HTTP ${uploadRes?.status || 'unknown'} - ${uploadRes?.body || 'no response'}`);
          failedCount++;
          continue;
        }

        // Parse response to get hashes
        let parsed = null;
        try {
          parsed = uploadRes && uploadRes.body ? JSON.parse(uploadRes.body) : null;
        } catch (e) { parsed = null; }

        // Add uploaded file's hashes to server sets to prevent race conditions
        if (parsed?.fileHash) serverFileHashes.add(parsed.fileHash);
        if (parsed?.perceptualHash) serverPerceptualHashes.add(parsed.perceptualHash);

        // Check if server rejected as duplicate
        if (parsed && parsed.duplicate) {
          console.log(`⊘ Skipped (duplicate): ${actualFilename}`);
          // Don't count as success - it's a duplicate
        } else {
          successCount++;
          console.log(`✓ Uploaded: ${actualFilename}`);
        }
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
                'X-Filename': encodeURIComponent(String(actualFilename || '')),
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
    // Re-fetch after uploads so the completion popup matches the real server count.
    let serverTotal = allServerFiles.length;
    try {
      const latestServerFiles = await fetchAllServerFilesPaged(SERVER_URL, config, null, false);
      if (Array.isArray(latestServerFiles)) serverTotal = latestServerFiles.length;
    } catch (e) {
      serverTotal = allServerFiles.length + successCount;
    }
    
    // Flush hash cache to disk
    await flushHashCache();
    
    return { uploaded: successCount, skipped: skippedCount, failed: failedCount, serverTotal, selectedCount: list.length };
  } catch (error) {
    console.error('Backup selected error:', error);
    await flushHashCache(); // Save cache even on error
    throw error;
  }
};

export default {
  localRemoteBackupCore,
  localRemoteBackupSelectedCore,
};
