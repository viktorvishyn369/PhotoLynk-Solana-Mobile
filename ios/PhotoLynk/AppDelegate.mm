#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <React/RCTLinkingManager.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"main";

  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  #if DEBUG
  // PhotoSyncLocalNetworkPromptPatch
  _cachedLaunchOptions = launchOptions;
  _didStartReactNativeAfterBecomeActive = NO;

  // Show splash screen while waiting for local network prompt
  UIStoryboard *storyboard = [UIStoryboard storyboardWithName:@"SplashScreen" bundle:nil];
  UIViewController *splashVC = [storyboard instantiateInitialViewController];
  if (splashVC && self.window) {
    self.window.rootViewController = splashVC;
    [self.window makeKeyAndVisible];
  }

  // Trigger the iOS Local Network permission prompt
  _localNetBrowser = [[NSNetServiceBrowser alloc] init];
  [_localNetBrowser searchForServicesOfType:@"_http._tcp." inDomain:@"local."];

  // Start RN after app becomes active (after any system permission prompts)
  __weak typeof(self) weakSelf = self;
  _didBecomeActiveObserver = [[NSNotificationCenter defaultCenter]
    addObserverForName:UIApplicationDidBecomeActiveNotification
    object:nil
    queue:[NSOperationQueue mainQueue]
    usingBlock:^(NSNotification *note) {
      __strong typeof(weakSelf) strongSelf = weakSelf;
      if (!strongSelf || strongSelf->_didStartReactNativeAfterBecomeActive) return;
      strongSelf->_didStartReactNativeAfterBecomeActive = YES;

      [strongSelf->_localNetBrowser stop];
      strongSelf->_localNetBrowser = nil;

      if (strongSelf->_didBecomeActiveObserver) {
        [[NSNotificationCenter defaultCenter] removeObserver:strongSelf->_didBecomeActiveObserver];
        strongSelf->_didBecomeActiveObserver = nil;
      }
    }];

  // Fail-safe: start RN after 20s if didBecomeActive never fires
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(20.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    __strong typeof(weakSelf) strongSelf = weakSelf;
    if (!strongSelf || strongSelf->_didStartReactNativeAfterBecomeActive) return;
    strongSelf->_didStartReactNativeAfterBecomeActive = YES;
    if (strongSelf->_didBecomeActiveObserver) {
      [[NSNotificationCenter defaultCenter] removeObserver:strongSelf->_didBecomeActiveObserver];
      strongSelf->_didBecomeActiveObserver = nil;
    }
  });
#endif

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@".expo/.virtual-metro-entry"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

// Linking API
- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options {
  return [super application:application openURL:url options:options] || [RCTLinkingManager application:application openURL:url options:options];
}

// Universal Links
- (BOOL)application:(UIApplication *)application continueUserActivity:(nonnull NSUserActivity *)userActivity restorationHandler:(nonnull void (^)(NSArray<id<UIUserActivityRestoring>> * _Nullable))restorationHandler {
  BOOL result = [RCTLinkingManager application:application continueUserActivity:userActivity restorationHandler:restorationHandler];
  return [super application:application continueUserActivity:userActivity restorationHandler:restorationHandler] || result;
}

// Explicitly define remote notification delegates to ensure compatibility with some third-party libraries
- (void)application:(UIApplication *)application didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)deviceToken
{
  return [super application:application didRegisterForRemoteNotificationsWithDeviceToken:deviceToken];
}

// Explicitly define remote notification delegates to ensure compatibility with some third-party libraries
- (void)application:(UIApplication *)application didFailToRegisterForRemoteNotificationsWithError:(NSError *)error
{
  return [super application:application didFailToRegisterForRemoteNotificationsWithError:error];
}

// Explicitly define remote notification delegates to ensure compatibility with some third-party libraries
- (void)application:(UIApplication *)application didReceiveRemoteNotification:(NSDictionary *)userInfo fetchCompletionHandler:(void (^)(UIBackgroundFetchResult))completionHandler
{
  return [super application:application didReceiveRemoteNotification:userInfo fetchCompletionHandler:completionHandler];
}

@end
