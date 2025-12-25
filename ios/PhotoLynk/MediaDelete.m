#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(MediaDelete, NSObject)

RCT_EXTERN_METHOD(deleteAssets:(NSArray *)assetIds
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
