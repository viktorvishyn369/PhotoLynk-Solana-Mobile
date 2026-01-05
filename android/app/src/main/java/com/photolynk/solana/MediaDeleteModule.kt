package com.photolynk.solana

import android.app.Activity
import android.content.ContentUris
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.facebook.react.bridge.*

class MediaDeleteModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val activityEventListener: ActivityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: android.content.Intent?) {
            if (requestCode != DELETE_REQUEST_CODE) return

            val p = pendingDeletePromise
            pendingDeletePromise = null
            if (p == null) return

            if (resultCode == Activity.RESULT_OK) {
                p.resolve(true)
            } else {
                // user cancelled or system denied
                p.resolve(false)
            }
        }
    }

    init {
        reactContext.addActivityEventListener(activityEventListener)
    }

    override fun getName(): String = "MediaDelete"

    @ReactMethod
    fun deleteAssets(assetIds: ReadableArray, promise: Promise) {
        try {
            val activity = currentActivity
            if (activity == null) {
                promise.reject("E_ACTIVITY", "Activity is null")
                return
            }

            val uris = mutableListOf<Uri>()
            
            for (i in 0 until assetIds.size()) {
                val assetId = assetIds.getString(i) ?: continue
                
                // Try to find the content URI for this asset ID
                val uri = findContentUri(assetId)
                if (uri != null) {
                    uris.add(uri)
                }
            }

            if (uris.isEmpty()) {
                promise.resolve(true)
                return
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                if (pendingDeletePromise != null) {
                    promise.reject("E_BUSY", "A delete request is already in progress")
                    return
                }
                // Android 11+ uses createDeleteRequest
                val pendingIntent = MediaStore.createDeleteRequest(
                    reactApplicationContext.contentResolver,
                    uris
                )
                activity.startIntentSenderForResult(
                    pendingIntent.intentSender,
                    DELETE_REQUEST_CODE,
                    null, 0, 0, 0
                )
                // Store promise to resolve later
                pendingDeletePromise = promise
            } else {
                // Android 10 and below - delete directly
                var deleted = 0
                for (uri in uris) {
                    try {
                        val rows = reactApplicationContext.contentResolver.delete(uri, null, null)
                        if (rows > 0) deleted++
                    } catch (e: Exception) {
                        // Continue with other files
                    }
                }
                promise.resolve(deleted > 0)
            }
        } catch (e: Exception) {
            promise.reject("E_DELETE", "Failed to delete assets: ${e.message}", e)
        }
    }

    private fun findContentUri(assetId: String): Uri? {
        // Try images first
        val imageUri = findInCollection(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, assetId)
        if (imageUri != null) return imageUri

        // Try videos
        val videoUri = findInCollection(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, assetId)
        if (videoUri != null) return videoUri

        return null
    }

    private fun findInCollection(collectionUri: Uri, assetId: String): Uri? {
        try {
            // Asset ID from expo-media-library is typically the numeric ID
            val numericId = assetId.toLongOrNull()
            if (numericId != null) {
                return ContentUris.withAppendedId(collectionUri, numericId)
            }

            // If not numeric, try to query by _ID
            val cursor = reactApplicationContext.contentResolver.query(
                collectionUri,
                arrayOf(MediaStore.MediaColumns._ID),
                "${MediaStore.MediaColumns._ID} = ?",
                arrayOf(assetId),
                null
            )

            cursor?.use {
                if (it.moveToFirst()) {
                    val id = it.getLong(it.getColumnIndexOrThrow(MediaStore.MediaColumns._ID))
                    return ContentUris.withAppendedId(collectionUri, id)
                }
            }
        } catch (e: Exception) {
            // Ignore and return null
        }
        return null
    }

    companion object {
        const val DELETE_REQUEST_CODE = 42069
        var pendingDeletePromise: Promise? = null
    }
}
