/**
 * EXIF Extractor for cross-platform HEIC deduplication
 * Extracts real EXIF metadata (captureTime, make, model) from HEIC files
 * Used for deduplication when perceptual hashes differ due to platform processing
 */

import { Platform, NativeModules } from 'react-native';

const { ExifExtractor } = NativeModules;

/**
 * Extract EXIF data from a HEIC file
 * @param {string} filePath - Path to the HEIC file
 * @returns {Promise<{captureTime: string|null, make: string|null, model: string|null}>}
 */
export async function extractExifFromHEIC(filePath) {
  if (!filePath) {
    return { captureTime: null, make: null, model: null };
  }

  if (Platform.OS === 'ios') {
    // Use native iOS module for EXIF extraction
    if (!ExifExtractor || !ExifExtractor.extractExif) {
      console.warn('ExifExtractor native module not available');
      return { captureTime: null, make: null, model: null };
    }
    
    try {
      const result = await ExifExtractor.extractExif(filePath);
      return {
        captureTime: result.captureTime || null,
        make: result.make || null,
        model: result.model || null
      };
    } catch (e) {
      console.warn('EXIF extraction failed:', e?.message);
      return { captureTime: null, make: null, model: null };
    }
  } else if (Platform.OS === 'android') {
    // Use native Android module for EXIF extraction
    if (!ExifExtractor || !ExifExtractor.extractExif) {
      console.warn('ExifExtractor native module not available on Android');
      return { captureTime: null, make: null, model: null };
    }
    
    try {
      const result = await ExifExtractor.extractExif(filePath);
      return {
        captureTime: result.captureTime || null,
        make: result.make || null,
        model: result.model || null
      };
    } catch (e) {
      console.warn('EXIF extraction failed on Android:', e?.message);
      return { captureTime: null, make: null, model: null };
    }
  }

  return { captureTime: null, make: null, model: null };
}

/**
 * Normalize EXIF capture time to ISO format for consistent comparison
 * @param {string} captureTime - EXIF capture time string
 * @returns {string|null} - Normalized ISO format (YYYY-MM-DDTHH:MM:SS)
 */
export function normalizeExifCaptureTime(captureTime) {
  if (!captureTime) return null;
  
  // Already in ISO format
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(captureTime)) {
    return captureTime.slice(0, 19); // Strip milliseconds/timezone
  }
  
  // EXIF format: "YYYY:MM:DD HH:MM:SS"
  const exifMatch = captureTime.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (exifMatch) {
    const [, year, month, day, hour, min, sec] = exifMatch;
    return `${year}-${month}-${day}T${hour}:${min}:${sec}`;
  }
  
  return null;
}
