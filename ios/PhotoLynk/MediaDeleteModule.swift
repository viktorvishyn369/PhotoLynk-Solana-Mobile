import Foundation
import Photos
import React

@objc(MediaDelete)
class MediaDeleteModule: NSObject {
  
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }
  
  @objc
  func deleteAssets(_ assetIds: [String], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    
    print("[MediaDelete] deleteAssets called with \(assetIds.count) IDs")
    
    // Log first few IDs for debugging
    for (index, id) in assetIds.prefix(3).enumerated() {
      print("[MediaDelete] ID[\(index)]: \(id)")
    }
    
    // Run on background queue to allow semaphore waiting
    DispatchQueue.global(qos: .userInitiated).async {
      // expo-media-library on iOS returns IDs in format like:
      // "ph://CC95F08C-88C3-4012-9D6D-64A413D254B3/L0/001" or just the UUID part
      // PHAsset.fetchAssets expects the UUID part only (localIdentifier)
      
      // Clean up IDs - extract just the UUID/localIdentifier part
      let cleanedIds = assetIds.map { id -> String in
        // If it starts with "ph://", extract the UUID part
        if id.hasPrefix("ph://") {
          let withoutPrefix = String(id.dropFirst(5))
          // Take everything before the first "/" after the UUID
          if let slashIndex = withoutPrefix.firstIndex(of: "/") {
            return String(withoutPrefix[..<slashIndex])
          }
          return withoutPrefix
        }
        // If it contains "/", it might be in format "UUID/L0/001"
        if let slashIndex = id.firstIndex(of: "/") {
          return String(id[..<slashIndex])
        }
        return id
      }
      
      print("[MediaDelete] Cleaned IDs (first 3):")
      for (index, id) in cleanedIds.prefix(3).enumerated() {
        print("[MediaDelete] CleanedID[\(index)]: \(id)")
      }
      
      let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: cleanedIds, options: nil)
      
      print("[MediaDelete] Fetched \(fetchResult.count) assets from \(assetIds.count) IDs")
      
      if fetchResult.count == 0 {
        print("[MediaDelete] ERROR: No assets found for provided IDs!")
        print("[MediaDelete] Original IDs: \(assetIds.prefix(5))")
        print("[MediaDelete] Cleaned IDs: \(cleanedIds.prefix(5))")
        DispatchQueue.main.async {
          reject("E_NOT_FOUND", "No assets found for the provided IDs", nil)
        }
        return
      }
      
      var assetsToDelete: [PHAsset] = []
      fetchResult.enumerateObjects { asset, _, _ in
        assetsToDelete.append(asset)
      }
      
      // Delete assets - iOS will move them to Recently Deleted (trash)
      // User can recover for 30 days from Photos app > Recently Deleted
      // Note: On iOS, we cannot copy photos to a custom album before deletion
      // because addAssets only adds references, not copies.
      print("[MediaDelete] Requesting deletion of \(assetsToDelete.count) assets to Recently Deleted...")
      
      let deleteSemaphore = DispatchSemaphore(value: 0)
      var deleteSuccess = false
      var deleteError: Error?
      
      PHPhotoLibrary.shared().performChanges({
        PHAssetChangeRequest.deleteAssets(assetsToDelete as NSFastEnumeration)
      }) { success, error in
        deleteSuccess = success
        deleteError = error
        print("[MediaDelete] performChanges completed: success=\(success), error=\(String(describing: error))")
        deleteSemaphore.signal()
      }
      
      _ = deleteSemaphore.wait(timeout: .now() + 60.0)
      
      DispatchQueue.main.async {
        if deleteSuccess {
          print("[MediaDelete] Successfully deleted \(assetsToDelete.count) assets to Recently Deleted")
          resolve(assetsToDelete.count)
        } else if let error = deleteError {
          print("[MediaDelete] Delete failed with error: \(error.localizedDescription)")
          reject("E_DELETE", "Failed to delete assets: \(error.localizedDescription)", error)
        } else {
          print("[MediaDelete] User cancelled deletion")
          resolve(0)
        }
      }
    }
  }
}
