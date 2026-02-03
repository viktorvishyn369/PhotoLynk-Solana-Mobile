/**
 * EXIF Extractor for cross-platform HEIC deduplication and universal EXIF preservation
 * Extracts real EXIF metadata from image files for:
 * 1. Deduplication (captureTime, make, model)
 * 2. Universal preservation (ALL EXIF fields stored on server by file hash)
 */

import { Platform, NativeModules } from 'react-native';
import * as Device from 'expo-device';

const { ExifExtractor } = NativeModules;

/**
 * Normalize GPS coordinate to decimal degrees
 * Handles various formats: decimal, DMS array, DMS string
 * @param {number|Array|string} coord - GPS coordinate in various formats
 * @param {string} ref - Reference direction (N/S for lat, E/W for lon)
 * @returns {number|null} Decimal degrees (negative for S/W)
 */
/**
 * Safely convert a string to ASCII-safe format for EXIF compatibility
 * EXIF Make/Model fields only support ASCII per spec
 * @param {string} str - Input string (may contain Unicode)
 * @returns {string} ASCII-safe string
 */
function toAsciiSafe(str) {
  if (!str || typeof str !== 'string') return str;
  // Keep original if already ASCII
  if (/^[\x00-\x7F]*$/.test(str)) return str;
  // Try to transliterate common characters, otherwise keep original
  // Most camera manufacturers use ASCII names anyway
  return str;
}

/**
 * Safely handle string that may have encoding issues
 * Detects and handles UTF-8, Latin-1, and other encodings
 * @param {any} value - Input value
 * @returns {string|null} Cleaned string or null
 */
function safeString(value) {
  if (value == null) return null;
  if (typeof value !== 'string') {
    // Handle byte arrays that might be strings
    if (ArrayBuffer.isView(value) || Array.isArray(value)) {
      try {
        // Try UTF-8 decoding
        const bytes = new Uint8Array(value);
        const decoder = new TextDecoder('utf-8', { fatal: false });
        return decoder.decode(bytes).replace(/\0/g, '').trim();
      } catch (e) {
        return null;
      }
    }
    return String(value);
  }
  // Clean null bytes and trim
  return value.replace(/\0/g, '').trim();
}

function normalizeGpsCoordinate(coord, ref) {
  if (coord == null) return null;
  
  let decimal = null;
  
  // Already decimal
  if (typeof coord === 'number') {
    decimal = coord;
  }
  // DMS array format: [degrees, minutes, seconds] or [[d,1], [m,1], [s,100]]
  else if (Array.isArray(coord)) {
    if (coord.length >= 3) {
      // Handle rational format [[d,1], [m,1], [s,100]]
      const d = Array.isArray(coord[0]) ? coord[0][0] / coord[0][1] : coord[0];
      const m = Array.isArray(coord[1]) ? coord[1][0] / coord[1][1] : coord[1];
      const s = Array.isArray(coord[2]) ? coord[2][0] / coord[2][1] : coord[2];
      decimal = d + m / 60 + s / 3600;
    } else if (coord.length === 1) {
      decimal = Array.isArray(coord[0]) ? coord[0][0] / coord[0][1] : coord[0];
    }
  }
  // String format: "40/1,26/1,46/1" or "40.446195"
  else if (typeof coord === 'string') {
    const parts = coord.split(',');
    if (parts.length >= 3) {
      // DMS rational string format
      const parseRational = (s) => {
        const [num, den] = s.trim().split('/').map(Number);
        return den ? num / den : num;
      };
      const d = parseRational(parts[0]);
      const m = parseRational(parts[1]);
      const s = parseRational(parts[2]);
      decimal = d + m / 60 + s / 3600;
    } else {
      decimal = parseFloat(coord);
    }
  }
  
  if (decimal == null || isNaN(decimal)) return null;
  
  // Apply direction reference (S and W are negative)
  if (ref === 'S' || ref === 'W') {
    decimal = -Math.abs(decimal);
  }
  
  return decimal;
}

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
    // Timezone/subsecond precision (critical for cross-platform sorting)
    offsetTimeOriginal: null,  // e.g., "+02:00" or "-05:00"
    subSecTimeOriginal: null,  // milliseconds as string, e.g., "123"
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
    // GPS/Location (always stored as decimal degrees for cross-platform compatibility)
    gpsLatitude: null,
    gpsLongitude: null,
    gpsAltitude: null,
    gpsTimestamp: null,
    gpsDateStamp: null,  // GPS date in "YYYY:MM:DD" format
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

    // Device info - use safeString to handle encoding issues (Japanese/Chinese cameras)
    if (exif?.Make) result.make = safeString(exif.Make);
    if (exif?.Model) result.model = safeString(exif.Model);
    
    // Fallback to device info for formats without EXIF (PNG screenshots, etc.)
    // iOS Camera app also doesn't embed Make/Model in photos (privacy feature)
    if (!result.make) {
      if (Platform.OS === 'ios') {
        result.make = 'apple';
      } else if (Device.manufacturer) {
        result.make = Device.manufacturer.toLowerCase();
      }
    }
    if (!result.model) {
      if (Device.modelId) {
        // Device.modelId returns e.g., "iPhone15,2" for iPhone 14 Pro
        result.model = Device.modelId.toLowerCase();
      } else if (Device.modelName) {
        result.model = Device.modelName.toLowerCase();
      }
    }

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

    // Timezone offset (EXIF 2.31+) - critical for cross-platform time sorting
    if (exif?.OffsetTimeOriginal) result.offsetTimeOriginal = String(exif.OffsetTimeOriginal).trim();
    else if (exif?.OffsetTime) result.offsetTimeOriginal = String(exif.OffsetTime).trim();
    
    // Subsecond precision
    if (exif?.SubSecTimeOriginal != null) result.subSecTimeOriginal = String(exif.SubSecTimeOriginal);
    else if (exif?.SubSecTime != null) result.subSecTimeOriginal = String(exif.SubSecTime);

    // GPS/Location from EXIF - normalize to decimal degrees
    if (exif?.GPSLatitude != null) {
      // Handle both decimal and DMS formats
      result.gpsLatitude = normalizeGpsCoordinate(exif.GPSLatitude, exif.GPSLatitudeRef);
    }
    if (exif?.GPSLongitude != null) {
      result.gpsLongitude = normalizeGpsCoordinate(exif.GPSLongitude, exif.GPSLongitudeRef);
    }
    if (exif?.GPSAltitude != null) {
      result.gpsAltitude = typeof exif.GPSAltitude === 'number' ? exif.GPSAltitude : parseFloat(exif.GPSAltitude);
      // Apply altitude ref (0 = above sea level, 1 = below)
      if (exif?.GPSAltitudeRef === 1 && result.gpsAltitude > 0) {
        result.gpsAltitude = -result.gpsAltitude;
      }
    }
    if (exif?.GPSTimeStamp != null) result.gpsTimestamp = exif.GPSTimeStamp;
    if (exif?.GPSDateStamp != null) result.gpsDateStamp = exif.GPSDateStamp;
    
    // Fallback to asset location
    if (asset?.location) {
      if (result.gpsLatitude == null && asset.location.latitude != null) {
        result.gpsLatitude = asset.location.latitude;
      }
      if (result.gpsLongitude == null && asset.location.longitude != null) {
        result.gpsLongitude = asset.location.longitude;
      }
    }

    // Software/lens info - use safeString for international character support
    if (exif?.Software) result.software = safeString(exif.Software);
    if (exif?.LensMake) result.lensMake = safeString(exif.LensMake);
    if (exif?.LensModel) result.lensModel = safeString(exif.LensModel);

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
