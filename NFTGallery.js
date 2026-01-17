// NFT Album Component
// Premium gallery for viewing minted NFTs with 3D-style cards

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  Linking,
  RefreshControl,
  Alert,
  Platform,
  TextInput,
  Animated,
  ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import NFTOperations from './nftOperations';
import { t } from './i18n';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ============================================================================
// COLORS
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
  solana: '#9945FF',
};

// ============================================================================
// NFT GALLERY COMPONENT
// ============================================================================

// Sort options - labels will be translated at render time
const SORT_OPTIONS = [
  { key: 'date_desc', labelKey: 'nftAlbum.newestFirst', icon: 'arrow-down' },
  { key: 'date_asc', labelKey: 'nftAlbum.oldestFirst', icon: 'arrow-up' },
  { key: 'name_asc', labelKey: 'nftAlbum.nameAZ', icon: 'type' },
  { key: 'name_desc', labelKey: 'nftAlbum.nameZA', icon: 'type' },
];

const ITEMS_PER_PAGE = 6;

const NFTGallery = ({
  visible,
  onClose,
  onTransferNFT,
  serverUrl,
  getAuthHeaders,
}) => {
  const [nfts, setNfts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedNFT, setSelectedNFT] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);
  
  // New state for Album features
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);
  const [showOnlyPhotoLynk, setShowOnlyPhotoLynk] = useState(true); // Default: show only PhotoLynk NFTs
  
  // Custom dark alert state
  const [darkAlert, setDarkAlert] = useState(null);
  
  // Show dark themed alert
  const showDarkAlert = (title, message, buttons = [{ text: t('common.ok'), onPress: () => setDarkAlert(null) }]) => {
    setDarkAlert({ title, message, buttons });
  };
  
  const closeDarkAlert = () => setDarkAlert(null);
  
  // Load NFTs on mount - sync from server first
  useEffect(() => {
    if (visible) {
      loadNFTs(true); // true = sync from server
    }
  }, [visible]);
  
  // Load NFTs from storage, optionally sync from server first
  const loadNFTs = async (syncFromServer = false) => {
    try {
      setLoading(true);
      
      // Sync from server if available (restores NFTs after reinstall)
      if (syncFromServer && serverUrl && getAuthHeaders) {
        setSyncing(true);
        try {
          const authConfig = await getAuthHeaders();
          const headers = authConfig?.headers || authConfig;
          const syncResult = await NFTOperations.syncNFTsFromServer(serverUrl, headers);
          if (syncResult.merged > 0) {
            console.log(`[NFTGallery] Restored ${syncResult.merged} NFTs from server`);
          }
        } catch (syncErr) {
          console.log('[NFTGallery] Server sync failed, using local:', syncErr.message);
        } finally {
          setSyncing(false);
        }
      }
      
      const storedNFTs = await NFTOperations.getStoredNFTs();
      setNfts(storedNFTs);
      setDisplayCount(ITEMS_PER_PAGE);
    } catch (e) {
      console.error('[NFTGallery] Load error:', e);
    } finally {
      setLoading(false);
    }
  };
  
  // Backup NFTs to server
  const backupToServer = async () => {
    if (!serverUrl || !getAuthHeaders) {
      showDarkAlert(t('nftAlbum.notConnected'), t('nftAlbum.connectToBackup'));
      return;
    }
    
    setSyncing(true);
    try {
      const authConfig = await getAuthHeaders();
      const headers = authConfig?.headers || authConfig;
      const result = await NFTOperations.backupNFTsToServer(serverUrl, headers);
      if (result.success) {
        showDarkAlert(t('nftAlbum.backupComplete'), t('nftAlbum.nftsBackedUp', { count: result.backed }));
      } else {
        showDarkAlert(t('nftAlbum.backupFailed'), result.error || t('nftAlbum.unknownError'));
      }
    } catch (e) {
      showDarkAlert(t('nftAlbum.backupFailed'), e.message);
    } finally {
      setSyncing(false);
    }
  };
  
  // Scan wallet for NFTs from blockchain
  const scanWalletForNFTs = async () => {
    setSyncing(true);
    try {
      // Get wallet address from connected wallet
      const { transact } = await import('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
      
      let walletAddress = null;
      await transact(async (wallet) => {
        const authResult = await wallet.authorize({
          cluster: 'mainnet-beta',
          identity: {
            name: 'PhotoLynk',
            uri: 'https://photolynk.app',
            icon: 'favicon.ico',
          },
        });
        
        const address = authResult.accounts[0].address;
        const addressBytes = typeof address === 'string'
          ? Uint8Array.from(atob(address), c => c.charCodeAt(0))
          : new Uint8Array(address);
        
        const { PublicKey } = await import('@solana/web3.js');
        walletAddress = new PublicKey(addressBytes).toBase58();
      });
      
      if (!walletAddress) {
        showDarkAlert(t('common.error'), t('nftAlbum.couldNotGetWallet'));
        return;
      }
      
      console.log('[NFTGallery] Scanning wallet:', walletAddress);
      
      // Get auth headers for server sync
      let headers = null;
      if (getAuthHeaders) {
        try {
          const authConfig = await getAuthHeaders();
          headers = authConfig?.headers || authConfig;
        } catch (e) {
          console.log('[NFTGallery] No auth headers available');
        }
      }
      
      // Discover and import NFTs
      const result = await NFTOperations.discoverAndImportNFTs(walletAddress, serverUrl, headers);
      
      if (result.success) {
        if (result.imported > 0) {
          showDarkAlert(t('nftAlbum.nftsFound'), t('nftAlbum.importedNfts', { count: result.imported }));
          await loadNFTs(false); // Reload without server sync
        } else if (result.total > 0) {
          showDarkAlert(t('nftAlbum.alreadySynced'), t('nftAlbum.allAlreadyInAlbum', { count: result.total }));
        } else {
          showDarkAlert(t('nftAlbum.noNftsFound'), t('nftAlbum.noNftsInWallet'));
        }
      } else {
        showDarkAlert(t('nftAlbum.scanFailed'), result.error || t('nftAlbum.couldNotScan'));
      }
    } catch (e) {
      console.error('[NFTGallery] Scan failed:', e);
      showDarkAlert(t('nftAlbum.scanFailed'), e.message);
    } finally {
      setSyncing(false);
    }
  };
  
  // Check if NFT was created with PhotoLynk
  const isPhotoLynkNFT = (nft) => {
    const name = (nft.name || '').toLowerCase();
    const desc = (nft.description || '').toLowerCase();
    return name.includes('photolynk') || desc.includes('photolynk') || desc.includes('created with photolynk');
  };
  
  // Filtered and sorted NFTs
  const filteredNFTs = useMemo(() => {
    let result = [...nfts];
    
    // Apply PhotoLynk filter (default: show only PhotoLynk NFTs)
    if (showOnlyPhotoLynk) {
      result = result.filter(isPhotoLynkNFT);
    }
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(nft => 
        nft.name?.toLowerCase().includes(query) ||
        nft.description?.toLowerCase().includes(query)
      );
    }
    
    // Apply sorting (default: newest first)
    result.sort((a, b) => {
      switch (sortBy) {
        case 'date_desc':
          return new Date(b.createdAt) - new Date(a.createdAt);
        case 'date_asc':
          return new Date(a.createdAt) - new Date(b.createdAt);
        case 'name_asc':
          return (a.name || '').localeCompare(b.name || '');
        case 'name_desc':
          return (b.name || '').localeCompare(a.name || '');
        default:
          return 0;
      }
    });
    
    return result;
  }, [nfts, searchQuery, sortBy, showOnlyPhotoLynk]);
  
  // Paginated NFTs
  const displayedNFTs = useMemo(() => {
    return filteredNFTs.slice(0, displayCount);
  }, [filteredNFTs, displayCount]);
  
  // Show more handler
  const handleShowMore = () => {
    setDisplayCount(prev => prev + ITEMS_PER_PAGE);
  };
  
  const hasMore = displayCount < filteredNFTs.length;
  
  // Refresh NFTs (sync from server)
  const onRefresh = async () => {
    setRefreshing(true);
    await loadNFTs(true); // true = sync from server
    setRefreshing(false);
  };
  
  // Clear all NFTs (for testing)
  const clearAllNFTs = async () => {
    showDarkAlert(
      t('nftAlbum.clearAllNfts'),
      t('nftAlbum.clearAllNftsMessage'),
      [
        { text: t('common.cancel'), onPress: () => setDarkAlert(null) },
        { 
          text: t('nftAlbum.clear'), 
          onPress: async () => {
            setDarkAlert(null);
            await NFTOperations.clearAllStoredNFTs();
            setNfts([]);
            setSelectedNFT(null);
          }
        },
      ]
    );
  };
  
  // Verify NFT on blockchain
  const verifyOnChain = async (nft) => {
    setVerifying(true);
    setVerificationResult(null);
    
    try {
      const result = await NFTOperations.verifyNFTOnChain(nft.mintAddress);
      setVerificationResult(result);
    } catch (e) {
      setVerificationResult({ verified: false, error: e.message });
    } finally {
      setVerifying(false);
    }
  };
  
  // Open external link
  const openLink = (url) => {
    Linking.openURL(url).catch(e => {
      showDarkAlert(t('common.error'), t('nftAlbum.couldNotOpenLink'));
    });
  };
  
  // Handle transfer
  const handleTransfer = (nft) => {
    setSelectedNFT(null);
    onTransferNFT?.(nft);
  };
  
  // Render premium 3D-style NFT card
  const renderNFTCard = useCallback(({ item, index }) => (
    <TouchableOpacity
      style={styles.nftCard}
      onPress={() => setSelectedNFT(item)}
      activeOpacity={0.9}
    >
      {/* 3D Shadow layers */}
      <View style={styles.cardShadow3} />
      <View style={styles.cardShadow2} />
      <View style={styles.cardShadow1} />
      
      {/* Main card */}
      <View style={styles.cardMain}>
        {(item.imageUrl || item.arweaveUrl) ? (
          <Image
            source={{ uri: item.imageUrl || item.arweaveUrl }}
            style={styles.nftImage}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.nftImage, styles.noImagePlaceholder]}>
            <Feather name="image" size={32} color={COLORS.textSecondary} />
          </View>
        )}
        
        {/* Gradient overlay */}
        <View style={styles.cardGradient} />
        
        {/* Card info */}
        <View style={styles.cardInfo}>
          <Text style={styles.nftName} numberOfLines={1}>{item.name}</Text>
          <View style={styles.cardMeta}>
            <View style={styles.dateBadge}>
              <Feather name="calendar" size={10} color="rgba(255,255,255,0.7)" />
              <Text style={styles.nftDate}>
                {new Date(item.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <View style={styles.solanaBadge}>
              <Feather name="hexagon" size={10} color="#9945FF" />
            </View>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  ), []);
  
  // Render NFT detail modal
  const renderDetailModal = () => {
    if (!selectedNFT) return null;
    
    return (
      <Modal
        visible={!!selectedNFT}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedNFT(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.detailModal}>
            {/* Header */}
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>{selectedNFT.name}</Text>
              <TouchableOpacity onPress={() => setSelectedNFT(null)}>
                <Feather name="x" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            
            {/* Image */}
            {(selectedNFT.imageUrl || selectedNFT.arweaveUrl) ? (
              <Image
                source={{ uri: selectedNFT.imageUrl || selectedNFT.arweaveUrl }}
                style={styles.detailImage}
                resizeMode="contain"
              />
            ) : (
              <View style={[styles.detailImage, styles.noImagePlaceholder]}>
                <Feather name="image" size={48} color={COLORS.textSecondary} />
                <Text style={styles.noImageText}>No image available</Text>
              </View>
            )}
            
            {/* Owner info */}
            <View style={styles.ownerSection}>
              <Text style={styles.sectionLabel}>{t('nftAlbum.nftOwner')}</Text>
              <Text style={styles.ownerAddress} numberOfLines={1}>
                {selectedNFT.ownerAddress}
              </Text>
            </View>
            
            {/* Description */}
            {selectedNFT.description && (
              <View style={styles.descriptionSection}>
                <Text style={styles.sectionLabel}>{t('nftAlbum.description')}</Text>
                <Text style={styles.descriptionText}>{selectedNFT.description}</Text>
              </View>
            )}
            
            {/* EXIF Data */}
            {selectedNFT.exifData && (
              <View style={styles.exifSection}>
                <Text style={styles.sectionLabel}>{t('nftAlbum.photoDetails')}</Text>
                <View style={styles.exifGrid}>
                  {selectedNFT.exifData.dateTaken && (
                    <View style={styles.exifItem}>
                      <Feather name="calendar" size={14} color={COLORS.textSecondary} />
                      <Text style={styles.exifText}>
                        {new Date(selectedNFT.exifData.dateTaken).toLocaleDateString()}
                      </Text>
                    </View>
                  )}
                  {selectedNFT.exifData.camera && (
                    <View style={styles.exifItem}>
                      <Feather name="camera" size={14} color={COLORS.textSecondary} />
                      <Text style={styles.exifText}>{selectedNFT.exifData.camera}</Text>
                    </View>
                  )}
                  {selectedNFT.exifData.width && selectedNFT.exifData.height && (
                    <View style={styles.exifItem}>
                      <Feather name="maximize" size={14} color={COLORS.textSecondary} />
                      <Text style={styles.exifText}>
                        {selectedNFT.exifData.width}x{selectedNFT.exifData.height}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}
            
            {/* Blockchain verification */}
            <View style={styles.verifySection}>
              <Text style={styles.sectionLabel}>{t('nftAlbum.blockchainVerification')}</Text>
              
              {verifying ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : verificationResult ? (
                <View style={[
                  styles.verifyResult,
                  verificationResult.verified ? styles.verifySuccess : styles.verifyFailed
                ]}>
                  <Feather
                    name={verificationResult.verified ? 'check-circle' : 'x-circle'}
                    size={18}
                    color={verificationResult.verified ? COLORS.accent : COLORS.error}
                  />
                  <Text style={[
                    styles.verifyText,
                    { color: verificationResult.verified ? COLORS.accent : COLORS.error }
                  ]}>
                    {verificationResult.verified ? t('nftAlbum.verifiedOnSolana') : t('nftAlbum.notFoundOnChain')}
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.verifyButton}
                  onPress={() => verifyOnChain(selectedNFT)}
                >
                  <Feather name="shield" size={16} color={COLORS.primary} />
                  <Text style={styles.verifyButtonText}>{t('nftAlbum.verifyOnChain')}</Text>
                </TouchableOpacity>
              )}
            </View>
            
            {/* Action buttons */}
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionButton, !selectedNFT.txSignature && styles.actionButtonDisabled]}
                onPress={() => selectedNFT.txSignature && openLink(NFTOperations.getExplorerUrl(selectedNFT.txSignature))}
                disabled={!selectedNFT.txSignature}
              >
                <Feather name="external-link" size={16} color={selectedNFT.txSignature ? COLORS.text : COLORS.textSecondary} />
                <Text style={[styles.actionButtonText, !selectedNFT.txSignature && styles.actionButtonTextDisabled]}>{t('nftAlbum.explorer')}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => openLink(NFTOperations.getSolscanUrl(selectedNFT.mintAddress))}
              >
                <Feather name="search" size={16} color={COLORS.text} />
                <Text style={styles.actionButtonText}>{t('nftAlbum.solscan')}</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => openLink(selectedNFT.arweaveUrl || selectedNFT.imageUrl)}
              >
                <Feather name="image" size={16} color={COLORS.text} />
                <Text style={styles.actionButtonText}>{t('nftAlbum.ipfs')}</Text>
              </TouchableOpacity>
            </View>
            
            {/* Transfer button */}
            <TouchableOpacity
              style={styles.transferButton}
              onPress={() => handleTransfer(selectedNFT)}
            >
              <Feather name="send" size={18} color="#fff" />
              <Text style={styles.transferButtonText}>{t('nftAlbum.transferNft')}</Text>
            </TouchableOpacity>
          </View>
        </View>
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
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{t('nftAlbum.myAlbum')}</Text>
            <Text style={styles.headerSubtitle}>{nfts.length} {t('nftAlbum.memories')}</Text>
          </View>
          <TouchableOpacity onPress={clearAllNFTs} style={styles.headerRight}>
            {nfts.length > 0 && (
              <Feather name="trash-2" size={20} color={COLORS.textSecondary} />
            )}
          </TouchableOpacity>
        </View>
        
        {/* Filter Toggle */}
        {nfts.length > 0 && (
          <View style={styles.filterToggleBar}>
            <TouchableOpacity 
              style={[styles.filterToggle, showOnlyPhotoLynk && styles.filterToggleActive]}
              onPress={() => setShowOnlyPhotoLynk(true)}
            >
              <Feather name="camera" size={14} color={showOnlyPhotoLynk ? '#fff' : COLORS.textSecondary} />
              <Text style={[styles.filterToggleText, showOnlyPhotoLynk && styles.filterToggleTextActive]}>
                PhotoLynk
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.filterToggle, !showOnlyPhotoLynk && styles.filterToggleActive]}
              onPress={() => setShowOnlyPhotoLynk(false)}
            >
              <Feather name="grid" size={14} color={!showOnlyPhotoLynk ? '#fff' : COLORS.textSecondary} />
              <Text style={[styles.filterToggleText, !showOnlyPhotoLynk && styles.filterToggleTextActive]}>
                {t('nftAlbum.allNfts')}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        
        {/* Search and Sort Bar */}
        {nfts.length > 0 && (
          <View style={styles.searchSortBar}>
            <View style={styles.searchContainer}>
              <Feather name="search" size={18} color={COLORS.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder={t('nftAlbum.searchMemories')}
                placeholderTextColor={COLORS.textSecondary}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Feather name="x" size={18} color={COLORS.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
            
            <TouchableOpacity 
              style={styles.sortButton}
              onPress={() => setShowSortMenu(!showSortMenu)}
            >
              <Feather name="sliders" size={18} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
        )}
        
        {/* Sort Menu Dropdown */}
        {showSortMenu && (
          <View style={styles.sortMenu}>
            {SORT_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.key}
                style={[
                  styles.sortOption,
                  sortBy === option.key && styles.sortOptionActive
                ]}
                onPress={() => {
                  setSortBy(option.key);
                  setShowSortMenu(false);
                }}
              >
                <Feather 
                  name={option.icon} 
                  size={16} 
                  color={sortBy === option.key ? COLORS.primary : COLORS.textSecondary} 
                />
                <Text style={[
                  styles.sortOptionText,
                  sortBy === option.key && styles.sortOptionTextActive
                ]}>
                  {t(option.labelKey)}
                </Text>
                {sortBy === option.key && (
                  <Feather name="check" size={16} color={COLORS.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
        
        {/* Content */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>{t('nftAlbum.loadingNfts')}</Text>
          </View>
        ) : nfts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIcon}>
              <Feather name="image" size={48} color={COLORS.textSecondary} />
            </View>
            <Text style={styles.emptyTitle}>{t('nftAlbum.noNftsYet')}</Text>
            <Text style={styles.emptyText}>
              {t('nftAlbum.mintFirstNft')}
            </Text>
            <TouchableOpacity 
              style={styles.syncButton}
              onPress={scanWalletForNFTs}
              disabled={syncing}
            >
              {syncing ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <>
                  <Feather name="search" size={18} color={COLORS.primary} />
                  <Text style={styles.syncButtonText}>{t('nftAlbum.scanWallet')}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={COLORS.primary}
              />
            }
          >
            {/* Results count */}
            {searchQuery.length > 0 && (
              <Text style={styles.resultsCount}>
                {filteredNFTs.length} result{filteredNFTs.length !== 1 ? 's' : ''} found
              </Text>
            )}
            
            {/* NFT Grid */}
            <View style={styles.gridContainer}>
              {displayedNFTs.map((item, index) => (
                <View key={item.mintAddress} style={styles.gridItem}>
                  {renderNFTCard({ item, index })}
                </View>
              ))}
            </View>
            
            {/* Show More Button */}
            {hasMore && (
              <TouchableOpacity 
                style={styles.showMoreButton}
                onPress={handleShowMore}
              >
                <Text style={styles.showMoreText}>
                  Show More ({filteredNFTs.length - displayCount} remaining)
                </Text>
                <Feather name="chevron-down" size={20} color={COLORS.primary} />
              </TouchableOpacity>
            )}
            
            {/* No results */}
            {filteredNFTs.length === 0 && searchQuery.length > 0 && (
              <View style={styles.noResults}>
                <Feather name="search" size={40} color={COLORS.textSecondary} />
                <Text style={styles.noResultsText}>No memories match "{searchQuery}"</Text>
              </View>
            )}
          </ScrollView>
        )}
        
        {/* Detail modal */}
        {renderDetailModal()}
        
        {/* Dark Alert Modal */}
        {darkAlert && (
          <View style={styles.darkAlertOverlay}>
            <View style={styles.darkAlertCard}>
              <Text style={styles.darkAlertTitle}>{darkAlert.title}</Text>
              <Text style={styles.darkAlertMessage}>{darkAlert.message}</Text>
              <View style={styles.darkAlertButtons}>
                {darkAlert.buttons.map((btn, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.darkAlertButton, idx === darkAlert.buttons.length - 1 && styles.darkAlertButtonPrimary]}
                    onPress={btn.onPress}
                  >
                    <Text style={[styles.darkAlertButtonText, idx === darkAlert.buttons.length - 1 && styles.darkAlertButtonTextPrimary]}>
                      {btn.text}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  filterToggleBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterToggleActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterToggleText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textSecondary,
  },
  filterToggleTextActive: {
    color: '#fff',
  },
  nftCount: {
    fontSize: 14,
    color: COLORS.textSecondary,
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  syncButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  // Header center
  headerCenter: {
    alignItems: 'center',
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  
  // Search and Sort
  searchSortBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.text,
    padding: 0,
  },
  sortButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sortMenu: {
    backgroundColor: COLORS.surface,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sortOptionActive: {
    backgroundColor: `${COLORS.primary}15`,
  },
  sortOptionText: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  sortOptionTextActive: {
    color: COLORS.primary,
    fontWeight: '500',
  },
  
  // ScrollView
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  resultsCount: {
    fontSize: 13,
    color: COLORS.textSecondary,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  
  // Grid
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  gridItem: {
    width: '50%',
    paddingHorizontal: 6,
    marginBottom: 20,
  },
  
  // Premium 3D Card
  nftCard: {
    position: 'relative',
    height: (SCREEN_WIDTH - 48) / 2 + 60,
  },
  cardShadow3: {
    position: 'absolute',
    bottom: -8,
    left: 8,
    right: 8,
    height: '100%',
    backgroundColor: 'rgba(153, 69, 255, 0.1)',
    borderRadius: 16,
  },
  cardShadow2: {
    position: 'absolute',
    bottom: -4,
    left: 4,
    right: 4,
    height: '100%',
    backgroundColor: 'rgba(153, 69, 255, 0.15)',
    borderRadius: 14,
  },
  cardShadow1: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
  },
  cardMain: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(153, 69, 255, 0.2)',
  },
  nftImage: {
    width: '100%',
    height: '100%',
  },
  noImagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  noImageText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 8,
  },
  cardGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
    backgroundColor: 'transparent',
    backgroundImage: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
  },
  cardInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  nftName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 6,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  nftDate: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
  },
  solanaBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(153, 69, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Show More
  showMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  showMoreText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
  
  // No Results
  noResults: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 16,
  },
  noResultsText: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },
  nftBadge: {
    flexDirection: 'row',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
  
  // Detail modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    padding: 16,
  },
  detailModal: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    maxHeight: '90%',
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  detailTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
  },
  detailImage: {
    width: '100%',
    height: 250,
    backgroundColor: COLORS.background,
  },
  ownerSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  ownerAddress: {
    fontSize: 13,
    color: COLORS.primary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  descriptionSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  descriptionText: {
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 20,
  },
  exifSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  exifGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  exifItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  exifText: {
    fontSize: 13,
    color: COLORS.text,
  },
  verifySection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  verifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  verifyButtonText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  verifyResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  verifySuccess: {
    backgroundColor: `${COLORS.accent}20`,
  },
  verifyFailed: {
    backgroundColor: `${COLORS.error}20`,
  },
  verifyText: {
    fontSize: 14,
    fontWeight: '500',
  },
  actionButtons: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
  },
  actionButtonText: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: '500',
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonTextDisabled: {
    color: COLORS.textSecondary,
  },
  transferButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    margin: 16,
    paddingVertical: 14,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
  },
  transferButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  // Dark Alert styles
  darkAlertOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  darkAlertCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: '#333',
  },
  darkAlertTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
  },
  darkAlertMessage: {
    fontSize: 14,
    color: '#a1a1aa',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  darkAlertButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  darkAlertButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: '#2a2a2a',
    minWidth: 100,
  },
  darkAlertButtonPrimary: {
    backgroundColor: COLORS.primary,
  },
  darkAlertButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a1a1aa',
    textAlign: 'center',
  },
  darkAlertButtonTextPrimary: {
    color: '#fff',
  },
});

export default NFTGallery;
