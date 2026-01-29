import Foundation
import Photos
import React

@objc(MediaDelete)
class MediaDeleteModule: NSObject {
  
  private let deletedAlbumName = "PhotoLynkDeleted"
  
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }
  
  // Find or create the PhotoLynkDeleted album
  private func getOrCreateDeletedAlbum(completion: @escaping (PHAssetCollection?) -> Void) {
    // Search for existing album
    let fetchOptions = PHFetchOptions()
    fetchOptions.predicate = NSPredicate(format: "title = %@", deletedAlbumName)
    let collections = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: fetchOptions)
    
    if let existingAlbum = collections.firstObject {
      print("[MediaDelete] Found existing PhotoLynkDeleted album")
      completion(existingAlbum)
      return
    }
    
    // Create new album
    print("[MediaDelete] Creating PhotoLynkDeleted album...")
    var albumPlaceholder: PHObjectPlaceholder?
    
    PHPhotoLibrary.shared().performChanges({
      let createRequest = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: self.deletedAlbumName)
      albumPlaceholder = createRequest.placeholderForCreatedAssetCollection
    }) { success, error in
      if success, let placeholder = albumPlaceholder {
        let fetchResult = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [placeholder.localIdentifier], options: nil)
        print("[MediaDelete] Successfully created PhotoLynkDeleted album")
        completion(fetchResult.firstObject)
      } else {
        print("[MediaDelete] Failed to create album: \(error?.localizedDescription ?? "unknown")")
        completion(nil)
      }
    }
  }
  
  // Copy assets to the deleted album
  private func copyAssetsToDeletedAlbum(_ assets: [PHAsset], album: PHAssetCollection, completion: @escaping (Bool) -> Void) {
    print("[MediaDelete] Copying \(assets.count) assets to PhotoLynkDeleted album...")
    
    PHPhotoLibrary.shared().performChanges({
      guard let albumChangeRequest = PHAssetCollectionChangeRequest(for: album) else {
        print("[MediaDelete] Failed to create album change request")
        return
      }
      albumChangeRequest.addAssets(assets as NSFastEnumeration)
    }) { success, error in
      if success {
        print("[MediaDelete] Successfully added \(assets.count) assets to PhotoLynkDeleted album")
      } else {
        print("[MediaDelete] Failed to add assets to album: \(error?.localizedDescription ?? "unknown")")
      }
      completion(success)
    }
  }
  
  @objc
  func deleteAssets(_ assetIds: [String], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    
    print("[MediaDelete] deleteAssets called with \(assetIds.count) IDs")
    
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
        assetsToDelete.append(asset)
      }
      
      // Step 1: Get or create the PhotoLynkDeleted album
      self.getOrCreateDeletedAlbum { album in
        guard let deletedAlbum = album else {
          print("[MediaDelete] Could not get/create PhotoLynkDeleted album, proceeding with direct delete")
          self.performDelete(assets: assetsToDelete, resolve: resolve, reject: reject)
          return
        }
        
        // Step 2: Copy assets to the deleted album first
        self.copyAssetsToDeletedAlbum(assetsToDelete, album: deletedAlbum) { copySuccess in
          if copySuccess {
            print("[MediaDelete] Assets copied to PhotoLynkDeleted, now deleting originals...")
          } else {
            print("[MediaDelete] Copy failed, but proceeding with delete anyway")
          }
          
          // Step 3: Delete the original assets (with user confirmation dialog)
          self.performDelete(assets: assetsToDelete, resolve: resolve, reject: reject)
        }
      }
    }
  }
  
  private func performDelete(assets: [PHAsset], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    print("[MediaDelete] Requesting deletion of \(assets.count) assets...")
    
    PHPhotoLibrary.shared().performChanges({
      PHAssetChangeRequest.deleteAssets(assets as NSFastEnumeration)
    }) { success, error in
      print("[MediaDelete] performChanges completed: success=\(success), error=\(String(describing: error))")
      if success {
        print("[MediaDelete] Successfully deleted \(assets.count) assets")
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
