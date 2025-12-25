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
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let cleanPath = path.replacingOccurrences(of: "file://", with: "")
        guard let image = UIImage(contentsOfFile: cleanPath) else {
          reject("E_LOAD", "Cannot load image: \(path)", nil)
          return
        }
        
        guard let cgImage = image.cgImage else {
          reject("E_CGIMAGE", "Cannot get CGImage", nil)
          return
        }
        
        let width = cgImage.width
        let height = cgImage.height
        let bytesPerPixel = 4
        let bytesPerRow = bytesPerPixel * width
        let bitsPerComponent = 8
        
        var pixelData = [UInt8](repeating: 0, count: width * height * bytesPerPixel)
        
        guard let context = CGContext(
          data: &pixelData,
          width: width,
          height: height,
          bitsPerComponent: bitsPerComponent,
          bytesPerRow: bytesPerRow,
          space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
          reject("E_CONTEXT", "Cannot create graphics context", nil)
          return
        }
        
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        
        // SHA256 hash of pixel data
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        pixelData.withUnsafeBytes { buffer in
          _ = CC_SHA256(buffer.baseAddress, CC_LONG(buffer.count), &hash)
        }
        
        let hexString = hash.map { String(format: "%02x", $0) }.joined()
        resolve(hexString)
        
      } catch {
        reject("E_HASH", "Failed to hash image: \(error.localizedDescription)", error)
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
