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
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import { Feather } from '@expo/vector-icons';
import { t } from './i18n';
import { estimateNFTMintCost, isCNFTAvailable, NFT_FEES, isPromoActive, getPromoDaysRemaining } from './nftOperations';

const NFT_WELCOME_SHOWN_KEY = 'nft_welcome_shown';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
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
      setCloudEligible(false);
      setCloudReason('');
      setEstimatedCost(null);
    }
  }, [visible]);
  
  // Check StealthCloud eligibility when picker opens
  useEffect(() => {
    if (visible && checkCloudEligibility) {
      setCheckingCloud(true);
      checkCloudEligibility(5 * 1024 * 1024) // Estimate 5MB
        .then(result => {
          setCloudEligible(result.eligible);
          setCloudReason(result.reason || '');
        })
        .catch(() => {
          setCloudEligible(false);
          setCloudReason('Could not check');
        })
        .finally(() => setCheckingCloud(false));
    }
  }, [visible, checkCloudEligibility]);
  
  // Estimate cost when options change
  useEffect(() => {
    if (showMintConfirm && selectedPhoto) {
      setLoadingCost(true);
      const fileSize = selectedPhoto.fileSize || 2 * 1024 * 1024; // Estimate 2MB if unknown
      const useCompressed = nftType === 'compressed';
      estimateNFTMintCost(fileSize, storageOption, useCompressed)
        .then(cost => setEstimatedCost(cost))
        .catch(e => {
          console.log('[NFTPicker] Cost estimation failed:', e.message);
          setEstimatedCost(null);
        })
        .finally(() => setLoadingCost(false));
    }
  }, [showMintConfirm, selectedPhoto, storageOption, nftType]);

  // Card estimates for both types (used for desktop-like UI)
  useEffect(() => {
    if (showMintConfirm && selectedPhoto) {
      const fileSize = selectedPhoto.fileSize || 2 * 1024 * 1024;
      Promise.all([
        estimateNFTMintCost(fileSize, storageOption, true).catch(() => null),
        estimateNFTMintCost(fileSize, storageOption, false).catch(() => null),
      ])
        .then(([cnft, standard]) => {
          setCompressedEstimate(cnft);
          setStandardEstimate(standard);
        })
        .catch(() => {
          setCompressedEstimate(null);
          setStandardEstimate(null);
        });
    }
  }, [showMintConfirm, selectedPhoto, storageOption]);
  
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
      
      if (after) {
        setPhotos(prev => [...prev, ...result.assets]);
      } else {
        setPhotos(result.assets);
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
      costEstimate: estimatedCost, // Pass the pre-calculated cost to avoid recalculation
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
                : 'No date'}
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
                  <Text style={styles.mintPanelTitle}>NFT Memories</Text>
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
                  <Text style={styles.mintPromoText}>🎉 Launch Special - {getPromoDaysRemaining()} Days Left! Up to 90% off!</Text>
                </GradientBox>
              )}

              <Text style={styles.mintSectionLabel}>NFT TYPE</Text>
              <View style={[styles.mintCardRow, IS_SMALL_SCREEN && styles.mintCardRowStack]}>
                <TouchableOpacity
                  style={[styles.mintOptionCard, nftType === 'compressed' && styles.mintOptionCardActive]}
                  onPress={() => setNftType('compressed')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.mintOptionTitle} numberOfLines={2}>Compressed (cNFT)</Text>
                  <Text style={styles.mintOptionSubtitle}>99.99% cheaper</Text>
                  <Text style={styles.mintOptionPrice}>
                    {compressedEstimate?.total?.usdFormatted || (storageOption === 'cloud' ? '~$0.02' : '~$0.05')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.mintOptionCard, nftType === 'standard' && styles.mintOptionCardActive]}
                  onPress={() => setNftType('standard')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.mintOptionTitle} numberOfLines={2}>Standard NFT</Text>
                  <Text style={styles.mintOptionSubtitle}>Traditional</Text>
                  <Text style={styles.mintOptionPrice}>
                    {standardEstimate?.total?.usdFormatted || (storageOption === 'cloud' ? '~$0.20' : '~$0.50')}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.mintSectionLabel}>IMAGE STORAGE</Text>
              <View style={[styles.mintCardRow, IS_SMALL_SCREEN && styles.mintCardRowStack]}>
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
                  <Text style={styles.mintOptionSubtitle}>
                    Free storage • ${(nftType === 'compressed' ? NFT_FEES.APP_COMMISSION_CNFT_CLOUD_USD : NFT_FEES.APP_COMMISSION_STANDARD_CLOUD_USD).toFixed(2)} fee
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.mintOptionCard, storageOption === 'ipfs' && styles.mintOptionCardActive]}
                  onPress={() => setStorageOption('ipfs')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.mintOptionTitle} numberOfLines={1} ellipsizeMode="tail">IPFS</Text>
                  <Text style={styles.mintOptionSubtitle}>
                    Decentralized • ${(nftType === 'compressed' ? NFT_FEES.APP_COMMISSION_CNFT_IPFS_USD : NFT_FEES.APP_COMMISSION_STANDARD_IPFS_USD).toFixed(2)} fee
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.mintBreakdownBox}>
                <View style={styles.mintBreakdownRow}>
                  <Text style={styles.mintBreakdownLabel}>App fee (you pay)</Text>
                  <Text style={styles.mintBreakdownValue}>
                    {estimatedCost
                      ? `$${estimatedCost.breakdown.appCommission.usd.toFixed(2)} (${estimatedCost.breakdown.appCommission.sol.toFixed(6)} SOL)`
                      : '—'}
                  </Text>
                </View>
                <View style={styles.mintBreakdownRow}>
                  <Text style={styles.mintBreakdownLabel}>Network (est.)</Text>
                  <Text style={styles.mintBreakdownValue}>
                    {estimatedCost
                      ? `${(
                          estimatedCost.breakdown.transactionFee.sol +
                          estimatedCost.breakdown.solanaRent.sol +
                          estimatedCost.breakdown.metaplexFee.sol
                        ).toFixed(6)} SOL`
                      : '—'}
                  </Text>
                </View>
                <View style={styles.mintBreakdownRow}>
                  <Text style={styles.mintBreakdownLabel}>Storage (est.)</Text>
                  <Text style={styles.mintBreakdownValue}>
                    {estimatedCost
                      ? `$${(
                          estimatedCost.breakdown.arweaveImage.usd +
                          estimatedCost.breakdown.arweaveMetadata.usd
                        ).toFixed(2)}`
                      : '—'}
                  </Text>
                </View>
                <View style={styles.mintBreakdownRow}>
                  <Text style={styles.mintBreakdownLabel}>SOL/USD</Text>
                  <Text style={styles.mintBreakdownValue}>{estimatedCost ? `$${estimatedCost.solPrice.toFixed(2)}` : '—'}</Text>
                </View>
              </View>

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
                      {selectedPhoto.filename || 'Selected photo'}
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
              <TextInput
                style={styles.mintInput}
                value={nftDescription}
                onChangeText={setNftDescription}
                placeholder={t('nftMint.descriptionOptional')}
                placeholderTextColor={COLORS.textSecondary}
                maxLength={200}
              />

              <TouchableOpacity style={styles.mintPrivacyRow} onPress={() => setStripExif(!stripExif)} activeOpacity={0.85}>
                <View style={styles.mintPrivacyLeft}>
                  <Feather name="shield" size={14} color={stripExif ? COLORS.accent : COLORS.textSecondary} />
                  <Text style={styles.mintPrivacyText}>{t('nftMint.removePrivateData')}</Text>
                </View>
                <Switch value={stripExif} onValueChange={setStripExif} />
              </TouchableOpacity>

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
                <Text style={styles.emptyText}>No photos found</Text>
              </View>
            }
          />
        )}
        
        {/* Mint confirmation modal */}
        {renderMintConfirmModal()}
        
        {/* Welcome popup for first-time users */}
        <Modal
          visible={showWelcome}
          transparent
          animationType="fade"
          onRequestClose={handleWelcomeDismiss}
        >
          <View style={styles.welcomeOverlay}>
            <View style={styles.welcomeModal}>
              {/* Header */}
              <View style={styles.welcomeHeader}>
                <View style={styles.welcomeIconContainer}>
                  <Feather name="image" size={24} color={COLORS.primary} />
                </View>
                <Text style={styles.welcomeTitle}>{t('nftWelcome.title')}</Text>
              </View>
              
              {/* What is NFT */}
              <View style={styles.welcomeSection}>
                <View style={styles.welcomeSectionHeader}>
                  <Feather name="help-circle" size={14} color={COLORS.primary} />
                  <Text style={styles.welcomeSectionTitle}>{t('nftWelcome.whatIsNft')}</Text>
                </View>
                <Text style={styles.welcomeSectionText}>{t('nftWelcome.whatIsNftDesc')}</Text>
              </View>
              
              {/* Public Warning */}
              <View style={styles.welcomeSection}>
                <View style={styles.welcomeSectionHeader}>
                  <Feather name="alert-triangle" size={14} color={COLORS.warning} />
                  <Text style={styles.welcomeSectionTitle}>{t('nftWelcome.publicWarning')}</Text>
                </View>
                <Text style={styles.welcomeSectionText}>{t('nftWelcome.publicWarningDesc')}</Text>
              </View>
              
              {/* Size Recommendation */}
              <View style={styles.welcomeSection}>
                <View style={styles.welcomeSectionHeader}>
                  <Feather name="maximize-2" size={14} color={COLORS.accent} />
                  <Text style={styles.welcomeSectionTitle}>{t('nftWelcome.sizeRecommendation')}</Text>
                </View>
                <Text style={styles.welcomeSectionText}>{t('nftWelcome.sizeRecommendationDesc')}</Text>
              </View>
              
              {/* Loading Note */}
              <View style={styles.welcomeSection}>
                <View style={styles.welcomeSectionHeader}>
                  <Feather name="wifi" size={14} color={COLORS.textSecondary} />
                  <Text style={styles.welcomeSectionTitle}>{t('nftWelcome.loadingNote')}</Text>
                </View>
                <Text style={styles.welcomeSectionText}>{t('nftWelcome.loadingNoteDesc')}</Text>
              </View>
              
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
        </Modal>
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
  // Welcome popup styles - compact to fit screen without scrolling
  welcomeOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  welcomeModal: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    width: '100%',
    maxWidth: 360,
  },
  welcomeHeader: {
    alignItems: 'center',
    marginBottom: 12,
  },
  welcomeIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: `${COLORS.primary}20`,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  welcomeTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  welcomeSection: {
    marginBottom: 10,
  },
  welcomeSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  welcomeSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginLeft: 6,
  },
  welcomeSectionText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    lineHeight: 15,
    paddingLeft: 22,
  },
  welcomeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 12,
  },
  welcomeCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  welcomeCheckboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  welcomeToggleText: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  welcomeButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  welcomeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});

export default NFTPhotoPicker;
