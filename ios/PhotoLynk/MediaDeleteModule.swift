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
    print("[MediaDelete] Asset IDs: \(assetIds)")
    
    // Must run on main queue for PHPhotoLibrary
    DispatchQueue.main.async {
      let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: assetIds, options: nil)
      
      print("[MediaDelete] Fetched \(fetchResult.count) assets from \(assetIds.count) IDs")
      
      if fetchResult.count == 0 {
        print("[MediaDelete] ERROR: No assets found for provided IDs!")
        reject("E_NOT_FOUND", "No assets found for the provided IDs", nil)
        return
      }
      
      var assetsToDelete: [PHAsset] = []
      fetchResult.enumerateObjects { asset, _, _ in
        print("[MediaDelete] Found asset: \(asset.localIdentifier)")
        assetsToDelete.append(asset)
      }
      
      print("[MediaDelete] Requesting deletion of \(assetsToDelete.count) assets...")
      
      PHPhotoLibrary.shared().performChanges({
        PHAssetChangeRequest.deleteAssets(assetsToDelete as NSFastEnumeration)
      }) { success, error in
        print("[MediaDelete] performChanges completed: success=\(success), error=\(String(describing: error))")
        if success {
          print("[MediaDelete] Successfully deleted \(assetsToDelete.count) assets")
          resolve(true)
        } else if let error = error {
          print("[MediaDelete] Delete failed with error: \(error.localizedDescription)")
          reject("E_DELETE", "Failed to delete assets: \(error.localizedDescription)", error)
        } else {
          print("[MediaDelete] User cancelled deletion")
          resolve(false)
        }
      }
    }
  }
}
