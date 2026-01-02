#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ExifExtractor, NSObject)

RCT_EXTERN_METHOD(extractExif:(NSString *)path
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
