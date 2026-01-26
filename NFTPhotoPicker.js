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
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Switch,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as SecureStore from 'expo-secure-store';
import { Feather } from '@expo/vector-icons';
import { t } from './i18n';
import { estimateNFTMintCost, isCNFTAvailable, NFT_FEES, isPromoActive, getPromoDaysRemaining } from './nftOperations';

const NFT_WELCOME_SHOWN_KEY = 'nft_welcome_shown';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const THUMBNAIL_SIZE = (SCREEN_WIDTH - 48) / 3; // 3 columns with padding
const LARGE_THUMBNAIL_SIZE = (SCREEN_WIDTH - 32) / 2; // 2 columns for NFT picker

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
  
  // Render mint confirmation modal
  const renderMintConfirmModal = () => (
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
        <ScrollView 
          style={styles.mintConfirmModal}
          contentContainerStyle={styles.mintConfirmContent}
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          bounces={true}
        >
              <Text style={styles.modalTitle}>{t('nftMint.createNft')}</Text>
              
              {selectedPhoto && (
                <Image
                  source={{ uri: selectedPhoto.uri }}
                  style={styles.previewImage}
                  resizeMode="contain"
                />
              )}
              
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>{t('nftMint.nftName')}</Text>
                <TextInput
                  style={styles.textInput}
                  value={nftName}
                  onChangeText={setNftName}
                  placeholder={t('nftMint.enterNftName')}
                  placeholderTextColor={COLORS.textSecondary}
                  maxLength={50}
                  returnKeyType="next"
                  blurOnSubmit={false}
                />
              </View>
              
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>{t('nftMint.descriptionOptional')}</Text>
                <TextInput
                  style={[styles.textInput, styles.textArea]}
                  value={nftDescription}
                  onChangeText={setNftDescription}
                  placeholder={t('nftMint.enterDescription')}
                  placeholderTextColor={COLORS.textSecondary}
                  multiline
                  numberOfLines={3}
                  maxLength={200}
                  returnKeyType="done"
                  blurOnSubmit={true}
                  onSubmitEditing={Keyboard.dismiss}
                />
              </View>
          
              {/* NFT Type selector */}
              <View style={styles.storageSection}>
                <Text style={styles.storageSectionTitle}>{t('nftMint.nftType')}</Text>
                
                {/* Compressed NFT Option (Recommended) */}
                <TouchableOpacity 
                  style={[styles.storageOption, nftType === 'compressed' && styles.storageOptionSelected]}
                  onPress={() => setNftType('compressed')}
                  activeOpacity={0.7}
                >
                  <View style={styles.storageOptionLeft}>
                    <Feather name="zap" size={20} color={nftType === 'compressed' ? COLORS.accent : COLORS.textSecondary} />
                    <View style={styles.storageOptionText}>
                      <Text style={[styles.storageOptionTitle, nftType === 'compressed' && { color: COLORS.accent }]}>
                        {t('nftMint.compressedNft')}
                        <Text style={styles.recommendedBadge}> ({t('nftMint.recommended')})</Text>
                      </Text>
                      <Text style={styles.storageOptionDesc}>
                        ~${storageOption === 'cloud' ? '0.02' : '0.05'} {t('nftMint.total')} • {t('nftMint.compressedDesc')}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.radioOuter, nftType === 'compressed' && { borderColor: COLORS.accent }]}>
                    {nftType === 'compressed' && <View style={[styles.radioInner, { backgroundColor: COLORS.accent }]} />}
                  </View>
                </TouchableOpacity>
                
                {/* Standard NFT Option */}
                <TouchableOpacity 
                  style={[styles.storageOption, nftType === 'standard' && styles.storageOptionSelected]}
                  onPress={() => setNftType('standard')}
                  activeOpacity={0.7}
                >
                  <View style={styles.storageOptionLeft}>
                    <Feather name="hexagon" size={20} color={nftType === 'standard' ? COLORS.primary : COLORS.textSecondary} />
                    <View style={styles.storageOptionText}>
                      <Text style={[styles.storageOptionTitle, nftType === 'standard' && styles.storageOptionTitleSelected]}>
                        {t('nftMint.standardNft')}
                      </Text>
                      <Text style={styles.storageOptionDesc}>
                        ~${storageOption === 'cloud' ? '2.80' : '3.10'} {t('nftMint.total')} • {t('nftMint.standardDesc')}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.radioOuter, nftType === 'standard' && styles.radioOuterSelected]}>
                    {nftType === 'standard' && <View style={styles.radioInner} />}
                  </View>
                </TouchableOpacity>
              </View>
              
              {/* Storage option selector */}
              <View style={styles.storageSection}>
                <Text style={styles.storageSectionTitle}>{t('nftMint.imageStorage')}</Text>
                
                {/* IPFS Option */}
                <TouchableOpacity 
                  style={[styles.storageOption, storageOption === 'ipfs' && styles.storageOptionSelected]}
                  onPress={() => setStorageOption('ipfs')}
                  activeOpacity={0.7}
                >
                  <View style={styles.storageOptionLeft}>
                    <Feather name="globe" size={20} color={storageOption === 'ipfs' ? COLORS.primary : COLORS.textSecondary} />
                    <View style={styles.storageOptionText}>
                      <Text style={[styles.storageOptionTitle, storageOption === 'ipfs' && styles.storageOptionTitleSelected]}>
                        {t('nftMint.ipfsDecentralized')}
                      </Text>
                      <Text style={styles.storageOptionDesc}>
                        {nftType === 'compressed' 
                          ? `${t('nftMint.permanent')} • $0.05 fee • ${t('nftMint.decentralized')}`
                          : `${t('nftMint.permanent')} • $0.50 fee • ${t('nftMint.decentralized')}`}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.radioOuter, storageOption === 'ipfs' && styles.radioOuterSelected]}>
                    {storageOption === 'ipfs' && <View style={styles.radioInner} />}
                  </View>
                </TouchableOpacity>
                
                {/* StealthCloud Option */}
                <TouchableOpacity 
                  style={[
                    styles.storageOption, 
                    storageOption === 'cloud' && styles.storageOptionSelected,
                    !cloudEligible && styles.storageOptionDisabled,
                  ]}
                  onPress={() => cloudEligible && setStorageOption('cloud')}
                  activeOpacity={cloudEligible ? 0.7 : 1}
                  disabled={!cloudEligible}
                >
                  <View style={styles.storageOptionLeft}>
                    <Feather name="cloud" size={20} color={cloudEligible ? (storageOption === 'cloud' ? COLORS.accent : COLORS.textSecondary) : COLORS.border} />
                    <View style={styles.storageOptionText}>
                      <Text style={[
                        styles.storageOptionTitle, 
                        storageOption === 'cloud' && styles.storageOptionTitleSelected,
                        !cloudEligible && styles.storageOptionTitleDisabled,
                      ]}>
                        {t('nftMint.stealthCloudStorage')}
                      </Text>
                      <Text style={[styles.storageOptionDesc, !cloudEligible && styles.storageOptionDescDisabled]}>
                        {cloudEligible 
                          ? (nftType === 'compressed' 
                              ? `${t('nftMint.freeStorage')} • $0.02 fee • ${t('nftMint.yourServer')}`
                              : `${t('nftMint.freeStorage')} • $0.20 fee • ${t('nftMint.yourServer')}`)
                          : checkingCloud ? t('nftMint.checking') : cloudReason || t('nftMint.noActivePlan')}
                      </Text>
                    </View>
                  </View>
                  <View style={[
                    styles.radioOuter, 
                    storageOption === 'cloud' && styles.radioOuterSelected,
                    !cloudEligible && styles.radioOuterDisabled,
                  ]}>
                    {storageOption === 'cloud' && cloudEligible && <View style={styles.radioInner} />}
                  </View>
                </TouchableOpacity>
              </View>
              
              {/* Privacy toggle for EXIF stripping */}
              <TouchableOpacity 
                style={styles.privacyToggle}
                onPress={() => setStripExif(!stripExif)}
                activeOpacity={0.7}
              >
                <View style={styles.privacyToggleLeft}>
                  <Feather name="shield" size={18} color={stripExif ? COLORS.accent : COLORS.textSecondary} />
                  <View style={styles.privacyToggleText}>
                    <Text style={styles.privacyToggleTitle}>{t('nftMint.removePrivateData')}</Text>
                    <Text style={styles.privacyToggleDesc}>
                      {t('nftMint.stripsPrivateData')}
                    </Text>
                  </View>
                </View>
                <View style={[styles.toggleSwitch, stripExif && styles.toggleSwitchOn]}>
                  <View style={[styles.toggleKnob, stripExif && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>
              
              {/* Cost Breakdown */}
              <View style={styles.costBreakdown}>
                <View style={styles.costHeaderRow}>
                  <Text style={styles.costBreakdownTitle}>{t('nftMint.costSummary')}</Text>
                  {isPromoActive() && (
                    <View style={styles.promoBadge}>
                      <Text style={styles.promoBadgeText}>🎉 {t('nftMint.launchPromo')} • {getPromoDaysRemaining()} {t('nftMint.daysLeft')}</Text>
                    </View>
                  )}
                </View>
                {loadingCost ? (
                  <ActivityIndicator size="small" color={COLORS.primary} style={{ marginVertical: 10 }} />
                ) : estimatedCost ? (
                  <>
                    <View style={styles.costRow}>
                      <Text style={styles.costLabel}>{t('nftMint.nftType')}:</Text>
                      <Text style={[styles.costValue, { color: nftType === 'compressed' ? COLORS.accent : COLORS.primary }]}>
                        {nftType === 'compressed' ? t('nftMint.compressed99Cheaper') : t('nftMint.standardNft')}
                      </Text>
                    </View>
                    <View style={styles.costRow}>
                      <Text style={styles.costLabel}>{t('nftMint.imageStorage')}:</Text>
                      <Text style={styles.costValue}>{storageOption === 'cloud' ? 'StealthCloud (FREE)' : 'IPFS'}</Text>
                    </View>
                    
                    {/* Storage fees - only for IPFS */}
                    {storageOption === 'ipfs' && estimatedCost.breakdown.arweaveImage.usd > 0 && (
                      <View style={styles.costRow}>
                        <Text style={styles.costLabel}>  {t('nftMint.imageUpload')}:</Text>
                        <Text style={styles.costValue}>${estimatedCost.breakdown.arweaveImage.usd.toFixed(3)}</Text>
                      </View>
                    )}
                    {estimatedCost.breakdown.arweaveMetadata.usd > 0 && (
                      <View style={styles.costRow}>
                        <Text style={styles.costLabel}>  {t('nftMint.metadataUpload')}:</Text>
                        <Text style={styles.costValue}>${estimatedCost.breakdown.arweaveMetadata.usd.toFixed(3)}</Text>
                      </View>
                    )}
                    
                    {/* On-chain fees - different for standard vs compressed */}
                    {nftType === 'standard' ? (
                      <>
                        <View style={styles.costRow}>
                          <Text style={styles.costLabel}>  {t('nftMint.solanaRent')}:</Text>
                          <Text style={styles.costValue}>${estimatedCost.breakdown.solanaRent.usd.toFixed(2)}</Text>
                        </View>
                        <View style={styles.costRow}>
                          <Text style={styles.costLabel}>  {t('nftMint.metaplexFee')}:</Text>
                          <Text style={styles.costValue}>${estimatedCost.breakdown.metaplexFee.usd.toFixed(2)}</Text>
                        </View>
                      </>
                    ) : (
                      <View style={styles.costRow}>
                        <Text style={styles.costLabel}>  {t('nftMint.networkFee')}:</Text>
                        <Text style={[styles.costValue, { color: COLORS.accent }]}>{'<$0.01'}</Text>
                      </View>
                    )}
                    
                    <View style={styles.costRow}>
                      <Text style={styles.costLabel}>{t('nftMint.photoLynkFee')}:</Text>
                      <Text style={styles.costValue}>${estimatedCost.breakdown.appCommission.usd.toFixed(2)}</Text>
                    </View>
                    <View style={[styles.costRow, styles.costTotalRow]}>
                      <Text style={styles.costTotalLabel}>{t('nftMint.total')}:</Text>
                      <Text style={styles.costTotalValue}>{estimatedCost.total.usdFormatted}</Text>
                    </View>
                    {nftType === 'compressed' && (
                      <Text style={styles.savingsText}>
                        💰 {t('nftMint.youSave')} ~${((estimatedCost.breakdown.solanaRent.usd || 0.91) + (estimatedCost.breakdown.metaplexFee.usd || 1.69)).toFixed(2)} {t('nftMint.vsStandardNft')}!
                      </Text>
                    )}
                  </>
                ) : (
                  <Text style={styles.costError}>Could not estimate cost</Text>
                )}
              </View>
              
              <View style={styles.infoBox}>
                <Feather name="info" size={16} color={COLORS.primary} />
                <Text style={styles.infoText}>
                  {storageOption === 'cloud' 
                    ? t('nftMint.infoStealthCloud') 
                    : t('nftMint.infoIpfs')}
                  {stripExif && ` ${t('nftMint.privateDataRemoved')}`}
                  {'\n\n'}
                  {nftType === 'compressed' 
                    ? `⚡ ${t('nftMint.compressedInfo')}`
                    : `🔗 ${t('nftMint.standardInfo')}`}
                </Text>
              </View>
              
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowMintConfirm(false)}
              >
                <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mintButton}
                onPress={handleMintConfirm}
              >
                <Feather name="zap" size={18} color="#fff" />
                <Text style={styles.mintButtonText}>{t('nftMint.mintNft')}</Text>
              </TouchableOpacity>
            </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
  
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
        
        {/* Selected photo preview */}
        {selectedPhoto && (
          <View style={styles.selectedPreview}>
            <Image
              source={{ uri: selectedPhoto.uri }}
              style={styles.selectedImage}
              resizeMode="contain"
            />
            <View style={styles.selectedInfo}>
              <Text style={styles.selectedFilename} numberOfLines={1}>
                {selectedPhoto.filename}
              </Text>
              <Text style={styles.selectedMeta}>
                {selectedPhoto.width}x{selectedPhoto.height} • {(() => {
                  const bestDate = getBestDate(selectedPhoto, selectedPhotoExif);
                  return bestDate ? bestDate.toLocaleDateString() : 'No date';
                })()}
                {selectedPhotoExif?.dateTaken && (
                  <Text style={styles.exifBadge}> (EXIF)</Text>
                )}
              </Text>
              {selectedPhotoExif?.location && (
                <Text style={styles.selectedLocation}>
                  📍 {selectedPhotoExif.location.latitude.toFixed(4)}, {selectedPhotoExif.location.longitude.toFixed(4)}
                </Text>
              )}
              {selectedPhotoExif?.camera && (
                <Text style={styles.selectedCamera}>
                  📷 {selectedPhotoExif.camera}
                </Text>
              )}
            </View>
          </View>
        )}
        
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
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  selectedImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  selectedInfo: {
    flex: 1,
    marginLeft: 12,
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
  
  // Mint confirmation modal
  modalOverlay: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'flex-start',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  mintConfirmModal: {
    flex: 1,
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  mintConfirmContent: {
    flexGrow: 1,
    paddingBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  previewImage: {
    width: '100%',
    height: 180,
    borderRadius: 8,
    marginBottom: 10,
  },
  inputContainer: {
    marginBottom: 10,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    padding: 10,
    color: COLORS.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textArea: {
    height: 56,
    textAlignVertical: 'top',
  },
  storageSection: {
    marginBottom: 10,
  },
  storageSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6,
  },
  storageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  storageOptionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}15`,
  },
  storageOptionDisabled: {
    opacity: 0.5,
  },
  storageOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  storageOptionText: {
    marginLeft: 12,
    flex: 1,
  },
  storageOptionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  storageOptionTitleSelected: {
    color: COLORS.primary,
  },
  storageOptionTitleDisabled: {
    color: COLORS.textSecondary,
  },
  storageOptionDesc: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  storageOptionDescDisabled: {
    color: COLORS.border,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: COLORS.primary,
  },
  radioOuterDisabled: {
    borderColor: COLORS.border,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
  privacyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  privacyToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  privacyToggleText: {
    marginLeft: 12,
    flex: 1,
  },
  privacyToggleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  privacyToggleDesc: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  toggleSwitch: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.border,
    padding: 2,
    justifyContent: 'center',
  },
  toggleSwitchOn: {
    backgroundColor: COLORS.accent,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  toggleKnobOn: {
    alignSelf: 'flex-end',
  },
  recommendedBadge: {
    fontSize: 11,
    color: COLORS.accent,
    fontWeight: '400',
  },
  costBreakdown: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  costHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  costBreakdownTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  promoBadge: {
    backgroundColor: '#22c55e20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  promoBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#22c55e',
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  costLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  costValue: {
    fontSize: 13,
    color: COLORS.text,
  },
  costTotalRow: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: 8,
    paddingTop: 8,
  },
  costTotalLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  costTotalValue: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.accent,
  },
  savingsText: {
    fontSize: 12,
    color: COLORS.accent,
    textAlign: 'center',
    marginTop: 8,
  },
  costError: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingVertical: 10,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: `${COLORS.primary}20`,
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  infoText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: COLORS.text,
    fontWeight: '600',
  },
  mintButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mintButtonText: {
    color: '#fff',
    fontWeight: '600',
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
