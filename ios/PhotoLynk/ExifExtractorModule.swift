import Foundation
import UIKit
import ImageIO
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
}
