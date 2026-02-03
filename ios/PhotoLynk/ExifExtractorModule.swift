import Foundation
import UIKit
import ImageIO
import MobileCoreServices
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
        
        // Update properties
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
}
