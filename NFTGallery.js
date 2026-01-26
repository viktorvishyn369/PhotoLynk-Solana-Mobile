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
import * as FileSystem from 'expo-file-system';
import NFTOperations from './nftOperations';
import { t } from './i18n';

// Import shared cache utilities (avoids circular dependency with nftOperations)
import NFTImageCache from './nftImageCache';

// Re-export for backwards compatibility
export const removeNFTImageFromCache = NFTImageCache.removeNFTImageFromCache;

// Local wrapper to provide Map-like interface for existing code
const imageCache = {
  has: (cid) => NFTImageCache.hasCachedPath(cid),
  get: (cid) => NFTImageCache.getCachedPath(cid),
  set: (cid, path) => NFTImageCache.setCachedPath(cid, path),
};
const saveCacheIndex = () => NFTImageCache.saveCacheIndex();
const IMAGE_CACHE_DIR = `${FileSystem.cacheDirectory}nft_images/`;

// Initialize cache on module load
NFTImageCache.loadCacheIndex();

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ============================================================================
// COLORS
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
  solana: '#9945FF',
};

// IPFS Gateway configuration with fallbacks
// Ordered by reliability: primary gateway first, fallbacks after
const IPFS_GATEWAYS = [
  'https://dweb.link/ipfs/',         // Protocol Labs CDN - most reliable
  'https://w3s.link/ipfs/',          // Web3.Storage - good for cNFTs
  'https://nftstorage.link/ipfs/',   // NFT.Storage - designed for NFTs
  'https://cloudflare-ipfs.com/ipfs/', // Cloudflare - fast CDN
];

// Extract CID from any IPFS URL
const extractIPFSCid = (url) => {
  if (!url) return null;
  // Match /ipfs/CID pattern
  const match = url.match(/\/ipfs\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
};

// Get fast image URL - rewrites Pinata to faster gateway
const getFastImageUrl = (url, gatewayIndex = 0) => {
  if (!url) return url;
  
  // Don't rewrite StealthCloud or Arweave URLs
  if (url.includes('stealthlynk.io') || url.includes('arweave.net') || url.includes('irys.xyz')) {
    return url;
  }
  
  const cid = extractIPFSCid(url);
  if (cid && gatewayIndex < IPFS_GATEWAYS.length) {
    return `${IPFS_GATEWAYS[gatewayIndex]}${cid}`;
  }
  return url;
};

// NFT Image component with StealthCloud priority, retries, then fallback to original IPFS
const MAX_STEALTHCLOUD_RETRIES = 2;
const MAX_IPFS_RETRY_CYCLES = 1; // Single cycle - if all 4 gateways fail, content is likely unpinned

// Check if URL is StealthCloud
const isStealthCloudUrl = (url) => {
  if (!url) return false;
  return url.includes('stealthlynk.io') || url.includes('nft.stealthlynk.io');
};

const NFTImageWithFallback = ({ url, originalUrl, style, isDetail = false }) => {
  const [currentSource, setCurrentSource] = useState('primary'); // 'primary' or 'fallback'
  const [retryCount, setRetryCount] = useState(0);
  const [gatewayIndex, setGatewayIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [memoryRetries, setMemoryRetries] = useState(0);
  const [cachedPath, setCachedPath] = useState(null);
  const [effectiveUrl, setEffectiveUrl] = useState(url);
  const [imageAspectRatio, setImageAspectRatio] = useState(1); // Dynamic aspect ratio for detail view
  const imageRef = React.useRef(null);
  const retryTimerRef = React.useRef(null);
  
  // Check for cached image on mount and validate URL
  React.useEffect(() => {
    const checkCacheAndUrl = async () => {
      // If URL is a local file path, check if it exists
      if (url && (url.startsWith('file://') || url.startsWith('/'))) {
        try {
          const info = await FileSystem.getInfoAsync(url.replace('file://', ''));
          if (!info.exists && originalUrl) {
            // Local file doesn't exist, use originalUrl (StealthCloud/IPFS)
            console.log('[NFTImage] Local file missing, using originalUrl');
            setEffectiveUrl(originalUrl);
            return;
          }
        } catch (e) {
          if (originalUrl) {
            setEffectiveUrl(originalUrl);
            return;
          }
        }
      }
      setEffectiveUrl(url);
      
      // Check IPFS cache
      const cid = extractIPFSCid(url) || extractIPFSCid(originalUrl);
      if (cid) {
        // Check in-memory cache first
        if (imageCache.has(cid)) {
          setCachedPath(imageCache.get(cid));
          return;
        }
        // Check disk cache
        try {
          const localPath = `${IMAGE_CACHE_DIR}${cid}.jpg`;
          const info = await FileSystem.getInfoAsync(localPath);
          if (info.exists) {
            imageCache.set(cid, localPath);
            setCachedPath(localPath);
          }
        } catch (e) {
          // Cache check failed, will load from network
        }
      }
    };
    checkCacheAndUrl();
  }, [url, originalUrl]);
  
  // Early return if no URL provided - show placeholder
  if (!url && !originalUrl) {
    return (
      <View style={[style, { justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.surface }]}>
        <Feather name="image" size={24} color={COLORS.textSecondary} />
      </View>
    );
  }
  
  const isStealthCloud = isStealthCloudUrl(effectiveUrl);
  const fallbackUrl = originalUrl || effectiveUrl;
  const cid = extractIPFSCid(currentSource === 'fallback' ? fallbackUrl : effectiveUrl);
  const isIPFS = !!cid;
  
  // Determine which URL to use
  const getImageUrl = () => {
    if (currentSource === 'primary') {
      // Primary: use the effective URL (validated/corrected)
      // If it's an IPFS URL, use gateway rotation
      const cidFromUrl = extractIPFSCid(effectiveUrl);
      if (cidFromUrl) {
        const gatewayUrl = getFastImageUrl(effectiveUrl, gatewayIndex);
        return retryCount > 0 ? `${gatewayUrl}${gatewayUrl.includes('?') ? '&' : '?'}r=${retryCount}` : gatewayUrl;
      }
      // StealthCloud or local path - use directly
      const baseUrl = effectiveUrl;
      return retryCount > 0 ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}r=${retryCount}` : baseUrl;
    } else {
      // Fallback: use original IPFS URL with gateway
      const cidFromFallback = extractIPFSCid(fallbackUrl);
      if (cidFromFallback) {
        const gatewayUrl = getFastImageUrl(fallbackUrl, gatewayIndex);
        return retryCount > 0 ? `${gatewayUrl}${gatewayUrl.includes('?') ? '&' : '?'}r=${retryCount}` : gatewayUrl;
      }
      return fallbackUrl;
    }
  };
  
  const finalUrl = getImageUrl();
  
  const handleError = (e) => {
    const errorMsg = e?.nativeEvent?.error || 'unknown';
    
    // Check for memory errors - wait and retry instead of failing immediately
    if (errorMsg.includes('Pool hard cap') || errorMsg.includes('memory')) {
      if (memoryRetries < 5) {
        console.log('[NFTImage] Memory full, waiting to retry...', memoryRetries + 1);
        setMemoryRetries(prev => prev + 1);
        // Wait 5 seconds for memory to free up, then retry
        retryTimerRef.current = setTimeout(() => {
          setRetryCount(prev => prev + 1);
        }, 5000);
        return;
      } else {
        console.log('[NFTImage] Memory exhausted after retries');
        setFailed(true);
        setLoading(false);
        return;
      }
    }
    
    if (currentSource === 'primary') {
      // Primary source (StealthCloud or direct URL)
      if (isStealthCloud) {
        if (retryCount < MAX_STEALTHCLOUD_RETRIES - 1) {
          // Retry StealthCloud up to 3 times
          console.log('[NFTImage] StealthCloud retry', retryCount + 1);
          setRetryCount(prev => prev + 1);
        } else if (fallbackUrl && fallbackUrl !== url && extractIPFSCid(fallbackUrl)) {
          // StealthCloud failed, try IPFS fallback if available
          console.log('[NFTImage] StealthCloud failed, trying IPFS fallback');
          setCurrentSource('fallback');
          setRetryCount(0);
          setGatewayIndex(0);
        } else {
          // No fallback, fail
          console.log('[NFTImage] StealthCloud failed, no fallback');
          setFailed(true);
          setLoading(false);
        }
      } else if (isIPFS || extractIPFSCid(url)) {
        // IPFS URL - try different gateways with delay
        console.log('[NFTImage] IPFS gateway retry', gatewayIndex + 1, 'cycle', retryCount);
        // Wait 10 seconds before trying next gateway (large files need time)
        retryTimerRef.current = setTimeout(() => {
          if (gatewayIndex < IPFS_GATEWAYS.length - 1) {
            setGatewayIndex(prev => prev + 1);
          } else if (retryCount < MAX_IPFS_RETRY_CYCLES) {
            setGatewayIndex(0);
            setRetryCount(prev => prev + 1);
          } else {
            setFailed(true);
            setLoading(false);
          }
        }, 10000); // 10 second delay between gateway attempts
      } else if (fallbackUrl && fallbackUrl !== url && extractIPFSCid(fallbackUrl)) {
        // Switch to fallback (original IPFS) only if it has a valid CID
        console.log('[NFTImage] Switching to fallback IPFS');
        setCurrentSource('fallback');
        setRetryCount(0);
        setGatewayIndex(0);
      } else {
        // No fallback available
        setFailed(true);
        setLoading(false);
      }
    } else {
      // Fallback source (IPFS gateways)
      const cidFromFallback = extractIPFSCid(fallbackUrl);
      if (cidFromFallback && gatewayIndex < IPFS_GATEWAYS.length - 1) {
        setGatewayIndex(prev => prev + 1);
      } else if (cidFromFallback && retryCount < MAX_IPFS_RETRY_CYCLES) {
        // Start new gateway cycle
        setGatewayIndex(0);
        setRetryCount(prev => prev + 1);
      } else {
        // All fallbacks exhausted
        console.log('[NFTImage] All sources failed');
        setFailed(true);
        setLoading(false);
      }
    }
  };
  
  // Reset state when URL changes
  React.useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
    }
    setCurrentSource('primary');
    setRetryCount(0);
    setGatewayIndex(0);
    setLoading(true);
    setFailed(false);
    setMemoryRetries(0);
  }, [url]);
  
  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
      imageRef.current = null;
    };
  }, []);
  
  if (failed) {
    return (
      <View style={[style, { justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.surface }]}>
        <Feather name="image" size={24} color={COLORS.textSecondary} />
      </View>
    );
  }
  
  // Save image to cache after successful load
  const handleLoadSuccess = async (event) => {
    setLoading(false);
    
    // Get image dimensions for proper aspect ratio in detail view
    if (isDetail && event?.nativeEvent?.source) {
      const { width, height } = event.nativeEvent.source;
      if (width && height && height > 0) {
        setImageAspectRatio(width / height);
      }
    }
    
    // Cache IPFS images to disk for persistence
    const cid = extractIPFSCid(finalUrl);
    if (cid && !cachedPath && !imageCache.has(cid)) {
      try {
        // Ensure cache directory exists
        await FileSystem.makeDirectoryAsync(IMAGE_CACHE_DIR, { intermediates: true }).catch(() => {});
        
        // Download and save to cache
        const localPath = `${IMAGE_CACHE_DIR}${cid}.jpg`;
        await FileSystem.downloadAsync(finalUrl, localPath);
        imageCache.set(cid, localPath);
        // Persist cache index to survive app restarts
        saveCacheIndex();
        console.log('[NFTImage] Cached:', cid);
      } catch (e) {
        // Cache save failed, not critical
      }
    }
  };
  
  // Use cached path if available
  const displayUrl = cachedPath || finalUrl;
  
  // For detail view, use dynamic aspect ratio to preserve original dimensions
  const imageStyle = isDetail 
    ? [style, { aspectRatio: imageAspectRatio }]
    : style;
  
  return (
    <View style={isDetail ? { width: '100%' } : style}>
      {loading && (
        <View style={[style, { position: 'absolute', justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.surface, zIndex: 1 }]}>
          <ActivityIndicator size={isDetail ? 'large' : 'small'} color={COLORS.primary} />
        </View>
      )}
      <Image
        ref={imageRef}
        source={{ uri: displayUrl, cache: 'force-cache' }}
        style={imageStyle}
        resizeMode={isDetail ? 'contain' : 'cover'}
        onLoadStart={() => setLoading(true)}
        onLoad={handleLoadSuccess}
        onError={handleError}
      />
    </View>
  );
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

const ITEMS_PER_PAGE = 4;  // 2x2 grid - show 4 cards per page

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
  const [currentPage, setCurrentPage] = useState(0); // Page-based pagination
  const [nftFilter, setNftFilter] = useState('all'); // 'all', 'standard', 'compressed'
  
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
      setCurrentPage(0); // Reset to first page
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
  
  // Check if NFT is compressed (cNFT)
  const isCompressedNFT = (nft) => {
    return nft.isCompressed || nft.mintAddress?.startsWith('cnft_');
  };
  
  // Filtered and sorted NFTs
  const filteredNFTs = useMemo(() => {
    let result = [...nfts];
    
    // Apply NFT type filter
    if (nftFilter === 'standard') {
      result = result.filter(nft => !isCompressedNFT(nft));
    } else if (nftFilter === 'compressed') {
      result = result.filter(nft => isCompressedNFT(nft));
    }
    // 'all' shows everything
    
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
  }, [nfts, searchQuery, sortBy, nftFilter]);
  
  // Paginated NFTs - show only current page (4 items)
  const totalPages = Math.ceil(filteredNFTs.length / ITEMS_PER_PAGE);
  const displayedNFTs = useMemo(() => {
    const start = currentPage * ITEMS_PER_PAGE;
    return filteredNFTs.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredNFTs, currentPage]);
  
  // Pagination handlers
  const goToNextPage = () => {
    if (currentPage < totalPages - 1) {
      setCurrentPage(prev => prev + 1);
    }
  };
  
  const goToPrevPage = () => {
    if (currentPage > 0) {
      setCurrentPage(prev => prev - 1);
    }
  };
  
  const hasPrev = currentPage > 0;
  const hasNext = currentPage < totalPages - 1;
  
  // Refresh NFTs (sync from server)
  const onRefresh = async () => {
    setRefreshing(true);
    await loadNFTs(true); // true = sync from server
    setRefreshing(false);
  };
  
  // Clear local album (NFTs remain on blockchain)
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
      // Pass txSignature as fallback for old cNFTs without valid asset IDs
      const result = await NFTOperations.verifyNFTOnChain(nft.mintAddress, nft.txSignature);
      setVerificationResult(result);
    } catch (e) {
      setVerificationResult({ verified: false, error: e.message });
    } finally {
      setVerifying(false);
    }
  };
  
  // Open external link
  const openLink = (url) => {
    if (!url) {
      showDarkAlert(t('common.error'), 'URL not available');
      return;
    }
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
        {(item.thumbnailUrl || item.imageUrl || item.arweaveUrl || item.metadataUrl) ? (
          <NFTImageWithFallback 
            url={item.thumbnailUrl || item.imageUrl || item.arweaveUrl || item.metadataUrl}
            originalUrl={item.arweaveUrl || item.metadataUrl}
            style={styles.nftImage} 
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
            {/* Show cNFT badge for compressed NFTs */}
            {(item.isCompressed || item.mintAddress?.startsWith('cnft_')) ? (
              <View style={[styles.solanaBadge, { backgroundColor: 'rgba(34, 197, 94, 0.3)' }]}>
                <Text style={{ fontSize: 8, color: '#22c55e', fontWeight: '600' }}>cNFT</Text>
              </View>
            ) : (
              <View style={styles.solanaBadge}>
                <Feather name="hexagon" size={10} color="#9945FF" />
              </View>
            )}
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
            {/* Header - fixed at top */}
            <View style={styles.detailHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailTitle}>{selectedNFT.name}</Text>
                {/* Type badges */}
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                  {(selectedNFT.isCompressed || selectedNFT.mintAddress?.startsWith('cnft_')) ? (
                    <View style={{ backgroundColor: 'rgba(34, 197, 94, 0.2)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ fontSize: 10, color: '#22c55e', fontWeight: '600' }}>{t('nftAlbum.compressedNft')}</Text>
                    </View>
                  ) : (
                    <View style={{ backgroundColor: 'rgba(153, 69, 255, 0.2)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ fontSize: 10, color: '#9945FF', fontWeight: '600' }}>{t('nftAlbum.standardNft')}</Text>
                    </View>
                  )}
                  <View style={{ backgroundColor: 'rgba(153, 69, 255, 0.2)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
                    <Text style={{ fontSize: 10, color: '#9945FF', fontWeight: '600' }}>
                      {selectedNFT.storageType ? (selectedNFT.storageType === 'cloud' ? 'StealthCloud' : 'IPFS') : ((selectedNFT.imageUrl || '').includes('stealthlynk.io') ? 'StealthCloud' : 'IPFS')}
                    </Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity onPress={() => setSelectedNFT(null)}>
                <Feather name="x" size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            
            {/* Scrollable content */}
            <ScrollView 
              key={`scroll-${selectedNFT.mintAddress}`}
              style={styles.detailScrollView}
              contentContainerStyle={styles.detailScrollContent}
              showsVerticalScrollIndicator={true}
              bounces={false}
            >
              {/* Image - try local/thumbnail first (faster), fallback to IPFS */}
              {(selectedNFT.imageUrl || selectedNFT.thumbnailUrl || selectedNFT.arweaveUrl || selectedNFT.metadataUrl) ? (
                <NFTImageWithFallback 
                  key={`img-${selectedNFT.mintAddress}`}
                  url={selectedNFT.imageUrl || selectedNFT.thumbnailUrl || selectedNFT.arweaveUrl || selectedNFT.metadataUrl}
                  originalUrl={selectedNFT.arweaveUrl || selectedNFT.metadataUrl}
                  style={styles.detailImage}
                  isDetail={true}
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
              
              {/* Action buttons - context-aware based on NFT type and storage */}
              <View style={styles.actionButtons}>
              {/* Token view - different for cNFT vs standard NFT */}
              {selectedNFT.isCompressed || selectedNFT.mintAddress?.startsWith('cnft_') ? (
                // cNFT: Use XRAY - handle both real asset ID and tx-based fallback
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => {
                    // Check if we have a real asset ID or tx-based fallback
                    const mintAddr = selectedNFT.mintAddress || '';
                    if (mintAddr.startsWith('cnft_tx_')) {
                      // Tx-based: use transaction view
                      const txSig = mintAddr.replace('cnft_tx_', '');
                      openLink(`https://xray.helius.xyz/tx/${txSig}?network=mainnet`);
                    } else if (selectedNFT.assetId && selectedNFT.assetId.length > 30) {
                      // Real asset ID available (valid base58 is 32-44 chars)
                      openLink(`https://xray.helius.xyz/token/${selectedNFT.assetId}?network=mainnet`);
                    } else if (selectedNFT.txSignature) {
                      // Use full tx signature if available
                      openLink(`https://xray.helius.xyz/tx/${selectedNFT.txSignature}?network=mainnet`);
                    } else if (mintAddr.startsWith('cnft_')) {
                      // Old format without txSignature - can't show valid link
                      // Try to use whatever we have
                      const assetId = mintAddr.replace('cnft_', '');
                      if (assetId.length > 40) {
                        openLink(`https://xray.helius.xyz/tx/${assetId}?network=mainnet`);
                      } else {
                        // Show alert that we need to rescan
                        Alert.alert('Rescan Required', 'This cNFT was created before proper asset ID tracking. Please use "Scan Wallet" to update your NFT data.');
                      }
                    }
                  }}
                >
                  <Feather name="zap" size={16} color={COLORS.text} />
                  <Text style={styles.actionButtonText}>XRAY</Text>
                </TouchableOpacity>
              ) : (
                // Standard NFT: Use Solscan token view
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => openLink(NFTOperations.getSolscanUrl(selectedNFT.mintAddress))}
                >
                  <Feather name="search" size={16} color={COLORS.text} />
                  <Text style={styles.actionButtonText}>{t('nftAlbum.solscan')}</Text>
                </TouchableOpacity>
              )}
              
              {/* Image storage - IPFS or StealthCloud */}
              <TouchableOpacity
                style={styles.actionButton}
                onPress={async () => {
                  // Determine if this is StealthCloud or IPFS storage
                  const isStealthCloud = selectedNFT.storageType === 'cloud' || (!selectedNFT.storageType && (selectedNFT.thumbnailUrl || selectedNFT.imageUrl || '').includes('stealthlynk.io'));
                  
                  if (isStealthCloud) {
                    // StealthCloud: use thumbnailUrl or imageUrl directly
                    const url = selectedNFT.thumbnailUrl || selectedNFT.imageUrl || selectedNFT.arweaveUrl;
                    if (url) {
                      openLink(url);
                    } else {
                      showDarkAlert(t('common.error'), 'Image URL not available');
                    }
                    return;
                  }
                  
                  // IPFS storage: need to find the actual image URL
                  // arweaveUrl might be metadata JSON URL, not image URL
                  // We need to fetch metadata and extract the image field
                  
                  let imageUrl = null;
                  
                  // Check if we have a direct IPFS image URL (not metadata)
                  // Metadata URLs typically end with the CID only, image URLs have file extensions or specific patterns
                  const possibleImageUrl = selectedNFT.imageUrl || selectedNFT.arweaveUrl;
                  if (possibleImageUrl) {
                    const cid = extractIPFSCid(possibleImageUrl);
                    if (cid) {
                      // Fetch to check if it's JSON (metadata) or image
                      try {
                        const testUrl = `https://w3s.link/ipfs/${cid}`;
                        const resp = await fetch(testUrl, { method: 'HEAD', timeout: 3000 });
                        const contentType = resp.headers.get('content-type') || '';
                        
                        if (contentType.includes('image')) {
                          // It's an image, use directly
                          imageUrl = testUrl;
                        } else if (contentType.includes('json')) {
                          // It's metadata JSON, fetch and extract image
                          const jsonResp = await fetch(testUrl, { timeout: 5000 });
                          if (jsonResp.ok) {
                            const meta = await jsonResp.json();
                            if (meta.image) {
                              imageUrl = meta.image;
                            }
                          }
                        }
                      } catch (e) {
                        console.log('[NFT] Could not determine content type:', e.message);
                      }
                    }
                  }
                  
                  // If still no image URL, try metadataUrl
                  if (!imageUrl && selectedNFT.metadataUrl) {
                    const metaCid = extractIPFSCid(selectedNFT.metadataUrl);
                    if (metaCid) {
                      try {
                        const gateways = [
                          `https://w3s.link/ipfs/${metaCid}`,
                          `https://nftstorage.link/ipfs/${metaCid}`,
                        ];
                        for (const gateway of gateways) {
                          try {
                            const resp = await fetch(gateway, { timeout: 5000 });
                            if (resp.ok) {
                              const meta = await resp.json();
                              if (meta.image) {
                                imageUrl = meta.image;
                                break;
                              }
                            }
                          } catch (e) {}
                        }
                      } catch (e) {}
                    }
                  }
                  
                  // Open the image URL
                  if (imageUrl) {
                    const cid = extractIPFSCid(imageUrl);
                    if (cid) {
                      openLink(`https://ipfs.io/ipfs/${cid}`);
                    } else {
                      openLink(imageUrl);
                    }
                  } else {
                    showDarkAlert(t('common.error'), 'Image URL not available');
                  }
                }}
              >
                <Feather name="image" size={16} color={COLORS.text} />
                <Text style={styles.actionButtonText}>
                  {(selectedNFT.thumbnailUrl || selectedNFT.imageUrl || '').includes('stealthlynk.io') ? 'Image' : t('nftAlbum.ipfs')}
                </Text>
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
            </ScrollView>
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
        
        {/* Filter Toggle - All NFTs, Standard, Compressed */}
        {nfts.length > 0 && (
          <View style={styles.filterToggleBar}>
            <TouchableOpacity 
              style={[styles.filterToggle, nftFilter === 'all' && styles.filterToggleActive]}
              onPress={() => { setNftFilter('all'); setCurrentPage(0); }}
            >
              <Feather name="grid" size={14} color={nftFilter === 'all' ? '#fff' : COLORS.textSecondary} />
              <Text style={[styles.filterToggleText, nftFilter === 'all' && styles.filterToggleTextActive]}>
                {t('nftAlbum.allNfts')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.filterToggle, nftFilter === 'standard' && { backgroundColor: 'rgba(153, 69, 255, 0.3)', borderColor: '#9945FF' }]}
              onPress={() => { setNftFilter('standard'); setCurrentPage(0); }}
            >
              <View style={{ alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Feather name="hexagon" size={14} color={nftFilter === 'standard' ? '#9945FF' : COLORS.textSecondary} />
                  <Text style={[styles.filterToggleText, nftFilter === 'standard' && { color: '#9945FF' }]}>
                    {t('nftAlbum.standard')}
                  </Text>
                </View>
                <Text style={{ fontSize: 8, color: COLORS.textSecondary, marginTop: 2 }}>{t('nftAlbum.uniqueToken')}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.filterToggle, nftFilter === 'compressed' && { backgroundColor: 'rgba(34, 197, 94, 0.3)', borderColor: '#22c55e' }]}
              onPress={() => { setNftFilter('compressed'); setCurrentPage(0); }}
            >
              <View style={{ alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Feather name="zap" size={14} color={nftFilter === 'compressed' ? '#22c55e' : COLORS.textSecondary} />
                  <Text style={[styles.filterToggleText, nftFilter === 'compressed' && { color: '#22c55e' }]}>
                    {t('nftAlbum.compressed')}
                  </Text>
                </View>
                <Text style={{ fontSize: 8, color: COLORS.textSecondary, marginTop: 2 }}>{t('nftAlbum.lowCost')}</Text>
              </View>
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
            
            {/* NFT Grid - key forces complete re-render on page change to free memory */}
            <View key={`page-${currentPage}`} style={styles.gridContainer}>
              {displayedNFTs.map((item, index) => (
                <View key={item.mintAddress} style={styles.gridItem}>
                  {renderNFTCard({ item, index })}
                </View>
              ))}
            </View>
            
            {/* Pagination Controls */}
            {filteredNFTs.length > ITEMS_PER_PAGE && (
              <View style={styles.paginationContainer}>
                <TouchableOpacity 
                  style={[styles.paginationButton, !hasPrev && styles.paginationButtonDisabled]}
                  onPress={goToPrevPage}
                  disabled={!hasPrev}
                >
                  <Feather name="chevron-left" size={24} color={hasPrev ? COLORS.primary : COLORS.textSecondary} />
                  <Text style={[styles.paginationText, !hasPrev && styles.paginationTextDisabled]}>{t('nftAlbum.prev')}</Text>
                </TouchableOpacity>
                
                <Text style={styles.paginationInfo}>
                  {currentPage + 1} / {totalPages}
                </Text>
                
                <TouchableOpacity 
                  style={[styles.paginationButton, !hasNext && styles.paginationButtonDisabled]}
                  onPress={goToNextPage}
                  disabled={!hasNext}
                >
                  <Text style={[styles.paginationText, !hasNext && styles.paginationTextDisabled]}>{t('nftAlbum.next')}</Text>
                  <Feather name="chevron-right" size={24} color={hasNext ? COLORS.primary : COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
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
    marginBottom: 16,
  },
  
  // Premium 3D Card - 2 columns
  nftCard: {
    position: 'relative',
    height: (SCREEN_WIDTH - 48) / 2 + 50,
  },
  cardShadow3: {
    position: 'absolute',
    bottom: -4,
    left: 4,
    right: 4,
    height: '100%',
    backgroundColor: 'rgba(153, 69, 255, 0.1)',
    borderRadius: 10,
  },
  cardShadow2: {
    position: 'absolute',
    bottom: -2,
    left: 2,
    right: 2,
    height: '100%',
    backgroundColor: 'rgba(153, 69, 255, 0.15)',
    borderRadius: 9,
  },
  cardShadow1: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 8,
  },
  cardMain: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 4,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
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
    padding: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  nftName: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 2,
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
    fontSize: 8,
    color: 'rgba(255,255,255,0.7)',
  },
  solanaBadge: {
    width: 14,
    height: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(153, 69, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Pagination
  paginationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
  },
  paginationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  paginationButtonDisabled: {
    opacity: 0.4,
  },
  paginationText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.primary,
  },
  paginationTextDisabled: {
    color: COLORS.textSecondary,
  },
  paginationInfo: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
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
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'flex-end',
  },
  detailModal: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    flex: 1,
    marginTop: 40,
    overflow: 'hidden',
  },
  detailScrollView: {
    flex: 1,
  },
  detailScrollContent: {
    paddingBottom: 24,
    flexGrow: 1,
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
    minHeight: 200,
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
