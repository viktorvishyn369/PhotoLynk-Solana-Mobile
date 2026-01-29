package com.photolynk.solana

import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.*
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.text.SimpleDateFormat
import java.util.Locale

class ExifExtractorModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "ExifExtractor"

    @ReactMethod
    fun extractExif(path: String, promise: Promise) {
        Thread {
            try {
                val filePath = if (path.startsWith("file://")) path.removePrefix("file://") else path
                val isContentUri = path.startsWith("content://")
                
                val exif: ExifInterface? = if (isContentUri) {
                    val inputStream: InputStream? = reactApplicationContext.contentResolver.openInputStream(Uri.parse(path))
                    if (inputStream != null) {
                        ExifInterface(inputStream).also { inputStream.close() }
                    } else null
                } else {
                    val file = File(filePath)
                    if (file.exists()) ExifInterface(file) else null
                }
                
                if (exif == null) {
                    promise.reject("E_FILE", "Cannot open file: $path")
                    return@Thread
                }
                
                val result = Arguments.createMap()
                
                // Extract DateTimeOriginal (most reliable capture time)
                var captureTime: String? = null
                val dateTimeOriginal = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL)
                val dateTimeDigitized = exif.getAttribute(ExifInterface.TAG_DATETIME_DIGITIZED)
                val dateTime = exif.getAttribute(ExifInterface.TAG_DATETIME)
                
                val rawDateTime = dateTimeOriginal ?: dateTimeDigitized ?: dateTime
                if (rawDateTime != null) {
                    captureTime = normalizeExifDateTime(rawDateTime)
                }
                
                // Extract Make (manufacturer) - normalize to lowercase
                val make = exif.getAttribute(ExifInterface.TAG_MAKE)?.trim()?.lowercase(Locale.ROOT)
                
                // Extract Model - normalize to lowercase
                val model = exif.getAttribute(ExifInterface.TAG_MODEL)?.trim()?.lowercase(Locale.ROOT)
                
                result.putString("captureTime", captureTime)
                result.putString("make", make)
                result.putString("model", model)
                
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("E_EXIF", "EXIF extraction failed: ${e.message}")
            }
        }.start()
    }
    
    // Normalize EXIF date format "YYYY:MM:DD HH:MM:SS" to ISO format "YYYY-MM-DDTHH:MM:SS"
    private fun normalizeExifDateTime(exifDate: String): String? {
        // EXIF format: "2024:01:15 14:30:45"
        // Target format: "2024-01-15T14:30:45"
        val trimmed = exifDate.trim()
        if (trimmed.length < 19) return null
        
        val parts = trimmed.split(" ")
        if (parts.size < 2) return null
        
        val datePart = parts[0].replace(":", "-")
        val timePart = parts[1].take(8) // Only take HH:MM:SS
        
        return "${datePart}T${timePart}"
    }
    
    // Convert ISO date format "YYYY-MM-DDTHH:MM:SS" back to EXIF format "YYYY:MM:DD HH:MM:SS"
    private fun isoToExifDateTime(isoDate: String): String? {
        val trimmed = isoDate.trim()
        if (trimmed.length < 19) return null
        
        // ISO format: "2024-01-15T14:30:45"
        // EXIF format: "2024:01:15 14:30:45"
        val result = trimmed.take(19).replace("-", ":").replace("T", " ")
        return result
    }
    
    @ReactMethod
    fun writeExif(path: String, exifData: ReadableMap, promise: Promise) {
        Thread {
            try {
                val filePath = if (path.startsWith("file://")) path.removePrefix("file://") else path
                val file = File(filePath)
                
                if (!file.exists()) {
                    promise.reject("E_FILE", "File does not exist: $path")
                    return@Thread
                }
                
                val exif = ExifInterface(file)
                
                // Apply EXIF data from input
                if (exifData.hasKey("captureTime")) {
                    val captureTime = exifData.getString("captureTime")
                    if (captureTime != null) {
                        val exifTime = isoToExifDateTime(captureTime)
                        if (exifTime != null) {
                            exif.setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL, exifTime)
                            exif.setAttribute(ExifInterface.TAG_DATETIME_DIGITIZED, exifTime)
                            exif.setAttribute(ExifInterface.TAG_DATETIME, exifTime)
                        }
                    }
                }
                
                // Timezone offset (EXIF 2.31+) - critical for cross-platform time sorting
                if (exifData.hasKey("offsetTimeOriginal")) {
                    val offsetTime = exifData.getString("offsetTimeOriginal")
                    if (offsetTime != null) {
                        exif.setAttribute(ExifInterface.TAG_OFFSET_TIME_ORIGINAL, offsetTime)
                        exif.setAttribute(ExifInterface.TAG_OFFSET_TIME_DIGITIZED, offsetTime)
                        exif.setAttribute(ExifInterface.TAG_OFFSET_TIME, offsetTime)
                    }
                }
                
                // Subsecond precision
                if (exifData.hasKey("subSecTimeOriginal")) {
                    val subSecTime = exifData.getString("subSecTimeOriginal")
                    if (subSecTime != null) {
                        exif.setAttribute(ExifInterface.TAG_SUBSEC_TIME_ORIGINAL, subSecTime)
                        exif.setAttribute(ExifInterface.TAG_SUBSEC_TIME_DIGITIZED, subSecTime)
                        exif.setAttribute(ExifInterface.TAG_SUBSEC_TIME, subSecTime)
                    }
                }
                
                if (exifData.hasKey("make")) {
                    val make = exifData.getString("make")
                    if (make != null) {
                        exif.setAttribute(ExifInterface.TAG_MAKE, make)
                    }
                }
                
                if (exifData.hasKey("model")) {
                    val model = exifData.getString("model")
                    if (model != null) {
                        exif.setAttribute(ExifInterface.TAG_MODEL, model)
                    }
                }
                
                // Camera settings
                if (exifData.hasKey("exposureTime")) {
                    val exposureTime = exifData.getDouble("exposureTime")
                    exif.setAttribute(ExifInterface.TAG_EXPOSURE_TIME, exposureTime.toString())
                }
                
                if (exifData.hasKey("fNumber")) {
                    val fNumber = exifData.getDouble("fNumber")
                    exif.setAttribute(ExifInterface.TAG_F_NUMBER, fNumber.toString())
                }
                
                if (exifData.hasKey("iso")) {
                    val iso = exifData.getInt("iso")
                    exif.setAttribute(ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY, iso.toString())
                }
                
                if (exifData.hasKey("focalLength")) {
                    val focalLength = exifData.getDouble("focalLength")
                    // EXIF stores focal length as rational (numerator/denominator)
                    val rational = "${(focalLength * 100).toInt()}/100"
                    exif.setAttribute(ExifInterface.TAG_FOCAL_LENGTH, rational)
                }
                
                if (exifData.hasKey("focalLengthIn35mm")) {
                    val focalLengthIn35mm = exifData.getInt("focalLengthIn35mm")
                    exif.setAttribute(ExifInterface.TAG_FOCAL_LENGTH_IN_35MM_FILM, focalLengthIn35mm.toString())
                }
                
                // GPS data
                if (exifData.hasKey("gpsLatitude") && exifData.hasKey("gpsLongitude")) {
                    val lat = exifData.getDouble("gpsLatitude")
                    val lon = exifData.getDouble("gpsLongitude")
                    exif.setLatLong(lat, lon)
                }
                
                if (exifData.hasKey("gpsAltitude")) {
                    val alt = exifData.getDouble("gpsAltitude")
                    exif.setAltitude(alt)
                }
                
                // Software
                if (exifData.hasKey("software")) {
                    val software = exifData.getString("software")
                    if (software != null) {
                        exif.setAttribute(ExifInterface.TAG_SOFTWARE, software)
                    }
                }
                
                // Orientation
                if (exifData.hasKey("orientation")) {
                    val orientation = exifData.getInt("orientation")
                    exif.setAttribute(ExifInterface.TAG_ORIENTATION, orientation.toString())
                }
                
                // Save the changes
                exif.saveAttributes()
                
                val result = Arguments.createMap()
                result.putBoolean("success", true)
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("E_WRITE", "Failed to write EXIF: ${e.message}")
            }
        }.start()
    }
}
