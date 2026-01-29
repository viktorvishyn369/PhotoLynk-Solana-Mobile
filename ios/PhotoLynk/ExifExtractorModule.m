#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ExifExtractor, NSObject)

RCT_EXTERN_METHOD(extractExif:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(writeExif:(NSString *)path
                  exifData:(NSDictionary *)exifData
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
