// PhotoLynk Mobile App - App.js

import 'react-native-get-random-values';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Appearance,
  Easing,
  FlatList,
  Image,
  Dimensions,
  Linking,
  NativeModules,
  PermissionsAndroid,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Keyboard,
  KeyboardAvoidingView,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import { styles, THEME } from './styles';
import {
  sleep,
  withRetries,
  shouldRetryChunkUpload,
  normalizeFilePath,
  makeChunkNonce,
  sanitizeHeaders,
  stripContentType,
  normalizeHostInput,
  computeServerUrl,
  formatBytes,
  normalizeFilenameForCompare,
  normalizeEmailForDeviceUuid,
  isValidUrl
} from './utils';
import {
  AUTO_UPLOAD_POLL_INTERVAL_SECONDS,
  AUTO_UPLOAD_MIN_CHECK_INTERVAL_SECONDS,
  AUTO_UPLOAD_MIN_CHUNK_SIZE,
  AUTO_UPLOAD_MAX_CHUNK_SIZE,
  AUTO_UPLOAD_KEEP_AWAKE_TAG,
  AUTO_UPLOAD_BACKGROUND_TASK,
  AUTO_UPLOAD_CURSOR_KEY_PREFIX,
  AUTO_UPLOAD_POLICY_POLL_MS,
  SAVED_PASSWORD_KEY,
  SAVED_PASSWORD_EMAIL_KEY,
  ensureAutoUploadPolicyAllowsWorkIfBackgroundedGlobal,
  activateKeepAwakeForAutoUpload,
  deactivateKeepAwakeForAutoUpload,
  buildAutoUploadCursorKey,
  getAutoUploadCursorKey,
  checkPhotoAccessForAutoUpload,
  getMediaLibraryAccessPrivileges,
  findFirstAlbumByTitle,
  ensureAndroidNotificationPermission,
  startAndroidForegroundUploadService,
  stopAndroidForegroundUploadService,
  evaluateAutoUploadPolicyState,
  logAutoUploadRunnerCondition,
  autoUploadEligibilityForBackground,
  autoUploadGetDeviceUuidFromEmail,
  autoUploadGetAuthHeadersFromSecureStore
} from './autoUpload';
import * as SecureStore from 'expo-secure-store';
import {
  MB,
  resolveReadableFilePath,
  getStealthCloudMasterKey,
  cacheStealthCloudMasterKey,
  clearStealthCloudMasterKeyCache,
  uploadEncryptedChunk,
  chooseStealthCloudChunkBytes,
  chooseStealthCloudMaxParallelChunkUploads,
  createConcurrencyLimiter,
  trackInFlightPromise,
  drainInFlightPromises,
  autoUploadStealthCloudUploadOneAsset
} from './backgroundTask';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as KeepAwake from 'expo-keep-awake';
import * as Network from 'expo-network';
import * as Battery from 'expo-battery';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { Feather } from '@expo/vector-icons';
import axios from 'axios';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { sha256 } from 'js-sha256';
import {
  initializePurchases,
  identifyUser as identifyPurchasesUser,
  getAvailablePlans,
  purchaseSubscription,
  restorePurchases,
  getSubscriptionStatus,
  checkUploadAccess,
  addSubscriptionListener,
  GRACE_PERIOD_DAYS,
} from './purchases';
import {
  stealthCloudUploadEncryptedChunk,
  PHOTO_ALBUM_NAME,
  LEGACY_PHOTO_ALBUM_NAME,
} from './backupManager';
import {
  stealthCloudRestoreCore,
  localRemoteRestoreCore,
} from './syncManager';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const { MediaDelete } = NativeModules;

const CLIENT_BUILD = `photolynk-mobile-v2/${Application.nativeApplicationVersion || '0'}(${Application.nativeBuildVersion || '0'}) sc-debug-2025-12-13`;

// Alias for backward compatibility with global function name
const ensureAutoUploadPolicyAllowsWorkIfBackgrounded = ensureAutoUploadPolicyAllowsWorkIfBackgroundedGlobal;

const GITHUB_RELEASES_LATEST_URL = 'https://github.com/viktorvishyn369/PhotoLynk/releases/latest';
const APP_DISPLAY_NAME = 'PhotoLynk';
const LEGACY_APP_DISPLAY_NAME = 'PhotoSync';
// PHOTO_ALBUM_NAME and LEGACY_PHOTO_ALBUM_NAME are now imported from backupManager.js
const ANDROID_HW_ID_KEY = 'android_hardware_device_id';
const IOS_HW_ID_KEY = 'ios_hardware_device_id';
const RESTORE_HISTORY_KEY = 'restore_history';
const makeHistoryKey = (type, id) => `${type}:${id}`;
const PHOTOLYNK_QR_SCHEMA = 'photolynk';
const LOCAL_SERVER_QR_SCHEMA = 'photolynk_local';
const REMOTE_SERVER_QR_SCHEMA = 'photolynk_remote';

// Persisted restore history to avoid re-downloading when the OS renames saved assets.
const loadRestoreHistory = async () => {
  try {
    const raw = await SecureStore.getItemAsync(RESTORE_HISTORY_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(Boolean));
  } catch (e) {
    return new Set();
  }
};

// Compute a stable Android hardware ID.
// Strategy: Use Application.androidId (SSAID) which is stable per app+device combo on Android 8+.
// For devices where androidId is null (rare, some custom ROMs/emulators), use deterministic hash.
// This works across: Pixel, Samsung, Xiaomi, Huawei, Oppo, OnePlus, Solana Mobile, etc.
const computeAndroidHardwareId = async () => {
  // 1) Primary: Application.androidId (SSAID)
  // - Unique per app signing key + device combination
  // - Persists across app reinstalls (same signing key)
  // - Persists across OS updates
  // - Available on Android 8.0+ (API 26+), which covers 99%+ of active devices
  const androidId = Application.androidId;
  if (androidId) {
    console.log('Android HW ID: using androidId (SSAID)');
    return androidId;
  }

  // 2) Fallback: Deterministic hash from immutable device properties
  // Used only when androidId is null (emulators, some custom ROMs)
  // These properties are set at factory and never change:
  // - brand: Device brand (e.g., "google", "samsung", "xiaomi", "solana")
  // - manufacturer: Hardware manufacturer
  // - modelName: Marketing model name (e.g., "Pixel 8", "Galaxy S24", "Seeker")
  // - productName: Internal product codename (stable across OS updates)
  const parts = [
    Device.brand,
    Device.manufacturer,
    Device.modelName,
    Device.productName,
  ].filter(Boolean);

  // Add Application.applicationId (package name) to make it app-specific
  // This ensures different apps on same device get different IDs
  if (Application.applicationId) {
    parts.push(Application.applicationId);
  }

  console.log('Android HW ID: androidId null, using device fingerprint:', parts.join('|'));

  if (parts.length >= 3) {
    const hash = sha256(parts.join('|'));
    const hwId = `android_hw_${hash.slice(0, 32)}`;
    console.log('Android HW ID: generated deterministic:', hwId);
    return hwId;
  }

  // 3) Last resort: stored UUID (won't survive reinstall, but covers edge cases)
  try {
    const stored = await SecureStore.getItemAsync(ANDROID_HW_ID_KEY);
    if (stored) {
      console.log('Android HW ID: using stored UUID');
      return stored;
    }
  } catch (e) {
    console.log('ANDROID_HW_ID_KEY read error:', e);
  }

  // Generate and store new UUID
  const hwId = `android_fallback_${uuidv4()}`;
  console.log('Android HW ID: generated new UUID fallback');
  try {
    await SecureStore.setItemAsync(ANDROID_HW_ID_KEY, hwId);
  } catch (e) {
    console.log('ANDROID_HW_ID_KEY write error:', e);
  }

  return hwId;
};

// Compute a stable iOS hardware ID.
// Order: return stored keychain value if present; else use IDFV and persist; else generate and persist.
const computeIosHardwareId = async () => {
  const secureStoreOpts = {
    keychainService: 'photolynk_hw_id',
    accessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
  };

  // 1) Prefer previously stored value (persists in keychain across reinstall/reboot)
  try {
    const stored = await SecureStore.getItemAsync(IOS_HW_ID_KEY, secureStoreOpts);
    if (stored) return stored;
  } catch (e) {
    console.log('IOS_HW_ID_KEY read error:', e);
  }

  // 2) Use IDFV if available, and persist it for future reinstall/reboot
  try {
    const idfv = await Application.getIosIdForVendorAsync();
    if (idfv) {
      try { await SecureStore.setItemAsync(IOS_HW_ID_KEY, idfv, secureStoreOpts); } catch (e) {}
      return idfv;
    }
  } catch (e) {
    console.log('IDFV error:', e);
  }

  // 3) Fallback: generate and persist
  const generated = `ios_hw_${uuidv4()}`;
  try { await SecureStore.setItemAsync(IOS_HW_ID_KEY, generated, secureStoreOpts); } catch (e) {}
  return generated;
};

const saveRestoreHistory = async (set) => {
  try {
    await SecureStore.setItemAsync(RESTORE_HISTORY_KEY, JSON.stringify([...set]));
  } catch (e) {
    // ignore
  }
};

// Login loading label helpers
const clearLoginTimers = (timerRef) => {
  if (timerRef?.current && Array.isArray(timerRef.current)) {
    timerRef.current.forEach(id => clearTimeout(id));
  } else if (timerRef?.current) {
    clearTimeout(timerRef.current);
  }
  if (timerRef) timerRef.current = [];
};

const scheduleAuthProgressLabels = (loginLabelTimerRef, setAuthLoadingLabel) => {
  clearLoginTimers(loginLabelTimerRef);
  const timers = [];
  setAuthLoadingLabel('Bonding...');

  timers.push(setTimeout(() => {
    setAuthLoadingLabel('Securing credentials...');
  }, 2000));

  timers.push(setTimeout(() => {
    setAuthLoadingLabel('Generating operational token...');
  }, 3000));

  loginLabelTimerRef.current = timers;
};

const resetAuthLoadingLabel = (loginStatusTimerRef, loginLabelTimerRef, setAuthLoadingLabel, label = 'Signing in...') => {
  if (loginStatusTimerRef?.current) {
    clearTimeout(loginStatusTimerRef.current);
    loginStatusTimerRef.current = null;
  }
  clearLoginTimers(loginLabelTimerRef);
  setAuthLoadingLabel(label);
};

// Thermal protection constants to prevent phone overheating (used when Fast Mode is OFF)
const THERMAL_BATCH_LIMIT = 10; // Max assets per batch before long cooling pause
const THERMAL_BATCH_COOLDOWN_MS = 30000; // 30 second pause between batches
const THERMAL_ASSET_COOLDOWN_MS = Platform.OS === 'ios' ? 2000 : 1500; // Cooldown between assets
const THERMAL_CHUNK_COOLDOWN_MS = 300; // Delay between chunks

// Fast mode constants (used when Fast Mode is ON) - no throttling, maximum speed
const FAST_BATCH_LIMIT = 999999; // Effectively no batch limit
const FAST_BATCH_COOLDOWN_MS = 0; // No pause between batches
const FAST_ASSET_COOLDOWN_MS = 0; // No cooldown between assets
const FAST_CHUNK_COOLDOWN_MS = 0; // No delay between chunks

// MIME type detection from filename (case-insensitive)
const getMimeFromFilename = (filename, fallbackMediaType) => {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  const mimeMap = {
    // Photos
    'heic': 'image/heic', 'heif': 'image/heif',
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'png': 'image/png', 'gif': 'image/gif',
    'webp': 'image/webp', 'tiff': 'image/tiff', 'tif': 'image/tiff',
    'bmp': 'image/bmp', 'ico': 'image/x-icon',
    'svg': 'image/svg+xml', 'avif': 'image/avif',
    // RAW formats
    'raw': 'image/raw', 'dng': 'image/dng',
    'cr2': 'image/x-canon-cr2', 'cr3': 'image/x-canon-cr3',
    'nef': 'image/x-nikon-nef', 'nrw': 'image/x-nikon-nrw',
    'arw': 'image/x-sony-arw', 'srf': 'image/x-sony-srf',
    'orf': 'image/x-olympus-orf', 'pef': 'image/x-pentax-pef',
    'raf': 'image/x-fuji-raf', 'rw2': 'image/x-panasonic-rw2',
    'srw': 'image/x-samsung-srw', 'x3f': 'image/x-sigma-x3f',
    // Videos
    'mp4': 'video/mp4', 'mov': 'video/quicktime',
    'avi': 'video/x-msvideo', 'mkv': 'video/x-matroska',
    'm4v': 'video/x-m4v', '3gp': 'video/3gpp', '3g2': 'video/3gpp2',
    'webm': 'video/webm', 'wmv': 'video/x-ms-wmv',
    'flv': 'video/x-flv', 'mpg': 'video/mpeg', 'mpeg': 'video/mpeg',
    'mts': 'video/mp2t', 'm2ts': 'video/mp2t',
  };
  if (mimeMap[ext]) return mimeMap[ext];
  return fallbackMediaType === 'video' ? 'video/mp4' : 'application/octet-stream';
};

const buildLocalFilenameSetPaged = async ({ mediaType, album = null, maxInitialEmptyWaitMs = 30000 }) => {
  const PAGE_SIZE = 500;
  let after = null;
  const set = new Set();
  let totalCount = null;
  let scanned = 0;
  const maxAttempts = Math.max(1, Math.ceil((Number(maxInitialEmptyWaitMs) || 0) / 500));

  while (true) {
    let page = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      page = await MediaLibrary.getAssetsAsync({
        first: PAGE_SIZE,
        after: after || undefined,
        mediaType,
        album: album || undefined,
      });

      const assetsNow = page && Array.isArray(page.assets) ? page.assets : [];
      if (!after && scanned === 0 && assetsNow.length === 0 && Platform.OS === 'ios' && attempt < (maxAttempts - 1)) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      break;
    }

    if (totalCount === null && page && typeof page.totalCount === 'number') {
      totalCount = page.totalCount;
    }

    const assets = page && Array.isArray(page.assets) ? page.assets : [];
    if (assets.length === 0) break;

    for (const a of assets) {
      const n1 = normalizeFilenameForCompare(a && a.filename ? a.filename : null);
      if (n1) {
        set.add(n1);
        scanned += 1;
        continue;
      }

      try {
        const info = await MediaLibrary.getAssetInfoAsync(a.id);
        const n2 = normalizeFilenameForCompare(info && info.filename ? info.filename : null);
        if (n2) set.add(n2);
      } catch (e) {
        // ignore
      }
      scanned += 1;
    }

    after = page && page.endCursor ? page.endCursor : null;
    if (!page || page.hasNextPage !== true) break;
  }

  return { set, totalCount, scanned };
};

const buildLocalAssetIdSetPaged = async ({ album, maxInitialEmptyWaitMs = 30000 }) => {
  const PAGE_SIZE = 500;
  let after = null;
  const set = new Set();
  const maxAttempts = Math.max(1, Math.ceil((Number(maxInitialEmptyWaitMs) || 0) / 500));

  while (true) {
    let page = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      page = await MediaLibrary.getAssetsAsync({
        first: PAGE_SIZE,
        after: after || undefined,
        album,
      });

      const assetsNow = page && Array.isArray(page.assets) ? page.assets : [];
      if (!after && set.size === 0 && assetsNow.length === 0 && Platform.OS === 'ios' && attempt < (maxAttempts - 1)) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      break;
    }

    const assets = page && Array.isArray(page.assets) ? page.assets : [];
    if (assets.length === 0) break;
    for (const a of assets) {
      if (a && a.id) set.add(a.id);
    }

    after = page && page.endCursor ? page.endCursor : null;
    if (!page || page.hasNextPage !== true) break;
  }

  return set;
};

// Beautiful gradient spinner component for loading screen
const GradientSpinner = ({ size = 80 }) => {
  const spinValue = useRef(new Animated.Value(0)).current;
  const pulseValue = useRef(new Animated.Value(0)).current;
  
  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 2000,
        easing: Easing.bezier(0.4, 0.0, 0.2, 1),
        useNativeDriver: true,
      })
    );
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseValue, {
          toValue: 0,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    spin.start();
    pulse.start();
    return () => { spin.stop(); pulse.stop(); };
  }, [spinValue, pulseValue]);
  
  const rotate = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  
  const scale = pulseValue.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.1],
  });
  // Petal spinner: soft purple “flower”
  const colors = ['#a855f7', '#8b5cf6', '#7c3aed', '#6d28d9'];
  const petalCount = 8;
  const petals = [];
  for (let i = 0; i < petalCount; i++) {
    const angle = (i * 360) / petalCount;
    const colorIndex = i % colors.length;
    const petalWidth = size * 0.24;
    const petalHeight = size * 0.56;
    const opacity = 0.6 + (i / petalCount) * 0.4;
    petals.push(
      <View
        key={i}
        style={{
          position: 'absolute',
          width: petalWidth,
          height: petalHeight,
          borderRadius: petalWidth,
          backgroundColor: colors[colorIndex],
          opacity,
          left: (size - petalWidth) / 2,
          top: (size - petalHeight) / 2,
          transform: [
            { rotate: `${angle}deg` },
            { translateY: -size * 0.12 },
          ],
          shadowColor: colors[colorIndex],
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.7,
          shadowRadius: 10,
          elevation: 6,
        }}
      />
    );
  }
  
  return (
    <Animated.View style={{ width: size, height: size, transform: [{ rotate }, { scale }] }}>
      {petals}
      <View style={{
        position: 'absolute',
        left: size / 2 - size * 0.1,
        top: size / 2 - size * 0.1,
        width: size * 0.2,
        height: size * 0.2,
        borderRadius: size * 0.1,
        backgroundColor: '#f5f3ff',
        opacity: 0.95,
        shadowColor: '#c4b5fd',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.7,
        shadowRadius: 10,
        elevation: 8,
      }} />
    </Animated.View>
  );
};

export default function App() {
  const [view, setView] = useState('loading'); // loading, auth, home, settings
  const [authMode, setAuthMode] = useState('login'); // login, register, forgot
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [serverType, setServerType] = useState('local'); // 'local' | 'remote' | 'stealthcloud'
  const [localHost, setLocalHost] = useState('');
  const [remoteHost, setRemoteHost] = useState('');
  const [autoUploadEnabled, setAutoUploadEnabled] = useState(false);
  const [fastModeEnabled, setFastModeEnabled] = useState(false);
  const [backupModeOpen, setBackupModeOpen] = useState(false);
  const [backupPickerOpen, setBackupPickerOpen] = useState(false);
  const [backupPickerAssets, setBackupPickerAssets] = useState([]);
  const [backupPickerAfter, setBackupPickerAfter] = useState(null);
  const [backupPickerHasNext, setBackupPickerHasNext] = useState(true);
  const [backupPickerLoading, setBackupPickerLoading] = useState(false);
  const [backupPickerSelected, setBackupPickerSelected] = useState({});
  const [syncModeOpen, setSyncModeOpen] = useState(false);
  const [syncPickerOpen, setSyncPickerOpen] = useState(false);
  const [syncPickerItems, setSyncPickerItems] = useState([]);
  const [syncPickerTotal, setSyncPickerTotal] = useState(0); // Total items on server (after filtering)
  const [syncPickerOffset, setSyncPickerOffset] = useState(0); // How many server items have been processed
  const [syncPickerLoading, setSyncPickerLoading] = useState(false);
  const [syncPickerLoadingMore, setSyncPickerLoadingMore] = useState(false);
  const [syncPickerSelected, setSyncPickerSelected] = useState({});
  const [syncPickerAuthHeaders, setSyncPickerAuthHeaders] = useState(null);
  const SYNC_PICKER_PAGE_SIZE = 20; // Items per page
  const [cleanupModeOpen, setCleanupModeOpen] = useState(false);
  const [quickSetupOpen, setQuickSetupOpen] = useState(false);
  const [authLoadingLabel, setAuthLoadingLabel] = useState('Signing in...');
  const loginStatusTimerRef = useRef(null);
  const loginLabelTimerRef = useRef(null);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [similarReviewOpen, setSimilarReviewOpen] = useState(false);
  const [similarGroups, setSimilarGroups] = useState([]);
  const [similarGroupIndex, setSimilarGroupIndex] = useState(0);
  const [similarSelected, setSimilarSelected] = useState({});
  const [customAlert, setCustomAlert] = useState(null); // { title, message, buttons }
  const [stealthCapacity, setStealthCapacity] = useState(null);
  const [stealthCapacityLoading, setStealthCapacityLoading] = useState(false);
  const [stealthCapacityError, setStealthCapacityError] = useState(null);
  const [selectedStealthPlanGb, setSelectedStealthPlanGb] = useState(null);
  const [stealthUsage, setStealthUsage] = useState(null);
  const [stealthUsageLoading, setStealthUsageLoading] = useState(false);
  const [stealthUsageError, setStealthUsageError] = useState(null);
  const [availablePlans, setAvailablePlans] = useState([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [paywallTierGb, setPaywallTierGb] = useState(null);
  const [token, setToken] = useState(null);
  const [userId, setUserId] = useState(null);
  const [deviceUuid, setDeviceUuid] = useState(null);
  const [status, setStatus] = useState('Idle');
  const [progress, setProgress] = useState(0);
  const [duplicateReview, setDuplicateReview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [wasBackgroundedDuringWork, setWasBackgroundedDuringWork] = useState(false);
  const [backgroundWarnEligible, setBackgroundWarnEligible] = useState(false);
  const [quickSetupCollapsed, setQuickSetupCollapsed] = useState(true);

  const backgroundWarnEligibleRef = useRef(false);
  const wasBackgroundedDuringWorkRef = useRef(false);
  const loadingRef = useRef(false);
  const syncPickerLocalFilenamesRef = useRef(null);
  const backgroundedAtMsRef = useRef(0);
  const expiredSubscriptionAlertShownRef = useRef(false);
  const autoUploadEnabledRef = useRef(false);
  const fastModeEnabledRef = useRef(false);
  const tokenRef = useRef(null);
  const serverTypeRef = useRef('local');
  const appStateRef = useRef(AppState.currentState || 'active');
  const autoUploadNightRunnerActiveRef = useRef(false);
  const [autoUploadNightRunnerCancelRef] = useState({ current: false });
  const autoUploadNightRunnerSessionIdRef = useRef(0);
  const autoUploadNightRunnerHeartbeatMsRef = useRef(0);
  const autoUploadNightRunnerStartingRef = useRef(false);
  const autoUploadNightNextTimerRef = useRef(null);
  const autoUploadDebugLastLogMsRef = useRef(0);
  const autoUploadDebugScheduleLastLogMsRef = useRef(0);
  const autoUploadPolicyLogMsRef = useRef(0);
  const autoUploadBackgroundPolicyLogMsRef = useRef(0);
  const autoUploadAssetLogMsRef = useRef(0);
  const autoUploadSummaryLogMsRef = useRef(0);
  const autoUploadRunnerExitLogMsRef = useRef(0);

  const logAutoUploadRunnerCondition = (reason, extra = null) => {
    try {
      const now = Date.now();
      if (autoUploadRunnerExitLogMsRef.current && (now - autoUploadRunnerExitLogMsRef.current) < 1000) return;
      autoUploadRunnerExitLogMsRef.current = now;
      console.log('AutoUpload:', reason, extra || '');
    } catch (e) {}
  };

  const setAutoUploadEnabledSafe = (value) => { autoUploadEnabledRef.current = !!value; setAutoUploadEnabled(!!value); };
  const setFastModeEnabledSafe = (value) => { fastModeEnabledRef.current = !!value; setFastModeEnabled(!!value); };
  const setTokenSafe = (value) => { tokenRef.current = value; setToken(value); };
  const setLoadingSafe = (value) => { loadingRef.current = !!value; setLoading(!!value); };

  // Camera permission for QR scanner
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // QR Code scanner handler
  const handleQRCodeScanned = async (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'photolynk-local' && parsed.ip && parsed.port) {
        // Valid PhotoLynk QR code
        const serverIp = parsed.ip;
        setLocalHost(serverIp);
        setServerType('local');
        setQrScannerOpen(false);
        
        // Save to SecureStore
        await SecureStore.setItemAsync('local_host', serverIp);
        await SecureStore.setItemAsync('server_type', 'local');
        
        Alert.alert(
          'Connected!',
          'Server IP set to ' + serverIp + ':' + parsed.port + (parsed.name ? '\n\nServer: ' + parsed.name : ''),
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Invalid QR Code', 'This QR code is not from PhotoLynk Server.');
      }
    } catch (e) {
      Alert.alert('Invalid QR Code', 'Could not parse QR code data.');
    }
  };

  // Format helpers - defined early since used throughout
  const formatBytesHuman = (bytes) => formatBytes(bytes, false);
  const formatBytesHumanDecimal = (bytes) => formatBytes(bytes, true);

  // Custom dark-themed alert (replaces Alert.alert for duplicate results)
  const showDarkAlert = (title, message, buttons = null) => {
    setCustomAlert({
      title,
      message,
      buttons: buttons || [{ text: 'OK', onPress: () => setCustomAlert(null) }]
    });
  };
  const closeDarkAlert = () => setCustomAlert(null);

  const openPaywall = (tierGb) => {
    setPaywallTierGb(tierGb);
  };

  const closePaywall = () => {
    setPaywallTierGb(null);
  };

  const persistAutoUploadEnabled = async (enabled) => {
    setAutoUploadEnabledSafe(enabled);
    try { await SecureStore.setItemAsync('auto_upload_enabled', enabled ? 'true' : 'false'); } catch (e) {}
  };

  const persistFastModeEnabled = async (enabled) => {
    setFastModeEnabledSafe(enabled);
    try { await SecureStore.setItemAsync('fast_mode_enabled', enabled ? 'true' : 'false'); } catch (e) {}
  };

  useEffect(() => { autoUploadEnabledRef.current = !!autoUploadEnabled; }, [autoUploadEnabled]);
  useEffect(() => { fastModeEnabledRef.current = !!fastModeEnabled; }, [fastModeEnabled]);
  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { serverTypeRef.current = serverType; }, [serverType]);

  // Throttle helpers - return current values based on fast mode setting
  const getThrottleBatchLimit = () => fastModeEnabledRef.current ? FAST_BATCH_LIMIT : THERMAL_BATCH_LIMIT;
  const getThrottleBatchCooldownMs = () => fastModeEnabledRef.current ? FAST_BATCH_COOLDOWN_MS : THERMAL_BATCH_COOLDOWN_MS;
  const getThrottleAssetCooldownMs = () => fastModeEnabledRef.current ? FAST_ASSET_COOLDOWN_MS : THERMAL_ASSET_COOLDOWN_MS;
  const getThrottleChunkCooldownMs = () => fastModeEnabledRef.current ? FAST_CHUNK_COOLDOWN_MS : THERMAL_CHUNK_COOLDOWN_MS;

  // RevenueCat purchase helpers
  const loadAvailablePlans = async () => {
    try {
      setPlansLoading(true);
      const plans = await getAvailablePlans();
      setAvailablePlans(plans);
    } catch (e) {
      console.error('Failed to load plans:', e);
    } finally {
      setPlansLoading(false);
    }
  };

  const refreshSubscriptionStatus = async () => {
    try {
      const status = await getSubscriptionStatus();
      setSubscriptionStatus(status);
      return status;
    } catch (e) {
      console.error('Failed to get subscription status:', e);
      return null;
    }
  };

  const handlePurchase = async (tierGb) => {
    try {
      setPurchaseLoading(true);
      setStatus('Processing purchase...');
      
      const result = await purchaseSubscription(tierGb);
      
      if (result.success) {
        showDarkAlert('Success!', `Your ${tierGb === 1000 ? '1 TB' : tierGb + ' GB'} plan is now active.`);
        await refreshSubscriptionStatus();
        setSelectedStealthPlanGb(tierGb);
      } else if (result.userCancelled) {
        // User cancelled - no message needed
      } else {
        showDarkAlert('Purchase Failed', result.error || 'Unable to complete purchase. Please try again.');
      }
    } catch (e) {
      showDarkAlert('Purchase Error', e.message || 'An error occurred during purchase.');
    } finally {
      setPurchaseLoading(false);
      setStatus('Idle');
    }
  };

  const handleRestorePurchases = async () => {
    try {
      setPurchaseLoading(true);
      setStatus('Restoring purchases...');
      
      const result = await restorePurchases();
      
      if (result.success && result.hasActiveSubscription) {
        showDarkAlert('Restored!', 'Your subscription has been restored.');
        await refreshSubscriptionStatus();
      } else if (result.success) {
        showDarkAlert('No Subscription Found', 'No active subscription was found to restore.');
      } else {
        showDarkAlert('Restore Failed', result.error || 'Unable to restore purchases.');
      }
    } catch (e) {
      showDarkAlert('Restore Error', e.message || 'An error occurred while restoring.');
    } finally {
      setPurchaseLoading(false);
      setStatus('Idle');
    }
  };

  const getAutoUploadEligibility = async () => {
    try {
      const state = await evaluateAutoUploadPolicyState();
      if (state.ok) return { ok: true, reason: null };
      return { ok: false, reason: state.reason || 'Auto Upload waiting' };
    } catch (e) { return { ok: false, reason: 'Auto Upload policy check failed' }; }
  };

  const ensureAutoUploadPolicyAllowsWork = async ({ userInitiated }) => {
    if (!autoUploadEnabledRef.current) return true;
    if (userInitiated) return true;
    const el = await getAutoUploadEligibility();
    if (el.ok) {
      const st = (appStateRef.current || 'active').toString();
      if (st === 'active') setStatus('Auto-Backup: Resumed');
      return true;
    }
    setStatus(el.reason || 'Auto-Backup: Waiting');
    return false;
  };

  const ensureAutoUploadPolicyAllowsWorkIfBackgrounded = async () => {
    if (!autoUploadEnabledRef.current) return true;
    const st = (appStateRef.current || 'active').toString();
    if (st === 'active') return true;
    const el = await getAutoUploadEligibility();
    if (el.ok) {
      // Don't update status when in background - keep showing "paused (backgrounded)"
      return true;
    }
    setStatus(el.reason || 'Auto-Backup: Waiting');
    try {
      const now = Date.now();
      if (!autoUploadBackgroundPolicyLogMsRef.current || (now - autoUploadBackgroundPolicyLogMsRef.current) > 5000) {
        autoUploadBackgroundPolicyLogMsRef.current = now;
        console.log('AutoUpload: waiting (background policy)', el.reason || 'unknown');
      }
    } catch (e) {}
    return false;
  };

  const scheduleNextAutoUploadNightKick = () => {
    try {
      if (autoUploadNightNextTimerRef.current) {
        clearTimeout(autoUploadNightNextTimerRef.current);
        autoUploadNightNextTimerRef.current = null;
      }

      const nowLog = Date.now();
      const canLog = (!autoUploadDebugScheduleLastLogMsRef.current || (nowLog - autoUploadDebugScheduleLastLogMsRef.current) > 8000);

      if (!autoUploadEnabledRef.current) {
        if (canLog) { autoUploadDebugScheduleLastLogMsRef.current = nowLog; console.log('AutoUpload: schedule skipped (disabled)'); }

        // Stop Android foreground service when disabled
        try { void stopAndroidForegroundUploadService(); } catch (e) {}
        return;
      }
      if (serverTypeRef.current !== 'stealthcloud') {
        if (canLog) { autoUploadDebugScheduleLastLogMsRef.current = nowLog; console.log('AutoUpload: schedule skipped (serverType)', serverTypeRef.current); }
        return;
      }
      if (!tokenRef.current) {
        if (canLog) { autoUploadDebugScheduleLastLogMsRef.current = nowLog; console.log('AutoUpload: schedule skipped (missing token)'); }
        return;
      }

      void maybeStartAutoUploadNightSession();

      autoUploadNightNextTimerRef.current = setTimeout(() => {
        autoUploadNightNextTimerRef.current = null;
        void maybeStartAutoUploadNightSession();
        scheduleNextAutoUploadNightKick();
      }, AUTO_UPLOAD_POLICY_POLL_MS);

      try {
        const now2 = Date.now();
        if (!autoUploadDebugScheduleLastLogMsRef.current || (now2 - autoUploadDebugScheduleLastLogMsRef.current) > 8000) {
          autoUploadDebugScheduleLastLogMsRef.current = now2;
          console.log('AutoUpload: scheduled policy poll in', Math.round(AUTO_UPLOAD_POLICY_POLL_MS / 1000), 's');
        }
      } catch (e) {}
    } catch (e) {
      // ignore
    }
  };

  const maybeStartAutoUploadNightSession = async () => {
    // Prevent concurrent calls
    if (autoUploadNightRunnerStartingRef.current) {
      return;
    }
    autoUploadNightRunnerStartingRef.current = true;
    
    try {
      const now = Date.now();
      const canLog = (!autoUploadDebugLastLogMsRef.current || (now - autoUploadDebugLastLogMsRef.current) > 8000);
      if (!autoUploadEnabledRef.current) {
        if (canLog) { autoUploadDebugLastLogMsRef.current = now; console.log('AutoUpload: not starting (disabled)'); }
        autoUploadNightRunnerStartingRef.current = false;
        return;
      }
      if (serverTypeRef.current !== 'stealthcloud') {
        if (canLog) { autoUploadDebugLastLogMsRef.current = now; console.log('AutoUpload: not starting (serverType)', serverTypeRef.current); }
        autoUploadNightRunnerStartingRef.current = false;
        return;
      }
      if (!tokenRef.current) {
        if (canLog) { autoUploadDebugLastLogMsRef.current = now; console.log('AutoUpload: not starting (missing token)'); }
        autoUploadNightRunnerStartingRef.current = false;
        return;
      }
      const state = await evaluateAutoUploadPolicyState();
      if (!state.ok) {
        if (canLog) { autoUploadDebugLastLogMsRef.current = now; console.log('AutoUpload: not starting (policy)', state.reason); }
        setStatus(state.reason || 'Auto-Backup: Waiting');
        autoUploadNightRunnerStartingRef.current = false;
        return;
      }

      const photoAccess = await checkPhotoAccessForAutoUpload();
      if (!photoAccess.granted) {
        if (canLog) { autoUploadDebugLastLogMsRef.current = now; console.log('AutoUpload: not starting (photos permission denied)'); }
        setStatus('Auto-Backup: Allow Photos access');
        autoUploadNightRunnerStartingRef.current = false;
        return;
      }
      if (photoAccess.limited) {
        if (canLog) {
          autoUploadDebugLastLogMsRef.current = now;
          console.log('AutoUpload: not starting (photos access limited)');
        }
        if (Platform.OS === 'ios') {
          setStatus('Auto-Backup: Enable "All Photos" access in Settings → Photos → PhotoLynk');
          showDarkAlert(
            'Allow All Photos',
            'Auto Upload needs access to all photos. Go to iOS Settings → PhotoLynk → Photos → All Photos.'
          );
        }
        autoUploadNightRunnerStartingRef.current = false;
        return;
      }
    } catch (e) {
      // ignore precondition errors
      autoUploadNightRunnerStartingRef.current = false;
      return;
    }

    // Watchdog: replace stuck runner if no heartbeat in 120s
    if (autoUploadNightRunnerActiveRef.current) {
      const lastBeat = autoUploadNightRunnerHeartbeatMsRef.current || 0;
      const staleTimeoutMs = Platform.OS === 'android' ? (120 * 1000) : (120 * 1000);
      const stale = lastBeat > 0 && (Date.now() - lastBeat) > staleTimeoutMs;
      if (!stale) {
        console.log('AutoUpload: runner already active, not stale yet', { lastBeatAgoMs: Date.now() - lastBeat, staleTimeoutMs });
        autoUploadNightRunnerStartingRef.current = false;
        return;
      }

      console.log('AutoUpload: replacing stuck night runner (stale)', { lastBeatAgoMs: Date.now() - lastBeat });
      autoUploadNightRunnerCancelRef.current = true;
      autoUploadNightRunnerSessionIdRef.current += 1;
      autoUploadNightRunnerActiveRef.current = false;
    }

    autoUploadNightRunnerStartingRef.current = false;

    autoUploadNightRunnerSessionIdRef.current += 1;
    const sessionId = autoUploadNightRunnerSessionIdRef.current;
    console.log('AutoUpload: starting night runner session', sessionId);
    setStatus('Auto-Backup: Resumed');

    autoUploadNightRunnerActiveRef.current = true;
    autoUploadNightRunnerCancelRef.current = false;
    autoUploadNightRunnerHeartbeatMsRef.current = Date.now();
    await activateKeepAwakeForAutoUpload();

    // Android: start foreground service to prevent suspension
    try {
      if (Platform.OS === 'android') {
        await startAndroidForegroundUploadService({
          title: 'Auto Upload',
          text: 'Uploading in background (night mode)'
        });
      }
    } catch (e) {}
    try {
      console.log('AutoUpload: entering runner loop', {
        autoUploadEnabled: autoUploadEnabledRef.current,
        serverType: serverTypeRef.current,
        hasToken: !!tokenRef.current,
        sessionId,
        currentSessionId: autoUploadNightRunnerSessionIdRef.current,
        cancelled: autoUploadNightRunnerCancelRef.current
      });
      while (autoUploadEnabledRef.current && serverTypeRef.current === 'stealthcloud' && tokenRef.current) {
        if (sessionId !== autoUploadNightRunnerSessionIdRef.current) {
          console.log('AutoUpload: breaking - session mismatch', { sessionId, current: autoUploadNightRunnerSessionIdRef.current });
          break;
        }
        if (autoUploadNightRunnerCancelRef.current) {
          console.log('AutoUpload: breaking - cancelled');
          break;
        }
        autoUploadNightRunnerHeartbeatMsRef.current = Date.now();

        // Skip if user task in progress
        if (loadingRef.current) {
          await sleep(30000);
          continue;
        }

        const allowed = await ensureAutoUploadPolicyAllowsWork({ userInitiated: false });
        if (!allowed) {
          console.log('AutoUpload: runner sleeping (policy not allowed)');
          await sleep(60000);
          continue;
        }

        const allowedBg = await ensureAutoUploadPolicyAllowsWorkIfBackgrounded();
        if (!allowedBg) {
          console.log('AutoUpload: runner sleeping (background policy not allowed)', { appState: appStateRef.current });
          await sleep(60000);
          continue;
        }

        let config = null;
        let authErr = null;
        try {
          config = await getAuthHeaders();
        } catch (e) {
          authErr = e;
          config = null;
        }
        if (!config) {
          try {
            const now = Date.now();
            if (!autoUploadDebugLastLogMsRef.current || (now - autoUploadDebugLastLogMsRef.current) > 15000) {
              autoUploadDebugLastLogMsRef.current = now;
              const msg = authErr && authErr.message ? String(authErr.message) : 'unknown';
              console.log('AutoUpload: waiting (no auth headers)', msg);
            }
          } catch (e) {}
          await sleep(60000);
          continue;
        }

        let SERVER_URL = getServerUrl();
        if (!SERVER_URL) {
          try {
            const now = Date.now();
            if (!autoUploadDebugLastLogMsRef.current || (now - autoUploadDebugLastLogMsRef.current) > 15000) {
              autoUploadDebugLastLogMsRef.current = now;
              console.log('AutoUpload: waiting (no server url)');
            }
          } catch (e) {}
          await sleep(60000);
          continue;
        }

        const startedAt = Date.now();
        const batchBudgetMs = Platform.OS === 'ios' ? 20000 : 2 * 60 * 1000;
        const maxUploads = Platform.OS === 'ios' ? 8 : 200;
        const pageSize = Platform.OS === 'ios' ? 80 : 250;

        let existingManifests = [];
        try {
          const listRes = await axios.get(`${SERVER_URL}/api/cloud/manifests`, config);
          existingManifests = (listRes.data && listRes.data.manifests) ? listRes.data.manifests : [];
        } catch (e) {
          existingManifests = [];
        }
        let already = new Set(existingManifests.map(m => m.manifestId));

        // Build filename set for cross-device duplicate detection (auto-upload has more time)
        const alreadyFilenames = new Set();
        if (existingManifests.length > 0) {
          setStatus('Auto-Backup: Checking existing files...');
          const masterKey = await getStealthCloudMasterKey();
          for (const m of existingManifests) {
            try {
              const manRes = await axios.get(`${SERVER_URL}/api/cloud/manifests/${m.manifestId}`, { headers: config.headers, timeout: 15000 });
              const payload = manRes.data;
              const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
              const enc = JSON.parse(parsed.encryptedManifest);
              const manifestNonce = naclUtil.decodeBase64(enc.manifestNonce);
              const manifestBox = naclUtil.decodeBase64(enc.manifestBox);
              const manifestPlain = nacl.secretbox.open(manifestBox, manifestNonce, masterKey);
              if (manifestPlain) {
                const manifest = JSON.parse(naclUtil.encodeUTF8(manifestPlain));
                if (manifest.filename) {
                  alreadyFilenames.add(normalizeFilenameForCompare(manifest.filename));
                }
              }
            } catch (e) {
              // Skip manifests we can't decrypt
            }
          }
          console.log(`AutoUpload: found ${alreadyFilenames.size} existing filenames for cross-device duplicate detection`);
        }

        let after = null;
        try {
          const savedCursor = await SecureStore.getItemAsync(AUTO_UPLOAD_CURSOR_KEY);
          after = savedCursor ? savedCursor : null;
        } catch (e) {
          after = null;
        }

        let uploaded = 0;
        let skipped = 0;
        let failed = 0;

        // Track cumulative progress across sessions
        let totalEstimatedCount = null;
        let cumulativeUploaded = 0;

        // Track if we've detected completion
        let backupCompleted = false;

        // Get current uploaded count from server manifests (primary source)
        config = await getAuthHeaders();
        SERVER_URL = getServerUrl();
        try {
          const listRes = await axios.get(`${SERVER_URL}/api/cloud/manifests`, config);
          const existingManifests = (listRes.data && listRes.data.manifests) ? listRes.data.manifests : [];
          cumulativeUploaded = existingManifests.length;
          console.log('AutoUpload: loaded cumulative uploaded count from server:', cumulativeUploaded);
        } catch (e) {
          console.log('AutoUpload: failed to load manifests from server, using SecureStore fallback');
          // Fallback to SecureStore if server request fails
          try {
            const saved = await SecureStore.getItemAsync('auto_upload_cumulative_uploaded');
            cumulativeUploaded = saved ? parseInt(saved, 10) || 0 : 0;
          } catch (e2) {
            cumulativeUploaded = 0;
          }
        }

        // Create set of already uploaded manifest IDs
        already = new Set();
        if (existingManifests) {
          existingManifests.forEach(m => already.add(m.manifestId));
        } else {
          // If we couldn't load manifests, try again or use empty set
          try {
            const listRes = await axios.get(`${SERVER_URL}/api/cloud/manifests`, config);
            const manifests = (listRes.data && listRes.data.manifests) ? listRes.data.manifests : [];
            manifests.forEach(m => already.add(m.manifestId));
          } catch (e) {
            console.log('AutoUpload: failed to load manifest IDs, will check individually');
          }
        }

        while (true) {
          if (uploaded >= maxUploads) {
            console.log('AutoUpload: breaking loop - max uploads reached', uploaded, maxUploads);
            logAutoUploadRunnerCondition('runner exiting loop (max uploads reached)', { uploaded, maxUploads });
            break;
          }
          if (Date.now() - startedAt >= batchBudgetMs) {
            console.log('AutoUpload: breaking loop - batch budget exceeded', Date.now() - startedAt, batchBudgetMs);
            logAutoUploadRunnerCondition('runner exiting loop (batch budget exceeded)', { elapsedMs: Date.now() - startedAt, batchBudgetMs });
            break;
          }
          if (sessionId !== autoUploadNightRunnerSessionIdRef.current) {
            console.log('AutoUpload: breaking loop - session superseded', sessionId, autoUploadNightRunnerSessionIdRef.current);
            logAutoUploadRunnerCondition('runner exiting loop (session superseded)', { sessionId, activeSessionId: autoUploadNightRunnerSessionIdRef.current });
            break;
          }
          if (autoUploadNightRunnerCancelRef.current) {
            console.log('AutoUpload: breaking loop - cancel requested');
            logAutoUploadRunnerCondition('runner exiting loop (cancel requested)');
            break;
          }
          if (!autoUploadEnabledRef.current) {
            console.log('AutoUpload: breaking loop - auto upload disabled');
            logAutoUploadRunnerCondition('runner exiting loop (auto upload disabled)');
            break;
          }

          const page = await MediaLibrary.getAssetsAsync({
            mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
            first: pageSize,
            after: after || undefined,
            sortBy: [MediaLibrary.SortBy.creationTime]
          });
          const assets = page && Array.isArray(page.assets) ? page.assets : [];
          if (!assets.length) {
            try {
              const nowAssets = Date.now();
              if (!autoUploadAssetLogMsRef.current || (nowAssets - autoUploadAssetLogMsRef.current) > 15000) {
                autoUploadAssetLogMsRef.current = nowAssets;
                console.log('AutoUpload: no assets returned', {
                  hasNextPage: page && page.hasNextPage,
                  totalCount: page && typeof page.totalCount === 'number' ? page.totalCount : undefined,
                  after,
                });
                // If we've reached the end with no assets, notify user backup is complete
                if (!page || page.hasNextPage !== true) {
                  console.log('AutoUpload: reached end of assets, clearing cursor and setting completion');
                  await SecureStore.deleteItemAsync(AUTO_UPLOAD_CURSOR_KEY);
                  setStatus('Auto-Backup: All files uploaded');
                  console.log('AutoUpload: full backup cycle complete, all photos backed up');
                  backupCompleted = true;
                }
              }
            } catch (e) {}
            break;
          }

          // Set total count from first page
          if (totalEstimatedCount === null && page && typeof page.totalCount === 'number') {
            totalEstimatedCount = page.totalCount;
            console.log('AutoUpload: estimated total assets to upload:', totalEstimatedCount);
            // Update status with current progress or completion
            console.log('AutoUpload: initial status - backupCompleted:', backupCompleted, 'cumulativeUploaded:', cumulativeUploaded, 'totalEstimatedCount:', totalEstimatedCount);
            if (backupCompleted || cumulativeUploaded === totalEstimatedCount) {
              setStatus('Auto-Backup: All files uploaded');
              console.log('AutoUpload: showing completion message');
            } else {
              setStatus(`Auto-Backup: ${cumulativeUploaded}/${totalEstimatedCount} uploaded`);
              console.log('AutoUpload: showing progress message');
            }
          }

          for (const asset of assets) {
            if (uploaded >= maxUploads) {
              logAutoUploadRunnerCondition('asset loop break (max uploads reached mid-page)', { uploaded, maxUploads });
              break;
            }
            if (Date.now() - startedAt >= batchBudgetMs) {
              logAutoUploadRunnerCondition('asset loop break (batch budget exceeded mid-page)', { elapsedMs: Date.now() - startedAt, batchBudgetMs });
              break;
            }
            if (sessionId !== autoUploadNightRunnerSessionIdRef.current) {
              logAutoUploadRunnerCondition('asset loop break (session superseded mid-page)', { sessionId, activeSessionId: autoUploadNightRunnerSessionIdRef.current });
              break;
            }
            if (autoUploadNightRunnerCancelRef.current) {
              logAutoUploadRunnerCondition('asset loop break (cancel requested mid-page)');
              break;
            }
            if (!autoUploadEnabledRef.current) {
              logAutoUploadRunnerCondition('asset loop break (auto upload disabled mid-page)');
              break;
            }
            if (!asset || !asset.id) continue;

            autoUploadNightRunnerHeartbeatMsRef.current = Date.now();

            const manifestId = sha256(`asset:${asset.id}`);
            if (already.has(manifestId)) {
              skipped += 1;
              console.log('AutoUpload: skipping already uploaded asset:', asset.id);
              continue;
            }

            // Cross-device duplicate detection: check filename before uploading
            let assetInfo = null;
            try {
              assetInfo = Platform.OS === 'android'
                ? await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: true })
                : await MediaLibrary.getAssetInfoAsync(asset.id);
            } catch (e) {
              console.warn('AutoUpload: getAssetInfoAsync failed:', asset.id, e?.message);
            }
            if (assetInfo) {
              const assetFilename = normalizeFilenameForCompare(assetInfo.filename || asset.filename);
              if (assetFilename && alreadyFilenames.has(assetFilename)) {
                console.log(`AutoUpload: skipping duplicate filename: ${assetFilename}`);
                skipped += 1;
                continue;
              }
            }

            console.log('AutoUpload: attempting upload for asset:', asset.id);
            const r = await autoUploadStealthCloudUploadOneAsset({
              asset,
              config,
              SERVER_URL,
              existingManifestIds: already,
              fastMode: fastModeEnabledRef.current,
              onStatus: (phase) => {
                if (totalEstimatedCount !== null && !autoUploadNightRunnerCancelRef.current && autoUploadEnabledRef.current) {
                  if (phase === 'encrypting') {
                    setStatus(`Auto-Backup: Encrypting ${cumulativeUploaded + 1}/${totalEstimatedCount}`);
                  } else if (phase === 'uploading') {
                    setStatus(`Auto-Backup: Uploading ${cumulativeUploaded + 1}/${totalEstimatedCount}`);
                  }
                }
              }
            });
            if (r && r.uploaded) {
              uploaded += 1;
              cumulativeUploaded += 1;
              already.add(manifestId);
              // Update status with current progress (only if not cancelled)
              if (totalEstimatedCount !== null && !autoUploadNightRunnerCancelRef.current && autoUploadEnabledRef.current) {
                setStatus(`Auto-Backup: ${cumulativeUploaded}/${totalEstimatedCount} uploaded`);
              }
              console.log('AutoUpload: successfully uploaded asset:', asset.id, 'cumulative:', cumulativeUploaded);
            } else if (r && r.skipped) {
              skipped += 1;
            } else {
              failed += 1;
              console.log('AutoUpload: upload failed for asset:', asset.id);
            }
            
            // CPU cooldown between assets to reduce CPU pressure and phone heating
            const assetCooldown = getThrottleAssetCooldownMs();
            if (assetCooldown > 0) await sleep(assetCooldown);
            
            // Thermal batch limit: long cooling pause every N assets
            const batchLimit = getThrottleBatchLimit();
            const batchCooldown = getThrottleBatchCooldownMs();
            if (batchCooldown > 0 && uploaded > 0 && uploaded % batchLimit === 0) {
              setStatus(`Auto-Backup: Cooling down (batch ${Math.floor(uploaded / batchLimit)})...`);
              await sleep(batchCooldown);
            }
          }

          after = page && page.endCursor ? page.endCursor : null;
          try {
            if (after) await SecureStore.setItemAsync(AUTO_UPLOAD_CURSOR_KEY, after);
          } catch (e) {}
          if (!page || page.hasNextPage !== true || !after) break;
        }

        try {
          if (!after) {
            await SecureStore.deleteItemAsync(AUTO_UPLOAD_CURSOR_KEY);
            // If we completed a full cycle and uploaded nothing, all photos are backed up
            if (uploaded === 0 && totalEstimatedCount !== null) {
              backupCompleted = true;
              setStatus('Auto-Backup: All uploaded and no new files found');
              console.log('AutoUpload: full backup cycle complete, all photos backed up');
            }
          }
        } catch (e) {}

        try {
          await SecureStore.setItemAsync('auto_upload_last_run', new Date().toISOString());
          await SecureStore.setItemAsync('auto_upload_last_summary', JSON.stringify({ uploaded, skipped, failed }));
          // Save cumulative uploaded count for progress tracking across sessions
          await SecureStore.setItemAsync('auto_upload_cumulative_uploaded', cumulativeUploaded.toString());
        } catch (e) {}

        try {
          const nowSummary = Date.now();
          if (!autoUploadSummaryLogMsRef.current || (nowSummary - autoUploadSummaryLogMsRef.current) > 5000) {
            autoUploadSummaryLogMsRef.current = nowSummary;
            console.log('AutoUpload: batch summary', { uploaded, skipped, failed, pageSize, hasMore: !!after });
          }
        } catch (e) {}

        // Back off if nothing uploaded to save battery
        if (uploaded === 0) {
          await sleep(60000);
        } else {
          await sleep(2000);
        }
      }
    } catch (e) {
      console.log('AutoUpload: runner caught exception', e && e.message ? e.message : e);
    } finally {
      if (sessionId === autoUploadNightRunnerSessionIdRef.current) {
        autoUploadNightRunnerActiveRef.current = false;
      }
      console.log('AutoUpload: exiting night runner session', sessionId);
      // Only set paused status if not completed and not disabled by user
      if (!backupCompleted && autoUploadEnabledRef.current) {
        setStatus('Auto-Backup: Paused');
      }

      // Stop Android foreground service
      try {
        if (Platform.OS === 'android' && sessionId === autoUploadNightRunnerSessionIdRef.current) {
          void stopAndroidForegroundUploadService();
        }
      } catch (e) {}
      await deactivateKeepAwakeForAutoUpload();

      // Schedule a quick re-check to pick up newly added photos/videos soon after completion
      if (autoUploadEnabledRef.current && serverTypeRef.current === 'stealthcloud' && tokenRef.current) {
        setTimeout(() => {
          try {
            if (!autoUploadNightRunnerActiveRef.current && !autoUploadNightRunnerStartingRef.current) {
              void maybeStartAutoUploadNightSession();
            }
          } catch (e) {}
        }, 15000);
      }
    }
  };

  const fetchStealthCloudUsage = async () => {
    try {
      const config = await getAuthHeaders();
      const base = getServerUrl();
      const res = await axios.get(`${base}/api/cloud/usage`, { ...config, timeout: 10000 });
      return res && res.data ? res.data : null;
    } catch (e) {
      return null;
    }
  };

  const ensureStealthCloudUploadAllowed = async () => {
    const usage = await fetchStealthCloudUsage();
    const st = usage && usage.subscription ? usage.subscription : null;
    const status = st && st.status ? String(st.status) : 'none';
    if (status === 'active' || status === 'trial') return true;

    if (status === 'grace') {
      showDarkAlert(
        'Subscription Expired',
        `Backups are disabled. You have ${GRACE_PERIOD_DAYS} days to sync your data before access is locked. Renew now to continue backups.`,
        [
          { text: 'Sync Now', onPress: () => openSyncModeChooser() },
          { text: 'Later' }
        ]
      );
      return false;
    }

    if (status === 'grace_expired' || status === 'trial_expired') {
      showDarkAlert(
        'Access Locked',
        'Your subscription has expired. Renew to restore access to your encrypted backups.',
        [
          { text: 'View Plans', onPress: () => setView('about') },
          { text: 'OK' }
        ]
      );
      return false;
    }

    showDarkAlert('Backup disabled', 'Select a plan to enable StealthCloud backups.');
    return false;
  };

  useEffect(() => {
    if (!token || view !== 'home' || serverType !== 'stealthcloud') return;
    if (expiredSubscriptionAlertShownRef.current) return;

    expiredSubscriptionAlertShownRef.current = true;
    (async () => {
      try {
        const usage = await fetchStealthCloudUsage();
        const st = usage && usage.subscription ? usage.subscription : null;
        const status = st && st.status ? String(st.status) : 'none';
        if (status !== 'grace' && status !== 'grace_expired' && status !== 'trial_expired') return;

        showDarkAlert(
          'Subscription Expired',
          `Your plan expired. You have ${GRACE_PERIOD_DAYS} days to sync your data before access is locked. Backups are disabled until you renew.`,
          [
            { text: 'Sync Now', onPress: () => openSyncModeChooser() },
            { text: 'View Plans', onPress: () => setView('about') },
            { text: 'Later' }
          ]
        );
      } catch (e) {
        // ignore
      }
    })();
  }, [token, view, serverType]);

  useEffect(() => {
    const batteryListener = Battery.addBatteryStateListener(async ({ batteryState }) => {
      if (batteryState === Battery.BatteryState.CHARGING) {
        if (autoUploadEnabledRef.current && !autoUploadNightRunnerActiveRef.current && serverTypeRef.current === 'stealthcloud' && tokenRef.current) {
          console.log('Battery plugged in, resuming auto upload');
          setStatus('Auto-Backup: Resumed');
          maybeStartAutoUploadNightSession();
        }
      }
    });
    return () => batteryListener?.remove();
  }, []);

  // stealthCloudUploadEncryptedChunk is now imported from backupManager.js

  const stealthCloudBackupSelected = async ({ assets }) => {
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (!permission || permission.status !== 'granted') {
      showDarkAlert('Permission needed', 'We need access to photos to back them up.');
      return;
    }

    if (Platform.OS === 'ios') {
      const ap = await getMediaLibraryAccessPrivileges(permission);
      if (ap && ap !== 'all') {
          // Proceed with limited access
        setStatus('Limited Photos access (Selected Photos). Backing up accessible items...');
      }
    }

    if (!(await ensureAutoUploadPolicyAllowsWork({ userInitiated: true }))) {
      return;
    }

    const list = Array.isArray(assets) ? assets.filter(a => a && a.id) : [];
    if (list.length === 0) {
      showDarkAlert('Select items', 'Choose photos/videos to back up.');
      return;
    }

    setStatus('Preparing selection...');
    setProgress(0);
    setLoadingSafe(true);
    setBackgroundWarnEligibleSafe(!autoUploadEnabledRef.current);
    setWasBackgroundedDuringWorkSafe(false);

    try {
      const config = await getAuthHeaders();
      const SERVER_URL = getServerUrl();

      const allowed = await ensureStealthCloudUploadAllowed();
      if (!allowed) {
        setLoadingSafe(false);
        setBackgroundWarnEligibleSafe(false);
        return;
      }

      const masterKey = await getStealthCloudMasterKey();
      setStatus('Checking server files...');
      const prepareStartTime = Date.now();

      let existingManifests = [];
      try {
        const listRes = await axios.get(`${SERVER_URL}/api/cloud/manifests`, config);
        existingManifests = (listRes.data && listRes.data.manifests) ? listRes.data.manifests : [];
      } catch (e) {
        existingManifests = [];
      }
      const already = new Set(existingManifests.map(m => m.manifestId));

      // Build filename set by decrypting manifests (for cross-device duplicate detection)
      const alreadyFilenames = new Set();
      if (existingManifests.length > 0) {
        setStatus('Checking server files...');
        for (const m of existingManifests) {
          try {
            const manRes = await axios.get(`${SERVER_URL}/api/cloud/manifests/${m.manifestId}`, { headers: config.headers, timeout: 15000 });
            const payload = manRes.data;
            const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
            const enc = JSON.parse(parsed.encryptedManifest);
            const manifestNonce = naclUtil.decodeBase64(enc.manifestNonce);
            const manifestBox = naclUtil.decodeBase64(enc.manifestBox);
            const manifestPlain = nacl.secretbox.open(manifestBox, manifestNonce, masterKey);
            if (manifestPlain) {
              const manifest = JSON.parse(naclUtil.encodeUTF8(manifestPlain));
              if (manifest.filename) {
                alreadyFilenames.add(normalizeFilenameForCompare(manifest.filename));
              }
            }
          } catch (e) {
            // Skip manifests we can't decrypt
          }
        }
        console.log(`StealthCloud: found ${alreadyFilenames.size} existing filenames for cross-device duplicate detection`);
      }

      // Ensure "Preparing backup..." shows for at least 800ms for professional UX
      const prepareElapsed = Date.now() - prepareStartTime;
      if (prepareElapsed < 800) {
        await sleep(800 - prepareElapsed);
      }

      let uploaded = 0;
      let skipped = 0;
      let failed = 0;

      const totalCount = list.length;
      let processedIndex = 0;

      for (let j = 0; j < list.length; j++) {
        const asset = list[j];
        processedIndex += 1;

        if (!(await ensureAutoUploadPolicyAllowsWorkIfBackgrounded())) {
          break;
        }

        try {
          const manifestId = sha256(`asset:${asset.id}`);
          if (already.has(manifestId)) {
            skipped += 1;
            continue;
          }

          setStatus(`Comparing ${processedIndex}/${totalCount}`);

          let assetInfo;
          try {
            // Retry getAssetInfoAsync up to 3 times (iCloud/network issues)
            assetInfo = await withRetries(async () => {
              return Platform.OS === 'android'
                ? await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: true })
                : await MediaLibrary.getAssetInfoAsync(asset.id);
            }, { retries: 5, baseDelayMs: 1000, maxDelayMs: 15000, shouldRetry: () => true });
          } catch (e) {
            console.warn('getAssetInfoAsync failed after retries:', asset.id, e?.message);
            failed += 1;
            continue;
          }

          // Cross-device duplicate detection: skip if filename already exists on server
          const assetFilename = normalizeFilenameForCompare(assetInfo.filename || asset.filename);
          if (assetFilename && alreadyFilenames.has(assetFilename)) {
            console.log(`StealthCloud: skipping duplicate filename: ${assetFilename}`);
            skipped += 1;
            continue;
          }

          setStatus(`Encrypting ${processedIndex}/${totalCount}`);

          let filePath, tmpCopied, tmpUri;
          try {
            const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo });
            filePath = resolved.filePath;
            tmpCopied = resolved.tmpCopied;
            tmpUri = resolved.tmpUri;
          } catch (e) {
            console.warn('resolveReadableFilePath failed:', asset.id, e?.message);
            failed += 1;
            continue;
          }

          const fileKey = new Uint8Array(32);
          global.crypto.getRandomValues(fileKey);
          const baseNonce16 = new Uint8Array(16);
          global.crypto.getRandomValues(baseNonce16);

          const wrapNonce = new Uint8Array(24);
          global.crypto.getRandomValues(wrapNonce);
          const wrappedKey = nacl.secretbox(fileKey, wrapNonce, masterKey);

          let chunkIndex = 0;
          const chunkIds = [];
          const chunkSizes = [];

          let originalSize = null;
          let chunkPlainBytes = null;
          const chunkUploadsInFlight = new Set();
          let runChunkUpload = null;
          let maxChunkUploadsInFlight = 1;

          if (Platform.OS === 'ios') {
            const fileUri = filePath.startsWith('/') ? `file://${filePath}` : (filePath || tmpUri);
            try {
              const info = await FileSystem.getInfoAsync(fileUri);
              originalSize = info && typeof info.size === 'number' ? Number(info.size) : null;
            } catch (e) {
              originalSize = null;
            }

            setStatus(
              originalSize
                ? `Encrypting ${processedIndex}/${totalCount || '?'} • ${formatBytesHumanDecimal(originalSize)}`
                : `Encrypting ${processedIndex}/${totalCount || '?'}`
            );

            maxChunkUploadsInFlight = Math.max(1, chooseStealthCloudMaxParallelChunkUploads({ platform: 'ios', originalSize, fastMode: fastModeEnabledRef.current }));
            runChunkUpload = createConcurrencyLimiter(maxChunkUploadsInFlight);

            chunkPlainBytes = chooseStealthCloudChunkBytes({ platform: 'ios', originalSize, fastMode: fastModeEnabledRef.current });
            const effectiveBytes = chunkPlainBytes - (chunkPlainBytes % 3);

            let position = 0;
            while (true) {
              let nextB64 = '';
              try {
                nextB64 = await FileSystem.readAsStringAsync(fileUri, {
                  encoding: FileSystem.EncodingType.Base64,
                  position,
                  length: effectiveBytes
                });
              } catch (e) {
                const allB64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
                const b64Offset = Math.floor((position / 3) * 4);
                const chunkB64Len = (effectiveBytes / 3) * 4;
                nextB64 = allB64.slice(b64Offset, b64Offset + chunkB64Len);
              }
              if (!nextB64) break;
              const plaintext = naclUtil.decodeBase64(nextB64);
              if (!plaintext || plaintext.length === 0) break;

              const nonce = makeChunkNonce(baseNonce16, chunkIndex);
              await throttleEncryption(chunkIndex); // CPU throttle to prevent overheating
              const boxed = nacl.secretbox(plaintext, nonce, fileKey);
              const chunkId = sha256.create().update(boxed).hex();
              // Switch to "Uploading" status after first chunk encrypted
              if (chunkIndex === 0) {
                setStatus(`Uploading ${processedIndex}/${totalCount}`);
              }
              await trackInFlightPromise(
                chunkUploadsInFlight,
                runChunkUpload(() => stealthCloudUploadEncryptedChunk({ SERVER_URL, config, chunkId, encryptedBytes: boxed })),
                maxChunkUploadsInFlight
              );
              chunkIds.push(chunkId);
              chunkSizes.push(plaintext.length);
              chunkIndex += 1;
              position += plaintext.length;
              // Update progress: file progress + chunk progress within current file
              if (totalCount) {
                const fileProgress = (processedIndex - 1) / totalCount;
                const chunkProgress = originalSize ? (position / originalSize) / totalCount : 0;
                setProgress(Math.min(fileProgress + chunkProgress, 1));
              }

              if (plaintext.length < effectiveBytes) {
                break;
              }
            }
          } else {
            let ReactNativeBlobUtil = null;
            try {
              const mod = require('react-native-blob-util');
              ReactNativeBlobUtil = mod && (mod.default || mod);
            } catch (e) {
              ReactNativeBlobUtil = null;
            }
            if (!ReactNativeBlobUtil || !ReactNativeBlobUtil.fs || typeof ReactNativeBlobUtil.fs.readStream !== 'function') {
              throw new Error('StealthCloud backup requires a development build (react-native-blob-util).');
            }

            const stat = await ReactNativeBlobUtil.fs.stat(filePath);
            originalSize = stat && stat.size ? Number(stat.size) : null;

            setStatus(
              originalSize
                ? `Encrypting ${processedIndex}/${totalCount || '?'} • ${formatBytesHumanDecimal(originalSize)}`
                : `Encrypting ${processedIndex}/${totalCount || '?'}`
            );
            maxChunkUploadsInFlight = Math.max(1, chooseStealthCloudMaxParallelChunkUploads({ platform: 'android', originalSize, fastMode: fastModeEnabledRef.current }));
            runChunkUpload = createConcurrencyLimiter(maxChunkUploadsInFlight);
            chunkPlainBytes = chooseStealthCloudChunkBytes({ platform: 'android', originalSize, fastMode: fastModeEnabledRef.current });
            const stream = await ReactNativeBlobUtil.fs.readStream(filePath, 'base64', chunkPlainBytes);
            let bytesProcessedInFile = 0;

            await new Promise((resolve, reject) => {
              const queue = [];
              let draining = false;
              let ended = false;

              stream.open();

              stream.onData((chunkB64) => {
                queue.push(chunkB64);
                if (draining) return;
                draining = true;

                (async () => {
                  try {
                    while (queue.length) {
                      const nextB64 = queue.shift();
                      const plaintext = naclUtil.decodeBase64(nextB64);
                      const nonce = makeChunkNonce(baseNonce16, chunkIndex);
                      await throttleEncryption(chunkIndex); // CPU throttle to prevent overheating
                      const boxed = nacl.secretbox(plaintext, nonce, fileKey);
                      const chunkId = sha256.create().update(boxed).hex();
                      // Switch to "Uploading" status after first chunk encrypted
                      if (chunkIndex === 0) {
                        setStatus(`Uploading ${processedIndex}/${totalCount}`);
                      }
                      await trackInFlightPromise(
                        chunkUploadsInFlight,
                        runChunkUpload(() => stealthCloudUploadEncryptedChunk({ SERVER_URL, config, chunkId, encryptedBytes: boxed })),
                        maxChunkUploadsInFlight
                      );

                      chunkIds.push(chunkId);
                      chunkSizes.push(plaintext.length);
                      chunkIndex += 1;
                      bytesProcessedInFile += plaintext.length;
                      // Update progress: file progress + chunk progress within current file
                      if (totalCount) {
                        const fileProgress = (processedIndex - 1) / totalCount;
                        const chunkProgress = originalSize ? (bytesProcessedInFile / originalSize) / totalCount : 0;
                        setProgress(Math.min(fileProgress + chunkProgress, 1));
                      }

                      if (chunkIndex % 8 === 0) {
                        await yieldToUi();
                      }
                    }
                  } catch (e) {
                    reject(e);
                    return;
                  } finally {
                    draining = false;
                  }

                  if (ended && queue.length === 0) {
                    resolve();
                  }
                })();
              });

              stream.onError((e) => reject(e));
              stream.onEnd(() => {
                ended = true;
                if (!draining && queue.length === 0) {
                  resolve();
                }
              });
            });
          }

          await drainInFlightPromises(chunkUploadsInFlight);

          if (!chunkIds.length) {
            throw new Error('StealthCloud backup read 0 bytes (no chunks).');
          }

          const manifest = {
            v: 1,
            assetId: asset.id,
            filename: assetInfo.filename || asset.filename || null,
            mediaType: asset.mediaType || null,
            originalSize,
            baseNonce16: naclUtil.encodeBase64(baseNonce16),
            wrapNonce: naclUtil.encodeBase64(wrapNonce),
            wrappedFileKey: naclUtil.encodeBase64(wrappedKey),
            chunkIds,
            chunkSizes
          };

          const manifestPlain = naclUtil.decodeUTF8(JSON.stringify(manifest));
          const manifestNonce = new Uint8Array(24);
          global.crypto.getRandomValues(manifestNonce);
          const manifestBox = nacl.secretbox(manifestPlain, manifestNonce, masterKey);
          const encryptedManifest = JSON.stringify({
            manifestNonce: naclUtil.encodeBase64(manifestNonce),
            manifestBox: naclUtil.encodeBase64(manifestBox)
          });

          // Retry manifest upload up to 3 times
          await withRetries(async () => {
            await axios.post(
              `${SERVER_URL}/api/cloud/manifests`,
              { manifestId, encryptedManifest, chunkCount: chunkIds.length },
              { headers: config.headers, timeout: 30000 }
            );
          }, {
            retries: 10,
            baseDelayMs: 1000,
            maxDelayMs: 30000,
            shouldRetry: shouldRetryChunkUpload
          });
          uploaded += 1;

          if (tmpCopied && tmpUri) {
            await FileSystem.deleteAsync(tmpUri, { idempotent: true });
          }
          
          // CPU cooldown between assets to reduce phone heating
          const assetCooldown = getThrottleAssetCooldownMs();
          if (assetCooldown > 0) await sleep(assetCooldown);
          
          // Thermal batch limit: long cooling pause every N assets
          const batchLimit = getThrottleBatchLimit();
          if (uploaded > 0 && uploaded % batchLimit === 0) {
            await thermalCooldownPause(Math.floor(uploaded / batchLimit));
          }
        } catch (e) {
          failed += 1;
          continue;
        }
      }

      if (uploaded === 0 && skipped === 0 && failed === 0) {
        setStatus(
          Platform.OS === 'ios'
            ? 'No photos visible to the app yet. If you chose "Selected Photos" / Limited access, pick photos or switch to Full Access in iOS Settings.'
            : 'No items processed'
        );
        return;
      }

      setStatus('Backup complete');
      showDarkAlert('Backup Complete', `Uploaded: ${uploaded}\nSkipped: ${skipped}\nFailed: ${failed}`);
    } catch (e) {
      console.error('StealthCloud backup error:', e);
      setStatus('Backup error');
      showDarkAlert('Backup Error', e && e.message ? e.message : 'Unknown error');
    } finally {
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setProgress(0);
    }
  };

  const backupSelectedAssets = async ({ assets }) => {
    const list = Array.isArray(assets) ? assets.filter(a => a && a.id) : [];
    if (list.length === 0) {
      showDarkAlert('Select items', 'Choose photos/videos to back up.');
      return;
    }

    if (!(await ensureAutoUploadPolicyAllowsWork({ userInitiated: true }))) {
      return;
    }

    if (serverType === 'stealthcloud') {
      return stealthCloudBackupSelected({ assets: list });
    }

    const { status: permStatus } = await MediaLibrary.requestPermissionsAsync();
    if (permStatus !== 'granted') {
      showDarkAlert('Permission needed', 'We need access to photos to back them up.');
      return;
    }

    setStatus('Preparing selection...');
    setProgress(0);
    setLoadingSafe(true);
    setBackgroundWarnEligibleSafe(!autoUploadEnabledRef.current);
    setWasBackgroundedDuringWorkSafe(false);

    try {
      setStatus('Checking server files...');
      const config = await getAuthHeaders();
      const SERVER_URL = getServerUrl();
      const serverRes = await axios.get(`${SERVER_URL}/api/files`, config);
      const serverFiles = new Set(
        (serverRes.data.files || [])
          .map(f => normalizeFilenameForCompare(f && f.filename ? f.filename : null))
          .filter(Boolean)
      );

      const albums = await MediaLibrary.getAlbumsAsync();
      const photoSyncAlbum = findFirstAlbumByTitle(albums, [PHOTO_ALBUM_NAME, LEGACY_PHOTO_ALBUM_NAME]);
      let excludedIds = new Set();
      if (photoSyncAlbum) {
        excludedIds = await buildLocalAssetIdSetPaged({ album: photoSyncAlbum });
      }

      const toUpload = [];
      for (let i = 0; i < list.length; i++) {
        const asset = list[i];
        setStatus(`Comparing ${i + 1}/${list.length}`);
        if (excludedIds.has(asset.id)) continue;

        let actualFilename = normalizeFilenameForCompare(asset && asset.filename ? asset.filename : null);
        if (Platform.OS === 'ios' || !actualFilename) {
          try {
            const info = await MediaLibrary.getAssetInfoAsync(asset.id);
            actualFilename = normalizeFilenameForCompare(info && info.filename ? info.filename : null) || actualFilename;
          } catch (e) {
            actualFilename = actualFilename;
          }
        }

        if (!actualFilename) continue;
        if (serverFiles.has(actualFilename)) continue;
        toUpload.push(asset);
      }

      if (toUpload.length === 0) {
        setStatus('Up to date');
        showDarkAlert('Up to Date', 'All selected items are already on the server (or were excluded).');
        return;
      }

      // Show summary before starting
      setStatus(`Ready to backup ${toUpload.length} of ${list.length} files...`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause to show message

      let successCount = 0;
      let failedCount = 0;

      for (let i = 0; i < toUpload.length; i++) {
        const asset = toUpload[i];
        try {
          if (!(await ensureAutoUploadPolicyAllowsWorkIfBackgrounded())) {
            break;
          }
          setStatus(`Uploading ${i + 1}/${toUpload.length}`);

          const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
          const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo });
          const filePath = resolved && resolved.filePath ? resolved.filePath : null;
          if (!filePath) {
            failedCount++;
            continue;
          }

          const actualFilename = assetInfo.filename || asset.filename;
          const mime = getMimeFromFilename(actualFilename, asset.mediaType);
          const fileUri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;

          // iOS: use FOREGROUND for HTTP since background sessions require HTTPS
          const isHttps = SERVER_URL.startsWith('https://');
          const sessionType = (Platform.OS === 'ios' && !isHttps) 
            ? FileSystem.FileSystemSessionType.FOREGROUND 
            : FileSystem.FileSystemSessionType.BACKGROUND;
          const uploadRes = await FileSystem.uploadAsync(`${SERVER_URL}/api/upload/raw`, fileUri, {
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            sessionType,
            headers: {
              ...config.headers,
              'Content-Type': mime,
              'X-Filename': actualFilename,
            }
          });

          // Check HTTP status - uploadAsync doesn't throw on 4xx/5xx errors
          if (!uploadRes || uploadRes.status < 200 || uploadRes.status >= 300) {
            console.error(`✗ Upload failed for ${actualFilename}: HTTP ${uploadRes?.status || 'unknown'} - ${uploadRes?.body || 'no response'}`);
            failedCount++;
            continue;
          }

          successCount++;
        } catch (e) {
          failedCount++;
        }
      }

      const skippedCount = list.length - toUpload.length;
      setStatus('Backup complete');
      showDarkAlert('Backup Complete', `Uploaded: ${successCount}\nSkipped: ${skippedCount}\nFailed: ${failedCount}`);
    } catch (error) {
      setStatus('Backup error');
      showDarkAlert('Backup Error', error && error.message ? error.message : 'Unknown error');
    } finally {
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setWasBackgroundedDuringWorkSafe(false);
      setProgress(0);
    }
  };

  const setBackgroundWarnEligibleSafe = (value) => {
    backgroundWarnEligibleRef.current = value;
    setBackgroundWarnEligible(value);
    if (!value) { wasBackgroundedDuringWorkRef.current = false; setWasBackgroundedDuringWork(false); backgroundedAtMsRef.current = 0; }
  };

  const purgeStealthCloudData = async () => {
    if (loadingRef.current) return;
    if (!token) {
      setStatus('Please login');
      return;
    }

    showDarkAlert(
      'Delete all data on server?',
      'This will permanently delete your encrypted StealthCloud chunks and manifests for this device/account. This cannot be undone.',
      [
        { text: 'Cancel' },
        {
          text: 'Delete',
          onPress: async () => {
            try {
              setLoadingSafe(true);
              setBackgroundWarnEligibleSafe(false);
              setWasBackgroundedDuringWorkSafe(false);
              setStatus('Deleting cloud data...');

              const SERVER_URL = getServerUrl();
              const config = await getAuthHeaders();
              const res = await axios.post(`${SERVER_URL}/api/cloud/purge`, {}, config);
              const deleted = res && res.data && res.data.deleted ? res.data.deleted : null;
              const chunks = deleted && typeof deleted.chunks === 'number' ? deleted.chunks : null;
              const manifests = deleted && typeof deleted.manifests === 'number' ? deleted.manifests : null;
              const msg = 'All your files were successfully deleted from StealthCloud.';
              if (chunks !== null || manifests !== null) {
                console.log('[StealthCloud] Purge deleted:', { chunks, manifests });
              }
              setStatus('Cloud data deleted');
              showDarkAlert('Deleted', msg);
            } catch (e) {
              const m = e && e.response && e.response.data && e.response.data.error
                ? e.response.data.error
                : (e && e.message ? e.message : 'Unknown error');
              setStatus('Delete failed');
              showDarkAlert('Error', m);
            } finally {
              setLoadingSafe(false);
            }
          }
        }
      ]
    );
  };

  const purgeClassicServerData = async () => {
    if (loadingRef.current) return;
    if (!token) {
      setStatus('Please login');
      return;
    }

    showDarkAlert(
      'Delete all data on server?',
      'This will permanently delete your uploaded photos and videos from your server for this device/account. This cannot be undone.',
      [
        { text: 'Cancel' },
        {
          text: 'Delete',
          onPress: async () => {
            try {
              setLoadingSafe(true);
              setBackgroundWarnEligibleSafe(false);
              setWasBackgroundedDuringWorkSafe(false);
              setStatus('Deleting server files...');

              const SERVER_URL = getServerUrl();
              const config = await getAuthHeaders();
              const res = await axios.post(`${SERVER_URL}/api/files/purge`, {}, config);
              const deleted = res && res.data && res.data.deleted ? res.data.deleted : null;
              const files = deleted && typeof deleted.files === 'number' ? deleted.files : null;
              if (files !== null) {
                console.log('[Classic] Purge deleted:', { files });
              }
              setStatus('Server files deleted');
              showDarkAlert('Deleted', 'All your files were successfully deleted from your server.');
            } catch (e) {
              const m = e && e.response && e.response.data && e.response.data.error
                ? e.response.data.error
                : (e && e.message ? e.message : 'Unknown error');
              setStatus('Delete failed');
              showDarkAlert('Error', m);
            } finally {
              setLoadingSafe(false);
            }
          }
        }
      ]
    );
  };

  const setWasBackgroundedDuringWorkSafe = (value) => { wasBackgroundedDuringWorkRef.current = value; setWasBackgroundedDuringWork(value); };

  const resetBackupPickerState = () => { setBackupPickerAssets([]); setBackupPickerAfter(null); setBackupPickerHasNext(true); setBackupPickerLoading(false); setBackupPickerSelected({}); };
  const openBackupModeChooser = () => { if (loadingRef.current) return; setBackupModeOpen(true); };
  const closeBackupModeChooser = () => setBackupModeOpen(false);

  const loadBackupPickerPage = async ({ reset }) => {
    if (backupPickerLoading) return;
    if (!reset && !backupPickerHasNext) return;
    setBackupPickerLoading(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (permission.status !== 'granted') { showDarkAlert('Permission needed', 'We need access to photos to back them up.'); return; }
      const first = 60;
      const after = reset ? null : backupPickerAfter;
      const page = await MediaLibrary.getAssetsAsync({ first, after: after || undefined, mediaType: ['photo', 'video'] });
      const assets = page && Array.isArray(page.assets) ? page.assets : [];
      setBackupPickerAssets(prev => reset ? assets : prev.concat(assets));
      setBackupPickerAfter(page && page.endCursor ? page.endCursor : null);
      setBackupPickerHasNext(!!(page && page.hasNextPage));
    } catch (e) {} finally { setBackupPickerLoading(false); }
  };

  const openBackupPicker = async () => { if (loadingRef.current) return; resetBackupPickerState(); setBackupPickerOpen(true); await loadBackupPickerPage({ reset: true }); };
  const closeBackupPicker = () => { setBackupPickerOpen(false); resetBackupPickerState(); };

  const toggleBackupPickerSelected = (assetId) => {
    if (!assetId) return;
    setBackupPickerSelected(prev => { const next = { ...prev }; if (next[assetId]) delete next[assetId]; else next[assetId] = true; return next; });
  };

  const getSelectedPickerAssets = () => {
    const selectedIds = backupPickerSelected && typeof backupPickerSelected === 'object' ? Object.keys(backupPickerSelected).filter(k => backupPickerSelected[k]) : [];
    if (selectedIds.length === 0) return [];
    const setIds = new Set(selectedIds);
    return (backupPickerAssets || []).filter(a => a && a.id && setIds.has(a.id));
  };

  const resetSyncPickerState = () => { setSyncPickerItems([]); setSyncPickerTotal(0); setSyncPickerOffset(0); setSyncPickerLoading(false); setSyncPickerLoadingMore(false); setSyncPickerSelected({}); setSyncPickerAuthHeaders(null); syncPickerLocalFilenamesRef.current = null; };
  const openSyncModeChooser = () => { if (loadingRef.current) return; setSyncModeOpen(true); };
  const closeSyncModeChooser = () => setSyncModeOpen(false);
  const openCleanupModeChooser = () => { if (loadingRef.current) return; setCleanupModeOpen(true); };
  const closeCleanupModeChooser = () => setCleanupModeOpen(false);
  const closeSimilarReview = () => { setSimilarReviewOpen(false); setSimilarGroups([]); setSimilarGroupIndex(0); setSimilarSelected({}); };

  const buildDefaultSimilarSelection = (group) => {
    const items = Array.isArray(group) ? group : [];
    const next = {};
    for (let i = 1; i < items.length; i++) { const id = items[i] && items[i].id ? String(items[i].id) : ''; if (id) next[id] = true; }
    return next;
  };

  const openSimilarGroup = ({ groups, index }) => {
    const g = Array.isArray(groups) ? groups : [];
    const i = typeof index === 'number' ? index : 0;
    setSimilarGroups(g); setSimilarGroupIndex(i); setSimilarSelected(buildDefaultSimilarSelection(g[i] || [])); setSimilarReviewOpen(true);
  };

  const toggleSimilarSelected = (assetId) => {
    const key = assetId ? String(assetId) : '';
    if (!key) return;
    setSimilarSelected(prev => { const next = { ...(prev || {}) }; if (next[key]) delete next[key]; else next[key] = true; return next; });
  };

  const getSimilarSelectedIds = () => {
    const sel = similarSelected && typeof similarSelected === 'object' ? similarSelected : {};
    return Object.keys(sel).filter(k => sel[k]);
  };

  const advanceSimilarGroup = ({ groups, nextIndex }) => {
    const g = Array.isArray(groups) ? groups : [];
    const i = typeof nextIndex === 'number' ? nextIndex : 0;
    if (i >= g.length) { closeSimilarReview(); setStatus('Cleanup complete'); showDarkAlert('Similar Photos', 'Review complete.'); return; }
    openSimilarGroup({ groups: g, index: i });
  };

  const startSimilarShotsReview = async () => {
    setBackgroundWarnEligibleSafe(false); setWasBackgroundedDuringWorkSafe(false); setLoadingSafe(true);
    setStatus('Scanning for similar photos...');
    try {
      // Check permission first
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        throw new Error('Photos permission not granted');
      }
      if (Platform.OS === 'ios' && permission.accessPrivileges && permission.accessPrivileges !== 'all') {
        throw new Error('Limited Photos Access. Please allow Full Access.');
      }

      // Use duplicateScanner module
      const DuplicateScanner = require('./duplicateScanner').default;
      const groups = await DuplicateScanner.scanSimilarPhotos({
        resolveReadableFilePath,
        onProgress: (current, total, status) => {
          setStatus(status || `Analyzing ${current}/${total} photos...`);
        }
      });

      if (!groups || groups.length === 0) { 
        setStatus('No similar photos'); 
        showDarkAlert('Similar Photos', 'No similar photo groups found.'); 
        setLoadingSafe(false); 
        return; 
      }
      setLoadingSafe(false);
      openSimilarGroup({ groups, index: 0 });
    } catch (e) {
      setLoadingSafe(false);
      showDarkAlert('Similar Photos', e?.message || 'Could not scan for similar photos.');
    }
  };

  const openSyncPicker = async () => {
    if (loadingRef.current) return;
    resetSyncPickerState(); setSyncPickerOpen(true); setSyncPickerLoading(true);
    try {
      const config = await getAuthHeaders();
      setSyncPickerAuthHeaders(config.headers || {});
      const SERVER_URL = getServerUrl();

      // Build local filename index to filter out files that already exist on device
      const localIndex = await buildLocalFilenameSetPaged({ mediaType: ['photo', 'video'] });
      const localFilenames = localIndex.set;
      syncPickerLocalFilenamesRef.current = localFilenames;
      console.log('Sync picker: local files on device:', localFilenames.size);

      const pageLimit = SYNC_PICKER_PAGE_SIZE;
      let nextOffset = 0;

      if (serverType === 'stealthcloud') {
        const masterKey = await getStealthCloudMasterKey();
        const out = [];
        let total = 0;
        let decryptSuccess = 0;
        let decryptFail = 0;

        // Fetch first page of manifests
        const listRes = await axios.get(`${SERVER_URL}/api/cloud/manifests`, { ...config, params: { offset: nextOffset, limit: pageLimit } });
        const manifests = (listRes.data && listRes.data.manifests) || [];
        total = typeof listRes.data?.total === 'number' ? listRes.data.total : manifests.length;
        setSyncPickerTotal(total);
        console.log(`Sync picker: fetched ${manifests.length} manifest IDs from server (total: ${total})`);

        for (const m of manifests) {
          const mid = m && m.manifestId ? String(m.manifestId) : '';
          if (!mid) continue;
          try {
            const manRes = await axios.get(`${SERVER_URL}/api/cloud/manifests/${mid}`, { headers: config.headers, timeout: 15000 });
            const payload = manRes.data;
            const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
            const enc = JSON.parse(parsed.encryptedManifest);
            const manifestNonce = naclUtil.decodeBase64(enc.manifestNonce);
            const manifestBox = naclUtil.decodeBase64(enc.manifestBox);
            const manifestPlain = nacl.secretbox.open(manifestBox, manifestNonce, masterKey);
            if (!manifestPlain) {
              decryptFail++;
              console.log(`Sync picker: decrypt returned null for ${mid} (wrong key?)`);
              // Still add item with manifestId as filename so user can see it
              out.push({ manifestId: mid, filename: `[encrypted] ${mid.slice(0, 12)}...`, size: null, mediaType: 'photo', assetId: null, decryptFailed: true });
              continue;
            }
            const manifest = JSON.parse(naclUtil.encodeUTF8(manifestPlain));
            const originalFilename = manifest.filename || manifest.name || manifest.originalFilename || null;
            const ext = (originalFilename || '').split('.').pop()?.toLowerCase() || '';
            const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'm4v', '3gp', 'webm'].includes(ext);
            const detectedMediaType = manifest.mediaType || (isVideo ? 'video' : 'photo');
            const item = { manifestId: mid, filename: originalFilename || mid, size: manifest.originalSize || manifest.size || null, mediaType: detectedMediaType, assetId: manifest.assetId || null };
            out.push(item);
            decryptSuccess++;
          } catch (e) {
            decryptFail++;
            console.log('Sync picker: manifest fetch/parse failed for', mid, e.message);
            // Still add item so user sees something
            out.push({ manifestId: mid, filename: `[error] ${mid.slice(0, 12)}...`, size: null, mediaType: 'photo', assetId: null, decryptFailed: true });
          }
        }

        nextOffset = manifests.length;
        console.log(`Sync picker: loaded ${out.length} items (${decryptSuccess} decrypted, ${decryptFail} failed) offset ${nextOffset}/${total}`);
        setSyncPickerItems(out);
        setSyncPickerOffset(nextOffset);
      } else {
        const out = [];
        let total = 0;

        // Fetch first page of files
        const res = await axios.get(`${SERVER_URL}/api/files`, { ...config, params: { offset: nextOffset, limit: pageLimit } });
        const serverFiles = res?.data?.files || [];
        total = typeof res?.data?.total === 'number' ? res.data.total : serverFiles.length;
        setSyncPickerTotal(total);

        for (const f of serverFiles) {
          out.push(f);
        }

        nextOffset = serverFiles.length;
        console.log(`Sync picker: loaded ${out.length} items (offset ${nextOffset}/${total})`);
        setSyncPickerItems(out);
        setSyncPickerOffset(nextOffset);
      }
    } catch (e) {
      setSyncPickerItems([]);
      setSyncPickerTotal(0);
      setSyncPickerOffset(0);
      const detail = e?.response?.data?.error || e?.message || 'Unknown error';
      showDarkAlert('Sync list failed', detail);
    } finally { setSyncPickerLoading(false); }
  };
  
  const loadMoreSyncPickerItems = () => {
    if (syncPickerLoadingMore || syncPickerLoading) return;
    setSyncPickerLoadingMore(true);
    (async () => {
      try {
        const config = await getAuthHeaders();
        const SERVER_URL = getServerUrl();
        const pageLimit = SYNC_PICKER_PAGE_SIZE;
        const nextOffset = syncPickerOffset;
        const out = [];

        if (serverType === 'stealthcloud') {
          const listRes = await axios.get(`${SERVER_URL}/api/cloud/manifests`, { ...config, params: { offset: nextOffset, limit: pageLimit } });
          const manifests = (listRes.data && listRes.data.manifests) || [];
          const total = typeof listRes.data?.total === 'number' ? listRes.data.total : syncPickerTotal;
          if (total !== syncPickerTotal) setSyncPickerTotal(total);
          const masterKey = await getStealthCloudMasterKey();
          let decryptSuccess = 0;
          let decryptFail = 0;

          for (const m of manifests) {
            const mid = m && m.manifestId ? String(m.manifestId) : '';
            if (!mid) continue;
            try {
              const manRes = await axios.get(`${SERVER_URL}/api/cloud/manifests/${mid}`, { headers: config.headers, timeout: 15000 });
              const payload = manRes.data;
              const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
              const enc = JSON.parse(parsed.encryptedManifest);
              const manifestNonce = naclUtil.decodeBase64(enc.manifestNonce);
              const manifestBox = naclUtil.decodeBase64(enc.manifestBox);
              const manifestPlain = nacl.secretbox.open(manifestBox, manifestNonce, masterKey);
              if (!manifestPlain) {
                decryptFail++;
                out.push({ manifestId: mid, filename: `[encrypted] ${mid.slice(0, 12)}...`, size: null, mediaType: 'photo', assetId: null, decryptFailed: true });
                continue;
              }
              const manifest = JSON.parse(naclUtil.encodeUTF8(manifestPlain));
              const originalFilename = manifest.filename || manifest.name || manifest.originalFilename || null;
              const ext = (originalFilename || '').split('.').pop()?.toLowerCase() || '';
              const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'm4v', '3gp', 'webm'].includes(ext);
              const detectedMediaType = manifest.mediaType || (isVideo ? 'video' : 'photo');
              const item = { manifestId: mid, filename: originalFilename || mid, size: manifest.originalSize || manifest.size || null, mediaType: detectedMediaType, assetId: manifest.assetId || null };
              out.push(item);
              decryptSuccess++;
            } catch (e) {
              decryptFail++;
              out.push({ manifestId: mid, filename: `[error] ${mid.slice(0, 12)}...`, size: null, mediaType: 'photo', assetId: null, decryptFailed: true });
            }
          }

          setSyncPickerOffset(nextOffset + manifests.length);
          console.log(`Sync picker: loaded ${out.length} more items (${decryptSuccess} ok, ${decryptFail} failed) offset ${nextOffset + manifests.length}/${total}`);
        } else {
          const res = await axios.get(`${SERVER_URL}/api/files`, { ...config, params: { offset: nextOffset, limit: pageLimit } });
          const serverFiles = res?.data?.files || [];
          const total = typeof res?.data?.total === 'number' ? res.data.total : syncPickerTotal;
          if (total !== syncPickerTotal) setSyncPickerTotal(total);

          for (const f of serverFiles) {
            out.push(f);
          }

          setSyncPickerOffset(nextOffset + serverFiles.length);
          console.log(`Sync picker: loaded ${out.length} more items (offset ${nextOffset + serverFiles.length}/${total})`);
        }

        if (out.length > 0) {
          setSyncPickerItems(prev => [...prev, ...out]);
        }
      } catch (e) {
        console.log('Sync picker: load more failed', e.message);
      } finally {
        setSyncPickerLoadingMore(false);
      }
    })();
  };
  
  const syncPickerHasMore = (syncPickerTotal > 0 && syncPickerOffset < syncPickerTotal);

  const closeSyncPicker = () => { setSyncPickerOpen(false); resetSyncPickerState(); };

  const toggleSyncPickerSelected = (key) => {
    if (!key) return;
    setSyncPickerSelected(prev => { const next = { ...prev }; if (next[key]) delete next[key]; else next[key] = true; return next; });
  };

  const getSelectedSyncKeys = () => {
    const selected = syncPickerSelected && typeof syncPickerSelected === 'object' ? Object.keys(syncPickerSelected).filter(k => syncPickerSelected[k]) : [];
    return selected;
  };

  useEffect(() => { checkLogin(); }, []);

  // Initialize RevenueCat when app starts
  useEffect(() => {
    (async () => {
      try {
        await initializePurchases();
        await loadAvailablePlans();
        await refreshSubscriptionStatus();
      } catch (e) {
        console.log('RevenueCat init skipped:', e.message);
      }
    })();
  }, []);

  // Re-identify user and refresh subscription when email changes
  useEffect(() => {
    if (!email) return;
    (async () => {
      try {
        await identifyPurchasesUser(email);
        await refreshSubscriptionStatus();
      } catch (e) {
        console.log('RevenueCat identify skipped:', e.message);
      }
    })();
  }, [email]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!autoUploadEnabledRef.current) {
          const isRegistered = await TaskManager.isTaskRegisteredAsync(AUTO_UPLOAD_BACKGROUND_TASK);
          if (isRegistered) {
            await BackgroundFetch.unregisterTaskAsync(AUTO_UPLOAD_BACKGROUND_TASK);
          }
          return;
        }

        const status = await BackgroundFetch.getStatusAsync();
        if (status !== BackgroundFetch.BackgroundFetchStatus.Available) {
          return;
        }

        const isRegistered = await TaskManager.isTaskRegisteredAsync(AUTO_UPLOAD_BACKGROUND_TASK);
        if (!isRegistered) {
          await BackgroundFetch.registerTaskAsync(AUTO_UPLOAD_BACKGROUND_TASK, {
            minimumInterval: 60 * 5,
            stopOnTerminate: false,
            startOnBoot: true
          });
        }
      } catch (e) {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [autoUploadEnabled]);

  useEffect(() => {
    backgroundWarnEligibleRef.current = backgroundWarnEligible;
  }, [backgroundWarnEligible]);

  useEffect(() => {
    wasBackgroundedDuringWorkRef.current = wasBackgroundedDuringWork;
  }, [wasBackgroundedDuringWork]);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    if (view !== 'home') return;
    if (loading) return;
    if (autoUploadNightRunnerActiveRef.current) return;
    setProgress(0);
    setStatus(`Idle • ${fastModeEnabled ? 'Fast' : 'Slow'} Mode`);
  }, [loading, view, status, fastModeEnabled]);

  useEffect(() => {
    if (loading && !autoUploadEnabledRef.current) {
      KeepAwake.activateKeepAwakeAsync('photolynk-work');
      return;
    }
    KeepAwake.deactivateKeepAwake('photolynk-work');
  }, [loading]);

  // AppState listener: handles background warnings and auto-upload recovery
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      if (backgroundWarnEligibleRef.current && loadingRef.current && nextState === 'background') {
        backgroundedAtMsRef.current = Date.now();
        wasBackgroundedDuringWorkRef.current = true;
        setWasBackgroundedDuringWorkSafe(true);
        return;
      }

      // Try to restart auto-upload runner when app returns to foreground
      if (nextState === 'active') {
        try {
          console.log('AutoUpload: app returned to foreground, attempting runner restart');
          scheduleNextAutoUploadNightKick();
          if (autoUploadEnabledRef.current && serverTypeRef.current === 'stealthcloud' && tokenRef.current) {
            // If runner is already active, don't change status
            if (!autoUploadNightRunnerActiveRef.current) {
              void maybeStartAutoUploadNightSession();
            }
          }
        } catch (e) {
          // ignore
        }

        if (!loadingRef.current && !autoUploadNightRunnerActiveRef.current) {
          setProgress(0);
          setStatus('Idle');
        }
      }
      
      // iOS: show paused status when backgrounded (Android has foreground service)
      if (Platform.OS === 'ios' && nextState === 'background' && autoUploadEnabledRef.current && serverTypeRef.current === 'stealthcloud') {
        setStatus('Auto-backup paused (backgrounded)');
      }

      if (nextState === 'active' && wasBackgroundedDuringWorkRef.current) {
        const backgroundForMs = backgroundedAtMsRef.current ? (Date.now() - backgroundedAtMsRef.current) : 0;
        const stillWorking = !!loadingRef.current;
        backgroundedAtMsRef.current = 0;

        // Clear refs to prevent re-triggering
        wasBackgroundedDuringWorkRef.current = false;
        backgroundWarnEligibleRef.current = false;
        setWasBackgroundedDuringWorkSafe(false);
        setBackgroundWarnEligibleSafe(false);

        if (!stillWorking) return;

        // Ignore short transitions (permission prompts, system UI)
        if (Platform.OS === 'android' && backgroundForMs > 0 && backgroundForMs < 1500) return;
        if (Platform.OS === 'ios' && backgroundForMs > 0 && backgroundForMs < 2000) return;

        if (!autoUploadEnabledRef.current) {
          showDarkAlert('Process paused', 'The app was backgrounded during an operation. Keep the app open during long tasks for best reliability.');
        }
      }
    });
    return () => sub.remove();
  }, []);

  // Battery listener: triggers auto-upload when charging starts
  useEffect(() => {
    if (!autoUploadEnabled || serverType !== 'stealthcloud' || !token) return;
    
    let sub = null;
    let pollInterval = null;
    
    try {
      sub = Battery.addBatteryStateListener(({ batteryState }) => {
        console.log('AutoUpload: battery state changed', batteryState);
        if (autoUploadEnabledRef.current && serverTypeRef.current === 'stealthcloud' && tokenRef.current) {
          void maybeStartAutoUploadNightSession();
        }
      });
    } catch (e) {
      console.log('AutoUpload: failed to add battery listener', e);
    }
    
    // Android: poll every 10s as fallback (listener unreliable on some devices)
    if (Platform.OS === 'android') {
      pollInterval = setInterval(() => {
        if (autoUploadEnabledRef.current && serverTypeRef.current === 'stealthcloud' && tokenRef.current) {
          void maybeStartAutoUploadNightSession();
        }
      }, 10000);
    }
    
    return () => {
      if (sub) {
        try { sub.remove(); } catch (e) {}
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [autoUploadEnabled, serverType, token]);

  // Auto-upload runner lifecycle: start/stop based on enabled state
  useEffect(() => {
    autoUploadNightRunnerCancelRef.current = false;
    scheduleNextAutoUploadNightKick();
    if (autoUploadEnabledRef.current && serverTypeRef.current === 'stealthcloud' && tokenRef.current) {
      void maybeStartAutoUploadNightSession();
    }
    return () => {
      autoUploadNightRunnerCancelRef.current = true;
      try {
        if (autoUploadNightNextTimerRef.current) {
          clearTimeout(autoUploadNightNextTimerRef.current);
          autoUploadNightNextTimerRef.current = null;
        }
      } catch (e) {}
    };
  }, [autoUploadEnabled, serverType, token]);

  useEffect(() => {
    if (serverType !== 'stealthcloud') {
      setStealthCapacity(null);
      setStealthCapacityError(null);
      setStealthCapacityLoading(false);
      setSelectedStealthPlanGb(null);
      return;
    }

    if (view !== 'auth') return;

    let cancelled = false;

    const fetchStealthCloudCapacity = async () => {
      if (serverType !== 'stealthcloud') return null;
      try {
        setStealthCapacityLoading(true);
        setStealthCapacityError(null);

        const base = 'https://stealthlynk.io';
        let data = null;
        try {
          const res = await axios.get(`${base}/.well-known/photolynk-capacity.json`, { timeout: 8000 });
          data = res && res.data ? res.data : null;
        } catch (e) {
          data = null;
        }

        if (!data) {
          try {
            const res2 = await axios.get(`${base}/.well-known/photosync-capacity.json`, { timeout: 8000 });
            data = res2 && res2.data ? res2.data : null;
          } catch (e2) {
            data = null;
          }
        }

        if (!data) {
          const res2 = await axios.get(`${base}/api/capacity`, { timeout: 8000 });
          data = res2 && res2.data ? res2.data : null;
        }
        if (!data) return null;

        if (cancelled) return;
        setStealthCapacity(data);
      } catch (e) {
        if (cancelled) return;
        setStealthCapacity(null);
        setStealthCapacityError(e && e.message ? e.message : 'Capacity check failed');
      } finally {
        if (cancelled) return;
        setStealthCapacityLoading(false);
      }
    };

    fetchStealthCloudCapacity();

    return () => {
      cancelled = true;
    };
  }, [serverType, view]);

  /** Available StealthCloud plan tiers in GB */
  const STEALTH_PLAN_TIERS = [100, 200, 400, 1000];
  /** Message shown when a tier is sold out */
  const STEALTH_SOLD_OUT_MESSAGE = 'Temporarily unavailable — high demand. More capacity coming soon.';

  /**
   * Gets the availability status for a StealthCloud plan tier.
   * Checks capacity data to determine if tier can be created.
   * @platform Both
   * @param {number} tierGb - Tier size in GB (100, 200, 400, 1000)
   * @returns {{canCreate: boolean, message: string|null}} Tier status
   */
  const getStealthCloudTierStatus = (tierGb) => {
    const tierBytes = Number(tierGb) * 1_000_000_000;
    const c = stealthCapacity && typeof stealthCapacity === 'object' ? stealthCapacity : null;
    if (!c) return { canCreate: true, message: null };

    const tiers = c.tiers && typeof c.tiers === 'object' ? c.tiers : null;
    if (tiers) {
      const direct = tiers[String(tierGb)] || tiers[tierGb];
      if (direct && typeof direct === 'object') {
        if (typeof direct.canCreate === 'boolean') {
          return { canCreate: direct.canCreate, message: direct.message || c.message || null };
        }
        if (typeof direct.available === 'boolean') {
          return { canCreate: direct.available, message: direct.message || c.message || null };
        }
      }
    }

    const totalBytes = typeof c.totalBytes === 'number' ? c.totalBytes : (c.totalBytes ? Number(c.totalBytes) : null);
    const freeBytes = typeof c.freeBytes === 'number' ? c.freeBytes : (c.freeBytes ? Number(c.freeBytes) : null);
    const allocatedBytes = typeof c.allocatedBytes === 'number' ? c.allocatedBytes : (c.allocatedBytes ? Number(c.allocatedBytes) : 0);
    const usedBytes = typeof c.usedBytes === 'number' ? c.usedBytes : (c.usedBytes ? Number(c.usedBytes) : 0);

    let availableBytes = null;
    if (typeof c.availableBytes === 'number') availableBytes = c.availableBytes;
    else if (c.availableBytes) availableBytes = Number(c.availableBytes);
    else if (freeBytes !== null) availableBytes = freeBytes;
    else if (totalBytes !== null) availableBytes = totalBytes - usedBytes - allocatedBytes;

    if (availableBytes === null || Number.isNaN(availableBytes)) {
      return { canCreate: true, message: c.message || null };
    }

    return {
      canCreate: availableBytes >= tierBytes,
      message: c.message || null,
    };
  };

  /**
   * Yields to the UI thread to prevent blocking during long operations.
   * @platform Both
   */
  const yieldToUi = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  /**
   * CPU throttle delay for encryption operations to prevent overheating.
   * Adds a small delay every N chunks to let the CPU cool down.
   * @platform Both
   */
  const throttleEncryption = async (chunkIndex) => {
    const chunkCooldown = getThrottleChunkCooldownMs();
    if (chunkCooldown <= 0) return; // Fast mode - no throttling
    if (chunkIndex > 0) {
      await new Promise((resolve) => setTimeout(resolve, chunkCooldown));
    }
  };

  /**
   * Check if device is overheating and should pause.
   * iOS: Uses ProcessInfo thermal state (requires native module, fallback to time-based)
   * Android: Uses battery temperature if available, fallback to time-based
   * @returns {Promise<boolean>} true if should pause for cooling
   */
  const checkThermalState = async () => {
    try {
      // Time-based thermal estimation: if we've been running for a while, assume hot
      // This is a fallback since JS doesn't have direct thermal API access
      return false; // Let batch limits handle it
    } catch (e) {
      return false;
    }
  };
  
  /**
   * Perform thermal cooldown pause with status update.
   * @param {number} batchCount - Current batch number
   */
  const thermalCooldownPause = async (batchCount) => {
    const cooldownMs = getThrottleBatchCooldownMs();
    if (cooldownMs <= 0) return; // Fast mode - no cooldown
    setStatus(`Cooling down (batch ${batchCount})...`);
    console.log(`Thermal: cooling pause after batch ${batchCount}, waiting ${cooldownMs}ms`);
    await sleep(cooldownMs);
  };

  useEffect(() => {
    if (view !== 'about') return;
    if (serverType !== 'stealthcloud') return;
    if (!token) return;

    let cancelled = false;

    const fetchStealthCloudUsage = async () => {
      if (serverType !== 'stealthcloud') return null;
      try {
        setStealthUsageLoading(true);
        setStealthUsageError(null);

        const config = await getAuthHeaders();
        const base = getServerUrl();
        const res = await axios.get(`${base}/api/cloud/usage`, { ...config, timeout: 10000 });
        const data = res && res.data ? res.data : null;
        if (cancelled) return;
        setStealthUsage(data);
      } catch (e) {
        if (cancelled) return;
        const msg = (e && e.response && e.response.data && e.response.data.error)
          ? String(e.response.data.error)
          : (e && e.message ? String(e.message) : 'Usage check failed');
        setStealthUsage(null);
        setStealthUsageError(msg);
      } finally {
        if (cancelled) return;
        setStealthUsageLoading(false);
      }
    };

    fetchStealthCloudUsage();

    return () => {
      cancelled = true;
    };
  }, [view, serverType, token]);

  /**
   * Opens an external URL in the device's default browser.
   * @platform Both
   * @param {string} url - URL to open
   */
  const openLink = async (url) => {
    if (!isValidUrl(url)) return;
    try {
      await Linking.openURL(url);
    } catch (error) {
      console.error('Link open error', error);
      showDarkAlert('Error', 'Could not open link');
    }
  };

  /**
   * Backs up all photos to StealthCloud with end-to-end encryption.
   * This is the "Backup All" flow for StealthCloud.
   * @platform Both
   * 
   * Process:
   * 1. Request photo permissions
   * 2. Check subscription status
   * 3. Fetch existing manifests to skip already-uploaded files
   * 4. Iterate through all photos, encrypt and upload each
   */
  const stealthCloudBackup = async () => {
    setStatus('Requesting Photos permission...');
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (!permission || permission.status !== 'granted') {
      showDarkAlert('Permission needed', 'We need access to photos to back them up.');
      return;
    }

    // iOS: after the permission sheet, the app can remain in an 'inactive' transition state.
    // Photos queries can return empty until the app is fully active again.
    if (Platform.OS === 'ios' && appStateRef.current !== 'active') {
      const SHOW_DELAY_MS = 250;
      const MIN_VISIBLE_MS = 900;
      let shownAtMs = null;

      await new Promise((resolve) => {
        let done = false;
        let sub = null;

        const showTimer = setTimeout(() => {
          if (done) return;
          shownAtMs = Date.now();
          setStatus('Finalizing Photos permission...');
        }, SHOW_DELAY_MS);

        const timeout = setTimeout(() => {
          if (done) return;
          done = true;
          clearTimeout(showTimer);
          try { sub && sub.remove && sub.remove(); } catch (e) {}
          resolve();
        }, 10000);

        sub = AppState.addEventListener('change', (st) => {
          if (done) return;
          if (String(st) === 'active') {
            done = true;
            clearTimeout(timeout);
            clearTimeout(showTimer);
            try { sub && sub.remove && sub.remove(); } catch (e) {}
            resolve();
          }
        });
      });

      if (shownAtMs !== null) {
        const elapsed = Date.now() - shownAtMs;
        if (elapsed < MIN_VISIBLE_MS) {
          await new Promise((r) => setTimeout(r, MIN_VISIBLE_MS - elapsed));
        }
      }

      await yieldToUi();
    }

    if (Platform.OS === 'ios') {
      const ap = await getMediaLibraryAccessPrivileges(permission);
      // If user chose "Selected Photos" (limited) and selected none, iOS will return 0 assets.
      if (ap && ap !== 'all') {
        // Proceed; we can still back up the subset iOS allows.
        setStatus('Limited Photos access (Selected Photos). Backing up accessible items...');
      }
    }

    if (!(await ensureAutoUploadPolicyAllowsWork({ userInitiated: true }))) {
      return;
    }

    setStatus('Scanning local media...');
    setProgress(0);
    setLoadingSafe(true);
    setBackgroundWarnEligibleSafe(!autoUploadEnabledRef.current);
    setWasBackgroundedDuringWorkSafe(false);

    try {
      const config = await getAuthHeaders();
      const SERVER_URL = getServerUrl();

      const allowed = await ensureStealthCloudUploadAllowed();
      if (!allowed) {
        setLoadingSafe(false);
        setBackgroundWarnEligibleSafe(false);
        return;
      }

      const masterKey = await getStealthCloudMasterKey();
      setStatus('Checking server files...');
      const prepareStartTime = Date.now();

      const PAGE_SIZE = 250;
      let after = null;
      let totalCount = null;
      let processedIndex = 0;

      // list manifests so we can skip already-backed up items (by asset id OR filename)
      let existingManifests = [];
      try {
        const listRes = await axios.get(`${SERVER_URL}/api/cloud/manifests`, config);
        existingManifests = (listRes.data && listRes.data.manifests) ? listRes.data.manifests : [];
      } catch (e) {
        existingManifests = [];
      }
      const already = new Set(existingManifests.map(m => m.manifestId));

      // Build filename set by decrypting manifests (for cross-device duplicate detection)
      const alreadyFilenames = new Set();
      if (existingManifests.length > 0) {
        setStatus('Checking server files...');
        for (const m of existingManifests) {
          try {
            const manRes = await axios.get(`${SERVER_URL}/api/cloud/manifests/${m.manifestId}`, { headers: config.headers, timeout: 15000 });
            const payload = manRes.data;
            const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
            const enc = JSON.parse(parsed.encryptedManifest);
            const manifestNonce = naclUtil.decodeBase64(enc.manifestNonce);
            const manifestBox = naclUtil.decodeBase64(enc.manifestBox);
            const manifestPlain = nacl.secretbox.open(manifestBox, manifestNonce, masterKey);
            if (manifestPlain) {
              const manifest = JSON.parse(naclUtil.encodeUTF8(manifestPlain));
              if (manifest.filename) {
                alreadyFilenames.add(normalizeFilenameForCompare(manifest.filename));
              }
            }
          } catch (e) {
            // Skip manifests we can't decrypt (different key, corrupted, etc.)
          }
        }
        console.log(`StealthCloud: found ${alreadyFilenames.size} existing filenames for cross-device duplicate detection`);
      }

      // Ensure "Preparing backup..." shows for at least 800ms for professional UX
      const prepareElapsed = Date.now() - prepareStartTime;
      if (prepareElapsed < 800) {
        await sleep(800 - prepareElapsed);
      }

      let uploaded = 0;
      let skipped = 0;
      let failed = 0;

      const IOS_INITIAL_PAGE_MAX_WAIT_MS = 180000;
      const IOS_INITIAL_PAGE_ATTEMPTS = Math.max(1, Math.ceil(IOS_INITIAL_PAGE_MAX_WAIT_MS / 500));

      const mediaTypeQuery = Platform.OS === 'ios'
        ? [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video]
        : ['photo', 'video'];
      const sortByQuery = Platform.OS === 'ios'
        ? [MediaLibrary.SortBy.creationTime]
        : undefined;

      while (true) {
        let page = null;
        const maxAttempts = (Platform.OS === 'ios' && processedIndex === 0 && !after)
          ? IOS_INITIAL_PAGE_ATTEMPTS
          : 1;

        if (Platform.OS === 'ios' && maxAttempts > 1) {
          try {
            await MediaLibrary.getAlbumsAsync();
          } catch (e) {
            // ignore
          }
        }

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          page = await MediaLibrary.getAssetsAsync({
            first: PAGE_SIZE,
            after: after || undefined,
            mediaType: mediaTypeQuery,
            sortBy: sortByQuery,
          });

          const assetsNow = page && Array.isArray(page.assets) ? page.assets : [];
          // iOS can return 0 items right after the permission prompt / app launch.
          if (maxAttempts > 1 && assetsNow.length === 0 && attempt < (maxAttempts - 1)) {
            const waitedSec = Math.round(((attempt + 1) * 500) / 1000);
            setStatus(`Waiting for Photos to become available... (${waitedSec}s)`);
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
          break;
        }

        if (totalCount === null && page && typeof page.totalCount === 'number') {
          totalCount = page.totalCount;
        }

        const assets = page && Array.isArray(page.assets) ? page.assets : [];
        if (assets.length === 0) {
          if (processedIndex === 0) {
            setStatus('No photos/videos found');
            setLoadingSafe(false);
            setBackgroundWarnEligibleSafe(false);
            setProgress(0);
            return;
          }
          break;
        }

        for (let j = 0; j < assets.length; j++) {
          const asset = assets[j];
          processedIndex += 1;

          if (!(await ensureAutoUploadPolicyAllowsWorkIfBackgrounded())) {
            break;
          }

        try {

        // deterministic manifest id per asset (stable for retries)
        const manifestId = sha256(`asset:${asset.id}`);
        if (already.has(manifestId)) {
          skipped++;
          continue;
        }

        setStatus(`Comparing ${processedIndex}/${totalCount || '?'}`);

        let assetInfo;
        try {
          // Retry getAssetInfoAsync up to 3 times (iCloud/network issues)
          assetInfo = await withRetries(async () => {
            return Platform.OS === 'android'
              ? await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: true })
              : await MediaLibrary.getAssetInfoAsync(asset.id);
          }, { retries: 5, baseDelayMs: 1000, maxDelayMs: 15000, shouldRetry: () => true });
        } catch (e) {
          console.warn('getAssetInfoAsync failed after retries:', asset.id, e?.message);
          failed++;
          continue;
        }

        // Cross-device duplicate detection: skip if filename already exists on server
        const assetFilename = normalizeFilenameForCompare(assetInfo.filename || asset.filename);
        if (assetFilename && alreadyFilenames.has(assetFilename)) {
          console.log(`StealthCloud: skipping duplicate filename: ${assetFilename}`);
          skipped++;
          continue;
        }

        setStatus(`Encrypting ${processedIndex}/${totalCount || '?'}`);

        let filePath, tmpCopied, tmpUri;
        try {
          const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo });
          filePath = resolved.filePath;
          tmpCopied = resolved.tmpCopied;
          tmpUri = resolved.tmpUri;
        } catch (e) {
          console.warn('resolveReadableFilePath failed:', asset.id, e?.message);
          failed++;
          continue;
        }

        // Generate per-file key and base nonce
        const fileKey = new Uint8Array(32);
        global.crypto.getRandomValues(fileKey);
        const baseNonce16 = new Uint8Array(16);
        global.crypto.getRandomValues(baseNonce16);

        // Wrap fileKey with masterKey (nacl.secretbox) so it can be stored in manifest safely
        const wrapNonce = new Uint8Array(24);
        global.crypto.getRandomValues(wrapNonce);
        const wrappedKey = nacl.secretbox(fileKey, wrapNonce, masterKey);

        // Stream-read plaintext file, encrypt each chunk independently
        let chunkIndex = 0;
        const chunkIds = [];
        const chunkSizes = [];

        let originalSize = null;
        let chunkPlainBytes = null;
        const chunkUploadsInFlight = new Set();
        let runChunkUpload = null;
        let maxChunkUploadsInFlight = 1;

        if (Platform.OS === 'ios') {
          const fileUri = filePath.startsWith('/') ? `file://${filePath}` : (filePath || tmpUri);
          try {
            const info = await FileSystem.getInfoAsync(fileUri);
            originalSize = info && typeof info.size === 'number' ? Number(info.size) : null;
          } catch (e) {
            originalSize = null;
          }

          maxChunkUploadsInFlight = Math.max(1, chooseStealthCloudMaxParallelChunkUploads({ platform: 'ios', originalSize, fastMode: fastModeEnabledRef.current }));
          runChunkUpload = createConcurrencyLimiter(maxChunkUploadsInFlight);

          chunkPlainBytes = chooseStealthCloudChunkBytes({ platform: 'ios', originalSize, fastMode: fastModeEnabledRef.current });

          const effectiveBytes = chunkPlainBytes - (chunkPlainBytes % 3);

          let position = 0;
          while (true) {
            let nextB64 = '';
            try {
              nextB64 = await FileSystem.readAsStringAsync(fileUri, {
                encoding: FileSystem.EncodingType.Base64,
                position,
                length: effectiveBytes
              });
            } catch (e) {
              // Fallback if this FileSystem build doesn't support ranged reads
              const allB64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
              const b64Offset = Math.floor((position / 3) * 4);
              const chunkB64Len = (effectiveBytes / 3) * 4;
              nextB64 = allB64.slice(b64Offset, b64Offset + chunkB64Len);
            }
            if (!nextB64) break;
            const plaintext = naclUtil.decodeBase64(nextB64);
            if (!plaintext || plaintext.length === 0) break;

            const nonce = makeChunkNonce(baseNonce16, chunkIndex);
            await throttleEncryption(chunkIndex); // CPU throttle to prevent overheating
            const boxed = nacl.secretbox(plaintext, nonce, fileKey);
            const chunkId = sha256.create().update(boxed).hex();
            // Switch to "Uploading" status after first chunk encrypted
            if (chunkIndex === 0) {
              setStatus(`Uploading ${processedIndex}/${totalCount || '?'}`);
            }
            await trackInFlightPromise(
              chunkUploadsInFlight,
              runChunkUpload(() => stealthCloudUploadEncryptedChunk({ SERVER_URL, config, chunkId, encryptedBytes: boxed })),
              maxChunkUploadsInFlight
            );
            chunkIds.push(chunkId);
            chunkSizes.push(plaintext.length);
            chunkIndex += 1;
            position += plaintext.length;
            // Update progress: file progress + chunk progress within current file
            if (totalCount) {
              const fileProgress = (processedIndex - 1) / totalCount;
              const chunkProgress = originalSize ? (position / originalSize) / totalCount : 0;
              setProgress(Math.min(fileProgress + chunkProgress, 1));
            }

            if (plaintext.length < effectiveBytes) {
              break;
            }
          }
        } else {
          // react-native-blob-util readStream uses base64 chunks
          let ReactNativeBlobUtil = null;
          try {
            const mod = require('react-native-blob-util');
            ReactNativeBlobUtil = mod && (mod.default || mod);
          } catch (e) {
            ReactNativeBlobUtil = null;
          }
          if (!ReactNativeBlobUtil || !ReactNativeBlobUtil.fs || typeof ReactNativeBlobUtil.fs.readStream !== 'function') {
            throw new Error('StealthCloud backup requires a development build (react-native-blob-util).');
          }

          const stat = await ReactNativeBlobUtil.fs.stat(filePath);
          originalSize = stat && stat.size ? Number(stat.size) : null;

          maxChunkUploadsInFlight = Math.max(1, chooseStealthCloudMaxParallelChunkUploads({ platform: 'android', originalSize, fastMode: fastModeEnabledRef.current }));
          runChunkUpload = createConcurrencyLimiter(maxChunkUploadsInFlight);

          chunkPlainBytes = chooseStealthCloudChunkBytes({ platform: 'android', originalSize, fastMode: fastModeEnabledRef.current });

          const stream = await ReactNativeBlobUtil.fs.readStream(filePath, 'base64', chunkPlainBytes);

          await new Promise((resolve, reject) => {
            const queue = [];
            let draining = false;
            let ended = false;

            stream.open();

            stream.onData((chunkB64) => {
              queue.push(chunkB64);

              if (draining) return;
              draining = true;

              (async () => {
                try {
                  while (queue.length) {
                    const nextB64 = queue.shift();
                    const plaintext = naclUtil.decodeBase64(nextB64);
                    const nonce = makeChunkNonce(baseNonce16, chunkIndex);
                    await throttleEncryption(chunkIndex); // CPU throttle to prevent overheating
                    const boxed = nacl.secretbox(plaintext, nonce, fileKey);
                    const chunkId = sha256.create().update(boxed).hex();
                    // Switch to "Uploading" status after first chunk encrypted
                    if (chunkIndex === 0) {
                      setStatus(`Uploading ${processedIndex}/${totalCount || '?'}`);
                    }
                    await trackInFlightPromise(
                      chunkUploadsInFlight,
                      runChunkUpload(() => stealthCloudUploadEncryptedChunk({ SERVER_URL, config, chunkId, encryptedBytes: boxed })),
                      maxChunkUploadsInFlight
                    );

                    chunkIds.push(chunkId);
                    chunkSizes.push(plaintext.length);
                    chunkIndex += 1;

                    if (totalCount) setProgress(processedIndex / totalCount);
                  }
                } catch (e) {
                  reject(e);
                  return;
                } finally {
                  draining = false;
                }

                if (ended && queue.length === 0) {
                  resolve();
                }
              })();
            });

            stream.onError((e) => reject(e));
            stream.onEnd(() => {
              ended = true;
              if (!draining && queue.length === 0) {
                resolve();
              }
            });
          });
        }

        await drainInFlightPromises(chunkUploadsInFlight);

        if (!chunkIds.length) {
          throw new Error('StealthCloud backup read 0 bytes (no chunks).');
        }

        // Build manifest (then encrypt it with masterKey)
        const manifest = {
          v: 1,
          assetId: asset.id,
          filename: assetInfo.filename || asset.filename || null,
          mediaType: asset.mediaType || null,
          originalSize,
          baseNonce16: naclUtil.encodeBase64(baseNonce16),
          wrapNonce: naclUtil.encodeBase64(wrapNonce),
          wrappedFileKey: naclUtil.encodeBase64(wrappedKey),
          chunkIds,
          chunkSizes
        };

        const manifestPlain = naclUtil.decodeUTF8(JSON.stringify(manifest));
        const manifestNonce = new Uint8Array(24);
        global.crypto.getRandomValues(manifestNonce);
        const manifestBox = nacl.secretbox(manifestPlain, manifestNonce, masterKey);
        const encryptedManifest = JSON.stringify({
          manifestNonce: naclUtil.encodeBase64(manifestNonce),
          manifestBox: naclUtil.encodeBase64(manifestBox)
        });

        // Retry manifest upload up to 3 times
        await withRetries(async () => {
          await axios.post(
            `${SERVER_URL}/api/cloud/manifests`,
            { manifestId, encryptedManifest, chunkCount: chunkIds.length },
            { headers: config.headers, timeout: 30000 }
          );
        }, {
          retries: 10,
          baseDelayMs: 1000,
          maxDelayMs: 30000,
          shouldRetry: shouldRetryChunkUpload
        });
        uploaded += 1;

        if (tmpCopied && tmpUri) {
          await FileSystem.deleteAsync(tmpUri, { idempotent: true });
        }
        
        // CPU cooldown between assets to reduce phone heating
        const assetCooldown = getThrottleAssetCooldownMs();
        if (assetCooldown > 0) await sleep(assetCooldown);
        
        // Thermal batch limit: long cooling pause every N assets
        const batchLimit = getThrottleBatchLimit();
        if (uploaded > 0 && uploaded % batchLimit === 0) {
          await thermalCooldownPause(Math.floor(uploaded / batchLimit));
        }

        } catch (e) {
          failed += 1;
          console.warn('StealthCloud asset failed:', asset && asset.id ? asset.id : 'unknown', e && e.message ? e.message : String(e));
          continue;
        }
        }

        after = page && page.endCursor ? page.endCursor : null;
        if (!page || page.hasNextPage !== true) {
          break;
        }
      }

      if (uploaded === 0 && skipped === 0 && failed === 0) {
        setStatus(
          Platform.OS === 'ios'
            ? 'Waiting for Photos to become available...'
            : 'No items processed'
        );
        return;
      }

      setStatus('Backup complete');
      showDarkAlert('Backup Complete', `Uploaded: ${uploaded}\nSkipped: ${skipped}\nFailed: ${failed}`);
    } catch (e) {
      console.error('StealthCloud backup error:', e);
      setStatus('Backup error');
      showDarkAlert('Backup Error', e && e.message ? e.message : 'Unknown error');
    } finally {
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setProgress(0);
    }
  };

  /**
   * Restores photos from StealthCloud to device gallery.
   * Downloads encrypted chunks, decrypts them, and saves to media library.
   * @platform Both
   * @platform iOS: Requires full photo access (not limited)
   * @platform Android: Requires react-native-blob-util for file append operations
   * @param {Object|null} opts - Options
   * @param {Array<string>} opts.manifestIds - Optional list of specific manifests to restore
   * 
   * Process:
   * 1. Request photo permissions
   * 2. Build local filename index to skip already-restored files
   * 3. Fetch manifest list from server
   * 4. For each manifest: download chunks, decrypt, save to gallery
   */
  const stealthCloudRestore = async (opts = null) => {
    setStatus('Requesting permissions...');
    setLoadingSafe(true);

    const permission = await MediaLibrary.requestPermissionsAsync();
    if (permission.status !== 'granted') {
      showDarkAlert('Permission Required', 'Media library permission is required to sync photos to your gallery.');
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setWasBackgroundedDuringWorkSafe(false);
      return;
    }
    if (Platform.OS === 'ios' && permission.accessPrivileges && permission.accessPrivileges !== 'all') {
      setStatus('Limited photo access. Please allow full access to sync from cloud.');
      showDarkAlert('Limited Photos Access', 'Sync needs Full Access to your Photos library.');
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setWasBackgroundedDuringWorkSafe(false);
      return;
    }

    setBackgroundWarnEligibleSafe(true);
    setWasBackgroundedDuringWorkSafe(false);

    try {
      const restoreHistory = await loadRestoreHistory();
      const config = await getAuthHeaders();
      const SERVER_URL = getServerUrl();
      const masterKey = await getStealthCloudMasterKey();

      setStatus('Comparing local files...');
      const localIndex = await buildLocalFilenameSetPaged({ mediaType: ['photo', 'video'] });
      const localFilenames = localIndex.set;

      const result = await stealthCloudRestoreCore({
        config,
        SERVER_URL,
        masterKey,
        localFilenames,
        restoreHistory,
        saveRestoreHistory,
        makeHistoryKey,
        manifestIds: opts?.manifestIds || null,
        fastMode: fastModeEnabledRef.current,
        onStatus: setStatus,
        onProgress: setProgress,
      });

      if (result.noBackups) {
        setStatus('No backups');
        showDarkAlert('No Backups', 'No StealthCloud backups found for this account.');
        return;
      }

      setStatus('Sync complete');
      showDarkAlert('Sync Complete', `Downloaded: ${result.restored}\nSkipped: ${result.skipped}\nFailed: ${result.failed}`);
    } catch (e) {
      console.error('StealthCloud restore error:', e);
      setStatus('Sync error');
      showDarkAlert('Sync Error', e && e.message ? e.message : 'Unknown error');
    } finally {
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setProgress(0);
    }
  };

  const getDeviceUUID = async (userEmail = null, userPassword = null) => {
    const normalizedEmail = normalizeEmailForDeviceUuid(userEmail);
    if (!normalizedEmail) return null;

    const persistedKey = `device_uuid_v3:${normalizedEmail}`;
    const legacyKey = `device_uuid_v3:${String(userEmail).toLowerCase()}`;

    let persisted = null;
    try {
      persisted = await SecureStore.getItemAsync(persistedKey);
    } catch (e) {
      persisted = null;
    }

    if (!persisted) {
      // Migration path for older builds (non-trimmed key)
      let legacy = null;
      try {
        legacy = await SecureStore.getItemAsync(legacyKey);
      } catch (e) {
        legacy = null;
      }
      if (legacy) {
        persisted = legacy;
        try {
          await SecureStore.setItemAsync(persistedKey, legacy);
        } catch (e) {
          // ignore
        }
      }
    }

    // If password is not provided (e.g. app start), we can only use the persisted UUID.
    if (!userPassword) {
      if (persisted) {
        try {
          await SecureStore.setItemAsync('device_uuid', persisted);
        } catch (e) {}
      }
      return persisted;
    }

    // If password is provided (login/register), enforce email+password-derived UUID.
    const namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const expected = uuidv5(`${normalizedEmail}:${userPassword}`, namespace);

    if (persisted !== expected) {
      try {
        await SecureStore.setItemAsync(persistedKey, expected);
      } catch (e) {
        // ignore
      }
    }

    try {
      await SecureStore.setItemAsync('device_uuid', expected);
    } catch (e) {}

    return expected;
  };

  const getServerUrl = () => computeServerUrl(serverType, localHost, remoteHost);

  const checkLogin = async () => {
    try {
    // Load server settings
    const savedType = await SecureStore.getItemAsync('server_type');
    const savedLocalHost = await SecureStore.getItemAsync('local_host');
    const savedRemoteHost = await SecureStore.getItemAsync('remote_host');
    const savedRemoteUrl = await SecureStore.getItemAsync('remote_url');
    const savedRemoteIp = await SecureStore.getItemAsync('remote_ip');
    if (savedType) setServerType(savedType);

    if (savedLocalHost) setLocalHost(savedLocalHost);
    // Normalize any persisted remote values to a plain host (no scheme/port/path)
    const persistedRemoteRaw = savedRemoteHost || savedRemoteUrl || savedRemoteIp;
    if (persistedRemoteRaw) {
      const normalized = normalizeHostInput(persistedRemoteRaw);
      setRemoteHost(normalized);
      // Prefer remote_host going forward; clean up legacy keys that may include https:// and break iOS.
      try { await SecureStore.setItemAsync('remote_host', normalized); } catch (e) {}
      try { if (savedRemoteUrl) await SecureStore.deleteItemAsync('remote_url'); } catch (e) {}
      try { if (savedRemoteIp) await SecureStore.deleteItemAsync('remote_ip'); } catch (e) {}
    }

    // Auto Upload UI is hidden for now; prevent auto-start on app relaunch.
    // Force it OFF even if it was previously enabled.
    try { await SecureStore.setItemAsync('auto_upload_enabled', 'false'); } catch (e) {}
    setAutoUploadEnabledSafe(false);

    const savedFastMode = await SecureStore.getItemAsync('fast_mode_enabled');
    if (savedFastMode === 'true' || savedFastMode === 'false') {
      setFastModeEnabledSafe(savedFastMode === 'true');
    }
    
    // Load stored email to get correct UUID
    const rawStoredEmail = await SecureStore.getItemAsync('user_email');
    const storedEmail = normalizeEmailForDeviceUuid(rawStoredEmail);

    // Normalize persisted email so UUID lookup and background tasks stay consistent.
    if (storedEmail && rawStoredEmail !== storedEmail) {
      try {
        await SecureStore.setItemAsync('user_email', storedEmail);
      } catch (e) {
        // ignore
      }
    }

    const storedToken = await SecureStore.getItemAsync('auth_token');
    const storedUserId = await SecureStore.getItemAsync('user_id');

    // Load persisted device UUID for this email (cannot regenerate without password)
    let uuid = await getDeviceUUID(storedEmail);
    if (!uuid && storedEmail) {
      // iOS may have a valid cached device UUID but a missing per-email key.
      // Fall back to the cached value so About always shows the Device ID.
      try {
        const cached = await SecureStore.getItemAsync('device_uuid');
        if (cached) {
          uuid = cached;
          try {
            await SecureStore.setItemAsync(`device_uuid_v3:${storedEmail}`, cached);
          } catch (e) {
            // ignore
          }
        }
      } catch (e) {
        // ignore
      }
    }
    setDeviceUuid(uuid);

    if (storedToken) {
      // If we have a token but the UUID is missing, try to unlock saved password and
      // re-derive/persist the UUID instead of throwing away the session.
      if (storedEmail && !uuid) {
        try {
          setStatus('Unlock to sign in...');
          let pw = null;
          try {
            pw = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY, {
              requireAuthentication: true,
              authenticationPrompt: 'Unlock to sign in'
            });
          } catch (e) {
            pw = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY);
          }

          if (pw) {
            const fixedUuid = await getDeviceUUID(storedEmail, pw);
            if (fixedUuid) {
              setDeviceUuid(fixedUuid);
            }
          }
        } catch (e) {
          // ignore
        } finally {
          setStatus('');
        }
      }

      setTokenSafe(storedToken);
      if (storedUserId) setUserId(parseInt(storedUserId));
      setView('home');
      return;
    }

    if (storedEmail && !email) setEmail(storedEmail);

    let savedPassword = null;
    try {
      setStatus('Unlock to sign in...');
      try {
        savedPassword = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY, {
          requireAuthentication: true,
          authenticationPrompt: 'Unlock to sign in'
        });
      } catch (e) {
        // Android can have a previously-saved (non-protected) password.
        // Fall back so we don't break auto-login.
        savedPassword = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY);
      }
    } catch (e) {
      savedPassword = null;
    }

    if (savedPassword && !password) setPassword(savedPassword);
    if (!savedPassword) setStatus('');

    if (storedEmail && savedPassword) {
      try {
        setLoadingSafe(true);
        setStatus('Signing in...');

        const runAutoLogin = async () => {
          const persistedType = await SecureStore.getItemAsync('server_type');
          const persistedLocalHost = await SecureStore.getItemAsync('local_host');
          const persistedRemoteHost = await SecureStore.getItemAsync('remote_host');

          const effectiveType = serverType || persistedType || 'local';
          const effectiveLocalHost = persistedLocalHost || localHost;
          const effectiveRemoteHost = persistedRemoteHost || remoteHost;

          const deviceId = await getDeviceUUID(storedEmail, savedPassword);
          if (deviceId) setDeviceUuid(deviceId);

          const endpoint = '/api/login';
          const authBaseUrl = computeServerUrl(effectiveType, effectiveLocalHost, effectiveRemoteHost);
          const payload = {
            email: storedEmail,
            password: savedPassword,
            device_uuid: deviceId,
            deviceUuid: deviceId,
            device_name: Platform.OS + ' ' + Platform.Version,
          };

          const res = await axios.post(authBaseUrl + endpoint, payload, { timeout: 15000 });
          const { token, userId } = res.data;
          await SecureStore.setItemAsync('auth_token', token);
          await SecureStore.setItemAsync('user_email', storedEmail);
          if (userId) {
            await SecureStore.setItemAsync('user_id', String(userId));
            setUserId(userId);
          }
          setTokenSafe(token);
          setView('home');
        };

        await Promise.race([
          runAutoLogin(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Auto-login timeout')), 20000))
        ]);

        setStatus('');
        return;
      } catch (e) {
        setStatus('');
      } finally {
        setLoadingSafe(false);
      }
    }

    setStatus('');
    setView('auth');
    } catch (e) {
      console.error('AutoLogin: checkLogin failed', e?.message || e);
      setLoadingSafe(false);
      setStatus('');
      setView('auth');
    }
  };

  /**
   * Handles user authentication (login or registration).
   * @platform Both
   * @param {string} type - 'login' or 'register'
   * 
   * Process:
   * 1. Validates email and password
   * 2. Generates device UUID from credentials
   * 3. Sends auth request to server
   * 4. Stores token and credentials securely
   * 5. Navigates to home view on success
   */
  const handleAuth = async (type) => {
    console.log('handleAuth called:', type);
    console.log('Email:', email, 'Password:', password ? '***' : 'empty');
    
    if (!email || !password) {
      showDarkAlert('Error', 'Please fill in all fields');
      return;
    }

    const normalizedEmail = normalizeEmailForDeviceUuid(email);
    if (!normalizedEmail) {
      showDarkAlert('Error', 'Please enter a valid email.');
      return;
    }

    if (type === 'register') {
      if (!confirmPassword) {
        showDarkAlert('Error', 'Please confirm your password');
        return;
      }
      if (password !== confirmPassword) {
        showDarkAlert('Error', 'Passwords do not match');
        return;
      }
    }
    
    Keyboard.dismiss();
    setAuthLoadingLabel('Signing in...');
    setLoadingSafe(true);
    resetAuthLoadingLabel(loginStatusTimerRef, loginLabelTimerRef, setAuthLoadingLabel, 'Signing in...');
    if (type === 'login') {
      scheduleAuthProgressLabels(loginLabelTimerRef, setAuthLoadingLabel);
    }
    try {
      // Resolve effective server settings.
      // On cold start, state may still be default while SecureStore already has the user's saved host.
      // Also avoid overwriting persisted host with empty string.
      const persistedType = await SecureStore.getItemAsync('server_type');
      const persistedLocalHost = await SecureStore.getItemAsync('local_host');
      const persistedRemoteHost = await SecureStore.getItemAsync('remote_host');

      const effectiveType = serverType || persistedType || 'local';
      const normalizedLocal = normalizeHostInput(localHost);
      const normalizedRemote = normalizeHostInput(remoteHost);
      const effectiveLocalHost = (effectiveType === 'local' && !normalizedLocal && persistedLocalHost)
        ? persistedLocalHost
        : localHost;
      const effectiveRemoteHost = (effectiveType === 'remote' && !normalizedRemote && persistedRemoteHost)
        ? persistedRemoteHost
        : remoteHost;

      // Persist effective server settings
      await SecureStore.setItemAsync('server_type', effectiveType);
      if (effectiveType === 'remote') {
        await SecureStore.setItemAsync('remote_host', effectiveRemoteHost);
      } else if (effectiveType === 'local') {
        await SecureStore.setItemAsync('local_host', effectiveLocalHost);
      }

      // Ensure in-memory state matches what we used.
      if (serverType !== effectiveType) setServerType(effectiveType);
      if (effectiveType === 'local' && localHost !== effectiveLocalHost) setLocalHost(effectiveLocalHost);
      if (effectiveType === 'remote' && remoteHost !== effectiveRemoteHost) setRemoteHost(effectiveRemoteHost);
      
      // Device UUID is derived from email+password and persisted.
      const deviceId = await getDeviceUUID(normalizedEmail, password);
      if (!deviceId) {
        showDarkAlert('Device ID unavailable', 'Could not derive a device ID from your credentials. Please try again.');
        setLoadingSafe(false);
        return;
      }
      setDeviceUuid(deviceId);

      // Plan selection is mandatory for StealthCloud registration (7-day free trial)
      if (type === 'register' && effectiveType === 'stealthcloud' && !selectedStealthPlanGb) {
        showDarkAlert('Select a plan', 'Choose a StealthCloud plan to start your 7-day free trial.');
        setLoadingSafe(false);
        return;
      }
      const endpoint = type === 'register' ? '/api/register' : '/api/login';
      const authBaseUrl = computeServerUrl(effectiveType, effectiveLocalHost, effectiveRemoteHost);
      
      // Get persistent hardware device ID for device-bound password reset (StealthCloud only)
      // Use only stable device-derived ID so it survives reinstall. Do not use SecureStore/uuid.
      let hardwareDeviceId = null;
      if (type === 'register' && effectiveType === 'stealthcloud') {
        try {
          if (Platform.OS === 'ios') {
            hardwareDeviceId = await computeIosHardwareId();
          } else if (Platform.OS === 'android') {
            hardwareDeviceId = await computeAndroidHardwareId();
          }
        } catch (e) {
          console.log('Could not get hardware device ID:', e);
        }
      }
      const payload = {
        email: normalizedEmail,
        password,
        device_uuid: deviceId,
        deviceUuid: deviceId,
        device_name: Platform.OS + ' ' + Platform.Version,
      };

      // Include hardware_device_id during registration for password reset capability
      if (type === 'register' && hardwareDeviceId) {
        payload.hardware_device_id = hardwareDeviceId;
      }

      if (type === 'register' && effectiveType === 'stealthcloud' && selectedStealthPlanGb) {
        payload.plan_gb = selectedStealthPlanGb;
      }

      const authUrl = authBaseUrl + endpoint;
      console.log('Auth request:', {
        type,
        effectiveType,
        authUrl,
        localHost: effectiveLocalHost,
        remoteHost: effectiveRemoteHost,
        platform: Platform.OS,
      });

      const res = await axios.post(authUrl, payload);

      console.log('Attempting auth:', type, authUrl, {
        email,
        password,
        device_uuid: deviceId,
        deviceUuid: deviceId,
        device_name: Platform.OS + ' ' + Platform.Version
      });
      console.log('Auth response:', res.status);

      if (type === 'login') {
        const { token, userId } = res.data;
        await SecureStore.setItemAsync('auth_token', token);
        await SecureStore.setItemAsync('user_email', normalizedEmail); // Save normalized email for UUID retrieval
        try {
          if (Platform.OS === 'ios') {
            // iOS: store the password behind FaceID/TouchID (fallback to device passcode).
            await SecureStore.setItemAsync(SAVED_PASSWORD_KEY, password, {
              requireAuthentication: true,
              authenticationPrompt: 'Unlock to sign in'
            });
            await SecureStore.setItemAsync(SAVED_PASSWORD_EMAIL_KEY, normalizedEmail);
          } else {
            // Android: save silently to avoid a second biometric prompt later.
            // Biometric gating is applied when READING on app start.
            const savedForEmail = await SecureStore.getItemAsync(SAVED_PASSWORD_EMAIL_KEY);
            if (savedForEmail !== normalizedEmail) {
              // Try to enable fingerprint unlock for next launches.
              // If the device refuses (no biometrics enrolled, etc) we fall back to silent storage.
              try {
                await SecureStore.setItemAsync(SAVED_PASSWORD_KEY, password, {
                  requireAuthentication: true,
                  authenticationPrompt: 'Use fingerprint to unlock'
                });
              } catch (e) {
                await SecureStore.setItemAsync(SAVED_PASSWORD_KEY, password);
              }
              await SecureStore.setItemAsync(SAVED_PASSWORD_EMAIL_KEY, normalizedEmail);
            }
          }
        } catch (e) {}
        if (userId) {
          await SecureStore.setItemAsync('user_id', String(userId));
          setUserId(userId);
        }
        
        // Cache the StealthCloud master key so backup doesn't need biometrics
        // PBKDF2 with 100k iterations takes 2-5 seconds on mobile
        setStatus('Securing your account...');
        await cacheStealthCloudMasterKey(normalizedEmail, password);
        setStatus('');
        
        setTokenSafe(token);

        // Auto Upload UI is hidden for now; prevent auto-start after login.
        try { await SecureStore.setItemAsync('auto_upload_enabled', 'false'); } catch (e) {}
        setAutoUploadEnabledSafe(false);

        setAuthMode('login');
        setView('home');
      } else {
        // Save email so the next login is prefilled after registering
        await SecureStore.setItemAsync('user_email', normalizedEmail);
        showDarkAlert('Success', 'Account created! Please login.');
        setAuthMode('login');
        setConfirmPassword('');
      }
    } catch (error) {
      // Only log actual server errors, not Metro bundler noise
      if (error.response) {
        console.error('Auth Error:', error.response.status, error.response.data);
        showDarkAlert('Error', error.response?.data?.error || 'Connection failed');
      } else if (error.request) {
        console.error('Network Error - cannot reach server', {
          message: error?.message,
          code: error?.code,
          url: error?.config?.url,
          method: error?.config?.method,
          baseURL: error?.config?.baseURL,
        });
        showDarkAlert('Error', 'Cannot reach server. Check your connection.');
      }
    } finally {
      resetAuthLoadingLabel(loginStatusTimerRef, loginLabelTimerRef, setAuthLoadingLabel, 'Signing in...');
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setWasBackgroundedDuringWorkSafe(false);
    }
  };

  /**
   * Device-bound password reset using hardware device ID
   * Allows password reset if the user is on the same physical device that created the account.
   * Uses iOS Vendor ID or Android ID which persists across app reinstalls.
   */
  const handleResetPassword = async () => {
    if (!email || !newPassword) {
      showDarkAlert('Error', 'Please enter your email and new password');
      return;
    }
    if (newPassword.length < 6) {
      showDarkAlert('Error', 'Password must be at least 6 characters');
      return;
    }

    const normalizedEmail = normalizeEmailForDeviceUuid(email);
    if (!normalizedEmail) {
      showDarkAlert('Error', 'Please enter a valid email address');
      return;
    }

    Keyboard.dismiss();
    setLoadingSafe(true);
    setAuthLoadingLabel('Verifying device...');

    try {
      // Get persistent hardware device ID (StealthCloud only) using deterministic device-derived ID
      let hardwareDeviceId = null;
      try {
        if (Platform.OS === 'ios') {
          hardwareDeviceId = await computeIosHardwareId();
        } else if (Platform.OS === 'android') {
          hardwareDeviceId = await computeAndroidHardwareId();
        }
      } catch (e) {
        console.log('Could not get hardware device ID:', e);
      }
      
      if (!hardwareDeviceId) {
        showDarkAlert(
          'Device ID Unavailable', 
          'Could not retrieve device identifier. Password reset requires device verification. Please ensure you registered on this device.'
        );
        setLoadingSafe(false);
        return;
      }

      setAuthLoadingLabel('Resetting password...');
      const baseUrl = computeServerUrl(serverType, localHost, remoteHost);
      await axios.post(`${baseUrl}/api/reset-password-device`, {
        email: normalizedEmail,
        hardware_device_id: hardwareDeviceId,
        newPassword
      });
      
      showDarkAlert('Success', 'Your password has been reset. Please login with your new password.');
      setPassword(newPassword);
      setAuthMode('login');
      setNewPassword('');
    } catch (error) {
      console.error('Reset password error:', error);
      const hint = error.response?.data?.hint;
      if (hint === 'device_mismatch') {
        showDarkAlert(
          'Different Device',
          'Password reset is only available on the device where you created your account. This appears to be a different device.'
        );
      } else if (hint === 'no_hardware_id_stored') {
        showDarkAlert(
          'Feature Not Available',
          'Password reset is not available for accounts created before this feature was added. Please contact support.'
        );
      } else {
        showDarkAlert('Error', error.response?.data?.error || 'Failed to reset password');
      }
    } finally {
      setLoadingSafe(false);
      setAuthLoadingLabel('Signing in...');
    }
  };

  /**
   * Scans device for exact duplicate photos using pixel-based hashing.
   * Uses DuplicateScanner module for the heavy lifting.
   * @platform Both
   */
  const cleanDeviceDuplicates = async () => {
    setBackgroundWarnEligibleSafe(false);
    setWasBackgroundedDuringWorkSafe(false);
    setLoadingSafe(true);
    setStatus('Scanning for duplicates...');

    try {
      // Request permission
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        showDarkAlert('Permission needed', 'We need access to photos to safely scan for duplicates.');
        setLoadingSafe(false);
        return;
      }

      // iOS: require full access
      if (Platform.OS === 'ios' && permission.accessPrivileges && permission.accessPrivileges !== 'all') {
        showDarkAlert(
          'Limited Photos Access',
          `Clean Duplicates needs Full Access to your Photos library.\n\nGo to Settings → ${APP_DISPLAY_NAME} → Photos → Full Access.`
        );
        setLoadingSafe(false);
        return;
      }

      // Import scanner module
      const DuplicateScanner = require('./duplicateScanner').default;

      // Collect all photos
      setStatus('Collecting photos...');
      const assets = await DuplicateScanner.collectAllPhotoAssets();

      if (!assets || assets.length === 0) {
        showDarkAlert('No Media', 'No photos were found on this device.');
        setLoadingSafe(false);
        return;
      }

      setStatus(`Analyzing ${assets.length} photos...`);

      // Scan for duplicates
      const { duplicateGroups, stats } = await DuplicateScanner.scanExactDuplicates({
        assets,
        resolveReadableFilePath,
        onProgress: (hashedCount, totalCount, lastHash) => {
          setStatus(`Analyzing: ${hashedCount}/${totalCount} photos...`);
        }
      });

      if (duplicateGroups.length === 0) {
        const note = DuplicateScanner.buildNoResultsNote(stats);
        setStatus('No exact duplicates found');
        showDarkAlert('Exact Shots', 'No exact duplicates found.' + note);
        setLoadingSafe(false);
        setBackgroundWarnEligibleSafe(false);
        setWasBackgroundedDuringWorkSafe(false);
        return;
      }

      // Format for review UI
      const duplicateCount = DuplicateScanner.countDuplicates(duplicateGroups);
      const reviewGroups = DuplicateScanner.formatDuplicateGroupsForReview(duplicateGroups);

      setDuplicateReview({
        mode: 'pixel-hash',
        duplicateCount,
        groupCount: duplicateGroups.length,
        groups: reviewGroups
      });

      setStatus(`Found ${duplicateCount} exact duplicates in ${duplicateGroups.length} group${duplicateGroups.length !== 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Clean duplicates error:', error);
      setStatus('Error during duplicate cleanup: ' + error.message);
      showDarkAlert('Error', error.message);
    } finally {
      setLoadingSafe(false);
    }
  };

  /**
   * Logs out the current user and clears session state.
   * @platform Both
   * @param {Object|null} opts - Options
   * @param {boolean} opts.forgetCredentials - If true, also clears saved email/password
   */
  const logout = async (opts = null) => {
    const forgetCredentials = !!(opts && opts.forgetCredentials);
    await SecureStore.deleteItemAsync('auth_token');
    await SecureStore.deleteItemAsync('user_id');
    // Always clear cached master key on logout
    await clearStealthCloudMasterKeyCache();
    if (forgetCredentials) {
      await SecureStore.deleteItemAsync('user_email');
      await SecureStore.deleteItemAsync('device_uuid');
      await SecureStore.deleteItemAsync(SAVED_PASSWORD_KEY);
      await SecureStore.deleteItemAsync(SAVED_PASSWORD_EMAIL_KEY);
    }
    setTokenSafe(null);
    setUserId(null);
    setDeviceUuid(null);
    setPassword('');
    setView('auth');
  };

  /**
   * Gets authentication headers for API requests.
   * Includes Bearer token and device UUID for server-side validation.
   * @platform Both
   * @returns {Promise<{headers: Object}>} Headers object with Authorization, X-Device-UUID, X-Client-Build
   * @throws {Error} If device UUID or auth token is missing
   */
  const getAuthHeaders = async () => {
    // Always use the same user+device UUID that was used at login
    // so that X-Device-UUID matches the device_uuid inside the JWT
    let storedEmail = null;
    try {
      storedEmail = await SecureStore.getItemAsync('user_email');
    } catch (e) {
      storedEmail = null;
    }
    if (!storedEmail) {
      try {
        storedEmail = await SecureStore.getItemAsync(SAVED_PASSWORD_EMAIL_KEY);
      } catch (e) {
        storedEmail = null;
      }
    }
    storedEmail = normalizeEmailForDeviceUuid(storedEmail);
    let uuid = deviceUuid;
    if (!uuid) {
      try {
        uuid = await SecureStore.getItemAsync('device_uuid');
      } catch (e) {
        uuid = null;
      }
    }
    if (!uuid) {
      try {
        uuid = await getDeviceUUID(storedEmail);
      } catch (e) {
        uuid = null;
      }
    }
    if (!uuid) {
      throw new Error('Device UUID missing. Please logout and login again.');
    }

    let authToken = tokenRef && tokenRef.current ? tokenRef.current : token;
    if (!authToken) {
      try {
        authToken = await SecureStore.getItemAsync('auth_token');
      } catch (e) {
        authToken = null;
      }
    }
    if (!authToken) {
      throw new Error('Auth token missing. Please login again.');
    }
    return {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'X-Device-UUID': uuid,
        'X-Client-Build': CLIENT_BUILD
      }
    };
  };

  /**
   * Backs up all photos to the configured server (local/remote).
   * For StealthCloud, delegates to stealthCloudBackup.
   * @platform Both
   * 
   * Process:
   * 1. Request photo permissions
   * 2. Get list of files already on server
   * 3. Exclude files in app album (already restored)
   * 4. Upload missing files to server
   */
  const backupPhotos = async () => {
    if (serverType === 'stealthcloud') {
      return stealthCloudBackup();
    }

    const permission = await MediaLibrary.requestPermissionsAsync();
    if (!permission || permission.status !== 'granted') {
      showDarkAlert('Permission needed', 'We need access to photos to back them up.');
      return;
    }

    if (Platform.OS === 'ios' && permission.accessPrivileges && permission.accessPrivileges !== 'all') {
      setStatus('Limited photo access. Please allow full access to back up.');
      showDarkAlert(
        'Limited Photos Access',
        `Backup needs Full Access to your Photos library.\n\nGo to Settings → ${APP_DISPLAY_NAME} → Photos → Full Access.`
      );
      return;
    }

    setStatus('Scanning local media...');
    setProgress(0); // Reset progress
    setLoadingSafe(true);
    setBackgroundWarnEligibleSafe(!autoUploadEnabledRef.current);
    setWasBackgroundedDuringWorkSafe(false);

    try {
      console.log('\n🔍 ===== BACKUP TRACE START =====');

      // 1. Get Server List
      setStatus('Checking server files...');
      const config = await getAuthHeaders();
      const SERVER_URL = getServerUrl();
      console.log('Using server URL for backup:', SERVER_URL);
      const serverRes = await axios.get(`${SERVER_URL}/api/files`, config);

      console.log(`\n☁️  Server response: ${serverRes.data.files.length} files`);

      const serverFiles = new Set(
        (serverRes.data.files || [])
          .map(f => normalizeFilenameForCompare(f && f.filename ? f.filename : null))
          .filter(Boolean)
      );

      console.log(`📊 Server files (unique, lowercase): ${serverFiles.size}`);

      // 2. Exclude files already in app album to prevent re-uploading restored files
      const albums = await MediaLibrary.getAlbumsAsync();
      console.log(`📂 All albums: ${albums.map(a => `${a.title} (${a.assetCount})`).join(', ')}`);
      
      const photoSyncAlbum = findFirstAlbumByTitle(albums, [PHOTO_ALBUM_NAME, LEGACY_PHOTO_ALBUM_NAME]);
      let excludedIds = new Set();
      
      if (photoSyncAlbum) {
        excludedIds = await buildLocalAssetIdSetPaged({ album: photoSyncAlbum });
        console.log(`📂 Album "${photoSyncAlbum.title}" has ${excludedIds.size} files (will exclude)`);
      }

      // 3. Scan local assets (paged) and decide which are missing on the server
      let after = null;
      let totalCount = null;
      let checkedCount = 0;
      const toUpload = [];
      const duplicateFilenames = {};

      while (true) {
        let page = null;
        for (let attempt = 0; attempt < 6; attempt++) {
          page = await MediaLibrary.getAssetsAsync({
            first: 500,
            after: after || undefined,
            mediaType: ['photo', 'video'],
          });

          const pageAssetsNow = page && Array.isArray(page.assets) ? page.assets : [];
          // iOS can briefly return 0 items right after app launch / permission prompt.
          if (!after && checkedCount === 0 && pageAssetsNow.length === 0 && Platform.OS === 'ios' && attempt < 5) {
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
          break;
        }

        if (totalCount === null && page && typeof page.totalCount === 'number') {
          totalCount = page.totalCount;
        }

        const pageAssets = page && Array.isArray(page.assets) ? page.assets : [];
        if (pageAssets.length === 0) break;

        for (const asset of pageAssets) {
          if (excludedIds.has(asset.id)) continue;
          checkedCount += 1;
          setStatus(`Comparing ${checkedCount}/${totalCount || '?'}`);

          let actualFilename = normalizeFilenameForCompare(asset && asset.filename ? asset.filename : null);
          if (Platform.OS === 'ios' || !actualFilename) {
            try {
              const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
              actualFilename = normalizeFilenameForCompare(assetInfo && assetInfo.filename ? assetInfo.filename : null) || actualFilename;
            } catch (e) {
              actualFilename = actualFilename;
            }
          }

          if (!actualFilename) continue;

          if (duplicateFilenames[actualFilename]) {
            duplicateFilenames[actualFilename]++;
          } else {
            duplicateFilenames[actualFilename] = 1;
          }

          const exists = serverFiles.has(actualFilename);
          if (!exists) {
            toUpload.push(asset);
          }
        }

        after = page && page.endCursor ? page.endCursor : null;
        if (!page || page.hasNextPage !== true) break;
      }

      console.log(`📊 Assets to backup (after excluding album): ${checkedCount}`);
      setStatus(`Found ${checkedCount} photos/videos to check...`);

      if (checkedCount === 0) {
        setStatus('No photos found to backup.');
        showDarkAlert('No Photos', 'No photos or videos found on device.');
        setLoadingSafe(false);
        setBackgroundWarnEligibleSafe(false);
        setWasBackgroundedDuringWorkSafe(false);
        return;
      }

      // Log device duplicates
      const deviceDuplicates = Object.entries(duplicateFilenames).filter(([_, count]) => count > 1);
      if (deviceDuplicates.length > 0) {
        console.log(`\n📱 Device has ${deviceDuplicates.length} duplicate filenames:`);
        deviceDuplicates.forEach(([filename, count]) => {
          console.log(`  - ${filename}: ${count} copies`);
        });
      }
      
      console.log(`Local: ${checkedCount}, Server: ${serverFiles.size}, To upload: ${toUpload.length}`);
      
      if (toUpload.length === 0) {
        setStatus(`All ${checkedCount} files already backed up.`);
        showDarkAlert('Up to Date', `All ${checkedCount} photos/videos are already on the server.`);
        setLoadingSafe(false);
        setBackgroundWarnEligibleSafe(false);
        setWasBackgroundedDuringWorkSafe(false);
        return;
      }

      // Show summary before starting
      setStatus(`Ready to backup ${toUpload.length} of ${checkedCount} files...`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause to show message

      // 4. Upload Loop with per-file error handling
      let successCount = 0;
      let duplicateCount = 0;
      let failedCount = 0;
      const failedFiles = [];
      
      for (let i = 0; i < toUpload.length; i++) {
        const asset = toUpload[i];
        try {
          if (!(await ensureAutoUploadPolicyAllowsWorkIfBackgrounded())) {
            break;
          }
          setStatus(`Uploading ${i + 1}/${toUpload.length}`);
          
          // Get file info
          const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.id);
          const resolved = await resolveReadableFilePath({ assetId: asset.id, assetInfo });
          const filePath = resolved && resolved.filePath ? resolved.filePath : null;

          if (!filePath) {
            console.warn(`Skipping ${asset.filename}: no URI`);
            failedCount++;
            failedFiles.push(asset.filename);
            continue;
          }

          // iOS fix: Use the actual filename from assetInfo, not the UUID
          // assetInfo.filename contains the real name like "IMG_0001.HEIC"
          const actualFilename = assetInfo.filename || asset.filename;

          const mime = getMimeFromFilename(actualFilename, asset.mediaType);
          const fileUri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;

          // Mobile: use FOREGROUND uploads (background + proxies/CDN can fail with -1 unknown error)
          const sessionTypeUpload = FileSystem.FileSystemSessionType.FOREGROUND;
          const uploadRes = await FileSystem.uploadAsync(`${SERVER_URL}/api/upload/raw`, fileUri, {
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            sessionType: sessionTypeUpload,
            headers: {
              ...config.headers,
              'Content-Type': mime,
              'X-Filename': actualFilename,
            }
          });

          // Check HTTP status - uploadAsync doesn't throw on 4xx/5xx errors
          if (!uploadRes || uploadRes.status < 200 || uploadRes.status >= 300) {
            console.error(`✗ Upload failed for ${actualFilename}: HTTP ${uploadRes?.status || 'unknown'} - ${uploadRes?.body || 'no response'}`);
            failedCount++;
            failedFiles.push(actualFilename);
            continue;
          }

          let parsed = null;
          try {
            parsed = uploadRes && uploadRes.body ? JSON.parse(uploadRes.body) : null;
          } catch (e) {
            parsed = null;
          }
          if (parsed && parsed.duplicate) {
            duplicateCount++;
            console.log(`⊘ Skipped (duplicate): ${actualFilename}`);
          } else {
            successCount++;
            console.log(`✓ Uploaded: ${actualFilename}`);
          }
        } catch (fileError) {
          console.error(`✗ Failed to upload ${asset.filename}:`, fileError.message);
          failedCount++;
          failedFiles.push(asset.filename);
        }
        
        setProgress((i + 1) / toUpload.length);
      }

      // Show detailed completion status
      console.log('\n📊 ===== BACKUP SUMMARY =====');
      console.log(`Total on device: ${totalCount || checkedCount}`);
      console.log(`Album excluded: ${excludedIds.size}`);
      console.log(`To check: ${checkedCount}`);
      console.log(`On server before: ${serverFiles.size}`);
      console.log(`Marked for upload: ${toUpload.length}`);
      console.log(`Actually uploaded: ${successCount}`);
      console.log(`Duplicates skipped: ${duplicateCount}`);
      console.log(`Failed: ${failedCount}`);
      console.log('===== END BACKUP TRACE =====\n');
      
      const skippedCount = checkedCount - toUpload.length + duplicateCount;
      setStatus('Backup complete');
      showDarkAlert('Backup Complete', `Uploaded: ${successCount}\nSkipped: ${skippedCount}\nFailed: ${failedCount}`);
      setProgress(0); // Reset progress after completion
    } catch (error) {
      console.error(error);
      setStatus('Backup error');
      setProgress(0); // Reset progress on error
      showDarkAlert('Backup Error', error && error.message ? error.message : 'Unknown error');
    } finally {
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
    }
  };

  /**
   * Restores photos from the configured server (local/remote) to device gallery.
   * For StealthCloud, delegates to stealthCloudRestore.
   * @platform Both
   * @platform iOS: Requires full photo access (not limited)
   * @param {Object|null} opts - Options
   * @param {Array<string>} opts.onlyFilenames - Optional list of specific filenames to restore
   * 
   * Process:
   * 1. Request photo permissions
   * 2. Get list of files on server
   * 3. Build local filename index to skip already-restored files
   * 4. Download and save missing files to gallery
   */
  const restorePhotos = async (opts = null) => {
    if (serverType === 'stealthcloud') {
      return stealthCloudRestore(opts);
    }
    setStatus('Requesting permissions...');
    setLoadingSafe(true);
    
    // Request full media library permission (read is required to check what already exists locally,
    // and write is required to save restored items)
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (permission.status !== 'granted') {
      showDarkAlert('Permission Required', 'Media library permission is required to sync photos to your gallery.');
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setWasBackgroundedDuringWorkSafe(false);
      return;
    }

    // iOS: if user selected "Limited" photo access, we cannot reliably compare filenames or sync.
    if (Platform.OS === 'ios' && permission.accessPrivileges && permission.accessPrivileges !== 'all') {
      setStatus('Limited photo access. Please allow full access to sync from cloud.');
      showDarkAlert(
        'Limited Photos Access',
        `Sync from Cloud needs Full Access to your Photos library to check what already exists and save new items.\n\nGo to Settings → ${APP_DISPLAY_NAME} → Photos → Full Access.`
      );
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setWasBackgroundedDuringWorkSafe(false);
      setProgress(0);
      return;
    }

    setBackgroundWarnEligibleSafe(true);
    setWasBackgroundedDuringWorkSafe(false);
    
    console.log('\n⬇️  ===== RESTORE TRACE START =====');
    
    setStatus('Checking server files...');
    setProgress(0); // Reset progress

    try {
      // 1. Get Server Files
      const config = await getAuthHeaders();
      const serverRes = await axios.get(`${getServerUrl()}/api/files`, config);
      let serverFiles = serverRes.data.files;

      if (opts && Array.isArray(opts.onlyFilenames) && opts.onlyFilenames.length > 0) {
        const allowed = new Set(opts.onlyFilenames.map(v => normalizeFilenameForCompare(v)).filter(Boolean));
        serverFiles = (serverFiles || []).filter(f => {
          const nf = normalizeFilenameForCompare(f && f.filename ? f.filename : null);
          return nf ? allowed.has(nf) : false;
        });
      }
      console.log(`☁️  Server has ${serverFiles.length} files`);

      // 2. Get local device photos to check what already exists
      setStatus('Comparing local files...');
      const localIndex = await buildLocalFilenameSetPaged({ mediaType: ['photo', 'video'] });
      const localFilenames = localIndex.set;
      console.log(`📱 Scanned assets on device: ${localIndex.scanned}${localIndex.totalCount ? `/${localIndex.totalCount}` : ''}`);
      console.log(`📊 Unique filenames on device: ${localFilenames.size}`);
      
      if (serverFiles.length === 0) {
        setStatus('No files on server to download.');
        showDarkAlert('No Files', 'There are no files on the server to download.');
        setLoadingSafe(false);
        setBackgroundWarnEligibleSafe(false);
        setWasBackgroundedDuringWorkSafe(false);
        return;
      }
      
      // Only download files that don't exist locally (case-insensitive check)
      const toDownload = serverFiles.filter(f => {
        const normalizedFilename = normalizeFilenameForCompare(f && f.filename ? f.filename : null);
        const exists = normalizedFilename ? localFilenames.has(normalizedFilename) : false;
        if (exists) {
          console.log(`✓ Skipping ${f.filename} - already exists locally`);
        } else {
          console.log(`⬇️ Will download ${f.filename} - not found locally`);
        }
        return !exists;
      });
      
      console.log(`\n📊 Restore Summary:`);
      console.log(`Server: ${serverFiles.length}, Local: ${localFilenames.size}, To download: ${toDownload.length}`);
      
      if (toDownload.length === 0) {
        setStatus(`All ${serverFiles.length} files already synced.`);
        showDarkAlert('Up to Date', `All ${serverFiles.length} server files are already on your device.`);
        setLoadingSafe(false);
        setBackgroundWarnEligibleSafe(false);
        setWasBackgroundedDuringWorkSafe(false);
        return;
      }

      // Show summary before starting
      setStatus(`Ready to download ${toDownload.length} of ${serverFiles.length} files...`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause to show message

      // 3. Download Loop - download new files only
      let count = 0;
      const downloadedUris = [];
      
      for (const file of toDownload) {
        try {
          setStatus(`Downloading ${count + 1}/${toDownload.length}`);
          console.log(`Downloading: ${file.filename}`);
          
          const downloadPath = FileSystem.cacheDirectory + file.filename;
          
          // Delete cached file if it exists to prevent conflicts
          const cachedFileInfo = await FileSystem.getInfoAsync(downloadPath);
          if (cachedFileInfo.exists) {
            await FileSystem.deleteAsync(downloadPath, { idempotent: true });
            console.log(`Cleared cached file: ${file.filename}`);
          }
          
          const downloadRes = await FileSystem.downloadAsync(
            `${getServerUrl()}/api/files/${file.filename}`,
            downloadPath,
            { headers: config.headers }
          );

          if (downloadRes.status === 200) {
            const fileInfo = await FileSystem.getInfoAsync(downloadRes.uri);
            if (fileInfo.exists && fileInfo.size > 0) {
              downloadedUris.push({ uri: downloadRes.uri, filename: file.filename });
              console.log(`Downloaded ${file.filename} (${fileInfo.size} bytes)`);
            }
          }
        } catch (fileError) {
          console.error(`Error downloading ${file.filename}:`, fileError);
        }
        count++;
      }
      
      // 4. Save all downloaded files to gallery in batch
      let successCount = 0;
      if (downloadedUris.length > 0) {
        setStatus(`Saving ${downloadedUris.length} files to gallery...`);
        try {
          // Get or create app album
          const albums = await MediaLibrary.getAlbumsAsync();
          let photoSyncAlbum = findFirstAlbumByTitle(albums, [PHOTO_ALBUM_NAME, LEGACY_PHOTO_ALBUM_NAME]);
          
          // Save files to library using saveToLibraryAsync (asks permission once)
          const assets = [];
          for (const item of downloadedUris) {
            try {
              const asset = await MediaLibrary.saveToLibraryAsync(item.uri);
              assets.push(asset);
              successCount++;
            } catch (err) {
              console.log(`Could not save ${item.filename}: ${err.message}`);
            }
          }
          
          // Add all assets to album at once
          if (assets.length > 0) {
            if (photoSyncAlbum) {
              await MediaLibrary.addAssetsToAlbumAsync(assets, photoSyncAlbum, false);
            } else {
              await MediaLibrary.createAlbumAsync(PHOTO_ALBUM_NAME, assets[0], false);
              if (assets.length > 1) {
                const newAlbums = await MediaLibrary.getAlbumsAsync();
                photoSyncAlbum = findFirstAlbumByTitle(newAlbums, [PHOTO_ALBUM_NAME, LEGACY_PHOTO_ALBUM_NAME]);
                if (photoSyncAlbum) {
                  await MediaLibrary.addAssetsToAlbumAsync(assets.slice(1), photoSyncAlbum, false);
                }
              }
            }
            console.log(`Saved ${assets.length} files to ${PHOTO_ALBUM_NAME} album`);
          }
          
          // Clean up cache files after saving to gallery
          for (const item of downloadedUris) {
            try {
              await FileSystem.deleteAsync(item.uri, { idempotent: true });
              console.log(`Cleaned up cache: ${item.filename}`);
            } catch (err) {
              console.log(`Could not delete cache file ${item.filename}: ${err.message}`);
            }
          }
        } catch (galleryError) {
          console.log(`Gallery save error: ${galleryError.message}`);
        }
      }
      
      console.log('\n📊 ===== RESTORE SUMMARY =====');
      console.log(`Server files: ${serverFiles.length}`);
      console.log(`Device assets before: ${localIndex.scanned}${localIndex.totalCount ? `/${localIndex.totalCount}` : ''}`);
      console.log(`Unique filenames on device: ${localFilenames.size}`);
      console.log(`Marked for download: ${toDownload.length}`);
      console.log(`Successfully downloaded: ${successCount}`);
      console.log(`Failed downloads: ${toDownload.length - successCount}`);
      console.log('===== END RESTORE TRACE =====\n');
      
      setStatus('Sync complete');
      setProgress(0); // Reset progress after completion
      
      const skippedCount = serverFiles.length - toDownload.length;
      const failedCount = toDownload.length - successCount;
      showDarkAlert('Sync Complete', `Downloaded: ${successCount}\nSkipped: ${skippedCount}\nFailed: ${failedCount}`);

    } catch (error) {
      console.error('Restore error:', error);
      setStatus('Error during restore: ' + error.message);
      setProgress(0); // Reset progress on error
      showDarkAlert('Sync Error', error.message);
    } finally {
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
    }
  };

  if (view === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <GradientSpinner size={90} />
      </View>
    );
  }

  if (view === 'auth') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />
        <KeyboardAvoidingView 
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
          <ScrollView 
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 20 }}
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={true}
            alwaysBounceVertical={true}
            centerContent={true}>
            <View style={styles.authHeader}>
              <Image 
                source={require('./assets/splash-icon.png')} 
                style={styles.appIcon}
              />
              <Text style={styles.title}>{APP_DISPLAY_NAME}</Text>
              <Text style={styles.subtitle}>Secure Cloud Backup for Your Memories</Text>
            </View>
        
            <View style={styles.form}>
          <View style={styles.serverConfig}>
            <Text style={styles.serverLabel}>Server Type</Text>
            <View style={styles.serverToggle}>
              <TouchableOpacity 
                style={[styles.toggleBtn, serverType === 'local' && styles.toggleBtnActive]}
                onPress={() => setServerType('local')}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.toggleText, serverType === 'local' && styles.toggleTextActive]}>
                  Local Network
                </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.toggleBtn, serverType === 'remote' && styles.toggleBtnActive]}
                onPress={() => setServerType('remote')}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.toggleText, serverType === 'remote' && styles.toggleTextActive]}>
                  Remote Server
                </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.toggleBtn, serverType === 'stealthcloud' && styles.toggleBtnActive]}
                onPress={() => setServerType('stealthcloud')}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.toggleText, serverType === 'stealthcloud' && styles.toggleTextActive]}>
                  StealthCloud
                </Text>
              </TouchableOpacity>
            </View>
            
            {serverType === 'remote' && (
              <>
                <TextInput 
                  style={[styles.input, {marginTop: 12}]} 
                  placeholder="Enter remote domain (recommended)" 
                  placeholderTextColor="#666666"
                  value={remoteHost}
                  onChangeText={(t) => setRemoteHost(normalizeHostInput(t))}
                  autoCapitalize="none"
                />
                <Text style={styles.inputHint}>Use your HTTPS domain (e.g. remote.example.com).</Text>
              </>
            )}

            {serverType === 'stealthcloud' && (
              <>
                <Text style={styles.inputHint}>StealthCloud is a zero-knowledge encrypted cloud. The server can store your backups but cannot view them.</Text>

                {authMode === 'register' && (
                  <View style={styles.stealthPlanBox}>
                    <View style={styles.stealthPlanHeader}>
                      <Text style={styles.stealthPlanTitle}>Choose a plan</Text>
                      {(stealthCapacityLoading || plansLoading) && (
                        <ActivityIndicator size="small" color={THEME.secondary} />
                      )}
                    </View>

                    {!!stealthCapacityError && (
                      <Text style={styles.stealthPlanHint}>Capacity check unavailable. You can still choose a plan.</Text>
                    )}

                    {!!(stealthCapacity && stealthCapacity.message) && (
                      <Text style={styles.stealthPlanHint}>{String(stealthCapacity.message)}</Text>
                    )}

                    <Text style={styles.stealthPlanHint}>7-day free trial • Cancel anytime</Text>

                    <View style={styles.stealthPlanGrid}>
                      {STEALTH_PLAN_TIERS.map((gb) => {
                        const st = getStealthCloudTierStatus(gb);
                        const disabled = st.canCreate === false || purchaseLoading;
                        const selected = selectedStealthPlanGb === gb;
                        const plan = availablePlans.find(p => p.tierGb === gb);
                        const priceStr = plan ? plan.priceString : null;
                        return (
                          <TouchableOpacity
                            key={String(gb)}
                            activeOpacity={0.85}
                            style={[
                              styles.stealthPlanCard,
                              selected && styles.stealthPlanCardSelected,
                              disabled && styles.stealthPlanCardDisabled,
                            ]}
                            onPress={() => {
                              if (disabled) return;
                              setSelectedStealthPlanGb(gb);
                            }}>
                            <Text style={styles.stealthPlanGb}>{gb === 1000 ? '1 TB' : `${gb} GB`}</Text>
                            <Text style={styles.stealthPlanPrice}>{priceStr || '—'}</Text>
                            <Text style={styles.stealthPlanMeta}>per month</Text>
                            {disabled && st.canCreate === false && (
                              <Text style={styles.stealthPlanSoldOut}>{st.message || STEALTH_SOLD_OUT_MESSAGE}</Text>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {!stealthCapacityLoading && !stealthCapacityError && (
                      <Text style={styles.stealthPlanHint}>Plans may be temporarily unavailable when capacity is full.</Text>
                    )}

                    <TouchableOpacity
                      style={styles.restorePurchasesBtn}
                      onPress={handleRestorePurchases}
                      disabled={purchaseLoading}>
                      <Text style={styles.restorePurchasesText}>Restore Purchases</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}

            {serverType === 'local' && (
              <>
                <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 12}}>
                  <TextInput 
                    style={[styles.input, {flex: 1, marginTop: 0, marginRight: 8}]} 
                    placeholder="Enter local server IP" 
                    placeholderTextColor="#666666"
                    value={localHost}
                    onChangeText={(t) => setLocalHost(normalizeHostInput(t))}
                    autoCapitalize="none"
                  />
                  <TouchableOpacity 
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      backgroundColor: '#101010',
                      borderWidth: 1,
                      borderColor: '#2f2f2f',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onPress={async () => {
                      if (!cameraPermission?.granted) {
                        const result = await requestCameraPermission();
                        if (!result.granted) {
                          Alert.alert('Camera Permission', 'Camera access is needed to scan QR codes.');
                          return;
                        }
                      }
                      setQrScannerOpen(true);
                    }}
                  >
                    <View style={{width: 22, height: 22}}>
                      <View style={{position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderWidth: 2, borderColor: '#fff', borderRadius: 2}} />
                      <View style={{position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderWidth: 2, borderColor: '#fff', borderRadius: 2}} />
                      <View style={{position: 'absolute', bottom: 0, left: 0, width: 10, height: 10, borderWidth: 2, borderColor: '#fff', borderRadius: 2}} />
                      <View style={{position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderWidth: 2, borderColor: '#fff', borderRadius: 2}} />
                      <View style={{position: 'absolute', top: 8, left: 8, width: 6, height: 6, backgroundColor: '#fff', borderRadius: 1}} />
                    </View>
                  </TouchableOpacity>
                </View>
                <Text style={styles.inputHint}>Enter IP manually or scan QR code from server tray app</Text>
              </>
            )}

            {serverType === 'stealthcloud' && (
              <Text style={styles.serverHint}>
                🕶️ Using StealthCloud (https://stealthlynk.io)
              </Text>
            )}
          </View>

          <View style={styles.serverHelp}>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              onPress={() => setQuickSetupCollapsed(prev => !prev)}
              activeOpacity={0.8}
            >
              <Text style={styles.serverHelpTitle}>📋 Quick Setup</Text>
              <Text style={[styles.serverHelpText, styles.boldText]}>{quickSetupCollapsed ? '▸ Show' : '▾ Hide'}</Text>
            </TouchableOpacity>
            {!quickSetupCollapsed && (
              <>
                <View style={{ height: 8 }} />

                {serverType === 'local' && (
                  <>
                    <Text style={[styles.serverHelpText, styles.boldText]}>On your computer:</Text>
                    <Text style={styles.serverHelpText}>1) Download the PhotoLynk Server app for your OS:</Text>
                    <TouchableOpacity
                      style={{ marginBottom: 8 }}
                      onPress={() => {
                        Clipboard.setString(GITHUB_RELEASES_LATEST_URL);
                        showDarkAlert('Copied', 'GitHub releases link copied.');
                      }}
                      onLongPress={() => openLink(GITHUB_RELEASES_LATEST_URL)}>
                      <Text style={styles.codeLine} numberOfLines={1} ellipsizeMode="middle">{GITHUB_RELEASES_LATEST_URL}</Text>
                      <Text style={styles.codeHint}>Tap to copy • Long-press to open</Text>
                    </TouchableOpacity>
                    <Text style={styles.serverHelpText}>2) Install and run it</Text>
                    <Text style={styles.serverHelpText}>3) System tray → Local Server → Pair Mobile Device (QR)</Text>
                    <Text style={[styles.serverHelpText, styles.boldText]}>On your phone:</Text>
                    <Text style={styles.serverHelpText}>4) Scan the QR code on your computer (or paste IP if needed)</Text>
                    <Text style={styles.serverHelpText}>5) Create account and log in</Text>
                    <Text style={styles.serverHelpText}>6) Start backing up to your computer</Text>
                  </>
                )}

                {serverType === 'remote' && (
                  <>
                    <Text style={[styles.serverHelpSubtitle, { marginTop: 0 }]}>Remote: Headless Install</Text>
                    <Text style={styles.serverHelpText}>1) SSH into your remote server</Text>
                    <Text style={styles.serverHelpText}>2) Run the install script (downloads + configures server):</Text>
                    <TouchableOpacity
                      style={{ marginBottom: 8 }}
                      onPress={() => {
                        const scriptCmd = 'sudo curl -fsSL https://raw.githubusercontent.com/viktorvishyn369/PhotoLynk/main/install-server.sh | bash';
                        Clipboard.setString(scriptCmd);
                        showDarkAlert('Copied', 'Install script command copied.');
                      }}
                      onLongPress={() => openLink('https://github.com/viktorvishyn369/PhotoLynk/blob/main/install-server.sh')}>
                      <Text style={styles.codeLine} numberOfLines={2} ellipsizeMode="middle">sudo curl -fsSL https://raw.githubusercontent.com/viktorvishyn369/PhotoLynk/main/install-server.sh | bash</Text>
                      <Text style={styles.codeHint}>Tap to copy • Long-press to view script</Text>
                    </TouchableOpacity>
                    <Text style={styles.serverHelpText}>3) Use an HTTPS domain (Cloudflare/Certbot).</Text>
                    <Text style={[styles.serverHelpText, styles.boldText]}>On your phone:</Text>
                    <Text style={styles.serverHelpText}>4) Enter your domain (no https://, no port). Example: remote.example.com</Text>
                    <Text style={styles.serverHelpText}>5) Create account and log in</Text>
                    <Text style={styles.serverHelpText}>6) Start backing up to your server</Text>
                  </>
                )}

                {serverType === 'stealthcloud' && (
                  <>
                    <Text style={[styles.serverHelpSubtitle, { marginTop: 0 }]}>StealthCloud</Text>
                    <Text style={styles.serverHelpText}>Create account, log in, and start backing up.</Text>
                    <Text style={styles.serverHelpText}>Zero-knowledge: encrypted on your device, only your device can decrypt.</Text>
                    <Text style={styles.serverHelpText}>7-day free trial, then pick a plan in-app.</Text>
                  </>
                )}
              </>
            )}
          </View>
          
          <TextInput 
            style={styles.input} 
            placeholder="Email" 
            placeholderTextColor="#888888"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="username"
          />
          {(authMode === 'login' || authMode === 'register') && (
            <TextInput 
              style={styles.input} 
              placeholder="Password" 
              placeholderTextColor="#888888"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
            />
          )}

          {authMode === 'register' && (
            <TextInput 
              style={styles.input} 
              placeholder="Confirm Password" 
              placeholderTextColor="#888888"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
            />
          )}
          
          {authMode === 'login' && (
            <>
              <TouchableOpacity style={[styles.btnPrimary, loading && { opacity: 0.7 }]} onPress={() => handleAuth('login')} disabled={loading}>
                {loading ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.btnText}>{authLoadingLabel}</Text>
                  </View>
                ) : (
                  <Text style={styles.btnText}>Login</Text>
                )}
              </TouchableOpacity>
              
              <View style={{
                flexDirection: 'row',
                justifyContent: serverType === 'stealthcloud' ? 'space-between' : 'center',
                alignItems: 'center',
                marginTop: 12
              }}>
                <TouchableOpacity
                  onPress={() => {
                    setAuthMode('register');
                    setConfirmPassword('');
                    setTermsAccepted(false);
                  }}
                  disabled={loading}
                >
                  <Text style={{ color: '#a78bfa', fontSize: 14 }}>Create Account</Text>
                </TouchableOpacity>

                {serverType === 'stealthcloud' && (
                  <TouchableOpacity
                    onPress={() => setAuthMode('forgot')}
                    disabled={loading}
                  >
                    <Text style={{ color: '#888', fontSize: 14 }}>Forgot Password?</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}

          {authMode === 'register' && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, paddingHorizontal: 4 }}>
                <TouchableOpacity
                  onPress={() => setTermsAccepted(!termsAccepted)}
                  style={{ marginRight: 10, marginTop: 2 }}
                  activeOpacity={0.7}
                >
                  <View style={{
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    borderWidth: 2,
                    borderColor: termsAccepted ? '#a78bfa' : '#555',
                    backgroundColor: termsAccepted ? '#a78bfa' : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {termsAccepted && (
                      <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>✓</Text>
                    )}
                  </View>
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#AAA', fontSize: 13, lineHeight: 18 }}>
                    I agree to the{' '}
                    <Text
                      style={{ color: '#a78bfa', textDecorationLine: 'underline' }}
                      onPress={() => Linking.openURL('https://viktorvishyn369.github.io/PhotoLynk/terms.html')}
                    >
                      Terms of Service
                    </Text>
                    {' '}and{' '}
                    <Text
                      style={{ color: '#a78bfa', textDecorationLine: 'underline' }}
                      onPress={() => Linking.openURL('https://viktorvishyn369.github.io/PhotoLynk/privacy-policy.html')}
                    >
                      Privacy Policy
                    </Text>
                  </Text>
                </View>
              </View>

              <TouchableOpacity 
                style={[styles.btnPrimary, (loading || !termsAccepted) && { opacity: 0.5 }]} 
                onPress={() => handleAuth('register')} 
                disabled={loading || !termsAccepted}
              >
                {loading ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.btnText}>Creating account...</Text>
                  </View>
                ) : (
                  <Text style={styles.btnText}>Create Account</Text>
                )}
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.btnSecondary}
                onPress={() => {
                  setAuthMode('login');
                  setConfirmPassword('');
                  setTermsAccepted(false);
                }}
                disabled={loading}
              >
                <Text style={styles.btnTextSec}>Back to Login</Text>
              </TouchableOpacity>
            </>
          )}

          {authMode === 'forgot' && (
            <>
              <Text style={{ color: '#CCC', fontSize: 14, textAlign: 'center', marginBottom: 16, lineHeight: 20 }}>
                If you created your account on this device, you can reset your password below.
              </Text>
              
              <TextInput 
                style={styles.input} 
                placeholder="New Password (min 6 characters)" 
                placeholderTextColor="#888888"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
              />
              
              <TouchableOpacity style={[styles.btnPrimary, loading && { opacity: 0.7 }]} onPress={handleResetPassword} disabled={loading}>
                {loading ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.btnText}>{authLoadingLabel}</Text>
                  </View>
                ) : (
                  <Text style={styles.btnText}>Reset Password</Text>
                )}
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.btnSecondary}
                onPress={() => {
                  setAuthMode('login');
                  setNewPassword('');
                }}
                disabled={loading}
              >
                <Text style={styles.btnTextSec}>Back to Login</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        
            <View style={styles.authFooter}>
              <Text style={styles.footerText}>🔒 End-to-end encrypted • Device-bound security</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        {loading && (
        <View style={[styles.overlay, { backgroundColor: '#000' }]}>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            <GradientSpinner size={70} />
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600', marginTop: 20 }}>{authLoadingLabel}</Text>
            <Text style={{ color: '#888', fontSize: 13, marginTop: 8 }}>Please wait...</Text>
          </View>
        </View>
      )}

      {customAlert && (
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: '#2A2A2A', maxWidth: 320 }]}>
            <Text style={[styles.overlayTitle, { fontSize: 18, marginBottom: 8 }]}>{customAlert.title}</Text>
            <Text style={{ color: '#CCC', fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>{customAlert.message}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
              {(customAlert.buttons || []).map((btn, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.overlayBtnPrimary, { paddingVertical: 10, paddingHorizontal: 24, minWidth: 80 }]}
                  onPress={() => { closeDarkAlert(); if (btn.onPress) btn.onPress(); }}>
                  <Text style={styles.overlayBtnText}>{btn.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}

      {qrScannerOpen && (
        <View style={[styles.overlay, {backgroundColor: 'rgba(0,0,0,0.95)'}]}>
          <View style={{flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center'}}>
            <Text style={{color: '#fff', fontSize: 20, fontWeight: '600', marginBottom: 8}}>
              📷 Scan QR Code
            </Text>
            <Text style={{color: '#aaa', fontSize: 14, marginBottom: 20, textAlign: 'center', paddingHorizontal: 40}}>
              Point your camera at the QR code shown in the PhotoLynk Server tray app
            </Text>
            
            <View style={{width: 280, height: 280, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000'}}>
              {cameraPermission?.granted ? (
                <CameraView
                  style={{flex: 1}}
                  facing="back"
                  barcodeScannerSettings={{
                    barcodeTypes: ['qr'],
                  }}
                  onBarcodeScanned={(result) => {
                    if (result && result.data) {
                      handleQRCodeScanned(result.data);
                    }
                  }}
                />
              ) : (
                <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
                  <Text style={{color: '#888', textAlign: 'center', padding: 20}}>
                    Camera permission required
                  </Text>
                  <TouchableOpacity
                    style={{backgroundColor: '#4a90d9', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8}}
                    onPress={requestCameraPermission}>
                    <Text style={{color: '#fff', fontWeight: '600'}}>Grant Permission</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
            
            <TouchableOpacity 
              style={{marginTop: 24, paddingVertical: 14, paddingHorizontal: 40, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8}}
              onPress={() => setQrScannerOpen(false)}>
              <Text style={{color: '#fff', fontSize: 16, fontWeight: '600'}}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      </SafeAreaView>
    );
  }

  if (view === 'settings') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setView('home')} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={styles.backBtn} />
        </View>
        
        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          <View style={styles.settingsCard}>
            <Text style={styles.settingsTitle}>Server</Text>
            <Text style={styles.settingsDescription}>
              Choose where your cloud will be running:
            </Text>
            
            <View style={styles.serverToggle}>
              <TouchableOpacity 
                style={[styles.toggleBtn, serverType === 'local' && styles.toggleBtnActive]}
                onPress={() => setServerType('local')}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.toggleText, serverType === 'local' && styles.toggleTextActive]}>
                  Local
                </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.toggleBtn, serverType === 'remote' && styles.toggleBtnActive]}
                onPress={() => setServerType('remote')}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.toggleText, serverType === 'remote' && styles.toggleTextActive]}>
                  Remote
                </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.toggleBtn, serverType === 'stealthcloud' && styles.toggleBtnActive]}
                onPress={async () => {
                  await SecureStore.setItemAsync('server_type', 'stealthcloud');
                  setServerType('stealthcloud');
                  await logout();
                }}>
                <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.toggleText, serverType === 'stealthcloud' && styles.toggleTextActive]}>
                  StealthCloud
                </Text>
              </TouchableOpacity>
            </View>
            
            {serverType !== 'stealthcloud' && (
              <View style={styles.serverExplanation}>
                {serverType === 'local' ? (
                  <Text style={styles.serverExplanationText}>
                    📱 <Text style={styles.boldText}>Local:</Text> Server on same WiFi network{'\n'}
                    (e.g., your home computer or laptop)
                  </Text>
                ) : serverType === 'remote' ? (
                  <Text style={styles.serverExplanationText}>
                    🌐 <Text style={styles.boldText}>Remote:</Text> Server anywhere on internet{'\n'}
                    (e.g., cloud server — open port 3000 externally)
                  </Text>
                ) : null}
              </View>
            )}
            
            {serverType === 'remote' && (
              <TextInput 
                style={[styles.input, {marginTop: 12}]} 
                placeholder="IP or domain of your server" 
                placeholderTextColor="#666666"
                value={remoteHost}
                onChangeText={(t) => setRemoteHost(normalizeHostInput(t))}
                autoCapitalize="none"
              />
            )}

            {serverType === 'local' && (
              <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 12}}>
                <TextInput 
                  style={[styles.input, {flex: 1, marginTop: 0, marginRight: 8}]} 
                  placeholder="Local server IP" 
                  placeholderTextColor="#666666"
                  value={localHost}
                  onChangeText={(t) => setLocalHost(normalizeHostInput(t))}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 8,
                    backgroundColor: '#1f1f1f',
                    borderWidth: 1,
                    borderColor: '#2f2f2f',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onPress={async () => {
                    if (!cameraPermission?.granted) {
                      const result = await requestCameraPermission();
                      if (!result.granted) {
                        Alert.alert('Camera Permission', 'Camera access is needed to scan QR codes.');
                        return;
                      }
                    }
                    setQrScannerOpen(true);
                  }}
                >
                  <View style={{width: 22, height: 22}}>
                    <View style={{position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderWidth: 2, borderColor: '#fff', borderRadius: 2}} />
                    <View style={{position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderWidth: 2, borderColor: '#fff', borderRadius: 2}} />
                    <View style={{position: 'absolute', bottom: 0, left: 0, width: 10, height: 10, borderWidth: 2, borderColor: '#fff', borderRadius: 2}} />
                    <View style={{position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderWidth: 2, borderColor: '#fff', borderRadius: 2}} />
                    <View style={{position: 'absolute', top: 8, left: 8, width: 6, height: 6, backgroundColor: '#fff', borderRadius: 1}} />
                  </View>
                </TouchableOpacity>
              </View>
            )}
            
            <View style={styles.serverInfo}>
              <Text style={styles.serverInfoLabel}>Chosen connection:</Text>
              <Text style={styles.serverInfoText}>{getServerUrl()}</Text>
            </View>

            {serverType !== 'stealthcloud' && (
              <TouchableOpacity 
                style={styles.btnPrimary} 
                onPress={async () => {
                  await SecureStore.setItemAsync('server_type', serverType);
                  if (serverType === 'remote') {
                    await SecureStore.setItemAsync('remote_host', remoteHost);
                  } else if (serverType === 'local') {
                    await SecureStore.setItemAsync('local_host', localHost);
                  }
                  await logout();
                  showDarkAlert('Saved', 'Server settings updated');
                }}>
                <Text style={styles.btnText}>Save Changes</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Auto Upload toggle hidden - feature kept for future background upload support
          {serverType === 'stealthcloud' && (
            <View style={styles.settingsCard}>
              <Text style={styles.settingsTitle}>Auto Upload</Text>
              <Text style={styles.settingsDescription}>
                Backs up photos/videos on Wi-Fi when charging or battery over 50%. Keep app open — backgrounding or locking will pause.
              </Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Auto Upload</Text>
                <Switch
                  value={autoUploadEnabled}
                  onValueChange={(next) => {
                    if (next) {
                      // Keep the switch OFF until the user confirms.
                      setAutoUploadEnabledSafe(false);
                      showDarkAlert(
                        'Enable Auto Upload?',
                        'Requires Wi-Fi and either charging or >50% battery.\n\nKeep the app open — backgrounding or locking will pause the upload.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Enable',
                            onPress: async () => {
                              await persistAutoUploadEnabled(true);
                              // Kick scheduling immediately.
                              try {
                                scheduleNextAutoUploadNightKick();
                                if (serverTypeRef.current === 'stealthcloud' && tokenRef.current) {
                                  void maybeStartAutoUploadNightSession();
                                }
                              } catch (e) {}
                            }
                          }
                        ]
                      );
                      return;
                    }

                    persistAutoUploadEnabled(false);
                    
                    // Cancel any running auto upload session
                    autoUploadNightRunnerCancelRef.current = true;
                    autoUploadNightRunnerActiveRef.current = false;
                    
                    setStatus('Auto backup disabled');

                    try {
                      scheduleNextAutoUploadNightKick();
                    } catch (e) {}
                  }}
                />
              </View>
            </View>
          )}
          */}

          {serverType === 'stealthcloud' && (
            <View style={styles.settingsCard}>
              <Text style={styles.settingsTitle}>Performance</Text>
              <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
                <Text style={styles.inputLabel}>{fastModeEnabled ? 'Fast Mode' : 'Slow Mode'}</Text>
                <Switch
                  value={fastModeEnabled}
                  onValueChange={persistFastModeEnabled}
                  trackColor={{ false: '#CCCCCC', true: '#FF4444' }}
                  thumbColor='#FFFFFF'
                />
              </View>
              <Text style={styles.settingsDescription}>
                {fastModeEnabled
                  ? 'Faster uploads but uses more CPU and battery.\nRecommended when speed is a priority.'
                  : 'Safe for phone CPU and battery. Uploads will be significantly slower but your device stays cool.'}
              </Text>
            </View>
          )}

          {serverType === 'stealthcloud' ? (
            <View style={styles.settingsCard}>
              <Text style={styles.settingsTitle}>StealthCloud</Text>
              <Text style={styles.settingsDescription}>Danger zone</Text>

              <TouchableOpacity
                style={[styles.btnDanger, loading && styles.disabledCard]}
                disabled={loading}
                onPress={purgeStealthCloudData}>
                <Text style={styles.btnDangerText}>Delete all data on server</Text>
              </TouchableOpacity>

              <Text style={styles.inputHint}>
                This removes encrypted chunks and manifests from the server for your device/account.
              </Text>
            </View>
          ) : (
            <View style={styles.settingsCard}>
              <Text style={styles.settingsTitle}>Server</Text>
              <Text style={styles.settingsDescription}>Danger zone</Text>

              <TouchableOpacity
                style={[styles.btnDanger, loading && styles.disabledCard]}
                disabled={loading}
                onPress={purgeClassicServerData}>
                <Text style={styles.btnDangerText}>Delete all data on server</Text>
              </TouchableOpacity>

              <Text style={styles.inputHint}>
                This removes uploaded photos/videos from your server for your device/account.
              </Text>
            </View>
          )}

        </ScrollView>

        {quickSetupOpen && (
          <View style={styles.overlay}>
            <View style={styles.overlayCard}>
              <Text style={styles.overlayTitle}>Quick Setup</Text>
              <Text style={[styles.overlaySubtitle, { textAlign: 'left' }]}>
                <Text style={styles.boldText}>1)</Text> Download the server app on your computer:
              </Text>
              <TouchableOpacity
                style={{ marginBottom: 8 }}
                onPress={() => {
                  Clipboard.setString(GITHUB_RELEASES_LATEST_URL);
                  showDarkAlert('Copied', 'GitHub Releases link copied.');
                }}
                onLongPress={() => openLink(GITHUB_RELEASES_LATEST_URL)}>
                <Text style={styles.codeLine} numberOfLines={1} ellipsizeMode="middle">{GITHUB_RELEASES_LATEST_URL}</Text>
                <Text style={styles.codeHint}>Tap to copy • Long-press to open</Text>
              </TouchableOpacity>

              {serverType === 'local' && (
                <Text style={[styles.overlaySubtitle, { textAlign: 'left' }]}>
                  <Text style={styles.boldText}>2)</Text> Install + run it (tray/menu bar){'\n'}
                  <Text style={styles.boldText}>3)</Text> Copy IP from tray → <Text style={styles.boldText}>Local IP Addresses</Text>{'\n'}
                  <Text style={styles.boldText}>4)</Text> In this app: <Text style={styles.boldText}>Local</Text> → paste IP → <Text style={styles.boldText}>Save Changes</Text>{'\n'}
                  <Text style={styles.boldText}>5)</Text> <Text style={styles.boldText}>Create Account</Text> / <Text style={styles.boldText}>Login</Text> → <Text style={styles.boldText}>Backup Photos</Text>
                </Text>
              )}

              {serverType === 'remote' && (
                <Text style={[styles.overlaySubtitle, { textAlign: 'left' }]}>
                  <Text style={styles.boldText}>2)</Text> Run the server on your VPS/home server{'\n'}
                  <Text style={styles.boldText}>3)</Text> Enable HTTPS (TLS) on port 3000{'\n'}
                  <Text style={styles.boldText}>4)</Text> In this app: <Text style={styles.boldText}>Remote</Text> → enter host (IP/domain) → <Text style={styles.boldText}>Save Changes</Text>{'\n'}
                  <Text style={styles.boldText}>5)</Text> <Text style={styles.boldText}>Login</Text> → <Text style={styles.boldText}>Backup Photos</Text> / <Text style={styles.boldText}>Sync from Cloud</Text>
                </Text>
              )}

              <TouchableOpacity style={styles.overlayBtnSecondary} onPress={() => setQuickSetupOpen(false)}>
                <Text style={styles.overlayBtnSecondaryText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {qrScannerOpen && (
          <View style={[styles.overlay, {backgroundColor: 'rgba(0,0,0,0.95)'}]}>
            <View style={{flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center'}}>
              <Text style={{color: '#fff', fontSize: 20, fontWeight: '600', marginBottom: 8}}>
                📷 Scan QR Code
              </Text>
              <Text style={{color: '#aaa', fontSize: 14, marginBottom: 20, textAlign: 'center', paddingHorizontal: 40}}>
                Point your camera at the QR code shown in the PhotoLynk Server tray app
              </Text>
              
              <View style={{width: 280, height: 280, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000'}}>
                {cameraPermission?.granted ? (
                  <CameraView
                    style={{flex: 1}}
                    facing="back"
                    barcodeScannerSettings={{
                      barcodeTypes: ['qr'],
                    }}
                    onBarcodeScanned={(result) => {
                      if (result && result.data) {
                        handleQRCodeScanned(result.data);
                      }
                    }}
                  />
                ) : (
                  <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
                    <Text style={{color: '#888', textAlign: 'center', padding: 20}}>
                      Camera permission required
                    </Text>
                    <TouchableOpacity
                      style={{backgroundColor: '#4a90d9', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8}}
                      onPress={requestCameraPermission}>
                      <Text style={{color: '#fff', fontWeight: '600'}}>Grant Permission</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
              
              <TouchableOpacity 
                style={{marginTop: 24, paddingVertical: 14, paddingHorizontal: 40, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8}}
                onPress={() => setQrScannerOpen(false)}>
                <Text style={{color: '#fff', fontSize: 16, fontWeight: '600'}}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {customAlert && (
          <View style={styles.overlay}>
            <View style={[styles.overlayCard, { backgroundColor: '#2A2A2A', maxWidth: 320 }]}>
              <Text style={[styles.overlayTitle, { fontSize: 18, marginBottom: 8 }]}>{customAlert.title}</Text>
              <Text style={{ color: '#CCC', fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>{customAlert.message}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
                {(customAlert.buttons || []).map((btn, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.overlayBtnPrimary, { paddingVertical: 10, paddingHorizontal: 24, minWidth: 80 }]}
                    onPress={() => {
                      closeDarkAlert();
                      if (btn.onPress) btn.onPress();
                    }}>
                    <Text style={styles.overlayBtnPrimaryText}>{btn.text}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}
      </View>
    );
  }

  if (view === 'about') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setView('home')} style={styles.backBtn}>
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>About</Text>
          <View style={{width: 60}} />
        </View>
        
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: Math.max(16, SCREEN_WIDTH * 0.04), paddingTop: 16, paddingBottom: 40 }}>
          <View style={styles.settingsCard}>
            <Text style={styles.settingsTitle}>{APP_DISPLAY_NAME}</Text>
            {deviceUuid && (
              <TouchableOpacity 
                style={styles.uuidBox}
                onPress={() => {
                  Clipboard.setString(deviceUuid);
                  showDarkAlert('Copied!', 'User ID copied to clipboard');
                }}>
                <Text style={styles.uuidLabel}>User ID (tap to copy):</Text>
                <Text style={styles.uuidText}>{deviceUuid}</Text>
              </TouchableOpacity>
            )}
          </View>

          {serverType === 'stealthcloud' && (
            <View style={styles.settingsCard}>
              <Text style={styles.settingsTitle}>StealthCloud Storage</Text>
              <Text style={styles.settingsDescription}>Your encrypted cloud usage</Text>

              {stealthUsageLoading && (
                <View style={{ paddingVertical: 6 }}>
                  <ActivityIndicator size="small" color={THEME.secondary} />
                </View>
              )}

              {!!stealthUsageError && (
                <Text style={styles.inputHint}>{stealthUsageError}</Text>
              )}

              {!!stealthUsage && (
                <View>
                  {(() => {
                    const quotaBytes = Number(stealthUsage.quotaBytes ?? stealthUsage.quota_bytes ?? stealthUsage.quota ?? 0) || 0;
                    const usedBytes = Number(stealthUsage.usedBytes ?? stealthUsage.used_bytes ?? stealthUsage.used ?? 0) || 0;
                    const remainingBytes = Number(
                      (stealthUsage.remainingBytes ?? stealthUsage.remaining_bytes ?? stealthUsage.remaining) ??
                      (quotaBytes ? (quotaBytes - usedBytes) : 0)
                    ) || 0;
                    const sub = stealthUsage.subscription || {};
                    const subStatus = sub.status || 'none';
                    const isGrace = subStatus === 'grace' || subStatus === 'grace_expired';
                    const isExpired = subStatus === 'trial_expired' || subStatus === 'grace_expired';

                    return (
                      <>
                        <View style={styles.usageGrid}>
                          <View style={styles.usageItem}>
                            <Text style={styles.serverInfoLabel}>Plan</Text>
                            <Text style={styles.serverInfoText}>
                              {stealthUsage.planGb ? `${stealthUsage.planGb} GB` : (stealthUsage.plan_gb ? `${stealthUsage.plan_gb} GB` : '—')}
                            </Text>
                          </View>

                          <View style={styles.usageItem}>
                            <Text style={styles.serverInfoLabel}>Status</Text>
                            <Text style={[styles.serverInfoText, isExpired && { color: '#FF6B6B' }, isGrace && !isExpired && { color: '#FFB347' }]}>
                              {subStatus === 'active' ? '✓ Active' : 
                               subStatus === 'trial' ? '🎁 Free Trial' :
                               subStatus === 'grace' ? `⚠️ Expired (${GRACE_PERIOD_DAYS} days to sync)` :
                               subStatus === 'grace_expired' ? '❌ Grace Period Ended' :
                               subStatus === 'trial_expired' ? '❌ Trial Expired' : '—'}
                            </Text>
                          </View>

                          <View style={styles.usageItem}>
                            <Text style={styles.serverInfoLabel}>Used</Text>
                            <Text style={styles.serverInfoText}>
                              {formatBytesHumanDecimal(usedBytes)}
                            </Text>
                          </View>

                          <View style={styles.usageItem}>
                            <Text style={styles.serverInfoLabel}>Remaining</Text>
                            <Text style={styles.serverInfoText}>
                              {formatBytesHumanDecimal(remainingBytes)}
                            </Text>
                          </View>
                        </View>

                        {(isGrace || isExpired) && (
                          <View style={{ marginTop: 12 }}>
                            <Text style={[styles.inputHint, { color: '#FFB347', marginBottom: 8 }]}>
                              {isGrace && !isExpired 
                                ? `Your subscription expired. You have ${GRACE_PERIOD_DAYS} days to sync your data before access is locked.`
                                : 'Your subscription has expired. Renew to continue backups.'}
                            </Text>
                          </View>
                        )}
                      </>
                    );
                  })()}
                </View>
              )}

              {/* Subscription Management */}
              <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: '#333', paddingTop: 16 }}>
                <Text style={styles.serverInfoLabel}>Manage Subscription</Text>
                <Text style={[styles.inputHint, { marginTop: 6 }]}>Prices are shown in your local currency from Apple/Google.</Text>
                
                <View style={styles.stealthPlanGrid}>
                  {STEALTH_PLAN_TIERS.map((gb) => {
                    const plan = availablePlans.find(p => p.tierGb === gb);
                    const priceStr = plan ? plan.priceString : '—';
                    const currentPlan = stealthUsage?.planGb || stealthUsage?.plan_gb;
                    const isCurrent = currentPlan === gb;
                    
                    return (
                      <TouchableOpacity
                        key={String(gb)}
                        activeOpacity={0.85}
                        style={[
                          styles.stealthPlanCard,
                          isCurrent && styles.stealthPlanCardSelected,
                          purchaseLoading && styles.stealthPlanCardDisabled,
                        ]}
                        onPress={() => {
                          if (purchaseLoading) return;
                          if (isCurrent) {
                            showDarkAlert('Current Plan', 'This is your current plan.');
                            return;
                          }
                          openPaywall(gb);
                        }}>
                        <Text style={styles.stealthPlanGb}>{gb === 1000 ? '1 TB' : `${gb} GB`}</Text>
                        <Text style={styles.stealthPlanPrice}>{priceStr}</Text>
                        <Text style={styles.stealthPlanMeta}>{isCurrent ? 'Current' : 'per month'}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TouchableOpacity
                  style={styles.restorePurchasesBtn}
                  onPress={handleRestorePurchases}
                  disabled={purchaseLoading}>
                  <Text style={styles.restorePurchasesText}>Restore Purchases</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          
          <View style={styles.settingsCard}>
            <Text style={styles.settingsTitle}>Resources</Text>
            
            <TouchableOpacity 
              style={styles.resourceBtn}
              onPress={() => {
                const githubUrl = 'https://github.com/viktorvishyn369/PhotoLynk';
                Linking.openURL(githubUrl).catch(err => {
                  showDarkAlert('Error', 'Could not open link');
                });
              }}>
              <Text style={styles.resourceIcon}>📦</Text>
              <View style={styles.resourceContent}>
                <Text style={styles.resourceTitle}>GitHub</Text>
                <Text style={styles.resourceDesc}>Download server & docs</Text>
              </View>
              <Text style={styles.resourceArrow}>→</Text>
            </TouchableOpacity>
            
          </View>
          
          <View style={styles.settingsFooter}>
            <Text style={styles.footerVersion}>{APP_DISPLAY_NAME} v1.0.0</Text>
          </View>
        </ScrollView>

        {customAlert && (
          <View style={styles.overlay}>
            <View style={[styles.overlayCard, { backgroundColor: '#2A2A2A', maxWidth: 320 }]}>
              <Text style={[styles.overlayTitle, { fontSize: 18, marginBottom: 8 }]}>{customAlert.title}</Text>
              <Text style={{ color: '#CCC', fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>{customAlert.message}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
                {(customAlert.buttons || []).map((btn, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.overlayBtnPrimary, { paddingVertical: 10, paddingHorizontal: 24, minWidth: 80 }]}
                    onPress={() => {
                      closeDarkAlert();
                      if (btn.onPress) btn.onPress();
                    }}>
                    <Text style={styles.overlayBtnPrimaryText}>{btn.text}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}

        {paywallTierGb && (
          <View style={styles.overlay}>
            <View style={[styles.overlayCard, { backgroundColor: '#1E1E1E', maxWidth: 340 }]}>
              {(() => {
                const gb = paywallTierGb;
                const plan = availablePlans.find(p => p.tierGb === gb);
                const priceStr = plan ? plan.priceString : '—';
                const currentPlan = stealthUsage?.planGb || stealthUsage?.plan_gb;
                const isCurrent = currentPlan === gb;
                const canSubscribe = !purchaseLoading && !isCurrent && plan && priceStr && priceStr !== '—';
                const title = gb === 1000 ? '1 TB Monthly' : `${gb} GB Monthly`;

                return (
                  <>
                    <Text style={[styles.overlayTitle, { fontSize: 18, marginBottom: 8 }]}>{title}</Text>
                    <Text style={{ color: '#CCC', fontSize: 14, textAlign: 'center', marginBottom: 14, lineHeight: 20 }}>
                      {priceStr !== '—' ? `${priceStr} / month` : 'Pricing unavailable. Please try again later.'}
                    </Text>
                    <Text style={[styles.inputHint, { textAlign: 'center', marginBottom: 14 }]}>Price shown in your local currency from Apple/Google. Taxes may apply. Cancel anytime.</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <TouchableOpacity
                        style={[styles.overlayBtnPrimary, { paddingVertical: 10, paddingHorizontal: 24, minWidth: 90, opacity: purchaseLoading ? 0.6 : 1 }]}
                        onPress={closePaywall}
                        disabled={purchaseLoading}
                      >
                        <Text style={styles.overlayBtnPrimaryText}>Close</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.overlayBtnPrimary, { paddingVertical: 10, paddingHorizontal: 24, minWidth: 110, opacity: canSubscribe ? 1 : 0.5 }]}
                        onPress={() => {
                          if (!canSubscribe) return;
                          closePaywall();
                          handlePurchase(gb);
                        }}
                        disabled={!canSubscribe}
                      >
                        <Text style={styles.overlayBtnPrimaryText}>{isCurrent ? 'Current' : 'Subscribe'}</Text>
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                      style={[styles.restorePurchasesBtn, { marginTop: 14 }]}
                      onPress={() => {
                        closePaywall();
                        handleRestorePurchases();
                      }}
                      disabled={purchaseLoading}
                    >
                      <Text style={styles.restorePurchasesText}>Restore Purchases</Text>
                    </TouchableOpacity>
                  </>
                );
              })()}
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>PhotoLynk</Text>
          <Text style={styles.headerSubtitle}>Your Secure Backup</Text>
        </View>
        <View style={styles.headerButtons}>
          <TouchableOpacity onPress={() => setView('about')} style={styles.infoBtn}>
            <FontAwesome5 name="info-circle" size={18} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setView('settings')} style={styles.settingsBtn}>
            <FontAwesome5 name="cog" size={18} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => logout()}
            onLongPress={() => logout({ forgetCredentials: true })}
            style={styles.logoutBtn}>
            <FontAwesome5 name="sign-out-alt" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Text style={styles.statusLabel}>STATUS</Text>
          </View>
          <Text style={styles.statusText} numberOfLines={1} ellipsizeMode="tail">

            {status.startsWith('Idle • ') ? (

              <>

                Idle • <Text onPress={() => setView('settings')} style={{color: '#888888'}}>{status.split(' • ')[1]}</Text>

              </>

            ) : (

              status

            )}

          </Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }]} />
          </View>
        </View>

        <View style={styles.actionsContainer}>
          <TouchableOpacity 
            onPress={openBackupModeChooser} 
            disabled={loading}
            style={[styles.actionCard, styles.backupCard, loading && styles.disabledCard]}>
            <View style={styles.cardIcon}>
              <FontAwesome5 name="cloud-upload-alt" size={24} color="#FFFFFF" />
            </View>
            <Text style={styles.cardTitle}>Backup Photos</Text>
            <Text style={styles.cardDescription}>Upload photos/videos to {serverType === 'stealthcloud' ? 'StealthCloud' : serverType === 'remote' ? 'Remote' : 'Local'}</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            onPress={openSyncModeChooser} 
            onLongPress={async () => {
              await SecureStore.deleteItemAsync('downloaded_files');
              showDarkAlert('Reset', 'Download history cleared. All files will be re-downloaded.');
            }}
            disabled={loading}
            style={[styles.actionCard, styles.syncCard, loading && styles.disabledCard]}>
            <View style={styles.cardIcon}>
              <FontAwesome5 name="cloud-download-alt" size={24} color="#FFFFFF" />
            </View>
            <Text style={styles.cardTitle}>Sync from Cloud</Text>
            <Text style={styles.cardDescription}>Download backed up files to your device</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            onPress={openCleanupModeChooser} 
            disabled={loading}
            style={[styles.actionCard, styles.cleanupCard, loading && styles.disabledCard]}>
            <View style={styles.cardIcon}>
              <FontAwesome5 name="broom" size={22} color="#FFFFFF" />
            </View>
            <Text style={styles.cardTitle}>Clean Duplicates</Text>
            <Text style={styles.cardDescription}>Remove duplicate photos on your device</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {cleanupModeOpen && (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <Text style={styles.overlayTitle}>Clean Up Duplicates</Text>
            <Text style={styles.overlaySubtitle}>Free up space by removing exact duplicates and reviewing similar photos. Nothing is deleted without your confirmation.</Text>

            <TouchableOpacity
              style={styles.overlayBtnPrimary}
              onPress={async () => {
                closeCleanupModeChooser();
                await cleanDeviceDuplicates();
              }}>
              <Text style={styles.overlayBtnPrimaryText}>Delete Exact Duplicates</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.overlayBtnSecondary}
              onPress={async () => {
                closeCleanupModeChooser();
                await startSimilarShotsReview();
              }}>
              <Text style={styles.overlayBtnSecondaryText}>Review Similar Photos</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.overlayBtnGhost}
              onPress={closeCleanupModeChooser}>
              <Text style={styles.overlayBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {similarReviewOpen && (
        <View style={styles.overlay}>
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={closeSimilarReview} style={styles.pickerHeaderBtn}>
                <Text style={styles.pickerHeaderBtnText}>Cancel</Text>
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={styles.pickerHeaderTitle}>Similar Photos</Text>
                <Text style={styles.pickerHeaderSubtitle}>Set {Math.min(similarGroupIndex + 1, (similarGroups || []).length)}/{(similarGroups || []).length}</Text>
              </View>
              <View style={{ width: 60 }} />
            </View>

            <ScrollView contentContainerStyle={styles.pickerGrid}>
              {((similarGroups || [])[similarGroupIndex] || []).map((a) => {
                const selected = !!(similarSelected && similarSelected[String(a && a.id ? a.id : '')]);
                return (
                  <TouchableOpacity
                    key={String(a.id)}
                    style={[styles.pickerItem, selected && styles.pickerItemSelected]}
                    onPress={() => toggleSimilarSelected(a.id)}>
                    <Image source={{ uri: a.uri }} style={styles.pickerThumb} />
                    {selected && (
                      <View style={styles.pickerCheck}>
                        <Text style={styles.pickerCheckText}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}

              <View style={{ width: '100%', paddingVertical: 12 }}>
                <Text style={styles.overlaySubtitle}>Select photo(s) to remove.{'\n'}The remaining photo(s) will be kept.</Text>

                <TouchableOpacity
                  disabled={getSimilarSelectedIds().length === 0 || loading}
                  style={styles.overlayBtnPrimary}
                  onPress={async () => {
                    const ids = getSimilarSelectedIds();
                    if (ids.length === 0) return;
                    setLoadingSafe(true);
                    setStatus('Deleting selected photos...');
                    let didDelete = false;
                    
                    try {
                      // Use native MediaDelete module on Android for proper scoped storage handling
                      if (Platform.OS === 'android' && MediaDelete && typeof MediaDelete.deleteAssets === 'function') {
                        console.log('Similar Photos: Using native MediaDelete for', ids.length, 'items');
                        const result = await MediaDelete.deleteAssets(ids);
                        if (result === true) {
                          didDelete = true;
                          setStatus(`Deleted ${ids.length} item${ids.length !== 1 ? 's' : ''}`);
                        } else {
                          setStatus('Deletion cancelled');
                        }
                      } else {
                        // iOS or fallback
                        const result = await MediaLibrary.deleteAssetsAsync(ids);
                        if (result === true || typeof result === 'undefined') {
                          didDelete = true;
                          setStatus(`Deleted ${ids.length} item${ids.length !== 1 ? 's' : ''}`);
                        } else {
                          setStatus('Deletion cancelled or partial');
                        }
                      }
                    } catch (e) {
                      console.log('Similar Photos: Delete error', e?.message || e);
                      showDarkAlert('Delete Failed', e?.message || 'Could not delete items.');
                      setStatus('Delete failed');
                    }
                    
                    setLoadingSafe(false);

                    if (!didDelete) {
                      return;
                    }

                    const prevGroups = Array.isArray(similarGroups) ? similarGroups : [];
                    const nextGroups = prevGroups
                      .map((g) => (Array.isArray(g) ? g.filter((it) => it && it.id && !ids.includes(String(it.id))) : []))
                      .filter((g) => Array.isArray(g) && g.length >= 2);

                    if (nextGroups.length === 0) {
                      closeSimilarReview();
                      setStatus('Cleanup complete');
                      showDarkAlert('Similar Photos', 'Review complete.');
                      return;
                    }

                    const nextIndex = Math.min(similarGroupIndex, nextGroups.length - 1);
                    setSimilarGroups(nextGroups);
                    setSimilarGroupIndex(nextIndex);
                    setSimilarSelected(buildDefaultSimilarSelection(nextGroups[nextIndex] || []));
                  }}>
                  <Text style={styles.overlayBtnPrimaryText}>Move Selected to Trash</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.overlayBtnSecondary}
                  onPress={() => {
                    advanceSimilarGroup({ groups: similarGroups, nextIndex: similarGroupIndex + 1 });
                  }}>
                  <Text style={styles.overlayBtnSecondaryText}>Keep All</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      {backupModeOpen && (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <Text style={styles.overlayTitle}>Backup Photos</Text>
            <Text style={styles.overlaySubtitle}>Choose how you want to back up (existing files on server will be skipped).</Text>

            <TouchableOpacity
              style={styles.overlayBtnPrimary}
              onPress={async () => {
                closeBackupModeChooser();
                await backupPhotos();
              }}>
              <Text style={styles.overlayBtnPrimaryText}>All (skip existing)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.overlayBtnSecondary}
              onPress={async () => {
                closeBackupModeChooser();
                await openBackupPicker();
              }}>
              <Text style={styles.overlayBtnSecondaryText}>Choose photos/videos</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.overlayBtnGhost}
              onPress={closeBackupModeChooser}>
              <Text style={styles.overlayBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {backupPickerOpen && (
        <View style={styles.overlay}>
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={closeBackupPicker} style={styles.pickerHeaderBtn}>
                <Text style={styles.pickerHeaderBtnText}>Cancel</Text>
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={styles.pickerHeaderTitle}>Select media</Text>
                <Text style={styles.pickerHeaderSubtitle}>{Object.keys(backupPickerSelected || {}).filter(k => backupPickerSelected[k]).length} selected</Text>
              </View>
              <TouchableOpacity
                disabled={Object.keys(backupPickerSelected || {}).filter(k => backupPickerSelected[k]).length === 0 || loading}
                onPress={async () => {
                  const selected = getSelectedPickerAssets();
                  closeBackupPicker();
                  await backupSelectedAssets({ assets: selected });
                }}
                style={styles.pickerHeaderBtn}>
                <Text style={styles.pickerHeaderBtnText}>Start</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.pickerGrid}>
              {(backupPickerAssets || []).map((a) => {
                const selected = !!(backupPickerSelected && backupPickerSelected[a.id]);
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.pickerItem, selected && styles.pickerItemSelected]}
                    onPress={() => toggleBackupPickerSelected(a.id)}>
                    <Image source={{ uri: a.uri }} style={styles.pickerThumb} />
                    {a.mediaType === 'video' && (
                      <View style={styles.pickerBadge}>
                        <Text style={styles.pickerBadgeText}>VIDEO</Text>
                      </View>
                    )}
                    {selected && (
                      <View style={styles.pickerCheck}>
                        <Text style={styles.pickerCheckText}>✓</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}

              <View style={{ width: '100%', paddingVertical: 12 }}>
                {backupPickerLoading ? (
                  <ActivityIndicator size="small" color={THEME.secondary} />
                ) : (
                  backupPickerHasNext && (
                    <TouchableOpacity
                      style={styles.overlayBtnSecondary}
                      onPress={() => loadBackupPickerPage({ reset: false })}>
                      <Text style={styles.overlayBtnSecondaryText}>Load more</Text>
                    </TouchableOpacity>
                  )
                )}
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      {syncModeOpen && (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <Text style={styles.overlayTitle}>Sync from Cloud</Text>
            <Text style={styles.overlaySubtitle}>Choose how you want to sync (existing files on device will be skipped).</Text>

            <TouchableOpacity
              style={styles.overlayBtnPrimary}
              onPress={async () => {
                closeSyncModeChooser();
                await restorePhotos();
              }}>
              <Text style={styles.overlayBtnPrimaryText}>All (skip existing)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.overlayBtnSecondary}
              onPress={async () => {
                closeSyncModeChooser();
                await openSyncPicker();
              }}>
              <Text style={styles.overlayBtnSecondaryText}>Choose files</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.overlayBtnGhost}
              onPress={closeSyncModeChooser}>
              <Text style={styles.overlayBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {syncPickerOpen && (
        <View style={styles.overlay}>
          <View style={styles.pickerCard}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={closeSyncPicker} style={styles.pickerHeaderBtn}>
                <Text style={styles.pickerHeaderBtnText}>Cancel</Text>
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={styles.pickerHeaderTitle}>Select files</Text>
                <Text style={styles.pickerHeaderSubtitle}>{getSelectedSyncKeys().length} selected</Text>
              </View>
              <TouchableOpacity
                disabled={getSelectedSyncKeys().length === 0 || loading}
                onPress={async () => {
                  const selectedKeys = getSelectedSyncKeys();
                  closeSyncPicker();
                  if (serverType === 'stealthcloud') {
                    await restorePhotos({ manifestIds: selectedKeys });
                  } else {
                    await restorePhotos({ onlyFilenames: selectedKeys });
                  }
                }}
                style={styles.pickerHeaderBtn}>
                <Text style={styles.pickerHeaderBtnText}>Start</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.syncPickerList}>
              {syncPickerLoading ? (
                <View style={{ width: '100%', paddingVertical: 32, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={THEME.secondary} />
                  <Text style={{ color: '#888', fontSize: 13, marginTop: 10 }}>Loading files...</Text>
                </View>
              ) : (
                <>
                  {/* File count header */}
                  <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#222' }}>
                    <Text style={{ color: '#888', fontSize: 12 }}>
                      Showing {syncPickerItems.length}{syncPickerTotal > 0 ? ` of ${syncPickerTotal}` : ''} files
                    </Text>
                  </View>
                  
                  {(syncPickerItems || []).map((it) => {
                    const key = serverType === 'stealthcloud'
                      ? String(it && it.manifestId ? it.manifestId : '')
                      : String(it && it.filename ? it.filename : '');
                    if (!key) return null;
                    const selected = !!(syncPickerSelected && syncPickerSelected[key]);
                    // Display filename (decrypted for StealthCloud, original for classic)
                    const displayName = it && it.filename ? it.filename : key;
                    const fileSize = it && typeof it.size === 'number' ? it.size : null;
                    // Determine file type from mediaType or extension
                    const mediaType = it && it.mediaType ? it.mediaType : null;
                    const ext = (displayName || '').split('.').pop()?.toLowerCase() || '';
                    const isVideo = mediaType === 'video' || ['mp4', 'mov', 'avi', 'mkv', 'm4v', '3gp', 'webm'].includes(ext);
                    const isImage = mediaType === 'photo' || ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp', 'tiff'].includes(ext);
                    const fileIcon = isVideo ? '🎬' : isImage ? '🖼️' : '📄';
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[styles.syncPickerRow, selected && styles.syncPickerRowSelected]}
                        onPress={() => toggleSyncPickerSelected(key)}>
                        {/* Always show file type icon - thumbnails not available for encrypted files */}
                        <View style={{ width: 44, height: 44, borderRadius: 6, marginRight: 10, backgroundColor: isVideo ? '#1a1a2e' : '#1e3a2e', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 22 }}>{fileIcon}</Text>
                        </View>
                        <View style={[styles.syncPickerRowLeft, { flex: 1 }]}>
                          <Text style={styles.syncPickerRowTitle} numberOfLines={1} ellipsizeMode="middle">{displayName}</Text>
                          {fileSize !== null && (
                            <Text style={styles.syncPickerRowMeta}>{formatBytesHuman(fileSize)}</Text>
                          )}
                        </View>
                        <View style={[styles.syncPickerCheck, selected && styles.syncPickerCheckOn]}>
                          <Text style={[styles.syncPickerCheckText, selected && styles.syncPickerCheckTextOn]}>{selected ? '✓' : ''}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  
                  {/* Load More button */}
                  {syncPickerHasMore && (
                    <TouchableOpacity
                      style={{ 
                        marginVertical: 16, 
                        marginHorizontal: 12, 
                        paddingVertical: 14, 
                        backgroundColor: THEME.secondary, 
                        borderRadius: 10, 
                        alignItems: 'center' 
                      }}
                      onPress={loadMoreSyncPickerItems}
                      disabled={syncPickerLoadingMore}>
                      {syncPickerLoadingMore ? (
                        <ActivityIndicator size="small" color="#000" />
                      ) : (
                        <Text style={{ color: '#000', fontWeight: '600', fontSize: 15 }}>
                          Load More ({Math.max(0, (syncPickerTotal || 0) - (syncPickerOffset || 0))} remaining)
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      )}

      {duplicateReview && (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            <Text style={styles.overlayTitle}>Review Duplicates</Text>
            <Text style={styles.overlaySubtitle}>
              {`Found ${duplicateReview.duplicateCount} items in ${duplicateReview.groupCount} group${duplicateReview.groupCount !== 1 ? 's' : ''} (${duplicateReview.mode}). Uncheck any items you want to keep.`}
            </Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {duplicateReview.groups.map((group) => (
                <View key={`grp-${group.groupIndex}`} style={{ marginBottom: 12, padding: 10, backgroundColor: '#111', borderRadius: 8 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', marginBottom: 6 }}>
                    {group.type === 'similar' ? 'Similar' : 'Exact'} Group {group.groupIndex}
                  </Text>
                  {group.items.map((item, idx) => (
                    <TouchableOpacity
                      key={item.id}
                      style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 4 }}
                      onPress={() => {
                        setDuplicateReview(prev => {
                          if (!prev) return prev;
                          const next = { ...prev, groups: prev.groups.map(g => {
                            if (g.groupIndex !== group.groupIndex) return g;
                            return {
                              ...g,
                              items: g.items.map(it => it.id === item.id ? { ...it, delete: !it.delete } : it)
                            };
                          })};
                          return next;
                        });
                      }}
                    >
                      <View style={{
                        width: 22, height: 22, borderRadius: 4,
                        borderWidth: 2, borderColor: item.delete ? THEME.secondary : '#555',
                        backgroundColor: item.delete ? THEME.secondary : 'transparent',
                        marginRight: 10
                      }} />
                      <View style={{ width: 44, height: 44, borderRadius: 6, overflow: 'hidden', marginRight: 10, backgroundColor: '#222', borderWidth: 1, borderColor: '#333' }}>
                        {item.uri ? (
                          <Image
                            source={{ uri: item.uri }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                          />
                        ) : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#fff' }} numberOfLines={1}>{item.filename}</Text>
                        <Text style={{ color: '#888', fontSize: 12 }}>
                          {new Date(item.created).toLocaleString()} {item.size ? `· ${item.size} bytes` : ''}
                        </Text>
                      </View>
                      {idx === 0 && <Text style={{ color: '#03DAC6', fontSize: 12 }}>Keep oldest</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', marginTop: 12, gap: 10 }}>
              <TouchableOpacity
                style={[styles.overlayBtnSecondary, { flex: 1 }]}
                onPress={() => { setDuplicateReview(null); setStatus('Duplicate scan cancelled.'); }}
              >
                <Text style={styles.overlayBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.overlayBtnPrimary, { flex: 1 }]}
                onPress={async () => {
                  try {
                    const idsToDelete = [];
                    duplicateReview.groups.forEach(g => {
                      g.items.forEach(it => { if (it.delete) idsToDelete.push(it.id); });
                    });
                    if (idsToDelete.length === 0) {
                      setStatus('Nothing to delete');
                      setDuplicateReview(null);
                      return;
                    }
                    setStatus(`Deleting ${idsToDelete.length} item${idsToDelete.length !== 1 ? 's' : ''}...`);
                    
                    // Use native MediaDelete module on Android for proper scoped storage handling
                    if (Platform.OS === 'android' && MediaDelete && typeof MediaDelete.deleteAssets === 'function') {
                      console.log('Clean Duplicates: Using native MediaDelete for', idsToDelete.length, 'items');
                      const result = await MediaDelete.deleteAssets(idsToDelete);
                      if (result === true) {
                        showDarkAlert('Clean Complete', `Deleted: ${idsToDelete.length}`);
                        setStatus(`Deleted ${idsToDelete.length} item${idsToDelete.length !== 1 ? 's' : ''}`);
                      } else {
                        setStatus('Deletion cancelled');
                      }
                    } else {
                      // iOS or fallback
                      const result = await MediaLibrary.deleteAssetsAsync(idsToDelete);
                      if (result === true) {
                        showDarkAlert('Clean Complete', `Deleted: ${idsToDelete.length}`);
                        setStatus(`Deleted ${idsToDelete.length} item${idsToDelete.length !== 1 ? 's' : ''}`);
                      } else {
                        setStatus('Deletion cancelled or partial');
                      }
                    }
                  } catch (err) {
                    showDarkAlert('Clean Error', err.message || 'Could not delete items.');
                    setStatus('Delete failed');
                  } finally {
                    setDuplicateReview(null);
                    setLoadingSafe(false);
                    setBackgroundWarnEligibleSafe(false);
                    setWasBackgroundedDuringWorkSafe(false);
                  }
                }}
              >
                <Text style={styles.overlayBtnPrimaryText}>Delete Selected</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {customAlert && (
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: '#2A2A2A', maxWidth: 320 }]}>
            <Text style={[styles.overlayTitle, { fontSize: 18, marginBottom: 8 }]}>{customAlert.title}</Text>
            <Text style={{ color: '#CCC', fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>{customAlert.message}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 12 }}>
              {(customAlert.buttons || []).map((btn, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.overlayBtnPrimary, { paddingVertical: 10, paddingHorizontal: 24, minWidth: 80 }]}
                  onPress={() => {
                    closeDarkAlert();
                    if (btn.onPress) btn.onPress();
                  }}>
                  <Text style={styles.overlayBtnPrimaryText}>{btn.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}

    </View>
  );

}