#import <RCTAppDelegate.h>
#import <UIKit/UIKit.h>
#import <Expo/Expo.h>

@interface AppDelegate : EXAppDelegateWrapper {
#if DEBUG
  // PhotoSyncLocalNetworkPromptPatch
  BOOL _didStartReactNativeAfterBecomeActive;
  id _didBecomeActiveObserver;
  NSDictionary *_cachedLaunchOptions;
  NSNetServiceBrowser *_localNetBrowser;
#endif
}

@end
