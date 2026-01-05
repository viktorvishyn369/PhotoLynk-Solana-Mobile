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
export const localRemoteBackupCore = async ({
  getAuthHeaders,
  getServerUrl,
  resolveReadableFilePath,
  ensureAutoUploadPolicyAllowsWorkIfBackgrounded,
  fastMode,
  onStatus,
  onProgress,
}) => {
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

    // 1. Get Server List (with pagination to get ALL files)
    const config = await getAuthHeaders();
    const SERVER_URL = getServerUrl();
    console.log('Using server URL for backup:', SERVER_URL);
    const allServerFiles = await fetchAllServerFilesPaged(SERVER_URL, config);

    console.log(`\n☁️  Server response: ${allServerFiles.length} files`);

    const serverFiles = new Set(
      allServerFiles
        .map(f => normalizeFilenameForCompare(f && f.filename ? f.filename : null))
        .filter(Boolean)
    );

    console.log(`📊 Server files (unique, lowercase): ${serverFiles.size}`);

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
        onStatus(`Analyzing ${checkedCount} of ${totalCount || '?'}`);
        if (totalCount) onProgress(checkedCount / totalCount);

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
        if (!(await ensureAutoUploadPolicyAllowsWorkIfBackgrounded())) return;

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
        }
      } catch (fileError) {
        console.error(`✗ Failed to upload ${asset.filename}:`, fileError.message);
        failedCount++;
        failedFiles.push(asset.filename);
      } finally {
        processedCount++;
        onStatus(`Backing up ${processedCount} of ${toUpload.length}`);
        onProgress(processedCount / toUpload.length);
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
    console.log(`Duplicates skipped: ${duplicateCount}`);
    console.log(`Failed: ${failedCount}`);
    console.log('===== END BACKUP TRACE =====\n');

    const skippedCount = checkedCount - toUpload.length + duplicateCount;

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

  onStatus?.('Preparing backup...');
  onProgress?.(0);

  try {
    const config = await getAuthHeaders();
    const SERVER_URL = getServerUrl();
    const allServerFiles = await fetchAllServerFilesPaged(SERVER_URL, config);
    const serverFiles = new Set(
      allServerFiles
        .map(f => normalizeFilenameForCompare(f && f.filename ? f.filename : null))
        .filter(Boolean)
    );

    const albums = await MediaLibrary.getAlbumsAsync();
    const photoSyncAlbum = findFirstAlbumByTitle(albums, [PHOTO_ALBUM_NAME, LEGACY_PHOTO_ALBUM_NAME]);
    let excludedIds = new Set();
    if (photoSyncAlbum) {
      excludedIds = await buildLocalAssetIdSetPaged({ album: photoSyncAlbum });
    }

    const toUpload = [];
    for (let i = 0; i < list.length; i++) {
      const asset = list[i];
      onStatus?.(`Analyzing ${i + 1} of ${list.length}`);
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
      return { alreadyBackedUp: true, total: list.length };
    }

    // Brief pause before starting uploads
    await sleep(500);

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < toUpload.length; i++) {
      const asset = toUpload[i];
      try {
        if (!(await ensureAutoUploadPolicyAllowsWorkIfBackgrounded())) {
          break;
        }
        onStatus?.(`Backing up ${i + 1} of ${toUpload.length}`);

        const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
        const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo });
        const filePath = resolved && resolved.filePath ? resolved.filePath : null;
        if (!filePath) {
          failedCount++;
          continue;
        }

        const actualFilename = assetInfo.filename || asset.filename;
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
        failedCount++;
      }
    }

    const skippedCount = list.length - toUpload.length;
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
