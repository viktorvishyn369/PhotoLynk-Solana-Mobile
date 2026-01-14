/**
 * EXIF Extractor for cross-platform HEIC deduplication and universal EXIF preservation
 * Extracts real EXIF metadata from image files for:
 * 1. Deduplication (captureTime, make, model)
 * 2. Universal preservation (ALL EXIF fields stored on server by file hash)
 */

import { Platform, NativeModules } from 'react-native';

const { ExifExtractor } = NativeModules;

/**
 * Extract FULL EXIF data from assetInfo for server storage
 * This captures ALL available EXIF fields for universal cross-platform preservation
 * @param {Object} assetInfo - expo-media-library AssetInfo with exif property
 * @param {Object} asset - expo-media-library Asset with creationTime, location, etc.
 * @returns {Object} Full EXIF data object with all available fields
 */
export function extractFullExif(assetInfo, asset) {
  const result = {
    // Core identification
    captureTime: null,
    make: null,
    model: null,
    // Camera settings
    exposureTime: null,
    fNumber: null,
    iso: null,
    focalLength: null,
    focalLengthIn35mm: null,
    flash: null,
    whiteBalance: null,
    meteringMode: null,
    exposureProgram: null,
    exposureBias: null,
    // Image properties
    width: null,
    height: null,
    orientation: null,
    colorSpace: null,
    // GPS/Location
    gpsLatitude: null,
    gpsLongitude: null,
    gpsAltitude: null,
    gpsTimestamp: null,
    // Software/processing
    software: null,
    lensMake: null,
    lensModel: null,
    // Raw EXIF object for any fields we might miss
    rawExif: null,
  };

  try {
    const exif = assetInfo?.exif;
    
    // Core identification
    let captureTimeStr = exif?.DateTimeOriginal || exif?.DateTimeDigitized || exif?.DateTime;
    if (captureTimeStr && typeof captureTimeStr === 'string') {
      const normalized = captureTimeStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(normalized)) {
        result.captureTime = normalized.slice(0, 19);
      }
    }
    
    // Fallback to asset.creationTime
    if (!result.captureTime && asset?.creationTime) {
      const d = new Date(asset.creationTime);
      if (!isNaN(d.getTime())) {
        result.captureTime = d.toISOString().slice(0, 19);
      }
    }

    // Device info
    if (exif?.Make) result.make = String(exif.Make).trim();
    if (exif?.Model) result.model = String(exif.Model).trim();

    // Camera settings
    if (exif?.ExposureTime != null) result.exposureTime = exif.ExposureTime;
    if (exif?.FNumber != null) result.fNumber = exif.FNumber;
    if (exif?.ISOSpeedRatings != null) result.iso = Array.isArray(exif.ISOSpeedRatings) ? exif.ISOSpeedRatings[0] : exif.ISOSpeedRatings;
    if (exif?.ISO != null) result.iso = result.iso || exif.ISO;
    if (exif?.FocalLength != null) result.focalLength = exif.FocalLength;
    if (exif?.FocalLengthIn35mmFilm != null) result.focalLengthIn35mm = exif.FocalLengthIn35mmFilm;
    if (exif?.Flash != null) result.flash = exif.Flash;
    if (exif?.WhiteBalance != null) result.whiteBalance = exif.WhiteBalance;
    if (exif?.MeteringMode != null) result.meteringMode = exif.MeteringMode;
    if (exif?.ExposureProgram != null) result.exposureProgram = exif.ExposureProgram;
    if (exif?.ExposureBiasValue != null) result.exposureBias = exif.ExposureBiasValue;

    // Image properties
    if (exif?.PixelXDimension != null) result.width = exif.PixelXDimension;
    if (exif?.PixelYDimension != null) result.height = exif.PixelYDimension;
    if (exif?.ImageWidth != null) result.width = result.width || exif.ImageWidth;
    if (exif?.ImageLength != null) result.height = result.height || exif.ImageLength;
    if (exif?.Orientation != null) result.orientation = exif.Orientation;
    if (exif?.ColorSpace != null) result.colorSpace = exif.ColorSpace;

    // GPS/Location from EXIF
    if (exif?.GPSLatitude != null) result.gpsLatitude = exif.GPSLatitude;
    if (exif?.GPSLongitude != null) result.gpsLongitude = exif.GPSLongitude;
    if (exif?.GPSAltitude != null) result.gpsAltitude = exif.GPSAltitude;
    if (exif?.GPSTimeStamp != null) result.gpsTimestamp = exif.GPSTimeStamp;
    
    // Fallback to asset location
    if (asset?.location) {
      if (result.gpsLatitude == null && asset.location.latitude != null) {
        result.gpsLatitude = asset.location.latitude;
      }
      if (result.gpsLongitude == null && asset.location.longitude != null) {
        result.gpsLongitude = asset.location.longitude;
      }
    }

    // Software/lens info
    if (exif?.Software) result.software = String(exif.Software).trim();
    if (exif?.LensMake) result.lensMake = String(exif.LensMake).trim();
    if (exif?.LensModel) result.lensModel = String(exif.LensModel).trim();

    // Store raw EXIF for any fields we might have missed
    // Filter out very large or binary fields
    if (exif && typeof exif === 'object') {
      const rawExif = {};
      for (const [key, value] of Object.entries(exif)) {
        if (value == null) continue;
        if (typeof value === 'string' && value.length > 500) continue; // Skip large strings
        if (ArrayBuffer.isView(value)) continue; // Skip binary data
        rawExif[key] = value;
      }
      if (Object.keys(rawExif).length > 0) {
        result.rawExif = rawExif;
      }
    }
  } catch (e) {
    console.warn('extractFullExif error:', e?.message);
  }

  return result;
}

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
