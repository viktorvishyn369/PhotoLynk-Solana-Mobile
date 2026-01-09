/**
 * cleanDuplicatesOperations.js
 * 
 * Handles clean duplicates UI operations and coordination with duplicateScanner.
 * Extracted from App.js to keep codebase modular.
 */

import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library';

/**
 * Starts the similar photos review process.
 * Scans device for similar photos and returns groups for review.
 * 
 * @param {Object} params - Parameters
 * @param {Function} params.resolveReadableFilePath - Function to resolve file paths
 * @param {Function} params.onStatus - Status update callback
 * @param {Function} params.onProgress - Progress update callback
 * @returns {Promise<Object>} Result with groups or error
 */
export const startSimilarShotsReviewCore = async ({
  resolveReadableFilePath,
  onStatus,
  onProgress,
  abortRef,
}) => {
  onStatus('Preparing...');
  onProgress(0);
  
  try {
    // Check permission first
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (permission.status !== 'granted') {
      return { error: 'Photos permission not granted' };
    }
    if (Platform.OS === 'ios' && permission.accessPrivileges && permission.accessPrivileges !== 'all') {
      return { error: 'Limited Photos Access. Please allow Full Access.' };
    }

    // Use duplicateScanner module
    const DuplicateScanner = require('./duplicateScanner').default;
    
    const result = await DuplicateScanner.scanSimilarPhotos({
      resolveReadableFilePath,
      abortRef,
      includeVideos: true,
      onCollecting: () => {
        onStatus('Collecting photos & videos...');
        onProgress(0);
      },
      onProgress: (current, total, status) => {
        // Map progress: 5% for collecting, 5-95% for analyzing, 95-100% for finding matches
        const analyzeProgress = total > 0 ? (current / total) * 0.9 : 0;
        onProgress(0.05 + analyzeProgress);
        onStatus(`Analyzing ${current}/${total} items...`);
      },
      onFindingMatches: () => {
        onStatus('Finding matches...');
        onProgress(0.95);
      }
    });

    // Check if scan was aborted
    if (result.aborted) {
      return { aborted: true };
    }

    onProgress(1);
    
    const groups = result.groups || [];
    if (!groups || groups.length === 0) {
      return { noGroups: true };
    }

    return { groups };
  } catch (e) {
    return { error: e?.message || 'Could not scan for photos.' };
  }
};

/**
 * Builds default selection for a similar group (select all except first).
 * 
 * @param {Array} group - Array of similar items
 * @returns {Object} Selection map with asset IDs as keys
 */
export const buildDefaultSimilarSelection = (group) => {
  const items = Array.isArray(group) ? group : [];
  const next = {};
  for (let i = 1; i < items.length; i++) {
    const id = items[i] && items[i].id ? String(items[i].id) : '';
    if (id) next[id] = true;
  }
  return next;
};

/**
 * Gets array of selected asset IDs from selection map.
 * 
 * @param {Object} similarSelected - Selection map
 * @returns {Array<string>} Array of selected asset IDs
 */
export const getSelectedIds = (similarSelected) => {
  const sel = similarSelected && typeof similarSelected === 'object' ? similarSelected : {};
  return Object.keys(sel).filter(k => sel[k]);
};

/**
 * Toggles selection state for an asset.
 * 
 * @param {Object} prevSelected - Previous selection map
 * @param {string} assetId - Asset ID to toggle
 * @returns {Object} New selection map
 */
export const toggleSelection = (prevSelected, assetId) => {
  const key = assetId ? String(assetId) : '';
  if (!key) return prevSelected;
  const next = { ...(prevSelected || {}) };
  if (next[key]) {
    delete next[key];
  } else {
    next[key] = true;
  }
  return next;
};

/**
 * Deletes selected assets from the device.
 * Uses duplicateScanner's deleteAssets function.
 * 
 * @param {Array<string>} ids - Array of asset IDs to delete
 * @returns {Promise<Object>} Result with success status and deleted count
 */
export const deleteSelectedAssets = async (ids) => {
  if (!ids || ids.length === 0) {
    return { success: true, deleted: 0 };
  }

  const DuplicateScanner = require('./duplicateScanner').default;
  return await DuplicateScanner.deleteAssets(ids);
};

/**
 * Starts the exact duplicates scan process.
 * Scans device for exact duplicate photos using pixel hashing.
 * 
 * @param {Object} params - Parameters
 * @param {Function} params.resolveReadableFilePath - Function to resolve file paths
 * @param {Function} params.onStatus - Status update callback
 * @param {Function} params.onProgress - Progress update callback
 * @returns {Promise<Object>} Result with duplicateGroups, stats, or error
 */
export const startExactDuplicatesScanCore = async ({
  resolveReadableFilePath,
  onStatus,
  onProgress,
  abortRef,
}) => {
  onStatus('Preparing...');
  onProgress(0);
  
  try {
    // Check permission first
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (permission.status !== 'granted') {
      return { error: 'Photos permission not granted' };
    }
    if (Platform.OS === 'ios' && permission.accessPrivileges && permission.accessPrivileges !== 'all') {
      return { error: 'Limited Photos Access. Please allow Full Access.' };
    }

    const DuplicateScanner = require('./duplicateScanner').default;
    
    // Collecting phase - include videos for duplicate detection (0-10% of progress)
    onStatus('Collecting photos & videos...');
    onProgress(0);
    const assets = await DuplicateScanner.collectAllPhotoAssets({ 
      includeVideos: true,
      onProgress: (progressData) => {
        // Handle both old string format and new object format
        if (typeof progressData === 'string') {
          onStatus(progressData);
        } else if (progressData && typeof progressData === 'object') {
          const { collected, estimated, message } = progressData;
          onStatus(message || `Collecting ${collected} items...`);
          // Fill progress bar during collecting (0-10%)
          if (estimated > 0) {
            onProgress(Math.min(0.1, (collected / estimated) * 0.1));
          }
        }
      },
    });
    
    if (!assets || assets.length === 0) {
      return { noAssets: true };
    }

    // Scan for exact duplicates (photos use perceptual hash, videos use file hash)
    const { duplicateGroups, stats, aborted } = await DuplicateScanner.scanExactDuplicates({
      assets,
      resolveReadableFilePath,
      abortRef,
      includeVideos: true,
      onProgress: (hashedCount, totalCount, lastHash) => {
        // Map progress: 10% for collecting (done), 10-95% for analyzing, 95-100% for finding matches
        const analyzeProgress = totalCount > 0 ? (hashedCount / totalCount) * 0.85 : 0;
        onProgress(0.1 + analyzeProgress);
        onStatus(`Analyzing ${hashedCount}/${totalCount} items...`);
      }
    });

    // Check if scan was aborted
    if (aborted) {
      return { aborted: true };
    }

    // Finding matches phase
    onStatus('Finding matches...');
    onProgress(0.95);

    if (!duplicateGroups || duplicateGroups.length === 0) {
      onProgress(1);
      const note = DuplicateScanner.buildNoResultsNote(stats);
      return { noDuplicates: true, note, stats };
    }

    // Format for review
    const reviewGroups = DuplicateScanner.formatDuplicateGroupsForReview(duplicateGroups);
    const totalDuplicates = DuplicateScanner.countDuplicates(duplicateGroups);

    onProgress(1);
    
    return {
      groups: reviewGroups,
      totalDuplicates,
      stats,
    };
  } catch (e) {
    return { error: e?.message || 'Could not scan for duplicates.' };
  }
};

export default {
  startSimilarShotsReviewCore,
  startExactDuplicatesScanCore,
  buildDefaultSimilarSelection,
  getSelectedIds,
  toggleSelection,
  deleteSelectedAssets,
};
