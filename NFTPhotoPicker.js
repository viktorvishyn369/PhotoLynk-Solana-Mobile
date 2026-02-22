// NFT Photo Picker Component
// Large thumbnail grid for selecting photos to mint as NFTs

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Modal,
  TextInput,
  ScrollView,
  Platform,
  Keyboard,
  NativeModules,
  UIManager,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Switch,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import { Feather } from '@expo/vector-icons';
import { t } from './i18n';
import { estimateNFTMintCost, computeLimitedEditionFee, isCNFTAvailable, NFT_FEES, isPromoActive, getPromoDaysRemaining, NFT_EDITION, NFT_LICENSE_OPTIONS, EDITION_ROYALTY_BPS, NFT_COMMISSION_WALLET } from './nftOperations';

const NFT_WELCOME_SHOWN_KEY = 'nft_welcome_shown';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SCREEN_HEIGHT_FULL = Dimensions.get('screen').height;
const ANDROID_NAV_BAR_HEIGHT = Platform.OS === 'android' ? Math.max(0, SCREEN_HEIGHT_FULL - SCREEN_HEIGHT) : 0;
const THUMBNAIL_SIZE = (SCREEN_WIDTH - 48) / 3; // 3 columns with padding
const LARGE_THUMBNAIL_SIZE = (SCREEN_WIDTH - 32) / 2; // 2 columns for NFT picker
const IS_SMALL_SCREEN = SCREEN_WIDTH < 430;

// ============================================================================
// COLORS (matching app theme)
// ============================================================================

const COLORS = {
  background: '#0a0a0a',
  surface: '#1a1a1a',
  surfaceLight: '#2a2a2a',
  primary: '#9945FF',
  secondary: '#8b5cf6',
  accent: '#22c55e',
  text: '#ffffff',
  textSecondary: '#a1a1aa',
  border: '#3f3f46',
  error: '#ef4444',
  warning: '#f59e0b',
};

const HAS_EXPO_LINEAR_GRADIENT = (() => {
  try {
    // expo-linear-gradient view manager names differ between build modes
    return !!(
      UIManager.getViewManagerConfig?.('ViewManagerAdapter_ExpoLinearGradient') ||
      UIManager.getViewManagerConfig?.('ExpoLinearGradient')
    );
  } catch (e) {
    return false;
  }
})();

const GradientBox = ({ colors, start, end, style, fallbackColor, children }) => {
  if (HAS_EXPO_LINEAR_GRADIENT) {
    return (
      <LinearGradient colors={colors} start={start} end={end} style={style}>
        {children}
      </LinearGradient>
    );
  }
  return (
    <View style={[style, { backgroundColor: fallbackColor || colors?.[0] || COLORS.secondary }]}>
      {children}
    </View>
  );
};

// ============================================================================
// NFT PHOTO PICKER COMPONENT
// ============================================================================

const NFTPhotoPicker = ({
  visible,
  onClose,
  onSelectPhoto,
  resolveReadableFilePath,
  serverConfig,        // StealthCloud server config { baseUrl, headers }
  checkCloudEligibility, // Function to check StealthCloud eligibility
}) => {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [selectedPhotoExif, setSelectedPhotoExif] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [endCursor, setEndCursor] = useState(null);
  const [nftName, setNftName] = useState('');
  const [nftDescription, setNftDescription] = useState('');
  const [showMintConfirm, setShowMintConfirm] = useState(false);
  const [exifCache, setExifCache] = useState({}); // Cache EXIF data by asset id
  const [stripExif, setStripExif] = useState(false); // Privacy option to remove EXIF
  const [storageOption, setStorageOption] = useState('ipfs'); // 'ipfs' or 'cloud'
  const [nftType, setNftType] = useState('compressed'); // 'compressed' or 'standard'
  // Edition options
  const [edition, setEdition] = useState(NFT_EDITION.OPEN);
  const [license, setLicense] = useState('arr');
  const [watermark, setWatermark] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
  const [showLicensePicker, setShowLicensePicker] = useState(false);
  const [cloudEligible, setCloudEligible] = useState(false);
  const [cloudReason, setCloudReason] = useState('');
  const [checkingCloud, setCheckingCloud] = useState(false);
  const [estimatedCost, setEstimatedCost] = useState(null);
  const [loadingCost, setLoadingCost] = useState(false);
  const [compressedEstimate, setCompressedEstimate] = useState(null);
  const [standardEstimate, setStandardEstimate] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [dontShowWelcomeAgain, setDontShowWelcomeAgain] = useState(false);
  const [welcomeChecked, setWelcomeChecked] = useState(false);
  const [expandedDetail, setExpandedDetail] = useState(null); // 'public' | 'private' | 'cert' | null
  
  const flatListRef = useRef(null);
  
  // Check if welcome popup should be shown
  useEffect(() => {
    const checkWelcome = async () => {
      if (visible && !welcomeChecked) {
        try {
          const shown = await SecureStore.getItemAsync(NFT_WELCOME_SHOWN_KEY);
          if (shown !== 'true') {
            setShowWelcome(true);
          }
        } catch (e) {
          // If error, show welcome anyway
          setShowWelcome(true);
        }
        setWelcomeChecked(true);
      }
    };
    checkWelcome();
  }, [visible, welcomeChecked]);
  
  // Handle welcome popup dismiss
  const handleWelcomeDismiss = async () => {
    if (dontShowWelcomeAgain) {
      try {
        await SecureStore.setItemAsync(NFT_WELCOME_SHOWN_KEY, 'true');
      } catch (e) {
        console.log('[NFT] Could not save welcome preference');
      }
    }
    setShowWelcome(false);
  };
  
  // Load photos on mount
  useEffect(() => {
    if (visible) {
      loadPhotos();
    } else {
      // Reset state when closed
      setPhotos([]);
      setSelectedPhoto(null);
      setSelectedPhotoExif(null);
      setEndCursor(null);
      setHasMore(true);
      setNftName('');
      setNftDescription('');
      setShowMintConfirm(false);
      setExifCache({});
      setStripExif(false);
      setStorageOption('ipfs');
      setNftType('compressed');
      setEdition(NFT_EDITION.OPEN);
      setLicense('arr');
      setWatermark(false);
      setEncrypt(false);
      setShowLicensePicker(false);
      setCloudEligible(false);
      setCloudReason('');
      setWelcomeChecked(false);
      setEstimatedCost(null);
    }
  }, [visible]);
  
  // Check StealthCloud eligibility when picker opens — default to cloud if eligible
  useEffect(() => {
    if (visible && checkCloudEligibility) {
      setCheckingCloud(true);
      checkCloudEligibility(5 * 1024 * 1024) // Estimate 5MB
        .then(result => {
          setCloudEligible(result.eligible);
          setCloudReason(result.reason || '');
          // Cloud eligible but don't auto-switch — default stays IPFS
          // User can manually select StealthCloud if they want encryption
        })
        .catch(() => {
          setCloudEligible(false);
          setCloudReason('Could not check');
        })
        .finally(() => setCheckingCloud(false));
    }
  }, [visible, checkCloudEligibility]);
  
  // Limited Edition: original photo embedded on-chain as data URI in metadata → uploaded to IPFS
  // Hashes + RFC 3161 + C2PA also in metadata. Encryption IS available (user choice).
  const isLimited = edition === NFT_EDITION.LIMITED;
  // StealthCloud requires encryption — force on and lock
  const isCloudSelected = storageOption === 'cloud';
  // Lock encryption/watermark only for Open Edition + onchain (SVG vector, not meaningful to encrypt)
  // Limited Edition keeps encryption available — the embedded original image can be encrypted
  const isOnchainLocked = !isLimited && edition === NFT_EDITION.OPEN && storageOption === 'onchain';
  useEffect(() => {
    if (isLimited) {
      setStorageOption('onchain');
    }
  }, [isLimited]);
  useEffect(() => {
    if (isCloudSelected) {
      setEncrypt(true); // StealthCloud: encryption mandatory
    } else if (isOnchainLocked) {
      setEncrypt(false);
      setWatermark(false);
    }
  }, [isCloudSelected, isOnchainLocked]);

  // Estimate cost when options change (debounced to avoid 429 RPC spam)
  useEffect(() => {
    if (!selectedPhoto) return;
    setLoadingCost(true);
    const fileSize = selectedPhoto.fileSize || 0;
    console.log('[NFTPicker] Cost estimate fileSize:', fileSize, 'bytes =', Math.round(fileSize / 1024), 'KB, edition:', edition);
    const useCompressed = nftType === 'compressed';
    const timer = setTimeout(() => {
      estimateNFTMintCost(fileSize || 500 * 1024, storageOption, useCompressed, edition)
        .then(cost => setEstimatedCost(cost))
        .catch(e => {
          console.log('[NFTPicker] Cost estimation failed:', e.message);
          setEstimatedCost(null);
        })
        .finally(() => setLoadingCost(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedPhoto, storageOption, nftType, edition]);

  // Card estimates for both types (debounced to avoid 429 RPC spam)
  useEffect(() => {
    if (!selectedPhoto) return;
    const fileSize = selectedPhoto.fileSize || 500 * 1024;
    const timer = setTimeout(() => {
      Promise.all([
        estimateNFTMintCost(fileSize, storageOption, true, edition).catch(() => null),
        estimateNFTMintCost(fileSize, storageOption, false, edition).catch(() => null),
      ])
        .then(([cnft, standard]) => {
          setCompressedEstimate(cnft);
          setStandardEstimate(standard);
        })
        .catch(() => {
          setCompressedEstimate(null);
          setStandardEstimate(null);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedPhoto, storageOption, edition]);
  
  // Load photos from media library
  const loadPhotos = async (after = null) => {
    try {
      if (after) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      
      // Request only photo permissions (not audio/video) on Android 13+
      const permission = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
      if (permission.status !== 'granted') {
        setLoading(false);
        return;
      }
      
      const result = await MediaLibrary.getAssetsAsync({
        first: 50,
        after,
        mediaType: ['photo'],
        sortBy: [MediaLibrary.SortBy.creationTime],
      });
      
      // Filter out photos from PhotoLynkDeleted folder (Android: check URI path)
      const filtered = Platform.OS === 'android'
        ? result.assets.filter(a => !a.uri?.includes('PhotoLynkDeleted'))
        : result.assets;
      
      if (after) {
        setPhotos(prev => [...prev, ...filtered]);
      } else {
        setPhotos(filtered);
      }
      
      setEndCursor(result.endCursor);
      setHasMore(result.hasNextPage);
    } catch (e) {
      console.error('[NFTPicker] Load photos error:', e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };
  
  // Load more photos when scrolling
  const loadMore = () => {
    if (!loadingMore && hasMore && endCursor) {
      loadPhotos(endCursor);
    }
  };
  
  // Extract EXIF date from asset info
  const extractExifDate = (exif) => {
    if (!exif) return null;
    
    // Try various EXIF date fields
    const dateFields = ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime', 'CreateDate'];
    for (const field of dateFields) {
      if (exif[field]) {
        try {
          // EXIF date format: "YYYY:MM:DD HH:MM:SS"
          const dateStr = String(exif[field]).replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
          const date = new Date(dateStr);
          if (!isNaN(date.getTime()) && date.getFullYear() > 1971) {
            return date;
          }
        } catch (e) {}
      }
    }
    return null;
  };
  
  // Extract GPS location from EXIF
  const extractExifLocation = (exif) => {
    if (!exif) return null;
    
    const lat = exif.GPSLatitude;
    const lon = exif.GPSLongitude;
    const latRef = exif.GPSLatitudeRef;
    const lonRef = exif.GPSLongitudeRef;
    
    if (lat && lon) {
      // Convert to decimal degrees if needed
      let latitude = typeof lat === 'number' ? lat : null;
      let longitude = typeof lon === 'number' ? lon : null;
      
      if (latitude && longitude) {
        if (latRef === 'S') latitude = -latitude;
        if (lonRef === 'W') longitude = -longitude;
        return { latitude, longitude };
      }
    }
    return null;
  };
  
  // Get best date for a photo (EXIF > creationTime > modificationTime)
  const getBestDate = (photo, exifData) => {
    // 1. Try EXIF date first (most accurate)
    if (exifData?.dateTaken) {
      return exifData.dateTaken;
    }
    
    // 2. Try MediaLibrary creationTime (may be restore date)
    if (photo.creationTime && photo.creationTime > 0) {
      const date = new Date(photo.creationTime);
      if (date.getFullYear() > 1971) {
        return date;
      }
    }
    
    // 3. Try modificationTime
    if (photo.modificationTime && photo.modificationTime > 0) {
      const date = new Date(photo.modificationTime);
      if (date.getFullYear() > 1971) {
        return date;
      }
    }
    
    return null;
  };
  
  // Load EXIF data for a photo
  const loadExifForPhoto = async (photo) => {
    if (exifCache[photo.id]) {
      return exifCache[photo.id];
    }
    
    try {
      const info = await MediaLibrary.getAssetInfoAsync(photo.id);
      const exif = info?.exif;
      
      const exifData = {
        dateTaken: extractExifDate(exif),
        location: extractExifLocation(exif),
        camera: exif?.Make && exif?.Model 
          ? `${exif.Make} ${exif.Model}`.trim() 
          : exif?.Model || exif?.Make || null,
        raw: exif,
      };
      
      // Cache it
      setExifCache(prev => ({ ...prev, [photo.id]: exifData }));
      return exifData;
    } catch (e) {
      console.log('[NFTPicker] EXIF extraction failed:', e.message);
      return null;
    }
  };
  
  // Handle photo selection - load EXIF data
  const handleSelectPhoto = async (photo) => {
    setSelectedPhoto(photo);
    setSelectedPhotoExif(null); // Clear previous
    
    // Generate default name from filename
    const baseName = photo.filename?.replace(/\.[^/.]+$/, '') || 'Photo';
    setNftName(`${baseName} NFT`);
    
    // Fetch real fileSize from asset info so cost estimates are accurate
    try {
      const info = await MediaLibrary.getAssetInfoAsync(photo.id);
      let realSize = info.fileSize || info.size || photo.fileSize || 0;
      // Fallback: use FileSystem to get actual file size if MediaLibrary didn't provide it
      if (!realSize && (info.localUri || info.uri)) {
        try {
          const fsInfo = await FileSystem.getInfoAsync(info.localUri || info.uri);
          if (fsInfo.exists && fsInfo.size) realSize = fsInfo.size;
        } catch (_) {}
      }
      console.log('[NFTPicker] Photo fileSize:', realSize, 'bytes =', Math.round(realSize / 1024), 'KB, from:', info.fileSize ? 'MediaLibrary' : 'FileSystem');
      if (realSize && realSize !== photo.fileSize) {
        setSelectedPhoto({ ...photo, fileSize: realSize });
      }
    } catch (e) {
      console.log('[NFTPicker] fileSize fetch failed:', e?.message);
    }
    
    // Load EXIF data in background
    const exifData = await loadExifForPhoto(photo);
    setSelectedPhotoExif(exifData);
  };
  
  // Handle mint confirmation
  const handleMintConfirm = async () => {
    if (!selectedPhoto) return;
    
    setShowMintConfirm(false);
    
    // Get file path
    let filePath = null;
    try {
      const info = await MediaLibrary.getAssetInfoAsync(selectedPhoto.id);
      filePath = info.localUri || info.uri || selectedPhoto.uri;
      
      if (resolveReadableFilePath && filePath) {
        filePath = await resolveReadableFilePath(selectedPhoto, info);
      }
    } catch (e) {
      console.log('[NFTPicker] Using fallback URI');
    }
    
    // Fallback to asset URI if no path found
    if (!filePath) {
      filePath = selectedPhoto.uri;
    }
    
    if (!filePath) {
      console.error('[NFTPicker] No file path available');
      return;
    }
    
    onSelectPhoto?.({
      asset: selectedPhoto,
      filePath,
      name: nftName || `PhotoLynk NFT #${Date.now()}`,
      description: nftDescription || t('nftMint.defaultDescription'),
      stripExif: stripExif,
      storageOption: storageOption,
      nftType: nftType, // 'compressed' or 'standard'
      serverConfig: serverConfig,
      costEstimate: estimatedCost,
      // Edition parameters
      edition,
      license,
      watermark,
      encrypt,
    });
    
    onClose?.();
  };
  
  // Render photo thumbnail
  const renderPhoto = useCallback(({ item }) => {
    const isSelected = selectedPhoto?.id === item.id;
    
    return (
      <TouchableOpacity
        style={[styles.photoContainer, isSelected && styles.photoSelected]}
        onPress={() => handleSelectPhoto(item)}
        activeOpacity={0.7}
      >
        <Image
          source={{ uri: item.uri }}
          style={styles.photoThumbnail}
          resizeMode="cover"
        />
        {isSelected && (
          <View style={styles.selectedOverlay}>
            <Feather name="check-circle" size={32} color={COLORS.accent} />
          </View>
        )}
        <View style={styles.photoInfo}>
          <Text style={styles.photoDate} numberOfLines={1}>
            {item.creationTime && item.creationTime > 0 
              ? new Date(item.creationTime).toLocaleDateString()
              : item.modificationTime && item.modificationTime > 0
                ? new Date(item.modificationTime).toLocaleDateString()
                : t('nftMint.noDate')}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }, [selectedPhoto]);
  
  // Render footer (loading indicator)
  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.loadingFooter}>
        <ActivityIndicator size="small" color={COLORS.primary} />
      </View>
    );
  };
  
  // Render mint confirmation modal - Compact design matching desktop theme
  const renderMintConfirmModal = () => {
    if (!showMintConfirm) return null;

    return (
      <Modal
        visible={showMintConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMintConfirm(false)}
      >
        <KeyboardAvoidingView 
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <View style={styles.mintPanel}>
            <ScrollView
              contentContainerStyle={styles.mintPanelScroll}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.mintPanelHeader}>
                <View style={styles.mintPanelHeaderLeft}>
                  <Feather name="hexagon" size={18} color={COLORS.primary} />
                  <Text style={styles.mintPanelTitle}>{t('nftMint.nftCollection')}</Text>
                </View>
                <TouchableOpacity onPress={() => setShowMintConfirm(false)} style={styles.mintPanelCloseBtn}>
                  <Feather name="x" size={20} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>

              {isPromoActive() && (
                <GradientBox
                  colors={[COLORS.secondary, '#34d399']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.mintPromoBanner}
                  fallbackColor={COLORS.secondary}
                >
                  <Text style={styles.mintPromoText}>🎉 {t('nftMint.launchSpecialBanner', { days: getPromoDaysRemaining() })}</Text>
                </GradientBox>
              )}

              {/* 1. Edition (Open / Limited) */}
              <Text style={styles.mintSectionLabel}>{t('nftMint.editionLabel')}</Text>
              <View style={[styles.mintCardRow, IS_SMALL_SCREEN && styles.mintCardRowStack]}>
                <TouchableOpacity
                  style={[styles.mintOptionCard, edition === NFT_EDITION.OPEN && styles.mintOptionCardActive]}
                  onPress={() => setEdition(NFT_EDITION.OPEN)}
                  activeOpacity={0.85}
                >
                  <Feather name="image" size={18} color={edition === NFT_EDITION.OPEN ? COLORS.primary : COLORS.textSecondary} style={{ marginBottom: 4 }} />
                  <Text style={styles.mintOptionTitle} numberOfLines={1}>{t('nftMint.openEdition')}</Text>
                  <Text style={styles.mintOptionSubtitle}>{t('nftMint.photoOnBlockchain')}</Text>
                  {/* <Text style={styles.mintOptionPrice}>{t('nftMint.openEditionFee')}</Text> */}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.mintOptionCard, edition === NFT_EDITION.LIMITED && styles.mintOptionCardActive]}
                  onPress={() => setEdition(NFT_EDITION.LIMITED)}
                  activeOpacity={0.85}
                >
                  <Feather name="award" size={18} color={edition === NFT_EDITION.LIMITED ? COLORS.accent : COLORS.textSecondary} style={{ marginBottom: 4 }} />
                  <Text style={styles.mintOptionTitle} numberOfLines={1}>{t('nftMint.limitedEdition')}</Text>
                  <Text style={styles.mintOptionSubtitle}>{t('nftMint.copyrightCertificate')}</Text>
                  {/* <Text style={styles.mintOptionPrice}>{t('nftMint.limitedEditionFee')}</Text> */}
                </TouchableOpacity>
              </View>

              {edition === NFT_EDITION.LIMITED && (
                <View style={styles.mintInfoBanner}>
                  <Feather name="info" size={13} color={COLORS.accent} />
                  <Text style={styles.mintInfoText}>{t('nftMint.limitedEditionInfo')}</Text>
                </View>
              )}

              {/* 2. License */}
              <TouchableOpacity style={styles.mintPrivacyRow} onPress={() => setShowLicensePicker(!showLicensePicker)} activeOpacity={0.85}>
                <View style={styles.mintPrivacyLeft}>
                  <Feather name="file-text" size={14} color={COLORS.primary} />
                  <Text style={styles.mintPrivacyText}>{t('nftMint.licenseLabel')}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[styles.mintPrivacyText, { color: COLORS.textSecondary, marginRight: 4 }]}>
                    {NFT_LICENSE_OPTIONS.find(l => l.id === license)?.short || 'ARR'}
                  </Text>
                  <Feather name={showLicensePicker ? 'chevron-up' : 'chevron-down'} size={14} color={COLORS.textSecondary} />
                </View>
              </TouchableOpacity>

              {showLicensePicker && (
                <View style={styles.mintLicenseList}>
                  {NFT_LICENSE_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt.id}
                      style={[styles.mintLicenseItem, license === opt.id && styles.mintLicenseItemActive]}
                      onPress={() => { setLicense(opt.id); setShowLicensePicker(false); }}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.mintLicenseItemText, license === opt.id && { color: COLORS.primary }]}>{t(`nftMint.license_${opt.id.replace(/-/g,'_')}`) || opt.label}</Text>
                      {license === opt.id && <Feather name="check" size={14} color={COLORS.primary} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* 3. NFT Type (Compressed / Standard) */}
              <Text style={styles.mintSectionLabel}>{t('nftMint.nftType')}</Text>
              <View style={[styles.mintCardRow, IS_SMALL_SCREEN && styles.mintCardRowStack]}>
                <TouchableOpacity
                  style={[styles.mintOptionCard, nftType === 'compressed' && styles.mintOptionCardActive]}
                  onPress={() => setNftType('compressed')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.mintOptionTitle} numberOfLines={1}>{t('nftMint.compressedCNft')}</Text>
                  <Text style={styles.mintOptionSubtitle}>{t('nftMint.compressedCheaper')}</Text>
                  {/* <Text style={styles.mintOptionPrice}>{compressedEstimate ? compressedEstimate.total.usdFormatted : '~$0.02'}</Text> */}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.mintOptionCard, nftType === 'standard' && styles.mintOptionCardActive]}
                  onPress={() => setNftType('standard')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.mintOptionTitle} numberOfLines={1}>{t('nftMint.standardNft')}</Text>
                  <Text style={styles.mintOptionSubtitle}>{t('nftMint.standardTraditional')}</Text>
                  {/* <Text style={styles.mintOptionPrice}>{standardEstimate ? standardEstimate.total.usdFormatted : '~$0.20'}</Text> */}
                </TouchableOpacity>
              </View>

              {/* 4. Image Storage (IPFS / StealthCloud / On-chain) */}
              {!isLimited && (
              <>
              <Text style={styles.mintSectionLabel}>{t('nftMint.imageStorageLabel')}</Text>
              <View style={[styles.mintCardRow, IS_SMALL_SCREEN && styles.mintCardRowStack]}>
                <TouchableOpacity
                  style={[styles.mintOptionCard, storageOption === 'ipfs' && styles.mintOptionCardActive]}
                  onPress={() => setStorageOption('ipfs')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.mintOptionTitle} numberOfLines={1} ellipsizeMode="tail">IPFS</Text>
                  <Text style={styles.mintOptionSubtitle}>{t('nftMint.ipfsSub')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.mintOptionCard,
                    storageOption === 'cloud' && styles.mintOptionCardActive,
                    !cloudEligible && styles.mintOptionCardDisabled,
                  ]}
                  onPress={() => cloudEligible && setStorageOption('cloud')}
                  disabled={!cloudEligible}
                  activeOpacity={0.85}
                >
                  <Text style={styles.mintOptionTitle} numberOfLines={1} ellipsizeMode="tail">StealthCloud</Text>
                  <Text style={styles.mintOptionSubtitle}>{t('nftMint.cloudSub')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.mintOptionCard, storageOption === 'onchain' && styles.mintOptionCardActive]}
                  onPress={() => setStorageOption('onchain')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.mintOptionTitle} numberOfLines={1} ellipsizeMode="tail">{t('nftMint.embeddedTitle')}</Text>
                  <Text style={styles.mintOptionSubtitle}>{t('nftMint.embeddedSub')}</Text>
                </TouchableOpacity>
              </View>
              </>)
              }

              {/* 5. Encrypt & Watermark */}
              <TouchableOpacity
                style={[styles.mintPrivacyRow, isOnchainLocked && !isCloudSelected && { opacity: 0.4 }]}
                onPress={() => !isOnchainLocked && !isCloudSelected && setEncrypt(!encrypt)}
                activeOpacity={isCloudSelected ? 1 : 0.85}
                disabled={isOnchainLocked || isCloudSelected}
              >
                <View style={styles.mintPrivacyLeft}>
                  <Feather name="lock" size={14} color={encrypt ? COLORS.accent : COLORS.textSecondary} />
                  <Text style={styles.mintPrivacyText}>
                    {t('nftMint.encryptImage')}{isCloudSelected ? ` (${t('nftMint.encryptRequired')})` : ''}
                  </Text>
                </View>
                <Switch value={encrypt} onValueChange={isCloudSelected ? undefined : setEncrypt} disabled={isOnchainLocked || isCloudSelected} />
              </TouchableOpacity>

              <TouchableOpacity style={[styles.mintPrivacyRow, isOnchainLocked && { opacity: 0.4 }]} onPress={() => !isOnchainLocked && setWatermark(!watermark)} activeOpacity={0.85} disabled={isOnchainLocked}>
                <View style={styles.mintPrivacyLeft}>
                  <Feather name="droplet" size={14} color={watermark ? COLORS.accent : COLORS.textSecondary} />
                  <Text style={styles.mintPrivacyText}>{t('nftMint.addWatermark')}</Text>
                </View>
                <Switch value={watermark} onValueChange={setWatermark} disabled={isOnchainLocked} />
              </TouchableOpacity>

              {/* 6. Estimated cost */}
              <View style={styles.mintBreakdownBox}>
                <View style={styles.mintBreakdownRow}>
                  <Text style={styles.mintBreakdownLabel}>{t('nftMint.estTotal')}</Text>
                  <Text style={styles.mintBreakdownValue}>
                    {estimatedCost ? `~${estimatedCost.total.usdFormatted}` : '—'}
                  </Text>
                </View>
              </View>

              {/* 7. Selected photo + Name + Description */}
              {selectedPhoto && (
                <View style={styles.mintSelectedPhotoRow}>
                  <View style={styles.mintSelectedPhotoThumb}>
                    <Image
                      source={{ uri: selectedPhoto.uri }}
                      style={styles.mintSelectedPhotoThumbImage}
                      resizeMode="cover"
                    />
                  </View>
                  <View style={styles.mintSelectedPhotoMeta}>
                    <Text style={styles.mintSelectedPhotoName} numberOfLines={1}>
                      {selectedPhoto.filename || t('nftMint.selectedPhoto')}
                    </Text>
                    <Text style={styles.mintSelectedPhotoSub} numberOfLines={1}>
                      {selectedPhoto.width}x{selectedPhoto.height}
                    </Text>
                  </View>
                </View>
              )}

              <TextInput
                style={styles.mintInput}
                value={nftName}
                onChangeText={setNftName}
                placeholder={t('nftMint.nftName')}
                placeholderTextColor={COLORS.textSecondary}
                maxLength={50}
              />
              {/* Description hidden — kept for future use
              <TextInput
                style={styles.mintInput}
                value={nftDescription}
                onChangeText={setNftDescription}
                placeholder={t('nftMint.descriptionOptional')}
                placeholderTextColor={COLORS.textSecondary}
                maxLength={200}
              />
              */}

              <TouchableOpacity style={styles.mintPrivacyRow} onPress={() => setStripExif(!stripExif)} activeOpacity={0.85}>
                <View style={styles.mintPrivacyLeft}>
                  <Feather name="shield" size={14} color={stripExif ? COLORS.accent : COLORS.textSecondary} />
                  <Text style={styles.mintPrivacyText}>{t('nftMint.removePrivateData')}</Text>
                </View>
                <Switch value={stripExif} onValueChange={setStripExif} />
              </TouchableOpacity>

              {/* 8. Actions */}
              <View style={styles.mintActionsRow}>
                <TouchableOpacity style={styles.mintCancelBtn} onPress={() => setShowMintConfirm(false)}>
                  <Text style={styles.mintCancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.mintCtaBtn} onPress={handleMintConfirm}>
                  <GradientBox
                    colors={[COLORS.primary, COLORS.secondary]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.mintCtaBtnGradient}
                    fallbackColor={COLORS.primary}
                  >
                    <Feather name="zap" size={16} color="#fff" />
                    <Text style={styles.mintCtaText}>
                      {loadingCost ? t('nftMint.estimating') || t('nftMint.mintNft') : t('nftMint.mintNft')}
                    </Text>
                  </GradientBox>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  };
  
  if (!visible) return null;
  
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Feather name="x" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('nftMint.selectPhotoForNft')}</Text>
          <TouchableOpacity
            style={[styles.nextButton, !selectedPhoto && styles.nextButtonDisabled]}
            onPress={() => selectedPhoto && setShowMintConfirm(true)}
            disabled={!selectedPhoto}
          >
            <Text style={[styles.nextButtonText, !selectedPhoto && styles.nextButtonTextDisabled]}>
              {t('nftMint.next')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Photo grid */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>{t('nftMint.loadingPhotos')}</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={photos}
            renderItem={renderPhoto}
            keyExtractor={(item) => item.id}
            numColumns={2}
            contentContainerStyle={styles.gridContainer}
            columnWrapperStyle={styles.gridRow}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={renderFooter}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Feather name="image" size={48} color={COLORS.textSecondary} />
                <Text style={styles.emptyText}>{t('nftMint.noPhotosFound')}</Text>
              </View>
            }
          />
        )}
        
        {/* Mint confirmation modal */}
        {renderMintConfirmModal()}
        
        {/* Welcome popup for first-time users — absolute View avoids Android nav bar cutoff */}
        {showWelcome && (
          <View style={styles.welcomeOverlay}>
            <View style={styles.welcomeModal}>
              {/* Header */}
              <View style={styles.welcomeHeader}>
                <Text style={styles.welcomeTitle}>{t('nftWelcome.title')}</Text>
                <TouchableOpacity onPress={handleWelcomeDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Feather name="x" size={18} color="#52525b" />
                </TouchableOpacity>
              </View>
              <Text style={styles.welcomeSubtitle}>{t('nftWelcome.subtitle')}</Text>

              <ScrollView style={styles.welcomeScroll} showsVerticalScrollIndicator={false} bounces={false}>

              {/* Scenario label */}
              <Text style={styles.welcomeLabel}>{t('nftWelcome.scenarioLabel')}</Text>

              {/* Example 1: Public */}
              <View style={styles.welcomeExample}>
                <View style={styles.welcomeExHead}>
                  <View style={[styles.welcomeExTag, { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
                    <Text style={[styles.welcomeExTagText, { color: '#4ade80' }]}>{t('nftWelcome.publicTag')}</Text>
                  </View>
                  <Text style={styles.welcomeExName}>{t('nftWelcome.publicName')}</Text>
                </View>
                <Text style={styles.welcomeExDesc}>{t('nftWelcome.publicDesc')}</Text>
                <View style={styles.welcomeChipRow}>
                  <View style={styles.welcomeChipGreen}><Text style={styles.welcomeChipGreenText}>{t('nftWelcome.publicChip1')}</Text></View>
                  <View style={styles.welcomeChipGreen}><Text style={styles.welcomeChipGreenText}>{t('nftWelcome.publicChip2')}</Text></View>
                  <View style={styles.welcomeChipAmber}><Text style={styles.welcomeChipAmberText}>{t('nftWelcome.publicChip3')}</Text></View>
                </View>
                <TouchableOpacity style={styles.welcomeDetailToggle} onPress={() => setExpandedDetail(expandedDetail === 'public' ? null : 'public')} activeOpacity={0.7}>
                  <Text style={styles.welcomeDetailToggleText}>{t('nftWelcome.details')}</Text>
                  <Feather name={expandedDetail === 'public' ? 'chevron-down' : 'chevron-right'} size={12} color="#52525b" />
                </TouchableOpacity>
                {expandedDetail === 'public' && (
                  <View style={styles.welcomeDetailBody}>
                    <Text style={styles.welcomeProText}>+ {t('nftWelcome.publicPro1')}</Text>
                    <Text style={styles.welcomeProText}>+ {t('nftWelcome.publicPro2')}</Text>
                    <Text style={styles.welcomeProText}>+ {t('nftWelcome.publicPro3')}</Text>
                    <Text style={styles.welcomeProText}>+ {t('nftWelcome.publicPro4')}</Text>
                    <Text style={styles.welcomeConText}>– {t('nftWelcome.publicCon1')}</Text>
                    <Text style={styles.welcomeConText}>– {t('nftWelcome.publicCon2')}</Text>
                  </View>
                )}
              </View>

              {/* Example 2: Private */}
              <View style={styles.welcomeExample}>
                <View style={styles.welcomeExHead}>
                  <View style={[styles.welcomeExTag, { backgroundColor: 'rgba(99,102,241,0.15)' }]}>
                    <Text style={[styles.welcomeExTagText, { color: '#818cf8' }]}>{t('nftWelcome.privateTag')}</Text>
                  </View>
                  <Text style={styles.welcomeExName}>{t('nftWelcome.privateName')}</Text>
                </View>
                <Text style={styles.welcomeExDesc}>{t('nftWelcome.privateDesc')}</Text>
                <View style={styles.welcomeChipRow}>
                  <View style={styles.welcomeChipGreen}><Text style={styles.welcomeChipGreenText}>{t('nftWelcome.privateChip1')}</Text></View>
                  <View style={styles.welcomeChipGreen}><Text style={styles.welcomeChipGreenText}>{t('nftWelcome.privateChip2')}</Text></View>
                  <View style={styles.welcomeChipGreen}><Text style={styles.welcomeChipGreenText}>{t('nftWelcome.privateChip3')}</Text></View>
                </View>
                <TouchableOpacity style={styles.welcomeDetailToggle} onPress={() => setExpandedDetail(expandedDetail === 'private' ? null : 'private')} activeOpacity={0.7}>
                  <Text style={styles.welcomeDetailToggleText}>{t('nftWelcome.details')}</Text>
                  <Feather name={expandedDetail === 'private' ? 'chevron-down' : 'chevron-right'} size={12} color="#52525b" />
                </TouchableOpacity>
                {expandedDetail === 'private' && (
                  <View style={styles.welcomeDetailBody}>
                    <Text style={styles.welcomeProText}>+ {t('nftWelcome.privatePro1')}</Text>
                    <Text style={styles.welcomeProText}>+ {t('nftWelcome.privatePro2')}</Text>
                    <Text style={styles.welcomeProText}>+ {t('nftWelcome.privatePro3')}</Text>
                    <Text style={styles.welcomeProText}>+ {t('nftWelcome.privatePro4')}</Text>
                    <Text style={styles.welcomeConText}>– {t('nftWelcome.privateCon1')}</Text>
                    <Text style={styles.welcomeConText}>– {t('nftWelcome.privateCon2')}</Text>
                  </View>
                )}
              </View>

              {/* Example 3: Certificate */}
              <View style={styles.welcomeExample}>
                <View style={styles.welcomeExHead}>
                  <View style={[styles.welcomeExTag, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
                    <Text style={[styles.welcomeExTagText, { color: '#fbbf24' }]}>{t('nftWelcome.certTag')}</Text>
                  </View>
                  <Text style={styles.welcomeExName}>{t('nftWelcome.certName')}</Text>
                </View>
                <Text style={styles.welcomeExDesc}>{t('nftWelcome.certDesc')}</Text>
                <View style={styles.welcomeChipRow}>
                  <View style={styles.welcomeChipGreen}><Text style={styles.welcomeChipGreenText}>{t('nftWelcome.certChip1')}</Text></View>
                  <View style={styles.welcomeChipGreen}><Text style={styles.welcomeChipGreenText}>{t('nftWelcome.certChip2')}</Text></View>
                  <View style={styles.welcomeChipGreen}><Text style={styles.welcomeChipGreenText}>{t('nftWelcome.certChip3')}</Text></View>
                </View>
                <TouchableOpacity style={styles.welcomeDetailToggle} onPress={() => setExpandedDetail(expandedDetail === 'cert' ? null : 'cert')} activeOpacity={0.7}>
                  <Text style={styles.welcomeDetailToggleText}>{t('nftWelcome.details')}</Text>
                  <Feather name={expandedDetail === 'cert' ? 'chevron-down' : 'chevron-right'} size={12} color="#52525b" />
                </TouchableOpacity>
                {expandedDetail === 'cert' && (
                  <View style={styles.welcomeDetailBody}>
                    <Text style={styles.welcomeProText}>+ {t('nftWelcome.certPro1')}</Text>
                    <Text style={styles.welcomeProText}>+ {t('nftWelcome.certPro2')}</Text>
                    <Text style={styles.welcomeProText}>+ {t('nftWelcome.certPro3')}</Text>
                    <Text style={styles.welcomeProText}>+ {t('nftWelcome.certPro4')}</Text>
                    <Text style={styles.welcomeProText}>+ {t('nftWelcome.certPro5')}</Text>
                    <Text style={styles.welcomeConText}>– {t('nftWelcome.certCon1')}</Text>
                    <Text style={styles.welcomeConText}>– {t('nftWelcome.certCon2')}</Text>
                  </View>
                )}
              </View>

              {/* Key facts */}
              <Text style={styles.welcomeLabel}>{t('nftWelcome.keyFactsLabel')}</Text>

              <View style={styles.welcomeNote}>
                <Text style={styles.welcomeNoteText}><Text style={styles.welcomeNoteBold}>{t('nftWelcome.factImageTitle')}</Text> {t('nftWelcome.factImageDesc')}</Text>
              </View>
              <View style={[styles.welcomeNote, { marginTop: 4 }]}>
                <Text style={styles.welcomeNoteText}><Text style={styles.welcomeNoteBold}>{t('nftWelcome.factExifTitle')}</Text> {t('nftWelcome.factExifDesc')}</Text>
              </View>
              <View style={[styles.welcomeNote, { marginTop: 4 }]}>
                <Text style={styles.welcomeNoteText}><Text style={styles.welcomeNoteBold}>{t('nftWelcome.factEncryptionTitle')}</Text> {t('nftWelcome.factEncryptionDesc')}</Text>
              </View>
              <View style={[styles.welcomeNote, { marginTop: 4, marginBottom: 4 }]}>
                <Text style={styles.welcomeNoteText}><Text style={styles.welcomeNoteBold}>{t('nftWelcome.factPublicTitle')}</Text> {t('nftWelcome.factPublicDesc')}</Text>
              </View>

              </ScrollView>

              {/* Don't show again toggle */}
              <TouchableOpacity 
                style={styles.welcomeToggle}
                onPress={() => setDontShowWelcomeAgain(!dontShowWelcomeAgain)}
                activeOpacity={0.7}
              >
                <View style={[styles.welcomeCheckbox, dontShowWelcomeAgain && styles.welcomeCheckboxChecked]}>
                  {dontShowWelcomeAgain && <Feather name="check" size={12} color="#fff" />}
                </View>
                <Text style={styles.welcomeToggleText}>{t('nftWelcome.dontShowAgain')}</Text>
              </TouchableOpacity>
              
              {/* Got It button */}
              <TouchableOpacity
                style={styles.welcomeButton}
                onPress={handleWelcomeDismiss}
              >
                <Text style={styles.welcomeButtonText}>{t('nftWelcome.gotIt')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingTop: Platform.OS === 'ios' ? 50 : 12,
  },
  closeButton: {
    padding: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginHorizontal: 8,
  },
  nextButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
  },
  nextButtonDisabled: {
    backgroundColor: COLORS.surfaceLight,
  },
  nextButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  nextButtonTextDisabled: {
    color: COLORS.textSecondary,
  },
  selectedPreview: {
    flexDirection: 'column',
    padding: 12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  selectedPreviewBox: {
    width: '100%',
    height: 170,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
  },
  selectedImage: {
    width: '100%',
    height: '100%',
  },
  selectedInfo: {
    flex: 1,
    marginTop: 10,
  },
  selectedFilename: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  selectedMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  exifBadge: {
    fontSize: 10,
    color: COLORS.accent,
    fontWeight: '600',
  },
  selectedLocation: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  selectedCamera: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: COLORS.textSecondary,
  },
  gridContainer: {
    padding: 8,
  },
  gridRow: {
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  photoContainer: {
    width: LARGE_THUMBNAIL_SIZE,
    height: LARGE_THUMBNAIL_SIZE,
    marginBottom: 16,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  photoSelected: {
    borderWidth: 3,
    borderColor: COLORS.accent,
  },
  photoThumbnail: {
    width: '100%',
    height: '100%',
  },
  selectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  photoDate: {
    fontSize: 11,
    color: '#fff',
  },
  loadingFooter: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    marginTop: 12,
    color: COLORS.textSecondary,
    fontSize: 16,
  },
  
  // Mint confirmation modal - Compact design
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 16 + ANDROID_NAV_BAR_HEIGHT,
  },
  mintPanel: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    maxHeight: '92%',
  },
  mintPanelScroll: {
    padding: 16,
    paddingBottom: 18,
    flexGrow: 1,
  },
  mintPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  mintPanelHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mintPanelTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.primary,
  },
  mintPanelCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  mintPromoBanner: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  mintPromoText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
    textAlign: 'center',
  },
  mintSectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.textSecondary,
    marginBottom: 10,
    letterSpacing: 0.6,
  },
  mintCardRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  mintCardRowStack: {
    flexDirection: 'column',
  },
  mintOptionCard: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    minHeight: 98,
    justifyContent: 'center',
  },
  mintOptionCardActive: {
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(153, 69, 255, 0.18)',
  },
  mintOptionCardActiveAlt: {
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  mintOptionCardDisabled: {
    opacity: 0.45,
  },
  mintOptionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
  },
  mintOptionSubtitle: {
    marginTop: 6,
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  mintOptionPrice: {
    marginTop: 8,
    fontSize: 16,
    fontWeight: '900',
    color: COLORS.accent,
    textAlign: 'center',
  },
  mintBreakdownBox: {
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  mintBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  mintBreakdownLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  mintBreakdownValue: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  mintSelectedPhotoRow: {
    flexDirection: 'column',
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    padding: 12,
    marginBottom: 12,
  },
  mintSelectedPhotoThumb: {
    width: '100%',
    height: 170,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(255,255,255,0.03)',
    overflow: 'hidden',
  },
  mintSelectedPhotoThumbImage: {
    width: '100%',
    height: '100%',
  },
  mintSelectedPhotoMeta: {
    flex: 1,
    minWidth: 0,
    marginTop: 10,
  },
  mintSelectedPhotoName: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  mintSelectedPhotoSub: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  mintInput: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: COLORS.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    marginBottom: 10,
  },
  mintPrivacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  mintPrivacyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mintPrivacyText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '600',
  },
  mintInfoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.25)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  mintInfoText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  mintLicenseList: {
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    marginBottom: 14,
    marginTop: -8,
    overflow: 'hidden',
  },
  mintLicenseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  mintLicenseItemActive: {
    backgroundColor: 'rgba(153, 69, 255, 0.12)',
  },
  mintLicenseItemText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '500',
  },
  mintActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 2,
  },
  mintCancelBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mintCancelText: {
    color: COLORS.text,
    fontWeight: '700',
    fontSize: 14,
  },
  mintCtaBtn: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  mintCtaBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  mintCtaText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  compactModal: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  compactHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  compactTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  compactCloseBtn: {
    padding: 4,
  },
  compactPreview: {
    width: '100%',
    height: 120,
    borderRadius: 10,
    marginBottom: 12,
  },
  compactInput: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    padding: 10,
    color: COLORS.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
  },
  compactRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  compactBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  compactBtnActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  compactBtnActiveAlt: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  compactBtnDisabled: {
    opacity: 0.4,
  },
  compactBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  compactBtnTextActive: {
    color: '#fff',
  },
  compactBtnTextDisabled: {
    color: COLORS.border,
  },
  compactBtnPrice: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  compactBtnPriceActive: {
    color: 'rgba(255,255,255,0.8)',
  },
  compactPrivacy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  compactPrivacyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactPrivacyText: {
    fontSize: 12,
    color: COLORS.text,
  },
  compactToggle: {
    width: 36,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.border,
    padding: 2,
    justifyContent: 'center',
  },
  compactToggleOn: {
    backgroundColor: COLORS.accent,
  },
  compactToggleKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  compactToggleKnobOn: {
    alignSelf: 'flex-end',
  },
  compactCost: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  compactCostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  compactCostLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  compactCostValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.accent,
  },
  compactPromoBadge: {
    backgroundColor: '#22c55e20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  compactPromoText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#22c55e',
  },
  compactSavings: {
    fontSize: 11,
    color: COLORS.accent,
    textAlign: 'center',
    marginTop: 6,
  },
  compactActions: {
    flexDirection: 'row',
    gap: 10,
  },
  compactCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
  },
  compactCancelText: {
    color: COLORS.text,
    fontWeight: '600',
    fontSize: 14,
  },
  compactMintBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  compactMintText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  // Welcome popup styles — professional scenario-based design
  welcomeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 20 + ANDROID_NAV_BAR_HEIGHT,
    zIndex: 999,
  },
  welcomeModal: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    width: '100%',
    maxWidth: 380,
    maxHeight: SCREEN_HEIGHT - 60 - ANDROID_NAV_BAR_HEIGHT,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  welcomeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  welcomeTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  welcomeSubtitle: {
    fontSize: 11,
    color: '#71717a',
    lineHeight: 15,
    marginBottom: 12,
  },
  welcomeScroll: {
    flexGrow: 0,
  },
  welcomeLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#52525b',
    letterSpacing: 0.6,
    marginTop: 12,
    marginBottom: 6,
  },
  welcomeExample: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  welcomeExHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 4,
  },
  welcomeExTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  welcomeExTagText: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  welcomeExName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#e4e4e7',
  },
  welcomeExDesc: {
    fontSize: 10.5,
    color: '#a1a1aa',
    lineHeight: 15,
    marginBottom: 5,
  },
  welcomeChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  welcomeChipGreen: {
    backgroundColor: 'rgba(34,197,94,0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  welcomeChipGreenText: {
    fontSize: 9,
    color: '#4ade80',
  },
  welcomeChipAmber: {
    backgroundColor: 'rgba(245,158,11,0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  welcomeChipAmberText: {
    fontSize: 9,
    color: '#fbbf24',
  },
  welcomeDetailToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  welcomeDetailToggleText: {
    fontSize: 10,
    color: '#52525b',
  },
  welcomeDetailBody: {
    paddingTop: 5,
  },
  welcomeProText: {
    fontSize: 10,
    color: '#71717a',
    lineHeight: 14,
    marginBottom: 2,
  },
  welcomeConText: {
    fontSize: 10,
    color: '#71717a',
    lineHeight: 14,
    marginBottom: 2,
  },
  welcomeNote: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  welcomeNoteText: {
    fontSize: 10,
    color: '#52525b',
    lineHeight: 14,
  },
  welcomeNoteBold: {
    color: '#a1a1aa',
    fontWeight: '600',
  },
  welcomeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  welcomeCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#3f3f46',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  welcomeCheckboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  welcomeToggleText: {
    fontSize: 12,
    color: '#52525b',
  },
  welcomeButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  welcomeButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});

export default NFTPhotoPicker;
