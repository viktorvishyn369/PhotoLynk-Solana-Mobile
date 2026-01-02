import Foundation
import UIKit
import Accelerate
import CommonCrypto
import React

@objc(PixelHash)
class PixelHashModule: NSObject {
  
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
  
  @objc
  func hashImagePixels(_ path: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    // Uses 9x8 dHash (difference hash) - more resistant to compression/transcoding than aHash
    // Compares adjacent horizontal pixels, producing 64-bit hash
    // CRITICAL: Canonicalize HEIC pixels for cross-platform consistency:
    // 1. Decode FIRST image only (ignore auxiliary images/depth/HDR)
    // 2. Apply EXIF orientation transform
    // 3. Convert to sRGB colorspace
    // 4. Then compute perceptual hash
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      autoreleasepool {
        let cleanPath = path.replacingOccurrences(of: "file://", with: "")
        let url = URL(fileURLWithPath: cleanPath)
        
        // Load image source and get EXIF orientation
        guard let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil) else {
          reject("E_LOAD", "Cannot load image: \(path)", nil)
          return
        }
        
        // Decode FIRST image only (index 0) - ignore auxiliary images in HEIC container
        let options: [CFString: Any] = [
          kCGImageSourceShouldCache: false,
          kCGImageSourceShouldAllowFloat: false
        ]
        guard let cgImage = CGImageSourceCreateImageAtIndex(imageSource, 0, options as CFDictionary) else {
          reject("E_DECODE", "Cannot decode image: \(path)", nil)
          return
        }
        
        // Get EXIF orientation for canonicalization
        var orientation = UIImage.Orientation.up
        if let properties = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any],
           let orientationValue = properties[kCGImagePropertyOrientation] as? UInt32 {
          orientation = UIImage.Orientation(rawValue: Int(orientationValue)) ?? .up
        }
        
        // Apply orientation transform to canonicalize image
        // This ensures iOS HEIC = Desktop HEIC = Android HEIC regardless of orientation flags
        let uiImage = UIImage(cgImage: cgImage, scale: 1.0, orientation: orientation)
        guard let orientedCGImage = uiImage.cgImage else {
          reject("E_ORIENT", "Cannot apply orientation", nil)
          return
        }
        
        // Get oriented dimensions and pixel data
        let srcWidth = orientedCGImage.width
        let srcHeight = orientedCGImage.height
        let srcBytesPerPixel = 4
        let srcBytesPerRow = srcBytesPerPixel * srcWidth
        var srcPixelData = [UInt8](repeating: 0, count: srcWidth * srcHeight * srcBytesPerPixel)
        
        // Use sRGB colorspace for canonicalization (not device RGB)
        // This ensures consistent color interpretation across devices
        guard let sRGBColorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
          reject("E_COLORSPACE", "Cannot create sRGB colorspace", nil)
          return
        }
        
        guard let srcContext = CGContext(
          data: &srcPixelData,
          width: srcWidth,
          height: srcHeight,
          bitsPerComponent: 8,
          bytesPerRow: srcBytesPerRow,
          space: sRGBColorSpace,
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
          reject("E_CONTEXT", "Cannot create source context", nil)
          return
        }
        
        // Draw oriented image in sRGB colorspace
        srcContext.draw(orientedCGImage, in: CGRect(x: 0, y: 0, width: srcWidth, height: srcHeight))
        
        // Custom bilinear scaling to 9x8 (identical to Android implementation)
        let hashWidth = 9
        let hashHeight = 8
        var scaledPixelData = [UInt8](repeating: 0, count: hashWidth * hashHeight * srcBytesPerPixel)
        
        let xRatio = Float(srcWidth - 1) / Float(hashWidth - 1)
        let yRatio = Float(srcHeight - 1) / Float(hashHeight - 1)
        
        for y in 0..<hashHeight {
          for x in 0..<hashWidth {
            let srcX = Float(x) * xRatio
            let srcY = Float(y) * yRatio
            
            let x1 = Int(srcX)
            let y1 = Int(srcY)
            let x2 = min(x1 + 1, srcWidth - 1)
            let y2 = min(y1 + 1, srcHeight - 1)
            
            let xWeight = srcX - Float(x1)
            let yWeight = srcY - Float(y1)
            
            for c in 0..<3 {
              let p11 = Float(srcPixelData[(y1 * srcWidth + x1) * srcBytesPerPixel + c])
              let p21 = Float(srcPixelData[(y1 * srcWidth + x2) * srcBytesPerPixel + c])
              let p12 = Float(srcPixelData[(y2 * srcWidth + x1) * srcBytesPerPixel + c])
              let p22 = Float(srcPixelData[(y2 * srcWidth + x2) * srcBytesPerPixel + c])
              
              let top = p11 * (1.0 - xWeight) + p21 * xWeight
              let bottom = p12 * (1.0 - xWeight) + p22 * xWeight
              let value = top * (1.0 - yWeight) + bottom * yWeight
              
              scaledPixelData[(y * hashWidth + x) * srcBytesPerPixel + c] = UInt8(value + 0.5)
            }
            scaledPixelData[(y * hashWidth + x) * srcBytesPerPixel + 3] = 255
          }
        }
        
        let pixelData = scaledPixelData
        
        // Compute grayscale values in 2D array for easier adjacent pixel comparison
        var grayValues = [[UInt8]](repeating: [UInt8](repeating: 0, count: hashWidth), count: hashHeight)
        
        let bytesPerPixel = 4
        for y in 0..<hashHeight {
          for x in 0..<hashWidth {
            let offset = (y * hashWidth + x) * bytesPerPixel
            let r = Int(pixelData[offset])
            let g = Int(pixelData[offset + 1])
            let b = Int(pixelData[offset + 2])
            // Standard grayscale conversion
            let gray = (r * 299 + g * 587 + b * 114) / 1000
            grayValues[y][x] = UInt8(gray)
          }
        }
        
        // Build dHash: compare each pixel to its right neighbor
        // 8 rows × 8 comparisons = 64 bits = 8 bytes = 16 hex chars
        var hashBytes = [UInt8](repeating: 0, count: 8)
        var bitIndex = 0
        
        for y in 0..<hashHeight {
          for x in 0..<(hashWidth - 1) {
            // If left pixel < right pixel, set bit to 1
            if grayValues[y][x] < grayValues[y][x + 1] {
              let byteIndex = bitIndex / 8
              let bitPos = 7 - (bitIndex % 8)
              hashBytes[byteIndex] |= UInt8(1 << bitPos)
            }
            bitIndex += 1
          }
        }
        
        let hexString = hashBytes.map { String(format: "%02x", $0) }.joined()
        resolve(hexString)
      }
    }
  }
  
  @objc
  func hashPixelBufferSHA256(_ path: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    // Decodes image, scales to 256x256, and computes SHA-256 of the pixel buffer
    // This is pixel-exact at normalized resolution: ignores metadata, filename, format
    // 256x256 = 65536 pixels = 256KB to hash (fast) while still detecting any visual difference
    DispatchQueue.global(qos: .userInitiated).async {
      autoreleasepool {
        let cleanPath = path.replacingOccurrences(of: "file://", with: "")
        
        // Use ImageIO to load raw pixels WITHOUT applying EXIF orientation
        let url = URL(fileURLWithPath: cleanPath)
        guard let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil),
              let cgImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
          reject("E_LOAD", "Cannot load image: \(path)", nil)
          return
        }
        
        // Scale to fixed 256x256 for fast hashing while maintaining pixel-exactness
        let hashSize = 256
        let bytesPerPixel = 4
        let bytesPerRow = bytesPerPixel * hashSize
        let totalBytes = hashSize * hashSize * bytesPerPixel
        var pixelData = [UInt8](repeating: 0, count: totalBytes)
        
        guard let context = CGContext(
          data: &pixelData,
          width: hashSize,
          height: hashSize,
          bitsPerComponent: 8,
          bytesPerRow: bytesPerRow,
          space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
          reject("E_CONTEXT", "Cannot create graphics context", nil)
          return
        }
        
        // Draw scaled to 256x256
        context.interpolationQuality = .high
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: hashSize, height: hashSize))
        
        // Compute SHA-256 of the scaled pixel buffer
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        pixelData.withUnsafeBytes { bufferPointer in
          _ = CC_SHA256(bufferPointer.baseAddress, CC_LONG(totalBytes), &hash)
        }
        
        let hexString = hash.map { String(format: "%02x", $0) }.joined()
        resolve(hexString)
      }
    }
  }
  
  @objc
  func hashImageCorners(_ path: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    // Computes hash from 4 corners (10% region each), converted to grayscale
    // If corners match, photos likely have same scene/background
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      autoreleasepool {
        let cleanPath = path.replacingOccurrences(of: "file://", with: "")
        guard let image = UIImage(contentsOfFile: cleanPath) else {
          reject("E_LOAD", "Cannot load image: \(path)", nil)
          return
        }
        
        guard let cgImage = image.cgImage else {
          reject("E_CGIMAGE", "Cannot get CGImage", nil)
          return
        }
        
        let origWidth = cgImage.width
        let origHeight = cgImage.height
        
        // 10% corner region from each corner
        let cornerW = max(4, Int(Double(origWidth) * 0.10))
        let cornerH = max(4, Int(Double(origHeight) * 0.10))
        
        // Extract pixel data from original image
        let bytesPerPixel = 4
        let bytesPerRow = bytesPerPixel * origWidth
        var pixelData = [UInt8](repeating: 0, count: origWidth * origHeight * bytesPerPixel)
        
        guard let context = CGContext(
          data: &pixelData,
          width: origWidth,
          height: origHeight,
          bitsPerComponent: 8,
          bytesPerRow: bytesPerRow,
          space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
          reject("E_CONTEXT", "Cannot create graphics context", nil)
          return
        }
        
        // Draw with EXIF orientation
        UIGraphicsPushContext(context)
        image.draw(in: CGRect(x: 0, y: 0, width: origWidth, height: origHeight))
        UIGraphicsPopContext()
        
        // Helper to get grayscale at (x, y)
        func getGray(_ x: Int, _ y: Int) -> UInt8 {
          let clampedX = max(0, min(x, origWidth - 1))
          let clampedY = max(0, min(y, origHeight - 1))
          let offset = (clampedY * origWidth + clampedX) * bytesPerPixel
          let r = Int(pixelData[offset])
          let g = Int(pixelData[offset + 1])
          let b = Int(pixelData[offset + 2])
          return UInt8((r * 299 + g * 587 + b * 114) / 1000)
        }
        
        // Sample 4 points from each corner (16 total samples)
        // 2x2 grid within each corner region
        var cornerValues = [UInt8]()
        
        // Top-left corner
        for dy in 0..<2 {
          for dx in 0..<2 {
            let x = (cornerW * dx) / 2 + cornerW / 4
            let y = (cornerH * dy) / 2 + cornerH / 4
            cornerValues.append(getGray(x, y))
          }
        }
        
        // Top-right corner
        for dy in 0..<2 {
          for dx in 0..<2 {
            let x = origWidth - cornerW + (cornerW * dx) / 2 + cornerW / 4
            let y = (cornerH * dy) / 2 + cornerH / 4
            cornerValues.append(getGray(x, y))
          }
        }
        
        // Bottom-left corner
        for dy in 0..<2 {
          for dx in 0..<2 {
            let x = (cornerW * dx) / 2 + cornerW / 4
            let y = origHeight - cornerH + (cornerH * dy) / 2 + cornerH / 4
            cornerValues.append(getGray(x, y))
          }
        }
        
        // Bottom-right corner
        for dy in 0..<2 {
          for dx in 0..<2 {
            let x = origWidth - cornerW + (cornerW * dx) / 2 + cornerW / 4
            let y = origHeight - cornerH + (cornerH * dy) / 2 + cornerH / 4
            cornerValues.append(getGray(x, y))
          }
        }
        
        // Compute average of corner values
        let totalCorner = cornerValues.reduce(0) { $0 + Int($1) }
        let avgCorner = totalCorner / cornerValues.count
        
        // Build 16-bit hash from corner samples (1 if > avg, 0 otherwise)
        var hashValue: UInt16 = 0
        for i in 0..<min(16, cornerValues.count) {
          if Int(cornerValues[i]) > avgCorner {
            hashValue |= UInt16(1 << (15 - i))
          }
        }
        
        let hexString = String(format: "%04x", hashValue)
        resolve(hexString)
      }
    }
  }
  
  @objc
  func hashImageEdges(_ path: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    // Computes hash of 5% border from all 4 sides (edges only, not center)
    // If edges match, photos likely have same background/scene
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      autoreleasepool {
        let cleanPath = path.replacingOccurrences(of: "file://", with: "")
        guard let image = UIImage(contentsOfFile: cleanPath) else {
          reject("E_LOAD", "Cannot load image: \(path)", nil)
          return
        }
        
        guard let cgImage = image.cgImage else {
          reject("E_CGIMAGE", "Cannot get CGImage", nil)
          return
        }
        
        let origWidth = cgImage.width
        let origHeight = cgImage.height
        
        // 5% border from each side
        let borderX = max(1, Int(Double(origWidth) * 0.05))
        let borderY = max(1, Int(Double(origHeight) * 0.05))
        
        // Sample size for edge hash (8 pixels per edge = 32 total edge samples)
        let sampleSize = 8
        
        // Extract pixel data from original image
        let bytesPerPixel = 4
        let bytesPerRow = bytesPerPixel * origWidth
        var pixelData = [UInt8](repeating: 0, count: origWidth * origHeight * bytesPerPixel)
        
        guard let context = CGContext(
          data: &pixelData,
          width: origWidth,
          height: origHeight,
          bitsPerComponent: 8,
          bytesPerRow: bytesPerRow,
          space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
          reject("E_CONTEXT", "Cannot create graphics context", nil)
          return
        }
        
        // Draw with EXIF orientation
        UIGraphicsPushContext(context)
        image.draw(in: CGRect(x: 0, y: 0, width: origWidth, height: origHeight))
        UIGraphicsPopContext()
        
        // Sample edge pixels and compute grayscale values
        var edgeValues = [UInt8]()
        
        // Helper to get grayscale at (x, y)
        func getGray(_ x: Int, _ y: Int) -> UInt8 {
          let offset = (y * origWidth + x) * bytesPerPixel
          let r = Int(pixelData[offset])
          let g = Int(pixelData[offset + 1])
          let b = Int(pixelData[offset + 2])
          return UInt8((r * 299 + g * 587 + b * 114) / 1000)
        }
        
        // Top edge (within borderY from top)
        for i in 0..<sampleSize {
          let x = (origWidth * i) / sampleSize
          let y = borderY / 2
          edgeValues.append(getGray(x, y))
        }
        
        // Bottom edge
        for i in 0..<sampleSize {
          let x = (origWidth * i) / sampleSize
          let y = origHeight - borderY / 2 - 1
          edgeValues.append(getGray(x, y))
        }
        
        // Left edge
        for i in 0..<sampleSize {
          let x = borderX / 2
          let y = (origHeight * i) / sampleSize
          edgeValues.append(getGray(x, y))
        }
        
        // Right edge
        for i in 0..<sampleSize {
          let x = origWidth - borderX / 2 - 1
          let y = (origHeight * i) / sampleSize
          edgeValues.append(getGray(x, y))
        }
        
        // Compute average of edge values
        let totalEdge = edgeValues.reduce(0) { $0 + Int($1) }
        let avgEdge = totalEdge / edgeValues.count
        
        // Build 32-bit hash from edge samples (1 if > avg, 0 otherwise)
        var hashValue: UInt32 = 0
        for i in 0..<min(32, edgeValues.count) {
          if Int(edgeValues[i]) > avgEdge {
            hashValue |= UInt32(1 << (31 - i))
          }
        }
        
        let hexString = String(format: "%08x", hashValue)
        resolve(hexString)
      }
    }
  }
  
  @objc
  func hashImagePerceptual(_ path: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      let cleanPath = path.replacingOccurrences(of: "file://", with: "")
      guard let image = UIImage(contentsOfFile: cleanPath) else {
        reject("E_LOAD", "Cannot load image: \(path)", nil)
        return
      }
      
      guard let cgImage = image.cgImage else {
        reject("E_CGIMAGE", "Cannot get CGImage", nil)
        return
      }

      // Edge-inset crop (~10% on each side) to reduce UI overlays/borders affecting hashes
      let origW0 = CGFloat(cgImage.width)
      let origH0 = CGFloat(cgImage.height)
      let insetX = max(0, floor(origW0 * 0.10))
      let insetY = max(0, floor(origH0 * 0.10))
      let baseRect = CGRect(
        x: insetX,
        y: insetY,
        width: max(1, origW0 - insetX * 2),
        height: max(1, origH0 - insetY * 2)
      ).integral

      let cropRatio: CGFloat = 0.70
      let origW = baseRect.width
      let origH = baseRect.height
      let cropW = max(1, origW * cropRatio)
      let cropH = max(1, origH * cropRatio)
      let cropX = max(0, (origW - cropW) / 2)
      let cropY = max(0, (origH - cropH) / 2)
      let shiftUp = origH * 0.10
      var cropY2 = max(0, cropY - shiftUp)
      if cropY2 + cropH > origH { cropY2 = max(0, origH - cropH) }

      let cropRatio3: CGFloat = 0.50
      let cropW3 = max(1, origW * cropRatio3)
      let cropH3 = max(1, origH * cropRatio3)
      let cropX3 = max(0, (origW - cropW3) / 2)
      let cropY3 = max(0, (origH - cropH3) / 2)

      let rect1 = CGRect(x: baseRect.minX + cropX, y: baseRect.minY + cropY, width: cropW, height: cropH).integral
      let rect2 = CGRect(x: baseRect.minX + cropX, y: baseRect.minY + cropY2, width: cropW, height: cropH).integral
      let rect3 = CGRect(x: baseRect.minX + cropX3, y: baseRect.minY + cropY3, width: cropW3, height: cropH3).integral

      guard let cropped1 = cgImage.cropping(to: rect1) else {
        reject("E_CROP", "Cannot crop image", nil)
        return
      }
      guard let cropped2 = cgImage.cropping(to: rect2) else {
        reject("E_CROP", "Cannot crop image", nil)
        return
      }

      guard let cropped3 = cgImage.cropping(to: rect3) else {
        reject("E_CROP", "Cannot crop image", nil)
        return
      }

      guard let r1 = self.computePerceptual(cgImage: cropped1, reject: reject) else { return }
      guard let r2 = self.computePerceptual(cgImage: cropped2, reject: reject) else { return }
      guard let r3 = self.computePerceptual(cgImage: cropped3, reject: reject) else { return }

      let result: [String: Any] = [
        "pHash": r1.pHash,
        "dHash": r1.dHash,
        "avgBrightness": r1.avgBrightness,
        "blackRatio": r1.blackRatio,
        "whiteRatio": r1.whiteRatio,
        "avgRed": r1.avgRed,
        "avgGreen": r1.avgGreen,
        "avgBlue": r1.avgBlue,
        "pHash2": r2.pHash,
        "dHash2": r2.dHash,
        "avgBrightness2": r2.avgBrightness,
        "blackRatio2": r2.blackRatio,
        "whiteRatio2": r2.whiteRatio,
        "avgRed2": r2.avgRed,
        "avgGreen2": r2.avgGreen,
        "avgBlue2": r2.avgBlue,
        "pHash3": r3.pHash,
        "dHash3": r3.dHash,
        "avgBrightness3": r3.avgBrightness,
        "blackRatio3": r3.blackRatio,
        "whiteRatio3": r3.whiteRatio,
        "avgRed3": r3.avgRed,
        "avgGreen3": r3.avgGreen,
        "avgBlue3": r3.avgBlue
      ]
      resolve(result)
    }
  }

  private struct PerceptualResult {
    let pHash: String
    let dHash: String
    let avgBrightness: Double
    let blackRatio: Double
    let whiteRatio: Double
    let avgRed: Double
    let avgGreen: Double
    let avgBlue: Double
  }

  private func computePerceptual(cgImage: CGImage, reject: @escaping RCTPromiseRejectBlock) -> PerceptualResult? {
    let size = CGSize(width: 32, height: 32)
    UIGraphicsBeginImageContextWithOptions(size, false, 1.0)
    defer { UIGraphicsEndImageContext() }

    guard let ctx = UIGraphicsGetCurrentContext() else {
      reject("E_CONTEXT", "Cannot create resize context", nil)
      return nil
    }
    ctx.interpolationQuality = .high
    UIImage(cgImage: cgImage).draw(in: CGRect(origin: .zero, size: size))

    guard let resizedImage = UIGraphicsGetImageFromCurrentImageContext(),
          let resizedCG = resizedImage.cgImage else {
      reject("E_RESIZE", "Cannot resize image", nil)
      return nil
    }

    let width = 32
    let height = 32
    let bytesPerPixel = 4
    let bytesPerRow = bytesPerPixel * width
    var pixelData = [UInt8](repeating: 0, count: width * height * bytesPerPixel)

    guard let context = CGContext(
      data: &pixelData,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: bytesPerRow,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
      reject("E_CONTEXT", "Cannot create graphics context", nil)
      return nil
    }
    context.draw(resizedCG, in: CGRect(x: 0, y: 0, width: width, height: height))

    var grayscale = [[Double]](repeating: [Double](repeating: 0, count: width), count: height)
    var totalBrightness: Double = 0
    var totalRed: Double = 0
    var totalGreen: Double = 0
    var totalBlue: Double = 0
    var blackCount = 0
    var whiteCount = 0

    for y in 0..<height {
      for x in 0..<width {
        let offset = (y * width + x) * bytesPerPixel
        let r = Double(pixelData[offset])
        let g = Double(pixelData[offset + 1])
        let b = Double(pixelData[offset + 2])
        let gray = 0.299 * r + 0.587 * g + 0.114 * b
        grayscale[y][x] = gray
        totalBrightness += gray
        totalRed += r
        totalGreen += g
        totalBlue += b
        if gray < 10 { blackCount += 1 }
        if gray > 245 { whiteCount += 1 }
      }
    }

    let pixelCount = Double(width * height)
    let avgBrightness = totalBrightness / pixelCount
    let blackRatio = Double(blackCount) / pixelCount
    let whiteRatio = Double(whiteCount) / pixelCount
    let avgRed = totalRed / pixelCount / 255.0
    let avgGreen = totalGreen / pixelCount / 255.0
    let avgBlue = totalBlue / pixelCount / 255.0

    let dctSize = 8
    var dctValues = [Double](repeating: 0, count: dctSize * dctSize)
    for u in 0..<dctSize {
      for v in 0..<dctSize {
        var sum: Double = 0
        for yy in 0..<dctSize {
          for xx in 0..<dctSize {
            sum += grayscale[yy][xx] *
              cos(Double(2 * xx + 1) * Double(u) * .pi / 16) *
              cos(Double(2 * yy + 1) * Double(v) * .pi / 16)
          }
        }
        dctValues[u * dctSize + v] = sum
      }
    }

    let dctForMedian = Array(dctValues.dropFirst()).sorted()
    let median = dctForMedian.isEmpty ? 0 : dctForMedian[dctForMedian.count / 2]

    var pHashBits: UInt64 = 0
    for i in 1..<min(65, dctValues.count) {
      if dctValues[i] > median {
        pHashBits |= (1 << (i - 1))
      }
    }
    let pHash = String(format: "%016llx", pHashBits)

    var dHashBits: UInt64 = 0
    var bitIndex = 0
    for y in 0..<8 {
      for x in 0..<8 {
        if grayscale[y][x] < grayscale[y][x + 1] {
          dHashBits |= (1 << bitIndex)
        }
        bitIndex += 1
      }
    }
    let dHash = String(format: "%016llx", dHashBits)

    return PerceptualResult(
      pHash: pHash,
      dHash: dHash,
      avgBrightness: avgBrightness,
      blackRatio: blackRatio,
      whiteRatio: whiteRatio,
      avgRed: avgRed,
      avgGreen: avgGreen,
      avgBlue: avgBlue
    )
  }
}
