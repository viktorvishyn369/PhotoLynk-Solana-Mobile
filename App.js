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
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
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
  buildLocalDeduplicationIndex,
} from './syncManager';
import { fetchStealthCloudPickerPage, fetchLocalRemotePickerPage } from './syncPickerOperations';
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

// Constants moved from inline definitions
const APP_DISPLAY_NAME = 'PhotoLynk';
const LEGACY_APP_DISPLAY_NAME = 'PhotoSync';
const PHOTOLYNK_QR_SCHEMA = 'photolynk';
const LOCAL_SERVER_QR_SCHEMA = 'photolynk_local';
const REMOTE_SERVER_QR_SCHEMA = 'photolynk_remote';
const GITHUB_RELEASES_LATEST_URL = 'https://github.com/viktorvishyn369/PhotoLynk/releases/latest';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const { MediaDelete } = NativeModules;

const CLIENT_BUILD = `photolynk-mobile-v2/${Application.nativeApplicationVersion || '0'}(${Application.nativeBuildVersion || '0'}) sc-debug-2025-12-13`;

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
  const [glassModeEnabled, setGlassModeEnabled] = useState(false);
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
  const SYNC_PICKER_PAGE_SIZE = 18; // Items per page
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
  const [progressAction, setProgressAction] = useState(null); // 'cleanup' | 'backup' | 'sync' | null
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
  const setLoadingSafe = (value) => { loadingRef.current = !!value; setLoading(!!value); };

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

        // Save to SecureStore
        await SecureStore.setItemAsync('local_host', serverIp);
        await SecureStore.setItemAsync('server_type', 'local');

        showDarkAlert(
          'Connected!',
          'Server IP set to ' + serverIp + ':' + parsed.port + (parsed.name ? '\n\nServer: ' + parsed.name : '')
        );
      } else if (parsed.type === 'photolynk-decrypt' && parsed.sessionId && parsed.server) {
        // Web portal decryption request - connect via WebSocket
        setQrScannerOpen(false);
        await handleWebPortalDecryption(parsed.sessionId, parsed.server);
      } else {
        showDarkAlert('Invalid QR Code', 'This QR code is not from PhotoLynk Server.');
      }
    } catch (e) {
      showDarkAlert('Invalid QR Code', 'Could not parse QR code data.');
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
        showDarkAlert('Not Logged In', 'Please log in first to enable web portal decryption.');
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
        showDarkAlert('Connected!', 'Your phone is now connected to the web portal.\n\nYou can view your decrypted files in the browser.');
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showDarkAlert('Connection Failed', 'Could not connect to web portal. Please try again.');
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
      showDarkAlert('Error', 'Failed to connect to web portal.');
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
    setCustomAlert({
      title,
      message,
      buttons: buttons || [{ text: 'OK', onPress: () => setCustomAlert(null) }]
    });
  };
  const closeDarkAlert = () => setCustomAlert(null);

  // Standardized result popup for backup/sync/cleanup operations
  const showResultAlert = (type, stats) => {
    const { title, message } = buildResultMessage(type, stats);
    showDarkAlert(title, message);
  };

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

  const persistGlassModeEnabled = (enabled) => {
    setGlassModeEnabled(enabled);
    SecureStore.setItemAsync('glass_mode_enabled', enabled ? 'true' : 'false').catch(() => {});
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
      const res = await axios.get(`${base}/api/cloud/usage`, { ...config, timeout: 10000 });
      const data = res && res.data ? res.data : null;
      setStealthUsage(data);
      return data;
    } catch (e) {
      console.log('Failed to refresh usage:', e?.message);
      return null;
    }
  };

  const handlePurchase = async (tierGb) => {
    try {
      setPurchaseLoading(true);
      setStatus('Processing purchase...');

      // Get auth token for server authentication
      let authToken = token;
      if (!authToken) {
        try {
          authToken = await SecureStore.getItemAsync('auth_token');
        } catch (e) {}
      }
      if (!authToken) {
        showDarkAlert('Error', 'Not logged in. Please logout and login again.');
        setPurchaseLoading(false);
        setStatus('Idle');
        return;
      }

      const result = await purchaseSubscription(tierGb, authToken);

      if (result.success) {
        showDarkAlert('Success!', `Your ${tierGb === 1000 ? '1 TB' : tierGb + ' GB'} plan is now active.`);
        await refreshSubscriptionStatus();
        await refreshStealthUsage();
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

      // Get auth token and device UUID for server check
      let authToken = token;
      if (!authToken) {
        try {
          authToken = await SecureStore.getItemAsync('auth_token');
        } catch (e) {}
      }
      let userUuid = deviceUuid;
      if (!userUuid) {
        try {
          userUuid = await SecureStore.getItemAsync('device_uuid');
        } catch (e) {}
      }

      const result = await restorePurchases(authToken, userUuid);

      if (result.success && result.hasActiveSubscription) {
        showDarkAlert('Restored!', 'Your subscription has been restored.');
        await refreshSubscriptionStatus();
        await refreshStealthUsage();
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
          existingManifests = await fetchAllManifestsPaged(SERVER_URL, config);
        } catch (e) {
          existingManifests = [];
        }
        let already = new Set(existingManifests.map(m => m.manifestId));

        // Build deduplication sets for cross-device duplicate detection (auto-upload has more time)
        const alreadyFilenames = new Set();
        const alreadyBaseFilenames = new Set();
        const alreadyBaseNameSizes = new Map(); // baseFilename -> Set of sizes
        const alreadyBaseNameDates = new Map(); // baseFilename -> Set of date strings (YYYY-MM-DD)
        const alreadyBaseNameTimestamps = new Map(); // baseFilename -> Set of full timestamps (YYYY-MM-DDTHH:MM:SS) for HEIC
        const alreadyPerceptualHashes = new Set();
        const alreadyFileHashes = new Set();
        // EXIF-based deduplication sets for cross-platform HEIC matching
        const alreadyExifFull = new Set(); // captureTime|make|model (highest confidence)
        const alreadyExifTimeModel = new Set(); // captureTime|model
        const alreadyExifTimeMake = new Set(); // captureTime|make
        if (existingManifests.length > 0) {
          setStatus('Auto-Backup: Preparing...');
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
                  // Add base filename for variant matching
                  const baseName = extractBaseFilename(manifest.filename);
                  if (baseName) {
                    alreadyBaseFilenames.add(baseName);
                    // Build size map for fallback matching
                    if (manifest.originalSize) {
                      if (!alreadyBaseNameSizes.has(baseName)) alreadyBaseNameSizes.set(baseName, new Set());
                      alreadyBaseNameSizes.get(baseName).add(manifest.originalSize);
                    }
                    // Build date map for fallback matching
                    if (manifest.creationTime) {
                      const dateStr = normalizeDateForCompare(manifest.creationTime);
                      if (dateStr) {
                        if (!alreadyBaseNameDates.has(baseName)) alreadyBaseNameDates.set(baseName, new Set());
                        alreadyBaseNameDates.get(baseName).add(dateStr);
                      }
                      // Build full timestamp map for HEIC deduplication (second-level precision)
                      const fullTimestamp = normalizeFullTimestamp(manifest.creationTime);
                      if (fullTimestamp) {
                        if (!alreadyBaseNameTimestamps.has(baseName)) alreadyBaseNameTimestamps.set(baseName, new Set());
                        alreadyBaseNameTimestamps.get(baseName).add(fullTimestamp);
                      }
                    }
                  }
                }
                // If manifest has perceptualHash, it's an image - use perceptual hash
                if (manifest.perceptualHash) {
                  alreadyPerceptualHashes.add(manifest.perceptualHash);
                }
                // Always add fileHash if present (for both images and videos)
                // Images need fileHash for byte-identical dedup (AirDrop, copies)
                if (manifest.fileHash) {
                  alreadyFileHashes.add(manifest.fileHash);
                }
                // Build EXIF-based deduplication keys from manifest
                // These are the real EXIF values extracted from the original file during upload
                if (manifest.exifCaptureTime) {
                  const ct = manifest.exifCaptureTime;
                  const mk = manifest.exifMake;
                  const md = manifest.exifModel;
                  // Generate dedup keys at different confidence levels
                  if (ct && mk && md) alreadyExifFull.add(`${ct}|${mk}|${md}`);
                  if (ct && md) alreadyExifTimeModel.add(`${ct}|${md}`);
                  if (ct && mk) alreadyExifTimeMake.add(`${ct}|${mk}`);
                }
              }
            } catch (e) {
              // Skip manifests we can't decrypt
            }
          }
          console.log(`AutoUpload: found ${alreadyFilenames.size} filenames, ${alreadyBaseFilenames.size} base names, ${alreadyBaseNameSizes.size} name+size, ${alreadyBaseNameDates.size} name+date, ${alreadyBaseNameTimestamps.size} name+timestamp, ${alreadyPerceptualHashes.size} perceptual hashes, ${alreadyFileHashes.size} file hashes, ${alreadyExifFull.size} EXIF keys for deduplication`);
          // Debug: log some sample filenames to verify they're being collected
          const sampleFilenames = Array.from(alreadyFilenames).slice(0, 5);
          console.log(`AutoUpload: sample filenames in set: ${JSON.stringify(sampleFilenames)}`);
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
                  setStatus('Auto-Backup: Complete');
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
              setStatus('Auto-Backup: Complete');
              console.log('AutoUpload: showing completion message');
            } else {
              setStatus(`Auto-Backup: ${cumulativeUploaded} of ${totalEstimatedCount}`);
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

            console.log('AutoUpload: attempting upload for asset:', asset.id);
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
                    setStatus(`Auto-Backup: ${cumulativeUploaded + 1} of ${totalEstimatedCount}`);
                  }
                }
              }
            });
            if (r && r.uploaded) {
              uploaded += 1;
              cumulativeUploaded += 1;
              if (r.manifestId) already.add(r.manifestId);
              // Update status with current progress (only if not cancelled)
              if (totalEstimatedCount !== null && !autoUploadNightRunnerCancelRef.current && autoUploadEnabledRef.current) {
                setStatus(`Auto-Backup: ${cumulativeUploaded} of ${totalEstimatedCount}`);
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
              setStatus('Auto-Backup: Pausing...');
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
              setStatus('Auto-Backup: Complete');
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

    await cancelInFlightOperations();
    const opId = currentOperationIdRef.current;
    setLoadingSafe(true);
    setBackgroundWarnEligibleSafe(!autoUploadEnabledRef.current);
    setWasBackgroundedDuringWorkSafe(false);
    setProgress(0);
    setProgressAction('backup');

    if (Platform.OS === 'ios') {
      const ap = await getMediaLibraryAccessPrivileges(permission);
      if (ap && ap !== 'all') {
        setStatus('Limited Photos access (Selected Photos). Backing up accessible items...');
      }
    }

    if (!(await ensureAutoUploadPolicyAllowsWork({ userInitiated: true }))) {
      return;
    }

    const list = Array.isArray(assets) ? assets.filter(a => a && a.id) : [];
    if (list.length === 0) {
      showDarkAlert('Select items', 'Choose photos & videos to back up.');
      return;
    }

    try {
      const result = await stealthCloudBackupSelectedCore({
        assets: list,
        getAuthHeaders,
        getServerUrl,
        ensureStealthCloudUploadAllowed,
        ensureAutoUploadPolicyAllowsWorkIfBackgrounded,
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
        showDarkAlert('Select items', 'Choose photos & videos to back up.');
        return;
      }

      const { uploaded, skipped, failed } = result;

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
      setStatus('Backup complete');
      showResultAlert('backup', { uploaded, skipped, failed });
    } catch (e) {
      console.error('StealthCloud backup error:', e);
      setStatus('Backup error');
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
      showDarkAlert('Select items', 'Choose photos & videos to back up.');
      return;
    }

    await cancelInFlightOperations();
    if (!(await ensureAutoUploadPolicyAllowsWork({ userInitiated: true }))) {
      return;
    }

    if (serverType === 'stealthcloud') {
      return stealthCloudBackupSelected({ assets: list });
    }

    setLoadingSafe(true);
    setBackgroundWarnEligibleSafe(!autoUploadEnabledRef.current);
    setWasBackgroundedDuringWorkSafe(false);
    setProgress(0);
    setProgressAction('backup');

    try {
      const result = await localRemoteBackupSelectedCore({
        assets: list,
        getAuthHeaders,
        getServerUrl,
        resolveReadableFilePath,
        ensureAutoUploadPolicyAllowsWorkIfBackgrounded,
        onStatus: setStatus,
        onProgress: setProgress,
      });

      if (result.permissionDenied) {
        showDarkAlert('Permission needed', 'We need access to photos to back them up.');
        return;
      }

      if (result.noSelection) {
        showDarkAlert('Select items', 'Choose photos & videos to back up.');
        return;
      }

      if (result.alreadyBackedUp) {
        setStatus('Up to date');
        showDarkAlert('Up to Date', 'All selected items are already on the server (or were excluded).');
        return;
      }

      setStatus('Backup complete');
      showResultAlert('backup', { uploaded: result.uploaded, skipped: result.skipped, failed: result.failed });
    } catch (error) {
      setStatus('Backup error');
      showResultAlert('backup', { error: error && error.message ? error.message : 'Unknown error' });
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
    await cancelInFlightOperations();
    const opId = currentOperationIdRef.current;
    setBackgroundWarnEligibleSafe(false); setWasBackgroundedDuringWorkSafe(false); setLoadingSafe(true);
    setProgress(0);
    setProgressAction('cleanup');
    
    const result = await startSimilarShotsReviewCore({
      resolveReadableFilePath,
      onStatus: (s) => setStatusSafe(opId, s),
      onProgress: (p) => setProgressSafe(opId, p),
      abortRef: abortOperationsRef,
    });

    if (result.aborted) {
      setLoadingSafe(false);
      return;
    }

    if (result.error) {
      setLoadingSafe(false);
      showDarkAlert('Similar Photos', result.error);
      return;
    }

    if (result.noGroups) {
      setStatus('No similar photos found');
      showDarkAlert('Similar Photos', 'No similar photo groups found.');
      setLoadingSafe(false);
      return;
    }

    setLoadingSafe(false);
    openSimilarGroup({ groups: result.groups, index: 0 });
  };

  const openSyncPicker = async () => {
    if (loadingRef.current) return;
    resetSyncPickerState(); setSyncPickerOpen(true); setSyncPickerLoading(true);
    try {
      // Ensure media library permission before listing local assets
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission || permission.status !== 'granted') {
        showDarkAlert('Sync list failed', 'Photos permission is required to list local media.');
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
        const result = await fetchStealthCloudPickerPage({
          config, SERVER_URL, masterKey, offset: 0, limit: SYNC_PICKER_PAGE_SIZE
        });
        setSyncPickerItems(result.items);
        setSyncPickerTotal(result.total);
        setSyncPickerOffset(result.nextOffset);
      } else {
        const result = await fetchLocalRemotePickerPage({
          config, SERVER_URL, offset: 0, limit: SYNC_PICKER_PAGE_SIZE
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

        if (serverType === 'stealthcloud') {
          const masterKey = await getStealthCloudMasterKey();
          const result = await fetchStealthCloudPickerPage({
            config, SERVER_URL, masterKey, offset: syncPickerOffset, limit: SYNC_PICKER_PAGE_SIZE
          });
          if (result.total !== syncPickerTotal) setSyncPickerTotal(result.total);
          setSyncPickerOffset(result.nextOffset);
          if (result.items.length > 0) {
            setSyncPickerItems(prev => [...prev, ...result.items]);
          }
        } else {
          const result = await fetchLocalRemotePickerPage({
            config, SERVER_URL, offset: syncPickerOffset, limit: SYNC_PICKER_PAGE_SIZE
          });
          if (result.total !== syncPickerTotal) setSyncPickerTotal(result.total);
          setSyncPickerOffset(result.nextOffset);
          if (result.items.length > 0) {
            setSyncPickerItems(prev => [...prev, ...result.items]);
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
    checkLogin();
    // Clear sync picker state on app launch to prevent stale data
    resetSyncPickerState();
  }, []);

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
    setProgressAction(null);
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
  const getStealthCloudTierStatus = (tierGb) => checkTierAvailability(tierGb, stealthCapacity);

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

    let cancelled = false;

    const fetchStealthCloudUsage = async () => {
      // Check serverType from state or SecureStore
      let effectiveServerType = serverType;
      if (!effectiveServerType || effectiveServerType === 'local') {
        try {
          const storedType = await SecureStore.getItemAsync('server_type');
          if (storedType) effectiveServerType = storedType;
        } catch (e) {}
      }

      console.log('[StealthCloud] fetchUsage - serverType:', effectiveServerType, 'token:', token ? 'present' : 'null');

      if (effectiveServerType !== 'stealthcloud') return;

      // Get token from state or SecureStore
      let effectiveToken = token;
      if (!effectiveToken) {
        try {
          effectiveToken = await SecureStore.getItemAsync('auth_token');
        } catch (e) {}
      }

      if (!effectiveToken) {
        console.log('[StealthCloud] No token, skipping usage fetch');
        return;
      }

      try {
        setStealthUsageLoading(true);
        setStealthUsageError(null);

        // Small delay to ensure auth state is fully settled after login
        await new Promise(resolve => setTimeout(resolve, 100));
        if (cancelled) return;

        const config = await getAuthHeaders();
        const base = getServerUrl();
        console.log('[StealthCloud] Fetching usage from:', `${base}/api/cloud/usage`);
        const res = await axios.get(`${base}/api/cloud/usage`, { ...config, timeout: 10000 });
        const data = res && res.data ? res.data : null;
        console.log('[StealthCloud] Usage data received:', JSON.stringify(data, null, 2));
        if (cancelled) return;
        setStealthUsage(data);
      } catch (e) {
        if (cancelled) return;
        console.log('[StealthCloud] Usage fetch error:', e?.message);
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
   */
  const stealthCloudBackup = async () => {
    if (!(await ensureAutoUploadPolicyAllowsWork({ userInitiated: true }))) {
      return;
    }

    await cancelInFlightOperations();
    const opId = currentOperationIdRef.current;
    setLoadingSafe(true);
    setBackgroundWarnEligibleSafe(!autoUploadEnabledRef.current);
    setWasBackgroundedDuringWorkSafe(false);
    setProgress(0);
    setProgressAction('backup');

    try {
      const result = await stealthCloudBackupCore({
        getAuthHeaders,
        getServerUrl,
        ensureStealthCloudUploadAllowed,
        ensureAutoUploadPolicyAllowsWorkIfBackgrounded,
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
        showDarkAlert('Permission needed', 'We need access to photos to back them up.');
        return;
      }

      if (result.notAllowed) {
        return;
      }

      if (result.noFiles) {
        setProgress(1);
        setStatus('No files on device');
        await sleep(1500);
        setStatus('Idle');
        setProgress(0);
        return;
      }

      const { uploaded, skipped, failed } = result;

      if (uploaded === 0 && skipped === 0 && failed === 0) {
        setProgress(1);
        setStatus('No files on device');
        await sleep(1000);
        setProgress(0);
        return;
      }

      setProgress(1);
      await sleep(300);
      setStatus('Backup complete');
      showResultAlert('backup', { uploaded, skipped, failed });
    } catch (e) {
      console.error('StealthCloud backup error:', e);
      setStatus('Backup error');
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
    setBackgroundWarnEligibleSafe(true);
    setWasBackgroundedDuringWorkSafe(false);
    setProgress(0);
    setProgressAction('sync');
    setStatus('Preparing sync...');

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

    try {
      const restoreHistory = await loadRestoreHistory();
      const config = await getAuthHeaders();
      const SERVER_URL = getServerUrl();
      const masterKey = await getStealthCloudMasterKey();

      // Check if device is empty first
      const localIndex = await buildLocalFilenameSetPaged({ mediaType: ['photo', 'video'] });
      const localFilenames = localIndex.set;
      const isEmptyDevice = localIndex.scanned === 0;

      // Build local deduplication index (both iOS and Android need hash-based dedup)
      let localManifestIds = new Set();
      let localFileHashes = new Set();
      let localPerceptualHashes = new Set();
      let localBaseNameSizes = new Map();
      let localBaseNameDates = new Map();

      if (localIndex.scanned > 0) {
        setStatus(`Analyzing 1/${localIndex.scanned} photos...`);
        const dedupIndex = await buildLocalDeduplicationIndex({
          totalToScan: localIndex.scanned,
          resolveReadableFilePath,
          onStatus: setStatus,
          onProgress: setProgress,
        });
        localManifestIds = dedupIndex.localManifestIds;
        localFileHashes = dedupIndex.localFileHashes;
        localPerceptualHashes = dedupIndex.localPerceptualHashes;
        localBaseNameSizes = dedupIndex.localBaseNameSizes;
        localBaseNameDates = dedupIndex.localBaseNameDates;
        setProgress(1);
        await new Promise(r => setTimeout(r, 500));
      } else {
        setStatus('Preparing sync...');
        setProgress(1);
        await new Promise(r => setTimeout(r, 800));
      }

      // Syncing phase starts fresh at 0%

      const result = await stealthCloudRestoreCore({
        config,
        SERVER_URL,
        masterKey,
        localFilenames,
        localManifestIds,
        localFileHashes,
        localPerceptualHashes,
        localBaseNameSizes,
        localBaseNameDates,
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
        setStatus('No files to sync');
        await sleep(800);
        showDarkAlert('No Backups', 'No StealthCloud backups found for this account.');
        await sleep(500);
        setProgress(0);
        return;
      }

      setProgress(1);
      await sleep(300);
      setStatus('Sync complete');
      showResultAlert('sync', { downloaded: result.restored, skipped: result.skipped, failed: result.failed });
    } catch (e) {
      console.error('StealthCloud restore error:', e);
      setStatus('Sync error');
      showResultAlert('sync', { error: e && e.message ? e.message : 'Unknown error' });
    } finally {
      setLoadingSafe(false);
      setBackgroundWarnEligibleSafe(false);
      setProgress(0);
    }
  };

  const getServerUrl = () => computeServerUrl(serverType, localHost, remoteHost);

  const checkLogin = async () => {
    try {
    // Detect first launch after reinstall and clear old credentials
    const isFirstLaunchAfterReinstall = await checkFirstLaunchAfterReinstall();

    // Load server settings using helper
    const serverSettings = await loadServerSettings();
    if (serverSettings.savedType) setServerType(serverSettings.savedType);
    if (serverSettings.savedLocalHost) setLocalHost(serverSettings.savedLocalHost);
    if (serverSettings.normalizedRemoteHost) setRemoteHost(serverSettings.normalizedRemoteHost);

    // Auto Upload UI is hidden for now; prevent auto-start on app relaunch.
    // Force it OFF even if it was previously enabled.
    try { await SecureStore.setItemAsync('auto_upload_enabled', 'false'); } catch (e) {}
    setAutoUploadEnabledSafe(false);

    const savedFastMode = await SecureStore.getItemAsync('fast_mode_enabled');
    if (savedFastMode === 'true' || savedFastMode === 'false') {
      setFastModeEnabledSafe(savedFastMode === 'true');
    }

    const savedGlassMode = await SecureStore.getItemAsync('glass_mode_enabled');
    if (savedGlassMode === 'true' || savedGlassMode === 'false') {
      setGlassModeEnabled(savedGlassMode === 'true');
    }

    // If first launch after reinstall, skip auto-login and show login screen
    if (isFirstLaunchAfterReinstall) {
      console.log('[FirstLaunch] Skipping auto-login - showing login screen');
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
          setStatus('Securing session...');
          await cacheStealthCloudMasterKey(storedEmail, validationResult.savedPassword);
        }
        setTokenSafe(storedToken);
        if (storedUserId) setUserId(parseInt(storedUserId));
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

      setStatus('Securing session...');
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
    setLoadingSafe(true);
    resetAuthLoadingLabel(loginStatusTimerRef, loginLabelTimerRef, setAuthLoadingLabel, type === 'register' ? 'Creating account...' : 'Signing in...');

    try {
      // Step 1: Bonding device
      setAuthLoadingLabel('Bonding device...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Resolve and persist effective server settings
      const { effectiveType, effectiveLocalHost, effectiveRemoteHost } = await resolveEffectiveServerSettings({
        serverType, localHost, remoteHost
      });
      await persistServerSettings({ effectiveType, effectiveLocalHost, effectiveRemoteHost });

      // Ensure in-memory state matches what we used.
      if (serverType !== effectiveType) setServerType(effectiveType);
      if (effectiveType === 'local' && localHost !== effectiveLocalHost) setLocalHost(effectiveLocalHost);
      if (effectiveType === 'remote' && remoteHost !== effectiveRemoteHost) setRemoteHost(effectiveRemoteHost);

      // Device UUID is derived from email+password and persisted.
      const deviceId = await getDeviceUUID(normalizedEmail, password);
      await new Promise(resolve => setTimeout(resolve, 200));
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

      // Build auth payload with hardware device ID for registration
      const payload = await buildAuthPayload({
        type,
        normalizedEmail,
        password,
        deviceId,
        effectiveType,
        selectedStealthPlanGb,
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

      // Step 2: Generating token / Authenticating with retry for StealthCloud
      setAuthLoadingLabel(type === 'register' ? 'Generating token...' : 'Authenticating...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // StealthCloud retry logic with rotating status messages (server may be rebooting ~2-3 min)
      const STEALTHCLOUD_MAX_RETRIES = 20; // ~3+ minutes of retries
      const STEALTHCLOUD_RETRY_DELAY_MS = 10000; // 10 seconds between retries
      const STEALTHCLOUD_RETRY_MESSAGES = [
        'Connecting...',
        'Establishing connection...',
        'Reaching StealthCloud...',
        'Waiting for server...',
        'Retrying connection...',
        'Still connecting...',
        'Please wait...',
        'Almost there...',
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
        // Local/Remote - no retry, fail immediately
        res = await axios.post(authUrl, payload);
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
        setAuthLoadingLabel('Securing credentials...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        await SecureStore.setItemAsync('auth_token', token);
        await SecureStore.setItemAsync('user_email', normalizedEmail);

        // Store password with biometrics
        await storeCredentialsWithBiometrics({ password, normalizedEmail, type: 'login' });
        if (userId) {
          await SecureStore.setItemAsync('user_id', String(userId));
          setUserId(userId);
        }

        // Step 4: Finalizing (cache master key)
        setAuthLoadingLabel('Finalizing...');
        await cacheStealthCloudMasterKey(normalizedEmail, password);
        await new Promise(resolve => setTimeout(resolve, 500));

        setTokenSafe(token);

        // Auto Upload UI is hidden for now; prevent auto-start after login.
        try { await SecureStore.setItemAsync('auto_upload_enabled', 'false'); } catch (e) {}
        setAutoUploadEnabledSafe(false);

        // Clear logout flag on successful login
        await SecureStore.deleteItemAsync('user_logged_out');

        setAuthMode('login');
        setView('home');
      } else {
        // Registration successful - auto-login immediately
        // Store credentials with biometrics and get token
        const { token, userId } = res.data;

        // Step 3: Securing credentials
        setAuthLoadingLabel('Securing credentials...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Store token
        await SecureStore.setItemAsync('auth_token', token);
        await SecureStore.setItemAsync('user_email', normalizedEmail);

        // Store password with biometrics for future auto-login
        await storeCredentialsWithBiometrics({ password, normalizedEmail, type: 'register' });

        if (userId) {
          await SecureStore.setItemAsync('user_id', String(userId));
          setUserId(userId);
        }

        // Step 4: Finalizing (cache master key)
        setAuthLoadingLabel('Finalizing...');
        await cacheStealthCloudMasterKey(normalizedEmail, password);
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
          'Account Created!',
          'Your account has been successfully created and you are now logged in.',
          [{ text: 'Get Started' }]
        );
      }
    } catch (error) {
      // Only log actual server errors, not Metro bundler noise
      if (error.response) {
        const status = error.response.status;
        console.error('Auth Error:', status, error.response.data);
        
        // 5xx errors after retries exhausted - server is down
        if (status >= 500 && status < 600 && serverType === 'stealthcloud') {
          showDarkAlert(
            'Server Temporarily Unavailable',
            'StealthCloud is currently undergoing maintenance. Please try again in a few minutes.'
          );
        } else {
          showDarkAlert('Error', error.response?.data?.error || 'Connection failed');
        }
      } else if (error.request) {
        console.error('Network Error - cannot reach server', {
          message: error?.message,
          code: error?.code,
          url: error?.config?.url,
          method: error?.config?.method,
          baseURL: error?.config?.baseURL,
        });
        const serverLabel = serverType === 'stealthcloud' ? 'StealthCloud' : 'your local server';
        const hint = serverType === 'stealthcloud' 
          ? 'Please check your internet connection and try again.' 
          : 'Make sure the server is running and both devices are on the same network. Follow Quick Setup below for help.';
        showDarkAlert('Connection Failed', `Cannot reach ${serverLabel}. ${hint}`);
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
   */
  const handleResetPassword = async () => {
    if (!email || !newPassword) {
      showDarkAlert('Error', 'Please enter your email and new password');
      return;
    }

    Keyboard.dismiss();
    setLoadingSafe(true);
    setAuthLoadingLabel('Verifying device...');

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
          showDarkAlert('Different Device', 'Password reset is only available on the device where you created your account.');
        } else if (result.hint === 'no_hardware_id_stored') {
          showDarkAlert('Feature Not Available', 'Password reset is not available for accounts created before this feature was added.');
        } else {
          showDarkAlert('Error', result.error);
        }
        return;
      }

      showDarkAlert('Success', 'Your password has been reset. Please login with your new password.');
      setPassword(newPassword);
      setAuthMode('login');
      setNewPassword('');
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
    await cancelInFlightOperations();
    const opId = currentOperationIdRef.current;
    setBackgroundWarnEligibleSafe(false);
    setWasBackgroundedDuringWorkSafe(false);
    setLoadingSafe(true);
    setProgress(0);
    setProgressAction('cleanup');

    try {
      const result = await startExactDuplicatesScanCore({
        resolveReadableFilePath,
        onStatus: (s) => setStatusSafe(opId, s),
        onProgress: (p) => setProgressSafe(opId, p),
        abortRef: abortOperationsRef,
      });

      if (result.aborted) {
        return;
      }

      if (result.error) {
        if (result.error.includes('Limited')) {
          showDarkAlert('Limited Photos Access', `Clean Duplicates needs Full Access to your Photos library.\n\nGo to Settings → ${APP_DISPLAY_NAME} → Photos → Full Access.`);
        } else if (result.error.includes('permission')) {
          showDarkAlert('Permission needed', 'We need access to photos to safely scan for duplicates.');
        } else {
          showDarkAlert('Error', result.error);
        }
        return;
      }

      if (result.noAssets) {
        showDarkAlert('No Media', 'No photos were found on this device.');
        return;
      }

      if (result.noDuplicates) {
        setStatus('No best matches found');
        showDarkAlert('Best Matches', 'No best matches found.' + (result.note || ''));
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

      setStatus(`Found ${result.totalDuplicates} best photo matches in ${result.groups.length} group${result.groups.length !== 1 ? 's' : ''}`);
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

    // Signal all running operations to abort immediately
    abortOperationsRef.current = true;
    currentOperationIdRef.current += 1; // Invalidate all previous operation callbacks

    // Show signing out spinner
    setLoadingSafe(true);
    setAuthLoadingLabel('Signing out...');

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
    setView('auth');
    
    // Reset progress state on logout
    setProgress(0);
    setProgressAction(null);
    setStatus('Idle');
    
    // Hide spinner after logout complete
    setLoadingSafe(false);
    setAuthLoadingLabel('Signing in...');
    
    // DO NOT reset abort flag here - it must stay true until user starts a new operation
    // The abort flag will be reset by cancelInFlightOperations when a new operation starts
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
    setBackgroundWarnEligibleSafe(!autoUploadEnabledRef.current);
    setWasBackgroundedDuringWorkSafe(false);
    setProgress(0);
    setProgressAction('backup');

    try {
      const result = await localRemoteBackupCore({
        getAuthHeaders,
        getServerUrl,
        resolveReadableFilePath,
        ensureAutoUploadPolicyAllowsWorkIfBackgrounded,
        fastMode: fastModeEnabledRef.current,
        onStatus: (s) => setStatusSafe(opId, s),
        onProgress: (p) => setProgressSafe(opId, p),
      });

      if (result.permissionDenied) {
        showDarkAlert('Permission needed', 'We need access to photos to back them up.');
        setStatus('');
        return;
      }

      if (result.limitedAccess) {
        setStatus('Limited photo access. Please allow full access to back up.');
        showDarkAlert(
          'Limited Photos Access',
          `Backup needs Full Access to your Photos library.\n\nGo to Settings → ${APP_DISPLAY_NAME} → Photos → Full Access.`
        );
        return;
      }

      if (result.noFiles) {
        setProgress(1);
        setStatus('No files on device');
        await sleep(1500);
        setStatus('Idle');
        setProgress(0);
        return;
      }

      if (result.noFilesToBackup) {
        setStatus('No files to backup');
        showDarkAlert('No Photos', 'No photos or videos found on device.');
        return;
      }

      if (result.alreadyBackedUp) {
        setStatus(`All ${result.checkedCount} files already backed up.`);
        showDarkAlert('Up to Date', `All ${result.checkedCount} photos & videos are already on the server.`);
        return;
      }

      const { uploaded, skipped, failed } = result;
      setStatus('Backup complete');
      showResultAlert('backup', { uploaded, skipped, failed });
      setProgress(0);
    } catch (error) {
      console.error(error);
      setStatus('Backup failed');
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
    setStatus('Preparing sync...');
    setProgress(0);
    setProgressAction('sync');
    setLoadingSafe(true);

    const permission = await MediaLibrary.requestPermissionsAsync();
    if (permission.status !== 'granted') {
      showDarkAlert('Permission Required', 'Media library permission is required to sync photos to your gallery.');
      setLoadingSafe(false);
      setStatus('');
      setBackgroundWarnEligibleSafe(false);
      setProgressAction(null);
      setWasBackgroundedDuringWorkSafe(false);
      return;
    }

    if (Platform.OS === 'ios' && permission.accessPrivileges && permission.accessPrivileges !== 'all') {
      setStatus('Limited photo access. Please allow full access to sync from cloud.');
      showDarkAlert(
        'Limited Photos Access',
        `Sync from Cloud needs Full Access to your Photos library.\n\nGo to Settings → ${APP_DISPLAY_NAME} → Photos → Full Access.`
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

      setStatus('Analyzing local files...');
      const localIndex = await buildLocalFilenameSetPaged({ mediaType: ['photo', 'video'] });
      const localFilenames = localIndex.set;

      const result = await localRemoteRestoreCore({
        config,
        SERVER_URL,
        localFilenames,
        onlyFilenames: opts?.onlyFilenames || null,
        onStatus: (s) => setStatusSafe(opId, s),
        onProgress: (p) => setProgressSafe(opId, p),
      });

      if (result.noFiles) {
        setProgress(1);
        setStatus('No files to sync');
        await sleep(800);
        showDarkAlert('No Files', 'There are no files on the server to download.');
        await sleep(500);
        setProgress(0);
        return;
      }

      if (result.allSynced) {
        setProgress(1);
        setStatus(`All ${result.serverTotal} files already synced.`);
        await sleep(800);
        showDarkAlert('Up to Date', `All ${result.serverTotal} server files are already on your device.`);
        await sleep(500);
        setProgress(0);
        return;
      }

      setStatus('Sync complete');
      setProgress(0);
      showResultAlert('sync', { downloaded: result.restored, skipped: result.skipped, failed: result.failed });
      resetSyncPickerState();

    } catch (error) {
      console.error('Restore error:', error);
      setStatus('Sync failed');
      setProgress(0);
      showResultAlert('sync', { error: error.message });
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
                          showDarkAlert('Camera Permission', 'Camera access is needed to scan QR codes.');
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
              Using StealthCloud (https://stealthlynk.io)
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
                    <Text style={styles.serverHelpText}>3) Follow on-screen instructions.</Text>
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
                  <Text style={{ color: '#4A9FE8', fontSize: scale(14) }}>Create Account</Text>
                </TouchableOpacity>

                {serverType === 'stealthcloud' && (
                  <TouchableOpacity
                    onPress={() => setAuthMode('forgot')}
                    disabled={loading}
                  >
                    <Text style={{ color: '#888', fontSize: scale(14) }}>Forgot Password?</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}

          {authMode === 'register' && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: scaleSpacing(16), paddingHorizontal: scaleSpacing(4) }}>
                <TouchableOpacity
                  onPress={() => setTermsAccepted(!termsAccepted)}
                  style={{ marginRight: scaleSpacing(10), marginTop: scaleSpacing(2) }}
                  activeOpacity={0.7}
                >
                  <View style={{
                    width: isTablet ? 28 : 22,
                    height: isTablet ? 28 : 22,
                    borderRadius: scaleSpacing(4),
                    borderWidth: 2,
                    borderColor: termsAccepted ? '#4A9FE8' : '#555',
                    backgroundColor: termsAccepted ? '#4A9FE8' : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {termsAccepted && (
                      <Text style={{ color: '#fff', fontSize: scale(14), fontWeight: '700' }}>✓</Text>
                    )}
                  </View>
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#AAA', fontSize: scale(13), lineHeight: scale(18) }}>
                    I agree to the{' '}
                    <Text
                      style={{ color: '#4A9FE8', textDecorationLine: 'underline' }}
                      onPress={() => Linking.openURL('https://viktorvishyn369.github.io/PhotoLynk/terms.html')}
                    >
                      Terms of Service
                    </Text>
                    {' '}and{' '}
                    <Text
                      style={{ color: '#4A9FE8', textDecorationLine: 'underline' }}
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
              <Text style={{ color: '#CCC', fontSize: scale(14), textAlign: 'center', marginBottom: scaleSpacing(16), lineHeight: scale(20) }}>
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
            <GradientSpinner size={isTablet ? 90 : 70} />
            <Text style={{ color: '#fff', fontSize: scale(16), fontWeight: '600', marginTop: scaleSpacing(20) }}>{authLoadingLabel}</Text>
            <Text style={{ color: '#888', fontSize: scale(13), marginTop: scaleSpacing(8) }}>Please wait...</Text>
          </View>
        </View>
      )}

      {customAlert && (
        <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
          <View style={[styles.overlayCard, glassModeEnabled && styles.overlayCardGlass, { backgroundColor: glassModeEnabled ? 'rgba(42, 42, 42, 0.9)' : '#2A2A2A', maxWidth: isTablet ? 450 : 320 }]}>
            <Text style={[styles.overlayTitle, { fontSize: scale(18), marginBottom: scaleSpacing(8) }]}>{customAlert.title}</Text>
            <Text style={{ color: '#CCC', fontSize: scale(14), textAlign: 'center', marginBottom: scaleSpacing(20), lineHeight: scale(20) }}>{customAlert.message}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: scaleSpacing(12) }}>
              {(customAlert.buttons || []).map((btn, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.overlayBtnPrimary, glassModeEnabled && styles.overlayBtnPrimaryGlass, { paddingVertical: scaleSpacing(10), paddingHorizontal: scaleSpacing(24), minWidth: isTablet ? 100 : 80 }]}
                  onPress={() => { closeDarkAlert(); if (btn.onPress) btn.onPress(); }}>
                  <Text style={styles.overlayBtnPrimaryText}>{btn.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}

      {qrScannerOpen && (
        <View style={[styles.overlay, {backgroundColor: 'rgba(0,0,0,0.95)'}]}>
          <View style={{flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center'}}>
            <Text style={{color: '#fff', fontSize: scale(20), fontWeight: '600', marginBottom: scaleSpacing(8)}}>
              📷 Scan QR Code
            </Text>
            <Text style={{color: '#aaa', fontSize: scale(14), marginBottom: scaleSpacing(20), textAlign: 'center', paddingHorizontal: scaleSpacing(40)}}>
              Point your camera at the QR code shown in the PhotoLynk Server tray app
            </Text>

            <View style={{width: isTablet ? 350 : 280, height: isTablet ? 350 : 280, borderRadius: scaleSpacing(16), overflow: 'hidden', backgroundColor: '#000'}}>
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
                  <Text style={{color: '#888', textAlign: 'center', padding: scaleSpacing(20), fontSize: scale(14)}}>
                    Camera permission required
                  </Text>
                  <TouchableOpacity
                    style={{backgroundColor: '#4a90d9', paddingHorizontal: scaleSpacing(20), paddingVertical: scaleSpacing(10), borderRadius: scaleSpacing(8)}}
                    onPress={requestCameraPermission}>
                    <Text style={{color: '#fff', fontWeight: '600', fontSize: scale(14)}}>Grant Permission</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={{marginTop: scaleSpacing(24), paddingVertical: scaleSpacing(14), paddingHorizontal: scaleSpacing(40), backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: scaleSpacing(8)}}
              onPress={() => setQrScannerOpen(false)}>
              <Text style={{color: '#fff', fontSize: scale(16), fontWeight: '600'}}>Cancel</Text>
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
          <View style={[styles.settingsCard, glassModeEnabled && styles.glassCard]}>
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
                        showDarkAlert('Camera Permission', 'Camera access is needed to scan QR codes.');
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
                Backs up photos & videos on Wi-Fi when charging or battery over 50%. Keep app open — backgrounding or locking will pause.
              </Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: '#FFFFFF', fontSize: scale(16), fontWeight: '600' }}>Auto Upload</Text>
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

          <View style={[styles.settingsCard, glassModeEnabled && styles.glassCard]}>
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
                ? "Faster uploads but uses more CPU and battery.\nRecommended when speed is a priority.\nWatch device's temperature and battery charge."
                : "Safer for device CPU and battery.\nUploads will be slower but this device stays cooler.\nWatch device's temperature and battery charge."}
            </Text>
            <Text style={styles.settingsDescription}>
              Screen stays on while the app is active. All activity pauses when the app is backgrounded.
            </Text>
          </View>

          <View style={[styles.settingsCard, glassModeEnabled && styles.glassCard]}>
            <Text style={styles.settingsTitle}>Appearance</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
              <Text style={styles.inputLabel}>{glassModeEnabled ? 'Glass Mode' : 'Standard Mode'}</Text>
              <Switch
                value={glassModeEnabled}
                onValueChange={persistGlassModeEnabled}
                trackColor={{ false: '#CCCCCC', true: '#007AFF' }}
                thumbColor='#FFFFFF'
              />
            </View>
            <Text style={styles.settingsDescription}>
              {glassModeEnabled
                ? "Frosted glass effect on cards and overlays.\nModern glassmorphism design."
                : "Standard solid background cards.\nClassic app appearance."}
            </Text>
          </View>

          {serverType === 'stealthcloud' ? (
            <View style={[styles.settingsCard, glassModeEnabled && styles.glassCard]}>
              <Text style={styles.settingsTitle}>StealthCloud</Text>
              <Text style={styles.settingsDescription}>Danger zone</Text>

              <TouchableOpacity
                style={[styles.btnDanger, loading && styles.disabledCard]}
                disabled={loading}
                onPress={purgeStealthCloudData}>
                <Text style={styles.btnDangerText}>Delete all data on server</Text>
              </TouchableOpacity>

              <Text style={styles.inputHint}>
                This removes All Data from the server for your account.
              </Text>
            </View>
          ) : (
            <>
              <View style={[styles.settingsCard, glassModeEnabled && styles.glassCard]}>
                <Text style={styles.settingsTitle}>Performance</Text>
                <Text style={styles.settingsDescription}>
                  Screen stays on while the app is active. All activity is paused when the app is backgrounded.
                </Text>
              </View>

              <View style={[styles.settingsCard, glassModeEnabled && styles.glassCard]}>
                <Text style={styles.settingsTitle}>Server</Text>
                <Text style={styles.settingsDescription}>Danger zone</Text>

                <TouchableOpacity
                  style={[styles.btnDanger, loading && styles.disabledCard]}
                  disabled={loading}
                  onPress={purgeClassicServerData}>
                  <Text style={styles.btnDangerText}>Delete All Data on server</Text>
                </TouchableOpacity>

                <Text style={styles.inputHint}>
                  This removes All Data from the server for your account.
                </Text>
              </View>
            </>
          )}

        </ScrollView>

        {quickSetupOpen && (
          <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
            <View style={[styles.overlayCard, glassModeEnabled && styles.overlayCardGlass]}>
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
                  <Text style={styles.boldText}>5)</Text> <Text style={styles.boldText}>Create Account</Text> / <Text style={styles.boldText}>Login</Text> → <Text style={styles.boldText}>Backup to Cloud</Text>
                </Text>
              )}

              {serverType === 'remote' && (
                <Text style={[styles.overlaySubtitle, { textAlign: 'left' }]}>
                  <Text style={styles.boldText}>2)</Text> Run the server on your VPS/home server{'\n'}
                  <Text style={styles.boldText}>3)</Text> Enable HTTPS (TLS) on port 3000{'\n'}
                  <Text style={styles.boldText}>4)</Text> In this app: <Text style={styles.boldText}>Remote</Text> → enter host (IP/domain) → <Text style={styles.boldText}>Save Changes</Text>{'\n'}
                  <Text style={styles.boldText}>5)</Text> <Text style={styles.boldText}>Login</Text> → <Text style={styles.boldText}>Backup to Cloud</Text> / <Text style={styles.boldText}>Sync from Cloud</Text>
                </Text>
              )}

              <TouchableOpacity style={[styles.overlayBtnSecondary, glassModeEnabled && styles.overlayBtnSecondaryGlass]} onPress={() => setQuickSetupOpen(false)}>
                <Text style={styles.overlayBtnSecondaryText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {qrScannerOpen && (
          <View style={[styles.overlay, {backgroundColor: 'rgba(0,0,0,0.95)'}]}>
            <View style={{flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center'}}>
              <Text style={{color: '#fff', fontSize: scale(20), fontWeight: '600', marginBottom: scaleSpacing(8)}}>
                📷 Scan QR Code
              </Text>
              <Text style={{color: '#aaa', fontSize: scale(14), marginBottom: scaleSpacing(20), textAlign: 'center', paddingHorizontal: scaleSpacing(40)}}>
                Point your camera at the QR code shown in the PhotoLynk Server tray app
              </Text>

              <View style={{width: isTablet ? 350 : 280, height: isTablet ? 350 : 280, borderRadius: scaleSpacing(16), overflow: 'hidden', backgroundColor: '#000'}}>
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
                    <Text style={{color: '#888', textAlign: 'center', padding: scaleSpacing(20), fontSize: scale(14)}}>
                      Camera permission required
                    </Text>
                    <TouchableOpacity
                      style={{backgroundColor: '#4a90d9', paddingHorizontal: scaleSpacing(20), paddingVertical: scaleSpacing(10), borderRadius: scaleSpacing(8)}}
                      onPress={requestCameraPermission}>
                      <Text style={{color: '#fff', fontWeight: '600', fontSize: scale(14)}}>Grant Permission</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={{marginTop: scaleSpacing(24), paddingVertical: scaleSpacing(14), paddingHorizontal: scaleSpacing(40), backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: scaleSpacing(8)}}
                onPress={() => setQrScannerOpen(false)}>
                <Text style={{color: '#fff', fontSize: scale(16), fontWeight: '600'}}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {customAlert && (
          <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
            <View style={[styles.overlayCard, glassModeEnabled && styles.overlayCardGlass, { backgroundColor: glassModeEnabled ? 'rgba(42, 42, 42, 0.9)' : '#2A2A2A', maxWidth: isTablet ? 450 : 320 }]}>
              <Text style={[styles.overlayTitle, { fontSize: scale(18), marginBottom: scaleSpacing(8) }]}>{customAlert.title}</Text>
              <Text style={{ color: '#CCC', fontSize: scale(14), textAlign: 'center', marginBottom: scaleSpacing(20), lineHeight: scale(20) }}>{customAlert.message}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: scaleSpacing(12) }}>
                {(customAlert.buttons || []).map((btn, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.overlayBtnPrimary, glassModeEnabled && styles.overlayBtnPrimaryGlass, { paddingVertical: scaleSpacing(10), paddingHorizontal: scaleSpacing(24), minWidth: isTablet ? 100 : 80 }]}
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
          <View style={[styles.settingsCard, glassModeEnabled && styles.glassCard]}>
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
            <View style={[styles.settingsCard, glassModeEnabled && styles.glassCard]}>
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
                              {subStatus === 'active' ? (sub.expiresAt ? `✓ Exp ${new Date(sub.expiresAt).toLocaleDateString()}` : '✓ Active') :
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

          <View style={[styles.settingsCard, glassModeEnabled && styles.glassCard]}>
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

            <TouchableOpacity
              style={styles.resourceBtn}
              onPress={() => {
                const deleteAccountUrl = 'https://viktorvishyn369.github.io/PhotoLynk/delete-account.html';
                Linking.openURL(deleteAccountUrl).catch(err => {
                  showDarkAlert('Error', 'Could not open link');
                });
              }}>
              <Text style={styles.resourceIcon}>🗑️</Text>
              <View style={styles.resourceContent}>
                <Text style={styles.resourceTitle}>Delete Account</Text>
                <Text style={styles.resourceDesc}>Request account & data deletion</Text>
              </View>
              <Text style={styles.resourceArrow}>→</Text>
            </TouchableOpacity>

          </View>

          <View style={styles.settingsFooter}>
            <Text style={styles.footerVersion}>{APP_DISPLAY_NAME} v1.1.1</Text>
          </View>
        </ScrollView>

        {customAlert && (
          <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
            <View style={[styles.overlayCard, glassModeEnabled && styles.overlayCardGlass, { backgroundColor: glassModeEnabled ? 'rgba(42, 42, 42, 0.9)' : '#2A2A2A', maxWidth: isTablet ? 450 : 320 }]}>
              <Text style={[styles.overlayTitle, { fontSize: scale(18), marginBottom: scaleSpacing(8) }]}>{customAlert.title}</Text>
              <Text style={{ color: '#CCC', fontSize: scale(14), textAlign: 'center', marginBottom: scaleSpacing(20), lineHeight: scale(20) }}>{customAlert.message}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: scaleSpacing(12), flexWrap: 'wrap' }}>
                {(customAlert.buttons || []).map((btn, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.overlayBtnPrimary, glassModeEnabled && styles.overlayBtnPrimaryGlass, { paddingVertical: scaleSpacing(10), paddingHorizontal: scaleSpacing(24), minWidth: isTablet ? 100 : 80 }]}
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
          <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
            <View style={[styles.overlayCard, glassModeEnabled && styles.overlayCardGlass, { backgroundColor: glassModeEnabled ? 'rgba(30, 30, 30, 0.9)' : '#1E1E1E', maxWidth: isTablet ? 480 : 340 }]}>
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
                    <Text style={[styles.overlayTitle, { fontSize: scale(18), marginBottom: scaleSpacing(8) }]}>{title}</Text>
                    <Text style={{ color: '#CCC', fontSize: scale(14), textAlign: 'center', marginBottom: scaleSpacing(14), lineHeight: scale(20) }}>
                      {priceStr !== '—' ? `${priceStr} / month` : 'Pricing unavailable. Please try again later.'}
                    </Text>
                    <Text style={[styles.inputHint, { textAlign: 'center', marginBottom: scaleSpacing(14) }]}>Price shown in your local currency from Apple/Google. Taxes may apply. Cancel anytime.</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: scaleSpacing(12), flexWrap: 'wrap' }}>
                      <TouchableOpacity
                        style={[styles.overlayBtnPrimary, glassModeEnabled && styles.overlayBtnPrimaryGlass, { paddingVertical: scaleSpacing(10), paddingHorizontal: scaleSpacing(24), minWidth: isTablet ? 110 : 90, opacity: purchaseLoading ? 0.6 : 1 }]}
                        onPress={closePaywall}
                        disabled={purchaseLoading}
                      >
                        <Text style={styles.overlayBtnPrimaryText}>Close</Text>
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
                        <Text style={styles.overlayBtnPrimaryText}>{isCurrent ? 'Current' : 'Subscribe'}</Text>
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                      style={[styles.restorePurchasesBtn, { marginTop: scaleSpacing(14) }]}
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
        <View style={[styles.statusCard, glassModeEnabled && styles.statusCardGlass]}>
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
            <Animated.View 
              style={[
                styles.progressFill, 
                { width: `${Math.min(Math.max(progress, 0), 1) * 100}%` },
                progressAction === 'cleanup' && { backgroundColor: '#6366F1' },
                progressAction === 'backup' && { backgroundColor: '#2196F3' },
                progressAction === 'sync' && { backgroundColor: '#4CAF50' },
              ]} 
            />
          </View>
        </View>

        <View style={styles.actionsContainer}>
          <TouchableOpacity
            onPress={openCleanupModeChooser}
            disabled={loading}
            style={[styles.actionCard, styles.cleanupCard, glassModeEnabled && styles.cleanupCardGlass, loading && styles.disabledCard]}>
            <View style={styles.cardIcon}>
              <FontAwesome5 name="broom" size={22} color="#FFFFFF" />
            </View>
            <Text style={styles.cardTitle}>Clean Duplicates</Text>
            <Text style={styles.cardDescription}>Remove Duplicate Photos on this device</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={openBackupModeChooser}
            disabled={loading}
            style={[styles.actionCard, styles.backupCard, glassModeEnabled && styles.backupCardGlass, loading && styles.disabledCard]}>
            <View style={styles.cardIcon}>
              <FontAwesome5 name="cloud-upload-alt" size={24} color="#FFFFFF" />
            </View>
            <Text style={styles.cardTitle}>Backup to Cloud</Text>
            <Text style={styles.cardDescription}>Upload Photos & Videos to {serverType === 'stealthcloud' ? 'StealthCloud' : serverType === 'remote' ? 'Remote' : 'Local'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={openSyncModeChooser}
            onLongPress={async () => {
              await SecureStore.deleteItemAsync('downloaded_files');
              await clearRestoreHistory();
              showDarkAlert('Reset', 'Download history cleared. All files will be re-downloaded on next sync.');
            }}
            disabled={loading}
            style={[styles.actionCard, styles.syncCard, glassModeEnabled && styles.syncCardGlass, loading && styles.disabledCard]}>
            <View style={styles.cardIcon}>
              <FontAwesome5 name="cloud-download-alt" size={24} color="#FFFFFF" />
            </View>
            <Text style={styles.cardTitle}>Sync from Cloud</Text>
            <Text style={styles.cardDescription}>Download backed up Photos & Videos</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {cleanupModeOpen && (
        <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
          <View style={[styles.overlayCard, glassModeEnabled && styles.overlayCardGlass]}>
            <Text style={styles.overlayTitle}>Clean Up Duplicates</Text>
            <Text style={styles.overlaySubtitle}>Remove best photo matches & similar photos.{"\n"}Nothing is deleted without your confirmation.</Text>

            <TouchableOpacity
              style={[styles.overlayBtnPrimary, glassModeEnabled && styles.overlayBtnPrimaryGlass]}
              onPress={async () => {
                closeCleanupModeChooser();
                await cleanDeviceDuplicates();
              }}>
              <Text style={styles.overlayBtnPrimaryText}>Review Best Photo Matches & Delete</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.overlayBtnSecondary, glassModeEnabled && styles.overlayBtnSecondaryGlass]}
              onPress={async () => {
                closeCleanupModeChooser();
                await startSimilarShotsReview();
              }}>
              <Text style={styles.overlayBtnSecondaryText}>Review Similar Photos & Delete</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.overlayBtnGhost, glassModeEnabled && styles.overlayBtnGhostGlass]}
              onPress={closeCleanupModeChooser}>
              <Text style={styles.overlayBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {similarReviewOpen && (
        <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
          <View style={[styles.pickerCard, glassModeEnabled && styles.pickerCardGlass]}>
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
                  style={[styles.overlayBtnPrimary, glassModeEnabled && styles.overlayBtnPrimaryGlass]}
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
                  style={[styles.overlayBtnSecondary, glassModeEnabled && styles.overlayBtnSecondaryGlass]}
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
                      style={[styles.overlayBtnSecondary, glassModeEnabled && styles.overlayBtnSecondaryGlass]}
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
        <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
          <View style={[styles.overlayCard, glassModeEnabled && styles.overlayCardGlass]}>
            <Text style={styles.overlayTitle}>Sync from Cloud</Text>
            <Text style={styles.overlaySubtitle}>Choose how you want to download{"\n"}(existing files on device will be skipped).</Text>

            <TouchableOpacity
              style={[styles.overlayBtnPrimary, glassModeEnabled && styles.overlayBtnPrimaryGlass]}
              onPress={async () => {
                closeSyncModeChooser();
                await restorePhotos();
              }}>
              <Text style={styles.overlayBtnPrimaryText}>All Photos & Videos</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.overlayBtnSecondary, glassModeEnabled && styles.overlayBtnSecondaryGlass]}
              onPress={async () => {
                closeSyncModeChooser();
                await openSyncPicker();
              }}>
              <Text style={styles.overlayBtnSecondaryText}>Choose Photos & Videos</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.overlayBtnGhost, glassModeEnabled && styles.overlayBtnGhostGlass]}
              onPress={closeSyncModeChooser}>
              <Text style={styles.overlayBtnGhostText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {syncPickerOpen && (
        <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
          <View style={[styles.pickerCard, glassModeEnabled && styles.pickerCardGlass]}>
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

            <ScrollView contentContainerStyle={serverType === 'stealthcloud' ? styles.syncPickerList : styles.pickerGrid}>
              {syncPickerLoading ? (
                <View style={{ width: '100%', paddingVertical: scaleSpacing(32), alignItems: 'center' }}>
                  <ActivityIndicator size={isTablet ? 'large' : 'small'} color={THEME.secondary} />
                  <Text style={{ color: '#888', fontSize: scale(13), marginTop: scaleSpacing(10) }}>Loading files...</Text>
                </View>
              ) : serverType === 'stealthcloud' ? (
                <>
                  {/* StealthCloud: list view with icons (encrypted, no thumbnails) */}
                  <View style={{ paddingHorizontal: scaleSpacing(12), paddingVertical: scaleSpacing(8), borderBottomWidth: 1, borderBottomColor: '#222' }}>
                    <Text style={{ color: '#888', fontSize: scale(12) }}>
                      Showing {syncPickerItems.length}{syncPickerTotal > 0 ? ` of ${syncPickerTotal}` : ''} files
                    </Text>
                  </View>

                  {(syncPickerItems || []).map((it) => {
                    const key = String(it && it.manifestId ? it.manifestId : '');
                    if (!key) return null;
                    const selected = !!(syncPickerSelected && syncPickerSelected[key]);
                    const displayName = it && it.filename ? it.filename : key;
                    const rawSize = it && typeof it.size === 'number' ? it.size : null;
                    const fileSize = rawSize !== null && rawSize > 0 ? rawSize : null;
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
                        <View style={{ width: isTablet ? 56 : 44, height: isTablet ? 56 : 44, borderRadius: scaleSpacing(6), marginRight: scaleSpacing(10), backgroundColor: isVideo ? '#1a1a2e' : '#1e3a2e', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: scale(22) }}>{fileIcon}</Text>
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

                  {syncPickerHasMore && (
                    <TouchableOpacity
                      style={{ marginVertical: scaleSpacing(16), marginHorizontal: scaleSpacing(12), paddingVertical: scaleSpacing(14), backgroundColor: THEME.secondary, borderRadius: scaleSpacing(10), alignItems: 'center' }}
                      onPress={loadMoreSyncPickerItems}
                      disabled={syncPickerLoadingMore}>
                      {syncPickerLoadingMore ? (
                        <ActivityIndicator size={isTablet ? 'large' : 'small'} color="#000" />
                      ) : (
                        <Text style={{ color: '#000', fontWeight: '600', fontSize: scale(15) }}>
                          Load More ({Math.max(0, (syncPickerTotal || 0) - (syncPickerOffset || 0))} remaining)
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </>
              ) : (
                <>
                  {/* Local/Remote: grid view with real thumbnails */}
                  {(syncPickerItems || []).map((it) => {
                    const key = String(it && it.filename ? it.filename : '');
                    if (!key) return null;
                    const selected = !!(syncPickerSelected && syncPickerSelected[key]);
                    const ext = (key || '').split('.').pop()?.toLowerCase() || '';
                    const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'm4v', '3gp', 'webm'].includes(ext);
                    const thumbUri = it.thumbUri;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[styles.pickerItem, selected && styles.pickerItemSelected]}
                        onPress={() => toggleSyncPickerSelected(key)}>
                        {thumbUri ? (
                          <Image source={{ uri: thumbUri }} style={styles.pickerThumb} />
                        ) : (
                          <View style={[styles.pickerThumb, { backgroundColor: isVideo ? '#1a1a2e' : '#1e3a2e', alignItems: 'center', justifyContent: 'center' }]}>
                            <Text style={{ fontSize: 32 }}>{isVideo ? '🎬' : '📄'}</Text>
                          </View>
                        )}
                        {isVideo && (
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
                    {syncPickerLoadingMore ? (
                      <ActivityIndicator size="small" color={THEME.secondary} />
                    ) : (
                      syncPickerHasMore && (
                        <TouchableOpacity
                          style={[styles.overlayBtnSecondary, glassModeEnabled && styles.overlayBtnSecondaryGlass]}
                          onPress={loadMoreSyncPickerItems}>
                          <Text style={styles.overlayBtnSecondaryText}>Load more</Text>
                        </TouchableOpacity>
                      )
                    )}
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      )}

      {duplicateReview && (
        <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
          <View style={[styles.overlayCard, glassModeEnabled && styles.overlayCardGlass]}>
            <Text style={styles.overlayTitle}>Review Duplicates</Text>
            <Text style={styles.overlaySubtitle}>
              {`Found ${duplicateReview.duplicateCount} items in ${duplicateReview.groupCount} group${duplicateReview.groupCount !== 1 ? 's' : ''} (${duplicateReview.mode}). Uncheck any items you want to keep.`}
            </Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {duplicateReview.groups.map((group) => (
                <View key={`grp-${group.groupIndex}`} style={{ marginBottom: 12, padding: 10, backgroundColor: '#111', borderRadius: 8 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', marginBottom: 6 }}>
                    {group.type === 'similar' ? 'Similar' : 'Best match'} Group {group.groupIndex}
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
                style={[styles.overlayBtnSecondary, glassModeEnabled && styles.overlayBtnSecondaryGlass, { flex: 1 }]}
                onPress={() => { setDuplicateReview(null); setStatus('Duplicate scan cancelled.'); }}
              >
                <Text style={styles.overlayBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.overlayBtnPrimary, glassModeEnabled && styles.overlayBtnPrimaryGlass, { flex: 1 }]}
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
                        showResultAlert('clean', { deleted: idsToDelete.length });
                        setStatus(`Deleted ${idsToDelete.length} item${idsToDelete.length !== 1 ? 's' : ''}`);
                      } else {
                        setStatus('Deletion cancelled');
                      }
                    } else {
                      // iOS or fallback
                      const result = await MediaLibrary.deleteAssetsAsync(idsToDelete);
                      if (result === true) {
                        showResultAlert('clean', { deleted: idsToDelete.length });
                        setStatus(`Deleted ${idsToDelete.length} item${idsToDelete.length !== 1 ? 's' : ''}`);
                      } else {
                        setStatus('Deletion cancelled or partial');
                      }
                    }
                  } catch (err) {
                    showResultAlert('clean', { error: err.message || 'Could not delete items.' });
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
        <View style={[styles.overlay, glassModeEnabled && styles.overlayGlass]}>
          <View style={[styles.overlayCard, glassModeEnabled && styles.overlayCardGlass, { backgroundColor: glassModeEnabled ? 'rgba(42, 42, 42, 0.9)' : '#2A2A2A', maxWidth: isTablet ? 450 : 320 }]}>
            <Text style={[styles.overlayTitle, { fontSize: scale(18), marginBottom: scaleSpacing(8) }]}>{customAlert.title}</Text>
            <Text style={{ color: '#CCC', fontSize: scale(14), textAlign: 'center', marginBottom: scaleSpacing(20), lineHeight: scale(20) }}>{customAlert.message}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: scaleSpacing(12) }}>
              {(customAlert.buttons || []).map((btn, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.overlayBtnPrimary, glassModeEnabled && styles.overlayBtnPrimaryGlass, { paddingVertical: scaleSpacing(10), paddingHorizontal: scaleSpacing(24), minWidth: isTablet ? 100 : 80 }]}
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
