package com.photolynk.solana

import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.*
import java.io.File
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
}
