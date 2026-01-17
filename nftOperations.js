// NFT Operations Module for PhotoLynk Solana Seeker
// Handles REAL photo NFT minting on Solana using SPL Token + Metaplex Token Metadata
// Uses Mobile Wallet Adapter for Seeker device wallet

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as MediaLibrary from 'expo-media-library';
import * as ImageManipulator from 'expo-image-manipulator';
import axios from 'axios';
import { getDeviceUUID, SAVED_PASSWORD_KEY } from './authHelpers';

// ============================================================================
// SOLANA IMPORTS
// ============================================================================

let Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL;
let TransactionMessage, VersionedTransaction, Keypair, ComputeBudgetProgram;
let transact;
let TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createInitializeMintInstruction;
let createAssociatedTokenAccountInstruction, createMintToInstruction, getAssociatedTokenAddress;
let getMint, getMinimumBalanceForRentExemptMint, MINT_SIZE;
let solanaAvailable = false;
let splTokenAvailable = false;

try {
  const web3 = require('@solana/web3.js');
  Connection = web3.Connection;
  PublicKey = web3.PublicKey;
  Transaction = web3.Transaction;
  SystemProgram = web3.SystemProgram;
  LAMPORTS_PER_SOL = web3.LAMPORTS_PER_SOL;
  TransactionMessage = web3.TransactionMessage;
  VersionedTransaction = web3.VersionedTransaction;
  Keypair = web3.Keypair;
  ComputeBudgetProgram = web3.ComputeBudgetProgram;
  
  const mwa = require('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
  transact = mwa.transact;
  
  solanaAvailable = true;
  
  // Try to load SPL Token
  try {
    const splToken = require('@solana/spl-token');
    TOKEN_PROGRAM_ID = splToken.TOKEN_PROGRAM_ID;
    ASSOCIATED_TOKEN_PROGRAM_ID = splToken.ASSOCIATED_TOKEN_PROGRAM_ID;
    createInitializeMintInstruction = splToken.createInitializeMintInstruction;
    createAssociatedTokenAccountInstruction = splToken.createAssociatedTokenAccountInstruction;
    createMintToInstruction = splToken.createMintToInstruction;
    getAssociatedTokenAddress = splToken.getAssociatedTokenAddress;
    getMint = splToken.getMint;
    getMinimumBalanceForRentExemptMint = splToken.getMinimumBalanceForRentExemptMint;
    MINT_SIZE = splToken.MINT_SIZE;
    splTokenAvailable = true;
    console.log('[NFT] SPL Token loaded successfully');
  } catch (splErr) {
    console.log('[NFT] SPL Token not available:', splErr.message);
  }
} catch (e) {
  console.log('[NFT] Solana libraries not available:', e.message);
}

// SNS (Solana Name Service) for .sol domain resolution
let snsAvailable = false;
let getDomainKeySync, NameRegistryState;
try {
  const sns = require('@bonfida/spl-name-service');
  getDomainKeySync = sns.getDomainKeySync;
  NameRegistryState = sns.NameRegistryState;
  snsAvailable = true;
  console.log('[NFT] SNS (Solana Name Service) loaded successfully');
} catch (snsErr) {
  console.log('[NFT] SNS not available:', snsErr.message);
}

// AllDomains API for .skr and other TLDs (no SDK needed - uses REST API)

// ============================================================================
// CONFIGURATION
// ============================================================================

// Solana RPC endpoint (mainnet-beta for production)
const SOLANA_RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';

// App commission wallet (receives NFT minting fees)
export const NFT_COMMISSION_WALLET = 'HttTZkUG8xn5A1uJPjRDJqqufdwvHmNQroEGmST8iimU';

// App identity for Mobile Wallet Adapter
const APP_IDENTITY = {
  name: 'PhotoLynk',
  uri: 'https://stealthlynk.io',
  icon: 'favicon.ico',
};

// Metaplex Token Metadata Program ID (for fetching NFT metadata)
let TOKEN_METADATA_PROGRAM_ID = null;

// NFT Minting Fees (in USD)
export const NFT_FEES = {
  ARWEAVE_UPLOAD_BASE: 0.01,      // Base Arweave upload cost (varies by size)
  ARWEAVE_PER_KB: 0.00001,        // Per KB upload cost
  SOLANA_RENT: 0.002,             // Solana rent-exempt minimum (~0.002 SOL)
  METAPLEX_FEE: 0.01,             // Metaplex protocol fee
  APP_COMMISSION_IPFS_USD: 0.50,  // PhotoLynk commission for IPFS storage
  APP_COMMISSION_CLOUD_USD: 0.20, // PhotoLynk commission for StealthCloud storage (discounted)
  APP_COMMISSION_PERCENT: 5,      // Alternative: 5% of total cost
};

// Storage options for NFT images
export const NFT_STORAGE_OPTIONS = {
  IPFS: 'ipfs',           // Pinata IPFS - decentralized, $0.50 commission
  STEALTHCLOUD: 'cloud',  // StealthCloud - user's storage, $0.20 commission
};

// ============================================================================
// IPFS STORAGE CONFIGURATION
// Get your FREE API keys from:
// - NFT.storage: https://nft.storage (recommended, free forever)
// - Pinata: https://pinata.cloud (free tier available)
// ============================================================================

// NFT.storage API Key (get free at https://nft.storage/manage/)
const NFT_STORAGE_API_KEY = process.env.NFT_STORAGE_API_KEY || process.env.EXPO_PUBLIC_NFT_STORAGE_API_KEY || '';

// Pinata JWT (get free at https://app.pinata.cloud/developers/api-keys)
const PINATA_JWT = process.env.PINATA_JWT || process.env.EXPO_PUBLIC_PINATA_JWT || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiJjZWJmYjg0Ni04NTJjLTRmMTQtYjRmMS0zYTk4MjFiZDJiYmIiLCJlbWFpbCI6InZpa3Rvci52aXNoeW4uMzY5QGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJwaW5fcG9saWN5Ijp7InJlZ2lvbnMiOlt7ImRlc2lyZWRSZXBsaWNhdGlvbkNvdW50IjoxLCJpZCI6IkZSQTEifSx7ImRlc2lyZWRSZXBsaWNhdGlvbkNvdW50IjoxLCJpZCI6Ik5ZQzEifV0sInZlcnNpb24iOjF9LCJtZmFfZW5hYmxlZCI6ZmFsc2UsInN0YXR1cyI6IkFDVElWRSJ9LCJhdXRoZW50aWNhdGlvblR5cGUiOiJzY29wZWRLZXkiLCJzY29wZWRLZXlLZXkiOiIyNWI0ODcyZDg1ZDgzODgzMGY5MCIsInNjb3BlZEtleVNlY3JldCI6ImM5Yjc2Zjc3MjIzNTA0YTE2ZDVkNGE5MTE5ZDdiZjEzNzNhNTkxYzc4NTEyMGM4M2I5MmM3ZWFjYWU3OGRjZjAiLCJleHAiOjE3OTk4NzQzNTh9.YMv_l6T4RSh7HGxNaCVf7y-1w_FPKhdaCUBfmMotJpM';

// NFT Collection info (optional - for grouping PhotoLynk NFTs)
const PHOTOLYNK_COLLECTION = {
  name: 'PhotoLynk Photo NFTs',
  symbol: 'PLNK',
  description: 'Photo NFTs minted with PhotoLynk on Solana Seeker',
};

// ============================================================================
// STATE
// ============================================================================

let connection = null;
let cachedSolPrice = null;
let solPriceLastFetch = 0;
const SOL_PRICE_CACHE_MS = 60000;

// Local NFT storage - using FileSystem instead of SecureStore to avoid 2KB limit
const NFT_STORAGE_KEY = 'photolynk_nfts';
const NFT_STORAGE_FILE = `${FileSystem.documentDirectory}photolynk_nfts.json`;

// ============================================================================
// METAPLEX TOKEN METADATA INSTRUCTION BUILDERS
// ============================================================================

/**
 * Create instruction to create metadata account v3
 * This is a manual implementation of the Metaplex instruction
 */
const createMetadataAccountV3Instruction = (
  metadataAccount,
  mint,
  mintAuthority,
  payer,
  updateAuthority,
  name,
  symbol,
  uri,
  sellerFeeBasisPoints,
  creators,
  tokenMetadataProgramId
) => {
  // Metaplex Token Metadata Program instruction discriminator for CreateMetadataAccountV3
  const INSTRUCTION_DISCRIMINATOR = 33; // CreateMetadataAccountV3
  
  // Serialize the data
  const nameBytes = Buffer.from(name.slice(0, 32).padEnd(32, '\0'));
  const symbolBytes = Buffer.from(symbol.slice(0, 10).padEnd(10, '\0'));
  const uriBytes = Buffer.from(uri.slice(0, 200).padEnd(200, '\0'));
  
  // Build data buffer
  // Format: discriminator (1) + name length (4) + name + symbol length (4) + symbol + uri length (4) + uri + seller_fee (2) + creators option + collection option + uses option + isMutable (1) + collectionDetails option
  const data = Buffer.alloc(1 + 4 + name.length + 4 + symbol.length + 4 + uri.length + 2 + 1 + 1 + 1 + 1 + 1);
  let offset = 0;
  
  // Discriminator
  data.writeUInt8(INSTRUCTION_DISCRIMINATOR, offset);
  offset += 1;
  
  // Name (borsh string: 4 byte length + string)
  data.writeUInt32LE(name.length, offset);
  offset += 4;
  data.write(name, offset);
  offset += name.length;
  
  // Symbol
  data.writeUInt32LE(symbol.length, offset);
  offset += 4;
  data.write(symbol, offset);
  offset += symbol.length;
  
  // URI
  data.writeUInt32LE(uri.length, offset);
  offset += 4;
  data.write(uri, offset);
  offset += uri.length;
  
  // Seller fee basis points
  data.writeUInt16LE(sellerFeeBasisPoints, offset);
  offset += 2;
  
  // Creators (Option<Vec<Creator>>): None for simplicity
  data.writeUInt8(0, offset); // None
  offset += 1;
  
  // Collection (Option<Collection>): None
  data.writeUInt8(0, offset);
  offset += 1;
  
  // Uses (Option<Uses>): None
  data.writeUInt8(0, offset);
  offset += 1;
  
  // Is mutable
  data.writeUInt8(1, offset); // true
  offset += 1;
  
  // Collection details (Option<CollectionDetails>): None
  data.writeUInt8(0, offset);
  
  const finalData = data.slice(0, offset + 1);
  
  return {
    keys: [
      { pubkey: metadataAccount, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: updateAuthority, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    programId: tokenMetadataProgramId,
    data: finalData,
  };
};

/**
 * Create instruction to create master edition v3
 */
const createMasterEditionV3Instruction = (
  masterEdition,
  mint,
  updateAuthority,
  mintAuthority,
  metadata,
  payer,
  maxSupply,
  tokenMetadataProgramId
) => {
  // Instruction discriminator for CreateMasterEditionV3
  const INSTRUCTION_DISCRIMINATOR = 17;
  
  // Data: discriminator (1) + max_supply option (1 + 8 if Some)
  const data = Buffer.alloc(10);
  let offset = 0;
  
  data.writeUInt8(INSTRUCTION_DISCRIMINATOR, offset);
  offset += 1;
  
  // Max supply (Option<u64>): Some(0) means no prints allowed
  if (maxSupply !== null && maxSupply !== undefined) {
    data.writeUInt8(1, offset); // Some
    offset += 1;
    // Write u64 as two u32s (React Native Buffer doesn't support BigInt)
    const supply = Number(maxSupply);
    data.writeUInt32LE(supply & 0xFFFFFFFF, offset);
    data.writeUInt32LE(Math.floor(supply / 0x100000000) & 0xFFFFFFFF, offset + 4);
    offset += 8;
  } else {
    data.writeUInt8(0, offset); // None (unlimited)
    offset += 1;
  }
  
  const finalData = data.slice(0, offset);
  
  return {
    keys: [
      { pubkey: masterEdition, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: updateAuthority, isSigner: true, isWritable: false },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    programId: tokenMetadataProgramId,
    data: finalData,
  };
};

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize NFT module
 */
export const initializeNFT = async () => {
  if (!solanaAvailable) {
    console.log('[NFT] Solana not available');
    return false;
  }
  
  try {
    connection = new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
    // Initialize Metaplex Token Metadata Program ID
    TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
    console.log('[NFT] Module initialized');
    return true;
  } catch (e) {
    console.error('[NFT] Init failed:', e);
    return false;
  }
};

// ============================================================================
// SOL PRICE (reuse from solanaPurchases pattern)
// ============================================================================

/**
 * Fetch current SOL price in USD
 */
export const fetchSolPrice = async () => {
  const now = Date.now();
  if (cachedSolPrice && (now - solPriceLastFetch) < SOL_PRICE_CACHE_MS) {
    return cachedSolPrice;
  }
  
  const priceApis = [
    { name: 'CoinGecko', url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', extract: (d) => d?.solana?.usd },
    { name: 'Binance', url: 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', extract: (d) => parseFloat(d?.price) },
    { name: 'CoinCap', url: 'https://api.coincap.io/v2/assets/solana', extract: (d) => parseFloat(d?.data?.priceUsd) },
  ];
  
  for (const api of priceApis) {
    try {
      const response = await axios.get(api.url, { timeout: 8000 });
      const price = api.extract(response.data);
      if (price && typeof price === 'number' && price > 0) {
        cachedSolPrice = price;
        solPriceLastFetch = now;
        return price;
      }
    } catch (e) {
      // Continue to next API
    }
  }
  
  return cachedSolPrice || 150; // Fallback
};

/**
 * Convert USD to SOL
 */
export const usdToSol = async (usdAmount) => {
  const solPrice = await fetchSolPrice();
  return usdAmount / solPrice;
};

// ============================================================================
// EXIF EXTRACTION
// ============================================================================

/**
 * Extract EXIF data from asset for NFT metadata
 * @param {Object} asset - MediaLibrary asset
 * @param {Object} info - Asset info from getAssetInfoAsync
 * @returns {Object} EXIF metadata for NFT
 */
export const extractExifForNFT = (asset, info) => {
  const exif = info?.exif || {};
  
  // Build NFT-friendly EXIF object
  const nftExif = {
    // Core photo info
    dateTaken: null,
    camera: null,
    lens: null,
    
    // Technical settings
    iso: exif.ISOSpeedRatings || exif.ISO || null,
    aperture: exif.FNumber || exif.ApertureValue || null,
    shutterSpeed: exif.ExposureTime || exif.ShutterSpeedValue || null,
    focalLength: exif.FocalLength || null,
    
    // Location (if available)
    latitude: exif.GPSLatitude || null,
    longitude: exif.GPSLongitude || null,
    altitude: exif.GPSAltitude || null,
    
    // Device info
    make: exif.Make || null,
    model: exif.Model || null,
    software: exif.Software || null,
    
    // Image dimensions
    width: asset.width || exif.PixelXDimension || null,
    height: asset.height || exif.PixelYDimension || null,
    orientation: exif.Orientation || null,
    
    // Future: embedded SOL gift (private key placeholder)
    // solGift: null, // Will be populated when feature is added
  };
  
  // Parse date
  const dateFields = ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime', 'CreateDate'];
  for (const field of dateFields) {
    if (exif[field]) {
      try {
        // EXIF date format: "YYYY:MM:DD HH:MM:SS"
        const dateStr = exif[field].replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
        nftExif.dateTaken = new Date(dateStr).toISOString();
        break;
      } catch (e) {
        // Continue to next field
      }
    }
  }
  
  // Fallback to asset creation time
  if (!nftExif.dateTaken && asset.creationTime) {
    nftExif.dateTaken = new Date(asset.creationTime).toISOString();
  }
  
  // Build camera string
  if (nftExif.make || nftExif.model) {
    nftExif.camera = [nftExif.make, nftExif.model].filter(Boolean).join(' ');
  }
  
  return nftExif;
};

// ============================================================================
// EXIF STRIPPING FOR PRIVACY
// ============================================================================

/**
 * Strip EXIF data from an image for privacy
 * Creates a clean copy without date, location, device info
 * @param {string} filePath - Original file path
 * @returns {Object} { success, cleanPath, error }
 */
export const stripExifFromImage = async (filePath) => {
  try {
    // Read the original image as base64
    const originalBase64 = await FileSystem.readAsStringAsync(filePath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    // Decode base64 to find and remove EXIF data
    // JPEG EXIF is stored in APP1 marker (0xFFE1)
    // We'll re-encode the image data without EXIF by using a canvas approach
    
    // For React Native, the simplest approach is to use expo-image-manipulator
    // which re-encodes the image and strips EXIF in the process
    if (!ImageManipulator || !ImageManipulator.manipulateAsync) {
      console.log('[NFT] expo-image-manipulator not available, using fallback');
      return { success: true, cleanPath: filePath, stripped: false };
    }
    
    // Use ImageManipulator to re-encode without EXIF
    // The manipulate function with no operations still re-encodes and strips EXIF
    const result = await ImageManipulator.manipulateAsync(
      filePath,
      [], // No transformations, just re-encode
      { 
        compress: 0.95, // High quality
        format: ImageManipulator.SaveFormat.JPEG,
        // Note: manipulateAsync strips EXIF by default
      }
    );
    
    console.log('[NFT] EXIF stripped, clean image at:', result.uri);
    
    return {
      success: true,
      cleanPath: result.uri,
      stripped: true,
    };
  } catch (e) {
    console.error('[NFT] EXIF stripping failed:', e.message);
    return { success: false, error: e.message };
  }
};

// ============================================================================
// STEALTHCLOUD NFT STORAGE
// ============================================================================

/**
 * Check if user is eligible for StealthCloud NFT storage
 * @param {Object} config - Server config with baseUrl and getAuthHeaders function
 * @param {number} fileSizeBytes - Estimated file size
 * @returns {Object} { eligible, reason, quotaBytes, usedBytes, availableBytes }
 */
export const checkStealthCloudEligibility = async (config, fileSizeBytes = 5 * 1024 * 1024) => {
  try {
    if (!config?.baseUrl) {
      return { eligible: false, reason: 'Not connected to StealthCloud' };
    }
    
    // Get auth headers (can be object or function)
    let headers = {};
    if (typeof config.getAuthHeaders === 'function') {
      const authConfig = await config.getAuthHeaders();
      headers = authConfig?.headers || {};
    } else if (config.headers) {
      headers = config.headers;
    }
    
    if (!headers.Authorization) {
      return { eligible: false, reason: 'Not logged in' };
    }
    
    const response = await axios.get(
      `${config.baseUrl}/api/nft/eligibility?size=${fileSizeBytes}`,
      { headers, timeout: 10000 }
    );
    
    return response.data;
  } catch (e) {
    console.log('[NFT] StealthCloud eligibility check failed:', e.message);
    return { eligible: false, reason: 'Could not verify StealthCloud status' };
  }
};

/**
 * Upload NFT image to StealthCloud
 * @param {string} filePath - Local file path
 * @param {Object} config - Server config with baseUrl and getAuthHeaders function
 * @returns {Object} { success, publicUrl, imageId, error }
 */
export const uploadToStealthCloud = async (filePath, config) => {
  try {
    if (!config?.baseUrl) {
      return { success: false, error: 'Not connected to StealthCloud' };
    }
    
    // Get auth headers (can be object or function)
    let headers = {};
    if (typeof config.getAuthHeaders === 'function') {
      const authConfig = await config.getAuthHeaders();
      headers = authConfig?.headers || {};
    } else if (config.headers) {
      headers = config.headers;
    }
    
    if (!headers.Authorization) {
      return { success: false, error: 'Not logged in to StealthCloud' };
    }
    // Ensure device UUID header is present (server requires X-Device-UUID)
    if (!headers['X-Device-UUID'] && !headers['x-device-uuid']) {
      // 1) Try persisted device_uuid
      try {
        const storedUuid = await SecureStore.getItemAsync('device_uuid');
        if (storedUuid) {
          headers['X-Device-UUID'] = storedUuid;
        }
      } catch (e) {
        // ignore
      }

      // 2) If still missing, derive from email+password (same as login path)
      if (!headers['X-Device-UUID']) {
        try {
          const email = await SecureStore.getItemAsync('user_email');
          const password = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY);
          if (email && password) {
            const derived = await getDeviceUUID(email, password);
            if (derived) headers['X-Device-UUID'] = derived;
          }
        } catch (e) {
          // ignore
        }
      }

      if (!headers['X-Device-UUID']) {
        return { success: false, error: 'Device UUID missing. Please login again.' };
      }
    }
    
    // Read file as base64
    const fileBase64 = await FileSystem.readAsStringAsync(filePath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    const fileSize = Math.ceil(fileBase64.length * 0.75);
    console.log(`[NFT] Uploading ${fileSize} bytes to StealthCloud...`);
    
    // Determine content type from file extension
    const ext = filePath.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeTypes = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
    };
    const contentType = mimeTypes[ext] || 'image/jpeg';
    
    // Build multipart form data
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    const filename = `nft_${Date.now()}.${ext}`;
    
    // Decode base64 to binary
    const binaryStr = atob(fileBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    
    // Build multipart body
    const headerStr = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="image"; filename="${filename}"\r\n`,
      `Content-Type: ${contentType}\r\n\r\n`,
    ].join('');
    const footerStr = `\r\n--${boundary}--\r\n`;
    
    const headerBytes = new TextEncoder().encode(headerStr);
    const footerBytes = new TextEncoder().encode(footerStr);
    
    const body = new Uint8Array(headerBytes.length + bytes.length + footerBytes.length);
    body.set(headerBytes, 0);
    body.set(bytes, headerBytes.length);
    body.set(footerBytes, headerBytes.length + bytes.length);
    
    const response = await fetch(`${config.baseUrl}/api/nft/upload`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: body,
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Upload failed: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      // Use fallback URL with full base URL since nft.stealthlynk.io subdomain may not be configured
      const fullFallbackUrl = `${config.baseUrl}${result.fallbackUrl}`;
      console.log('[NFT] Uploaded to StealthCloud:', fullFallbackUrl);
      return {
        success: true,
        arweaveUrl: fullFallbackUrl, // Use fallback URL for reliable access
        publicUrl: result.publicUrl,
        fallbackUrl: fullFallbackUrl,
        imageId: result.imageId,
        size: result.size,
      };
    }
    
    throw new Error('Upload failed');
  } catch (e) {
    console.error('[NFT] StealthCloud upload failed:', e.message);
    return { success: false, error: e.message };
  }
};

// ============================================================================
// IPFS UPLOAD (via Pinata)
// ============================================================================

/**
 * Estimate Arweave upload cost
 * @param {number} fileSizeBytes - File size in bytes
 * @returns {Object} { arweaveUsd, arweaveSol }
 */
export const estimateArweaveUploadCost = async (fileSizeBytes) => {
  const sizeKb = fileSizeBytes / 1024;
  const baseCost = NFT_FEES.ARWEAVE_UPLOAD_BASE;
  const sizeCost = sizeKb * NFT_FEES.ARWEAVE_PER_KB;
  const totalUsd = baseCost + sizeCost;
  const totalSol = await usdToSol(totalUsd);
  
  return {
    arweaveUsd: totalUsd,
    arweaveSol: totalSol,
  };
};

/**
 * Upload image to IPFS via Pinata (primary) or NFT.storage (fallback)
 * @param {string} filePath - Local file path
 * @param {string} contentType - MIME type
 * @param {Object} tags - Metadata tags
 * @returns {Object} { success, arweaveUrl, transactionId, error }
 */
export const uploadToArweave = async (filePath, contentType = 'image/jpeg', tags = {}) => {
  // Try Pinata first (we have the key configured)
  if (PINATA_JWT) {
    try {
      console.log('[NFT] Uploading to IPFS via Pinata...');
      return await uploadToPinata(filePath, contentType);
    } catch (pinataError) {
      console.error('[NFT] Pinata upload failed:', pinataError.message);
      // Fall through to NFT.storage
    }
  }
  
  // Try NFT.storage as fallback
  if (NFT_STORAGE_API_KEY) {
    try {
      const fileBase64 = await FileSystem.readAsStringAsync(filePath, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      const fileSize = Math.ceil(fileBase64.length * 0.75);
      console.log(`[NFT] Uploading ~${fileSize} bytes to IPFS via NFT.storage...`);
      
      const blob = await fetch(`data:${contentType};base64,${fileBase64}`).then(r => r.blob());
      
      const response = await fetch('https://api.nft.storage/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NFT_STORAGE_API_KEY}`,
        },
        body: blob,
      });
      
      if (!response.ok) {
        throw new Error(`NFT.storage upload failed: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.ok && result.value?.cid) {
        const cid = result.value.cid;
        console.log('[NFT] Uploaded to IPFS with CID:', cid);
        
        return {
          success: true,
          arweaveUrl: `https://nftstorage.link/ipfs/${cid}`,
          ipfsUrl: `ipfs://${cid}`,
          transactionId: cid,
          size: fileSize,
        };
      }
      
      throw new Error('No CID returned from NFT.storage');
    } catch (e) {
      console.error('[NFT] NFT.storage upload failed:', e.message);
    }
  }
  
  return { success: false, error: 'No IPFS upload service configured. Add PINATA_JWT or NFT_STORAGE_API_KEY.' };
};

/**
 * Upload to Pinata IPFS using base64 approach for React Native
 */
const uploadToPinata = async (filePath, contentType) => {
  if (!PINATA_JWT) {
    throw new Error('Pinata JWT not configured');
  }
  
  const fileBase64 = await FileSystem.readAsStringAsync(filePath, {
    encoding: FileSystem.EncodingType.Base64,
  });
  
  const fileSize = Math.ceil(fileBase64.length * 0.75);
  console.log(`[NFT] Uploading ${fileSize} bytes to Pinata...`);
  
  // Use Pinata's pinFileToIPFS with multipart form data
  // React Native compatible approach
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  const isJson = contentType === 'application/json';
  const fileName = isJson ? `metadata_${Date.now()}.json` : `photo_${Date.now()}.jpg`;
  
  // Decode base64 to binary string for the body
  const binaryStr = atob(fileBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  
  // Build multipart body manually
  const bodyParts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`,
    `Content-Type: ${contentType}\r\n\r\n`,
  ];
  
  const headerStr = bodyParts.join('');
  const footerStr = `\r\n--${boundary}--\r\n`;
  
  // Combine header + file bytes + footer
  const headerBytes = new TextEncoder().encode(headerStr);
  const footerBytes = new TextEncoder().encode(footerStr);
  
  const body = new Uint8Array(headerBytes.length + bytes.length + footerBytes.length);
  body.set(headerBytes, 0);
  body.set(bytes, headerBytes.length);
  body.set(footerBytes, headerBytes.length + bytes.length);
  
  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PINATA_JWT}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: body,
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[NFT] Pinata error response:', errorText);
    throw new Error(`Pinata upload failed: ${response.status}`);
  }
  
  const result = await response.json();
  
  if (result.IpfsHash) {
    const cid = result.IpfsHash;
    console.log('[NFT] Uploaded to Pinata IPFS with CID:', cid);
    
    return {
      success: true,
      arweaveUrl: `https://gateway.pinata.cloud/ipfs/${cid}`,
      ipfsUrl: `ipfs://${cid}`,
      transactionId: cid,
      size: fileSize,
    };
  }
  
  throw new Error('No hash returned from Pinata');
};

// ============================================================================
// NFT METADATA
// ============================================================================

/**
 * Build Metaplex-compatible NFT metadata
 * @param {Object} params - NFT parameters
 * @returns {Object} Metaplex metadata JSON
 */
export const buildNFTMetadata = ({
  name,
  description,
  imageUrl,
  ownerAddress,
  exifData,
  creatorAddress,
  royaltyBasisPoints = 500, // 5% royalty
}) => {
  const metadata = {
    name: name || 'PhotoLynk Photo NFT',
    symbol: PHOTOLYNK_COLLECTION.symbol,
    description: description || 'Photo NFT minted with PhotoLynk on Solana Seeker',
    image: imageUrl,
    external_url: 'https://stealthlynk.io',
    
    // Metaplex attributes
    attributes: [
      { trait_type: 'NFT Owner', value: ownerAddress },
      { trait_type: 'Minted With', value: 'PhotoLynk' },
      { trait_type: 'Platform', value: 'Solana Seeker' },
    ],
    
    // Add EXIF attributes
    properties: {
      category: 'image',
      files: [
        {
          uri: imageUrl,
          type: 'image/jpeg',
        },
      ],
      creators: [
        {
          address: creatorAddress || ownerAddress,
          share: 100,
        },
      ],
    },
    
    // Seller fee basis points (royalties)
    seller_fee_basis_points: royaltyBasisPoints,
  };
  
  // Add EXIF data as attributes
  if (exifData) {
    if (exifData.dateTaken) {
      metadata.attributes.push({ trait_type: 'Date Taken', value: exifData.dateTaken });
    }
    if (exifData.camera) {
      metadata.attributes.push({ trait_type: 'Camera', value: exifData.camera });
    }
    if (exifData.iso) {
      metadata.attributes.push({ trait_type: 'ISO', value: String(exifData.iso) });
    }
    if (exifData.aperture) {
      metadata.attributes.push({ trait_type: 'Aperture', value: `f/${exifData.aperture}` });
    }
    if (exifData.shutterSpeed) {
      const shutter = exifData.shutterSpeed < 1 
        ? `1/${Math.round(1/exifData.shutterSpeed)}s` 
        : `${exifData.shutterSpeed}s`;
      metadata.attributes.push({ trait_type: 'Shutter Speed', value: shutter });
    }
    if (exifData.focalLength) {
      metadata.attributes.push({ trait_type: 'Focal Length', value: `${exifData.focalLength}mm` });
    }
    if (exifData.width && exifData.height) {
      metadata.attributes.push({ trait_type: 'Resolution', value: `${exifData.width}x${exifData.height}` });
    }
    if (exifData.latitude && exifData.longitude) {
      metadata.attributes.push({ trait_type: 'GPS', value: `${exifData.latitude.toFixed(4)}, ${exifData.longitude.toFixed(4)}` });
    }
  }
  
  return metadata;
};

/**
 * Upload metadata JSON to IPFS
 */
export const uploadMetadataToArweave = async (metadata) => {
  const metadataJson = JSON.stringify(metadata, null, 2);
  console.log('[NFT] Uploading metadata JSON:', metadataJson.substring(0, 200) + '...');
  
  // Create temporary file for metadata (write as base64 to ensure proper encoding)
  const tempPath = `${FileSystem.cacheDirectory}nft_metadata_${Date.now()}.json`;
  const metadataBase64 = btoa(unescape(encodeURIComponent(metadataJson)));
  await FileSystem.writeAsStringAsync(tempPath, metadataBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  
  const result = await uploadToArweave(tempPath, 'application/json', {
    'NFT-Type': 'metadata',
  });
  
  // Clean up temp file
  try {
    await FileSystem.deleteAsync(tempPath, { idempotent: true });
  } catch (e) {}
  
  if (result.success) {
    console.log('[NFT] Metadata uploaded to:', result.arweaveUrl);
  }
  
  return result;
};

// ============================================================================
// NFT MINTING COST ESTIMATION
// ============================================================================

/**
 * Estimate total NFT minting cost
 * @param {number} imageSizeBytes - Image file size
 * @param {string} storageOption - 'ipfs' or 'cloud' (optional, defaults to 'ipfs')
 * @returns {Object} Cost breakdown
 */
export const estimateNFTMintCost = async (imageSizeBytes, storageOption = 'ipfs') => {
  const solPrice = await fetchSolPrice();
  
  // Storage upload cost (image + metadata)
  // StealthCloud storage is free (uses user's plan), IPFS has upload cost
  const useCloud = storageOption === NFT_STORAGE_OPTIONS.STEALTHCLOUD;
  const imageUploadCost = useCloud 
    ? { arweaveSol: 0, arweaveUsd: 0 } 
    : await estimateArweaveUploadCost(imageSizeBytes);
  const metadataUploadCost = await estimateArweaveUploadCost(2000); // ~2KB metadata (always IPFS)
  
  // Solana costs
  const solanaRentSol = 0.00203928; // Rent-exempt minimum for token account
  const metaplexFeeSol = 0.01; // Metaplex fee
  const transactionFeeSol = 0.000005; // Transaction fee
  
  // App commission - lower for StealthCloud users
  const appCommissionUsd = useCloud 
    ? NFT_FEES.APP_COMMISSION_CLOUD_USD 
    : NFT_FEES.APP_COMMISSION_IPFS_USD;
  const appCommissionSol = appCommissionUsd / solPrice;
  
  // Total
  const totalSol = 
    imageUploadCost.arweaveSol + 
    metadataUploadCost.arweaveSol + 
    solanaRentSol + 
    metaplexFeeSol + 
    transactionFeeSol + 
    appCommissionSol;
  
  const totalUsd = totalSol * solPrice;
  
  return {
    breakdown: {
      arweaveImage: { sol: imageUploadCost.arweaveSol, usd: imageUploadCost.arweaveUsd },
      arweaveMetadata: { sol: metadataUploadCost.arweaveSol, usd: metadataUploadCost.arweaveUsd },
      solanaRent: { sol: solanaRentSol, usd: solanaRentSol * solPrice },
      metaplexFee: { sol: metaplexFeeSol, usd: metaplexFeeSol * solPrice },
      transactionFee: { sol: transactionFeeSol, usd: transactionFeeSol * solPrice },
      appCommission: { sol: appCommissionSol, usd: appCommissionUsd },
    },
    total: {
      sol: totalSol,
      usd: totalUsd,
      solFormatted: totalSol.toFixed(6),
      usdFormatted: `$${totalUsd.toFixed(2)}`,
    },
    solPrice,
  };
};

// ============================================================================
// NFT MINTING
// ============================================================================

/**
 * Mint a photo as NFT on Solana
 * @param {Object} params - Minting parameters
 * @returns {Object} { success, mintAddress, txSignature, error }
 */
export const mintPhotoNFT = async ({
  asset,           // MediaLibrary asset
  filePath,        // Resolved file path
  name,            // NFT name
  description,     // NFT description
  stripExif,       // Remove EXIF data for privacy
  storageOption,   // 'ipfs' or 'cloud' (StealthCloud)
  serverConfig,    // Server config for StealthCloud { baseUrl, headers }
  onProgress,      // Progress callback (0-1)
  onStatus,        // Status callback
}) => {
  if (!solanaAvailable || !transact || !connection) {
    return { success: false, error: 'Solana not available' };
  }
  
  try {
    onStatus?.('Preparing NFT...');
    onProgress?.(0.05);
    
    // Get asset info for EXIF
    const info = await MediaLibrary.getAssetInfoAsync(asset.id);
    const exifData = extractExifForNFT(asset, info);
    
    // Get file size
    const fileInfo = await FileSystem.getInfoAsync(filePath);
    const fileSize = fileInfo.size || 0;
    
    onStatus?.('Estimating costs...');
    onProgress?.(0.1);
    
    // Estimate costs
    const costEstimate = await estimateNFTMintCost(fileSize);
    console.log('[NFT] Cost estimate:', costEstimate.total);
    
    onStatus?.('Connecting wallet...');
    onProgress?.(0.15);
    
    // Execute minting via Mobile Wallet Adapter
    const result = await transact(async (wallet) => {
      // Authorize wallet
      console.log('[NFT] Authorizing wallet...');
      const authResult = await wallet.authorize({
        cluster: 'mainnet-beta',
        identity: APP_IDENTITY,
      });
      
      console.log('[NFT] Auth result accounts:', authResult.accounts?.length);
      
      // Get owner's public key
      const ownerAddress = authResult.accounts[0].address;
      console.log('[NFT] Owner address raw:', ownerAddress);
      
      const ownerBytes = typeof ownerAddress === 'string'
        ? Uint8Array.from(atob(ownerAddress), c => c.charCodeAt(0))
        : new Uint8Array(ownerAddress);
      const ownerPubkey = new PublicKey(ownerBytes);
      const ownerAddressStr = ownerPubkey.toBase58();
      
      console.log('[NFT] Owner address (base58):', ownerAddressStr);
      
        // Handle EXIF stripping if requested
      let uploadFilePath = filePath;
      let cleanupTempFile = null;
      
      if (stripExif) {
        onStatus?.('Removing private data...');
        onProgress?.(0.2);
        
        const stripResult = await stripExifFromImage(filePath);
        if (stripResult.success && stripResult.stripped) {
          uploadFilePath = stripResult.cleanPath;
          cleanupTempFile = stripResult.cleanPath;
          console.log('[NFT] Using EXIF-stripped image');
        } else {
          console.log('[NFT] EXIF stripping skipped or failed, using original');
        }
      }
      
      // Upload image based on storage option
      const useStealthCloud = storageOption === NFT_STORAGE_OPTIONS.STEALTHCLOUD && serverConfig;
      
      let imageUpload;
      if (useStealthCloud) {
        onStatus?.('Uploading to StealthCloud...');
        onProgress?.(0.25);
        imageUpload = await uploadToStealthCloud(uploadFilePath, serverConfig);
      } else {
        onStatus?.('Uploading to IPFS...');
        onProgress?.(0.25);
        imageUpload = await uploadToArweave(uploadFilePath, 'image/jpeg', {
          'NFT-Owner': ownerAddressStr,
          'Photo-Date': stripExif ? 'Private' : (exifData.dateTaken || 'Unknown'),
        });
      }
      
      if (!imageUpload.success) {
        throw new Error('Image upload failed: ' + imageUpload.error);
      }
      
      console.log(`[NFT] Image uploaded via ${useStealthCloud ? 'StealthCloud' : 'IPFS'}:`, imageUpload.arweaveUrl);
      
      onStatus?.('Building metadata...');
      onProgress?.(0.4);
      
      // Build NFT metadata (Metaplex standard)
      const nftName = name || `PhotoLynk #${Date.now()}`;
      const nftDescription = description || 'Photo NFT minted with PhotoLynk on Solana Seeker';
      
      // Build metadata - exclude EXIF if privacy mode is on
      const metadataExif = stripExif ? null : exifData;
      
      const metadata = buildNFTMetadata({
        name: nftName,
        description: nftDescription,
        imageUrl: imageUpload.arweaveUrl,
        ownerAddress: ownerAddressStr,
        exifData: metadataExif,
        creatorAddress: ownerAddressStr,
      });
      
      // Upload metadata
      const metadataUpload = await uploadMetadataToArweave(metadata);
      if (!metadataUpload.success) {
        throw new Error('Metadata upload failed: ' + metadataUpload.error);
      }
      
      onStatus?.('Creating NFT on Solana...');
      onProgress?.(0.55);
      
      // Metaplex Token Metadata Program ID
      const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
      
      // Generate mint keypair for the NFT
      const mintKeypair = Keypair.generate();
      const mintPubkey = mintKeypair.publicKey;
      
      console.log('[NFT] Mint address:', mintPubkey.toBase58());
      
      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      
      // Calculate rent for mint account
      const mintRent = await connection.getMinimumBalanceForRentExemption(82); // MINT_SIZE = 82
      
      // Derive the associated token account for the owner
      const associatedTokenAccount = PublicKey.findProgramAddressSync(
        [ownerPubkey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      )[0];
      
      // Derive the metadata account PDA
      const metadataAccount = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mintPubkey.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
      )[0];
      
      // Derive the master edition account PDA
      const masterEditionAccount = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          TOKEN_METADATA_PROGRAM_ID.toBuffer(),
          mintPubkey.toBuffer(),
          Buffer.from('edition'),
        ],
        TOKEN_METADATA_PROGRAM_ID
      )[0];
      
      console.log('[NFT] Metadata account:', metadataAccount.toBase58());
      console.log('[NFT] Master edition:', masterEditionAccount.toBase58());
      console.log('[NFT] ATA:', associatedTokenAccount.toBase58());
      
      // Build instructions for NFT creation
      const instructions = [];
      
      // 1. Create mint account
      instructions.push(
        SystemProgram.createAccount({
          fromPubkey: ownerPubkey,
          newAccountPubkey: mintPubkey,
          space: 82, // MINT_SIZE
          lamports: mintRent,
          programId: TOKEN_PROGRAM_ID,
        })
      );
      
      // 2. Initialize mint (0 decimals for NFT, owner as mint authority)
      instructions.push(
        createInitializeMintInstruction(
          mintPubkey,
          0, // 0 decimals for NFT
          ownerPubkey, // mint authority
          ownerPubkey, // freeze authority
          TOKEN_PROGRAM_ID
        )
      );
      
      // 3. Create associated token account
      instructions.push(
        createAssociatedTokenAccountInstruction(
          ownerPubkey, // payer
          associatedTokenAccount, // ata
          ownerPubkey, // owner
          mintPubkey, // mint
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      
      // 4. Mint 1 token to the owner's ATA
      instructions.push(
        createMintToInstruction(
          mintPubkey, // mint
          associatedTokenAccount, // destination
          ownerPubkey, // authority
          1, // amount (1 for NFT)
          [], // multiSigners
          TOKEN_PROGRAM_ID
        )
      );
      
      // 5. Create metadata account (Metaplex Token Metadata instruction)
      const createMetadataInstruction = createMetadataAccountV3Instruction(
        metadataAccount,
        mintPubkey,
        ownerPubkey, // mint authority
        ownerPubkey, // payer
        ownerPubkey, // update authority
        nftName,
        'PLNK', // symbol
        metadataUpload.arweaveUrl,
        500, // seller fee basis points (5%)
        [{ address: ownerPubkey, verified: true, share: 100 }], // creators
        TOKEN_METADATA_PROGRAM_ID
      );
      instructions.push(createMetadataInstruction);
      
      // 6. Create master edition (makes it a true NFT with supply of 1)
      const createMasterEditionInstruction = createMasterEditionV3Instruction(
        masterEditionAccount,
        mintPubkey,
        ownerPubkey, // update authority
        ownerPubkey, // mint authority
        metadataAccount,
        ownerPubkey, // payer
        0, // max supply (0 = unlimited prints, null = no prints)
        TOKEN_METADATA_PROGRAM_ID
      );
      instructions.push(createMasterEditionInstruction);
      
      // 7. App commission transfer
      const commissionLamports = Math.ceil(costEstimate.breakdown.appCommission.sol * LAMPORTS_PER_SOL);
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: ownerPubkey,
          toPubkey: new PublicKey(NFT_COMMISSION_WALLET),
          lamports: commissionLamports,
        })
      );
      
      onStatus?.('Signing transaction...');
      onProgress?.(0.7);
      
      // Create transaction with all instructions
      const messageV0 = new TransactionMessage({
        payerKey: ownerPubkey,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();
      
      const transaction = new VersionedTransaction(messageV0);
      
      // Partially sign with mint keypair (required for createAccount)
      transaction.sign([mintKeypair]);
      
      // Sign and send via wallet
      const signatures = await wallet.signAndSendTransactions({
        transactions: [transaction],
      });
      
      const txSignature = signatures[0];
      
      console.log('[NFT] Transaction signature:', txSignature);
      
      onStatus?.('Confirming transaction...');
      onProgress?.(0.85);
      
      return {
        txSignature,
        mintAddress: mintPubkey.toBase58(),
        ownerAddress: ownerAddressStr,
        imageUrl: imageUpload.arweaveUrl,
        metadataUrl: metadataUpload.arweaveUrl,
        metadata,
        isRealNFT: true,
      };
    });
    
    onStatus?.('NFT minted successfully!');
    onProgress?.(1);
    
    // Copy image to app storage for gallery display
    let localImagePath = null;
    try {
      const nftImagesDir = `${FileSystem.documentDirectory}nft_images/`;
      await FileSystem.makeDirectoryAsync(nftImagesDir, { intermediates: true }).catch(() => {});
      localImagePath = `${nftImagesDir}${result.mintAddress}.jpg`;
      await FileSystem.copyAsync({ from: filePath, to: localImagePath });
    } catch (e) {
      console.log('[NFT] Could not copy image locally:', e.message);
      localImagePath = asset.uri; // Fallback to asset URI
    }
    
    // Save NFT to local storage AND sync to server
    const serverUrl = serverConfig?.baseUrl || null;
    const authHeaders = serverConfig?.headers || null;
    await saveNFTToStorage({
      mintAddress: result.mintAddress,
      ownerAddress: result.ownerAddress,
      name: name || `PhotoLynk #${Date.now()}`,
      description,
      imageUrl: localImagePath || asset.uri, // Use local path for display
      arweaveUrl: result.imageUrl, // Keep Arweave URL for reference
      metadataUrl: result.metadataUrl,
      txSignature: result.txSignature,
      assetId: asset.id,
      createdAt: new Date().toISOString(),
      exifData,
    }, serverUrl, authHeaders);
    
    return {
      success: true,
      mintAddress: result.mintAddress,
      txSignature: result.txSignature,
      imageUrl: result.imageUrl,
      metadataUrl: result.metadataUrl,
      ownerAddress: result.ownerAddress,
    };
  } catch (e) {
    console.error('[NFT] Minting failed:', e);
    onStatus?.('Minting failed');
    return { success: false, error: e.message };
  }
};

// ============================================================================
// NFT TRANSFER
// ============================================================================

/**
 * Resolve domain name (.skr, .sol, or other TLDs) to wallet address
 * .skr is Solana Mobile's Seeker ID (uses AllDomains API)
 * .sol uses Bonfida SNS API
 * @param {string} domain - Domain name (e.g., "alice.skr", "alice.sol", or "alice")
 * @returns {Object} { success, address, error }
 */
export const resolveSolDomain = async (domain) => {
  const trimmed = domain.trim().toLowerCase();
  
  // Determine TLD and clean domain name
  let cleanDomain = trimmed;
  let tld = 'skr'; // Default to .skr for Seeker users
  
  if (trimmed.endsWith('.skr')) {
    cleanDomain = trimmed.replace(/\.skr$/, '');
    tld = 'skr';
  } else if (trimmed.endsWith('.sol')) {
    cleanDomain = trimmed.replace(/\.sol$/, '');
    tld = 'sol';
  }
  
  const fullDomain = `${cleanDomain}.${tld}`;
  console.log(`[NFT] Resolving ${fullDomain}...`);
  
  // For .skr domains, use AllDomains API
  if (tld === 'skr') {
    try {
      // AllDomains API endpoint for resolving domains
      const response = await axios.get(
        `https://api.alldomains.id/domain/${fullDomain}`,
        { timeout: 10000 }
      );
      if (response.data?.owner) {
        console.log(`[NFT] AllDomains API resolved ${fullDomain} to ${response.data.owner}`);
        return { success: true, address: response.data.owner };
      }
    } catch (e) {
      console.log('[NFT] AllDomains API failed:', e.message);
    }
    
    // Try alternative AllDomains endpoint
    try {
      const response = await axios.get(
        `https://sns.alldomains.id/resolve/${fullDomain}`,
        { timeout: 10000 }
      );
      if (response.data?.owner || response.data?.result) {
        const owner = response.data.owner || response.data.result;
        console.log(`[NFT] AllDomains SNS API resolved ${fullDomain} to ${owner}`);
        return { success: true, address: owner };
      }
    } catch (e) {
      console.log('[NFT] AllDomains SNS API failed:', e.message);
    }
  }
  
  // For .sol domains, try Bonfida SNS API
  if (tld === 'sol') {
    try {
      const response = await axios.get(
        `https://sns-sdk-proxy.bonfida.workers.dev/resolve/${cleanDomain}`,
        { timeout: 10000 }
      );
      if (response.data?.result) {
        console.log(`[NFT] Bonfida API resolved ${fullDomain} to ${response.data.result}`);
        return { success: true, address: response.data.result };
      }
    } catch (e) {
      console.log('[NFT] Bonfida API failed:', e.message);
    }
  }
  
  return { success: false, error: `Could not resolve ${fullDomain}` };
};

/**
 * Check if input is a .skr or .sol domain name
 * @param {string} input - Address or domain name
 * @returns {boolean}
 */
export const isSolDomain = (input) => {
  if (!input) return false;
  const trimmed = input.trim().toLowerCase();
  // Check if it ends with .skr, .sol, or looks like a simple domain name
  return trimmed.endsWith('.skr') || trimmed.endsWith('.sol') || /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(trimmed);
};

/**
 * Resolve recipient input to wallet address
 * Handles both direct Solana addresses and .sol domain names
 * @param {string} input - Wallet address or .sol domain
 * @returns {Object} { success, address, isDomain, error }
 */
export const resolveRecipient = async (input) => {
  if (!input?.trim()) {
    return { success: false, error: 'No recipient specified' };
  }
  
  const trimmed = input.trim();
  
  // Check if it's a .sol domain
  if (isSolDomain(trimmed)) {
    const result = await resolveSolDomain(trimmed);
    return { ...result, isDomain: true, domainName: trimmed };
  }
  
  // Try to parse as Solana address
  try {
    const pubkey = new PublicKey(trimmed);
    return { success: true, address: pubkey.toBase58(), isDomain: false };
  } catch (e) {
    return { success: false, error: 'Invalid Solana address or .sol domain' };
  }
};

/**
 * Transfer NFT to another wallet address
 * @param {string} mintAddress - NFT mint address
 * @param {string} recipientInput - Recipient's Solana wallet address or .sol domain
 * @returns {Object} { success, txSignature, recipientAddress, error }
 */
export const transferNFT = async (mintAddress, recipientInput) => {
  if (!solanaAvailable || !splTokenAvailable || !transact || !connection) {
    return { success: false, error: 'Solana or SPL Token not available' };
  }
  
  try {
    // Resolve recipient (handles both addresses and .sol domains)
    const resolved = await resolveRecipient(recipientInput);
    if (!resolved.success) {
      return { success: false, error: resolved.error };
    }
    
    const recipientAddress = resolved.address;
    const recipientPubkey = new PublicKey(recipientAddress);
    const mintPubkey = new PublicKey(mintAddress);
    
    console.log(`[NFT] Transferring ${mintAddress} to ${recipientAddress}${resolved.isDomain ? ` (${resolved.domainName})` : ''}`);
    
    const txSignature = await transact(async (wallet) => {
      const authResult = await wallet.authorize({
        cluster: 'mainnet-beta',
        identity: APP_IDENTITY,
      });
      
      const ownerAddress = authResult.accounts[0].address;
      const ownerBytes = typeof ownerAddress === 'string'
        ? Uint8Array.from(atob(ownerAddress), c => c.charCodeAt(0))
        : new Uint8Array(ownerAddress);
      const ownerPubkey = new PublicKey(ownerBytes);
      
      // Get source token account (owner's ATA for this NFT)
      const sourceATA = await getAssociatedTokenAddress(
        mintPubkey,
        ownerPubkey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      
      // Get destination token account (recipient's ATA for this NFT)
      const destinationATA = await getAssociatedTokenAddress(
        mintPubkey,
        recipientPubkey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      
      const instructions = [];
      
      // Check if destination ATA exists, if not create it
      const destAccountInfo = await connection.getAccountInfo(destinationATA);
      if (!destAccountInfo) {
        // Create ATA for recipient
        instructions.push(
          createAssociatedTokenAccountInstruction(
            ownerPubkey,           // payer
            destinationATA,        // ata
            recipientPubkey,       // owner
            mintPubkey,            // mint
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }
      
      // Add transfer instruction (amount = 1 for NFT)
      // Use createTransferInstruction from @solana/spl-token
      const splToken = require('@solana/spl-token');
      instructions.push(
        splToken.createTransferInstruction(
          sourceATA,              // source
          destinationATA,         // destination
          ownerPubkey,            // owner/authority
          1,                      // amount (1 for NFT)
          [],                     // multiSigners
          TOKEN_PROGRAM_ID
        )
      );
      
      const messageV0 = new TransactionMessage({
        payerKey: ownerPubkey,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();
      
      const transaction = new VersionedTransaction(messageV0);
      
      const signatures = await wallet.signAndSendTransactions({
        transactions: [transaction],
      });
      
      return signatures[0];
    });
    
    // Update local storage
    await removeNFTFromStorage(mintAddress);
    
    console.log(`[NFT] Transfer successful: ${txSignature}`);
    
    return { 
      success: true, 
      txSignature,
      recipientAddress,
      isDomain: resolved.isDomain,
      domainName: resolved.domainName,
    };
  } catch (e) {
    console.error('[NFT] Transfer failed:', e);
    return { success: false, error: e.message };
  }
};

/**
 * Transfer NFT to user by .sol domain name
 * @param {string} mintAddress - NFT mint address
 * @param {string} solDomain - Recipient's .sol domain (e.g., "alice.sol")
 * @returns {Object} { success, txSignature, recipientAddress, domainName, error }
 */
export const transferNFTBySolDomain = async (mintAddress, solDomain) => {
  return transferNFT(mintAddress, solDomain);
};

/**
 * Transfer NFT to user by email (lookup wallet address from server)
 * @param {string} mintAddress - NFT mint address
 * @param {string} recipientEmail - Recipient's email
 * @param {string} authToken - Auth token for server lookup
 * @returns {Object} { success, txSignature, recipientAddress, error }
 */
export const transferNFTByEmail = async (mintAddress, recipientEmail, authToken) => {
  try {
    // Lookup recipient's wallet address from server
    // This requires the recipient to have connected their wallet in the app
    const response = await axios.post('https://stealthlynk.io/api/lookup-wallet', {
      email: recipientEmail,
    }, {
      headers: { Authorization: `Bearer ${authToken}` },
      timeout: 10000,
    });
    
    if (!response.data?.walletAddress) {
      return { success: false, error: 'Recipient wallet not found. They must connect their wallet in PhotoLynk first.' };
    }
    
    const result = await transferNFT(mintAddress, response.data.walletAddress);
    
    return {
      ...result,
      recipientAddress: response.data.walletAddress,
      recipientEmail,
    };
  } catch (e) {
    console.error('[NFT] Transfer by email failed:', e);
    return { success: false, error: e.message };
  }
};

// ============================================================================
// NFT STORAGE (Local + Server Sync)
// ============================================================================

/**
 * Save NFT to local storage AND sync to server
 */
export const saveNFTToStorage = async (nftData, serverUrl = null, authHeaders = null) => {
  try {
    // Save locally first
    const existing = await getStoredNFTs();
    existing.push(nftData);
    await saveNFTsToFile(existing);
    
    // Sync to server if available (for persistence across reinstalls)
    if (serverUrl && authHeaders) {
      try {
        await axios.post(`${serverUrl}/api/nft/sync`, {
          action: 'add',
          nft: nftData,
        }, {
          headers: authHeaders,
          timeout: 10000,
        });
        console.log('[NFT] Synced to server:', nftData.mintAddress);
      } catch (syncErr) {
        console.log('[NFT] Server sync failed (will retry later):', syncErr.message);
      }
    }
  } catch (e) {
    console.error('[NFT] Failed to save NFT:', e);
  }
};

/**
 * Get all stored NFTs (local) - uses FileSystem for unlimited storage
 */
export const getStoredNFTs = async () => {
  try {
    // Check if file exists
    const fileInfo = await FileSystem.getInfoAsync(NFT_STORAGE_FILE);
    if (!fileInfo.exists) {
      // One-time migration from SecureStore (if any data exists there)
      try {
        const legacyData = await SecureStore.getItemAsync(NFT_STORAGE_KEY);
        if (legacyData) {
          const nfts = JSON.parse(legacyData);
          await FileSystem.writeAsStringAsync(NFT_STORAGE_FILE, legacyData);
          await SecureStore.deleteItemAsync(NFT_STORAGE_KEY);
          console.log('[NFT] Migrated', nfts.length, 'NFTs from SecureStore to FileSystem');
          return nfts;
        }
      } catch (migrationErr) {
        // SecureStore may not have data, that's fine
      }
      return [];
    }
    const stored = await FileSystem.readAsStringAsync(NFT_STORAGE_FILE);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    console.error('[NFT] Failed to get NFTs:', e);
    return [];
  }
};

/**
 * Save NFTs array to FileSystem
 */
const saveNFTsToFile = async (nfts) => {
  await FileSystem.writeAsStringAsync(NFT_STORAGE_FILE, JSON.stringify(nfts));
};

/**
 * Sync NFTs from server (restores NFTs after reinstall)
 * @param {string} serverUrl - Server base URL
 * @param {Object} authHeaders - Auth headers
 * @returns {Object} { success, nfts, merged, error }
 */
export const syncNFTsFromServer = async (serverUrl, authHeaders) => {
  try {
    console.log('[NFT] Syncing NFTs from server...');
    
    // Get NFTs from server
    const response = await axios.get(`${serverUrl}/api/nft/list`, {
      headers: authHeaders,
      timeout: 15000,
    });
    
    const serverNFTs = response.data?.nfts || [];
    console.log(`[NFT] Server has ${serverNFTs.length} NFTs`);
    
    if (serverNFTs.length === 0) {
      return { success: true, nfts: await getStoredNFTs(), merged: 0 };
    }
    
    // Get local NFTs
    const localNFTs = await getStoredNFTs();
    const localMints = new Set(localNFTs.map(n => n.mintAddress));
    
    // Merge: add server NFTs that aren't local
    let merged = 0;
    for (const serverNFT of serverNFTs) {
      if (!localMints.has(serverNFT.mintAddress)) {
        localNFTs.push(serverNFT);
        merged++;
      }
    }
    
    // Save merged list
    if (merged > 0) {
      await saveNFTsToFile(localNFTs);
      console.log(`[NFT] Merged ${merged} NFTs from server`);
    }
    
    return { success: true, nfts: localNFTs, merged };
  } catch (e) {
    console.error('[NFT] Server sync failed:', e.message);
    return { success: false, error: e.message, nfts: await getStoredNFTs(), merged: 0 };
  }
};

/**
 * Push all local NFTs to server (backup)
 */
export const backupNFTsToServer = async (serverUrl, authHeaders) => {
  try {
    const localNFTs = await getStoredNFTs();
    if (localNFTs.length === 0) {
      return { success: true, backed: 0 };
    }
    
    const response = await axios.post(`${serverUrl}/api/nft/sync`, {
      action: 'backup',
      nfts: localNFTs,
    }, {
      headers: authHeaders,
      timeout: 15000,
    });
    
    console.log(`[NFT] Backed up ${localNFTs.length} NFTs to server`);
    return { success: true, backed: localNFTs.length };
  } catch (e) {
    console.error('[NFT] Backup failed:', e.message);
    return { success: false, error: e.message };
  }
};

/**
 * Remove NFT from local storage AND server
 */
export const removeNFTFromStorage = async (mintAddress, serverUrl = null, authHeaders = null) => {
  try {
    const existing = await getStoredNFTs();
    const filtered = existing.filter(nft => nft.mintAddress !== mintAddress);
    await saveNFTsToFile(filtered);
    
    // Sync removal to server
    if (serverUrl && authHeaders) {
      try {
        await axios.post(`${serverUrl}/api/nft/sync`, {
          action: 'remove',
          mintAddress,
        }, {
          headers: authHeaders,
          timeout: 10000,
        });
      } catch (syncErr) {
        console.log('[NFT] Server sync removal failed:', syncErr.message);
      }
    }
  } catch (e) {
    console.error('[NFT] Failed to remove NFT:', e);
  }
};

/**
 * Clear all stored NFTs (for testing/debugging)
 */
export const clearAllStoredNFTs = async () => {
  try {
    await FileSystem.deleteAsync(NFT_STORAGE_FILE, { idempotent: true });
    // Also clear legacy SecureStore if it exists
    try { await SecureStore.deleteItemAsync(NFT_STORAGE_KEY); } catch (e) {}
    console.log('[NFT] Cleared all stored NFTs');
    return { success: true };
  } catch (e) {
    console.error('[NFT] Failed to clear NFTs:', e);
    return { success: false, error: e.message };
  }
};

/**
 * Get NFT by mint address
 */
export const getNFTByMintAddress = async (mintAddress) => {
  const nfts = await getStoredNFTs();
  return nfts.find(nft => nft.mintAddress === mintAddress);
};

// ============================================================================
// BLOCKCHAIN VERIFICATION
// ============================================================================

/**
 * Get Solana Explorer URL for transaction
 */
export const getExplorerUrl = (txSignature, type = 'tx') => {
  const base = 'https://explorer.solana.com';
  return `${base}/${type}/${txSignature}?cluster=mainnet-beta`;
};

/**
 * Get Solscan URL for NFT
 */
export const getSolscanUrl = (mintAddress) => {
  return `https://solscan.io/token/${mintAddress}`;
};

/**
 * Verify NFT exists on-chain
 */
export const verifyNFTOnChain = async (mintAddress) => {
  // Initialize connection if not available
  if (!connection) {
    await initializeNFT();
  }
  
  if (!connection) {
    return { verified: false, error: 'Could not connect to Solana' };
  }
  
  try {
    const mintPubkey = new PublicKey(mintAddress);
    const accountInfo = await connection.getAccountInfo(mintPubkey);
    
    return {
      verified: !!accountInfo,
      exists: !!accountInfo,
      owner: accountInfo?.owner?.toBase58(),
    };
  } catch (e) {
    return { verified: false, error: e.message };
  }
};

// ============================================================================
// NFT DISCOVERY (Fetch NFTs from blockchain)
// ============================================================================

/**
 * Fetch all NFTs owned by a wallet address from the blockchain
 * Uses Solana RPC directly to get token accounts
 * @param {string} walletAddress - Owner's wallet address
 * @returns {Object} { success, nfts, error }
 */
export const fetchNFTsFromBlockchain = async (walletAddress) => {
  if (!walletAddress) {
    return { success: false, error: 'No wallet address provided' };
  }
  
  console.log(`[NFT] Fetching NFTs for wallet: ${walletAddress}`);
  
  // Initialize connection if not available
  if (!connection) {
    console.log('[NFT] Connection not available, initializing...');
    await initializeNFT();
  }
  
  if (!connection) {
    console.log('[NFT] ERROR: Could not initialize Solana connection');
    return { success: false, error: 'Could not initialize Solana connection' };
  }
  
  console.log('[NFT] Connection available, creating pubkey...');
  
  try {
    const ownerPubkey = new PublicKey(walletAddress);
    console.log(`[NFT] Owner pubkey created: ${ownerPubkey.toBase58()}`);
    
    // Get all token accounts owned by this wallet
    console.log('[NFT] Fetching token accounts from RPC...');
    let tokenAccounts;
    try {
      tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        ownerPubkey,
        { programId: TOKEN_PROGRAM_ID }
      );
    } catch (rpcErr) {
      console.error('[NFT] RPC error:', rpcErr.message);
      return { success: false, error: `RPC error: ${rpcErr.message}` };
    }
    
    console.log(`[NFT] Found ${tokenAccounts.value.length} token accounts`);
    
    // Filter for NFTs (amount = 1, decimals = 0)
    const nftAccounts = tokenAccounts.value.filter(account => {
      const info = account.account.data.parsed.info;
      return info.tokenAmount.amount === '1' && info.tokenAmount.decimals === 0;
    });
    
    console.log(`[NFT] Found ${nftAccounts.length} potential NFTs`);
    
    if (nftAccounts.length === 0) {
      return { success: true, nfts: [] };
    }
    
    // Fetch metadata for each NFT
    const nfts = [];
    for (const account of nftAccounts) {
      const mintAddress = account.account.data.parsed.info.mint;
      console.log(`[NFT] Fetching metadata for: ${mintAddress}`);
      
      try {
        const metadata = await fetchNFTMetadata(mintAddress);
        if (metadata && metadata.name) {
          nfts.push({
            mintAddress,
            name: metadata.name || 'Unknown NFT',
            description: metadata.description || '',
            imageUrl: metadata.image || '',
            metadataUrl: metadata.uri || '',
            ownerAddress: walletAddress,
            createdAt: new Date().toISOString(),
            source: 'rpc',
          });
          console.log(`[NFT] Found: ${metadata.name}`);
        }
      } catch (e) {
        console.log(`[NFT] Failed to fetch metadata for ${mintAddress}:`, e.message);
      }
    }
    
    console.log(`[NFT] Successfully fetched ${nfts.length} NFTs`);
    return { success: true, nfts };
  } catch (e) {
    console.error('[NFT] Fetch NFTs failed:', e);
    return { success: false, error: e.message };
  }
};

/**
 * Fetch NFT metadata from Metaplex
 * @param {string} mintAddress - NFT mint address
 * @returns {Object|null} Metadata object or null
 */
export const fetchNFTMetadata = async (mintAddress) => {
  if (!connection) return null;
  
  try {
    const mintPubkey = new PublicKey(mintAddress);
    
    // Derive metadata PDA
    const metadataAccount = PublicKey.findProgramAddressSync(
      [
        Buffer.from('metadata'),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mintPubkey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    )[0];
    
    const accountInfo = await connection.getAccountInfo(metadataAccount);
    if (!accountInfo) return null;
    
    // Parse metadata (simplified - just get the URI)
    const data = accountInfo.data;
    // Skip to name (after key byte and update authority)
    let offset = 1 + 32 + 32; // key + updateAuthority + mint
    
    // Read name length and name
    const nameLen = data.readUInt32LE(offset);
    offset += 4;
    const name = data.slice(offset, offset + nameLen).toString('utf8').replace(/\0/g, '');
    offset += nameLen;
    
    // Read symbol length and symbol
    const symbolLen = data.readUInt32LE(offset);
    offset += 4;
    offset += symbolLen; // Skip symbol
    
    // Read URI length and URI
    const uriLen = data.readUInt32LE(offset);
    offset += 4;
    const uri = data.slice(offset, offset + uriLen).toString('utf8').replace(/\0/g, '');
    
    // Fetch JSON metadata from URI
    if (uri) {
      try {
        console.log(`[NFT] Fetching JSON from: ${uri}`);
        const response = await axios.get(uri, { timeout: 10000 });
        const imageUrl = response.data?.image || '';
        console.log(`[NFT] Image URL: ${imageUrl || '(empty)'}`);
        return {
          name: response.data?.name || name,
          description: response.data?.description || '',
          image: imageUrl,
          uri,
        };
      } catch (e) {
        console.log(`[NFT] JSON fetch failed: ${e.message}`);
        return { name, uri };
      }
    }
    
    return { name, uri };
  } catch (e) {
    console.log(`[NFT] Metadata fetch failed for ${mintAddress}:`, e.message);
    return null;
  }
};

/**
 * Discover and import NFTs from blockchain to local storage
 * @param {string} walletAddress - Owner's wallet address
 * @param {string} serverUrl - Server URL for sync
 * @param {Object} authHeaders - Auth headers for server
 * @returns {Object} { success, imported, total, error }
 */
export const discoverAndImportNFTs = async (walletAddress, serverUrl = null, authHeaders = null) => {
  console.log('[NFT] discoverAndImportNFTs called for:', walletAddress);
  const result = await fetchNFTsFromBlockchain(walletAddress);
  console.log('[NFT] fetchNFTsFromBlockchain result:', result.success, result.error || `${result.nfts?.length} NFTs`);
  
  if (!result.success) {
    return { success: false, error: result.error, imported: 0, total: 0 };
  }
  
  const existingNFTs = await getStoredNFTs();
  const existingMints = new Set(existingNFTs.map(n => n.mintAddress));
  
  let imported = 0;
  for (const nft of result.nfts) {
    if (!existingMints.has(nft.mintAddress)) {
      await saveNFTToStorage(nft, serverUrl, authHeaders);
      imported++;
    }
  }
  
  console.log(`[NFT] Imported ${imported} new NFTs out of ${result.nfts.length} found`);
  
  return { 
    success: true, 
    imported, 
    total: result.nfts.length,
    nfts: result.nfts,
  };
};

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  initializeNFT,
  fetchSolPrice,
  usdToSol,
  extractExifForNFT,
  estimateArweaveUploadCost,
  uploadToArweave,
  buildNFTMetadata,
  uploadMetadataToArweave,
  estimateNFTMintCost,
  mintPhotoNFT,
  transferNFT,
  transferNFTByEmail,
  transferNFTBySolDomain,
  resolveSolDomain,
  resolveRecipient,
  isSolDomain,
  saveNFTToStorage,
  getStoredNFTs,
  syncNFTsFromServer,
  backupNFTsToServer,
  removeNFTFromStorage,
  clearAllStoredNFTs,
  getNFTByMintAddress,
  getExplorerUrl,
  getSolscanUrl,
  verifyNFTOnChain,
  fetchNFTsFromBlockchain,
  fetchNFTMetadata,
  discoverAndImportNFTs,
  NFT_FEES,
  NFT_COMMISSION_WALLET,
};
