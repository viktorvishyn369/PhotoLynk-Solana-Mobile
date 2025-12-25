package com.photosync.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.*
import java.io.InputStream
import java.security.MessageDigest

class PixelHashModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "PixelHash"

    @ReactMethod
    fun hashImagePixels(path: String, promise: Promise) {
        try {
            val inputStream: InputStream? = if (path.startsWith("content://")) {
                reactApplicationContext.contentResolver.openInputStream(Uri.parse(path))
            } else {
                val filePath = if (path.startsWith("file://")) path.removePrefix("file://") else path
                java.io.FileInputStream(filePath)
            }

            if (inputStream == null) {
                promise.reject("E_FILE", "Cannot open file: $path")
                return
            }

            val digest = MessageDigest.getInstance("SHA-256")
            inputStream.use { ins ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = ins.read(buffer)
                    if (read <= 0) break
                    digest.update(buffer, 0, read)
                }
            }

            val hashBytes = digest.digest()
            val hexString = hashBytes.joinToString("") { "%02x".format(it) }
            promise.resolve(hexString)
        } catch (e: Exception) {
            promise.reject("E_HASH", "Failed to hash image: ${e.message}", e)
        }
    }

    @ReactMethod
    fun hashImagePerceptual(path: String, promise: Promise) {
        Thread {
            var originalBitmap: Bitmap? = null
            var resized: Bitmap? = null
            try {
                val inputStream: InputStream? = if (path.startsWith("content://")) {
                    reactApplicationContext.contentResolver.openInputStream(Uri.parse(path))
                } else {
                    val filePath = if (path.startsWith("file://")) path.removePrefix("file://") else path
                    java.io.FileInputStream(filePath)
                }

                if (inputStream == null) {
                    promise.reject("E_FILE", "Cannot open file: $path")
                    return@Thread
                }

                val options = BitmapFactory.Options().apply {
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                    inSampleSize = 1
                }
                
                // First pass: get dimensions
                options.inJustDecodeBounds = true
                BitmapFactory.decodeStream(inputStream, null, options)
                inputStream.close()
                
                // Calculate sample size to avoid OOM
                val maxDim = maxOf(options.outWidth, options.outHeight)
                var sampleSize = 1
                while (maxDim / sampleSize > 1024) {
                    sampleSize *= 2
                }
                
                // Second pass: decode with sample size
                val inputStream2: InputStream? = if (path.startsWith("content://")) {
                    reactApplicationContext.contentResolver.openInputStream(Uri.parse(path))
                } else {
                    val filePath = if (path.startsWith("file://")) path.removePrefix("file://") else path
                    java.io.FileInputStream(filePath)
                }
                
                if (inputStream2 == null) {
                    promise.reject("E_FILE", "Cannot reopen file: $path")
                    return@Thread
                }
                
                options.inJustDecodeBounds = false
                options.inSampleSize = sampleSize
                originalBitmap = BitmapFactory.decodeStream(inputStream2, null, options)
                inputStream2.close()

                if (originalBitmap == null) {
                    promise.reject("E_DECODE", "Cannot decode image: $path")
                    return@Thread
                }

                try {
                    val orientation = readExifOrientation(path)
                    val bmp0 = originalBitmap!!
                    val rotated = applyExifOrientation(bmp0, orientation)
                    if (rotated !== bmp0) {
                        bmp0.recycle()
                    }
                    originalBitmap = rotated
                } catch (e: Exception) {
                    // ignore
                }

                val ob = originalBitmap!!

                // Edge-inset crop (~10% on each side) to reduce UI overlays/borders affecting hashes
                val origW0 = ob.width
                val origH0 = ob.height
                var insetX = (origW0 * 0.10).toInt().coerceAtLeast(0)
                var insetY = (origH0 * 0.10).toInt().coerceAtLeast(0)
                insetX = insetX.coerceAtMost(((origW0 - 1) / 2).coerceAtLeast(0))
                insetY = insetY.coerceAtMost(((origH0 - 1) / 2).coerceAtLeast(0))
                val baseW = (origW0 - insetX * 2).coerceAtLeast(1)
                val baseH = (origH0 - insetY * 2).coerceAtLeast(1)
                val base = Bitmap.createBitmap(ob, insetX, insetY, baseW, baseH)
                ob.recycle()
                originalBitmap = null

                val cropRatio = 0.70
                val origW = base.width
                val origH = base.height
                val cropW = (origW * cropRatio).toInt().coerceAtLeast(1)
                val cropH = (origH * cropRatio).toInt().coerceAtLeast(1)
                val cropX = ((origW - cropW) / 2).coerceAtLeast(0)
                val cropY = ((origH - cropH) / 2).coerceAtLeast(0)
                val shiftUp = (origH * 0.10).toInt()
                var cropY2 = (cropY - shiftUp).coerceAtLeast(0)
                if (cropY2 + cropH > origH) cropY2 = (origH - cropH).coerceAtLeast(0)

                val cropRatio3 = 0.50
                val cropW3 = (origW * cropRatio3).toInt().coerceAtLeast(1)
                val cropH3 = (origH * cropRatio3).toInt().coerceAtLeast(1)
                val cropX3 = ((origW - cropW3) / 2).coerceAtLeast(0)
                val cropY3 = ((origH - cropH3) / 2).coerceAtLeast(0)

                val cropped1 = Bitmap.createBitmap(base, cropX, cropY, cropW, cropH)
                val cropped2 = Bitmap.createBitmap(base, cropX, cropY2, cropW, cropH)
                val cropped3 = Bitmap.createBitmap(base, cropX3, cropY3, cropW3, cropH3)
                base.recycle()

                val r1 = computePerceptualFromCropped(cropped1)
                val r2 = computePerceptualFromCropped(cropped2)
                val r3 = computePerceptualFromCropped(cropped3)

                val result = Arguments.createMap().apply {
                    putString("pHash", r1.pHash)
                    putString("dHash", r1.dHash)
                    putDouble("avgBrightness", r1.avgBrightness)
                    putDouble("blackRatio", r1.blackRatio)
                    putDouble("whiteRatio", r1.whiteRatio)
                    putDouble("avgRed", r1.avgRed)
                    putDouble("avgGreen", r1.avgGreen)
                    putDouble("avgBlue", r1.avgBlue)
                    putString("pHash2", r2.pHash)
                    putString("dHash2", r2.dHash)
                    putDouble("avgBrightness2", r2.avgBrightness)
                    putDouble("blackRatio2", r2.blackRatio)
                    putDouble("whiteRatio2", r2.whiteRatio)
                    putDouble("avgRed2", r2.avgRed)
                    putDouble("avgGreen2", r2.avgGreen)
                    putDouble("avgBlue2", r2.avgBlue)
                    putString("pHash3", r3.pHash)
                    putString("dHash3", r3.dHash)
                    putDouble("avgBrightness3", r3.avgBrightness)
                    putDouble("blackRatio3", r3.blackRatio)
                    putDouble("whiteRatio3", r3.whiteRatio)
                    putDouble("avgRed3", r3.avgRed)
                    putDouble("avgGreen3", r3.avgGreen)
                    putDouble("avgBlue3", r3.avgBlue)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                originalBitmap?.recycle()
                resized?.recycle()
                promise.reject("E_PERCEPTUAL", "Failed to compute perceptual hash: ${e.message}", e)
            }
        }.start()
    }

    private data class PerceptualResult(
        val pHash: String,
        val dHash: String,
        val avgBrightness: Double,
        val blackRatio: Double,
        val whiteRatio: Double,
        val avgRed: Double,
        val avgGreen: Double,
        val avgBlue: Double
    )

    private fun computePerceptualFromCropped(cropped: Bitmap): PerceptualResult {
        val resized = Bitmap.createScaledBitmap(cropped, 32, 32, true)
        cropped.recycle()

        val width = resized.width
        val height = resized.height
        val grayscale = Array(height) { DoubleArray(width) }
        var totalBrightness = 0.0
        var totalRed = 0.0
        var totalGreen = 0.0
        var totalBlue = 0.0
        var blackCount = 0
        var whiteCount = 0

        for (y in 0 until height) {
            for (x in 0 until width) {
                val pixel = resized.getPixel(x, y)
                val r = Color.red(pixel)
                val g = Color.green(pixel)
                val b = Color.blue(pixel)
                val gray = 0.299 * r + 0.587 * g + 0.114 * b
                grayscale[y][x] = gray
                totalBrightness += gray
                totalRed += r
                totalGreen += g
                totalBlue += b
                if (gray < 10) blackCount++
                if (gray > 245) whiteCount++
            }
        }
        resized.recycle()

        val pixelCount = (width * height).toDouble()
        val avgBrightness = totalBrightness / pixelCount
        val blackRatio = blackCount.toDouble() / pixelCount
        val whiteRatio = whiteCount.toDouble() / pixelCount
        val avgRed = totalRed / pixelCount / 255.0
        val avgGreen = totalGreen / pixelCount / 255.0
        val avgBlue = totalBlue / pixelCount / 255.0

        val dctSize = 8
        val dctValues = DoubleArray(dctSize * dctSize)
        for (u in 0 until dctSize) {
            for (v in 0 until dctSize) {
                var sum = 0.0
                for (yy in 0 until dctSize) {
                    for (xx in 0 until dctSize) {
                        sum += grayscale[yy][xx] *
                                Math.cos((2 * xx + 1) * u * Math.PI / 16) *
                                Math.cos((2 * yy + 1) * v * Math.PI / 16)
                    }
                }
                dctValues[u * dctSize + v] = sum
            }
        }

        val dctForMedian = dctValues.drop(1).sorted()
        val median = if (dctForMedian.isNotEmpty()) dctForMedian[dctForMedian.size / 2] else 0.0

        var pHashBits: Long = 0
        for (i in 1 until minOf(65, dctValues.size)) {
            if (dctValues[i] > median) {
                pHashBits = pHashBits or (1L shl (i - 1))
            }
        }
        val pHash = String.format("%016x", pHashBits)

        var dHashBits: Long = 0
        var bitIndex = 0
        for (y in 0 until 8) {
            for (x in 0 until 8) {
                if (grayscale[y][x] < grayscale[y][x + 1]) {
                    dHashBits = dHashBits or (1L shl bitIndex)
                }
                bitIndex++
            }
        }
        val dHash = String.format("%016x", dHashBits)

        return PerceptualResult(
            pHash = pHash,
            dHash = dHash,
            avgBrightness = avgBrightness,
            blackRatio = blackRatio,
            whiteRatio = whiteRatio,
            avgRed = avgRed,
            avgGreen = avgGreen,
            avgBlue = avgBlue
        )
    }

    private fun readExifOrientation(path: String): Int {
        return if (path.startsWith("content://")) {
            val ins = reactApplicationContext.contentResolver.openInputStream(Uri.parse(path))
            if (ins == null) {
                ExifInterface.ORIENTATION_UNDEFINED
            } else {
                ins.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
            }
        } else {
            val filePath = if (path.startsWith("file://")) path.removePrefix("file://") else path
            ExifInterface(filePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        }
    }

    private fun applyExifOrientation(src: Bitmap, orientation: Int): Bitmap {
        val m = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> m.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> {
                m.setRotate(180f)
                m.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                m.setRotate(90f)
                m.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> m.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                m.setRotate(-90f)
                m.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> m.setRotate(-90f)
            else -> return src
        }

        return Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true)
    }
}
