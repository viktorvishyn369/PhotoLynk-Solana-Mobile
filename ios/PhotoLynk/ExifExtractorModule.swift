import Foundation
import UIKit
import ImageIO
import MobileCoreServices
import Photos
import React

@objc(ExifExtractor)
class ExifExtractorModule: NSObject {
  
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
  
  @objc
  func extractExif(_ path: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      autoreleasepool {
        let cleanPath = path.replacingOccurrences(of: "file://", with: "")
        let url = URL(fileURLWithPath: cleanPath)
        
        guard let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil) else {
          reject("E_LOAD", "Cannot load image: \(path)", nil)
          return
        }
        
        guard let properties = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [String: Any] else {
          // No properties found, return empty result
          resolve(["captureTime": NSNull(), "make": NSNull(), "model": NSNull()])
          return
        }
        
        var captureTime: String? = nil
        var make: String? = nil
        var model: String? = nil
        
        // Extract EXIF data
        if let exifDict = properties[kCGImagePropertyExifDictionary as String] as? [String: Any] {
          // DateTimeOriginal is the actual capture time (most reliable)
          if let dateTimeOriginal = exifDict[kCGImagePropertyExifDateTimeOriginal as String] as? String {
            captureTime = self.normalizeExifDateTime(dateTimeOriginal)
          } else if let dateTimeDigitized = exifDict[kCGImagePropertyExifDateTimeDigitized as String] as? String {
            captureTime = self.normalizeExifDateTime(dateTimeDigitized)
          }
        }
        
        // Extract TIFF data (contains Make and Model)
        if let tiffDict = properties[kCGImagePropertyTIFFDictionary as String] as? [String: Any] {
          // Normalize make/model to lowercase trimmed strings for cross-platform matching
          if let makeStr = tiffDict[kCGImagePropertyTIFFMake as String] as? String {
            make = makeStr.trimmingCharacters(in: .whitespaces).lowercased()
          }
          if let modelStr = tiffDict[kCGImagePropertyTIFFModel as String] as? String {
            model = modelStr.trimmingCharacters(in: .whitespaces).lowercased()
          }
          
          // Fallback to TIFF DateTime if EXIF DateTimeOriginal not found
          if captureTime == nil {
            if let tiffDateTime = tiffDict[kCGImagePropertyTIFFDateTime as String] as? String {
              captureTime = self.normalizeExifDateTime(tiffDateTime)
            }
          }
        }
        
        // iOS Camera app doesn't embed Make/Model in HEIC files (privacy feature)
        // Fallback to device info for photos taken on this device
        if make == nil {
          make = "apple"
        }
        if model == nil {
          // Get device model identifier (e.g., "iPhone15,2" for iPhone 14 Pro)
          var systemInfo = utsname()
          uname(&systemInfo)
          let modelCode = withUnsafePointer(to: &systemInfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) {
              String(validatingUTF8: $0)
            }
          }
          model = modelCode?.lowercased() ?? UIDevice.current.model.lowercased()
        }
        
        let result: [String: Any] = [
          "captureTime": captureTime ?? NSNull(),
          "make": make ?? NSNull(),
          "model": model ?? NSNull()
        ]
        
        resolve(result)
      }
    }
  }
  
  // Normalize EXIF date format "YYYY:MM:DD HH:MM:SS" to ISO format "YYYY-MM-DDTHH:MM:SS"
  private func normalizeExifDateTime(_ exifDate: String) -> String? {
    // EXIF format: "2024:01:15 14:30:45"
    // Target format: "2024-01-15T14:30:45"
    let trimmed = exifDate.trimmingCharacters(in: .whitespaces)
    if trimmed.count < 19 { return nil }
    
    let parts = trimmed.components(separatedBy: " ")
    if parts.count < 2 { return nil }
    
    let datePart = parts[0].replacingOccurrences(of: ":", with: "-")
    let timePart = parts[1]
    
    // Only take HH:MM:SS (first 8 chars of time part)
    let timeStr = String(timePart.prefix(8))
    
    return "\(datePart)T\(timeStr)"
  }
  
  // Convert ISO date format "YYYY-MM-DDTHH:MM:SS" back to EXIF format "YYYY:MM:DD HH:MM:SS"
  private func isoToExifDateTime(_ isoDate: String) -> String? {
    let trimmed = isoDate.trimmingCharacters(in: .whitespaces)
    if trimmed.count < 19 { return nil }
    
    // ISO format: "2024-01-15T14:30:45"
    // EXIF format: "2024:01:15 14:30:45"
    var result = trimmed.prefix(19)
    result = Substring(result.replacingOccurrences(of: "-", with: ":").replacingOccurrences(of: "T", with: " "))
    return String(result)
  }
  
  @objc
  func writeExif(_ path: String, exifData: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      autoreleasepool {
        let cleanPath = path.replacingOccurrences(of: "file://", with: "")
        let url = URL(fileURLWithPath: cleanPath)
        
        // Read the image
        guard let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil) else {
          reject("E_LOAD", "Cannot load image: \(path)", nil)
          return
        }
        
        guard let cgImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
          reject("E_IMAGE", "Cannot create image from source", nil)
          return
        }
        
        // Get existing properties
        var properties = (CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [String: Any]) ?? [:]
        
        // Build EXIF dictionary
        var exifDict = (properties[kCGImagePropertyExifDictionary as String] as? [String: Any]) ?? [:]
        var tiffDict = (properties[kCGImagePropertyTIFFDictionary as String] as? [String: Any]) ?? [:]
        var gpsDict = (properties[kCGImagePropertyGPSDictionary as String] as? [String: Any]) ?? [:]
        
        // Apply EXIF data from input
        if let captureTime = exifData["captureTime"] as? String {
          if let exifTime = self.isoToExifDateTime(captureTime) {
            exifDict[kCGImagePropertyExifDateTimeOriginal as String] = exifTime
            exifDict[kCGImagePropertyExifDateTimeDigitized as String] = exifTime
            tiffDict[kCGImagePropertyTIFFDateTime as String] = exifTime
          }
        }
        
        // Timezone offset (EXIF 2.31+) - critical for cross-platform time sorting
        if let offsetTime = exifData["offsetTimeOriginal"] as? String {
          exifDict["OffsetTimeOriginal"] = offsetTime
          exifDict["OffsetTimeDigitized"] = offsetTime
          exifDict["OffsetTime"] = offsetTime
        }
        
        // Subsecond precision
        if let subSecTime = exifData["subSecTimeOriginal"] as? String {
          exifDict["SubSecTimeOriginal"] = subSecTime
          exifDict["SubSecTimeDigitized"] = subSecTime
          exifDict["SubSecTime"] = subSecTime
        }
        
        if let make = exifData["make"] as? String {
          tiffDict[kCGImagePropertyTIFFMake as String] = make
        }
        
        if let model = exifData["model"] as? String {
          tiffDict[kCGImagePropertyTIFFModel as String] = model
        }
        
        // Camera settings
        if let exposureTime = exifData["exposureTime"] as? Double {
          exifDict[kCGImagePropertyExifExposureTime as String] = exposureTime
        }
        if let fNumber = exifData["fNumber"] as? Double {
          exifDict[kCGImagePropertyExifFNumber as String] = fNumber
        }
        if let iso = exifData["iso"] as? Int {
          exifDict[kCGImagePropertyExifISOSpeedRatings as String] = [iso]
        }
        if let focalLength = exifData["focalLength"] as? Double {
          exifDict[kCGImagePropertyExifFocalLength as String] = focalLength
        }
        if let focalLengthIn35mm = exifData["focalLengthIn35mm"] as? Int {
          exifDict[kCGImagePropertyExifFocalLenIn35mmFilm as String] = focalLengthIn35mm
        }
        
        // GPS data
        if let lat = exifData["gpsLatitude"] as? Double {
          gpsDict[kCGImagePropertyGPSLatitude as String] = abs(lat)
          gpsDict[kCGImagePropertyGPSLatitudeRef as String] = lat >= 0 ? "N" : "S"
        }
        if let lon = exifData["gpsLongitude"] as? Double {
          gpsDict[kCGImagePropertyGPSLongitude as String] = abs(lon)
          gpsDict[kCGImagePropertyGPSLongitudeRef as String] = lon >= 0 ? "E" : "W"
        }
        if let alt = exifData["gpsAltitude"] as? Double {
          gpsDict[kCGImagePropertyGPSAltitude as String] = abs(alt)
          gpsDict[kCGImagePropertyGPSAltitudeRef as String] = alt >= 0 ? 0 : 1
        }
        
        // Software
        if let software = exifData["software"] as? String {
          tiffDict[kCGImagePropertyTIFFSoftware as String] = software
        }
        
        // Lens info
        if let lensMake = exifData["lensMake"] as? String {
          exifDict[kCGImagePropertyExifLensMake as String] = lensMake
        }
        if let lensModel = exifData["lensModel"] as? String {
          exifDict[kCGImagePropertyExifLensModel as String] = lensModel
        }
        
        // Additional camera settings
        if let flash = exifData["flash"] as? Int {
          exifDict[kCGImagePropertyExifFlash as String] = flash
        }
        if let whiteBalance = exifData["whiteBalance"] as? Int {
          exifDict[kCGImagePropertyExifWhiteBalance as String] = whiteBalance
        }
        if let meteringMode = exifData["meteringMode"] as? Int {
          exifDict[kCGImagePropertyExifMeteringMode as String] = meteringMode
        }
        if let exposureProgram = exifData["exposureProgram"] as? Int {
          exifDict[kCGImagePropertyExifExposureProgram as String] = exposureProgram
        }
        if let exposureBias = exifData["exposureBias"] as? Double {
          exifDict[kCGImagePropertyExifExposureBiasValue as String] = exposureBias
        }
        if let colorSpace = exifData["colorSpace"] as? Int {
          exifDict[kCGImagePropertyExifColorSpace as String] = colorSpace
        }
        if let orientation = exifData["orientation"] as? Int {
          properties[kCGImagePropertyOrientation as String] = orientation
          tiffDict[kCGImagePropertyTIFFOrientation as String] = orientation
        }
        
        // IPTC fields (professional metadata — copyright, caption, keywords, creator)
        var iptcDict = (properties[kCGImagePropertyIPTCDictionary as String] as? [String: Any]) ?? [:]
        if let iptcCaption = exifData["iptcCaption"] as? String {
          iptcDict[kCGImagePropertyIPTCCaptionAbstract as String] = iptcCaption
        }
        if let iptcCopyright = exifData["iptcCopyright"] as? String {
          iptcDict[kCGImagePropertyIPTCCopyrightNotice as String] = iptcCopyright
          tiffDict[kCGImagePropertyTIFFCopyright as String] = iptcCopyright
        }
        if let iptcKeywords = exifData["iptcKeywords"] as? [String] {
          iptcDict[kCGImagePropertyIPTCKeywords as String] = iptcKeywords
        }
        if let iptcCreator = exifData["iptcCreator"] as? String {
          iptcDict[kCGImagePropertyIPTCByline as String] = [iptcCreator]
          tiffDict[kCGImagePropertyTIFFArtist as String] = iptcCreator
        }
        if let iptcTitle = exifData["iptcTitle"] as? String {
          iptcDict[kCGImagePropertyIPTCObjectName as String] = iptcTitle
        }
        if let iptcCity = exifData["iptcCity"] as? String {
          iptcDict[kCGImagePropertyIPTCCity as String] = iptcCity
        }
        if let iptcCountry = exifData["iptcCountry"] as? String {
          iptcDict[kCGImagePropertyIPTCCountryPrimaryLocationName as String] = iptcCountry
        }
        if let iptcCredit = exifData["iptcCredit"] as? String {
          iptcDict[kCGImagePropertyIPTCCredit as String] = iptcCredit
        }
        if let iptcSource = exifData["iptcSource"] as? String {
          iptcDict[kCGImagePropertyIPTCSource as String] = iptcSource
        }
        
        // Update properties
        if !iptcDict.isEmpty {
          properties[kCGImagePropertyIPTCDictionary as String] = iptcDict
        }
        if !exifDict.isEmpty {
          properties[kCGImagePropertyExifDictionary as String] = exifDict
        }
        if !tiffDict.isEmpty {
          properties[kCGImagePropertyTIFFDictionary as String] = tiffDict
        }
        if !gpsDict.isEmpty {
          properties[kCGImagePropertyGPSDictionary as String] = gpsDict
        }
        
        // Determine image type
        let uti = CGImageSourceGetType(imageSource) ?? kUTTypeJPEG
        
        // Write the image with new properties
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, uti, 1, nil) else {
          reject("E_DEST", "Cannot create image destination", nil)
          return
        }
        
        CGImageDestinationAddImage(destination, cgImage, properties as CFDictionary)
        
        if CGImageDestinationFinalize(destination) {
          resolve(["success": true])
        } else {
          reject("E_WRITE", "Failed to write image with EXIF", nil)
        }
      }
    }
  }
  
  @objc
  func saveRawToLibrary(_ rawPath: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      let cleanPath = rawPath.replacingOccurrences(of: "file://", with: "")
      let rawURL = URL(fileURLWithPath: cleanPath)
      
      guard FileManager.default.fileExists(atPath: cleanPath) else {
        reject("E_NOT_FOUND", "RAW file not found: \(cleanPath)", nil)
        return
      }
      
      // Generate JPEG preview from the RAW file
      guard let imageSource = CGImageSourceCreateWithURL(rawURL as CFURL, nil),
            let cgImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
        reject("E_LOAD", "Cannot load RAW image: \(cleanPath)", nil)
        return
      }
      
      let uiImage = UIImage(cgImage: cgImage)
      guard let jpegData = uiImage.jpegData(compressionQuality: 0.9) else {
        reject("E_JPEG", "Cannot create JPEG preview from RAW", nil)
        return
      }
      
      PHPhotoLibrary.requestAuthorization { status in
        guard status == .authorized || status == .limited else {
          reject("E_AUTH", "Photo library access denied", nil)
          return
        }
        
        PHPhotoLibrary.shared().performChanges({
          let creationRequest = PHAssetCreationRequest.forAsset()
          let creationOptions = PHAssetResourceCreationOptions()
          creationOptions.shouldMoveFile = false
          
          // Add JPEG as the primary photo (for Photos app display)
          creationRequest.addResource(with: .photo, data: jpegData, options: nil)
          // Add the original RAW/DNG as alternate photo (preserved byte-for-byte)
          creationRequest.addResource(with: .alternatePhoto, fileURL: rawURL, options: creationOptions)
        }) { success, error in
          if success {
            resolve(["success": true])
          } else {
            reject("E_SAVE", "Failed to save RAW to library: \(error?.localizedDescription ?? "unknown")", nil)
          }
        }
      }
    }
  }
  
  @objc
  func getOriginalResource(_ assetId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      // Strip ph:// prefix if present
      let cleanId = assetId.replacingOccurrences(of: "ph://", with: "")
      
      let fetchResult = PHAsset.fetchAssets(withLocalIdentifiers: [cleanId], options: nil)
      guard let asset = fetchResult.firstObject else {
        reject("E_NOT_FOUND", "Asset not found: \(assetId)", nil)
        return
      }
      
      let resources = PHAssetResource.assetResources(for: asset)
      
      // Look for alternatePhoto first (where DNG/RAW is stored), then fullSizePhoto, then photo
      var targetResource: PHAssetResource? = nil
      for resource in resources {
        if resource.type == .alternatePhoto {
          targetResource = resource
          break
        }
      }
      if targetResource == nil {
        for resource in resources {
          if resource.type == .fullSizePhoto {
            targetResource = resource
            break
          }
        }
      }
      if targetResource == nil {
        // No alternate/fullSize — return nil so JS falls back to normal path
        resolve(NSNull())
        return
      }
      
      let resource = targetResource!
      let originalFilename = resource.originalFilename
      let ext = (originalFilename as NSString).pathExtension.lowercased()
      
      // Only use this path for RAW formats
      let rawExtensions = ["dng", "cr2", "cr3", "nef", "arw", "orf", "rw2", "pef", "srw", "raf"]
      if !rawExtensions.contains(ext) {
        // Not a RAW file — return nil so JS uses normal path
        resolve(NSNull())
        return
      }
      
      // Export to temp file using requestData (writeData has known PHPhotosErrorDomain -1 bug)
      let tmpDir = NSTemporaryDirectory()
      let uuid = UUID().uuidString
      let tmpPath = (tmpDir as NSString).appendingPathComponent("raw_export_\(uuid).\(ext)")
      let tmpURL = URL(fileURLWithPath: tmpPath)
      
      // Remove existing temp file just in case
      try? FileManager.default.removeItem(at: tmpURL)
      
      let options = PHAssetResourceRequestOptions()
      options.isNetworkAccessAllowed = true
      
      var accumulatedData = Data()
      
      PHAssetResourceManager.default().requestData(for: resource, options: options, dataReceivedHandler: { chunk in
        accumulatedData.append(chunk)
      }, completionHandler: { error in
        if let error = error {
          reject("E_EXPORT", "Failed to export RAW resource: \(error.localizedDescription)", nil)
        } else {
          do {
            try accumulatedData.write(to: tmpURL)
            resolve([
              "filePath": tmpPath,
              "filename": originalFilename,
              "isRaw": true
            ])
          } catch {
            reject("E_WRITE", "Failed to write RAW data to temp file: \(error.localizedDescription)", nil)
          }
        }
      })
    }
  }
}
