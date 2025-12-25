import Foundation
import Photos
import React

@objc(MediaDelete)
class MediaDeleteModule: NSObject {
  
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
  
  @objc
  func deleteAssets(_ assetIds: [String], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    
    let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: assetIds, options: nil)
    
    if fetchResult.count == 0 {
      resolve(true)
      return
    }
    
    var assetsToDelete: [PHAsset] = []
    fetchResult.enumerateObjects { asset, _, _ in
      assetsToDelete.append(asset)
    }
    
    PHPhotoLibrary.shared().performChanges({
      PHAssetChangeRequest.deleteAssets(assetsToDelete as NSFastEnumeration)
    }) { success, error in
      if success {
        resolve(true)
      } else if let error = error {
        reject("E_DELETE", "Failed to delete assets: \(error.localizedDescription)", error)
      } else {
        resolve(false)
      }
    }
  }
}
