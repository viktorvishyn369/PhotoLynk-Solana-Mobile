// PhotoLynk Mobile App - App.js

import 'react-native-get-random-values';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Appearance,
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
  Modal,
} from 'react-native';
import * as ReactNative from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import * as ScreenOrientation from 'expo-screen-orientation';
import { styles, THEME, scale, scaleSpacing, isTablet } from './styles';
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
  formatFilenameForStatus,
  normalizeEmailForDeviceUuid,
  isValidUrl,
  computeFileIdentity,
  getMimeFromFilename,
} from './utils';
import { computeAndroidHardwareId, computeIosHardwareId } from './deviceId';
import { makeHistoryKey, loadRestoreHistory, saveRestoreHistory, clearRestoreHistory } from './restoreHistory';
import { GradientSpinner, GlassCard } from './uiComponents';
import { buildLocalFilenameSetPaged, buildLocalAssetIdSetPaged, fetchAllServerFilesPaged, fetchAllManifestsPaged } from './mediaHelpers';
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
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as FileSystem from 'expo-file-system';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as KeepAwake from 'expo-keep-awake';
import * as Network from 'expo-network';
import * as Battery from 'expo-battery';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as ImageManipulator from 'expo-image-manipulator';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { v4 as uuidv4, v5 as uuidv5 } from 'uuid';
import { Feather } from '@expo/vector-icons';
import axios from 'axios';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { sha256 } from 'js-sha256';
import {
  initializeSolana,
  getAvailablePlans,
  purchaseWithSol,
  purchaseWithWallet,
  getAvailablePaymentWallets,
  getWalletConnectionStatus,
  getSubscriptionStatus,
  checkUploadAccess,
  GRACE_PERIOD_DAYS,
} from './solanaPurchases';
import {
  stealthCloudUploadEncryptedChunk,
  PHOTO_ALBUM_NAME,
  LEGACY_PHOTO_ALBUM_NAME,
} from './backupManager';
import {
  stealthCloudRestoreCore,
  localRemoteRestoreCore,
} from './syncOperations';
import { fetchStealthCloudPickerPage, fetchLocalRemotePickerPage, fetchStealthCloudThumbFileUri, fetchThumbnailBase64 } from './syncPickerOperations';
import { SettingsScreen } from './SettingsScreen';
import { InfoScreen } from './InfoScreen';
import { LoginScreen } from './LoginScreen';
import { HomeScreen } from './HomeScreen';
import {
  validateAuthInputs,
  resolveEffectiveServerSettings,
  persistServerSettings,
  getHardwareDeviceId,
  buildAuthPayload,
  storeCredentialsWithBiometrics,
  handleCredentialsChange,
  checkFirstLaunchAfterReinstall,
  loadServerSettings,
  validateToken,
  getSavedPasswordWithBiometrics,
  attemptBiometricReauth,
  performDevicePasswordReset,
  logoutCore,
  getDeviceUUID,
} from './authHelpers';
import { computeExactFileHash, computePerceptualHash, findPerceptualHashMatch, extractBaseFilename, normalizeDateForCompare, normalizeFullTimestamp, extractExifForDedup, generateExifDedupKeys, CROSS_PLATFORM_DHASH_THRESHOLD } from './duplicateScanner';
import { stealthCloudBackupCore, stealthCloudBackupSelectedCore } from './backupOperations';
import { localRemoteBackupCore, localRemoteBackupSelectedCore } from './uploadOperations';
import { startSimilarShotsReviewCore, buildDefaultSimilarSelection as buildDefaultSimilarSelectionCore, startExactDuplicatesScanCore } from './cleanDuplicatesOperations';
import { buildResultMessage, checkTierAvailability } from './uiHelpers';
import NFTOperations, { checkStealthCloudEligibility } from './nftOperations';
import * as WalletAdapter from './WalletAdapter';
import NFTPhotoPicker from './NFTPhotoPicker';
import NFTGallery from './NFTGallery';
import NFTTransferModal from './NFTTransferModal';
import CertificatesViewer from './CertificatesViewer';
import { initializeLanguage, t, getCurrentLanguage, setLanguage, SUPPORTED_LANGUAGES } from './i18n';
import LanguageSelector, { LanguageButton } from './LanguageSelector';
import {
  loadHashCache,
  flushHashCache,
  clearHashCache,
  runBackgroundPreAnalysis,
  abortPreAnalysis,
  isPreAnalysisRunning,
  getHashCacheStats,
} from './hashCache';

// Constants moved from inline definitions
const APP_DISPLAY_NAME = 'PhotoLynk';
const LEGACY_APP_DISPLAY_NAME = 'PhotoSync';
const PHOTOLYNK_QR_SCHEMA = 'photolynk';
const LOCAL_SERVER_QR_SCHEMA = 'photolynk_local';
const REMOTE_SERVER_QR_SCHEMA = 'photolynk_remote';
const GITHUB_RELEASES_LATEST_URL = 'https://github.com/viktorvishyn369/PhotoLynk/releases/latest';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SCREEN_HEIGHT_FULL = Dimensions.get('screen').height;
const ANDROID_NAV_BAR_HEIGHT = Platform.OS === 'android' ? Math.max(48, SCREEN_HEIGHT_FULL - SCREEN_HEIGHT) : 0;

const { MediaDelete } = NativeModules;

const CLIENT_BUILD = `photolynk-mobile-v2/${Application.nativeApplicationVersion || '0'}(${Application.nativeBuildVersion || '0'}) sc-debug-2025-12-13`;

const AUTO_UPLOAD_FEATURE_ENABLED = false;

// Module-level cache for PhotoLynkDeleted asset IDs (avoids hook order issues)
let backupPickerDeletedIdsCache = null;

// Helper: Request media library permissions
const requestMediaLibraryPermission = async () => {
  return await MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
};

// Alias for backward compatibility with global function name
const ensureAutoUploadPolicyAllowsWorkIfBackgrounded = ensureAutoUploadPolicyAllowsWorkIfBackgroundedGlobal;

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
  // Removed - status messages now sync with actual operations
};

const resetAuthLoadingLabel = (loginStatusTimerRef, loginLabelTimerRef, setAuthLoadingLabel, label) => {
  if (loginStatusTimerRef?.current) {
    clearTimeout(loginStatusTimerRef.current);
    loginStatusTimerRef.current = null;
  }
  clearLoginTimers(loginLabelTimerRef);
  setAuthLoadingLabel(label);
};

// Thermal protection constants to prevent phone overheating and crashes (used when Fast Mode is OFF)
// Increased values for better stability on weak phones
const THERMAL_BATCH_LIMIT = 5; // Max assets per batch before long cooling pause (was 10)
const THERMAL_BATCH_COOLDOWN_MS = 45000; // 45 second pause between batches for memory cleanup (was 30s)
const THERMAL_ASSET_COOLDOWN_MS = Platform.OS === 'ios' ? 3000 : 2500; // Cooldown between assets (was 2000/1500)
const THERMAL_CHUNK_COOLDOWN_MS = 400; // Delay between chunks (was 300)

// Fast mode constants (used when Fast Mode is ON) - no throttling, maximum speed
const FAST_BATCH_LIMIT = 999999; // Effectively no batch limit
const FAST_BATCH_COOLDOWN_MS = 0; // No pause between batches
const FAST_ASSET_COOLDOWN_MS = 0; // No cooldown between assets
const FAST_CHUNK_COOLDOWN_MS = 0; // No delay between chunks

export default function App() {
  useEffect(() => {
    let mounted = true;
    const lockPortrait = async () => {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } catch (e) {}
    };
    lockPortrait();
    const sub = ScreenOrientation.addOrientationChangeListener(() => {
      if (mounted) lockPortrait();
    });

    return () => {
      mounted = false;
      try {
        ScreenOrientation.removeOrientationChangeListener(sub);
      } catch (e) {}
    };
  }, []);

  // Immediately handle wallet changes (Seeker hardware wallet / MWA via WalletAdapter)
  useEffect(() => {
    // Ensure adapter initializes (restores previous connection and can emit change)
    WalletAdapter.initializeWalletAdapter().catch(() => {});

    const unsubscribe = WalletAdapter.onWalletChanged(async (nextAddress, prevAddress) => {
      if (!nextAddress || nextAddress === prevAddress) return;
      setQsWalletAddress(nextAddress || null);
      // Only purge + rescan on actual wallet switch, not initial restore
      // (NFTGallery handles the initial scan via autoScanBlockchain)
      if (!prevAddress) return;
      try {
        await NFTOperations.purgeNFTStorage();
      } catch (_) {}

      try {
        const serverUrl = getServerUrl();
        let headers = null;
        try {
          const authConfig = await getAuthHeaders();
          headers = authConfig?.headers || authConfig;
        } catch (_) {}
        await NFTOperations.discoverAndImportNFTs(nextAddress, serverUrl, headers);
      } catch (_) {}

      // Refresh gallery if open
      try {
        setNftGalleryRefreshKey(k => (k || 0) + 1);
      } catch (_) {}
    });

    return () => {
      try { unsubscribe?.(); } catch (_) {}
    };
  }, []);

  const [view, setView] = useState('loading'); // loading, auth, home, settings
  const [authMode, setAuthMode] = useState('login'); // login, register, forgot
  const [isFirstRun, setIsFirstRun] = useState(false); // First ever app run - show register, hide server options
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [serverType, setServerType] = useState('stealthcloud'); // 'local' | 'remote' | 'stealthcloud'
  const [localHost, setLocalHost] = useState('');
  const [remoteHost, setRemoteHost] = useState('');
  const [autoUploadEnabled, setAutoUploadEnabled] = useState(false);
  const [fastModeEnabled, setFastModeEnabled] = useState(true);
  const [glassModeEnabled, setGlassModeEnabled] = useState(false);
  const [backupModeOpen, setBackupModeOpen] = useState(false);
  const [backupPickerOpen, setBackupPickerOpen] = useState(false);
  const [backupPickerAssets, setBackupPickerAssets] = useState([]);
  const [backupPickerAfter, setBackupPickerAfter] = useState(null);
  const [backupPickerHasNext, setBackupPickerHasNext] = useState(true);
  const [backupPickerLoading, setBackupPickerLoading] = useState(false);
  const [backupPickerTotal, setBackupPickerTotal] = useState(0);
  const [backupPickerSelected, setBackupPickerSelected] = useState({});
  const [backupPickerPreview, setBackupPickerPreview] = useState(null);
  const backupPickerThumbFixingRef = useRef(new Map());
  const backupPickerOpenRef = useRef(false);
  const backupPickerThumbCacheRef = useRef(new Map());
  const backupPickerMetaInFlightRef = useRef(new Set());
  const backupPickerMetaLimiterRef = useRef(createConcurrencyLimiter(3));
  const [syncModeOpen, setSyncModeOpen] = useState(false);
  const [syncPickerOpen, setSyncPickerOpen] = useState(false);
  const [syncPickerItems, setSyncPickerItems] = useState([]);
  const [syncPickerTotal, setSyncPickerTotal] = useState(0); // Total items on server (after filtering)
  const [syncPickerOffset, setSyncPickerOffset] = useState(0); // How many server items have been processed
  const [syncPickerLoading, setSyncPickerLoading] = useState(false);
  const [syncPickerLoadingMore, setSyncPickerLoadingMore] = useState(false);
  const [syncPickerSelected, setSyncPickerSelected] = useState({});
  const [syncPickerPreview, setSyncPickerPreview] = useState(null); // { uri, filename } for enlarged preview
  const [syncPickerAuthHeaders, setSyncPickerAuthHeaders] = useState(null);
  const syncPickerMasterKeyRef = useRef(null);
  const syncPickerThumbCacheRef = useRef(new Map());
  const syncPickerThumbInFlightRef = useRef(new Set());
  const syncPickerThumbLimiterRef = useRef(createConcurrencyLimiter(3));
  const SYNC_PICKER_PAGE_SIZE = 18; // Items per page (18 for thumbnails)
  const [cleanupModeOpen, setCleanupModeOpen] = useState(false);
  const [quickSetupOpen, setQuickSetupOpen] = useState(false);
  const [authLoadingLabel, setAuthLoadingLabel] = useState(t('auth.signingIn'));
  const loginStatusTimerRef = useRef(null);
  const loginLabelTimerRef = useRef(null);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const [similarReviewOpen, setSimilarReviewOpen] = useState(false);
  const [similarGroups, setSimilarGroups] = useState([]);
  const [similarGroupIndex, setSimilarGroupIndex] = useState(0);
  const [similarSelected, setSimilarSelected] = useState({});
  const [similarPhotoIndex, setSimilarPhotoIndex] = useState(0); // Current photo in full-screen view
  const [similarDeletedTotal, setSimilarDeletedTotal] = useState(0); // Track total deleted during similar review
  const similarDeletedTotalRef = useRef(0); // Ref to track cumulative total (state is stale in async handlers)
  const similarThumbCacheRef = useRef(new Map());
  const similarThumbInFlightRef = useRef(new Set());
  const similarThumbLimiterRef = useRef(createConcurrencyLimiter(2));
  const [customAlert, setCustomAlert] = useState(null); // { title, message, buttons }
  const [inlineNotification, setInlineNotification] = useState(null); // { title, message, type: 'success'|'error'|'warning' }
  const [showCompletionTick, setShowCompletionTick] = useState(false);
  const [completionMessage, setCompletionMessage] = useState('');
  const [stealthCapacity, setStealthCapacity] = useState(null);
  const [stealthCapacityLoading, setStealthCapacityLoading] = useState(false);
  const [stealthCapacityError, setStealthCapacityError] = useState(null);
  const [selectedStealthPlanGb, setSelectedStealthPlanGb] = useState(100);
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
  const [progressAction, setProgressAction] = useState(null); // 'cleanup' | 'backup' | 'sync' | null
  const [duplicateReview, setDuplicateReview] = useState(null);
  const [duplicateZoomImage, setDuplicateZoomImage] = useState(null); // { uri, filename, created, size } for fullscreen zoom
  const [loading, setLoading] = useState(false);
  const [wasBackgroundedDuringWork, setWasBackgroundedDuringWork] = useState(false);
  const [backgroundWarnEligible, setBackgroundWarnEligible] = useState(false);
  const [quickSetupCollapsed, setQuickSetupCollapsed] = useState(true);
  const [quickSetupHighlightInput, setQuickSetupHighlightInput] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState('en');
  const [languageSelectorOpen, setLanguageSelectorOpen] = useState(false);
  
  // NFT state
  const [nftPickerOpen, setNftPickerOpen] = useState(false);
  const [nftGalleryOpen, setNftGalleryOpen] = useState(false);
  const [nftCertsOpen, setNftCertsOpen] = useState(false);
  const [nftTransferOpen, setNftTransferOpen] = useState(false);
  const [nftToTransfer, setNftToTransfer] = useState(null);
  const [nftMinting, setNftMinting] = useState(false);
  const [nftGalleryRefreshKey, setNftGalleryRefreshKey] = useState(0);
  const [pendingCertMint, setPendingCertMint] = useState(null); // mint to pre-select in CertificatesViewer
  const [pendingNftMint, setPendingNftMint] = useState(null);  // mint to pre-select in NFTGallery

  // Quick-stats state
  const [qsWalletAddress, setQsWalletAddress] = useState(null);
  const [qsNftCount, setQsNftCount] = useState(null);
  const [qsLastBackupTime, setQsLastBackupTime] = useState(null);

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
  const abortOperationsRef = useRef(false);
  const currentOperationIdRef = useRef(0);
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

  // Cancels any in-flight user-initiated work (backup/sync/cleanup) before starting a new one
  const cancelInFlightOperations = async () => {
    abortOperationsRef.current = true;
    currentOperationIdRef.current += 1; // Invalidate all previous operation callbacks
    // Give in-flight loops a tick to observe the abort flag
    await new Promise(resolve => setTimeout(resolve, 100));
    // Reset abort flag so new operation can proceed
    abortOperationsRef.current = false;
    // Reset UI to a clean state
    setLoadingSafe(false);
    setBackgroundWarnEligibleSafe(false);
    setWasBackgroundedDuringWorkSafe(false);
    setProgress(0);
    setProgressAction(null);
    setStatus('');
  };

  // Wrapped setters that check operation ID to prevent stale callbacks from updating UI
  const setStatusSafe = (operationId, statusText) => {
    if (operationId === currentOperationIdRef.current) {
      setStatus(statusText);
    }
  };

  const setProgressSafe = (operationId, progressValue) => {
    if (operationId === currentOperationIdRef.current) {
      setProgress(progressValue);
    }
  };

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
  const setLoadingSafe = (value) => {
    loadingRef.current = !!value;
    setLoading(!!value);
    // Automatically clear background warning flags when loading ends
    if (!value) {
      backgroundWarnEligibleRef.current = false;
      wasBackgroundedDuringWorkRef.current = false;
      backgroundedAtMsRef.current = 0;
      setBackgroundWarnEligible(false);
      setWasBackgroundedDuringWork(false);
    }
  };

  // Camera permission for QR scanner
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // QR Code scanner handler
  const handleQRCodeScanned = async (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'photolynk-local' && parsed.ip && parsed.port) {
        // Valid PhotoLynk QR code for local server connection
        const serverIp = parsed.ip;
        setLocalHost(serverIp);
        setServerType('local');
        setQrScannerOpen(false);
        // Close Quick Setup modal if open
        setQuickSetupOpen(false);
        setQuickSetupCollapsed(true);

        // Save to SecureStore
        await SecureStore.setItemAsync('local_host', serverIp);
        await SecureStore.setItemAsync('server_type', 'local');

        // On auth screen (login/register): just set IP, user must press login button
        if (view === 'auth') {
          showDarkAlert(t('login.connected'), t('login.serverIpSetTo', { ip: serverIp + ':' + parsed.port }));
          return;
        }

        // On settings: do full pairing with desktop
        // Try to get credentials from SecureStore (user is logged in)
        let pairEmail = null;
        let pairPassword = null;
        try {
          pairEmail = await SecureStore.getItemAsync('user_email');
          pairPassword = await SecureStore.getItemAsync('user_password_v1', { requireAuthentication: false });
        } catch (e) {
          console.log('[QR] Failed to get credentials from SecureStore:', e.message);
        }
        console.log('[QR] Pairing check:', { pairingPort: parsed.pairingPort, hasToken: !!parsed.token, email: pairEmail || '(empty)', hasPassword: !!pairPassword });
        if (parsed.pairingPort && parsed.token && pairEmail && pairPassword) {
          try {
            console.log('[QR] Sending pairing request to:', `http://${serverIp}:${parsed.pairingPort}/api/pair`);
            const pairingUrl = `http://${serverIp}:${parsed.pairingPort}/api/pair`;
            const response = await fetch(pairingUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: pairEmail, password: pairPassword, token: parsed.token }),
            });
            const result = await response.json();
            if (result.success) {
              // After successful pairing, login to the local server to get a valid JWT token
              // Without this, the stored auth_token may be from StealthCloud (different JWT_SECRET)
              try {
                const localServerUrl = `http://${serverIp}:${parsed.port}`;
                const deviceId = await getDeviceUUID(pairEmail, pairPassword);
                const loginRes = await axios.post(`${localServerUrl}/api/login`, {
                  email: pairEmail,
                  password: pairPassword,
                  device_uuid: deviceId,
                  device_name: Platform.OS + ' ' + Platform.Version,
                }, { timeout: 10000 });
                if (loginRes.data && loginRes.data.token) {
                  await SecureStore.setItemAsync('auth_token', loginRes.data.token);
                  setTokenSafe(loginRes.data.token);
                  setDeviceUuid(deviceId);
                  console.log('[QR] Logged into local server, token stored');
                }
              } catch (loginErr) {
                console.log('[QR] Local server login failed (non-critical):', loginErr.message);
              }
              showDarkAlert(t('login.paired'), t('login.pairedWithDesktop', { ip: serverIp }));
              return;
            }
          } catch (pairErr) {
            console.log('[QR] Pairing request failed:', pairErr.message);
          }
        }

        // Fallback: just show IP set message
        showDarkAlert(t('login.connected'), t('login.serverIpSetTo', { ip: serverIp + ':' + parsed.port }));
      } else if (parsed.type === 'photolynk-decrypt' && parsed.sessionId && parsed.server) {
        // Web portal decryption request - connect via WebSocket
        setQrScannerOpen(false);
        await handleWebPortalDecryption(parsed.sessionId, parsed.server);
      } else {
        showDarkAlert(t('alerts.invalidQrCode'), t('alerts.invalidQrCodeNotPhotolynk'));
      }
    } catch (e) {
      showDarkAlert(t('alerts.invalidQrCode'), t('alerts.invalidQrCodeParse'));
    }
  };

  // Handle web portal decryption via WebSocket
  const handleWebPortalDecryption = async (sessionId, serverUrl) => {
    try {
      // Get encryption key, token, and device UUID from secure storage
      const encryptionKey = await SecureStore.getItemAsync('encryption_key');
      const token = await SecureStore.getItemAsync('auth_token');
      const deviceUuid = await SecureStore.getItemAsync('device_uuid');
      
      if (!encryptionKey || !token || !deviceUuid) {
        showDarkAlert(t('alerts.notLoggedIn'), t('alerts.notLoggedInMessage'));
        return;
      }

      // Connect to WebSocket
      const wsUrl = serverUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws/portal';
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        // Send auth credentials and encryption key to web portal session
        ws.send(JSON.stringify({
          type: 'phone_connect',
          sessionId: sessionId,
          token: token,
          deviceUuid: deviceUuid,
          encryptionKey: encryptionKey
        }));
        showDarkAlert(t('login.connected'), t('login.webPortalConnected'));
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showDarkAlert(t('alerts.connectionFailed'), t('alerts.webPortalFailed'));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'decrypt_request') {
            // Web portal is requesting decryption of a file
            handleDecryptRequest(ws, msg, encryptionKey);
          } else if (msg.type === 'session_ended') {
            ws.close();
          }
        } catch (e) {
          console.error('WebSocket message error:', e);
        }
      };

      // Keep connection alive for 5 minutes
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      }, 5 * 60 * 1000);

    } catch (error) {
      console.error('Web portal decryption error:', error);
      showDarkAlert(t('alerts.error'), t('alerts.failedToConnectWebPortal'));
    }
  };

  // Handle individual file decryption request from web portal
  const handleDecryptRequest = async (ws, msg, encryptionKey) => {
    try {
      const { fileId, encryptedData } = msg;
      
      // Decrypt the data using nacl
      const keyBytes = nacl.hash(new TextEncoder().encode(encryptionKey)).slice(0, 32);
      const nonce = Uint8Array.from(atob(encryptedData.nonce), c => c.charCodeAt(0));
      const ciphertext = Uint8Array.from(atob(encryptedData.ciphertext), c => c.charCodeAt(0));
      
      const decrypted = nacl.secretbox.open(ciphertext, nonce, keyBytes);
      
      if (decrypted) {
        // Send decrypted data back to web portal
        ws.send(JSON.stringify({
          type: 'decrypt_response',
          fileId: fileId,
          success: true,
          data: btoa(String.fromCharCode(...decrypted))
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'decrypt_response',
          fileId: fileId,
          success: false,
          error: 'Decryption failed'
        }));
      }
    } catch (error) {
      console.error('Decrypt request error:', error);
      ws.send(JSON.stringify({
        type: 'decrypt_response',
        fileId: msg.fileId,
        success: false,
        error: error.message
      }));
    }
  };

  // Format helpers - defined early since used throughout
  const formatBytesHuman = (bytes) => formatBytes(bytes, false);
  const formatBytesHumanDecimal = (bytes) => formatBytes(bytes, true);

  // Custom dark-themed alert (replaces Alert.alert for duplicate results)
  const showDarkAlert = (title, message, buttons = null) => {
    // Close Quick Setup modal if open to ensure alert is visible
    setQuickSetupOpen(false);
    setQuickSetupCollapsed(true);
    setCustomAlert({
      title,
      message,
      buttons: buttons || [{ text: 'OK', onPress: () => setCustomAlert(null) }]
    });
  };
  const closeDarkAlert = () => setCustomAlert(null);

  // Show completion tick - stays until user taps to dismiss
  const showCompletionTickBriefly = (message = '') => {
    setCompletionMessage(message);
    setShowCompletionTick(true);
    // No auto-hide - user must tap to dismiss
  };
  
  // Dismiss completion tick on user tap
  const dismissCompletionTick = () => {
    setShowCompletionTick(false);
    setCompletionMessage('');
  };

  // Standardized result for backup/sync/cleanup operations - shows tick
  const showResultAlert = (type, stats) => {
    // Only show tick for success, not errors
    if (!stats.error) {
      let msg = '';
      if (type === 'backup') {
        const u = stats.uploaded || 0;
        // Use serverTotal if available (actual files on server), otherwise fall back to uploaded + skipped
        const serverTotal = stats.serverTotal || (u + (stats.skipped || 0));
        if (u > 0) {
          msg = t('results.xOfYUploaded', { uploaded: u, total: serverTotal });
        } else {
          msg = t('results.filesOnServer', { count: serverTotal });
        }
      } else if (type === 'sync') {
        const d = stats.downloaded || 0;
        const s = stats.skipped || 0;
        const total = d + s;
        if (d > 0) {
          msg = t('results.xOfYDownloaded', { downloaded: d, total });
        } else {
          msg = t('results.filesOnDevice', { count: s });
        }
      } else if (type === 'cleanup' || type === 'clean') {
        const del = stats.deleted || 0;
        msg = del > 0 ? t('results.filesDeleted', { count: del }) : t('results.noDuplicatesFound');
      }
      showCompletionTickBriefly(msg);
      if (type === 'backup' || type === 'sync') {
        const now = new Date();
        setQsLastBackupTime(now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0'));
      }
    }
  };

  const openPaywall = (tierGb) => {
    setPaywallTierGb(tierGb);
  };

  const closePaywall = () => {
    setPaywallTierGb(null);
  };

  const persistAutoUploadEnabled = async (enabled) => {
    const next = AUTO_UPLOAD_FEATURE_ENABLED ? !!enabled : false;
    setAutoUploadEnabledSafe(next);
    try { await SecureStore.setItemAsync('auto_upload_enabled', next ? 'true' : 'false'); } catch (e) {}
  };

  const persistFastModeEnabled = async (enabled) => {
    setFastModeEnabledSafe(enabled);
    try { await SecureStore.setItemAsync('fast_mode_enabled', enabled ? 'true' : 'false'); } catch (e) {}
  };

  const persistGlassModeEnabled = (enabled) => {
    setGlassModeEnabled(enabled);
    SecureStore.setItemAsync('glass_mode_enabled', enabled ? 'true' : 'false').catch(() => {});
  };

  useEffect(() => { autoUploadEnabledRef.current = !!autoUploadEnabled; }, [autoUploadEnabled]);
  useEffect(() => { fastModeEnabledRef.current = !!fastModeEnabled; }, [fastModeEnabled]);
  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { serverTypeRef.current = serverType; }, [serverType]);

  // Force fast mode ON for local/remote — only stealthcloud allows toggling
  useEffect(() => {
    if (serverType === 'local' || serverType === 'remote') {
      setFastModeEnabledSafe(true);
    }
  }, [serverType]);

  // Throttle helpers - return current values based on fast mode setting
  const getThrottleBatchLimit = () => fastModeEnabledRef.current ? FAST_BATCH_LIMIT : THERMAL_BATCH_LIMIT;
  const getThrottleBatchCooldownMs = () => fastModeEnabledRef.current ? FAST_BATCH_COOLDOWN_MS : THERMAL_BATCH_COOLDOWN_MS;
  const getThrottleAssetCooldownMs = () => fastModeEnabledRef.current ? FAST_ASSET_COOLDOWN_MS : THERMAL_ASSET_COOLDOWN_MS;
  const getThrottleChunkCooldownMs = () => fastModeEnabledRef.current ? FAST_CHUNK_COOLDOWN_MS : THERMAL_CHUNK_COOLDOWN_MS;

  // Solana purchase helpers
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
      const status = await getSubscriptionStatus(token, deviceUuid);
      setSubscriptionStatus(status);
      return status;
    } catch (e) {
      // Silently ignore subscription status errors (403, network, etc.)
      return null;
    }
  };

  const refreshStealthUsage = async () => {
    try {
      const config = await getAuthHeaders();
      const base = getServerUrl();
      console.log('[Info] Fetching usage from:', base, 'auth:', !!config?.headers?.Authorization);
      const res = await axios.get(`${base}/api/cloud/usage`, { ...config, timeout: 10000 });
      const data = res && res.data ? res.data : null;
      console.log('[Info] Usage response:', data ? `quota=${data.quotaBytes || data.quota_bytes}, sub=${data.subscription?.status}` : 'null');
      setStealthUsage(data);
      return data;
    } catch (e) {
      console.log('[Info] Failed to refresh usage:', e?.response?.status, e?.message);
      return null;
    }
  };

  const handlePurchase = async (tierGb) => {
    try {
      setPurchaseLoading(true);
      setStatus(t('status.processingPurchase'));

      // Get auth token for server authentication
      let authToken = token;
      if (!authToken) {
        try {
          authToken = await SecureStore.getItemAsync('auth_token');
        } catch (e) {}
      }
      if (!authToken) {
        showDarkAlert(t('alerts.error'), t('alerts.notLoggedInMessage'));
        setPurchaseLoading(false);
        setStatus(t('status.idle'));
        return;
      }

      // Use universal wallet purchase (supports MWA, Phantom, WalletConnect, etc.)
      const result = await purchaseWithWallet(tierGb, authToken);

      if (result.success) {
        // Close paywall popup immediately on success
        closePaywall();
        
        // Refresh subscription status from server
        await refreshSubscriptionStatus();
        await refreshStealthUsage();
        setSelectedStealthPlanGb(tierGb);
        
        // Show appropriate message based on server verification
        const planName = tierGb === 1000 ? '1 TB' : tierGb + ' GB';
        if (result.pendingVerification) {
          // Fallback message if translation key doesn't exist
          const pendingMsg = t('alerts.paymentSentPending', { plan: planName });
          const fallbackMsg = `Payment sent! Your ${planName} plan will activate shortly.`;
          showDarkAlert(t('alerts.success'), pendingMsg.includes('paymentSentPending') ? fallbackMsg : pendingMsg);
        } else {
          showDarkAlert(t('alerts.success'), t('alerts.planActive', { plan: planName }));
        }
      } else if (result.userCancelled) {
        // User cancelled - no message needed
      } else {
        // Close paywall first so alert is visible
        closePaywall();
        // Use translated error message based on errorKey
        const errorMessage = result.errorKey 
          ? t(`alerts.${result.errorKey}`) 
          : (result.error || t('alerts.purchaseFailedMessage'));
        showDarkAlert(t('alerts.purchaseFailed'), errorMessage);
      }
    } catch (e) {
      closePaywall();
      showDarkAlert(t('alerts.purchaseError'), e.message || t('alerts.purchaseErrorMessage'));
    } finally {
      setPurchaseLoading(false);
      setStatus(t('status.idle'));
    }
  };

  const handleRestorePurchases = async () => {
    try {
      setPurchaseLoading(true);
      setStatus(t('status.checkingSubscription'));

      // For Solana payments, just refresh from server - it tracks all payments
      const status = await refreshSubscriptionStatus();
      await refreshStealthUsage();

      if (status && status.isActive) {
        showDarkAlert(t('alerts.success'), t('alerts.subscriptionRestored'));
      } else {
        showDarkAlert(t('alerts.noSubscriptionFound'), t('alerts.noSubscriptionFoundMessage'));
      }
    } catch (e) {
      showDarkAlert(t('alerts.error'), e.message || t('alerts.restoreErrorMessage'));
    } finally {
      setPurchaseLoading(false);
      setStatus(t('status.idle'));
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
      if (st === 'active') setStatus(t('status.autoBackupResumed'));
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
        setStatus(t('status.autoBackupAllowPhotos'));
        autoUploadNightRunnerStartingRef.current = false;
        return;
      }
      if (photoAccess.limited) {
        if (canLog) {
          autoUploadDebugLastLogMsRef.current = now;
          console.log('AutoUpload: not starting (photos access limited)');
        }
        if (Platform.OS === 'ios') {
          setStatus(t('status.autoBackupEnableAllPhotos'));
          showDarkAlert(
            t('alerts.allowAllPhotos'),
            t('alerts.allowAllPhotosMessage')
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
    setStatus(t('status.autoBackupResumed'));

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
          existingManifests = await fetchAllManifestsPaged(SERVER_URL, config, null, true); // includeMeta=true for fast dedup
        } catch (e) {
          existingManifests = [];
        }
        let already = new Set(existingManifests.map(m => m.manifestId));

        let initialDeviceTotalCount = null;
        try {
          const firstPage = await MediaLibrary.getAssetsAsync({
            mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
            first: 1,
            sortBy: [MediaLibrary.SortBy.creationTime]
          });
          if (firstPage && typeof firstPage.totalCount === 'number') {
            initialDeviceTotalCount = firstPage.totalCount;
          }
        } catch (e) {}
        const canCompareTotalsAtStart = (typeof initialDeviceTotalCount === 'number');
        const allBackedUpAtStart = canCompareTotalsAtStart && existingManifests.length >= initialDeviceTotalCount;
        const shouldShowPreparingAtStart = canCompareTotalsAtStart && existingManifests.length > 0 && existingManifests.length < initialDeviceTotalCount;
        console.log('AutoUpload: early check -', { serverManifests: existingManifests.length, deviceTotal: initialDeviceTotalCount, allBackedUpAtStart, shouldShowPreparingAtStart });
        let backupCompleted = false;
        if (allBackedUpAtStart) {
          setStatus(t('status.autoBackupActive'));
          backupCompleted = true;
          console.log('AutoUpload: all files already backed up at start, skipping manifest decryption');
        }

        // Build deduplication sets for cross-device duplicate detection (auto-upload has more time)
        // Try to load cached dedup sets first to avoid re-decrypting all manifests
        let alreadyFilenames = new Set();
        let alreadyBaseFilenames = new Set();
        let alreadyBaseNameSizes = new Map(); // baseFilename -> Set of sizes
        let alreadyBaseNameDates = new Map(); // baseFilename -> Set of date strings (YYYY-MM-DD)
        let alreadyBaseNameTimestamps = new Map(); // baseFilename -> Set of full timestamps (YYYY-MM-DDTHH:MM:SS) for HEIC
        let alreadyPerceptualHashes = new Set();
        let alreadyFileHashes = new Set();
        // EXIF-based deduplication sets for cross-platform HEIC matching
        let alreadyExifFull = new Set(); // captureTime|make|model (highest confidence)
        let alreadyExifTimeModel = new Set(); // captureTime|model
        let alreadyExifTimeMake = new Set(); // captureTime|make
        
        // Build dedup sets from metadata in list response (no decryption needed - server returns plaintext meta)
        if (existingManifests.length > 0 && !allBackedUpAtStart) {
          if (shouldShowPreparingAtStart) setStatus(t('status.autoBackupPreparing'));
          for (const m of existingManifests) {
            // Use metadata from list response (includeMeta=true) - no HTTP request needed
            if (m.filename) {
              alreadyFilenames.add(normalizeFilenameForCompare(m.filename));
              const baseName = extractBaseFilename(m.filename);
              if (baseName) {
                alreadyBaseFilenames.add(baseName);
                if (m.originalSize) {
                  if (!alreadyBaseNameSizes.has(baseName)) alreadyBaseNameSizes.set(baseName, new Set());
                  alreadyBaseNameSizes.get(baseName).add(m.originalSize);
                }
                if (m.creationTime) {
                  const dateStr = normalizeDateForCompare(m.creationTime);
                  if (dateStr) {
                    if (!alreadyBaseNameDates.has(baseName)) alreadyBaseNameDates.set(baseName, new Set());
                    alreadyBaseNameDates.get(baseName).add(dateStr);
                  }
                  const fullTimestamp = normalizeFullTimestamp(m.creationTime);
                  if (fullTimestamp) {
                    if (!alreadyBaseNameTimestamps.has(baseName)) alreadyBaseNameTimestamps.set(baseName, new Set());
                    alreadyBaseNameTimestamps.get(baseName).add(fullTimestamp);
                  }
                }
              }
            }
            if (m.perceptualHash) alreadyPerceptualHashes.add(m.perceptualHash);
            if (m.fileHash) alreadyFileHashes.add(m.fileHash);
            if (m.exifCaptureTime) {
              const ct = m.exifCaptureTime;
              const mk = m.exifMake;
              const md = m.exifModel;
              if (ct && mk && md) alreadyExifFull.add(`${ct}|${mk}|${md}`);
              if (ct && md) alreadyExifTimeModel.add(`${ct}|${md}`);
              if (ct && mk) alreadyExifTimeMake.add(`${ct}|${mk}`);
            }
          }
          console.log(`AutoUpload: found ${alreadyFilenames.size} filenames, ${alreadyBaseFilenames.size} base names, ${alreadyBaseNameSizes.size} name+size, ${alreadyBaseNameDates.size} name+date, ${alreadyBaseNameTimestamps.size} name+timestamp, ${alreadyPerceptualHashes.size} perceptual hashes, ${alreadyFileHashes.size} file hashes, ${alreadyExifFull.size} EXIF keys for deduplication`);
          // Debug: log some sample filenames to verify they're being collected
          const sampleFilenames = Array.from(alreadyFilenames).slice(0, 5);
          console.log(`AutoUpload: sample filenames in set: ${JSON.stringify(sampleFilenames)}`);
          
          // Memory cleanup: clear existingManifests array after building dedup sets
          // The dedup sets contain all needed info, no need to keep raw manifests in memory
          existingManifests.length = 0;
          try { if (global.gc) global.gc(); } catch (e) {}
          console.log('AutoUpload: dedup sets built, cleared manifest array to free memory');
        }

        let after = null;
        const cursorKey = await getAutoUploadCursorKey();
        try {
          const savedCursor = await SecureStore.getItemAsync(cursorKey);
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

        // Get current uploaded count from server manifests (primary source)
        config = await getAuthHeaders();
        SERVER_URL = getServerUrl();
        try {
          const existingManifests = await fetchAllManifestsPaged(SERVER_URL, config);
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
            const manifests = await fetchAllManifestsPaged(SERVER_URL, config);
            manifests.forEach(m => already.add(m.manifestId));
          } catch (e) {
            console.log('AutoUpload: failed to load manifest IDs, will check individually');
          }
        }

        // Get total count early to check if all files are already backed up
        try {
          const firstPage = await MediaLibrary.getAssetsAsync({
            mediaType: [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video],
            first: 1,
            sortBy: [MediaLibrary.SortBy.creationTime]
          });
          if (firstPage && typeof firstPage.totalCount === 'number') {
            totalEstimatedCount = firstPage.totalCount;
            // If all files are already backed up, show Active status immediately
            if (cumulativeUploaded >= totalEstimatedCount) {
              setStatus(t('status.autoBackupActive'));
              console.log('AutoUpload: all files already backed up, showing Active status');
              backupCompleted = true;
            }
          }
        } catch (e) {
          console.log('AutoUpload: failed to get initial total count');
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
                  console.log('AutoUpload: reached end of assets, clearing cursor and setting active');
                  await SecureStore.deleteItemAsync(cursorKey);
                  setStatus(t('status.autoBackupActive'));
                  console.log('AutoUpload: full backup cycle complete, all photos backed up, monitoring');
                  backupCompleted = true;
                }
              }
            } catch (e) {}
            break;
          }

          // Update total count from each page (in case new files were added)
          if (page && typeof page.totalCount === 'number') {
            if (totalEstimatedCount === null || page.totalCount > totalEstimatedCount) {
              totalEstimatedCount = page.totalCount;
            }
            console.log('AutoUpload: estimated total assets to upload:', totalEstimatedCount);
            // Update status with current progress or completion
            console.log('AutoUpload: initial status - backupCompleted:', backupCompleted, 'cumulativeUploaded:', cumulativeUploaded, 'totalEstimatedCount:', totalEstimatedCount);
            if (backupCompleted || cumulativeUploaded === totalEstimatedCount) {
              setStatus(t('status.autoBackupActive'));
              console.log('AutoUpload: showing active status (all backed up, monitoring)');
            } else {
              setStatus(t('status.autoBackupProgress', { current: cumulativeUploaded, total: totalEstimatedCount }));
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

            const assetFilename = formatFilenameForStatus(asset.filename || 'file');
            console.log('AutoUpload: attempting upload for asset:', asset.id, assetFilename);
            const r = await autoUploadStealthCloudUploadOneAsset({
              asset,
              config,
              SERVER_URL,
              existingManifestIds: already,
              alreadyFilenames,
              alreadyBaseNameSizes,
              alreadyBaseNameDates,
              alreadyBaseNameTimestamps,
              alreadyPerceptualHashes,
              alreadyFileHashes,
              alreadyExifFull,
              alreadyExifTimeModel,
              alreadyExifTimeMake,
              fastMode: fastModeEnabledRef.current,
              onStatus: (phase) => {
                if (totalEstimatedCount !== null && !autoUploadNightRunnerCancelRef.current && autoUploadEnabledRef.current) {
                  if (phase === 'encrypting' || phase === 'uploading') {
                    const displayCurrent = Math.min(cumulativeUploaded + 1, totalEstimatedCount);
                    setStatus(t('status.autoBackupProgressFile', { current: displayCurrent, total: totalEstimatedCount, filename: assetFilename }));
                  }
                }
              }
            });
            if (r && r.uploaded) {
              uploaded += 1;
              cumulativeUploaded += 1;
              if (r.manifestId) already.add(r.manifestId);
              // Update dedup sets with newly uploaded file's hashes to prevent duplicates within same session
              if (r.perceptualHash) alreadyPerceptualHashes.add(r.perceptualHash);
              if (r.fileHash) alreadyFileHashes.add(r.fileHash);
              if (r.filename) alreadyFilenames.add(normalizeFilenameForCompare(r.filename));
              // Update status with current progress (only if not cancelled)
              if (totalEstimatedCount !== null && !autoUploadNightRunnerCancelRef.current && autoUploadEnabledRef.current) {
                const displayCurrent = Math.min(cumulativeUploaded, totalEstimatedCount);
                setStatus(t('status.autoBackupProgressFile', { current: displayCurrent, total: totalEstimatedCount, filename: assetFilename }));
              }
              console.log('AutoUpload: successfully uploaded asset:', asset.id, 'cumulative:', cumulativeUploaded);
            } else if (r && r.skipped) {
              skipped += 1;
              // Update status with filename even for skipped files
              if (totalEstimatedCount !== null && !autoUploadNightRunnerCancelRef.current && autoUploadEnabledRef.current) {
                const displayCurrent = Math.min(cumulativeUploaded, totalEstimatedCount);
                setStatus(t('status.autoBackupProgressFile', { current: displayCurrent, total: totalEstimatedCount, filename: assetFilename }));
              }
            } else {
              failed += 1;
              console.log('AutoUpload: upload failed for asset:', asset.id);
            }

            // CPU cooldown between assets to reduce CPU pressure and phone heating
            const assetCooldown = getThrottleAssetCooldownMs();
            if (assetCooldown > 0) await sleep(assetCooldown);

            // Memory cleanup: hint GC every 5 assets to prevent memory buildup
            if ((uploaded + skipped + failed) % 5 === 0) {
              try { if (global.gc) global.gc(); } catch (e) {}
            }

            // Thermal batch limit: long cooling pause every N assets
            const batchLimit = getThrottleBatchLimit();
            const batchCooldown = getThrottleBatchCooldownMs();
            if (batchCooldown > 0 && uploaded > 0 && uploaded % batchLimit === 0) {
              setStatus(t('status.autoBackupPausing'));
              await sleep(batchCooldown);
              // Force GC during long pause
              try { if (global.gc) global.gc(); } catch (e) {}
            }
          }

          after = page && page.endCursor ? page.endCursor : null;
          try {
            if (after) await SecureStore.setItemAsync(cursorKey, after);
          } catch (e) {}
          if (!page || page.hasNextPage !== true || !after) break;
        }

        try {
          if (!after) {
            await SecureStore.deleteItemAsync(cursorKey);
            // If we completed a full cycle and uploaded nothing, all photos are backed up
            if (uploaded === 0 && totalEstimatedCount !== null) {
              backupCompleted = true;
              setStatus(t('status.autoBackupActive'));
              console.log('AutoUpload: full backup cycle complete, all photos backed up, monitoring for new files');
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
        setStatus(t('status.autoBackupPaused'));
      }

      // Stop Android foreground service
      try {
        if (Platform.OS === 'android' && sessionId === autoUploadNightRunnerSessionIdRef.current) {
          void stopAndroidForegroundUploadService();
        }
      } catch (e) {}
      await deactivateKeepAwakeForAutoUpload();

      // Schedule a quick re-check to pick up newly added photos & videos soon after completion
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
      // Retry once on 5xx / network error
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await axios.get(`${base}/api/cloud/usage`, { ...config, timeout: 10000 });
          return res && res.data ? res.data : null;
        } catch (retryErr) {
          const st = retryErr.response?.status;
          if (st && st >= 500 && attempt < 1) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          throw retryErr;
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  const ensureStealthCloudUploadAllowed = async () => {
    const usage = await fetchStealthCloudUsage();
    // If usage fetch failed (server unreachable / 502), allow backup — server will enforce limits
    if (!usage) return true;
    const st = usage && usage.subscription ? usage.subscription : null;
    const status = st && st.status ? String(st.status) : 'none';
    if (status === 'active' || status === 'trial') return true;

    const purchasedVia = st && st.purchased_via ? st.purchased_via : null;
    const isOtherPlatform = purchasedVia && purchasedVia !== 'solana';
    const platformName = purchasedVia === 'apple' ? 'App Store' : purchasedVia === 'google' ? 'Google Play' : null;

    if (status === 'grace') {
      if (isOtherPlatform && platformName) {
        showDarkAlert(
          t('alerts.subscriptionExpired'),
          t('alerts.managedByOtherPlatform', { platform: platformName }),
          [{ text: t('alerts.ok') }]
        );
      } else {
        showDarkAlert(
          t('alerts.subscriptionExpired'),
          t('alerts.graceMessage', { days: GRACE_PERIOD_DAYS }),
          [
            { text: t('alerts.syncNow'), onPress: () => openSyncModeChooser() }
          ]
        );
      }
      return false;
    }

    if (status === 'grace_expired' || status === 'trial_expired') {
      if (isOtherPlatform && platformName) {
        showDarkAlert(
          t('alerts.accessLocked'),
          t('alerts.managedByOtherPlatform', { platform: platformName }),
          [{ text: t('alerts.ok') }]
        );
      } else {
        showDarkAlert(
          t('alerts.accessLocked'),
          t('alerts.accessLockedMessage'),
          [
            { text: t('alerts.viewPlans'), onPress: () => setView('info') },
            { text: t('alerts.ok') }
          ]
        );
      }
      return false;
    }

    showDarkAlert(t('alerts.backupDisabled'), t('alerts.backupDisabledMessage'));
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

        const purchasedVia = st && st.purchased_via ? st.purchased_via : null;
        const isOtherPlatform = purchasedVia && purchasedVia !== 'solana';
        const platformName = purchasedVia === 'apple' ? 'App Store' : purchasedVia === 'google' ? 'Google Play' : null;

        if (isOtherPlatform && platformName) {
          showDarkAlert(
            t('alerts.subscriptionExpired'),
            t('alerts.managedByOtherPlatform', { platform: platformName }),
            [{ text: t('alerts.ok') }]
          );
        } else {
          showDarkAlert(
            t('alerts.subscriptionExpired'),
            t('alerts.expiredGraceMessage', { days: GRACE_PERIOD_DAYS }),
            [
              { text: t('alerts.syncNow'), onPress: () => openSyncModeChooser() },
              { text: t('alerts.viewPlans'), onPress: () => setView('info') }
            ]
          );
        }
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
          setStatus(t('status.autoBackupResumed'));
          maybeStartAutoUploadNightSession();
        }
      }
    });
    return () => batteryListener?.remove();
  }, []);

  // stealthCloudUploadEncryptedChunk is now imported from backupManager.js

  const stealthCloudBackupSelected = async ({ assets }) => {
    const permission = await requestMediaLibraryPermission();
    if (!permission || permission.status !== 'granted') {
      showDarkAlert(t('alerts.permissionNeeded'), t('alerts.permissionNeededMessage'));
      setLoadingSafe(false);
      setProgressAction(null);
      return;
    }

    // Loading state already set by backupSelectedAssets — no cancelInFlightOperations here
    const opId = currentOperationIdRef.current;
    setBackgroundWarnEligibleSafe(true);

    if (Platform.OS === 'ios') {
      const ap = await getMediaLibraryAccessPrivileges(permission);
      if (ap && ap !== 'all') {
        setStatus(t('status.limitedPhotosAccess'));
      }
    }

    if (!(await ensureAutoUploadPolicyAllowsWork({ userInitiated: true }))) {
      return;
    }

    const list = Array.isArray(assets) ? assets.filter(a => a && a.id) : [];
    if (list.length === 0) {
      showDarkAlert(t('alerts.selectItems'), t('alerts.selectItemsMessage'));
      return;
    }

    try {
      const result = await stealthCloudBackupSelectedCore({
        assets: list,
        getAuthHeaders,
        getServerUrl,
        ensureStealthCloudUploadAllowed,
        // Don't pass ensureAutoUploadPolicyAllowsWorkIfBackgrounded for user-initiated operations
        // This allows the operation to pause when backgrounded and resume when foregrounded
        fastMode: fastModeEnabledRef.current,
        onStatus: (s) => setStatusSafe(opId, s),
        onProgress: (p) => setProgressSafe(opId, p),
        abortRef: abortOperationsRef,
      });

      if (result.aborted) {
        return;
      }

      if (result.notAllowed) {
        return;
      }

      if (result.noAssets) {
        showDarkAlert(t('alerts.selectItems'), t('alerts.selectItemsMessage'));
        return;
      }

      const { uploaded, skipped, failed, serverTotal, selectedCount } = result;

      if (uploaded === 0 && skipped === 0 && failed === 0) {
        setProgress(1);
        setStatus(
          Platform.OS === 'ios'
            ? 'No photos visible to the app yet. If you chose "Selected Photos" / Limited access, pick photos or switch to Full Access in iOS Settings.'
            : 'No items processed'
        );
        await sleep(1000);
        setProgress(0);
        return;
      }

      setProgress(1);
      await sleep(300);
      setStatus(t('status.backupComplete'));
      refreshStealthUsage();
      showResultAlert('backup', { uploaded, skipped, failed, serverTotal: selectedCount || serverTotal });
    } catch (e) {
      // Auto re-auth on 403 (token was issued by a different server)
      if (e?.response?.status === 403) {
        console.log('[Auth] 403 during StealthCloud backup — attempting token refresh');
        const refresh = await refreshAuthToken();
        if (refresh.success) {
          setStatus(t('status.backupRetrying'));
          try {
            const retryResult = await stealthCloudBackupSelectedCore({
              assets: list, getAuthHeaders, getServerUrl, ensureStealthCloudUploadAllowed,
              fastMode: fastModeEnabledRef.current,
              onStatus: (s) => setStatusSafe(opId, s), onProgress: (p) => setProgressSafe(opId, p),
              abortRef: abortOperationsRef,
            });
            if (!retryResult.aborted && !retryResult.notAllowed && !retryResult.noAssets) {
              const { uploaded, skipped, failed, serverTotal, selectedCount } = retryResult;
              setProgress(1);
              setStatus(t('status.backupComplete'));
              showResultAlert('backup', { uploaded, skipped, failed, serverTotal: selectedCount || serverTotal });
            }
            return;
          } catch (retryErr) {
            console.error('StealthCloud backup retry failed:', retryErr);
          }
        } else {
          showDarkAlert(t('alerts.sessionExpired'), t('alerts.sessionExpiredRePair'));
        }
      }
      console.error('StealthCloud backup error:', e);
      setStatus(t('status.backupFailed'));
      showResultAlert('backup', { error: e && e.message ? e.message : 'Unknown error' });
    } finally {
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setProgress(0);
    }
  };

  const backupSelectedAssets = async ({ assets }) => {
    const list = Array.isArray(assets) ? assets.filter(a => a && a.id) : [];
    if (list.length === 0) {
      showDarkAlert(t('alerts.selectItems'), t('alerts.selectItemsMessage'));
      return;
    }

    await cancelInFlightOperations();
    setLoadingSafe(true);
    setBackgroundWarnEligibleSafe(false);
    setWasBackgroundedDuringWorkSafe(false);
    setProgress(0);
    setProgressAction('backup');
    setStatus(t('status.backupPreparing'));

    if (!(await ensureAutoUploadPolicyAllowsWork({ userInitiated: true }))) {
      setLoadingSafe(false);
      setProgressAction(null);
      return;
    }

    if (serverType === 'stealthcloud') {
      return stealthCloudBackupSelected({ assets: list });
    }

    // Enable background warning only after we start actual work (permission already granted inside core)
    setTimeout(() => { if (loadingRef.current) setBackgroundWarnEligibleSafe(true); }, 2000);

    try {
      const result = await localRemoteBackupSelectedCore({
        assets: list,
        getAuthHeaders,
        getServerUrl,
        resolveReadableFilePath,
        appStateRef, // Pass appStateRef so upload can pause when backgrounded
        onStatus: setStatus,
        onProgress: setProgress,
        t,
      });

      if (result.permissionDenied) {
        showDarkAlert(t('alerts.permissionNeeded'), t('alerts.permissionNeededMessage'));
        return;
      }

      if (result.noSelection) {
        showDarkAlert(t('alerts.selectItems'), t('alerts.selectItemsMessage'));
        return;
      }

      if (result.alreadyBackedUp) {
        const count = result.selectedCount || list.length;
        setProgress(1); // Show 100% before checkmark
        setStatus(t('status.allFilesBackedUp', { count }));
        await sleep(400); // Brief pause to show 100%
        showCompletionTickBriefly(t('results.filesOnServer', { count }));
        setProgress(0);
        return;
      }

      setProgress(1); // Show 100% before checkmark
      setStatus(t('status.backupComplete'));
      refreshStealthUsage();
      await sleep(400); // Brief pause to show 100%
      showResultAlert('backup', { uploaded: result.uploaded, skipped: result.skipped, failed: result.failed, serverTotal: result.selectedCount || result.serverTotal });
      setProgress(0);
    } catch (error) {
      // Auto re-auth on 403 (token was issued by a different server)
      if (error?.response?.status === 403) {
        console.log('[Auth] 403 during local/remote backup — attempting token refresh');
        const refresh = await refreshAuthToken();
        if (refresh.success) {
          setStatus(t('status.backupRetrying'));
          try {
            const retryResult = await localRemoteBackupSelectedCore({
              assets: list, getAuthHeaders, getServerUrl, resolveReadableFilePath,
              appStateRef, onStatus: setStatus, onProgress: setProgress, t,
            });
            if (!retryResult.permissionDenied && !retryResult.noSelection) {
              setProgress(1);
              setStatus(t('status.backupComplete'));
              showResultAlert('backup', { uploaded: retryResult.uploaded, skipped: retryResult.skipped, failed: retryResult.failed, serverTotal: retryResult.selectedCount || retryResult.serverTotal });
              setProgress(0);
            }
            return;
          } catch (retryErr) {
            console.error('Local/remote backup retry failed:', retryErr);
          }
        } else {
          showDarkAlert(t('alerts.sessionExpired'), t('alerts.sessionExpiredRePair'));
        }
      }
      setStatus(t('status.backupFailed'));
      showResultAlert('backup', { error: error && error.message ? error.message : 'Unknown error' });
    } finally {
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setWasBackgroundedDuringWorkSafe(false);
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
      setStatus(t('status.idle'));
      return;
    }

    showDarkAlert(
      t('alerts.deleteAllDataTitle'),
      t('alerts.deleteAllDataStealthCloud'),
      [
        { text: t('alerts.cancel') },
        {
          text: t('alerts.delete'),
          onPress: async () => {
            try {
              setLoadingSafe(true);
              setBackgroundWarnEligibleSafe(false);
              setWasBackgroundedDuringWorkSafe(false);
              setStatus(t('status.deleting'));

              // Biometric confirmation — delete all is a dangerous operation
              let bioPassword = null;
              try {
                bioPassword = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY, {
                  requireAuthentication: true,
                  authenticationPrompt: t('auth.confirmDeleteAll') || t('auth.unlockToSignIn')
                });
              } catch (bioErr) {
                // Biometric cancelled/failed — abort delete
                console.log('[Purge] Biometric cancelled:', bioErr?.message);
                setStatus(t('status.idle'));
                setLoadingSafe(false);
                return;
              }

              const SERVER_URL = getServerUrl();
              let config = await getAuthHeaders();
              // Re-auth against target server (stored token may be from a different server)
              if (bioPassword) {
                try {
                  const se = await SecureStore.getItemAsync('user_email');
                  if (se) {
                    const did = await getDeviceUUID(se, bioPassword);
                    const lr = await axios.post(`${SERVER_URL}/api/login`, { email: se, password: bioPassword, device_uuid: did, device_name: Platform.OS + ' ' + Platform.Version }, { timeout: 10000 });
                    if (lr.data?.token) config = { headers: { Authorization: `Bearer ${lr.data.token}`, 'X-Device-UUID': did } };
                  }
                } catch (_) {}
              }
              let res;
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  res = await axios.post(`${SERVER_URL}/api/cloud/purge`, {}, { ...config, timeout: 30000 });
                  break;
                } catch (retryErr) {
                  const st = retryErr.response?.status;
                  if (st && st >= 500 && attempt < 2) {
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                  }
                  throw retryErr;
                }
              }
              const deleted = res && res.data && res.data.deleted ? res.data.deleted : null;
              const chunks = deleted && typeof deleted.chunks === 'number' ? deleted.chunks : null;
              const manifests = deleted && typeof deleted.manifests === 'number' ? deleted.manifests : null;
              const msg = t('alerts.allFilesDeleted');
              if (chunks !== null || manifests !== null) {
                console.log('[StealthCloud] Purge deleted:', { chunks, manifests });
              }
              setStatus(t('status.cloudDataDeleted'));
              setStealthUsage(prev => prev ? { ...prev, usedBytes: 0, used_bytes: 0 } : prev);
              refreshStealthUsage();
              showDarkAlert(t('alerts.deleted'), msg);
            } catch (e) {
              const m = e && e.response && e.response.data && e.response.data.error
                ? e.response.data.error
                : (e && e.message ? e.message : 'Unknown error');
              setStatus(t('status.deletionFailed'));
              showDarkAlert(t('alerts.error'), m);
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
      setStatus(t('status.idle'));
      return;
    }

    showDarkAlert(
      t('alerts.deleteAllDataTitle'),
      t('alerts.deleteAllDataClassic'),
      [
        { text: t('alerts.cancel') },
        {
          text: t('alerts.delete'),
          onPress: async () => {
            try {
              setLoadingSafe(true);
              setBackgroundWarnEligibleSafe(false);
              setWasBackgroundedDuringWorkSafe(false);
              setStatus(t('status.deleting'));

              // Biometric confirmation — delete all is a dangerous operation
              let bioPassword = null;
              try {
                bioPassword = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY, {
                  requireAuthentication: true,
                  authenticationPrompt: t('auth.confirmDeleteAll') || t('auth.unlockToSignIn')
                });
              } catch (bioErr) {
                // Biometric cancelled/failed — abort delete
                console.log('[Purge] Biometric cancelled:', bioErr?.message);
                setStatus(t('status.idle'));
                setLoadingSafe(false);
                return;
              }

              const SERVER_URL = getServerUrl();
              let config = await getAuthHeaders();
              // Re-auth against target server (stored token may be from a different server)
              if (bioPassword) {
                try {
                  const se = await SecureStore.getItemAsync('user_email');
                  if (se) {
                    const did = await getDeviceUUID(se, bioPassword);
                    const lr = await axios.post(`${SERVER_URL}/api/login`, { email: se, password: bioPassword, device_uuid: did, device_name: Platform.OS + ' ' + Platform.Version }, { timeout: 10000 });
                    if (lr.data?.token) config = { headers: { Authorization: `Bearer ${lr.data.token}`, 'X-Device-UUID': did } };
                  }
                } catch (_) {}
              }
              let res;
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  res = await axios.post(`${SERVER_URL}/api/files/purge`, {}, { ...config, timeout: 30000 });
                  break;
                } catch (retryErr) {
                  const st = retryErr.response?.status;
                  if (st && st >= 500 && attempt < 2) {
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                  }
                  throw retryErr;
                }
              }
              const deleted = res && res.data && res.data.deleted ? res.data.deleted : null;
              const files = deleted && typeof deleted.files === 'number' ? deleted.files : null;
              if (files !== null) {
                console.log('[Classic] Purge deleted:', { files });
              }
              setStatus(t('status.cloudDataDeleted'));
              showDarkAlert(t('alerts.deleted'), t('alerts.allFilesDeleted'));
            } catch (e) {
              const m = e && e.response && e.response.data && e.response.data.error
                ? e.response.data.error
                : (e && e.message ? e.message : 'Unknown error');
              setStatus(t('status.deletionFailed'));
              showDarkAlert(t('alerts.error'), m);
            } finally {
              setLoadingSafe(false);
            }
          }
        }
      ]
    );
  };

  const setWasBackgroundedDuringWorkSafe = (value) => { wasBackgroundedDuringWorkRef.current = value; setWasBackgroundedDuringWork(value); };

  const resetBackupPickerState = () => { backupPickerDeletedIdsCache = null; setBackupPickerAssets([]); setBackupPickerAfter(null); setBackupPickerHasNext(true); setBackupPickerLoading(false); setBackupPickerTotal(0); setBackupPickerSelected({}); backupPickerMetaInFlightRef.current.clear(); backupPickerThumbFixingRef.current.clear(); };
  const openBackupModeChooser = () => { if (loadingRef.current) return; setBackupModeOpen(true); };
  const closeBackupModeChooser = () => setBackupModeOpen(false);

  // --- Backup picker: SINGLE batched flush for all async updates ---
  // All thumb fixes, enrichments, and meta updates write to this pending Map,
  // then a single debounced flush applies them to state in one setBackupPickerAssets call.
  const backupPickerPendingUpdatesRef = useRef(new Map()); // id -> { thumbUri?, fileSize? }
  const backupPickerFlushTimerRef = useRef(null);
  const flushBackupPickerUpdates = useCallback(() => {
    const pending = backupPickerPendingUpdatesRef.current;
    if (pending.size === 0) return;
    const batch = new Map(pending);
    pending.clear();
    setBackupPickerAssets(prev => (prev || []).map(a => {
      if (!a?.id) return a;
      const upd = batch.get(a.id);
      if (!upd) return a;
      let changed = a;
      if (upd.thumbUri) changed = { ...changed, thumbUri: upd.thumbUri };
      if (upd.fileSize) changed = { ...changed, fileSize: upd.fileSize };
      return changed;
    }));
  }, []);
  const scheduleBackupPickerFlush = useCallback(() => {
    if (backupPickerFlushTimerRef.current) clearTimeout(backupPickerFlushTimerRef.current);
    backupPickerFlushTimerRef.current = setTimeout(flushBackupPickerUpdates, 400);
  }, [flushBackupPickerUpdates]);
  const queueBackupPickerUpdate = useCallback((id, updates) => {
    if (!id) return;
    const existing = backupPickerPendingUpdatesRef.current.get(id) || {};
    backupPickerPendingUpdatesRef.current.set(id, { ...existing, ...updates });
    scheduleBackupPickerFlush();
  }, [scheduleBackupPickerFlush]);

  const fixBackupPickerThumbnail = useCallback(async (asset) => {
    try {
      if (!asset?.id) return;
      const attempts = Number(backupPickerThumbFixingRef.current.get(asset.id) || 0);
      if (attempts >= 2) return;
      backupPickerThumbFixingRef.current.set(asset.id, attempts + 1);

      const ext = (asset.filename || '').split('.').pop()?.toLowerCase();
      const isVideo = asset.mediaType === 'video' || ['mov', 'mp4', 'avi', 'mkv', 'm4v', '3gp', 'webm'].includes(ext);

      const info = await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: true });
      const sourceUri = info?.localUri || info?.uri || asset?.uri || asset?.thumbUri;
      let thumbUri = sourceUri || null;

      if (isVideo) return; else if (Platform.OS === 'android' && asset.mediaType === 'photo') {
        try {
          const shouldForceThumb = !!(sourceUri && typeof sourceUri === 'string' && sourceUri.startsWith('content://'));
          if (sourceUri && (shouldForceThumb || ext === 'heic' || ext === 'heif' || ext === 'avif')) {
            const manipResult = await ImageManipulator.manipulateAsync(
              sourceUri,
              [{ resize: { width: 200 } }],
              { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
            );
            if (manipResult?.uri) thumbUri = manipResult.uri;
          }
        } catch (e) {}
      }

      const isContentUri = Platform.OS === 'android' && typeof thumbUri === 'string' && thumbUri.startsWith('content://');
      if (thumbUri && !isContentUri) {
        backupPickerThumbCacheRef.current.set(asset.id, thumbUri);
        if (backupPickerThumbCacheRef.current.size > 800) {
          const firstKey = backupPickerThumbCacheRef.current.keys().next().value;
          if (firstKey) backupPickerThumbCacheRef.current.delete(firstKey);
        }
        if (thumbUri !== asset?.thumbUri) {
          queueBackupPickerUpdate(asset.id, { thumbUri });
        }
      }
    } catch (e) {}
  }, [queueBackupPickerUpdate]);

  const warmBackupPickerDeletedIds = async () => {
    if (Platform.OS !== 'android' || backupPickerDeletedIdsCache) return;
    try {
      const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: false });
      const deletedAlbum = albums.find(a => a.title === 'PhotoLynkDeleted');
      if (deletedAlbum) {
        const ids = new Set();
        let dAfter = null;
        while (true) {
          const dPage = await MediaLibrary.getAssetsAsync({ album: deletedAlbum, first: 500, after: dAfter || undefined, mediaType: ['photo', 'video'] });
          if (dPage?.assets) for (const a of dPage.assets) ids.add(a.id);
          dAfter = dPage?.endCursor;
          if (!dPage?.hasNextPage || !dPage?.assets?.length) break;
        }
        backupPickerDeletedIdsCache = ids;
      } else {
        backupPickerDeletedIdsCache = new Set();
      }
    } catch (e) { backupPickerDeletedIdsCache = new Set(); }
  };

  const loadBackupPickerPage = async ({ reset }) => {
    if (backupPickerLoading) return;
    if (!reset && !backupPickerHasNext) return;
    setBackupPickerLoading(true);
    try {
      const permission = await requestMediaLibraryPermission();
      if (permission.status !== 'granted') { showDarkAlert(t('alerts.permissionNeeded'), t('alerts.permissionNeededMessage')); return; }

      if (!backupPickerDeletedIdsCache) backupPickerDeletedIdsCache = new Set();

      let currentAfter = reset ? null : backupPickerAfter;
      let fetchedAssets = [];
      let hasNext = true;
      let deferredTotal = null;

      // Loop until we have at least 18 items to avoid triggering rapid onEndReached calls
      while (fetchedAssets.length < 18 && hasNext) {
        const page = await MediaLibrary.getAssetsAsync({ first: 18, after: currentAfter || undefined, mediaType: ['photo', 'video'], sortBy: [MediaLibrary.SortBy.creationTime] });
        if (!page || !Array.isArray(page.assets) || page.assets.length === 0) {
          hasNext = false;
          break;
        }
        
        if (deferredTotal === null && typeof page.totalCount === 'number') {
           deferredTotal = Math.max(0, Number(page.totalCount) - backupPickerDeletedIdsCache.size) || 0;
        }

        let batch = page.assets;
        if (Platform.OS === 'android') {
          batch = batch.filter(a => {
            if (backupPickerDeletedIdsCache.has(a.id)) return false;
            const uri = a?.uri || '';
            const localUri = a?.localUri || '';
            if (uri.includes('/PhotoLynkDeleted/') || localUri.includes('/PhotoLynkDeleted/')) return false;
            return true;
          });
        }
        fetchedAssets.push(...batch);
        currentAfter = page.endCursor;
        hasNext = !!page.hasNextPage;
      }
      
      const assets = fetchedAssets;
      if (deferredTotal === null && reset) {
        deferredTotal = assets.length;
      }

      // Show assets immediately without blocking UI
      const resolvedAssets = assets.map(a => {
        if (!a || !a.id) return { ...a, thumbUri: null };
        const cached = backupPickerThumbCacheRef.current.get(a.id);
        const thumbUri = cached || a.uri || null;
        return { ...a, thumbUri };
      });

      ReactNative.unstable_batchedUpdates(() => {
        if (deferredTotal !== null) setBackupPickerTotal(deferredTotal);
        setBackupPickerAssets(prev => reset ? resolvedAssets : prev.concat(resolvedAssets));
        setBackupPickerAfter(currentAfter);
        setBackupPickerHasNext(hasNext);
        setBackupPickerLoading(false);
      });

      // Async background enrichment (Android content:// thumb fix & StealthCloud file size)
      const ENRICH_BATCH = 4;
      (async () => {
        try {
          for (let i = 0; i < assets.length; i += ENRICH_BATCH) {
            const batch = assets.slice(i, i + ENRICH_BATCH);
            await Promise.all(batch.map(async (asset) => {
              try {
                if (!asset?.id) return;
                let updates = {};
                
                if (Platform.OS === 'android') {
                   const cached = backupPickerThumbCacheRef.current.get(asset.id);
                   const isContent = !cached && asset.uri && asset.uri.startsWith('content://');
                   if (isContent || (!cached && asset.mediaType === 'video')) {
                      const info = await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: false }).catch(()=>null);
                      let newThumb = info?.localUri || info?.uri || asset.uri;
                      const ext = (asset.filename || '').split('.').pop()?.toLowerCase();
                      const isHeic = ext === 'heic' || ext === 'heif' || ext === 'avif';
                      if ((isHeic || (newThumb && newThumb.startsWith('content://'))) && asset.mediaType === 'photo') {
                         const manip = await ImageManipulator.manipulateAsync(newThumb, [{ resize: { width: 200 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }).catch(()=>null);
                         if (manip?.uri) newThumb = manip.uri;
                      } else if (asset.mediaType === 'video' && newThumb) {
                         const frame = await VideoThumbnails.getThumbnailAsync(newThumb, { time: 0 }).catch(()=>null);
                         if (frame?.uri) newThumb = frame.uri;
                      }
                      if (newThumb && newThumb !== asset.uri && newThumb !== asset.thumbUri) {
                         backupPickerThumbCacheRef.current.set(asset.id, newThumb);
                         updates.thumbUri = newThumb;
                      }
                   }
                }

                if (serverType === 'stealthcloud' && !(typeof asset.fileSize === 'number' && asset.fileSize > 0)) {
                  if (!backupPickerMetaInFlightRef.current.has(String(asset.id))) {
                    backupPickerMetaInFlightRef.current.add(String(asset.id));
                    const info = await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: false }).catch(()=>null);
                    let fs = info && typeof info.fileSize === 'number' ? Number(info.fileSize) : null;
                    if ((!fs || fs <= 0) && info) {
                      const uri = info.localUri || info.uri || asset.uri || null;
                      if (uri) {
                        const fi = await FileSystem.getInfoAsync(uri).catch(()=>null);
                        if (fi && typeof fi.size === 'number' && fi.size > 0) fs = fi.size;
                      }
                    }
                    if (fs && fs > 0) updates.fileSize = fs;
                  }
                }

                if (Object.keys(updates).length > 0) {
                  queueBackupPickerUpdate(asset.id, updates);
                }
              } catch (e) {}
            }));
          }
        } catch (e) {}
      })();

      if (backupPickerThumbCacheRef.current.size > 800) {
        const firstKey = backupPickerThumbCacheRef.current.keys().next().value;
        if (firstKey) backupPickerThumbCacheRef.current.delete(firstKey);
      }
    } catch (e) {
       setBackupPickerLoading(false);
    }
  };

  const openBackupPicker = async () => { if (loadingRef.current) return; resetBackupPickerState(); setBackupPickerPreview(null); backupPickerOpenRef.current = true; setBackupPickerOpen(true); setBackupPickerLoading(true); await warmBackupPickerDeletedIds(); await loadBackupPickerPage({ reset: true }); };
  const closeBackupPicker = () => { backupPickerOpenRef.current = false; setBackupPickerOpen(false); setBackupPickerPreview(null); resetBackupPickerState(); if (backupPickerFlushTimerRef.current) { clearTimeout(backupPickerFlushTimerRef.current); backupPickerFlushTimerRef.current = null; } backupPickerPendingUpdatesRef.current.clear(); };

  const ensureBackupPickerAssetMeta = useCallback(async (asset) => {
    try {
      if (serverType !== 'stealthcloud') return;
      const id = asset && asset.id ? String(asset.id) : '';
      if (!id) return;
      if (asset && typeof asset.fileSize === 'number' && asset.fileSize > 0) return;
      if (backupPickerMetaInFlightRef.current.has(id)) return;
      backupPickerMetaInFlightRef.current.add(id);
      await backupPickerMetaLimiterRef.current(async () => {
        try {
          const info = await MediaLibrary.getAssetInfoAsync(id, { shouldDownloadFromNetwork: true });
          let fileSize = info && typeof info.fileSize === 'number' ? Number(info.fileSize) : null;
          if ((!fileSize || fileSize <= 0) && info) {
            const uri = info.localUri || info.uri || (asset && asset.uri) || null;
            if (uri) {
              try {
                const fsInfo = await FileSystem.getInfoAsync(uri);
                const sz = fsInfo && typeof fsInfo.size === 'number' ? Number(fsInfo.size) : null;
                if (sz && sz > 0) fileSize = sz;
              } catch (e) {}
            }
          }
          if (fileSize && fileSize > 0) {
            queueBackupPickerUpdate(id, { fileSize });
          }
        } catch (e) {
        }
      });
    } catch (e) {}
  }, [serverType, queueBackupPickerUpdate]);

  const onBackupPickerViewableItemsChangedRef = useRef(null);
  onBackupPickerViewableItemsChangedRef.current = ({ viewableItems }) => {
    if (serverType !== 'stealthcloud') return;
    try {
      const vis = Array.isArray(viewableItems) ? viewableItems : [];
      for (const v of vis) {
        const a = v && v.item ? v.item : null;
        if (a && a.id) ensureBackupPickerAssetMeta(a);
      }
    } catch (e) {}
  };
  const onBackupPickerViewableItemsChanged = useRef(({ viewableItems }) => {
    if (onBackupPickerViewableItemsChangedRef.current) {
      onBackupPickerViewableItemsChangedRef.current({ viewableItems });
    }
  });

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

  const resetSyncPickerState = () => { setSyncPickerItems([]); setSyncPickerTotal(0); setSyncPickerOffset(0); setSyncPickerLoading(false); setSyncPickerLoadingMore(false); setSyncPickerSelected({}); setSyncPickerAuthHeaders(null); syncPickerLocalFilenamesRef.current = null; syncPickerMasterKeyRef.current = null; syncPickerThumbCacheRef.current = new Map(); syncPickerThumbInFlightRef.current = new Set(); };
  const openSyncModeChooser = () => { if (loadingRef.current) return; setSyncModeOpen(true); };
  const closeSyncModeChooser = () => setSyncModeOpen(false);
  const openCleanupModeChooser = () => { if (loadingRef.current) return; setCleanupModeOpen(true); };
  const closeCleanupModeChooser = () => setCleanupModeOpen(false);
  const closeSimilarReview = () => { setSimilarReviewOpen(false); setSimilarGroups([]); setSimilarGroupIndex(0); setSimilarSelected({}); setSimilarPhotoIndex(0); setSimilarDeletedTotal(0); similarDeletedTotalRef.current = 0; };

  const buildDefaultSimilarSelection = (group) => {
    const items = Array.isArray(group) ? group : [];
    const next = {};
    for (let i = 1; i < items.length; i++) { const id = items[i] && items[i].id ? String(items[i].id) : ''; if (id) next[id] = true; }
    return next;
  };

  const openSimilarGroup = ({ groups, index }) => {
    const g = Array.isArray(groups) ? groups : [];
    const i = typeof index === 'number' ? index : 0;
    setSimilarGroups(g); setSimilarGroupIndex(i); setSimilarSelected(buildDefaultSimilarSelection(g[i] || [])); setSimilarPhotoIndex(0); setSimilarReviewOpen(true);
  };

  const toggleSimilarSelected = (assetId) => {
    const key = assetId ? String(assetId) : '';
    if (!key) return;
    setSimilarSelected(prev => { const next = { ...(prev || {}) }; if (next[key]) delete next[key]; else next[key] = true; return next; });
  };

  const ensureSimilarThumb = useCallback(async (asset) => {
    try {
      if (!asset?.id) return;
      const id = String(asset.id);
      const cached = similarThumbCacheRef.current.get(id);
      if (cached) return;
      if (similarThumbInFlightRef.current.has(id)) return;

      similarThumbInFlightRef.current.add(id);

      await similarThumbLimiterRef.current(async () => {
        try {
          const info = await MediaLibrary.getAssetInfoAsync(asset.id, { shouldDownloadFromNetwork: true });
          const ext = String(asset?.filename || info?.filename || '').split('.').pop()?.toLowerCase();
          const sourceUri = info?.localUri || info?.uri || asset?.thumbUri || asset?.uri || null;
          let thumbUri = sourceUri;

          if (Platform.OS === 'android') {
            const needsThumb = !!(typeof sourceUri === 'string' && (sourceUri.startsWith('content://') || ext === 'heic' || ext === 'heif' || ext === 'avif'));
            if (needsThumb && sourceUri) {
              try {
                const manipResult = await ImageManipulator.manipulateAsync(
                  sourceUri,
                  [{ resize: { width: 200 } }],
                  { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
                );
                if (manipResult?.uri) thumbUri = manipResult.uri;
              } catch (e) {}
            }
          }

          if (thumbUri) {
            similarThumbCacheRef.current.set(id, thumbUri);
            setSimilarGroups(prev => (Array.isArray(prev) ? prev.map(g => (Array.isArray(g) ? g.map(a => {
              if (!a || String(a.id) !== id) return a;
              return a.thumbUri === thumbUri ? a : { ...a, thumbUri };
            }) : g)) : prev));
          }
        } finally {
          similarThumbInFlightRef.current.delete(id);
        }
      });
    } catch (e) {
      try { if (asset?.id) similarThumbInFlightRef.current.delete(String(asset.id)); } catch (e2) {}
    }
  }, []);

  const getSimilarSelectedIds = () => {
    const sel = similarSelected && typeof similarSelected === 'object' ? similarSelected : {};
    return Object.keys(sel).filter(k => sel[k]);
  };

  useEffect(() => {
    if (!similarReviewOpen) return;
    if (Platform.OS !== 'android') return;
    const g = Array.isArray(similarGroups) ? similarGroups : [];
    const group = g[similarGroupIndex] || [];
    if (!Array.isArray(group) || group.length === 0) return;
    setTimeout(() => {
      try {
        for (const a of group) {
          void ensureSimilarThumb(a);
        }
      } catch (e) {}
    }, 0);
  }, [similarReviewOpen, similarGroupIndex, similarGroups, ensureSimilarThumb]);

  const advanceSimilarGroup = ({ groups, nextIndex, deletedCount = 0 }) => {
    const g = Array.isArray(groups) ? groups : [];
    const i = typeof nextIndex === 'number' ? nextIndex : 0;
    if (i >= g.length) {
      // Use ref for accurate cumulative total (state is stale in async handlers)
      const totalDeleted = deletedCount || similarDeletedTotalRef.current;
      closeSimilarReview();
      setStatus(t('status.cleanupComplete'));
      showCompletionTickBriefly(t('results.filesDeleted', { count: totalDeleted }));
      return;
    }
    openSimilarGroup({ groups: g, index: i });
  };

  // ============================================================================
  // NFT FUNCTIONS
  // ============================================================================
  
  const openNftPicker = async () => { if (loadingRef.current) return; setNftPickerOpen(true); };
  
  const closeNftPicker = () => {
    setNftPickerOpen(false);
  };
  
  const openNftGallery = () => {
    setNftGalleryOpen(true);
  };
  
  const closeNftGallery = () => {
    setNftGalleryOpen(false);
  };
  
  const handleNftTransfer = (nft) => {
    setNftToTransfer(nft);
    setNftTransferOpen(true);
  };
  
  const closeNftTransfer = () => {
    setNftTransferOpen(false);
    setNftToTransfer(null);
  };
  
  const handleNftTransferComplete = async (result) => {
    const transferredNft = nftToTransfer;
    closeNftTransfer();
    showCompletionTickBriefly(t('results.nftTransferred'));
    // Remove transferred NFT and its certificate from local storage
    if (transferredNft?.mintAddress) {
      const mintAddrStored = transferredNft.mintAddress;
      const mintAddrStripped = (mintAddrStored || '').replace('cnft_', '');
      try {
        // Remove both forms to handle cNFT ids stored as `cnft_<assetId>`
        await NFTOperations.removeNFTFromStorage(mintAddrStored);
        if (mintAddrStripped && mintAddrStripped !== mintAddrStored) {
          await NFTOperations.removeNFTFromStorage(mintAddrStripped);
        }
        console.log('[Transfer] Removed NFT from storage:', mintAddrStored);
      } catch (e) {
        console.log('[Transfer] NFT removal error:', e.message);
      }
      try {
        // Remove both forms to handle any legacy cert records stored with/without `cnft_` prefix
        await NFTOperations.removeCertificateByMint(mintAddrStored);
        if (mintAddrStripped && mintAddrStripped !== mintAddrStored) {
          await NFTOperations.removeCertificateByMint(mintAddrStripped);
        }
        console.log('[Transfer] Removed cert from storage:', mintAddrStored);
      } catch (e) {
        console.log('[Transfer] Cert removal error:', e.message);
      }
    }
    // Trigger gallery refresh so transferred NFT disappears immediately
    if (nftGalleryOpen) {
      setNftGalleryRefreshKey(k => (k || 0) + 1);
    }
  };
  
  const handleMintNFT = async ({ asset, filePath, name, description, stripExif, storageOption, nftType, serverConfig, costEstimate: passedCostEstimate, edition, license, watermark, encrypt, certificationMode }) => {
    if (!asset || !filePath) {
      showDarkAlert(t('alerts.error'), t('alerts.selectItemsMessage'));
      return;
    }
    
    setNftMinting(true);
    setLoadingSafe(true);
    setStatus(t('status.nftPreparing'));
    setProgress(0);
    setProgressAction('nft');
    
    try {
      // Initialize NFT module
      await NFTOperations.initializeNFT();
      
      // Use the cost estimate passed from NFTPhotoPicker (already calculated with correct file size)
      const useCloud = storageOption === 'cloud';
      const useCompressed = nftType === 'compressed';
      let fileSize = 0;
      try { fileSize = (await FileSystem.getInfoAsync(filePath)).size || 0; } catch (_) {}
      const costEstimate = passedCostEstimate || await NFTOperations.estimateNFTMintCost(
        fileSize || (500 * 1024), 
        storageOption, 
        useCompressed,
        edition || 'open'
      );
      
      // Check if connected wallet is the fee wallet (fee wallet doesn't pay PhotoLynk fees)
      let isFeeWallet = false;
      try {
        const walletStatus = WalletAdapter.getConnectionStatus ? WalletAdapter.getConnectionStatus() : null;
        isFeeWallet = walletStatus?.address === NFTOperations.NFT_COMMISSION_WALLET;
      } catch (_) {}
      
      const storageLabel = useCloud ? 'StealthCloud' : 'IPFS';
      const nftTypeLabel = useCompressed ? t('nftMint.compressedNft') : t('nftMint.standardNft');
      
      // Simplified total display (single line, no detailed breakdown)
      const breakdown = costEstimate.breakdown;
      let totalDisplay;
      if (isFeeWallet) {
        const adjustedSol = costEstimate.total.sol - (breakdown.appCommission?.sol || 0);
        const adjustedUsd = adjustedSol * costEstimate.solPrice;
        totalDisplay = `~$${adjustedUsd.toFixed(2)} (${adjustedSol.toFixed(6)} SOL)`;
      } else {
        totalDisplay = `~${costEstimate.total.usdFormatted} (${costEstimate.total.solFormatted} SOL)`;
      }
      
      const confirmMint = await new Promise((resolve) => {
        setCustomAlert({
          title: t('nftMint.confirmMinting'),
          message: `${t('nftMint.estTotal')}: ${totalDisplay}\n\n${t('nftMint.proceedWithMinting')}`,
          buttons: [
            { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
            { text: t('nftMint.certifyOriginal'), onPress: () => resolve(true) },
          ],
        });
      });
      
      if (!confirmMint) {
        setNftMinting(false);
        setLoadingSafe(false);
        setStatus(t('status.idle'));
        setProgress(0);
        return;
      }
      
      // Get master key if encryption is requested
      let masterKey = null;
      if (encrypt) {
        try {
          masterKey = await getStealthCloudMasterKey();
        } catch (e) {
          console.warn('[NFT] Could not get master key for encryption:', e?.message);
          showDarkAlert(t('alerts.error'), t('alerts.encryptionRequiresLogin'));
          setNftMinting(false);
          setLoadingSafe(false);
          setStatus(t('status.idle'));
          setProgress(0);
          return;
        }
      }
      
      // Mint the NFT
      const result = await NFTOperations.mintPhotoNFT({
        asset,
        filePath,
        name,
        description,
        stripExif,
        storageOption,
        nftType: nftType || 'compressed',
        serverConfig,
        onProgress: (p) => setProgress(p),
        onStatus: (s) => {
          const statusMap = {
            'Preparing NFT...': t('nftStatus.preparing'),
            'Estimating costs...': t('nftStatus.estimatingCosts'),
            'Connecting wallet...': t('nftStatus.connectingWallet'),
            'Removing private data...': t('nftStatus.removingPrivateData'),
            'Uploading to StealthCloud...': t('nftStatus.uploadingStealthCloud'),
            'Uploading to IPFS...': t('nftStatus.uploadingIpfs'),
            'Creating thumbnail...': t('nftStatus.creatingThumbnail'),
            'Creating preview...': t('nftStatus.creatingThumbnail'),
            'Creating certificate image...': t('nftStatus.creatingThumbnail'),
            'Compressing for on-chain...': t('nftStatus.compressingOnChain'),
            'Applying watermark...': t('nftStatus.applyingWatermark'),
            'Encrypting image...': t('nftStatus.encryptingImage'),
            'Computing integrity proof...': t('nftStatus.computingIntegrity'),
            'Building metadata...': t('nftStatus.buildingMetadata'),
            'Creating NFT on Solana...': t('nftStatus.creatingOnSolana'),
            'Minting compressed NFT...': t('nftStatus.mintingCompressed'),
            'Signing transaction...': t('nftStatus.signingTransaction'),
            'Confirming transaction...': t('nftStatus.confirmingTransaction'),
            'Finalizing...': t('nftStatus.finalizing'),
            'NFT minted successfully!': t('nftStatus.mintedSuccessfully'),
            'Minting failed': t('nftStatus.mintingFailed'),
          };
          const translated = statusMap[s] || s;
          setStatus(`NFT: ${translated}`);
        },
        // Edition parameters
        edition,
        license,
        watermark,
        encrypt,
        masterKey,
        certificationMode,
      });
      
      if (result.success) {
        setStatus(t('status.nftMinted'));
        // Invalidate DAS cache so next scan picks up the new NFT
        NFTOperations.invalidateDasCache();
        
        // Show success — simple certification confirmation
        const addressLabel = t('nftMint.certId');
        
        showDarkAlert(
          t('nftMint.certifiedSuccess'),
          `${t('nftMint.photoCertified', { name })}\n\n${addressLabel}:\n${result.mintAddress?.slice(0, 20)}...\n\n${t('nftMint.viewInOriginalsAndProofs')}`
        );
      } else {
        const errMsg = result.error || t('alerts.error');
        const translatedErr = errMsg.includes('too complex for on-chain') ? t('nftStatus.onChainTooComplex') : errMsg.includes('On-chain compression failed') ? t('nftStatus.onChainFailed', { reason: errMsg.replace(/^On-chain compression failed:\s*/, '') }) : errMsg;
        showDarkAlert(t('alerts.error'), translatedErr);
      }
    } catch (e) {
      console.error('[NFT] Mint error:', e);
      const errMsg = e.message || t('alerts.error');
      const translatedErr = errMsg.includes('too complex for on-chain') ? t('nftStatus.onChainTooComplex') : errMsg.includes('On-chain compression failed') ? t('nftStatus.onChainFailed', { reason: errMsg.replace(/^On-chain compression failed:\s*/, '') }) : errMsg;
      showDarkAlert(t('alerts.error'), translatedErr);
    } finally {
      setNftMinting(false);
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setProgress(0);
    }
  };

  const startSimilarShotsReview = async () => {
    await cancelInFlightOperations();
    const opId = currentOperationIdRef.current;
    setBackgroundWarnEligibleSafe(false); setWasBackgroundedDuringWorkSafe(false); setLoadingSafe(true); // Don't warn during permission prompts
    setProgress(0);
    setProgressAction('cleanup');
    setStatus(t('status.comparingPreparing'));
    
    // Enable background warning only after we start actual work (permission already granted inside core)
    setTimeout(() => { if (loadingRef.current) setBackgroundWarnEligibleSafe(true); }, 2000);
    
    const result = await startSimilarShotsReviewCore({
      resolveReadableFilePath,
      onStatus: (s) => setStatusSafe(opId, s),
      onProgress: (p) => setProgressSafe(opId, p),
      t,
      abortRef: abortOperationsRef,
    });

    if (result.aborted) {
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      return;
    }

    if (result.error) {
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      showDarkAlert(t('alerts.similarPhotos'), result.error);
      return;
    }

    if (result.noGroups) {
      setStatus(t('status.noSimilarPhotos'));
      await sleep(400); // Let user see 100% before checkmark
      showCompletionTickBriefly(t('results.noSimilarPhotos'));
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      return;
    }

    setLoadingSafe(false);
    setBackgroundWarnEligibleSafe(false);
    setSimilarDeletedTotal(0);
    similarDeletedTotalRef.current = 0;
    openSimilarGroup({ groups: result.groups, index: 0 });
  };

  const openSyncPicker = async () => {
    if (loadingRef.current) return;
    resetSyncPickerState(); setSyncPickerOpen(true); setSyncPickerLoading(true);
    try {
      // Ensure media library permission before listing local assets
      const permission = await requestMediaLibraryPermission();
      if (!permission || permission.status !== 'granted') {
        showDarkAlert(t('alerts.syncListFailed'), t('alerts.syncListFailedPermission'));
        setSyncPickerOpen(false);
        return;
      }

      const config = await getAuthHeaders();
      setSyncPickerAuthHeaders(config.headers || {});
      const SERVER_URL = getServerUrl();

      const localIndex = await buildLocalFilenameSetPaged({ mediaType: ['photo', 'video'] });
      syncPickerLocalFilenamesRef.current = localIndex.set;

      if (serverType === 'stealthcloud') {
        const masterKey = await getStealthCloudMasterKey();
        syncPickerMasterKeyRef.current = masterKey;
        const result = await fetchStealthCloudPickerPage({
          config, SERVER_URL, masterKey, offset: 0, limit: SYNC_PICKER_PAGE_SIZE
        });
        setSyncPickerItems(result.items);
        setSyncPickerTotal(result.total);
        setSyncPickerOffset(result.nextOffset);
        // Trigger thumbnail loading for initial visible items
        setTimeout(() => {
          const initialItems = result.items.slice(0, 12);
          for (const it of initialItems) {
            if (it && it.thumbChunkId && it.thumbNonce && !it.thumbUri) {
              ensureStealthCloudSyncThumb(it);
            }
          }
        }, 100);
      } else {
        const result = await fetchLocalRemotePickerPage({
          config, SERVER_URL, offset: 0, limit: SYNC_PICKER_PAGE_SIZE,
          fetchThumbnails: true // Fetch thumbnails during load
        });
        setSyncPickerItems(result.items);
        setSyncPickerTotal(result.total);
        setSyncPickerOffset(result.nextOffset);
      }
    } catch (e) {
      setSyncPickerItems([]);
      setSyncPickerTotal(0);
      setSyncPickerOffset(0);
      const detail = e?.response?.data?.error || e?.message || 'Unknown error';
      showDarkAlert(t('alerts.syncListFailed'), detail);
    } finally { setSyncPickerLoading(false); }
  };

  const loadMoreSyncPickerItems = () => {
    if (syncPickerLoadingMore || syncPickerLoading) return;
    setSyncPickerLoadingMore(true);
    (async () => {
      try {
        const config = await getAuthHeaders();
        const SERVER_URL = getServerUrl();

        if (serverType === 'stealthcloud') {
          const masterKey = await getStealthCloudMasterKey();
          syncPickerMasterKeyRef.current = masterKey;
          const result = await fetchStealthCloudPickerPage({
            config, SERVER_URL, masterKey, offset: syncPickerOffset, limit: SYNC_PICKER_PAGE_SIZE
          });
          if (result.total !== syncPickerTotal) setSyncPickerTotal(result.total);
          setSyncPickerOffset(result.nextOffset);
          if (result.items.length > 0) {
            setSyncPickerItems(prev => {
              const existingIds = new Set(prev.map(it => it?.manifestId));
              const newItems = result.items.filter(it => it?.manifestId && !existingIds.has(it.manifestId));
              return [...prev, ...newItems];
            });
          }
        } else {
          const result = await fetchLocalRemotePickerPage({
            config, SERVER_URL, offset: syncPickerOffset, limit: SYNC_PICKER_PAGE_SIZE,
            fetchThumbnails: true
          });
          if (result.total !== syncPickerTotal) setSyncPickerTotal(result.total);
          setSyncPickerOffset(result.nextOffset);
          if (result.items.length > 0) {
            setSyncPickerItems(prev => {
              const existingIds = new Set(prev.map(it => it?.filename));
              const newItems = result.items.filter(it => it?.filename && !existingIds.has(it.filename));
              return [...prev, ...newItems];
            });
          }
        }
      } catch (e) {
        console.log('Sync picker: load more failed', e.message);
      } finally {
        setSyncPickerLoadingMore(false);
      }
    })();
  };

  const syncPickerHasMore = (syncPickerTotal > 0 && syncPickerOffset < syncPickerTotal);

  const ensureStealthCloudSyncThumb = useCallback(async (item) => {
    try {
      if (!item || !item.manifestId) return;
      if (serverType !== 'stealthcloud') return;
      const manifestId = String(item.manifestId);
      if (item.thumbUri) return;

      const cached = syncPickerThumbCacheRef.current.get(manifestId);
      if (cached) {
        setSyncPickerItems(prev => (prev || []).map(it => (it && String(it.manifestId || '') === manifestId ? { ...it, thumbUri: cached } : it)));
        return;
      }

      const thumbChunkId = item.thumbChunkId ? String(item.thumbChunkId) : '';
      const thumbNonce = item.thumbNonce ? String(item.thumbNonce) : '';
      if (!thumbChunkId || !thumbNonce) return;

      const inFlightKey = `${manifestId}:${thumbChunkId}`;
      if (syncPickerThumbInFlightRef.current.has(inFlightKey)) return;
      syncPickerThumbInFlightRef.current.add(inFlightKey);

      await syncPickerThumbLimiterRef.current(async () => {
        try {
          const headers = syncPickerAuthHeaders && typeof syncPickerAuthHeaders === 'object' ? syncPickerAuthHeaders : null;
          const masterKey = syncPickerMasterKeyRef.current;
          if (!headers || !masterKey) return;
          const SERVER_URL = getServerUrl();
          const uri = await fetchStealthCloudThumbFileUri({
            config: { headers },
            SERVER_URL,
            masterKey,
            thumbChunkId,
            thumbNonce,
            thumbMime: item.thumbMime,
          });
          if (uri) {
            syncPickerThumbCacheRef.current.set(manifestId, uri);
            setSyncPickerItems(prev => (prev || []).map(it => (it && String(it.manifestId || '') === manifestId ? { ...it, thumbUri: uri } : it)));
          }
        } finally {
          syncPickerThumbInFlightRef.current.delete(inFlightKey);
        }
      });
    } catch (e) {
    }
  }, [serverType, syncPickerAuthHeaders]);

  // Enrichment function for local/remote server thumbnails
  const ensureLocalRemoteSyncThumb = useCallback(async (item) => {
    try {
      if (!item || !item.filename) return;
      if (serverType === 'stealthcloud') return;
      const filename = String(item.filename);
      if (item.thumbUri) return;

      const cached = syncPickerThumbCacheRef.current.get(filename);
      if (cached) {
        setSyncPickerItems(prev => (prev || []).map(it => (it && String(it.filename || '') === filename ? { ...it, thumbUri: cached } : it)));
        return;
      }

      const inFlightKey = `local:${filename}`;
      if (syncPickerThumbInFlightRef.current.has(inFlightKey)) return;
      syncPickerThumbInFlightRef.current.add(inFlightKey);

      await syncPickerThumbLimiterRef.current(async () => {
        try {
          const headers = syncPickerAuthHeaders && typeof syncPickerAuthHeaders === 'object' ? syncPickerAuthHeaders : {};
          const SERVER_URL = getServerUrl();
          const uri = await fetchThumbnailBase64(filename, { headers }, SERVER_URL);
          if (uri) {
            syncPickerThumbCacheRef.current.set(filename, uri);
            setSyncPickerItems(prev => (prev || []).map(it => (it && String(it.filename || '') === filename ? { ...it, thumbUri: uri } : it)));
          }
        } finally {
          syncPickerThumbInFlightRef.current.delete(inFlightKey);
        }
      });
    } catch (e) {
    }
  }, [serverType, syncPickerAuthHeaders]);

  const onSyncPickerViewableItemsChangedRef = useRef(null);
  onSyncPickerViewableItemsChangedRef.current = ({ viewableItems }) => {
    try {
      const vis = Array.isArray(viewableItems) ? viewableItems : [];
      for (const v of vis) {
        const it = v && v.item ? v.item : null;
        if (!it || it.thumbUri) continue;
        if (serverType === 'stealthcloud') {
          ensureStealthCloudSyncThumb(it);
        } else {
          ensureLocalRemoteSyncThumb(it);
        }
      }
    } catch (e) {}
  };
  const onSyncPickerViewableItemsChanged = useRef(({ viewableItems }) => {
    if (onSyncPickerViewableItemsChangedRef.current) {
      onSyncPickerViewableItemsChangedRef.current({ viewableItems });
    }
  });

  const closeSyncPicker = () => { setSyncPickerOpen(false); resetSyncPickerState(); };

  const toggleSyncPickerSelected = (key) => {
    if (!key) return;
    setSyncPickerSelected(prev => { const next = { ...prev }; if (next[key]) delete next[key]; else next[key] = true; return next; });
  };

  const getSelectedSyncKeys = () => {
    const selected = syncPickerSelected && typeof syncPickerSelected === 'object' ? Object.keys(syncPickerSelected).filter(k => syncPickerSelected[k]) : [];
    return selected;
  };

  useEffect(() => {
    // Initialize language first (fast, from SecureStore)
    initializeLanguage().then(lang => {
      setCurrentLanguage(lang);
      console.log('[i18n] App language:', lang);
    });
    checkLogin();
    // Clear sync picker state on app launch to prevent stale data
    resetSyncPickerState();
  }, []);

  // Handle language change - triggers re-render
  const handleLanguageChange = (langCode) => {
    setCurrentLanguage(langCode);
    console.log('[i18n] Language changed to:', langCode);
  };

  // Initialize Solana when app starts
  useEffect(() => {
    (async () => {
      try {
        await initializeSolana();
        await loadAvailablePlans();
        await refreshSubscriptionStatus();
      } catch (e) {
        console.log('Solana init skipped:', e.message);
      }
    })();
  }, []);

  // Background pre-analysis: silently hash files when user is logged in
  // This speeds up subsequent duplicate scans by having hashes ready
  useEffect(() => {
    if (view !== 'home' || !token) return;
    if (loading) return; // Don't run during active operations
    
    let cancelled = false;
    
    (async () => {
      try {
        // Check media permission first
        const permission = await MediaLibrary.getPermissionsAsync();
        if (permission.status !== 'granted') return;
        
        // Load cache to check what's already hashed
        await loadHashCache();
        const stats = getHashCacheStats();
        console.log(`[HashCache] Pre-analysis check: ${stats.total} cached, ${stats.perceptual} perceptual, ${stats.file} file hashes`);
        
        // Run background pre-analysis with low resource usage
        // This will skip files that are already cached
        if (!cancelled && !isPreAnalysisRunning()) {
          console.log('[HashCache] Starting background pre-analysis...');
          await runBackgroundPreAnalysis({
            resolveReadableFilePath,
            computeFileHash: computeExactFileHash,
            computePerceptualHashes: async (filePath, asset, info) => {
              // Only compute perceptual hash for images (similar scan)
              const { PixelHash } = NativeModules;
              if (!PixelHash?.hashImagePixels) return null;
              try {
                const phash = await PixelHash.hashImagePixels(filePath);
                return phash ? { phash } : null;
              } catch (e) {
                return null;
              }
            },
            batchSize: 3, // Very small batches for low memory
            delayBetweenBatches: 200, // Longer delays for low CPU
            includeVideos: true,
            onProgress: ({ processed, total, cached, errors }) => {
              if (processed > 0 && processed % 50 === 0) {
                console.log(`[HashCache] Pre-analysis: ${processed}/${total} (${cached} already cached, ${errors || 0} errors)`);
              }
            },
          });
        }
      } catch (e) {
        console.log('[HashCache] Pre-analysis error:', e?.message);
      }
    })();
    
    return () => {
      cancelled = true;
      abortPreAnalysis();
    };
  }, [view, token, loading]);

  // Refresh subscription when email changes
  useEffect(() => {
    if (!email) return;
    (async () => {
      try {
        await refreshSubscriptionStatus();
      } catch (e) {
        console.log('Subscription refresh skipped:', e.message);
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
    setProgressAction(null);
    setStatus(t('status.idleWithMode', { mode: fastModeEnabled ? t('settings.fastModeLabel') : t('settings.slowModeLabel') }));
  }, [loading, view, fastModeEnabled]);

  useEffect(() => {
    if (loading && !autoUploadEnabledRef.current) {
      KeepAwake.activateKeepAwakeAsync('photolynk-work');
      return;
    }
    KeepAwake.deactivateKeepAwake('photolynk-work');
  }, [loading]);

  // Background NFT + Certificate sync (runs after auth, polls every 60s)
  useEffect(() => {
    if (!token) return;
    let interval = null;
    const doSync = async () => {
      try {
        const url = getServerUrl();
        if (!url) return;
        let config = await getAuthHeaders();
        let headers = config?.headers || config;
        if (!headers) return;
        try {
          // Sync NFTs from server → local
          await NFTOperations.syncNFTsFromServer(url, headers);
        } catch (e) {
          if (e?.response?.status === 403) {
            console.log('[BGSync] 403 on NFT sync — refreshing token');
            const refreshed = await refreshAuthToken();
            if (refreshed.success && refreshed.headers) {
              headers = refreshed.headers;
              await NFTOperations.syncNFTsFromServer(url, headers);
            } else return;
          } else throw e;
        }
        // Sync certificates from server → local (graceful if endpoint not deployed)
        try { await NFTOperations.syncCertificatesFromServer(url, headers); } catch (_) {}
        // Backup local certs to server (in case minted offline)
        try { await NFTOperations.backupCertificatesToServer(url, headers); } catch (_) {}
      } catch (e) {
        console.log('[BGSync] NFT/cert sync error:', e?.message);
      }
    };
    // Initial sync after delay (let gallery's own sync finish first to avoid concurrent memory pressure)
    const timeout = setTimeout(doSync, 15000);
    // Poll every 5 minutes (60s was too aggressive for 175+ NFTs + 44 certs per cycle)
    interval = setInterval(doSync, 300000);
    return () => { clearTimeout(timeout); if (interval) clearInterval(interval); };
  }, [token]);

  // AppState listener: handles background warnings and auto-upload recovery
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
      if (backgroundWarnEligibleRef.current && loadingRef.current && nextState === 'background') {
        backgroundedAtMsRef.current = Date.now();
        wasBackgroundedDuringWorkRef.current = true;
        setWasBackgroundedDuringWorkSafe(true);
        setShowCompletionTick(false); // Hide checkmark when going to background during work
        return;
      }

      // Try to restart auto-upload runner when app returns to foreground
      if (nextState === 'active') {
        // Skip auto-upload restart when backup picker is open — these functions
        // call setStatus internally which re-renders the entire component tree
        if (!backupPickerOpenRef.current) {
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
        }

        if (!loadingRef.current && !autoUploadNightRunnerActiveRef.current && !backupPickerOpenRef.current) {
          setProgress(0);
          setProgressAction(null);
          setStatus(t('status.idle'));
          // Clear stale background warning flags when app is idle
          wasBackgroundedDuringWorkRef.current = false;
          backgroundWarnEligibleRef.current = false;
          backgroundedAtMsRef.current = 0;
        }
      }

      // iOS: show paused status when backgrounded (Android has foreground service)
      if (Platform.OS === 'ios' && nextState === 'background' && autoUploadEnabledRef.current && serverTypeRef.current === 'stealthcloud') {
        setStatus(t('status.autoBackupPaused'));
      }

      if (nextState === 'active' && wasBackgroundedDuringWorkRef.current) {
        setShowCompletionTick(false); // Hide checkmark when returning to foreground after being backgrounded during work
        const backgroundForMs = backgroundedAtMsRef.current ? (Date.now() - backgroundedAtMsRef.current) : 0;
        const stillWorking = !!loadingRef.current;
        const wasEligible = !!backgroundWarnEligibleRef.current;
        backgroundedAtMsRef.current = 0;

        // Clear refs
        wasBackgroundedDuringWorkRef.current = false;
        backgroundWarnEligibleRef.current = false;
        setWasBackgroundedDuringWorkSafe(false);
        setBackgroundWarnEligibleSafe(false);

        // Only show alert if: still working, was eligible for warning, and was backgrounded long enough
        if (!stillWorking) return;
        if (!wasEligible) return;

        // Ignore short transitions (permission prompts, system UI, Android overlays)
        // Also ignore if backgroundForMs is 0 (timestamp wasn't set properly)
        if (backgroundForMs === 0) return;
        if (Platform.OS === 'android' && backgroundForMs < 3000) return;
        if (Platform.OS === 'ios' && backgroundForMs < 2000) return;

        if (!autoUploadEnabledRef.current) {
          showDarkAlert(t('alerts.processPaused'), t('alerts.processPausedMessage'));
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
      return;
    }
    // Reset to default 100GB when switching to stealthcloud
    if (!selectedStealthPlanGb) {
      setSelectedStealthPlanGb(100);
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
  const STEALTH_SOLD_OUT_MESSAGE = 'Sold out';

  /**
   * Gets the availability status for a StealthCloud plan tier.
   * Checks capacity data to determine if tier can be created.
   * @platform Both
   * @param {number} tierGb - Tier size in GB (100, 200, 400, 1000)
   * @returns {{canCreate: boolean, message: string|null, usageBlocked: boolean}} Tier status
   */
  const getStealthCloudTierStatus = (tierGb) => {
    const capacityStatus = checkTierAvailability(tierGb, stealthCapacity);
    
    // Check if user's current storage usage exceeds this tier's capacity (downgrade protection)
    const usedBytes = stealthUsage?.usedBytes || 0;
    const tierBytes = Number(tierGb) * 1_000_000_000;
    const usageExceedsTier = usedBytes >= tierBytes;
    
    if (usageExceedsTier) {
      return {
        canCreate: false,
        message: 'Storage usage exceeds this plan',
        usageBlocked: true,
      };
    }
    
    return { ...capacityStatus, usageBlocked: false };
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
    setStatus(t('status.coolingDown', { batch: batchCount }));
    console.log(`Thermal: cooling pause after batch ${batchCount}, waiting ${cooldownMs}ms`);
    await sleep(cooldownMs);
  };

  // Poll Info screen every 5s while open to catch late server/RC updates
  const infoRefreshIntervalRef = useRef(null);
  const infoRefreshInFlightRef = useRef(false);
  useEffect(() => {
    const clearPoll = () => {
      if (infoRefreshIntervalRef.current) {
        clearInterval(infoRefreshIntervalRef.current);
        infoRefreshIntervalRef.current = null;
      }
    };
    if (view !== 'info') {
      clearPoll();
      return;
    }

    // Load plans when opening Info screen (in case Solana initialized late)
    (async () => {
      try { await loadAvailablePlans(); } catch (e) {}
    })();

    // Initial non-silent fetch
    (async () => {
      try {
        setStealthUsageLoading(true);
        setStealthUsageError(null);
        await refreshStealthUsage();
      } catch (e) {
        setStealthUsageError(e?.message || 'Usage check failed');
      } finally {
        setStealthUsageLoading(false);
      }
    })();

    const tick = async () => {
      if (infoRefreshInFlightRef.current) return;
      infoRefreshInFlightRef.current = true;
      try {
        await refreshStealthUsage();
      } catch (e) {}
      infoRefreshInFlightRef.current = false;
    };
    infoRefreshIntervalRef.current = setInterval(tick, 5000);
    return () => clearPoll();
  }, [view]);

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
      showDarkAlert(t('alerts.error'), t('alerts.couldNotOpenLink'));
    }
  };

  /**
   * Backs up all photos to StealthCloud with end-to-end encryption.
   * This is the "Backup All" flow for StealthCloud.
   * @platform Both
   */
  const stealthCloudBackup = async () => {
    if (!(await ensureAutoUploadPolicyAllowsWork({ userInitiated: true }))) {
      return;
    }

    await cancelInFlightOperations();
    const opId = currentOperationIdRef.current;
    setLoadingSafe(true);
    setBackgroundWarnEligibleSafe(false); // Don't warn during permission prompts
    setWasBackgroundedDuringWorkSafe(false);
    setProgress(0);
    setProgressAction('backup');

    // Enable background warning only after we start actual work (permission already granted inside core)
    setTimeout(() => { if (loadingRef.current) setBackgroundWarnEligibleSafe(true); }, 2000);

    try {
      const result = await stealthCloudBackupCore({
        getAuthHeaders,
        getServerUrl,
        ensureStealthCloudUploadAllowed,
        // Don't pass ensureAutoUploadPolicyAllowsWorkIfBackgrounded for user-initiated operations
        // This allows the operation to pause when backgrounded and resume when foregrounded
        appStateRef,
        fastMode: fastModeEnabledRef.current,
        onStatus: (s) => setStatusSafe(opId, s),
        onProgress: (p) => setProgressSafe(opId, p),
        abortRef: abortOperationsRef,
      });

      if (result.aborted) {
        return;
      }

      if (result.permissionDenied) {
        showDarkAlert(t('alerts.permissionNeeded'), t('alerts.permissionNeededMessage'));
        return;
      }

      if (result.notAllowed) {
        return;
      }

      if (result.noFiles) {
        setProgress(1);
        setStatus(t('status.noPhotosFound'));
        await sleep(400);
        showCompletionTickBriefly(t('status.noPhotosFound'));
        setProgress(0);
        return;
      }

      const { uploaded, skipped, failed, serverTotal } = result;

      if (uploaded === 0 && skipped === 0 && failed === 0) {
        setProgress(1);
        setStatus(t('status.noPhotosFound'));
        await sleep(400);
        showCompletionTickBriefly(t('status.noPhotosFound'));
        setProgress(0);
        return;
      }

      // All files already exist on server - show count of selected files that were skipped
      if (uploaded === 0 && skipped > 0 && failed === 0) {
        setProgress(1);
        setStatus(t('status.allFilesBackedUp', { count: skipped }));
        await sleep(300);
        showCompletionTickBriefly(t('results.filesOnServer', { count: serverTotal || skipped }));
        setProgress(0);
        return;
      }

      setProgress(1);
      await sleep(300);
      setStatus(t('status.backupComplete'));
      refreshStealthUsage();
      showResultAlert('backup', { uploaded, skipped, failed, serverTotal });
    } catch (e) {
      // Auto re-auth on 403 (token was issued by a different server)
      if (e?.response?.status === 403) {
        console.log('[Auth] 403 during StealthCloud full backup — attempting token refresh');
        const refresh = await refreshAuthToken();
        if (refresh.success) {
          setStatus(t('status.backupRetrying'));
          try {
            const retryResult = await stealthCloudBackupCore({
              getAuthHeaders, getServerUrl, ensureStealthCloudUploadAllowed,
              fastMode: fastModeEnabledRef.current,
              onStatus: (s) => setStatusSafe(opId, s), onProgress: (p) => setProgressSafe(opId, p),
              abortRef: abortOperationsRef,
            });
            if (!retryResult.aborted && !retryResult.notAllowed && !retryResult.permissionDenied && !retryResult.noFiles) {
              const { uploaded, skipped, failed, serverTotal } = retryResult;
              setProgress(1);
              setStatus(t('status.backupComplete'));
              showResultAlert('backup', { uploaded, skipped, failed, serverTotal });
            }
            return;
          } catch (retryErr) {
            console.error('StealthCloud full backup retry failed:', retryErr);
          }
        } else {
          showDarkAlert(t('alerts.sessionExpired'), t('alerts.sessionExpiredRePair'));
        }
      }
      console.error('StealthCloud backup error:', e);
      setStatus(t('status.backupFailed'));
      showResultAlert('backup', { error: e && e.message ? e.message : 'Unknown error' });
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
    await cancelInFlightOperations();
    const opId = currentOperationIdRef.current;
    setLoadingSafe(true);
    setBackgroundWarnEligibleSafe(false); // Don't warn during permission prompts
    setWasBackgroundedDuringWorkSafe(false);
    setProgress(0);
    setProgressAction('sync');
    setStatus(t('status.syncPreparing'));

    const permission = await requestMediaLibraryPermission();
    if (permission.status !== 'granted') {
      showDarkAlert(t('alerts.permissionRequired'), t('alerts.permissionRequiredSync'));
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setWasBackgroundedDuringWorkSafe(false);
      return;
    }
    if (Platform.OS === 'ios' && permission.accessPrivileges && permission.accessPrivileges !== 'all') {
      setStatus(t('status.syncLimitedAccess'));
      showDarkAlert(t('alerts.limitedPhotosAccess'), t('alerts.limitedPhotosAccessMessage'));
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setWasBackgroundedDuringWorkSafe(false);
      return;
    }

    try {
      const restoreHistory = await loadRestoreHistory();
      const config = await getAuthHeaders();
      const SERVER_URL = getServerUrl();
      const masterKey = await getStealthCloudMasterKey();

      // New optimized sync handles local scanning internally
      const result = await stealthCloudRestoreCore({
        config,
        SERVER_URL,
        masterKey,
        resolveReadableFilePath,
        restoreHistory,
        saveRestoreHistory,
        makeHistoryKey,
        manifestIds: opts?.manifestIds || null,
        fastMode: fastModeEnabledRef.current,
        onStatus: (s) => setStatusSafe(opId, s),
        onProgress: (p) => setProgressSafe(opId, p),
        abortRef: abortOperationsRef,
      });

      if (result.aborted) {
        return;
      }

      if (result.noBackups) {
        setProgress(1);
        setStatus(t('status.syncNoFiles'));
        await sleep(400);
        showCompletionTickBriefly(t('status.syncNoFiles'));
        setProgress(0);
        return;
      }

      setProgress(1);
      await sleep(300);
      setStatus(t('status.syncComplete'));
      showResultAlert('sync', { downloaded: result.restored, skipped: result.skipped, failed: result.failed });
    } catch (e) {
      // Auto re-auth on 403 (token was issued by a different server)
      if (e?.response?.status === 403) {
        console.log('[Auth] 403 during StealthCloud restore — attempting token refresh');
        const refresh = await refreshAuthToken();
        if (refresh.success) {
          setStatus(t('status.syncRetrying'));
          try {
            const retryConfig = await getAuthHeaders();
            const retryResult = await stealthCloudRestoreCore({
              config: retryConfig, SERVER_URL: getServerUrl(), masterKey: await getStealthCloudMasterKey(),
              resolveReadableFilePath, restoreHistory: await loadRestoreHistory(), saveRestoreHistory, makeHistoryKey,
              manifestIds: opts?.manifestIds || null, fastMode: fastModeEnabledRef.current,
              onStatus: (s) => setStatusSafe(opId, s), onProgress: (p) => setProgressSafe(opId, p),
              abortRef: abortOperationsRef,
            });
            if (!retryResult.aborted) {
              setProgress(1);
              setStatus(t('status.syncComplete'));
              showResultAlert('sync', { downloaded: retryResult.restored, skipped: retryResult.skipped, failed: retryResult.failed });
            }
            return;
          } catch (retryErr) {
            console.error('StealthCloud restore retry failed:', retryErr);
          }
        } else {
          showDarkAlert(t('alerts.sessionExpired'), t('alerts.sessionExpiredRePair'));
        }
      }
      console.error('StealthCloud restore error:', e);
      setStatus(t('status.syncFailed'));
      showResultAlert('sync', { error: e && e.message ? e.message : 'Unknown error' });
    } finally {
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setProgress(0);
    }
  };

  const getServerUrl = () => computeServerUrl(serverType, localHost, remoteHost);

  // Network connectivity check for backup/sync operations
  const checkNetworkForOperation = async (operationType = 'backup') => {
    try {
      const networkState = await Network.getNetworkStateAsync();
      
      // For NFT operations - need internet
      if (operationType === 'nft') {
        if (!networkState.isConnected || !networkState.isInternetReachable) {
          showDarkAlert(t('alerts.noInternet') || 'No Internet', t('alerts.noInternetMessage') || 'Internet connection is required to create NFTs. Please check your connection and try again.');
          return false;
        }
        return true;
      }
      
      // Read from SecureStore to get the most up-to-date values (state may lag after QR pairing)
      const effectiveServerType = serverType || (await SecureStore.getItemAsync('server_type')) || 'local';
      const effectiveLocalHost = localHost || (await SecureStore.getItemAsync('local_host'));
      const effectiveRemoteHost = remoteHost || (await SecureStore.getItemAsync('remote_host'));
      
      // For local/remote server - check local network
      if (effectiveServerType === 'local' || effectiveServerType === 'remote') {
        if (!networkState.isConnected) {
          showDarkAlert(t('alerts.noNetwork') || 'No Network Connection', t('alerts.noLocalNetworkMessage') || 'Cannot connect to your desktop app. Please ensure you are on the same network as your PhotoLynk Server or pair via QR code in the Settings tab.');
          return false;
        }
        // Try to ping the server
        try {
          const SERVER_URL = computeServerUrl(effectiveServerType, effectiveLocalHost, effectiveRemoteHost);
          if (!SERVER_URL || SERVER_URL.includes('localhost')) {
            // No server configured yet - skip check and let the actual operation handle the error
            return true;
          }
          await axios.get(`${SERVER_URL}/api/health`, { timeout: 5000 });
          return true;
        } catch (e) {
          showDarkAlert(t('alerts.noNetwork') || 'No Network Connection', t('alerts.noLocalNetworkMessage') || 'Cannot connect to your desktop app. Please ensure you are on the same network as your PhotoLynk Server or pair via QR code in the Settings tab.');
          return false;
        }
      }
      
      // For StealthCloud - need internet, retry for 3 minutes
      if (effectiveServerType === 'stealthcloud') {
        const maxRetryMs = 3 * 60 * 1000; // 3 minutes
        const retryIntervalMs = 5000; // 5 seconds
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxRetryMs) {
          const state = await Network.getNetworkStateAsync();
          if (state.isConnected && state.isInternetReachable) {
            // Try to reach the server
            try {
              const SERVER_URL = getServerUrl();
              await axios.get(`${SERVER_URL}/api/health`, { timeout: 10000 });
              return true;
            } catch (e) {
              // Server not reachable, continue retrying
            }
          }
          
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const remaining = Math.ceil((maxRetryMs - (Date.now() - startTime)) / 1000);
          setStatus(t('status.connecting') || `Connecting... (${remaining}s remaining)`);
          
          await new Promise(r => setTimeout(r, retryIntervalMs));
        }
        
        // After 3 minutes, show popup
        setStatus('');
        showDarkAlert(t('alerts.noConnection') || 'No Connection Available', t('alerts.noConnectionMessage') || 'Could not connect to StealthCloud after multiple attempts. Please check your internet connection and try again.');
        return false;
      }
      
      return true;
    } catch (e) {
      console.log('Network check error:', e);
      return true; // Allow operation to proceed if check fails
    }
  };

  const checkLogin = async () => {
    try {
    // Detect first launch after reinstall and clear old credentials
    const isFirstLaunchAfterReinstall = await checkFirstLaunchAfterReinstall();

    // Load server settings using helper
    const serverSettings = await loadServerSettings();
    if (serverSettings.savedType) setServerType(serverSettings.savedType);
    if (serverSettings.savedLocalHost) setLocalHost(serverSettings.savedLocalHost);
    if (serverSettings.normalizedRemoteHost) setRemoteHost(serverSettings.normalizedRemoteHost);

    // Restore saved Auto Upload state
    // Feature is currently disabled: force OFF even if previously enabled.
    const savedAutoUpload = await SecureStore.getItemAsync('auto_upload_enabled');
    if (AUTO_UPLOAD_FEATURE_ENABLED && savedAutoUpload === 'true') {
      setAutoUploadEnabledSafe(true);
    } else {
      setAutoUploadEnabledSafe(false);
      try { await SecureStore.setItemAsync('auto_upload_enabled', 'false'); } catch (e) {}
    }

    const savedFastMode = await SecureStore.getItemAsync('fast_mode_enabled');
    // Only restore user preference for stealthcloud; local/remote always fast
    if (savedFastMode === 'false' && serverTypeRef.current === 'stealthcloud') {
      setFastModeEnabledSafe(false);
    } else {
      setFastModeEnabledSafe(true);
    }

    const savedGlassMode = await SecureStore.getItemAsync('glass_mode_enabled');
    if (savedGlassMode === 'true' || savedGlassMode === 'false') {
      setGlassModeEnabled(savedGlassMode === 'true');
    }

    // If first launch after reinstall, skip auto-login and show register screen
    if (isFirstLaunchAfterReinstall) {
      console.log('[FirstLaunch] Skipping auto-login - showing register screen');
      setIsFirstRun(true);
      setAuthMode('register');
      setStatus('');
      setView('auth');
      return;
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
      // Fall back to the cached value so Info always shows the Device ID.
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

    // Best practice flow:
    // 1. If token exists AND is valid -> auto-login with biometric for master key
    // 2. If no token BUT credentials exist -> biometric re-auth to generate new token
    // 3. If no token AND no credentials -> manual login (first run/reinstall)

    const baseUrl = computeServerUrl(
      serverType || serverSettings.savedType || 'local',
      serverSettings.savedLocalHost || localHost,
      serverSettings.normalizedRemoteHost || remoteHost
    );

    // Case 1: Valid token exists - validate and auto-login
    if (storedToken && storedEmail) {
      const validationResult = await validateToken({
        storedToken,
        storedEmail,
        storedUserId,
        uuid,
        baseUrl,
        onStatus: setStatus,
      });

      if (validationResult.success) {
        // Token valid or network error with offline access
        if (validationResult.savedPassword) {
          setStatus(t('status.securingSession'));
          await cacheStealthCloudMasterKey(storedEmail, validationResult.savedPassword);
        }
        setTokenSafe(storedToken);
        if (storedUserId) setUserId(parseInt(storedUserId));
        if (storedEmail && !email) setEmail(storedEmail);
        setStatus('');
        setView('home');
        return;
      }
      // Token invalid - fall through to Case 2
    }

    // Case 2: No valid token but credentials exist - biometric re-auth
    const reauthResult = await attemptBiometricReauth({
      storedEmail,
      baseUrl,
      getDeviceUUID,
      onStatus: setStatus,
    });

    if (reauthResult.biometricCancelled) {
      console.log('[Auth] Showing login screen after biometric cancel');
      if (storedEmail && !email) setEmail(storedEmail);
      setStatus('');
      setView('auth');
      return;
    }

    if (reauthResult.success) {
      if (reauthResult.deviceId) setDeviceUuid(reauthResult.deviceId);
      if (reauthResult.userId) setUserId(reauthResult.userId);
      if (storedEmail && !email) setEmail(storedEmail);

      setStatus(t('status.securingSession'));
      await cacheStealthCloudMasterKey(storedEmail, reauthResult.savedPassword);

      setTokenSafe(reauthResult.token);
      setStatus('');
      setView('home');
      return;
    }

    // Case 3: No token and no credentials - require manual login
    if (storedEmail && !email) setEmail(storedEmail);
    console.log('No valid session - requiring manual login');
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
  const handleAuth = async (type, opts = {}) => {
    // Allow passing credentials directly for relogin (state updates are async)
    const effectiveEmail = opts.email || email;
    const effectivePassword = opts.password || password;
    const requestedServerType = (opts && (opts.serverType || opts.serverTypeOverride)) || serverType;
    
    console.log('handleAuth called:', type);
    console.log('Email:', effectiveEmail, 'Password:', effectivePassword ? '***' : 'empty');

    if (!effectiveEmail || !effectivePassword) {
      showDarkAlert(t('alerts.error'), t('alerts.fillAllFields'));
      return;
    }

    const normalizedEmail = normalizeEmailForDeviceUuid(effectiveEmail);
    if (!normalizedEmail) {
      showDarkAlert(t('alerts.error'), t('alerts.invalidEmail'));
      return;
    }

    if (type === 'register') {
      if (!confirmPassword) {
        showDarkAlert(t('alerts.error'), t('alerts.confirmPasswordRequired'));
        return;
      }
      if (effectivePassword !== confirmPassword) {
        showDarkAlert(t('alerts.error'), t('alerts.passwordsDoNotMatch'));
        return;
      }
      // For Local/Remote registration, require server address and show Quick Setup if missing
      if (requestedServerType === 'local' && !localHost) {
        setQuickSetupCollapsed(false);
        setQuickSetupHighlightInput(true);
        return;
      }
      if (requestedServerType === 'remote' && !remoteHost) {
        setQuickSetupCollapsed(false);
        setQuickSetupHighlightInput(true);
        return;
      }
    }

    // For login, also require server address for Local/Remote
    if (type === 'login') {
      if (requestedServerType === 'local' && !localHost) {
        setQuickSetupCollapsed(false);
        setQuickSetupHighlightInput(true);
        return;
      }
      if (requestedServerType === 'remote' && !remoteHost) {
        setQuickSetupCollapsed(false);
        setQuickSetupHighlightInput(true);
        return;
      }
    }

    Keyboard.dismiss();
    setLoadingSafe(true);
    resetAuthLoadingLabel(loginStatusTimerRef, loginLabelTimerRef, setAuthLoadingLabel, type === 'register' ? t('auth.creatingAccount') : t('auth.signingIn'));

    try {
      // Step 1: Bonding device
      setAuthLoadingLabel(t('auth.bondingDevice'));
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Resolve and persist effective server settings
      const { effectiveType, effectiveLocalHost, effectiveRemoteHost } = await resolveEffectiveServerSettings({
        serverType: requestedServerType, localHost, remoteHost
      });
      await persistServerSettings({ effectiveType, effectiveLocalHost, effectiveRemoteHost });

      // Ensure in-memory state matches what we used.
      if (serverType !== effectiveType) setServerType(effectiveType);
      if (effectiveType === 'local' && localHost !== effectiveLocalHost) setLocalHost(effectiveLocalHost);
      if (effectiveType === 'remote' && remoteHost !== effectiveRemoteHost) setRemoteHost(effectiveRemoteHost);

      // Device UUID is derived from email+password and persisted.
      const deviceId = await getDeviceUUID(normalizedEmail, effectivePassword);
      await new Promise(resolve => setTimeout(resolve, 200));
      if (!deviceId) {
        showDarkAlert(t('alerts.deviceIdUnavailable'), t('alerts.deviceIdUnavailableMessage'));
        setLoadingSafe(false);
        return;
      }
      setDeviceUuid(deviceId);

      // Plan selection is mandatory for StealthCloud registration (7-day free trial)
      if (type === 'register' && effectiveType === 'stealthcloud' && !selectedStealthPlanGb) {
        showDarkAlert(t('alerts.selectPlan'), t('alerts.selectPlanMessage'));
        setLoadingSafe(false);
        return;
      }
      const endpoint = type === 'register' ? '/api/register' : '/api/login';
      const authBaseUrl = computeServerUrl(effectiveType, effectiveLocalHost, effectiveRemoteHost);

      // Build auth payload with hardware device ID for registration
      let hardwareDeviceId = null;
      if (type === 'register') {
        hardwareDeviceId = await getHardwareDeviceId();
      }
      const payload = await buildAuthPayload({
        type,
        normalizedEmail,
        password: effectivePassword,
        deviceId,
        effectiveType,
        selectedStealthPlanGb,
        hardwareDeviceId,
      });

      const authUrl = authBaseUrl + endpoint;
      console.log('Auth request:', {
        type,
        effectiveType,
        authUrl,
        localHost: effectiveLocalHost,
        remoteHost: effectiveRemoteHost,
        platform: Platform.OS,
      });

      // iOS Local Network Permission: Pre-trigger permission and wait for it to be granted
      // iOS doesn't immediately grant network access after user taps "Allow" - need to retry
      if (Platform.OS === 'ios' && (effectiveType === 'local' || effectiveType === 'remote')) {
        setAuthLoadingLabel(t('auth.checkingNetwork'));
        const healthUrl = authBaseUrl + '/api/health';
        let networkReady = false;
        
        // Try up to 5 times with 1 second delay - gives user time to respond to popup
        // and allows iOS to fully enable network access after permission is granted
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await axios.head(healthUrl, { timeout: 3000 });
            networkReady = true;
            console.log('[Auth] Network access confirmed on attempt', attempt + 1);
            break;
          } catch (e) {
            console.log('[Auth] Network check attempt', attempt + 1, 'failed:', e?.message || 'unknown');
            // Wait before retry - gives user time to tap "Allow" on permission popup
            if (attempt < 4) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }
        
        if (!networkReady) {
          console.log('[Auth] Network pre-check failed after 5 attempts, proceeding anyway');
        }
      }

      // Step 2: Generating token / Authenticating with retry for StealthCloud
      setAuthLoadingLabel(type === 'register' ? t('auth.generatingToken') : t('auth.authenticating'));
      await new Promise(resolve => setTimeout(resolve, 500));

      // StealthCloud retry logic with rotating status messages (server may be rebooting ~2-3 min)
      const STEALTHCLOUD_MAX_RETRIES = 20; // ~3+ minutes of retries
      const STEALTHCLOUD_RETRY_DELAY_MS = 10000; // 10 seconds between retries
      const STEALTHCLOUD_RETRY_MESSAGES = [
        t('auth.connecting'),
        t('auth.establishingConnection'),
        t('auth.reachingStealthCloud'),
        t('auth.waitingForServer'),
        t('auth.retryingConnection'),
        t('auth.stillConnecting'),
        t('common.pleaseWait'),
        t('auth.almostThere'),
      ];

      let res;
      let lastNetworkError = null;

      if (effectiveType === 'stealthcloud') {
        for (let attempt = 0; attempt < STEALTHCLOUD_MAX_RETRIES; attempt++) {
          try {
            res = await axios.post(authUrl, payload, { timeout: 15000 });
            lastNetworkError = null;
            break; // Success - exit retry loop
          } catch (err) {
            // Check if it's a retryable error:
            // - Network errors (no response)
            // - 5xx server errors (server down, Cloudflare 530, etc.)
            const status = err.response?.status;
            const isServerError = status && status >= 500 && status < 600;
            const isNetworkError = !err.response;
            
            // 4xx errors are client errors - don't retry (wrong password, etc.)
            if (err.response && !isServerError) {
              throw err;
            }
            
            // Retryable error - retry with rotating status message
            lastNetworkError = err;
            const msgIndex = attempt % STEALTHCLOUD_RETRY_MESSAGES.length;
            setAuthLoadingLabel(STEALTHCLOUD_RETRY_MESSAGES[msgIndex]);
            console.log(`StealthCloud connection attempt ${attempt + 1}/${STEALTHCLOUD_MAX_RETRIES} failed:`, 
              isServerError ? `HTTP ${status}` : err?.message);
            
            if (attempt < STEALTHCLOUD_MAX_RETRIES - 1) {
              await new Promise(resolve => setTimeout(resolve, STEALTHCLOUD_RETRY_DELAY_MS));
            }
          }
        }
        
        // If all retries failed, throw the last error
        if (lastNetworkError && !res) {
          throw lastNetworkError;
        }
      } else {
        // Local/Remote - no retry, fail immediately (15s timeout)
        res = await axios.post(authUrl, payload, { timeout: 15000 });
      }
      await new Promise(resolve => setTimeout(resolve, 200));

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

        // Check if credentials changed - if so, clear old session data first
        const previousEmail = await SecureStore.getItemAsync(SAVED_PASSWORD_EMAIL_KEY).catch(() => null);
        const credentialsChanged = previousEmail && previousEmail !== normalizedEmail;

        if (credentialsChanged) {
          // Clear old session data when switching accounts
          await clearStealthCloudMasterKeyCache();
          setStealthUsage(null);
          setStealthUsageError(null);
          setStealthUsageLoading(false);
        }

        // Step 3: Securing credentials
        setAuthLoadingLabel(t('auth.securingCredentials'));
        await new Promise(resolve => setTimeout(resolve, 1000));

        await SecureStore.setItemAsync('auth_token', token);
        await SecureStore.setItemAsync('user_email', normalizedEmail);

        // Store password with biometrics
        await storeCredentialsWithBiometrics({ password: effectivePassword, normalizedEmail, type: 'login' });
        if (userId) {
          await SecureStore.setItemAsync('user_id', String(userId));
          setUserId(userId);
        }

        // Step 4: Finalizing (cache master key)
        setAuthLoadingLabel(t('common.finalizing'));
        await cacheStealthCloudMasterKey(normalizedEmail, effectivePassword);
        await new Promise(resolve => setTimeout(resolve, 500));

        setTokenSafe(token);

        // Restore saved Auto Upload state after login
        // Feature is currently disabled: force OFF even if previously enabled.
        const savedAutoUpload = await SecureStore.getItemAsync('auto_upload_enabled');
        if (AUTO_UPLOAD_FEATURE_ENABLED && savedAutoUpload === 'true') {
          setAutoUploadEnabledSafe(true);
        } else {
          setAutoUploadEnabledSafe(false);
          try { await SecureStore.setItemAsync('auto_upload_enabled', 'false'); } catch (e) {}
        }

        // Clear logout flag on successful login
        await SecureStore.deleteItemAsync('user_logged_out');

        setAuthMode('login');
        setView('home');
      } else {
        // Registration successful - auto-login immediately
        // Store credentials with biometrics and get token
        const { token, userId } = res.data;

        // Step 3: Securing credentials
        setAuthLoadingLabel(t('auth.securingCredentials'));
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Store token
        await SecureStore.setItemAsync('auth_token', token);
        await SecureStore.setItemAsync('user_email', normalizedEmail);

        // Store password with biometrics for future auto-login
        await storeCredentialsWithBiometrics({ password: effectivePassword, normalizedEmail, type: 'register' });

        if (userId) {
          await SecureStore.setItemAsync('user_id', String(userId));
          setUserId(userId);
        }

        // Step 4: Finalizing (cache master key)
        setAuthLoadingLabel(t('common.finalizing'));
        await cacheStealthCloudMasterKey(normalizedEmail, effectivePassword);
        await new Promise(resolve => setTimeout(resolve, 500));

        setTokenSafe(token);
        setConfirmPassword('');
        setAuthMode('login');

        // Clear logout flag on successful registration
        await SecureStore.deleteItemAsync('user_logged_out');

        // Navigate to home immediately (same as login flow)
        setView('home');

        // Show success message after navigation
        showDarkAlert(
          t('alerts.accountCreated'),
          t('alerts.accountCreatedMessage'),
          [{ text: t('alerts.getStarted') }]
        );
      }
    } catch (error) {
      // Only log actual server errors, not Metro bundler noise
      if (error.response) {
        const status = error.response.status;
        console.error('Auth Error:', status, error.response.data);
        
        // 429 - Rate limited
        if (status === 429) {
          showDarkAlert(
            t('alerts.tooManyAttempts'),
            t('alerts.tooManyAttemptsMessage')
          );
        // 5xx errors after retries exhausted - server is down
        } else if (status >= 500 && status < 600 && serverType === 'stealthcloud') {
          showDarkAlert(
            t('alerts.serverUnavailable'),
            t('alerts.serverUnavailableMessage')
          );
        } else {
          // Map known server error messages to translations
          const serverError = error.response?.data?.error;
          let translatedError = t('alerts.connectionFailed');
          if (serverError) {
            const errorLower = serverError.toLowerCase();
            if (errorLower.includes('invalid credentials') || errorLower.includes('invalid password') || errorLower.includes('wrong password')) {
              translatedError = t('alerts.invalidCredentials');
            } else if (errorLower.includes('user not found') || errorLower.includes('no user')) {
              translatedError = t('alerts.userNotFound');
            } else if (errorLower.includes('email already') || errorLower.includes('already registered')) {
              translatedError = t('alerts.emailAlreadyRegistered');
            } else {
              translatedError = serverError;
            }
          }
          showDarkAlert(t('alerts.error'), translatedError);
        }
      } else if (error.request) {
        console.error('Network Error - cannot reach server', {
          message: error?.message,
          code: error?.code,
          url: error?.config?.url,
          method: error?.config?.method,
          baseURL: error?.config?.baseURL,
        });
        let message;
        if (serverType === 'stealthcloud') {
          message = t('alerts.cannotReachStealthCloud');
        } else if (serverType === 'remote') {
          message = t('alerts.cannotReachRemote');
        } else {
          message = t('alerts.cannotReachLocal');
        }
        showDarkAlert(t('alerts.connectionFailed'), message);
      }
    } finally {
      resetAuthLoadingLabel(loginStatusTimerRef, loginLabelTimerRef, setAuthLoadingLabel, t('auth.signingIn'));
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setWasBackgroundedDuringWorkSafe(false);
    }
  };

  /**
   * Device-bound password reset using hardware device ID
   * Allows password reset if the user is on the same physical device that created the account.
   */
  const handleResetPassword = async () => {
    if (!email || !newPassword) {
      showDarkAlert(t('alerts.error'), t('alerts.enterEmailAndPassword'));
      return;
    }

    Keyboard.dismiss();
    setLoadingSafe(true);
    setAuthLoadingLabel(t('auth.verifyingDevice'));

    try {
      const result = await performDevicePasswordReset({
        email,
        newPassword,
        serverType,
        localHost,
        remoteHost,
      });

      if (!result.success) {
        if (result.hint === 'device_mismatch') {
          showDarkAlert(t('alerts.differentDevice'), t('alerts.differentDeviceMessage'));
        } else if (result.hint === 'no_hardware_id_stored') {
          showDarkAlert(t('alerts.featureNotAvailable'), t('alerts.featureNotAvailableMessage'));
        } else {
          showDarkAlert(t('alerts.error'), result.error);
        }
        return;
      }

      showDarkAlert(t('alerts.success'), t('alerts.passwordResetSuccess'));
      setPassword(newPassword);
      setAuthMode('login');
      setNewPassword('');
    } finally {
      setLoadingSafe(false);
      setAuthLoadingLabel(t('auth.signingIn'));
    }
  };

  /**
   * Scans device for exact duplicate photos using pixel-based hashing.
   * Uses DuplicateScanner module for the heavy lifting.
   * @platform Both
   */
  const cleanDeviceDuplicates = async () => {
    await cancelInFlightOperations();
    const opId = currentOperationIdRef.current;
    setBackgroundWarnEligibleSafe(false); // Don't warn during permission prompts
    setWasBackgroundedDuringWorkSafe(false);
    setLoadingSafe(true);
    setProgress(0);
    setProgressAction('cleanup');
    setStatus(t('status.comparingPreparing'));

    // Enable background warning only after we start actual work (permission already granted inside core)
    setTimeout(() => { if (loadingRef.current) setBackgroundWarnEligibleSafe(true); }, 2000);

    try {
      const result = await startExactDuplicatesScanCore({
        resolveReadableFilePath,
        onStatus: (s) => setStatusSafe(opId, s),
        onProgress: (p) => setProgressSafe(opId, p),
        t,
        abortRef: abortOperationsRef,
      });

      if (result.aborted) {
        return;
      }

      if (result.error) {
        if (result.error.includes('Limited')) {
          showDarkAlert(t('alerts.limitedPhotosAccess'), t('alerts.limitedPhotosAccessClean'));
        } else if (result.error.includes('permission')) {
          showDarkAlert(t('alerts.permissionNeeded'), t('alerts.permissionNeededDuplicates'));
        } else {
          showDarkAlert(t('alerts.error'), result.error);
        }
        return;
      }

      if (result.noAssets) {
        showDarkAlert(t('alerts.noMedia'), t('alerts.noMediaMessage'));
        return;
      }

      if (result.noDuplicates) {
        setStatus(t('status.noIdenticalPhotos'));
        await sleep(400); // Let user see 100% before checkmark
        showCompletionTickBriefly(t('results.noIdenticalFiles'));
        return;
      }

      const DuplicateScanner = require('./duplicateScanner').default;
      const duplicateCount = DuplicateScanner.countDuplicates(result.groups);

      setDuplicateReview({
        mode: 'pixel-hash',
        duplicateCount: result.totalDuplicates,
        groupCount: result.groups.length,
        groups: result.groups
      });

      setStatus(t('status.foundDuplicates', { count: result.totalDuplicates, groups: result.groups.length }));
    } catch (error) {
      console.error('Clean duplicates error:', error);
      setStatus(t('status.errorDuringCleanup', { message: error.message }));
      showDarkAlert(t('alerts.error'), error.message);
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

    // Signal all running operations to abort immediately
    abortOperationsRef.current = true;
    currentOperationIdRef.current += 1; // Invalidate all previous operation callbacks

    // Show signing out spinner
    setLoadingSafe(true);
    setAuthLoadingLabel(t('auth.signingOut'));

    // Use core logout logic from authHelpers
    await logoutCore({ forgetCredentials });

    // Always clear cached master key on logout
    await clearStealthCloudMasterKeyCache();

    // Clear StealthCloud usage data so it re-fetches on next login
    setStealthUsage(null);
    setStealthUsageError(null);
    setStealthUsageLoading(false);

    setTokenSafe(null);
    setUserId(null);
    setDeviceUuid(null);
    setPassword('');
    
    // Reset progress state BEFORE changing view to prevent blue flash
    setProgress(0);
    setProgressAction(null);
    setStatus(t('status.idle'));
    setLoadingSafe(false);
    
    // Change view last
    setView('auth');
    setAuthLoadingLabel(t('auth.signingIn'));
    
    // DO NOT reset abort flag here - it must stay true until user starts a new operation
    // The abort flag will be reset by cancelInFlightOperations when a new operation starts
  };

  /**
   * Re-login with stored credentials to get a fresh JWT token for the current server.
   * Called automatically when a 403 (invalid token) is received during operations.
   * This handles the case where the stored token was issued by a different server
   * (e.g. StealthCloud token used against local server, or vice versa).
   * @returns {Promise<{success: boolean, headers?: Object, message?: string}>}
   */
  const refreshAuthToken = async () => {
    try {
      const se = await SecureStore.getItemAsync('user_email');
      // Read password without triggering biometric — this runs during backup/sync 403 retry
      let sp = null;
      try {
        sp = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY, { requireAuthentication: false });
      } catch (e) { /* ignore */ }
      if (!se || !sp) {
        return { success: false, message: 'no_credentials' };
      }
      const SERVER_URL = getServerUrl();
      if (!SERVER_URL) {
        return { success: false, message: 'no_server' };
      }
      const did = await getDeviceUUID(se, sp);
      const lr = await axios.post(`${SERVER_URL}/api/login`, {
        email: se,
        password: sp,
        device_uuid: did,
        device_name: Platform.OS + ' ' + Platform.Version,
      }, { timeout: 15000 });
      if (lr.data?.token) {
        await SecureStore.setItemAsync('auth_token', lr.data.token);
        setTokenSafe(lr.data.token);
        setDeviceUuid(did);
        console.log('[Auth] Token refreshed for', SERVER_URL);
        return {
          success: true,
          headers: {
            'Authorization': `Bearer ${lr.data.token}`,
            'X-Device-UUID': did,
            'X-Client-Build': CLIENT_BUILD,
          },
        };
      }
      return { success: false, message: 'no_token_in_response' };
    } catch (e) {
      console.log('[Auth] Token refresh failed:', e?.response?.status || e?.message);
      return { success: false, message: e?.message || 'refresh_failed' };
    }
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

    await cancelInFlightOperations();
    const opId = currentOperationIdRef.current;
    setLoadingSafe(true);
    setBackgroundWarnEligibleSafe(false); // Don't warn during permission prompts
    setWasBackgroundedDuringWorkSafe(false);
    setProgress(0);
    setProgressAction('backup');

    // Enable background warning only after we start actual work (permission already granted inside core)
    setTimeout(() => { if (loadingRef.current) setBackgroundWarnEligibleSafe(true); }, 2000);

    try {
      const result = await localRemoteBackupCore({
        getAuthHeaders,
        getServerUrl,
        resolveReadableFilePath,
        appStateRef, // Pass appStateRef so upload can pause when backgrounded
        fastMode: fastModeEnabledRef.current,
        onStatus: (s) => setStatusSafe(opId, s),
        onProgress: (p) => setProgressSafe(opId, p),
        t,
      });

      if (result.permissionDenied) {
        showDarkAlert(t('alerts.permissionNeeded'), t('alerts.permissionNeededMessage'));
        setStatus('');
        return;
      }

      if (result.limitedAccess) {
        setStatus(t('status.limitedPhotosAccess'));
        showDarkAlert(
          t('alerts.limitedPhotosAccess'),
          t('alerts.limitedPhotosAccessMessage')
        );
        return;
      }

      if (result.noFiles) {
        setProgress(1);
        setStatus(t('status.noPhotosFound'));
        await sleep(400);
        showCompletionTickBriefly(t('status.noPhotosFound'));
        setProgress(0);
        return;
      }

      if (result.noFilesToBackup) {
        setProgress(1);
        setStatus(t('status.noFilesToBackup'));
        await sleep(400);
        showCompletionTickBriefly(t('status.noFilesToBackup'));
        setProgress(0);
        return;
      }

      if (result.alreadyBackedUp) {
        setProgress(1); // Show 100% before checkmark
        setStatus(t('status.allFilesBackedUp', { count: result.serverTotal || result.checkedCount }));
        await sleep(400); // Brief pause to show 100%
        showCompletionTickBriefly(t('results.filesOnServer', { count: result.serverTotal || result.checkedCount }));
        setProgress(0);
        return;
      }

      const { uploaded, skipped, failed, serverTotal } = result;
      setProgress(1); // Show 100% before checkmark
      setStatus(t('status.backupComplete'));
      refreshStealthUsage();
      await sleep(400); // Brief pause to show 100%
      showResultAlert('backup', { uploaded, skipped, failed, serverTotal });
      setProgress(0);
    } catch (error) {
      // Auto re-auth on 403 (token was issued by a different server)
      if (error?.response?.status === 403) {
        console.log('[Auth] 403 during local/remote full backup — attempting token refresh');
        const refresh = await refreshAuthToken();
        if (refresh.success) {
          setStatus(t('status.backupRetrying'));
          try {
            const retryResult = await localRemoteBackupCore({
              getAuthHeaders, getServerUrl, resolveReadableFilePath,
              appStateRef, fastMode: fastModeEnabledRef.current,
              onStatus: (s) => setStatusSafe(opId, s), onProgress: (p) => setProgressSafe(opId, p),
              t,
            });
            if (!retryResult.permissionDenied && !retryResult.noFiles && !retryResult.noFilesToBackup) {
              const { uploaded, skipped, failed, serverTotal } = retryResult;
              setProgress(1);
              setStatus(t('status.backupComplete'));
              showResultAlert('backup', { uploaded, skipped, failed, serverTotal });
              setProgress(0);
            }
            return;
          } catch (retryErr) {
            console.error('Local/remote full backup retry failed:', retryErr);
          }
        } else {
          showDarkAlert(t('alerts.sessionExpired'), t('alerts.sessionExpiredRePair'));
        }
      }
      console.error(error);
      setStatus(t('status.backupFailed'));
      setProgress(0);
      showResultAlert('backup', { error: error && error.message ? error.message : 'Unknown error' });
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

    await cancelInFlightOperations();
    const opId = currentOperationIdRef.current;
    setStatus(t('status.syncPreparing'));
    setProgress(0);
    setProgressAction('sync');
    setLoadingSafe(true);
    setBackgroundWarnEligibleSafe(false); // Don't warn during permission prompts
    setWasBackgroundedDuringWorkSafe(false);

    const permission = await requestMediaLibraryPermission();
    if (permission.status !== 'granted') {
      showDarkAlert(t('alerts.permissionRequired'), t('alerts.permissionRequiredSync'));
      setLoadingSafe(false);
      setStatus('');
      setBackgroundWarnEligibleSafe(false);
      setProgressAction(null);
      setWasBackgroundedDuringWorkSafe(false);
      return;
    }

    if (Platform.OS === 'ios' && permission.accessPrivileges && permission.accessPrivileges !== 'all') {
      setStatus(t('status.syncLimitedAccess'));
      showDarkAlert(
        t('alerts.limitedPhotosAccess'),
        t('alerts.limitedPhotosAccessMessage')
      );
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setWasBackgroundedDuringWorkSafe(false);
      setProgress(0);
      return;
    }

    setBackgroundWarnEligibleSafe(true);
    setWasBackgroundedDuringWorkSafe(false);

    try {
      const config = await getAuthHeaders();
      const SERVER_URL = getServerUrl();

      // New optimized sync handles local scanning internally
      const result = await localRemoteRestoreCore({
        config,
        SERVER_URL,
        resolveReadableFilePath,
        onlyFilenames: opts?.onlyFilenames || null,
        fastMode: fastModeEnabledRef.current,
        onStatus: (s) => setStatusSafe(opId, s),
        onProgress: (p) => setProgressSafe(opId, p),
        abortRef: abortOperationsRef,
        appStateRef, // Pass appStateRef so sync can pause when backgrounded
      });

      if (result.noFiles) {
        setProgress(1);
        setStatus(t('status.syncNoFiles'));
        await sleep(400);
        showCompletionTickBriefly(t('status.syncNoFiles'));
        setProgress(0);
        return;
      }

      if (result.allSynced) {
        setProgress(1);
        setStatus(t('status.allFilesSynced', { count: result.serverTotal }));
        await sleep(800);
        showCompletionTickBriefly(t('results.filesOnDevice', { count: result.serverTotal }));
        await sleep(500);
        setProgress(0);
        return;
      }

      setStatus(t('status.syncComplete'));
      setProgress(0);
      showResultAlert('sync', { downloaded: result.restored, skipped: result.skipped, failed: result.failed });
      resetSyncPickerState();

    } catch (error) {
      // Auto re-auth on 403 (token was issued by a different server)
      if (error?.response?.status === 403) {
        console.log('[Auth] 403 during local/remote restore — attempting token refresh');
        const refresh = await refreshAuthToken();
        if (refresh.success) {
          setStatus(t('status.syncRetrying'));
          try {
            const retryConfig = await getAuthHeaders();
            const retryResult = await localRemoteRestoreCore({
              config: retryConfig, SERVER_URL: getServerUrl(), resolveReadableFilePath,
              onlyFilenames: opts?.onlyFilenames || null, fastMode: fastModeEnabledRef.current,
              onStatus: (s) => setStatusSafe(opId, s), onProgress: (p) => setProgressSafe(opId, p),
              abortRef: abortOperationsRef, appStateRef,
            });
            if (!retryResult.noFiles) {
              setStatus(t('status.syncComplete'));
              showResultAlert('sync', { downloaded: retryResult.restored, skipped: retryResult.skipped, failed: retryResult.failed });
            }
            return;
          } catch (retryErr) {
            console.error('Local/remote restore retry failed:', retryErr);
          }
        } else {
          showDarkAlert(t('alerts.sessionExpired'), t('alerts.sessionExpiredRePair'));
        }
      }
      console.error('Restore error:', error);
      setStatus(t('status.syncFailed'));
      setProgress(0);
      showResultAlert('sync', { error: error.message });
    } finally {
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
    }
  };

  // Secret long-press handlers to clear stuck history/cache
  const secretClearBackupHistory = async () => {
    try {
      await clearHashCache();
      console.log('[Secret] Cleared hash cache');
      showDarkAlert('Cache Cleared', 'Backup hash cache has been reset. Next backup will re-scan all files.');
    } catch (e) {
      console.warn('[Secret] Failed to clear hash cache:', e?.message);
    }
  };

  const secretClearSyncHistory = async () => {
    try {
      await clearRestoreHistory();
      console.log('[Secret] Cleared restore history');
      showDarkAlert('History Cleared', 'Sync/restore history has been reset. Next sync will re-download all files.');
    } catch (e) {
      console.warn('[Secret] Failed to clear restore history:', e?.message);
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
        <StatusBar barStyle="light-content" backgroundColor="#060608" />
        <LoginScreen
          appDisplayName={APP_DISPLAY_NAME}
          appIcon={require('./assets/splash-icon.png')}
          serverType={serverType}
          setServerType={setServerType}
          authMode={authMode}
          setAuthMode={(mode) => {
            setAuthMode(mode);
            // When user switches to login on first run, show server options
            if (mode === 'login' && isFirstRun) {
              setIsFirstRun(false);
            }
          }}
          isFirstRun={isFirstRun}
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          confirmPassword={confirmPassword}
          setConfirmPassword={setConfirmPassword}
          newPassword={newPassword}
          setNewPassword={setNewPassword}
          localHost={localHost}
          setLocalHost={setLocalHost}
          remoteHost={remoteHost}
          setRemoteHost={setRemoteHost}
          termsAccepted={termsAccepted}
          setTermsAccepted={setTermsAccepted}
          selectedStealthPlanGb={selectedStealthPlanGb}
          setSelectedStealthPlanGb={setSelectedStealthPlanGb}
          loading={loading}
          authLoadingLabel={authLoadingLabel}
          handleAuth={handleAuth}
          handleResetPassword={handleResetPassword}
          normalizeHostInput={normalizeHostInput}
          openQrScanner={async () => {
            if (!cameraPermission?.granted) {
              const result = await requestCameraPermission();
              if (!result.granted) {
                showDarkAlert(t('login.cameraPermissionTitle'), t('login.cameraPermissionMessage'));
                return;
              }
            }
            setQrScannerOpen(true);
          }}
          openQuickSetupGuide={() => setQuickSetupCollapsed(false)}
          STEALTH_PLAN_TIERS={STEALTH_PLAN_TIERS}
          availablePlans={availablePlans}
          getStealthCloudTierStatus={getStealthCloudTierStatus}
          stealthCapacityLoading={stealthCapacityLoading}
          stealthCapacityError={stealthCapacityError}
          stealthCapacity={stealthCapacity}
          plansLoading={plansLoading}
          purchaseLoading={purchaseLoading}
        />

        {/* Keep overlays for loading, alerts, QR scanner, and quick setup guide */}
        {loading && (
        <View style={[styles.overlay, { backgroundColor: '#000' }]}>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            <GradientSpinner size={isTablet ? 90 : 70} />
            <Text style={{ color: '#fff', fontSize: scale(16), fontWeight: '600', marginTop: scaleSpacing(20) }}>{authLoadingLabel}</Text>
            <Text style={{ color: '#888', fontSize: scale(13), marginTop: scaleSpacing(8) }}>{t('alerts.pleaseWait')}</Text>
          </View>
        </View>
      )}

      {customAlert && (
        <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.97)' }]}>
          <View style={[styles.overlayCard, { backgroundColor: '#000000', maxWidth: isTablet ? 450 : 320 }]}>
            <Text style={[styles.overlayTitle, { fontSize: scale(18), marginBottom: scaleSpacing(8) }]}>{customAlert.title}</Text>
            <Text style={{ color: '#FFFFFF', fontSize: scale(14), textAlign: 'center', marginBottom: scaleSpacing(20), lineHeight: scale(20) }}>{customAlert.message}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: scaleSpacing(12), flexWrap: 'wrap' }}>
              {(customAlert.buttons || []).map((btn, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.overlayBtnPrimary, { paddingVertical: scaleSpacing(10), paddingHorizontal: scaleSpacing(16), minWidth: isTablet ? 100 : 70 }]}
                  onPress={() => { closeDarkAlert(); if (btn.onPress) btn.onPress(); }}>
                  <Text style={styles.overlayBtnPrimaryText} numberOfLines={1}>{btn.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}

      {qrScannerOpen && (
        <View style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000'}}>
          {cameraPermission?.granted ? (
            <CameraView
              style={{flex: 1}}
              facing="back"
              autofocus="on"
              zoom={0}
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
                interval: 100,
              }}
              onBarcodeScanned={(result) => {
                if (result && result.data) {
                  handleQRCodeScanned(result.data);
                }
              }}
            />
          ) : (
            <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000'}}>
              <Text style={{color: '#888', textAlign: 'center', padding: scaleSpacing(20), fontSize: scale(14)}}>
                {t('permissions.cameraRequired')}
              </Text>
              <TouchableOpacity
                style={{backgroundColor: '#03E1FF', paddingHorizontal: scaleSpacing(20), paddingVertical: scaleSpacing(10), borderRadius: scaleSpacing(8)}}
                onPress={requestCameraPermission}>
                <Text style={{color: '#000000', fontWeight: '700', fontSize: scale(14)}}>{t('permissions.grant')}</Text>
              </TouchableOpacity>
            </View>
          )}
          {/* Overlay UI on top of camera - only show when permission granted */}
          {cameraPermission?.granted ? (
            <View style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'box-none'}}>
              {/* Top bar with title */}
              <View style={{paddingTop: Platform.OS === 'ios' ? scaleSpacing(60) : scaleSpacing(40), paddingHorizontal: scaleSpacing(20), backgroundColor: 'rgba(0,0,0,0.5)'}}>
                <Text style={{color: '#fff', fontSize: scale(18), fontWeight: '600', textAlign: 'center'}}>
                  {t('qrScanner.title')}
                </Text>
                <Text style={{color: '#aaa', fontSize: scale(13), textAlign: 'center', marginTop: scaleSpacing(4)}}>
                  {t('qrScanner.instruction')}
                </Text>
              </View>
              {/* Center scanning frame */}
              <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
                <View style={{width: isTablet ? 280 : 240, height: isTablet ? 280 : 240, borderWidth: 2, borderColor: '#03E1FF', borderRadius: scaleSpacing(16)}} />
              </View>
              {/* Bottom bar with cancel button */}
              <View style={{paddingBottom: Platform.OS === 'android' ? ANDROID_NAV_BAR_HEIGHT + scaleSpacing(16) : scaleSpacing(50), paddingHorizontal: scaleSpacing(20), backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center'}}>
                <TouchableOpacity
                  style={{paddingVertical: scaleSpacing(14), paddingHorizontal: scaleSpacing(50), backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: scaleSpacing(12), borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)'}}
                  onPress={() => setQrScannerOpen(false)}>
                  <Text style={{color: '#fff', fontSize: scale(16), fontWeight: '600'}}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'box-none'}}>
              {/* Top bar with title - full screen permission view */}
              <View style={{paddingTop: Platform.OS === 'ios' ? scaleSpacing(60) : scaleSpacing(40), paddingHorizontal: scaleSpacing(20)}}>
                <Text style={{color: '#fff', fontSize: scale(18), fontWeight: '600', textAlign: 'center'}}>
                  {t('qrScanner.title')}
                </Text>
                <Text style={{color: '#aaa', fontSize: scale(13), textAlign: 'center', marginTop: scaleSpacing(4)}}>
                  {t('qrScanner.instruction')}
                </Text>
              </View>
              {/* Bottom bar with cancel button */}
              <View style={{position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: Platform.OS === 'android' ? ANDROID_NAV_BAR_HEIGHT + scaleSpacing(16) : scaleSpacing(50), paddingHorizontal: scaleSpacing(20), alignItems: 'center'}}>
                <TouchableOpacity
                  style={{paddingVertical: scaleSpacing(14), paddingHorizontal: scaleSpacing(50), backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: scaleSpacing(12), borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)'}}
                  onPress={() => setQrScannerOpen(false)}>
                  <Text style={{color: '#fff', fontSize: scale(16), fontWeight: '600'}}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {!quickSetupCollapsed && serverType !== 'stealthcloud' && (
        <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.97)' }]}>
          <View style={[styles.overlayCard, { backgroundColor: '#000000', maxWidth: 420, width: '94%', padding: scaleSpacing(20) }]}>
            {/* Header */}
            <View style={{ marginBottom: scaleSpacing(20) }}>
              <Text style={{ color: '#FFFFFF', fontSize: scale(20), fontWeight: '700', marginBottom: scaleSpacing(4) }}>
                {serverType === 'local' ? t('quickSetup.localNetworkSetup') : t('quickSetup.remoteServerSetup')}
              </Text>
              <Text style={{ color: '#888888', fontSize: scale(13) }}>
                {serverType === 'local' ? t('quickSetup.localNetworkDesc') : t('quickSetup.remoteServerDesc')}
              </Text>
            </View>

            {serverType === 'local' && (
              <>
                {/* Step 1: Download */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: scaleSpacing(16) }}>
                  <View style={{ width: scale(28), height: scale(28), borderRadius: scale(14), backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginRight: scaleSpacing(12) }}>
                    <Text style={{ color: '#000', fontSize: scale(14), fontWeight: '700' }}>1</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#FFFFFF', fontSize: scale(15), fontWeight: '600', marginBottom: scaleSpacing(6) }}>{t('quickSetup.step1Local')}</Text>
                    <TouchableOpacity
                      style={{ backgroundColor: '#1A1A1A', borderRadius: scale(8), padding: scaleSpacing(12), borderWidth: 1, borderColor: '#333' }}
                      onPress={() => { Clipboard.setString(GITHUB_RELEASES_LATEST_URL); showDarkAlert(t('alerts.copied'), t('alerts.linkCopied')); }}
                      onLongPress={() => openLink(GITHUB_RELEASES_LATEST_URL)}>
                      <Text style={{ color: '#FFFFFF', fontSize: scale(11) }} numberOfLines={1} ellipsizeMode="middle">{GITHUB_RELEASES_LATEST_URL}</Text>
                      <Text style={{ color: '#888', fontSize: scale(10), marginTop: 4 }}>{t('quickSetup.tapToCopyLink')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Step 2: Scan QR in Settings */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: scaleSpacing(16) }}>
                  <View style={{ width: scale(28), height: scale(28), borderRadius: scale(14), backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginRight: scaleSpacing(12) }}>
                    <Text style={{ color: '#000', fontSize: scale(14), fontWeight: '700' }}>2</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#FFFFFF', fontSize: scale(15), fontWeight: '600', marginBottom: scaleSpacing(6) }}>{t('quickSetup.step2Local')}</Text>
                    <Text style={{ color: '#888', fontSize: scale(12) }}>{t('quickSetup.step2LocalDesc')}</Text>
                  </View>
                </View>

                {/* Step 3: Start backing up */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ width: scale(28), height: scale(28), borderRadius: scale(14), backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginRight: scaleSpacing(12) }}>
                    <Text style={{ color: '#000', fontSize: scale(14), fontWeight: '700' }}>3</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#FFFFFF', fontSize: scale(15), fontWeight: '600' }}>{t('quickSetup.step3')}</Text>
                    <Text style={{ color: '#888', fontSize: scale(12), marginTop: 4 }}>{t('quickSetup.step3LocalDesc')}</Text>
                  </View>
                </View>
              </>
            )}

            {serverType === 'remote' && (
              <>
                {/* Step 1: Run install script */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: scaleSpacing(16) }}>
                  <View style={{ width: scale(28), height: scale(28), borderRadius: scale(14), backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginRight: scaleSpacing(12) }}>
                    <Text style={{ color: '#000', fontSize: scale(14), fontWeight: '700' }}>1</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#FFFFFF', fontSize: scale(15), fontWeight: '600', marginBottom: scaleSpacing(6) }}>{t('quickSetup.step1Remote')}</Text>
                    <TouchableOpacity
                      style={{ backgroundColor: '#1A1A1A', borderRadius: scale(8), padding: scaleSpacing(12), borderWidth: 1, borderColor: '#333' }}
                      onPress={() => { Clipboard.setString('sudo curl -fsSL https://raw.githubusercontent.com/viktorvishyn369/PhotoLynk/main/install-server.sh | bash'); showDarkAlert(t('alerts.copied'), t('alerts.commandCopied')); }}
                      onLongPress={() => openLink('https://github.com/viktorvishyn369/PhotoLynk/blob/main/install-server.sh')}>
                      <Text style={{ color: '#FFFFFF', fontSize: scale(10) }} numberOfLines={2}>sudo curl -fsSL https://...install-server.sh | bash</Text>
                      <Text style={{ color: '#888', fontSize: scale(10), marginTop: 4 }}>{t('quickSetup.tapToCopyCommand')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Step 2: Enter domain in Settings */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: scaleSpacing(16) }}>
                  <View style={{ width: scale(28), height: scale(28), borderRadius: scale(14), backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginRight: scaleSpacing(12) }}>
                    <Text style={{ color: '#000', fontSize: scale(14), fontWeight: '700' }}>2</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#FFFFFF', fontSize: scale(15), fontWeight: '600', marginBottom: scaleSpacing(6) }}>{t('quickSetup.step2Remote')}</Text>
                    <Text style={{ color: '#888', fontSize: scale(12) }}>{t('quickSetup.step2RemoteDesc')}</Text>
                  </View>
                </View>

                {/* Step 3: Start backing up */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ width: scale(28), height: scale(28), borderRadius: scale(14), backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginRight: scaleSpacing(12) }}>
                    <Text style={{ color: '#000', fontSize: scale(14), fontWeight: '700' }}>3</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#FFFFFF', fontSize: scale(15), fontWeight: '600' }}>{t('quickSetup.step3')}</Text>
                    <Text style={{ color: '#888', fontSize: scale(12), marginTop: 4 }}>{t('quickSetup.step3RemoteDesc')}</Text>
                  </View>
                </View>
              </>
            )}

            {/* StealthCloud setup instructions - hidden for now, kept for future use
            {serverType === 'stealthcloud' && (
              <View style={{ backgroundColor: '#1A1A1A', borderRadius: scale(12), padding: scaleSpacing(14), borderWidth: 1, borderColor: '#2A2A2A' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: scaleSpacing(10) }}>
                  <Feather name="zap" size={scale(16)} color="#8B5CF6" />
                  <Text style={{ color: '#8B5CF6', fontSize: scale(13), fontWeight: '600', marginLeft: scaleSpacing(8) }}>GETTING STARTED</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: scaleSpacing(6) }}>
                  <View style={{ width: scale(20), height: scale(20), borderRadius: scale(10), backgroundColor: '#8B5CF6', alignItems: 'center', justifyContent: 'center', marginRight: scaleSpacing(10) }}>
                    <Text style={{ color: '#fff', fontSize: scale(11), fontWeight: '700' }}>1</Text>
                  </View>
                  <Text style={{ color: '#FFFFFF', fontSize: scale(13) }}>Create account & log in</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: scaleSpacing(6) }}>
                  <View style={{ width: scale(20), height: scale(20), borderRadius: scale(10), backgroundColor: '#8B5CF6', alignItems: 'center', justifyContent: 'center', marginRight: scaleSpacing(10) }}>
                    <Text style={{ color: '#fff', fontSize: scale(11), fontWeight: '700' }}>2</Text>
                  </View>
                  <Text style={{ color: '#FFFFFF', fontSize: scale(13) }}>Start backing up (7-day free trial)</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: scaleSpacing(10) }}>
                  <View style={{ width: scale(20), height: scale(20), borderRadius: scale(10), backgroundColor: '#8B5CF6', alignItems: 'center', justifyContent: 'center', marginRight: scaleSpacing(10) }}>
                    <Text style={{ color: '#fff', fontSize: scale(11), fontWeight: '700' }}>3</Text>
                  </View>
                  <Text style={{ color: '#FFFFFF', fontSize: scale(13) }}>Pick a plan when ready</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderRadius: scale(8), padding: scaleSpacing(10) }}>
                  <Feather name="shield" size={scale(14)} color="#8B5CF6" />
                  <Text style={{ color: '#888', fontSize: scale(11), marginLeft: scaleSpacing(8), flex: 1 }}>Zero-knowledge encryption: only your device can decrypt your data.</Text>
                </View>
              </View>
            )}
            */}

            <TouchableOpacity 
              style={{ marginTop: scaleSpacing(16), backgroundColor: '#1A1A1A', borderRadius: scale(12), paddingVertical: scaleSpacing(14), alignItems: 'center', borderWidth: 1, borderColor: '#2A2A2A' }} 
              onPress={() => { setQuickSetupCollapsed(true); setQuickSetupHighlightInput(false); }}>
              <Text style={{ color: '#FFFFFF', fontSize: scale(15), fontWeight: '600' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <HomeScreen
        appDisplayName={APP_DISPLAY_NAME}
        appVersion="2.0.0"
        serverType={serverType}
        status={status}
        progress={progress}
        progressAction={progressAction}
        loading={loading}
        glassModeEnabled={glassModeEnabled}
        qsEmail={email}
        qsWalletAddress={qsWalletAddress}
        qsNftCount={qsNftCount}
        qsLastBackupTime={qsLastBackupTime}
        onTabChange={(tab) => setView(tab === 'info' ? 'info' : 'home')}
        infoContent={
          <InfoScreen
            appDisplayName={APP_DISPLAY_NAME}
            appVersion="2.0.0"
            deviceUuid={deviceUuid}
            serverType={serverType}
            stealthUsage={stealthUsage}
            stealthUsageLoading={stealthUsageLoading}
            stealthUsageError={stealthUsageError}
            availablePlans={availablePlans}
            purchaseLoading={purchaseLoading}
            glassModeEnabled={glassModeEnabled}
            showDarkAlert={showDarkAlert}
            openPaywall={openPaywall}
            STEALTH_PLAN_TIERS={STEALTH_PLAN_TIERS}
          />
        }
        settingsContent={
          <SettingsScreen
            serverType={serverType}
            setServerType={setServerType}
            localHost={localHost}
            setLocalHost={setLocalHost}
            remoteHost={remoteHost}
            setRemoteHost={setRemoteHost}
            getServerUrl={getServerUrl}
            autoUploadEnabled={autoUploadEnabled}
            persistAutoUploadEnabled={persistAutoUploadEnabled}
            fastModeEnabled={fastModeEnabled}
            persistFastModeEnabled={persistFastModeEnabled}
            glassModeEnabled={glassModeEnabled}
            persistGlassModeEnabled={persistGlassModeEnabled}
            loading={loading}
            logout={logout}
            relogin={async (newServerType) => {
              setLoadingSafe(true);
              setStatus(t('status.switchingServer') || 'Switching server...');
              setStealthUsage(null);
              setStealthUsageError(null);
              try {
                const savedEmail = await SecureStore.getItemAsync('user_email');
                const savedPasswordEmail = await SecureStore.getItemAsync(SAVED_PASSWORD_EMAIL_KEY);
                let savedPassword = null;
                if (savedPasswordEmail) {
                  const storedWithBiometric = Platform.OS === 'ios' || 
                    (await SecureStore.getItemAsync('password_stored_with_biometric')) === 'true';
                  if (storedWithBiometric) {
                    try {
                      savedPassword = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY, {
                        requireAuthentication: true,
                        authenticationPrompt: t('auth.unlockToSignIn')
                      });
                    } catch (e) {
                      savedPassword = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY);
                    }
                  } else {
                    savedPassword = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY);
                  }
                }
                if (savedEmail && savedPassword) {
                  if (newServerType) { try { setServerType(newServerType); } catch (e) {} }
                  await handleAuth('login', { email: savedEmail, password: savedPassword, serverType: newServerType || serverType });
                } else {
                  setView('auth');
                }
              } catch (e) {
                showDarkAlert(t('alerts.error'), e.message || t('alerts.connectionFailed'));
              } finally {
                setLoadingSafe(false);
              }
            }}
            purgeStealthCloudData={purgeStealthCloudData}
            purgeClassicServerData={purgeClassicServerData}
            showDarkAlert={showDarkAlert}
            onQrScan={async () => {
              if (!cameraPermission?.granted) {
                const result = await requestCameraPermission();
                if (!result.granted) {
                  showDarkAlert(t('login.cameraPermissionTitle'), t('login.cameraPermissionMessage'));
                  return;
                }
              }
              setQrScannerOpen(true);
            }}
            normalizeHostInput={normalizeHostInput}
            SecureStore={SecureStore}
            currentLanguage={currentLanguage}
            onLanguageChange={handleLanguageChange}
          />
        }
        onLogout={() => logout()}
        onCleanBestMatches={async () => { await cleanDeviceDuplicates(); }}
        onCleanSimilar={async () => { await startSimilarShotsReview(); }}
        onBackupAll={async () => { await backupPhotos(); }}
        onLongPressBackup={secretClearBackupHistory}
        onBackupSelected={() => { openBackupPicker(); }}
        onSyncAll={async () => { await restorePhotos(); }}
        onLongPressSync={secretClearSyncHistory}
        onSyncSelected={() => { openSyncPicker(); }}
        showCompletionTick={showCompletionTick}
        completionMessage={completionMessage}
        onDismissCompletionTick={dismissCompletionTick}
        onMintNFT={openNftPicker}
        onViewNFTs={openNftGallery}
        onViewCertificates={() => setNftCertsOpen(true)}
      />

      {qrScannerOpen && (
        <View style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 9999}}>
          {cameraPermission?.granted ? (
            <CameraView
              style={{flex: 1}}
              facing="back"
              autofocus="on"
              zoom={0}
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
                interval: 100,
              }}
              onBarcodeScanned={(result) => {
                if (result && result.data) {
                  handleQRCodeScanned(result.data);
                }
              }}
            />
          ) : (
            <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000'}}>
              <Text style={{color: '#888', textAlign: 'center', padding: scaleSpacing(20), fontSize: scale(14)}}>
                {t('permissions.cameraRequired')}
              </Text>
              <TouchableOpacity
                style={{backgroundColor: '#03E1FF', paddingHorizontal: scaleSpacing(20), paddingVertical: scaleSpacing(10), borderRadius: scaleSpacing(8)}}
                onPress={requestCameraPermission}>
                <Text style={{color: '#000000', fontWeight: '700', fontSize: scale(14)}}>{t('permissions.grant')}</Text>
              </TouchableOpacity>
            </View>
          )}
          {cameraPermission?.granted ? (
            <View style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'box-none'}}>
              <View style={{paddingTop: Platform.OS === 'ios' ? scaleSpacing(60) : scaleSpacing(40), paddingHorizontal: scaleSpacing(20), backgroundColor: 'rgba(0,0,0,0.5)'}}>
                <Text style={{color: '#fff', fontSize: scale(18), fontWeight: '600', textAlign: 'center'}}>
                  {t('qrScanner.title')}
                </Text>
                <Text style={{color: '#aaa', fontSize: scale(13), textAlign: 'center', marginTop: scaleSpacing(4)}}>
                  {t('qrScanner.instruction')}
                </Text>
              </View>
              <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
                <View style={{width: isTablet ? 280 : 240, height: isTablet ? 280 : 240, borderWidth: 2, borderColor: '#03E1FF', borderRadius: scaleSpacing(16)}} />
              </View>
              <View style={{paddingBottom: Platform.OS === 'android' ? ANDROID_NAV_BAR_HEIGHT + scaleSpacing(16) : scaleSpacing(50), paddingHorizontal: scaleSpacing(20), backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center'}}>
                <TouchableOpacity
                  style={{paddingVertical: scaleSpacing(14), paddingHorizontal: scaleSpacing(50), backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: scaleSpacing(12), borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)'}}
                  onPress={() => setQrScannerOpen(false)}>
                  <Text style={{color: '#fff', fontSize: scale(16), fontWeight: '600'}}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'box-none'}}>
              <View style={{paddingTop: Platform.OS === 'ios' ? scaleSpacing(60) : scaleSpacing(40), paddingHorizontal: scaleSpacing(20)}}>
                <Text style={{color: '#fff', fontSize: scale(18), fontWeight: '600', textAlign: 'center'}}>
                  {t('qrScanner.title')}
                </Text>
                <Text style={{color: '#aaa', fontSize: scale(13), textAlign: 'center', marginTop: scaleSpacing(4)}}>
                  {t('qrScanner.instruction')}
                </Text>
              </View>
              <View style={{position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: Platform.OS === 'android' ? ANDROID_NAV_BAR_HEIGHT + scaleSpacing(16) : scaleSpacing(50), paddingHorizontal: scaleSpacing(20), alignItems: 'center'}}>
                <TouchableOpacity
                  style={{paddingVertical: scaleSpacing(14), paddingHorizontal: scaleSpacing(50), backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: scaleSpacing(12), borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)'}}
                  onPress={() => setQrScannerOpen(false)}>
                  <Text style={{color: '#fff', fontSize: scale(16), fontWeight: '600'}}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {loading && !progressAction && (
        <View style={[styles.overlay, { backgroundColor: '#000', zIndex: 9998 }]}>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            <GradientSpinner size={isTablet ? 90 : 70} />
            <Text style={{ color: '#fff', fontSize: scale(16), fontWeight: '600', marginTop: scaleSpacing(20) }}>{status || t('alerts.pleaseWait')}</Text>
            <Text style={{ color: '#888', fontSize: scale(13), marginTop: scaleSpacing(8) }}>{t('alerts.pleaseWait')}</Text>
          </View>
        </View>
      )}

      {cleanupModeOpen && (
        <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
          <View style={[styles.overlayCard, glassModeEnabled && styles.overlayCardGlass]}>
            <Text style={styles.overlayTitle}>{t('cleanup.title')}</Text>
            <Text style={styles.overlaySubtitle}>{t('cleanup.subtitle')}</Text>

            <TouchableOpacity
              style={[styles.overlayBtnPrimary, glassModeEnabled && styles.overlayBtnPrimaryGlass]}
              onPress={async () => {
                closeCleanupModeChooser();
                await cleanDeviceDuplicates();
              }}>
              <Text style={styles.overlayBtnPrimaryText}>{t('cleanup.identicalPhotosVideos')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.overlayBtnSecondary, glassModeEnabled && styles.overlayBtnSecondaryGlass]}
              onPress={async () => {
                closeCleanupModeChooser();
                await startSimilarShotsReview();
              }}>
              <Text style={styles.overlayBtnSecondaryText}>{t('similarPhotos.title')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.overlayBtnGhost, glassModeEnabled && styles.overlayBtnGhostGlass]}
              onPress={closeCleanupModeChooser}>
              <Text style={styles.overlayBtnGhostText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {similarReviewOpen && (() => {
        const CLEANUP_MAGENTA = '#DC1FFF'; // Magenta color for clean duplicates
        const currentGroup = (similarGroups || [])[similarGroupIndex] || [];
        const currentPhoto = currentGroup[similarPhotoIndex] || null;
        const currentPhotoId = currentPhoto && currentPhoto.id ? String(currentPhoto.id) : '';
        const isSelected = !!(similarSelected && similarSelected[currentPhotoId]);
        const totalInGroup = currentGroup.length || 0;
        const totalGroups = (similarGroups || []).length || 0;
        const selectedCount = getSimilarSelectedIds().length || 0;
        const similarGroupKey = `${similarGroupIndex}:${totalInGroup}:${String(currentGroup?.[0]?.id || '')}:${String(currentGroup?.[totalInGroup - 1]?.id || '')}`;
        
        // Safety check - close if no valid data
        if (!currentGroup.length || !currentPhoto) {
          return null;
        }
        
        return (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' }}>
            {/* Header */}
            <View style={{ paddingTop: Platform.OS === 'ios' ? 50 : 30, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: 'rgba(0,0,0,0.8)' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <TouchableOpacity onPress={closeSimilarReview} style={{ padding: 8 }}>
                  <Text style={{ color: CLEANUP_MAGENTA, fontSize: scale(16), fontWeight: '600' }}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <Text style={{ color: '#FFF', fontSize: scale(16), fontWeight: '700' }}>{t('similarPhotos.title')}</Text>
                <View style={{ width: 60 }} />
              </View>
              <Text style={{ color: '#888', fontSize: scale(12), textAlign: 'center', marginTop: 4 }} numberOfLines={1}>{t('similarPhotos.setInfo', { set: similarGroupIndex + 1, total: totalGroups })} • {t('similarPhotos.photoInfo', { photo: similarPhotoIndex + 1, total: totalInGroup })}</Text>
            </View>

            {/* Full-screen photo */}
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              {currentPhoto && (
                <Image
                  source={{ uri: currentPhoto.uri }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              )}
              
              {/* Selection overlay badge */}
              {isSelected && (
                <View style={{ position: 'absolute', top: 20, right: 20, backgroundColor: 'rgba(255,59,48,0.9)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 }}>
                  <Text style={{ color: '#FFF', fontSize: scale(14), fontWeight: '700' }}>{t('similarPhotos.markedForDeletion')}</Text>
                </View>
              )}
              
              {/* Photo info */}
              {currentPhoto && (
                <View style={{ position: 'absolute', bottom: 20, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.7)', padding: 12, borderRadius: 12, alignItems: 'center' }}>
                  <Text style={{ color: '#FFF', fontSize: scale(13), fontWeight: '600', textAlign: 'center' }}>{currentPhoto.filename || 'Unknown'}</Text>
                  {(currentPhoto.created > 0 || currentPhoto.creationTime > 0) ? (
                    <Text style={{ color: '#AAA', fontSize: scale(11), marginTop: 4, textAlign: 'center' }}>
                      {new Date(currentPhoto.created || currentPhoto.creationTime).toLocaleString()}
                    </Text>
                  ) : null}
                </View>
              )}

              {/* Left/Right navigation arrows */}
              {similarPhotoIndex > 0 && (
                <TouchableOpacity
                  style={{ position: 'absolute', left: 10, top: '50%', marginTop: -30, backgroundColor: 'rgba(255,255,255,0.2)', width: 50, height: 60, borderRadius: 8, justifyContent: 'center', alignItems: 'center' }}
                  onPress={() => setSimilarPhotoIndex(prev => Math.max(0, prev - 1))}>
                  <Text style={{ color: '#FFF', fontSize: 28, fontWeight: '300' }}>‹</Text>
                </TouchableOpacity>
              )}
              {similarPhotoIndex < totalInGroup - 1 && (
                <TouchableOpacity
                  style={{ position: 'absolute', right: 10, top: '50%', marginTop: -30, backgroundColor: 'rgba(255,255,255,0.2)', width: 50, height: 60, borderRadius: 8, justifyContent: 'center', alignItems: 'center' }}
                  onPress={() => setSimilarPhotoIndex(prev => Math.min(totalInGroup - 1, prev + 1))}>
                  <Text style={{ color: '#FFF', fontSize: 28, fontWeight: '300' }}>›</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Thumbnail strip */}
            <View style={{ backgroundColor: 'rgba(0,0,0,0.9)', paddingVertical: 8, minHeight: 86 }}>
              <ScrollView key={`thumbstrip-${similarGroupKey}`} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12 }}>
                {currentGroup.map((a, idx) => {
                  const thumbSelected = !!(similarSelected && similarSelected[String(a && a.id ? a.id : '')]);
                  const isCurrent = idx === similarPhotoIndex;
                  const thumbUri = (a && (a.thumbUri || a.uri)) ? (a.thumbUri || a.uri) : null;
                  return (
                    <TouchableOpacity
                      key={`${similarGroupKey}-${a.id}`}
                      style={{ width: 70, height: 70, marginRight: 8, borderRadius: 8, overflow: 'hidden', borderWidth: isCurrent ? 3 : 2, borderColor: isCurrent ? CLEANUP_MAGENTA : (thumbSelected ? '#FF3B30' : '#333') }}
                      onPress={() => setSimilarPhotoIndex(idx)}>
                      {thumbUri ? (
                        <Image
                          key={`img-${similarGroupKey}-${a.id}`}
                          source={{ uri: thumbUri }}
                          style={{ width: '100%', height: '100%' }}
                          onError={() => { try { void ensureSimilarThumb(a); } catch (e) {} }}
                        />
                      ) : (
                        <View style={{ width: '100%', height: '100%', backgroundColor: '#111' }} />
                      )}
                      {thumbSelected && (
                        <View style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center' }}>
                          <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '900' }}>✓</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Bottom action bar */}
            <View style={{ backgroundColor: 'rgba(0,0,0,0.95)', paddingBottom: Platform.OS === 'ios' ? 34 : 60, paddingTop: 12, paddingHorizontal: 16 }}>
              {/* Toggle selection button */}
              <TouchableOpacity
                style={{ backgroundColor: isSelected ? '#333' : '#FF3B30', paddingVertical: 14, borderRadius: 12, marginBottom: 10, alignItems: 'center', paddingHorizontal: 8 }}
                onPress={() => toggleSimilarSelected(currentPhotoId)}>
                <Text style={{ color: '#FFF', fontSize: scale(15), fontWeight: '700', textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  {isSelected ? t('similarPhotos.keepThisPhoto') : t('similarPhotos.markForDeletion')}
                </Text>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row' }}>
                {/* Delete selected */}
                <TouchableOpacity
                  disabled={selectedCount === 0 || loading}
                  style={{ flex: 1, marginRight: 5, backgroundColor: selectedCount > 0 ? CLEANUP_MAGENTA : '#333', paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', opacity: selectedCount === 0 ? 0.5 : 1 }}
                  onPress={async () => {
                    const ids = getSimilarSelectedIds();
                    if (ids.length === 0) return;
                    setLoadingSafe(true);
                    setStatus(t('status.deletingItems', { count: ids.length }));
                    let didDelete = false;
                    let thisDeletedCount = 0;

                    try {
                      // Use batched deletion to avoid crashes with large numbers of files
                      const DuplicateScanner = require('./duplicateScannerOptimized').default;
                      console.log('Similar Photos: Using batched deletion for', ids.length, 'items');
                      const result = await DuplicateScanner.deleteAssets(ids, (progress, deleted, total) => {
                        setStatus(t('status.deletingProgress', { deleted, total }));
                      });
                      thisDeletedCount = result.deleted;
                      if (thisDeletedCount > 0) {
                        didDelete = true;
                        similarDeletedTotalRef.current += thisDeletedCount;
                        setSimilarDeletedTotal(similarDeletedTotalRef.current);
                        setStatus(t('status.deletedItems', { count: thisDeletedCount }));
                      } else {
                        setStatus(t('status.deletionCancelled'));
                      }
                    } catch (e) {
                      console.log('Similar Photos: Delete error', e?.message || e);
                      const msg = String(e?.message || e || '');
                      const isUserCancelled = Platform.OS === 'ios' && msg.includes('PHPhotosErrorDomain') && msg.includes('3072');
                      if (isUserCancelled) {
                        setStatus(t('status.deletionCancelled'));
                      } else {
                        setStatus(t('status.deletionFailed'));
                        showDarkAlert(t('alerts.deleteFailed'), e?.message || t('alerts.deleteFailedMessage'));
                      }
                    }

                    setLoadingSafe(false);

                    if (!didDelete) return;

                    const prevGroups = Array.isArray(similarGroups) ? similarGroups : [];
                    const nextGroups = prevGroups
                      .map((g) => (Array.isArray(g) ? g.filter((it) => it && it.id && !ids.includes(String(it.id))) : []))
                      .filter((g) => Array.isArray(g) && g.length >= 2);

                    if (nextGroups.length === 0) {
                      // Use ref for accurate cumulative total (state is stale in async handlers)
                      const totalDeleted = similarDeletedTotalRef.current;
                      closeSimilarReview();
                      setStatus(t('status.cleanupComplete'));
                      showCompletionTickBriefly(t('results.filesDeleted', { count: totalDeleted }));
                      return;
                    }

                    const nextIndex = Math.min(similarGroupIndex, nextGroups.length - 1);
                    setSimilarGroups(nextGroups);
                    setSimilarGroupIndex(nextIndex);
                    setSimilarSelected(buildDefaultSimilarSelection(nextGroups[nextIndex] || []));
                    setSimilarPhotoIndex(0);
                  }}>
                  <Text style={{ color: selectedCount > 0 ? '#FFF' : '#888', fontSize: scale(14), fontWeight: '700', textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {t('similarPhotos.delete')} {selectedCount > 0 ? `(${selectedCount})` : ''}
                  </Text>
                </TouchableOpacity>

                {/* Keep all / Next set */}
                <TouchableOpacity
                  style={{ flex: 1, marginLeft: 5, backgroundColor: '#222', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#444', paddingHorizontal: 6 }}
                  onPress={() => {
                    advanceSimilarGroup({ groups: similarGroups, nextIndex: similarGroupIndex + 1 });
                  }}>
                  <Text style={{ color: '#FFF', fontSize: scale(14), fontWeight: '600', textAlign: 'center' }} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {(similarGroupIndex < totalGroups - 1 ? t('similarPhotos.keepAllNext') : t('similarPhotos.keepAllDone')) + (similarDeletedTotal > 0 ? ` (${similarDeletedTotal})` : '')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );
      })()}

      {backupModeOpen && (
        <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
          <View style={[styles.overlayCard, glassModeEnabled && styles.overlayCardGlass]}>
            <Text style={styles.overlayTitle}>Backup to Cloud</Text>
            <Text style={styles.overlaySubtitle}>Choose how you want to upload{"\n"}(existing files on server will be skipped).</Text>

            <TouchableOpacity
              style={[styles.overlayBtnPrimary, glassModeEnabled && styles.overlayBtnPrimaryGlass]}
              onPress={async () => {
                closeBackupModeChooser();
                await backupPhotos();
              }}>
              <Text style={styles.overlayBtnPrimaryText}>All Photos & Videos</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.overlayBtnSecondary, glassModeEnabled && styles.overlayBtnSecondaryGlass]}
              onPress={async () => {
                closeBackupModeChooser();
                await openBackupPicker();
              }}>
              <Text style={styles.overlayBtnSecondaryText}>Choose Photos & Videos</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.overlayBtnGhost, glassModeEnabled && styles.overlayBtnGhostGlass]}
              onPress={closeBackupModeChooser}>
              <Text style={styles.overlayBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {backupPickerOpen && (
        <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
          <View style={[styles.pickerCard, glassModeEnabled && styles.pickerCardGlass]}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={closeBackupPicker} style={styles.pickerHeaderBtn}>
                <Text style={[styles.pickerHeaderBtnText, { color: THEME.accent }]}>{t('picker.cancel')}</Text>
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={styles.pickerHeaderTitle}>{t('picker.selectFiles')}</Text>
                <Text style={styles.pickerHeaderSubtitle}>{t('picker.selected', { count: Object.keys(backupPickerSelected || {}).filter(k => backupPickerSelected[k]).length })}</Text>
              </View>
              <TouchableOpacity
                disabled={Object.keys(backupPickerSelected || {}).filter(k => backupPickerSelected[k]).length === 0 || loading}
                onPress={async () => {
                  const selected = getSelectedPickerAssets();
                  closeBackupPicker();
                  await backupSelectedAssets({ assets: selected });
                }}
                style={styles.pickerHeaderBtn}>
                <Text style={[styles.pickerHeaderBtnText, { color: THEME.accent }]}>{t('picker.start')}</Text>
              </TouchableOpacity>
            </View>

            {serverType !== 'stealthcloud' ? (
              <View style={{ paddingHorizontal: scaleSpacing(12), paddingVertical: scaleSpacing(6), backgroundColor: '#1a1a1a' }}>
                <Text style={{ color: '#666', fontSize: scale(11), textAlign: 'center' }}>
                  {t('picker.previewsUnavailable')}
                </Text>
              </View>
            ) : null}

            {backupPickerLoading && (backupPickerAssets || []).length === 0 ? (
              <View style={{ width: '100%', paddingVertical: scaleSpacing(32), alignItems: 'center' }}>
                <ActivityIndicator size={isTablet ? 'large' : 'small'} color={THEME.accent} />
                <Text style={{ color: '#888', fontSize: scale(13), marginTop: scaleSpacing(10) }}>{t('picker.loadingFiles')}</Text>
              </View>
            ) : serverType === 'stealthcloud' ? (
              <FlatList
                data={backupPickerAssets || []}
                keyExtractor={(a, idx) => `${a?.id}-${idx}`}
                ListHeaderComponent={
                  <View style={{ paddingHorizontal: scaleSpacing(12), paddingVertical: scaleSpacing(8), borderBottomWidth: 1, borderBottomColor: '#222', backgroundColor: '#121212' }}>
                    <Text style={{ color: '#888', fontSize: scale(12) }}>
                      {t('picker.showingFiles', { count: backupPickerAssets.length, total: backupPickerTotal > 0 ? backupPickerTotal : backupPickerAssets.length })}
                    </Text>
                  </View>
                }
                stickyHeaderIndices={[0]}
                contentContainerStyle={styles.syncPickerList}
                removeClippedSubviews={Platform.OS === 'android'}
                initialNumToRender={24}
                maxToRenderPerBatch={24}
                windowSize={7}
                onViewableItemsChanged={onBackupPickerViewableItemsChanged.current}
                viewabilityConfig={{ itemVisiblePercentThreshold: 55 }}
                onEndReachedThreshold={0.7}
                onEndReached={() => {
                  if (backupPickerHasNext && !backupPickerLoading) {
                    loadBackupPickerPage({ reset: false });
                  }
                }}
                renderItem={({ item: a, index: idx }) => {
                  const id = a && a.id ? String(a.id) : '';
                  if (!id) return null;
                  const selected = !!(backupPickerSelected && backupPickerSelected[id]);
                  const displayName = a && a.filename ? a.filename : id;
                  const rawSize = a && typeof a.fileSize === 'number' ? a.fileSize : null;
                  const fileSize = rawSize !== null && rawSize > 0 ? rawSize : null;
                  const ext = (displayName || '').split('.').pop()?.toLowerCase() || '';
                  const isVideo = a && (a.mediaType === 'video' || ['mp4', 'mov', 'avi', 'mkv', 'm4v', '3gp', 'webm'].includes(ext));
                  const isImage = a && (a.mediaType === 'photo' || ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'raw', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'srw', 'raf', 'psd', 'psb', 'exr', 'hdr', 'avif'].includes(ext));
                  const fileIcon = isVideo ? '🎬' : isImage ? '🖼️' : '📄';
                  const thumbUri = (a && (a.thumbUri || a.uri)) ? (a.thumbUri || a.uri) : null;
                  return (
                    <TouchableOpacity
                      key={`${id}-${idx}`}
                      style={[styles.syncPickerRow, selected && { borderColor: THEME.accent }]}
                      onPress={() => toggleBackupPickerSelected(id)}>
                      <TouchableOpacity
                        style={{ width: isTablet ? 56 : 44, height: isTablet ? 56 : 44, borderRadius: scaleSpacing(6), marginRight: scaleSpacing(10), backgroundColor: isVideo ? '#1a1a2e' : '#1e3a2e', alignItems: 'center', justifyContent: 'center' }}
                        onPress={(e) => {
                          e.stopPropagation();
                          if (thumbUri) {
                            setBackupPickerPreview({ uri: thumbUri, filename: displayName });
                          }
                        }}
                        disabled={!thumbUri}
                        activeOpacity={thumbUri ? 0.7 : 1}>
                        {thumbUri ? (
                          <Image
                            source={{ uri: thumbUri }}
                            style={{ width: '100%', height: '100%', borderRadius: scaleSpacing(6) }}
                            onError={() => fixBackupPickerThumbnail(a)}
                          />
                        ) : (
                          <Text style={{ fontSize: scale(22) }}>{fileIcon}</Text>
                        )}
                      </TouchableOpacity>
                      <View style={[styles.syncPickerRowLeft, { flex: 1 }]}>
                        <Text style={styles.syncPickerRowTitle} numberOfLines={1} ellipsizeMode="middle">{displayName}</Text>
                        {fileSize !== null && (
                          <Text style={styles.syncPickerRowMeta}>{formatBytesHuman(fileSize)}</Text>
                        )}
                      </View>
                      <View style={[styles.syncPickerCheck, selected && { backgroundColor: 'rgba(3, 225, 255, 0.92)', borderColor: 'rgba(3, 225, 255, 0.92)' }]}>
                        <Text style={[styles.syncPickerCheckText, selected && styles.syncPickerCheckTextOn]}>{selected ? '✓' : ''}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                }}
                ListFooterComponent={
                  <View style={{ width: '100%', paddingVertical: 12, paddingHorizontal: scaleSpacing(12), alignItems: 'center' }}>
                    {backupPickerLoading ? (
                      <ActivityIndicator size={isTablet ? 'large' : 'small'} color={THEME.accent} />
                    ) : (
                      <View style={{ height: 8 }} />
                    )}
                  </View>
                }
              />
            ) : (
              <FlatList
                data={backupPickerAssets || []}
                keyExtractor={(a, idx) => `${a?.id}-${idx}`}
                numColumns={isTablet ? 4 : 3}
                ListEmptyComponent={backupPickerLoading ? (
                  <View style={{ width: '100%', paddingVertical: scaleSpacing(32), alignItems: 'center' }}>
                    <ActivityIndicator size={isTablet ? 'large' : 'small'} color={THEME.accent} />
                    <Text style={{ color: '#888', fontSize: scale(13), marginTop: scaleSpacing(10) }}>{t('picker.loadingFiles')}</Text>
                  </View>
                ) : null}
                contentContainerStyle={{ padding: scaleSpacing(10) }}
                columnWrapperStyle={{ justifyContent: 'space-between' }}
                removeClippedSubviews={Platform.OS === 'android'}
                initialNumToRender={24}
                maxToRenderPerBatch={24}
                windowSize={7}
                onEndReachedThreshold={0.7}
                onEndReached={() => {
                  if (backupPickerHasNext && !backupPickerLoading) {
                    loadBackupPickerPage({ reset: false });
                  }
                }}
                renderItem={({ item: a, index: idx }) => {
                  const selected = !!(backupPickerSelected && a && backupPickerSelected[a.id]);
                  return (
                    <TouchableOpacity
                      key={`${a?.id}-${idx}`}
                      style={[styles.pickerItem, selected && styles.pickerItemSelected]}
                      onPress={() => toggleBackupPickerSelected(a.id)}>
                      <View style={[styles.pickerThumb, { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' }]}>
                        {(a.thumbUri || a.uri) && (
                          <Image
                            source={{ uri: a.thumbUri || a.uri }}
                            style={[styles.pickerThumb, { position: 'absolute', top: 0, left: 0 }]}
                            onError={() => fixBackupPickerThumbnail(a)}
                          />
                        )}
                        <Text style={{ color: '#444', fontSize: 10, textAlign: 'center' }}>{a.mediaType === 'video' ? '🎬' : '📷'}</Text>
                      </View>
                      {a.mediaType === 'video' && (
                        <View style={styles.pickerBadge}>
                          <Text style={styles.pickerBadgeText}>{t('picker.video')}</Text>
                        </View>
                      )}
                      {selected && (
                        <View style={styles.pickerCheck}>
                          <Text style={styles.pickerCheckText}>✓</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                }}
                ListFooterComponent={
                  <View style={{ width: '100%', paddingVertical: 12, paddingHorizontal: scaleSpacing(12), alignItems: 'center' }}>
                    {backupPickerLoading ? (
                      <ActivityIndicator size="small" color={THEME.accent} />
                    ) : (
                      <View style={{ height: 8 }} />
                    )}
                  </View>
                }
              />
            )}
          </View>
        </View>
      )}

      {backupPickerPreview && serverType === 'stealthcloud' && (
        <Modal
          visible={true}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setBackupPickerPreview(null)}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' }}
            activeOpacity={1}
            onPress={() => setBackupPickerPreview(null)}>
            <View style={{ width: '90%', maxWidth: 400, backgroundColor: '#1a1a1a', borderRadius: scaleSpacing(12), overflow: 'hidden' }}>
              <Image
                source={{ uri: backupPickerPreview.uri }}
                style={{ width: '100%', aspectRatio: 1, resizeMode: 'contain', backgroundColor: '#000' }}
              />
              <View style={{ padding: scaleSpacing(12), borderTopWidth: 1, borderTopColor: '#333' }}>
                <Text style={{ color: '#fff', fontSize: scale(13), textAlign: 'center' }} numberOfLines={2} ellipsizeMode="middle">
                  {backupPickerPreview.filename}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={{ marginTop: scaleSpacing(16), paddingVertical: scaleSpacing(10), paddingHorizontal: scaleSpacing(24), backgroundColor: '#333', borderRadius: scaleSpacing(8) }}
              onPress={() => setBackupPickerPreview(null)}>
              <Text style={{ color: '#fff', fontSize: scale(14) }}>{t('common.close') || 'Close'}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {syncModeOpen && (
        <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
          <View style={[styles.overlayCard, glassModeEnabled && styles.overlayCardGlass]}>
            <Text style={styles.overlayTitle}>{t('sync.title')}</Text>
            <Text style={styles.overlaySubtitle}>{t('sync.subtitle')}</Text>

            <TouchableOpacity
              style={[styles.overlayBtnPrimary, glassModeEnabled && styles.overlayBtnPrimaryGlass]}
              onPress={async () => {
                closeSyncModeChooser();
                await restorePhotos();
              }}>
              <Text style={styles.overlayBtnPrimaryText}>{t('sync.allPhotosVideos')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.overlayBtnSecondary, glassModeEnabled && styles.overlayBtnSecondaryGlass]}
              onPress={async () => {
                closeSyncModeChooser();
                await openSyncPicker();
              }}>
              <Text style={styles.overlayBtnSecondaryText}>{t('sync.choosePhotosVideos')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.overlayBtnGhost, glassModeEnabled && styles.overlayBtnGhostGlass]}
              onPress={closeSyncModeChooser}>
              <Text style={styles.overlayBtnGhostText}>{t('picker.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {syncPickerOpen && (
        <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
          <View style={[styles.pickerCard, glassModeEnabled && styles.pickerCardGlass]}>
            <View style={styles.pickerHeader}>
              <TouchableOpacity onPress={closeSyncPicker} style={styles.pickerHeaderBtn}>
                <Text style={[styles.pickerHeaderBtnText, { color: THEME.secondary }]}>{t('picker.cancel')}</Text>
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={styles.pickerHeaderTitle}>{t('picker.selectFiles')}</Text>
                <Text style={styles.pickerHeaderSubtitle}>{t('picker.selected', { count: getSelectedSyncKeys().length })}</Text>
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
                <Text style={[styles.pickerHeaderBtnText, { color: THEME.secondary }]}>{t('picker.start')}</Text>
              </TouchableOpacity>
            </View>

            {!syncPickerLoading && serverType !== 'stealthcloud' ? (
              <View style={{ width: '100%', paddingHorizontal: scaleSpacing(12), paddingVertical: scaleSpacing(6), backgroundColor: '#1a1a1a' }}>
                <Text style={{ color: '#666', fontSize: scale(11), textAlign: 'center' }}>
                  {t('picker.previewsUnavailable')}
                </Text>
              </View>
            ) : null}

            {syncPickerLoading ? (
              <View style={{ width: '100%', paddingVertical: scaleSpacing(32), alignItems: 'center' }}>
                <ActivityIndicator size={isTablet ? 'large' : 'small'} color={THEME.secondary} />
                <Text style={{ color: '#888', fontSize: scale(13), marginTop: scaleSpacing(10) }}>{t('picker.loadingFiles')}</Text>
              </View>
            ) : serverType === 'stealthcloud' ? (
              <FlatList
                data={syncPickerItems || []}
                keyExtractor={(it, idx) => String((it && it.manifestId) ? it.manifestId : idx)}
                ListHeaderComponent={() => (
                  <View style={{ paddingHorizontal: scaleSpacing(12), paddingVertical: scaleSpacing(8), borderBottomWidth: 1, borderBottomColor: '#222', backgroundColor: '#121212' }}>
                    <Text style={{ color: '#888', fontSize: scale(12) }}>
                      {t('picker.showingFiles', { count: syncPickerItems.length, total: syncPickerTotal > 0 ? syncPickerTotal : syncPickerItems.length })}
                    </Text>
                  </View>
                )}
                stickyHeaderIndices={[0]}
                contentContainerStyle={styles.syncPickerList}
                removeClippedSubviews={Platform.OS === 'android'}
                initialNumToRender={24}
                maxToRenderPerBatch={24}
                windowSize={7}
                onViewableItemsChanged={onSyncPickerViewableItemsChanged.current}
                viewabilityConfig={{ itemVisiblePercentThreshold: 55 }}
                onEndReachedThreshold={0.7}
                onEndReached={() => {
                  if (syncPickerHasMore && !syncPickerLoadingMore) {
                    loadMoreSyncPickerItems();
                  }
                }}
                renderItem={({ item: it }) => {
                  const key = String(it && it.manifestId ? it.manifestId : '');
                  if (!key) return null;
                  const selected = !!(syncPickerSelected && syncPickerSelected[key]);
                  const displayName = it && it.filename ? it.filename : key;
                  const rawSize = it && typeof it.size === 'number' ? it.size : null;
                  const fileSize = rawSize !== null && rawSize > 0 ? rawSize : null;
                  const mediaType = it && it.mediaType ? it.mediaType : null;
                  const ext = (displayName || '').split('.').pop()?.toLowerCase() || '';
                  const isVideo = mediaType === 'video' || ['mp4', 'mov', 'avi', 'mkv', 'm4v', '3gp', 'webm'].includes(ext);
                  const isImage = mediaType === 'photo' || ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'raw', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'srw', 'raf', 'psd', 'psb', 'exr', 'hdr', 'avif'].includes(ext);
                  const fileIcon = isVideo ? '🎬' : isImage ? '🖼️' : '📄';
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.syncPickerRow, selected && styles.syncPickerRowSelected]}
                      onPress={() => toggleSyncPickerSelected(key)}>
                      <TouchableOpacity 
                        style={{ width: isTablet ? 56 : 44, height: isTablet ? 56 : 44, borderRadius: scaleSpacing(6), marginRight: scaleSpacing(10), backgroundColor: isVideo ? '#1a1a2e' : '#1e3a2e', alignItems: 'center', justifyContent: 'center' }}
                        onPress={(e) => {
                          e.stopPropagation();
                          if (it && it.thumbUri) {
                            setSyncPickerPreview({ uri: it.thumbUri, filename: displayName });
                          }
                        }}
                        disabled={!it || !it.thumbUri}
                        activeOpacity={it && it.thumbUri ? 0.7 : 1}>
                        {it && it.thumbUri ? (
                          <Image source={{ uri: it.thumbUri }} style={{ width: '100%', height: '100%', borderRadius: scaleSpacing(6) }} />
                        ) : (
                          <Text style={{ fontSize: scale(22) }}>{fileIcon}</Text>
                        )}
                      </TouchableOpacity>
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
                }}
                ListFooterComponent={() => (
                  <View style={{ width: '100%', paddingVertical: 12, paddingHorizontal: scaleSpacing(12), alignItems: 'center' }}>
                    {syncPickerLoadingMore ? (
                      <ActivityIndicator size={isTablet ? 'large' : 'small'} color={THEME.accent} />
                    ) : (
                      <View style={{ height: 8 }} />
                    )}
                  </View>
                )}
              />
            ) : (
              <FlatList
                data={syncPickerItems || []}
                keyExtractor={(it, idx) => String((it && it.filename) ? it.filename : idx)}
                numColumns={isTablet ? 4 : 3}
                contentContainerStyle={{ padding: scaleSpacing(10) }}
                columnWrapperStyle={{ justifyContent: 'space-between' }}
                removeClippedSubviews={Platform.OS === 'android'}
                initialNumToRender={24}
                maxToRenderPerBatch={24}
                windowSize={7}
                onEndReachedThreshold={0.7}
                onEndReached={() => {
                  if (syncPickerHasMore && !syncPickerLoadingMore) {
                    loadMoreSyncPickerItems();
                  }
                }}
                renderItem={({ item: it }) => {
                  const key = String(it && it.filename ? it.filename : '');
                  if (!key) return null;
                  const selected = !!(syncPickerSelected && syncPickerSelected[key]);
                  const ext = (key || '').split('.').pop()?.toLowerCase() || '';
                  const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'm4v', '3gp', 'webm'].includes(ext);
                  const thumbUri = it.thumbUri;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.pickerItem, selected && styles.pickerItemSelectedGreen]}
                      onPress={() => toggleSyncPickerSelected(key)}>
                      <View style={[styles.pickerThumb, { backgroundColor: isVideo ? '#1a1a2e' : '#1e3a2e', alignItems: 'center', justifyContent: 'center' }]}>
                        {thumbUri && (
                          <Image
                            source={{ uri: thumbUri }}
                            style={[styles.pickerThumb, { position: 'absolute', top: 0, left: 0 }]}
                          />
                        )}
                        <Text style={{ fontSize: 10, color: '#444', textAlign: 'center' }}>{isVideo ? '🎬' : '📷'}</Text>
                      </View>
                      {isVideo && (
                        <View style={styles.pickerBadge}>
                          <Text style={styles.pickerBadgeText}>{t('picker.video')}</Text>
                        </View>
                      )}
                      {selected && (
                        <View style={styles.pickerCheckGreen}>
                          <Text style={styles.pickerCheckText}>✓</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                }}
                ListFooterComponent={() => (
                  <View style={{ width: '100%', paddingVertical: 12, paddingHorizontal: scaleSpacing(12), alignItems: 'center' }}>
                    {syncPickerLoadingMore ? (
                      <ActivityIndicator size="small" color={THEME.accent} />
                    ) : (
                      <View style={{ height: 8 }} />
                    )}
                  </View>
                )}
              />
            )}
          </View>
        </View>
      )}

      {/* Sync Picker Thumbnail Preview Modal */}
      {syncPickerPreview && (
        <Modal
          visible={true}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setSyncPickerPreview(null)}>
          <TouchableOpacity 
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' }}
            activeOpacity={1}
            onPress={() => setSyncPickerPreview(null)}>
            <View style={{ width: '90%', maxWidth: 400, backgroundColor: '#1a1a1a', borderRadius: scaleSpacing(12), overflow: 'hidden' }}>
              <Image 
                source={{ uri: syncPickerPreview.uri }} 
                style={{ width: '100%', aspectRatio: 1, resizeMode: 'contain', backgroundColor: '#000' }} 
              />
              <View style={{ padding: scaleSpacing(12), borderTopWidth: 1, borderTopColor: '#333' }}>
                <Text style={{ color: '#fff', fontSize: scale(13), textAlign: 'center' }} numberOfLines={2} ellipsizeMode="middle">
                  {syncPickerPreview.filename}
                </Text>
              </View>
            </View>
            <TouchableOpacity 
              style={{ marginTop: scaleSpacing(16), paddingVertical: scaleSpacing(10), paddingHorizontal: scaleSpacing(24), backgroundColor: '#333', borderRadius: scaleSpacing(8) }}
              onPress={() => setSyncPickerPreview(null)}>
              <Text style={{ color: '#fff', fontSize: scale(14) }}>{t('common.close') || 'Close'}</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}

      {duplicateReview && (() => {
        const CLEANUP_MAGENTA = '#DC1FFF'; // Magenta color for clean duplicates
        return (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' }}>
          {/* Header */}
          <View style={{ paddingTop: Platform.OS === 'ios' ? 50 : 30, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: 'rgba(0,0,0,0.95)' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <TouchableOpacity onPress={() => { setDuplicateReview(null); setStatus(t('status.duplicateScanCancelled')); }} style={{ padding: 8 }}>
                <Text style={{ color: CLEANUP_MAGENTA, fontSize: scale(16), fontWeight: '600' }}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <Text style={{ color: '#FFF', fontSize: scale(16), fontWeight: '700' }}>{t('duplicates.review')}</Text>
              <View style={{ width: 60 }} />
            </View>
            <Text style={{ color: '#888', fontSize: scale(11), textAlign: 'center', marginTop: 4 }} numberOfLines={2} ellipsizeMode="tail">
              {t('duplicates.reviewSubtitle', { count: duplicateReview.duplicateCount, groups: duplicateReview.groupCount })}
            </Text>
          </View>

          {/* Scrollable content - fullscreen */}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}>
            {duplicateReview.groups.map((group) => (
              <View key={`grp-${group.groupIndex}`} style={{ marginBottom: 16, padding: 12, backgroundColor: '#111', borderRadius: 12 }}>
                <Text style={{ color: '#fff', fontWeight: '700', marginBottom: 10, fontSize: scale(14) }}>
                  {group.type === 'similar' ? t('duplicates.similarGroup', { index: group.groupIndex }) : t('duplicates.bestMatchGroup', { index: group.groupIndex })}
                </Text>
                {group.items.map((item, idx) => (
                  <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 6, backgroundColor: '#1a1a1a', padding: 8, borderRadius: 8 }}>
                    {/* Checkbox */}
                    <TouchableOpacity
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
                      style={{ padding: 4 }}
                    >
                      <View style={{
                        width: 24, height: 24, borderRadius: 4,
                        borderWidth: 2, borderColor: item.delete ? CLEANUP_MAGENTA : '#555',
                        backgroundColor: item.delete ? CLEANUP_MAGENTA : 'transparent',
                        justifyContent: 'center', alignItems: 'center'
                      }}>
                        {item.delete && <Text style={{ color: '#FFF', fontSize: 14, fontWeight: '900' }}>✓</Text>}
                      </View>
                    </TouchableOpacity>
                    
                    {/* Thumbnail - tap to zoom */}
                    <TouchableOpacity 
                      onPress={() => setDuplicateZoomImage({ uri: item.uri, filename: item.filename, created: item.created, size: item.size })}
                      style={{ marginLeft: 10 }}
                    >
                      <View style={{ width: 60, height: 60, borderRadius: 8, overflow: 'hidden', backgroundColor: '#222', borderWidth: 2, borderColor: CLEANUP_MAGENTA + '40' }}>
                        {item.uri ? (
                          <Image
                            source={{ uri: item.uri }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                          />
                        ) : null}
                      </View>
                      <Text style={{ color: '#FFF', fontSize: 9, textAlign: 'center', marginTop: 2 }}>{t('duplicates.tapToZoom')}</Text>
                    </TouchableOpacity>
                    
                    {/* File info */}
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ color: '#fff', fontSize: scale(13) }} numberOfLines={1}>{item.filename}</Text>
                      <Text style={{ color: '#888', fontSize: scale(11), marginTop: 2 }}>
                        {new Date(item.created).toLocaleString()}
                      </Text>
                      {item.size ? <Text style={{ color: '#666', fontSize: scale(10) }}>{(item.size / 1024).toFixed(1)} KB</Text> : null}
                    </View>
                    
                    {/* Keep oldest badge */}
                    {idx === 0 && <View style={{ backgroundColor: CLEANUP_MAGENTA + '30', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                      <Text style={{ color: '#FFF', fontSize: scale(10), fontWeight: '600' }}>{t('duplicates.keepOldest')}</Text>
                    </View>}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>

          {/* Bottom action bar */}
          <View style={{ backgroundColor: 'rgba(0,0,0,0.95)', paddingBottom: Platform.OS === 'ios' ? 34 : 60, paddingTop: 12, paddingHorizontal: 16 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#222', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#444' }}
                onPress={() => { setDuplicateReview(null); setStatus(t('status.duplicateScanCancelled')); }}
              >
                <Text style={{ color: '#FFF', fontSize: scale(14), fontWeight: '600' }}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: CLEANUP_MAGENTA, paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}
                onPress={async () => {
                  try {
                    const idsToDelete = [];
                    duplicateReview.groups.forEach(g => {
                      g.items.forEach(it => { if (it.delete) idsToDelete.push(it.id); });
                    });
                    if (idsToDelete.length === 0) {
                      setStatus(t('status.allItemsKept'));
                      setDuplicateReview(null);
                      showCompletionTickBriefly(t('results.allFilesKept'));
                      return;
                    }
                    setStatus(t('status.deletingItems', { count: idsToDelete.length }));

                    // Use batched deletion to avoid crashes with large numbers of files
                    const DuplicateScanner = require('./duplicateScannerOptimized').default;
                    const result = await DuplicateScanner.deleteAssets(idsToDelete, (progress, deleted, total) => {
                      setStatus(t('status.deletingProgress', { deleted, total }));
                    });
                    
                    if (result.deleted > 0) {
                      showResultAlert('clean', { deleted: result.deleted });
                      setStatus(t('status.deletedItems', { count: result.deleted }));
                    } else {
                      setStatus(t('status.deletionCancelled'));
                    }
                  } catch (err) {
                    console.log('Exact Duplicates: Delete error', err?.message || err);
                    setStatus(t('status.deletionFailed'));
                    showDarkAlert(t('alerts.deleteFailed'), err?.message || t('alerts.deleteFailedMessage'));
                  } finally {
                    setDuplicateReview(null);
                    setLoadingSafe(false);
                    setBackgroundWarnEligibleSafe(false);
                    setWasBackgroundedDuringWorkSafe(false);
                  }
                }}
              >
                <Text style={{ color: '#FFF', fontSize: scale(14), fontWeight: '700' }}>{t('duplicates.delete')}</Text>
              </TouchableOpacity>
            </View>
          </View>
          
          {/* Zoom overlay */}
          {duplicateZoomImage && (
            <TouchableOpacity 
              activeOpacity={1}
              onPress={() => setDuplicateZoomImage(null)}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }}
            >
              <Image
                source={{ uri: duplicateZoomImage.uri }}
                style={{ width: '100%', height: '70%' }}
                resizeMode="contain"
              />
              <View style={{ position: 'absolute', bottom: 100, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.8)', padding: 16, borderRadius: 12, alignItems: 'center' }}>
                <Text style={{ color: '#FFF', fontSize: scale(15), fontWeight: '600', textAlign: 'center' }}>{duplicateZoomImage.filename}</Text>
                <Text style={{ color: '#AAA', fontSize: scale(12), marginTop: 4, textAlign: 'center' }}>
                  {new Date(duplicateZoomImage.created).toLocaleString()}
                </Text>
                {duplicateZoomImage.size ? <Text style={{ color: '#888', fontSize: scale(11), marginTop: 2, textAlign: 'center' }}>{(duplicateZoomImage.size / 1024).toFixed(1)} KB</Text> : null}
              </View>
              <Text style={{ position: 'absolute', top: Platform.OS === 'ios' ? 60 : 40, color: '#FFF', fontSize: scale(14) }}>{t('duplicates.tapToClose')}</Text>
            </TouchableOpacity>
          )}
        </View>
        );
      })()}

      {customAlert && (
        <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.97)', zIndex: 9999 }]}>
          <View style={[styles.overlayCard, { backgroundColor: '#000000', maxWidth: isTablet ? 450 : 320 }]}>
            <Text style={[styles.overlayTitle, { fontSize: scale(18), marginBottom: scaleSpacing(8) }]}>{customAlert.title}</Text>
            <Text style={{ color: '#FFFFFF', fontSize: scale(14), textAlign: 'center', marginBottom: scaleSpacing(20), lineHeight: scale(20) }}>{customAlert.message}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: scaleSpacing(12), flexWrap: 'wrap' }}>
              {(customAlert.buttons || []).map((btn, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.overlayBtnPrimary, { paddingVertical: scaleSpacing(10), paddingHorizontal: scaleSpacing(16), minWidth: isTablet ? 100 : 70 }]}
                  onPress={() => {
                    closeDarkAlert();
                    if (btn.onPress) btn.onPress();
                  }}>
                  <Text style={styles.overlayBtnPrimaryText} numberOfLines={1}>{btn.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}

      {paywallTierGb && (
        <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
          <View style={[styles.overlayCard, glassModeEnabled && styles.overlayCardGlass, { backgroundColor: glassModeEnabled ? 'rgba(30, 30, 30, 0.9)' : '#1E1E1E', maxWidth: isTablet ? 480 : 340 }]}>
            {(() => {
              const gb = paywallTierGb;
              const plan = availablePlans.find(p => p.tierGb === gb);
              const priceStr = plan ? plan.priceString : '—';
              const currentPlan = stealthUsage?.planGb || stealthUsage?.plan_gb;
              const isCurrent = currentPlan === gb;
              const canSubscribe = !purchaseLoading && plan && priceStr && priceStr !== '—';
              const title = gb === 1000 ? t('subscription.storage1000Monthly') : t('subscription.storageGbMonthly', { gb });

              return (
                <>
                  <Text style={[styles.overlayTitle, { fontSize: scale(18), marginBottom: scaleSpacing(8) }]}>{title}</Text>
                  <Text style={{ color: '#CCC', fontSize: scale(14), textAlign: 'center', marginBottom: scaleSpacing(14), lineHeight: scale(20) }}>
                    {priceStr !== '—' ? t('subscription.pricePerMonth', { price: priceStr }) : t('subscription.pricingUnavailable')}
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: scaleSpacing(12), flexWrap: 'wrap' }}>
                    <TouchableOpacity
                      style={[styles.overlayBtnPrimary, glassModeEnabled && styles.overlayBtnPrimaryGlass, { paddingVertical: scaleSpacing(10), paddingHorizontal: scaleSpacing(24), minWidth: isTablet ? 110 : 90, opacity: purchaseLoading ? 0.6 : 1 }]}
                      onPress={closePaywall}
                      disabled={purchaseLoading}
                    >
                      <Text style={styles.overlayBtnPrimaryText}>{t('common.close')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.overlayBtnPrimary, glassModeEnabled && styles.overlayBtnPrimaryGlass, { paddingVertical: scaleSpacing(10), paddingHorizontal: scaleSpacing(24), minWidth: isTablet ? 130 : 110, opacity: canSubscribe ? 1 : 0.5 }]}
                      onPress={() => {
                        if (!canSubscribe) return;
                        closePaywall();
                        handlePurchase(gb);
                      }}
                      disabled={!canSubscribe}
                    >
                      <Text style={styles.overlayBtnPrimaryText}>{isCurrent ? t('subscription.currentPlan') : t('subscription.subscribe')}</Text>
                    </TouchableOpacity>
                  </View>

                  {false && (
                    <TouchableOpacity
                      style={[styles.restorePurchasesBtn, { marginTop: scaleSpacing(14) }]}
                      onPress={() => {
                        closePaywall();
                        handleRestorePurchases();
                      }}
                      disabled={purchaseLoading}
                    >
                      <Text style={styles.restorePurchasesText}>{t('subscription.restorePurchases')}</Text>
                    </TouchableOpacity>
                  )}
                  <Text style={{ color: '#888', fontSize: scale(11), textAlign: 'center', marginTop: scaleSpacing(12), lineHeight: scale(16) }}>
                    {t('subscription.autoRenewNote')}
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: scaleSpacing(16), marginTop: scaleSpacing(8) }}>
                    <TouchableOpacity onPress={() => Linking.openURL('https://viktorvishyn369.github.io/PhotoLynk/terms.html')}>
                      <Text style={{ color: '#03E1FF', fontSize: scale(11), textDecorationLine: 'underline' }}>{t('subscription.termsOfUse')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => Linking.openURL('https://viktorvishyn369.github.io/PhotoLynk/privacy-policy.html')}>
                      <Text style={{ color: '#03E1FF', fontSize: scale(11), textDecorationLine: 'underline' }}>{t('subscription.privacyPolicy')}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      )}

      {/* NFT Photo Picker */}
      <NFTPhotoPicker
        visible={nftPickerOpen}
        onClose={closeNftPicker}
        onSelectPhoto={handleMintNFT}
        resolveReadableFilePath={resolveReadableFilePath}
        serverConfig={{ baseUrl: getServerUrl(), getAuthHeaders }}
        checkCloudEligibility={(fileSize) => checkStealthCloudEligibility({ baseUrl: getServerUrl(), getAuthHeaders }, fileSize)}
      />

      {/* NFT Gallery */}
      <NFTGallery
        visible={nftGalleryOpen}
        onClose={closeNftGallery}
        onTransferNFT={handleNftTransfer}
        serverUrl={getServerUrl()}
        getAuthHeaders={getAuthHeaders}
        refreshKey={nftGalleryRefreshKey}
        onShowCertificate={(mintAddress) => {
          setNftGalleryOpen(false);
          setPendingCertMint(mintAddress);
          setNftCertsOpen(true);
        }}
        pendingSelectMint={pendingNftMint}
        onPendingSelectConsumed={() => setPendingNftMint(null)}
        onNftCountChange={(count) => setQsNftCount(count)}
      />

      {/* Certificates Viewer */}
      <CertificatesViewer
        visible={nftCertsOpen}
        onClose={() => setNftCertsOpen(false)}
        serverUrl={getServerUrl()}
        getAuthHeaders={getAuthHeaders}
        onShowNFT={(mintAddress) => {
          setNftCertsOpen(false);
          setPendingNftMint(mintAddress);
          setNftGalleryOpen(true);
        }}
        pendingSelectMint={pendingCertMint}
        onPendingSelectConsumed={() => setPendingCertMint(null)}
      />

      {/* NFT Transfer Modal */}
      <NFTTransferModal
        visible={nftTransferOpen}
        nft={nftToTransfer}
        onClose={closeNftTransfer}
        onTransferComplete={handleNftTransferComplete}
        authToken={token}
      />

    </View>
  );

}
