// PhotoLynk Mobile App - Sync Picker Operations
// Handles fetching and decrypting manifests for the sync picker UI

import axios from 'axios';
import { Buffer } from 'buffer';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

/**
 * Decrypts a single manifest and returns a picker item
 * @param {string} manifestId - The manifest ID
 * @param {Object} config - Auth config with headers
 * @param {string} SERVER_URL - Server URL
 * @param {Uint8Array} masterKey - Decryption master key
 * @returns {Promise<{item: Object, success: boolean}>}
 */
export const decryptManifestForPicker = async (manifestId, config, SERVER_URL, masterKey) => {
  const mid = manifestId ? String(manifestId) : '';
  if (!mid) return { item: null, success: false };

  try {
    const manRes = await axios.get(`${SERVER_URL}/api/cloud/manifests/${mid}`, { 
      headers: config.headers, 
      timeout: 15000 
    });
    const payload = manRes.data;
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const enc = JSON.parse(parsed.encryptedManifest);
    const manifestNonce = naclUtil.decodeBase64(enc.manifestNonce);
    const manifestBox = naclUtil.decodeBase64(enc.manifestBox);
    const manifestPlain = nacl.secretbox.open(manifestBox, manifestNonce, masterKey);
    
    if (!manifestPlain) {
      console.log(`Sync picker: decrypt returned null for ${mid} (wrong key?)`);
      return {
        item: { 
          manifestId: mid, 
          filename: `[encrypted] ${mid.slice(0, 12)}...`, 
          size: null, 
          mediaType: 'photo', 
          assetId: null, 
          decryptFailed: true 
        },
        success: false
      };
    }
    
    const manifest = JSON.parse(naclUtil.encodeUTF8(manifestPlain));
    const originalFilename = manifest.filename || manifest.name || manifest.originalFilename || null;
    const ext = (originalFilename || '').split('.').pop()?.toLowerCase() || '';
    const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'm4v', '3gp', 'webm'].includes(ext);
    const detectedMediaType = manifest.mediaType || (isVideo ? 'video' : 'photo');
    
    return {
      item: { 
        manifestId: mid, 
        filename: originalFilename || mid, 
        size: manifest.originalSize || manifest.size || null, 
        mediaType: detectedMediaType, 
        assetId: manifest.assetId || null 
      },
      success: true
    };
  } catch (e) {
    console.log('Sync picker: manifest fetch/parse failed for', mid, e.message);
    return {
      item: { 
        manifestId: mid, 
        filename: `[error] ${mid.slice(0, 12)}...`, 
        size: null, 
        mediaType: 'photo', 
        assetId: null, 
        decryptFailed: true 
      },
      success: false
    };
  }
};

/**
 * Fetches and decrypts a page of StealthCloud manifests for the sync picker
 * @param {Object} params
 * @param {Object} params.config - Auth config with headers
 * @param {string} params.SERVER_URL - Server URL
 * @param {Uint8Array} params.masterKey - Decryption master key
 * @param {number} params.offset - Page offset
 * @param {number} params.limit - Page size
 * @returns {Promise<{items: Array, total: number, nextOffset: number, decryptSuccess: number, decryptFail: number}>}
 */
export const fetchStealthCloudPickerPage = async ({
  config,
  SERVER_URL,
  masterKey,
  offset,
  limit,
}) => {
  const listRes = await axios.get(`${SERVER_URL}/api/cloud/manifests`, { 
    ...config, 
    params: { offset, limit } 
  });
  const manifests = (listRes.data && listRes.data.manifests) || [];
  const total = typeof listRes.data?.total === 'number' ? listRes.data.total : manifests.length;

  const items = [];
  let decryptSuccess = 0;
  let decryptFail = 0;

  for (const m of manifests) {
    const mid = m && m.manifestId ? String(m.manifestId) : '';
    if (!mid) continue;
    
    const result = await decryptManifestForPicker(mid, config, SERVER_URL, masterKey);
    if (result.item) {
      items.push(result.item);
      if (result.success) {
        decryptSuccess++;
      } else {
        decryptFail++;
      }
    }
  }

  const nextOffset = offset + manifests.length;
  console.log(`Sync picker: loaded ${items.length} items (${decryptSuccess} decrypted, ${decryptFail} failed) offset ${nextOffset}/${total}`);

  return { items, total, nextOffset, decryptSuccess, decryptFail };
};

/**
 * Fetches a thumbnail for a file from the server and returns base64 data URI
 * Uses the /thumb endpoint which returns a resized 150px image
 * @param {string} filename - The filename to fetch thumbnail for
 * @param {Object} config - Auth config with headers
 * @param {string} SERVER_URL - Server URL
 * @returns {Promise<string|null>} - Base64 data URI or null on failure
 */
export const fetchThumbnailBase64 = async (filename, config, SERVER_URL) => {
  try {
    const url = `${SERVER_URL}/api/files/${encodeURIComponent(filename)}/thumb`;
    const response = await axios.get(url, {
      ...config,
      responseType: 'arraybuffer',
      timeout: 15000,
    });
    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    // Server returns JPEG thumbnails
    return `data:image/jpeg;base64,${base64}`;
  } catch (e) {
    console.log('Thumbnail fetch failed for', filename, e.message);
    return null;
  }
};

/**
 * Fetches a page of local/remote server files for the sync picker
 * @param {Object} params
 * @param {Object} params.config - Auth config with headers
 * @param {string} params.SERVER_URL - Server URL
 * @param {number} params.offset - Page offset
 * @param {number} params.limit - Page size
 * @param {boolean} params.fetchThumbnails - Whether to fetch thumbnails (default true)
 * @returns {Promise<{items: Array, total: number, nextOffset: number}>}
 */
export const fetchLocalRemotePickerPage = async ({
  config,
  SERVER_URL,
  offset,
  limit,
  fetchThumbnails = true,
}) => {
  const res = await axios.get(`${SERVER_URL}/api/files`, { 
    ...config, 
    params: { offset, limit } 
  });
  const serverFiles = res?.data?.files || [];
  const total = typeof res?.data?.total === 'number' ? res.data.total : serverFiles.length;

  // Fetch thumbnails for images and videos in parallel
  let items = serverFiles;
  if (fetchThumbnails && serverFiles.length > 0) {
    items = await Promise.all(serverFiles.map(async (file) => {
      const ext = (file.filename || '').split('.').pop()?.toLowerCase() || '';
      const isImage = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp', 'tiff'].includes(ext);
      const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'm4v', '3gp', 'webm'].includes(ext);
      if (isImage || isVideo) {
        const thumbUri = await fetchThumbnailBase64(file.filename, config, SERVER_URL);
        return { ...file, thumbUri };
      }
      return { ...file, thumbUri: null };
    }));
  }

  const nextOffset = offset + serverFiles.length;
  console.log(`Sync picker: loaded ${items.length} items (offset ${nextOffset}/${total})`);

  return { items, total, nextOffset };
};

export default {
  decryptManifestForPicker,
  fetchStealthCloudPickerPage,
  fetchLocalRemotePickerPage,
};
