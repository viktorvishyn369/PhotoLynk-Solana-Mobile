package com.photolynk.solana

import android.app.Activity
import android.content.ContentUris
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Log
import com.facebook.react.bridge.*

class MediaDeleteModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val activityEventListener: ActivityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: android.content.Intent?) {
            Log.d("MediaDelete", "onActivityResult: requestCode=$requestCode, resultCode=$resultCode")
            if (requestCode != DELETE_REQUEST_CODE) return

            val p = pendingDeletePromise
            pendingDeletePromise = null
            if (p == null) {
                Log.w("MediaDelete", "No pending promise found")
                return
            }

            if (resultCode == Activity.RESULT_OK) {
                Log.d("MediaDelete", "User confirmed deletion")
                p.resolve(true)
            } else {
                Log.d("MediaDelete", "User cancelled or denied deletion")
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
            
            Log.d("MediaDelete", "deleteAssets called with ${assetIds.size()} items")
            
            for (i in 0 until assetIds.size()) {
                val assetId = assetIds.getString(i) ?: continue
                Log.d("MediaDelete", "Processing assetId: $assetId")
                
                // Try to find the content URI for this asset ID
                val uri = findContentUri(assetId)
                if (uri != null) {
                    Log.d("MediaDelete", "Found URI: $uri")
                    uris.add(uri)
                } else {
                    Log.w("MediaDelete", "Could not find URI for assetId: $assetId")
                }
            }

            Log.d("MediaDelete", "Total URIs to delete: ${uris.size}")
            
            if (uris.isEmpty()) {
                Log.e("MediaDelete", "ERROR: No valid URIs found for any asset IDs!")
                promise.reject("E_NOT_FOUND", "No valid media files found for the provided IDs")
                return
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // Android 11+ (API 30+): Use createDeleteRequest for scoped storage
                if (pendingDeletePromise != null) {
                    promise.reject("E_BUSY", "A delete request is already in progress")
                    return
                }
                Log.d("MediaDelete", "Using createDeleteRequest for Android 11+")
                val pendingIntent = MediaStore.createDeleteRequest(
                    reactApplicationContext.contentResolver,
                    uris
                )
                activity.startIntentSenderForResult(
                    pendingIntent.intentSender,
                    DELETE_REQUEST_CODE,
                    null, 0, 0, 0
                )
                pendingDeletePromise = promise
            } else if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) {
                // Android 10 (API 29): Scoped storage but no createDeleteRequest
                // Need to use MediaStore.setRequireOriginal or catch RecoverableSecurityException
                Log.d("MediaDelete", "Android 10: Attempting direct delete with exception handling")
                var deleted = 0
                var needsPermission = false
                for (uri in uris) {
                    try {
                        val rows = reactApplicationContext.contentResolver.delete(uri, null, null)
                        if (rows > 0) {
                            deleted++
                            Log.d("MediaDelete", "Deleted: $uri")
                        }
                    } catch (e: android.app.RecoverableSecurityException) {
                        // Android 10 requires user permission for each file
                        Log.w("MediaDelete", "RecoverableSecurityException for $uri - needs user permission")
                        needsPermission = true
                    } catch (e: SecurityException) {
                        Log.w("MediaDelete", "SecurityException for $uri: ${e.message}")
                    } catch (e: Exception) {
                        Log.e("MediaDelete", "Delete error for $uri: ${e.message}")
                    }
                }
                if (needsPermission) {
                    // On Android 10, we can't batch permission requests easily
                    // Return partial success
                    Log.w("MediaDelete", "Some files need permission on Android 10")
                }
                promise.resolve(deleted > 0)
            } else {
                // Android 7-9 (API 24-28): Direct delete works
                Log.d("MediaDelete", "Android 7-9: Direct delete")
                var deleted = 0
                for (uri in uris) {
                    try {
                        val rows = reactApplicationContext.contentResolver.delete(uri, null, null)
                        if (rows > 0) {
                            deleted++
                            Log.d("MediaDelete", "Deleted: $uri")
                        } else {
                            Log.w("MediaDelete", "Delete returned 0 rows for: $uri")
                        }
                    } catch (e: Exception) {
                        Log.e("MediaDelete", "Delete error for $uri: ${e.message}")
                    }
                }
                promise.resolve(deleted > 0)
            }
        } catch (e: Exception) {
            promise.reject("E_DELETE", "Failed to delete assets: ${e.message}", e)
        }
    }

    private fun findContentUri(assetId: String): Uri? {
        // expo-media-library asset IDs on Android can be:
        // 1. Just a numeric ID like "1234"
        // 2. A content URI like "content://media/external/images/media/1234"
        // 3. A path-based ID
        
        // If it's already a content URI, parse it directly
        if (assetId.startsWith("content://")) {
            return Uri.parse(assetId)
        }
        
        // Extract numeric ID - expo sometimes uses format like "1234" or includes path
        val numericId = assetId.filter { it.isDigit() }.toLongOrNull()
        
        if (numericId != null) {
            // Check if this ID exists in images
            if (existsInCollection(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, numericId)) {
                return ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, numericId)
            }
            // Check if this ID exists in videos
            if (existsInCollection(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, numericId)) {
                return ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, numericId)
            }
            // If not found but we have a numeric ID, try images as default
            return ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, numericId)
        }

        return null
    }

    private fun existsInCollection(collectionUri: Uri, id: Long): Boolean {
        try {
            // Query the collection with a WHERE clause for the specific ID
            val cursor = reactApplicationContext.contentResolver.query(
                collectionUri,
                arrayOf(MediaStore.MediaColumns._ID),
                "${MediaStore.MediaColumns._ID} = ?",
                arrayOf(id.toString()),
                null
            )
            cursor?.use {
                val exists = it.moveToFirst()
                Log.d("MediaDelete", "existsInCollection($collectionUri, $id) = $exists")
                return exists
            }
        } catch (e: Exception) {
            Log.e("MediaDelete", "existsInCollection error: ${e.message}")
        }
        return false
    }

    companion object {
        const val DELETE_REQUEST_CODE = 42069
        var pendingDeletePromise: Promise? = null
    }
}
