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
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import { Feather } from '@expo/vector-icons';
import { t } from './i18n';

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
  primary: '#6366f1',
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
  const [cloudEligible, setCloudEligible] = useState(false);
  const [cloudReason, setCloudReason] = useState('');
  const [checkingCloud, setCheckingCloud] = useState(false);
  
  const flatListRef = useRef(null);
  
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
      setCloudEligible(false);
      setCloudReason('');
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
  
  // Load photos from media library
  const loadPhotos = async (after = null) => {
    try {
      if (after) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      
      const permission = await MediaLibrary.requestPermissionsAsync();
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
      description: nftDescription || 'Photo NFT minted with PhotoLynk on Solana Seeker',
      stripExif: stripExif,
      storageOption: storageOption,
      serverConfig: storageOption === 'cloud' ? serverConfig : null,
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
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView 
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <ScrollView 
            style={styles.mintConfirmModal}
            contentContainerStyle={styles.mintConfirmContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
              <Text style={styles.modalTitle}>{t('nftMint.createNft')}</Text>
              
              {selectedPhoto && (
                <Image
                  source={{ uri: selectedPhoto.uri }}
                  style={styles.previewImage}
                  resizeMode="cover"
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
                        {t('nftMint.ipfsDesc')}
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
                          ? t('nftMint.stealthCloudDesc')
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
              
              <View style={styles.infoBox}>
                <Feather name="info" size={16} color={COLORS.primary} />
                <Text style={styles.infoText}>
                  {storageOption === 'cloud' 
                    ? t('nftMint.infoStealthCloud') 
                    : t('nftMint.infoIpfs')}
                  {stripExif && ` ${t('nftMint.privateDataRemoved')}`}
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
      </TouchableWithoutFeedback>
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
            <Text style={styles.loadingText}>Loading photos...</Text>
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
    height: 120,
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
});

export default NFTPhotoPicker;
