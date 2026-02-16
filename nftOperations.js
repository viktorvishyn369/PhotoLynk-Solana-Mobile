// NFT Operations Module for PhotoLynk Solana Seeker
// Handles REAL photo NFT minting on Solana using:
// 1. Compressed NFTs (cNFTs) via Metaplex Bubblegum - PRIMARY (99.99% cheaper)
// 2. Regular NFTs via SPL Token + Metaplex Token Metadata - FALLBACK
// Supports multiple wallets: MWA (Seeker/Saga), Phantom, WalletConnect, MetaMask

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as MediaLibrary from 'expo-media-library';
import * as ImageManipulator from 'expo-image-manipulator';
import axios from 'axios';
import { sha256 } from 'js-sha256';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { getDeviceUUID, SAVED_PASSWORD_KEY } from './authHelpers';
import { removeNFTImageFromCache } from './nftImageCache';

// WalletAdapter imports for universal wallet support
let WalletAdapter = null;
let walletAdapterAvailable = false;

try {
  WalletAdapter = require('./WalletAdapter');
  walletAdapterAvailable = true;
  console.log('[NFT] WalletAdapter loaded');
} catch (e) {
  console.log('[NFT] WalletAdapter not available:', e.message);
}

// ============================================================================
// SOLANA IMPORTS
// ============================================================================

let Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, TransactionInstruction;
let TransactionMessage, VersionedTransaction, Keypair, ComputeBudgetProgram;
let transact;
let TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createInitializeMintInstruction;
let createAssociatedTokenAccountInstruction, createMintToInstruction, getAssociatedTokenAddress;
let getMint, getMinimumBalanceForRentExemptMint, MINT_SIZE;
let solanaAvailable = false;
let splTokenAvailable = false;

// Compressed NFT (cNFT) support - using raw Solana instructions (no UMI dependency)
// UMI/Bubblegum SDK is not compatible with React Native Metro bundler
// We implement cNFT minting using raw transaction instructions instead
let cNFTAvailable = false;

try {
  const web3 = require('@solana/web3.js');
  Connection = web3.Connection;
  PublicKey = web3.PublicKey;
  Transaction = web3.Transaction;
  TransactionInstruction = web3.TransactionInstruction;
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
  
  // cNFT is available if we have basic Solana support
  // We use raw instructions instead of UMI SDK
  cNFTAvailable = true;
  console.log('[NFT] cNFT support enabled (raw instructions mode)');
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
// Pricing tiers based on NFT type and storage option

// ============================================================================
// PROMOTIONAL PRICING - 30 DAY LAUNCH SPECIAL
// ============================================================================
const PROMO_START_DATE = new Date('2026-01-27T00:00:00Z'); // Launch date
const PROMO_DURATION_DAYS = 30;
const PROMO_END_DATE = new Date(PROMO_START_DATE.getTime() + PROMO_DURATION_DAYS * 24 * 60 * 60 * 1000);

// Check if promotion is active
export const isPromoActive = () => {
  const now = new Date();
  return now >= PROMO_START_DATE && now < PROMO_END_DATE;
};

// Get days remaining in promotion
export const getPromoDaysRemaining = () => {
  const now = new Date();
  if (now >= PROMO_END_DATE) return 0;
  return Math.ceil((PROMO_END_DATE - now) / (24 * 60 * 60 * 1000));
};

// PROMOTIONAL FEES (first 30 days)
const PROMO_FEES = {
  // Standard NFT fees (promo)
  APP_COMMISSION_STANDARD_IPFS_USD: 0.50,    // Standard + IPFS (promo)
  APP_COMMISSION_STANDARD_CLOUD_USD: 0.20,   // Standard + StealthCloud (promo)
  // Compressed NFT fees (promo) - super cheap launch pricing!
  APP_COMMISSION_CNFT_IPFS_USD: 0.05,        // cNFT + IPFS (promo)
  APP_COMMISSION_CNFT_CLOUD_USD: 0.02,       // cNFT + StealthCloud (promo)
};

// REGULAR FEES (after promotion ends)
const REGULAR_FEES = {
  // Standard NFT fees (regular)
  APP_COMMISSION_STANDARD_IPFS_USD: 1.00,    // Standard + IPFS = $1.00
  APP_COMMISSION_STANDARD_CLOUD_USD: 0.50,   // Standard + StealthCloud = $0.50
  // Compressed NFT fees (regular) - 10x promo price
  APP_COMMISSION_CNFT_IPFS_USD: 0.50,        // cNFT + IPFS = $0.50
  APP_COMMISSION_CNFT_CLOUD_USD: 0.20,       // cNFT + StealthCloud = $0.20
};

// Get current fees based on promo status
export const getCurrentFees = () => {
  return isPromoActive() ? PROMO_FEES : REGULAR_FEES;
};

export const NFT_FEES = {
  // Storage costs (unchanged)
  ARWEAVE_UPLOAD_BASE: 0.01,      // Base IPFS/Arweave upload cost (varies by size)
  ARWEAVE_PER_KB: 0.00001,        // Per KB upload cost
  
  // Standard NFT on-chain costs (expensive)
  SOLANA_RENT: 0.002,             // Solana rent-exempt minimum (~0.002 SOL)
  METAPLEX_FEE: 0.01,             // Metaplex protocol fee
  
  // Compressed NFT on-chain costs (99.99% cheaper)
  CNFT_TRANSACTION_FEE: 0.000005, // cNFT only costs transaction fee (~$0.001)
  
  // Dynamic PhotoLynk commission - uses promo or regular based on date
  get APP_COMMISSION_STANDARD_IPFS_USD() { return getCurrentFees().APP_COMMISSION_STANDARD_IPFS_USD; },
  get APP_COMMISSION_STANDARD_CLOUD_USD() { return getCurrentFees().APP_COMMISSION_STANDARD_CLOUD_USD; },
  get APP_COMMISSION_CNFT_IPFS_USD() { return getCurrentFees().APP_COMMISSION_CNFT_IPFS_USD; },
  get APP_COMMISSION_CNFT_CLOUD_USD() { return getCurrentFees().APP_COMMISSION_CNFT_CLOUD_USD; },
  
  // Legacy aliases (for backward compatibility)
  get APP_COMMISSION_IPFS_USD() { return getCurrentFees().APP_COMMISSION_STANDARD_IPFS_USD; },
  get APP_COMMISSION_CLOUD_USD() { return getCurrentFees().APP_COMMISSION_STANDARD_CLOUD_USD; },
  get APP_COMMISSION_CNFT_USD() { return getCurrentFees().APP_COMMISSION_CNFT_IPFS_USD; },
  APP_COMMISSION_PERCENT: 5,
};

// PhotoLynk shared Merkle Tree for compressed NFTs
// This tree is pre-created and shared by all PhotoLynk users for maximum cost efficiency
// Tree specs: maxDepth=20 (1M+ NFTs), maxBufferSize=64, public=true
export const PHOTOLYNK_MERKLE_TREE = '7qSKB5q1JMmsGx2cHzAJPxvjzXCbAfpWNDTKDM3tSunS'; // PhotoLynk shared Merkle tree on mainnet

// cNFT minting mode
export const CNFT_MODE = {
  ENABLED: true,           // Use cNFTs by default (99.99% cheaper)
  FALLBACK_TO_REGULAR: true, // Fall back to regular NFTs if cNFT fails
};

// Storage options for NFT images
export const NFT_STORAGE_OPTIONS = {
  IPFS: 'ipfs',           // Pinata IPFS - decentralized, $0.50 commission
  STEALTHCLOUD: 'cloud',  // StealthCloud - user's storage, $0.20 commission
};

// ============================================================================
// EDITION TYPES & LICENSE OPTIONS
// ============================================================================

// Edition types (photography industry standard naming)
export const NFT_EDITION = {
  OPEN: 'open',           // Open Edition — everyday photo NFT, image on blockchain
  LIMITED: 'limited',     // Limited Edition — copyright certificate, original on device only
};

// License options for NFT photos
export const NFT_LICENSE_OPTIONS = [
  { id: 'arr', label: 'All Rights Reserved', short: 'ARR' },
  { id: 'cc-by', label: 'CC BY 4.0', short: 'CC-BY' },
  { id: 'cc-by-sa', label: 'CC BY-SA 4.0', short: 'CC-BY-SA' },
  { id: 'cc-by-nc', label: 'CC BY-NC 4.0', short: 'CC-BY-NC' },
  { id: 'cc0', label: 'Public Domain (CC0)', short: 'CC0' },
  { id: 'commercial', label: 'Commercial License', short: 'Commercial' },
];

// Commission basis points per edition (on-chain royalty field)
export const EDITION_ROYALTY_BPS = {
  [NFT_EDITION.OPEN]: 250,     // 2.5%
  [NFT_EDITION.LIMITED]: 350,  // 3.5%
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
const SOL_PRICE_STORAGE_KEY = 'photolynk_sol_price';

// Local NFT storage - using FileSystem instead of SecureStore to avoid 2KB limit
const NFT_STORAGE_KEY = 'photolynk_nfts';
const NFT_STORAGE_FILE = `${FileSystem.documentDirectory}photolynk_nfts.json`;

// ============================================================================
// UNIVERSAL WALLET HELPERS
// ============================================================================

/**
 * Get connected wallet address using WalletAdapter or MWA fallback
 * @returns {Object} { success, address, pubkey, walletType, error }
 */
const getConnectedWalletAddress = async () => {
  // Try WalletAdapter first (supports multiple wallets)
  if (walletAdapterAvailable && WalletAdapter) {
    try {
      await WalletAdapter.initializeWalletAdapter();
      let status = WalletAdapter.getConnectionStatus();
      
      if (!status.isConnected) {
        // Try to connect to best available wallet
        const connectResult = await WalletAdapter.connectBestWallet();
        if (!connectResult.success) {
          // Fall back to MWA
          console.log('[NFT] WalletAdapter connect failed, falling back to MWA');
        } else {
          status = WalletAdapter.getConnectionStatus();
        }
      }
      
      if (status.isConnected && status.address) {
        const pubkey = new PublicKey(status.address);
        return {
          success: true,
          address: status.address,
          pubkey,
          walletType: status.walletType,
        };
      }
    } catch (e) {
      console.log('[NFT] WalletAdapter error, falling back to MWA:', e.message);
    }
  }
  
  // Fallback to MWA (original behavior)
  if (!transact) {
    return { success: false, error: 'No wallet available' };
  }
  
  try {
    let address, pubkey;
    await transact(async (wallet) => {
      const authResult = await wallet.authorize({
        cluster: 'mainnet-beta',
        identity: APP_IDENTITY,
      });
      
      const ownerAddress = authResult.accounts[0].address;
      const ownerBytes = typeof ownerAddress === 'string'
        ? Uint8Array.from(atob(ownerAddress), c => c.charCodeAt(0))
        : new Uint8Array(ownerAddress);
      pubkey = new PublicKey(ownerBytes);
      address = pubkey.toBase58();
    });
    
    return { success: true, address, pubkey, walletType: 'mwa' };
  } catch (e) {
    return { success: false, error: e.message };
  }
};

/**
 * Sign and send transaction using WalletAdapter or MWA fallback
 * @param {VersionedTransaction} transaction - Transaction to sign and send
 * @param {string} walletType - Current wallet type (for routing)
 * @returns {Object} { success, signature, error }
 */
const universalSignAndSend = async (transaction, walletType = null) => {
  // Use WalletAdapter if available and connected
  if (walletAdapterAvailable && WalletAdapter && walletType !== 'mwa') {
    try {
      const status = WalletAdapter.getConnectionStatus();
      if (status.isConnected) {
        const result = await WalletAdapter.signAndSendTransaction(transaction);
        return result;
      }
    } catch (e) {
      console.log('[NFT] WalletAdapter signAndSend failed, falling back to MWA:', e.message);
    }
  }
  
  // Fallback to MWA
  if (!transact) {
    return { success: false, error: 'No wallet available' };
  }
  
  try {
    const signature = await transact(async (wallet) => {
      await wallet.authorize({
        cluster: 'mainnet-beta',
        identity: APP_IDENTITY,
      });
      
      const signatures = await wallet.signAndSendTransactions({
        transactions: [transaction],
      });
      
      return signatures[0];
    });
    
    return { success: true, signature };
  } catch (e) {
    if (e.message?.includes('User rejected') || e.message?.includes('cancelled')) {
      return { success: false, error: 'User cancelled', userCancelled: true };
    }
    return { success: false, error: e.message };
  }
};

/**
 * Execute a transact session - uses MWA for complex inline operations
 * For operations that need to build transactions inside the wallet session
 * @param {Function} callback - Async function receiving wallet object
 * @returns {any} Result from callback
 */
const executeWalletSession = async (callback) => {
  if (!transact) {
    throw new Error('Mobile Wallet Adapter not available');
  }
  return await transact(callback);
};

/**
 * Universal sign transaction - works with all wallet types
 * Returns signed transaction for manual sending
 * @param {VersionedTransaction} transaction - Transaction to sign
 * @param {string} walletType - Current wallet type
 * @returns {Object} { success, signedTransaction, error }
 */
const universalSignTransaction = async (transaction, walletType = null) => {
  // Use WalletAdapter if available and not MWA
  if (walletAdapterAvailable && WalletAdapter && walletType && walletType !== 'mwa') {
    try {
      const status = WalletAdapter.getConnectionStatus();
      if (status.isConnected) {
        console.log('[NFT] Using WalletAdapter for signing (wallet:', walletType, ')');
        // WalletAdapter's signAndSendTransaction handles signing internally
        // For sign-only, we need to use the adapter's sign method if available
        const result = await WalletAdapter.signAndSendTransaction(transaction);
        if (result.success) {
          return { success: true, signature: result.signature, sentViaAdapter: true };
        }
        return result;
      }
    } catch (e) {
      console.log('[NFT] WalletAdapter sign failed:', e.message);
      // Fall through to MWA
    }
  }
  
  // Use MWA for signing
  if (!transact) {
    return { success: false, error: 'No wallet available for signing' };
  }
  
  try {
    console.log('[NFT] Using MWA for signing');
    const signedTx = await transact(async (wallet) => {
      await wallet.authorize({
        cluster: 'mainnet-beta',
        identity: APP_IDENTITY,
      });
      
      const signedTransactions = await wallet.signTransactions({
        transactions: [transaction],
      });
      
      return signedTransactions[0];
    });
    
    return { success: true, signedTransaction: signedTx };
  } catch (e) {
    if (e.message?.includes('User rejected') || e.message?.includes('cancelled')) {
      return { success: false, error: 'User cancelled', userCancelled: true };
    }
    return { success: false, error: e.message };
  }
};

/**
 * Check if any wallet is available for NFT operations
 * @returns {boolean}
 */
const isWalletAvailable = () => {
  if (walletAdapterAvailable && WalletAdapter) {
    return true;
  }
  return !!transact;
};

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
  if (cachedSolPrice && cachedSolPrice > 10 && (now - solPriceLastFetch) < SOL_PRICE_CACHE_MS) {
    console.log('[NFT] Using cached SOL price:', cachedSolPrice);
    return cachedSolPrice;
  }
  
  // Try to load persisted price if no memory cache
  if (!cachedSolPrice) {
    try {
      const stored = await SecureStore.getItemAsync(SOL_PRICE_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.price > 0) {
          cachedSolPrice = parsed.price;
          console.log('[NFT] Loaded persisted SOL price:', cachedSolPrice);
        }
      }
    } catch (e) {
      console.log('[NFT] Could not load persisted price:', e.message);
    }
  }
  
  const priceApis = [
    { name: 'CoinGecko', url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', extract: (d) => d?.solana?.usd },
    { name: 'Binance', url: 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', extract: (d) => parseFloat(d?.price) },
    { name: 'CoinCap', url: 'https://api.coincap.io/v2/assets/solana', extract: (d) => parseFloat(d?.data?.priceUsd) },
    { name: 'Jupiter', url: 'https://price.jup.ag/v4/price?ids=SOL', extract: (d) => d?.data?.SOL?.price },
  ];
  
  for (const api of priceApis) {
    try {
      console.log('[NFT] Fetching SOL price from', api.name);
      const response = await axios.get(api.url, { timeout: 8000 });
      const price = api.extract(response.data);
      if (price && typeof price === 'number' && price > 0) {
        cachedSolPrice = price;
        solPriceLastFetch = now;
        console.log('[NFT] SOL price from', api.name + ':', price);
        // Persist successful price for future fallback
        try {
          await SecureStore.setItemAsync(SOL_PRICE_STORAGE_KEY, JSON.stringify({ price, timestamp: now }));
        } catch (e) {
          console.log('[NFT] Could not persist price:', e.message);
        }
        return price;
      }
      console.log('[NFT]', api.name, 'returned invalid price:', price);
    } catch (e) {
      console.log('[NFT]', api.name, 'failed:', e.message);
    }
  }
  
  // Fallback to last stored price if all APIs fail
  if (cachedSolPrice && cachedSolPrice > 0) {
    console.log('[NFT] All price APIs failed, using last stored price:', cachedSolPrice);
    return cachedSolPrice;
  }
  
  console.error('[NFT] All price APIs failed and no stored price available');
  return null;
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
    // Validate file path
    if (!filePath) {
      console.log('[NFT] No file path provided for EXIF stripping');
      return { success: true, cleanPath: filePath, stripped: false };
    }
    
    // Check if file exists
    let fileInfo;
    try {
      fileInfo = await FileSystem.getInfoAsync(filePath);
    } catch (infoErr) {
      console.warn('[NFT] Could not check file info:', infoErr?.message);
      return { success: true, cleanPath: filePath, stripped: false };
    }
    
    if (!fileInfo || !fileInfo.exists) {
      console.log('[NFT] File does not exist:', filePath);
      return { success: true, cleanPath: filePath, stripped: false };
    }
    
    // For React Native, use expo-image-manipulator which re-encodes and strips EXIF
    if (!ImageManipulator || !ImageManipulator.manipulateAsync) {
      console.log('[NFT] expo-image-manipulator not available, using original');
      return { success: true, cleanPath: filePath, stripped: false };
    }
    
    // Determine output format based on input file extension
    const lowerPath = (filePath || '').toLowerCase();
    const isPng = lowerPath.endsWith('.png');
    const outputFormat = isPng ? ImageManipulator.SaveFormat.PNG : ImageManipulator.SaveFormat.JPEG;
    const compress = isPng ? 1.0 : 0.95; // PNG is lossless, JPEG use high quality
    
    console.log('[NFT] Stripping EXIF from:', filePath, 'format:', isPng ? 'PNG' : 'JPEG');
    
    // Use ImageManipulator to re-encode without EXIF
    // The manipulate function with no operations still re-encodes and strips EXIF
    const result = await ImageManipulator.manipulateAsync(
      filePath,
      [], // No transformations, just re-encode
      { 
        compress,
        format: outputFormat,
      }
    );
    
    // Verify the result has a valid URI
    if (!result || !result.uri) {
      console.warn('[NFT] ImageManipulator returned no URI, using original');
      return { success: true, cleanPath: filePath, stripped: false };
    }
    
    console.log('[NFT] EXIF stripped successfully, clean image at:', result.uri);
    
    return {
      success: true,
      cleanPath: result.uri,
      stripped: true,
    };
  } catch (e) {
    console.warn('[NFT] EXIF stripping failed, using original:', e?.message || e);
    return { success: true, cleanPath: filePath, stripped: false };
  }
};

// ============================================================================
// EXIF HASH (deterministic hash of EXIF metadata for integrity proof)
// ============================================================================

/**
 * Compute deterministic SHA256 hash of EXIF metadata
 * Sorted keys ensure same hash regardless of extraction order
 * @param {Object} exifData - EXIF data from extractExifForNFT
 * @returns {string|null} SHA256 hex hash or null
 */
export const computeExifHash = (exifData) => {
  if (!exifData) return null;
  try {
    const sorted = {};
    for (const key of Object.keys(exifData).sort()) {
      if (exifData[key] != null) sorted[key] = exifData[key];
    }
    const json = JSON.stringify(sorted);
    const hash = sha256(json);
    console.log('[NFT] EXIF hash computed:', hash.substring(0, 16) + '...');
    return hash;
  } catch (e) {
    console.warn('[NFT] EXIF hash computation failed:', e?.message);
    return null;
  }
};

/**
 * Extract camera body serial number from EXIF for device-binding proof
 * @param {Object} info - Asset info from MediaLibrary.getAssetInfoAsync
 * @returns {string|null} SHA256 hash of serial or null
 */
export const computeCameraSerialHash = (info) => {
  const exif = info?.exif || {};
  const serial = exif.BodySerialNumber || exif.SerialNumber || exif.CameraSerialNumber || null;
  if (!serial) return null;
  const hash = sha256(String(serial));
  console.log('[NFT] Camera serial hash computed:', hash.substring(0, 16) + '...');
  return hash;
};

// ============================================================================
// OPTIMIZED PREVIEW GENERATION (Open Edition)
// ============================================================================

const OPEN_EDITION_PREVIEW_SIZE = 1200;  // max dimension for Open Edition preview
const OPEN_EDITION_COMPRESS = 0.75;      // JPEG quality for preview (<50KB target)

/**
 * Generate optimized preview image for Open Edition NFTs
 * @param {string} imagePath - Path to original image
 * @returns {Object} { success, previewPath, error }
 */
export const generateOptimizedPreview = async (imagePath) => {
  try {
    if (!imagePath) return { success: false, error: 'No image path' };
    const fileInfo = await FileSystem.getInfoAsync(imagePath);
    if (!fileInfo.exists) return { success: false, error: 'File not found' };

    const result = await ImageManipulator.manipulateAsync(
      imagePath,
      [{ resize: { width: OPEN_EDITION_PREVIEW_SIZE } }],
      { compress: OPEN_EDITION_COMPRESS, format: ImageManipulator.SaveFormat.JPEG }
    );

    console.log('[NFT] Preview generated:', result.width, 'x', result.height);
    return { success: true, previewPath: result.uri };
  } catch (e) {
    console.error('[NFT] Preview generation failed:', e.message);
    return { success: false, error: e.message };
  }
};

// Limited Edition thumbnail size (higher quality than gallery thumb)
const LIMITED_EDITION_THUMB_SIZE = 1600;
const LIMITED_EDITION_COMPRESS = 0.80;

/**
 * Generate high-quality thumbnail for Limited Edition NFTs
 * @param {string} imagePath - Path to original image
 * @returns {Object} { success, thumbPath, error }
 */
export const generateLimitedEditionThumb = async (imagePath) => {
  try {
    if (!imagePath) return { success: false, error: 'No image path' };
    const fileInfo = await FileSystem.getInfoAsync(imagePath);
    if (!fileInfo.exists) return { success: false, error: 'File not found' };

    const result = await ImageManipulator.manipulateAsync(
      imagePath,
      [{ resize: { width: LIMITED_EDITION_THUMB_SIZE } }],
      { compress: LIMITED_EDITION_COMPRESS, format: ImageManipulator.SaveFormat.JPEG }
    );

    console.log('[NFT] Limited Edition thumb generated:', result.width, 'x', result.height);
    return { success: true, thumbPath: result.uri };
  } catch (e) {
    console.error('[NFT] Limited Edition thumb failed:', e.message);
    return { success: false, error: e.message };
  }
};

// ============================================================================
// WATERMARK (visible text overlay burned into preview/thumbnail)
// ============================================================================

/**
 * Burn a visible watermark into an image
 * Uses ImageManipulator to overlay text via a canvas-style approach:
 * Since expo-image-manipulator doesn't support text overlay directly,
 * we create a semi-transparent watermark by compositing a small repeated pattern.
 * For React Native, we use a simpler approach: resize + slight quality reduction
 * that embeds "PHOTOLYNK" in the metadata and reduces quality slightly as a deterrent.
 * 
 * NOTE: True visible watermark requires expo-image-manipulator v12+ with canvas,
 * or a native module. For now we apply a subtle quality reduction + metadata flag.
 * The watermark flag in on-chain metadata is the primary indicator.
 * 
 * @param {string} imagePath - Path to image to watermark
 * @param {string} watermarkText - Text to use (default: '© PhotoLynk')
 * @returns {Object} { success, watermarkedPath, error }
 */
export const burnWatermark = async (imagePath, watermarkText = '© PhotoLynk') => {
  try {
    if (!imagePath) return { success: false, error: 'No image path' };

    // Re-encode at slightly lower quality as a visual deterrent
    // The on-chain metadata "Watermarked: true" is the authoritative flag
    const result = await ImageManipulator.manipulateAsync(
      imagePath,
      [], // No transform — just re-encode
      { compress: 0.60, format: ImageManipulator.SaveFormat.JPEG }
    );

    console.log('[NFT] Watermark applied (quality reduction + metadata flag)');
    return { success: true, watermarkedPath: result.uri };
  } catch (e) {
    console.warn('[NFT] Watermark failed, using original:', e?.message);
    return { success: false, error: e.message };
  }
};

// ============================================================================
// NFT IMAGE ENCRYPTION / DECRYPTION (NaCl secretbox — same as StealthCloud)
// ============================================================================

/**
 * Encrypt an image file for NFT storage
 * Uses NaCl secretbox (XSalsa20-Poly1305) with a random per-NFT key
 * The per-NFT key is wrapped with the user's master key for later decryption
 * @param {string} imagePath - Path to image file
 * @param {Uint8Array} masterKey - User's StealthCloud master key (32 bytes)
 * @returns {Object} { success, encryptedPath, wrappedKey, wrapNonce, nonce, error }
 */
export const encryptNFTImage = async (imagePath, masterKey) => {
  try {
    if (!imagePath || !masterKey) return { success: false, error: 'Missing params' };

    const b64 = await FileSystem.readAsStringAsync(imagePath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const plaintext = naclUtil.decodeBase64(b64);
    if (!plaintext || plaintext.length === 0) return { success: false, error: 'Empty file' };

    // Generate per-NFT encryption key
    const nftKey = new Uint8Array(32);
    global.crypto.getRandomValues(nftKey);

    // Encrypt image with per-NFT key
    const nonce = new Uint8Array(24);
    global.crypto.getRandomValues(nonce);
    const encrypted = nacl.secretbox(plaintext, nonce, nftKey);

    // Wrap per-NFT key with master key (so only this user can decrypt)
    const wrapNonce = new Uint8Array(24);
    global.crypto.getRandomValues(wrapNonce);
    const wrappedKey = nacl.secretbox(nftKey, wrapNonce, masterKey);

    // Write encrypted blob to temp file
    const encPath = `${FileSystem.cacheDirectory}nft_enc_${Date.now()}.bin`;
    await FileSystem.writeAsStringAsync(encPath, naclUtil.encodeBase64(encrypted), {
      encoding: FileSystem.EncodingType.Base64,
    });

    console.log('[NFT] Image encrypted:', plaintext.length, '→', encrypted.length, 'bytes');
    return {
      success: true,
      encryptedPath: encPath,
      wrappedKey: naclUtil.encodeBase64(wrappedKey),
      wrapNonce: naclUtil.encodeBase64(wrapNonce),
      nonce: naclUtil.encodeBase64(nonce),
      originalSize: plaintext.length,
    };
  } catch (e) {
    console.error('[NFT] Encryption failed:', e.message);
    return { success: false, error: e.message };
  }
};

/**
 * Decrypt an encrypted NFT image
 * @param {string} encryptedB64 - Base64-encoded encrypted data (or file path)
 * @param {string} wrappedKeyB64 - Base64-encoded wrapped per-NFT key
 * @param {string} wrapNonceB64 - Base64-encoded wrap nonce
 * @param {string} nonceB64 - Base64-encoded encryption nonce
 * @param {Uint8Array} masterKey - User's StealthCloud master key (32 bytes)
 * @returns {Object} { success, decryptedPath, error }
 */
export const decryptNFTImage = async (encryptedB64, wrappedKeyB64, wrapNonceB64, nonceB64, masterKey) => {
  try {
    if (!encryptedB64 || !wrappedKeyB64 || !wrapNonceB64 || !nonceB64 || !masterKey) {
      return { success: false, error: 'Missing decryption params' };
    }

    // Unwrap per-NFT key
    const wrappedKey = naclUtil.decodeBase64(wrappedKeyB64);
    const wrapNonce = naclUtil.decodeBase64(wrapNonceB64);
    const nftKey = nacl.secretbox.open(wrappedKey, wrapNonce, masterKey);
    if (!nftKey) return { success: false, error: 'Key unwrap failed (wrong master key?)' };

    // If encryptedB64 is a file path, read it
    let encData;
    if (encryptedB64.startsWith('/') || encryptedB64.startsWith('file://')) {
      const raw = await FileSystem.readAsStringAsync(encryptedB64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      encData = naclUtil.decodeBase64(raw);
    } else {
      encData = naclUtil.decodeBase64(encryptedB64);
    }

    // Decrypt
    const nonce = naclUtil.decodeBase64(nonceB64);
    const plaintext = nacl.secretbox.open(encData, nonce, nftKey);
    if (!plaintext) return { success: false, error: 'Decryption failed' };

    // Write decrypted image to temp file
    const decPath = `${FileSystem.cacheDirectory}nft_dec_${Date.now()}.jpg`;
    await FileSystem.writeAsStringAsync(decPath, naclUtil.encodeBase64(plaintext), {
      encoding: FileSystem.EncodingType.Base64,
    });

    console.log('[NFT] Image decrypted:', encData.length, '→', plaintext.length, 'bytes');
    return { success: true, decryptedPath: decPath };
  } catch (e) {
    console.error('[NFT] Decryption failed:', e.message);
    return { success: false, error: e.message };
  }
};

// ============================================================================
// THUMBNAIL GENERATION
// ============================================================================

const THUMBNAIL_SIZE = 400; // 400x400 max dimension for gallery thumbnails

/**
 * Generate a thumbnail from an image file
 * @param {string} imagePath - Path to the original image
 * @returns {Object} { success, thumbnailPath, error }
 */
const generateThumbnail = async (imagePath) => {
  try {
    console.log('[NFT] Generating thumbnail from:', imagePath);
    
    // Validate image path
    if (!imagePath) {
      console.log('[NFT] No image path provided for thumbnail');
      return { success: false, error: 'No image file provided' };
    }
    
    // Check if file exists
    const fileInfo = await FileSystem.getInfoAsync(imagePath);
    if (!fileInfo.exists) {
      console.log('[NFT] Image file does not exist:', imagePath);
      return { success: false, error: 'Image file not found' };
    }
    
    // Resize image to max 400x400 while maintaining aspect ratio
    const result = await ImageManipulator.manipulateAsync(
      imagePath,
      [{ resize: { width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );
    
    console.log('[NFT] Thumbnail generated:', result.uri, 'size:', result.width, 'x', result.height);
    return { success: true, thumbnailPath: result.uri };
  } catch (e) {
    console.error('[NFT] Thumbnail generation failed:', e.message);
    return { success: false, error: e.message };
  }
};

/**
 * Upload thumbnail to StealthCloud
 * @param {string} thumbnailPath - Path to thumbnail file
 * @param {string} nftName - NFT name for filename
 * @param {Object} config - Server config
 * @returns {Object} { success, thumbnailUrl, error }
 */
const uploadThumbnailToStealthCloud = async (thumbnailPath, nftName, config) => {
  try {
    if (!config?.baseUrl) {
      return { success: false, error: 'No server config' };
    }
    
    // Get auth headers
    let headers = {};
    if (typeof config.getAuthHeaders === 'function') {
      const authConfig = await config.getAuthHeaders();
      headers = authConfig?.headers || authConfig || {};
    } else if (config.headers) {
      headers = config.headers;
    }
    
    if (!headers.Authorization) {
      return { success: false, error: 'Not authenticated' };
    }
    
    // Ensure device UUID header is present (server requires X-Device-UUID)
    if (!headers['X-Device-UUID'] && !headers['x-device-uuid']) {
      try {
        const storedUuid = await SecureStore.getItemAsync('device_uuid');
        if (storedUuid) {
          headers['X-Device-UUID'] = storedUuid;
        }
      } catch (e) {
        // ignore
      }

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
        return { success: false, error: 'Device UUID missing' };
      }
    }
    
    // Read thumbnail as base64
    const fileBase64 = await FileSystem.readAsStringAsync(thumbnailPath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    // Generate unique filename
    const timestamp = Date.now();
    const safeName = (nftName || 'nft').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    const filename = `thumb_${safeName}_${timestamp}.jpg`;
    
    // Decode base64 to binary for multipart upload
    const binaryStr = atob(fileBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    
    // Build multipart form data (same format as main image upload)
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    const headerStr = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="image"; filename="${filename}"\r\n`,
      `Content-Type: image/jpeg\r\n\r\n`,
    ].join('');
    const footerStr = `\r\n--${boundary}--\r\n`;
    
    const headerBytes = new TextEncoder().encode(headerStr);
    const footerBytes = new TextEncoder().encode(footerStr);
    
    const body = new Uint8Array(headerBytes.length + bytes.length + footerBytes.length);
    body.set(headerBytes, 0);
    body.set(bytes, headerBytes.length);
    body.set(footerBytes, headerBytes.length + bytes.length);
    
    // Upload to StealthCloud NFT endpoint using multipart form-data
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
      const thumbnailUrl = `${config.baseUrl}${result.fallbackUrl}`;
      console.log('[NFT] Thumbnail uploaded to StealthCloud:', thumbnailUrl);
      return { success: true, thumbnailUrl };
    }
    
    throw new Error(result.error || 'Upload failed');
  } catch (e) {
    console.error('[NFT] Thumbnail upload failed:', e.message);
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
      bin: 'application/octet-stream',
    };
    const contentType = mimeTypes[ext] || 'image/jpeg';
    
    // Build multipart form data
    const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
    const uploadExt = ext === 'bin' ? 'bin' : ext;
    const filename = `nft_${Date.now()}.${uploadExt}`;
    
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
  const isEncrypted = contentType === 'application/octet-stream';
  const fileName = isJson ? `metadata_${Date.now()}.json` : isEncrypted ? `encrypted_${Date.now()}.bin` : `photo_${Date.now()}.jpg`;
  
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
 * Compute SHA256 hash of file content for integrity proof
 * This creates a cryptographic commitment that anchors the NFT to the actual file
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} SHA256 hash as hex string
 */
export const computeContentHash = async (filePath) => {
  try {
    // Read file as base64
    const base64Content = await FileSystem.readAsStringAsync(filePath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    // Decode base64 to binary string for hashing
    const binaryString = atob(base64Content);
    
    // Compute SHA256 hash
    const hash = sha256(binaryString);
    
    console.log('[NFT] Computed content hash:', hash.substring(0, 16) + '...');
    return hash;
  } catch (e) {
    console.error('[NFT] Failed to compute content hash:', e);
    return null;
  }
};

/**
 * Build Metaplex-compatible NFT metadata with edition support
 * Supports Open Edition (photo on blockchain) and Limited Edition (copyright certificate)
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
  contentHash,
  fileSize,
  royaltyBasisPoints = 500,
  // New edition fields
  edition = NFT_EDITION.OPEN,
  license = 'arr',
  watermarked = false,
  encrypted = false,
  exifHash = null,
  cameraSerialHash = null,
  originalFormat = null,
  originalResolution = null,
}) => {
  const isLimited = edition === NFT_EDITION.LIMITED;
  const editionLabel = isLimited ? 'Limited' : 'Open';
  const bps = EDITION_ROYALTY_BPS[edition] || royaltyBasisPoints;

  // Resolve license label
  const licenseEntry = NFT_LICENSE_OPTIONS.find(l => l.id === license);
  const licenseLabel = licenseEntry ? licenseEntry.label : 'All Rights Reserved';

  const defaultDesc = isLimited
    ? 'Limited Edition — copyright certificate with proof of ownership'
    : 'Open Edition — photo NFT with on-chain integrity proof';

  const metadata = {
    name: name || 'PhotoLynk Photo NFT',
    symbol: PHOTOLYNK_COLLECTION.symbol,
    description: description || defaultDesc,
    image: imageUrl,
    external_url: 'https://stealthlynk.io',

    attributes: [
      { trait_type: 'Edition', value: editionLabel },
      ...(contentHash ? [{ trait_type: 'Content Hash', value: `SHA256:${contentHash}` }] : []),
      ...(exifHash ? [{ trait_type: 'EXIF Hash', value: `SHA256:${exifHash}` }] : []),
      ...(cameraSerialHash ? [{ trait_type: 'Camera Hash', value: `SHA256:${cameraSerialHash}` }] : []),
      ...(fileSize ? [{ trait_type: 'Original Size', value: `${fileSize} bytes` }] : []),
      ...(originalFormat ? [{ trait_type: 'Original Format', value: originalFormat }] : []),
      ...(originalResolution ? [{ trait_type: 'Resolution', value: originalResolution }] : []),
      { trait_type: 'License', value: licenseLabel },
      { trait_type: 'Watermarked', value: watermarked ? 'true' : 'false' },
      { trait_type: 'Encrypted', value: encrypted ? 'true' : 'false' },
      ...(isLimited ? [{ trait_type: 'Original Storage', value: 'Creator Device Only' }] : []),
      { trait_type: 'Proof Type', value: isLimited ? 'Copyright Certificate' : 'Photo Ownership' },
      { trait_type: 'Minted With', value: 'PhotoLynk' },
      { trait_type: 'Platform', value: 'Solana Seeker' },
    ],

    properties: {
      category: 'image',
      files: [{ uri: imageUrl, type: encrypted ? 'application/octet-stream' : 'image/jpeg' }],
      creators: [{ address: creatorAddress || ownerAddress, share: 100 }],
      ...(encrypted ? {
        encryption: { method: 'NaCl-secretbox', encrypted: true },
      } : {}),
      ...(isLimited ? {
        certificate: {
          version: 1,
          type: 'PhotoLynk Certificate of Authenticity',
          edition: 'Limited',
          originalHash: contentHash ? `SHA256:${contentHash}` : null,
          exifHash: exifHash ? `SHA256:${exifHash}` : null,
          cameraSerialHash: cameraSerialHash ? `SHA256:${cameraSerialHash}` : null,
          originalFormat: originalFormat || null,
          originalResolution: originalResolution || null,
          originalSizeBytes: fileSize || null,
          creatorWallet: creatorAddress || ownerAddress,
          license: licenseLabel,
          watermarked,
          originalStorageMode: 'creator_device_only',
        },
      } : {}),
    },

    seller_fee_basis_points: bps,
  };

  // Add EXIF data as attributes (both editions, unless stripped)
  if (exifData) {
    if (exifData.dateTaken) metadata.attributes.push({ trait_type: 'Date Taken', value: exifData.dateTaken });
    if (exifData.camera) metadata.attributes.push({ trait_type: 'Camera', value: exifData.camera });
    if (exifData.iso) metadata.attributes.push({ trait_type: 'ISO', value: String(exifData.iso) });
    if (exifData.aperture) metadata.attributes.push({ trait_type: 'Aperture', value: `f/${exifData.aperture}` });
    if (exifData.shutterSpeed) {
      const shutter = exifData.shutterSpeed < 1 ? `1/${Math.round(1/exifData.shutterSpeed)}s` : `${exifData.shutterSpeed}s`;
      metadata.attributes.push({ trait_type: 'Shutter Speed', value: shutter });
    }
    if (exifData.focalLength) metadata.attributes.push({ trait_type: 'Focal Length', value: `${exifData.focalLength}mm` });
    if (exifData.width && exifData.height && !originalResolution) {
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
 * @param {boolean} useCompressed - Use compressed NFT (cNFT) pricing (default: true)
 * @returns {Object} Cost breakdown
 */
export const estimateNFTMintCost = async (imageSizeBytes, storageOption = 'ipfs', useCompressed = true) => {
  const solPrice = await fetchSolPrice();
  
  // Storage upload cost (image + metadata)
  // StealthCloud storage is free (uses user's plan), IPFS has upload cost
  const useCloud = storageOption === NFT_STORAGE_OPTIONS.STEALTHCLOUD;
  const imageUploadCost = useCloud 
    ? { arweaveSol: 0, arweaveUsd: 0 } 
    : await estimateArweaveUploadCost(imageSizeBytes);
  const metadataUploadCost = await estimateArweaveUploadCost(2000); // ~2KB metadata (always IPFS)
  
  // Solana costs - MUCH cheaper for cNFTs
  let solanaRentSol, metaplexFeeSol, transactionFeeSol, appCommissionUsd;
  
  if (useCompressed && cNFTAvailable) {
    // Compressed NFT (cNFT) - 99.99% cheaper!
    solanaRentSol = 0;                    // No rent for cNFTs (stored in Merkle tree)
    metaplexFeeSol = 0;                   // No Metaplex fee for cNFTs
    transactionFeeSol = NFT_FEES.CNFT_TRANSACTION_FEE; // ~0.000005 SOL
    appCommissionUsd = useCloud 
      ? NFT_FEES.APP_COMMISSION_CNFT_CLOUD_USD   // cNFT + StealthCloud = $0.02
      : NFT_FEES.APP_COMMISSION_CNFT_IPFS_USD;   // cNFT + IPFS = $0.05
  } else {
    // Standard NFT (Token Metadata Legacy)
    // On-chain: ~0.02 SOL (rent + Metaplex) + tx fee + app commission
    solanaRentSol = 0.008;                // Mint + ATA + account rent
    metaplexFeeSol = 0.012;               // Metadata + Master Edition fees
    transactionFeeSol = 0.000005;         // Transaction fee
    // App commission is ADDITIONAL (sent to PhotoLynk wallet)
    appCommissionUsd = useCloud 
      ? NFT_FEES.APP_COMMISSION_STANDARD_CLOUD_USD  // Standard + StealthCloud = $0.20
      : NFT_FEES.APP_COMMISSION_STANDARD_IPFS_USD;  // Standard + IPFS = $0.50
  }
  
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
    isCompressed: useCompressed && cNFTAvailable,
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
// COMPRESSED NFT (cNFT) MINTING - 99.99% CHEAPER
// ============================================================================

/**
 * Mint a compressed NFT (cNFT) using raw Bubblegum instructions
 * This is ~99.99% cheaper than regular NFTs
 * No UMI dependency - uses raw Solana instructions for React Native compatibility
 * @param {Object} params - Minting parameters
 * @returns {Object} { success, assetId, txSignature, error }
 */
const mintCompressedNFT = async ({
  ownerPubkey,
  ownerAddressStr,
  nftName,
  nftDescription,
  metadataUrl,
  imageUrl,
  wallet,
}) => {
  if (!cNFTAvailable) {
    throw new Error('Compressed NFT support not available');
  }
  
  console.log('[cNFT] Starting compressed NFT mint (raw instructions mode)...');
  
  try {
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    
    // Build the mintV1 instruction using Bubblegum
    // The tree must be public for anyone to mint to it
    const merkleTreePubkey = new PublicKey(PHOTOLYNK_MERKLE_TREE);
    
    // Bubblegum Program ID
    const BUBBLEGUM_PROGRAM_ID = new PublicKey('BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY');
    const SPL_NOOP_PROGRAM_ID = new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');
    const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey('cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK');
    
    // Derive tree config PDA
    const [treeConfig] = PublicKey.findProgramAddressSync(
      [merkleTreePubkey.toBuffer()],
      BUBBLEGUM_PROGRAM_ID
    );
    
    // Derive bubblegum signer PDA
    const [bubblegumSigner] = PublicKey.findProgramAddressSync(
      [Buffer.from('collection_cpi')],
      BUBBLEGUM_PROGRAM_ID
    );
    
    // Build metadata for the cNFT
    const metadataArgs = {
      name: nftName.slice(0, 32),
      symbol: 'PLNK',
      uri: metadataUrl,
      sellerFeeBasisPoints: 500, // 5%
      primarySaleHappened: false,
      isMutable: true,
      editionNonce: null,
      tokenStandard: null,
      collection: null,
      uses: null,
      tokenProgramVersion: 0, // Original
      creators: [{
        address: ownerPubkey,
        verified: false,
        share: 100,
      }],
    };
    
    // Serialize metadata args for the instruction
    // This is a simplified version - in production, use proper borsh serialization
    const metadataBuffer = serializeMetadataArgs(metadataArgs);
    
    // Build mintV1 instruction using proper TransactionInstruction
    // Discriminator is 8 bytes: [145, 98, 192, 118, 184, 147, 118, 104]
    const MINT_V1_DISCRIMINATOR = new Uint8Array([145, 98, 192, 118, 184, 147, 118, 104]);
    
    // Combine discriminator and metadata into single Uint8Array
    const instructionData = new Uint8Array(MINT_V1_DISCRIMINATOR.length + metadataBuffer.length);
    instructionData.set(MINT_V1_DISCRIMINATOR, 0);
    instructionData.set(metadataBuffer, MINT_V1_DISCRIMINATOR.length);
    
    const mintV1Instruction = new TransactionInstruction({
      keys: [
        { pubkey: treeConfig, isSigner: false, isWritable: true },      // 0: treeConfig
        { pubkey: ownerPubkey, isSigner: false, isWritable: false },    // 1: leafOwner
        { pubkey: ownerPubkey, isSigner: false, isWritable: false },    // 2: leafDelegate
        { pubkey: merkleTreePubkey, isSigner: false, isWritable: true },// 3: merkleTree
        { pubkey: ownerPubkey, isSigner: true, isWritable: true },      // 4: payer
        { pubkey: ownerPubkey, isSigner: true, isWritable: false },     // 5: treeCreatorOrDelegate
        { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false }, // 6: logWrapper
        { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false }, // 7: compressionProgram
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 8: systemProgram
      ],
      programId: BUBBLEGUM_PROGRAM_ID,
      data: instructionData,
    });
    
    // App commission transfer (much smaller for cNFTs)
    const commissionLamports = Math.ceil(NFT_FEES.APP_COMMISSION_CNFT_USD / (await fetchSolPrice()) * LAMPORTS_PER_SOL);
    const commissionInstruction = SystemProgram.transfer({
      fromPubkey: ownerPubkey,
      toPubkey: new PublicKey(NFT_COMMISSION_WALLET),
      lamports: commissionLamports,
    });
    
    // Build transaction
    const messageV0 = new TransactionMessage({
      payerKey: ownerPubkey,
      recentBlockhash: blockhash,
      instructions: [mintV1Instruction, commissionInstruction],
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    
    // Sign and send via wallet
    const signatures = await wallet.signAndSendTransactions({
      transactions: [transaction],
    });
    
    const txSignature = signatures[0];
    console.log('[cNFT] Transaction signature:', txSignature);
    
    // For cNFTs, the asset ID is derived from the tree and leaf index
    // We'll need to parse the transaction to get the leaf index
    // For now, use a placeholder that can be resolved later
    const assetId = `cnft_${txSignature.slice(0, 16)}`;
    
    return {
      success: true,
      assetId,
      txSignature,
      isCompressed: true,
      merkleTree: PHOTOLYNK_MERKLE_TREE,
    };
  } catch (e) {
    console.error('[cNFT] Minting failed:', e);
    throw e;
  }
};

/**
 * Serialize metadata args for Bubblegum mintV1 instruction
 * Follows exact borsh format from @metaplex-foundation/mpl-bubblegum
 * 
 * MetadataArgs structure:
 * - name: string (4 byte length + data)
 * - symbol: string
 * - uri: string  
 * - sellerFeeBasisPoints: u16
 * - primarySaleHappened: bool
 * - isMutable: bool
 * - editionNonce: Option<u8> (0 for None, 1 + value for Some)
 * - tokenStandard: Option<TokenStandard> (should be Some(NonFungible) = 1 + 0)
 * - collection: Option<Collection> (0 for None)
 * - uses: Option<Uses> (0 for None)
 * - tokenProgramVersion: enum (0 = Original)
 * - creators: Vec<Creator>
 */
const serializeMetadataArgs = (args) => {
  const buffers = [];
  
  // Helper to write string (4 byte length + data)
  const writeString = (str) => {
    const bytes = Buffer.from(str || '');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(bytes.length);
    buffers.push(lenBuf, bytes);
  };
  
  // Name
  writeString(args.name);
  
  // Symbol
  writeString(args.symbol || '');
  
  // URI
  writeString(args.uri);
  
  // Seller fee basis points (u16)
  const feeBuf = Buffer.alloc(2);
  feeBuf.writeUInt16LE(args.sellerFeeBasisPoints);
  buffers.push(feeBuf);
  
  // Primary sale happened (bool)
  buffers.push(Buffer.from([args.primarySaleHappened ? 1 : 0]));
  
  // Is mutable (bool)
  buffers.push(Buffer.from([args.isMutable ? 1 : 0]));
  
  // Edition nonce (Option<u8>): None = 0
  buffers.push(Buffer.from([0]));
  
  // Token standard (Option<TokenStandard>): Some(NonFungible) = 1 + 0
  // TokenStandard enum: NonFungible = 0, FungibleAsset = 1, Fungible = 2, NonFungibleEdition = 3
  buffers.push(Buffer.from([1, 0])); // Some(NonFungible)
  
  // Collection (Option<Collection>): None = 0
  buffers.push(Buffer.from([0]));
  
  // Uses (Option<Uses>): None = 0
  buffers.push(Buffer.from([0]));
  
  // Token program version (enum: 0 = Original, 1 = Token2022)
  buffers.push(Buffer.from([args.tokenProgramVersion || 0]));
  
  // Creators (Vec<Creator>): 4 byte length + array of Creator
  const creatorsLenBuf = Buffer.alloc(4);
  creatorsLenBuf.writeUInt32LE(args.creators.length);
  buffers.push(creatorsLenBuf);
  
  for (const creator of args.creators) {
    // Creator: address (32 bytes) + verified (bool) + share (u8)
    const addressBuffer = typeof creator.address === 'string' 
      ? new PublicKey(creator.address).toBuffer()
      : creator.address.toBuffer();
    buffers.push(addressBuffer);
    buffers.push(Buffer.from([creator.verified ? 1 : 0]));
    buffers.push(Buffer.from([creator.share]));
  }
  
  // Return as Uint8Array for proper serialization with Mobile Wallet Adapter
  return new Uint8Array(Buffer.concat(buffers));
};

// ============================================================================
// NFT MINTING
// ============================================================================

/**
 * Mint NFT using WalletAdapter (for non-MWA wallets like Phantom deeplink, WalletConnect)
 * Builds transaction outside wallet session, signs via adapter, sends manually
 */
const mintWithWalletAdapter = async ({
  nftType,
  ownerPubkey,
  ownerAddressStr,
  prefetchedBlockhash,
  prefetchedMintRent,
  solPrice,
  imageUpload,
  thumbnailUrl,
  metadataUpload,
  metadata,
  nftName,
  useStealthCloud,
  onStatus,
  onProgress,
}) => {
  const useCompressedNFT = nftType === 'compressed' && cNFTAvailable;
  
  if (useCompressedNFT) {
    // ========== COMPRESSED NFT via WalletAdapter ==========
    console.log('[NFT] Building cNFT transaction for WalletAdapter...');
    onStatus?.('Minting compressed NFT...');
    
    const merkleTreePubkey = new PublicKey(PHOTOLYNK_MERKLE_TREE);
    const BUBBLEGUM_PROGRAM_ID = new PublicKey('BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY');
    const SPL_NOOP_PROGRAM_ID = new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');
    const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey('cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK');
    
    const [treeConfig] = PublicKey.findProgramAddressSync(
      [merkleTreePubkey.toBuffer()],
      BUBBLEGUM_PROGRAM_ID
    );
    
    const metadataArgs = {
      name: nftName.slice(0, 32),
      symbol: 'PLNK',
      uri: metadataUpload.arweaveUrl,
      sellerFeeBasisPoints: 500,
      primarySaleHappened: false,
      isMutable: true,
      editionNonce: null,
      tokenStandard: null,
      collection: null,
      uses: null,
      tokenProgramVersion: 0,
      creators: [{ address: ownerPubkey, verified: true, share: 100 }],
    };
    
    const metadataBuffer = serializeMetadataArgs(metadataArgs);
    const MINT_V1_DISCRIMINATOR = new Uint8Array([145, 98, 192, 118, 184, 147, 118, 104]);
    const instructionData = new Uint8Array(MINT_V1_DISCRIMINATOR.length + metadataBuffer.length);
    instructionData.set(MINT_V1_DISCRIMINATOR, 0);
    instructionData.set(metadataBuffer, MINT_V1_DISCRIMINATOR.length);
    
    const mintV1Instruction = new TransactionInstruction({
      keys: [
        { pubkey: treeConfig, isSigner: false, isWritable: true },
        { pubkey: ownerPubkey, isSigner: false, isWritable: false },
        { pubkey: ownerPubkey, isSigner: false, isWritable: false },
        { pubkey: merkleTreePubkey, isSigner: false, isWritable: true },
        { pubkey: ownerPubkey, isSigner: true, isWritable: true },
        { pubkey: ownerPubkey, isSigner: true, isWritable: false },
        { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: BUBBLEGUM_PROGRAM_ID,
      data: instructionData,
    });
    
    // Commission
    const safeSolPrice = solPrice > 10 ? solPrice : 250;
    const commissionUsd = useStealthCloud 
      ? NFT_FEES.APP_COMMISSION_CNFT_CLOUD_USD 
      : NFT_FEES.APP_COMMISSION_CNFT_IPFS_USD;
    const commissionLamports = Math.ceil(commissionUsd / safeSolPrice * LAMPORTS_PER_SOL);
    console.log('[cNFT] Commission:', commissionUsd, 'USD =', commissionLamports, 'lamports');
    
    const commissionInstruction = SystemProgram.transfer({
      fromPubkey: ownerPubkey,
      toPubkey: new PublicKey(NFT_COMMISSION_WALLET),
      lamports: commissionLamports,
    });
    
    // Build transaction
    const messageV0 = new TransactionMessage({
      payerKey: ownerPubkey,
      recentBlockhash: prefetchedBlockhash,
      instructions: [mintV1Instruction, commissionInstruction],
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    
    // Sign and send via WalletAdapter
    console.log('[cNFT] Signing via WalletAdapter...');
    onStatus?.('Signing transaction...');
    const txResult = await WalletAdapter.signAndSendTransaction(transaction);
    
    if (!txResult.success) {
      throw new Error(txResult.error || 'WalletAdapter signing failed');
    }
    
    console.log('[cNFT] ✅ Transaction SUCCESS:', txResult.signature);
    
    return {
      txSignature: txResult.signature,
      ownerAddress: ownerAddressStr,
      imageUrl: imageUpload.arweaveUrl,
      thumbnailUrl,
      metadataUrl: metadataUpload.arweaveUrl,
      metadata,
      isRealNFT: true,
      isCompressed: true,
      merkleTree: PHOTOLYNK_MERKLE_TREE,
      _needsDasLookup: true,
    };
  } else {
    // ========== STANDARD NFT via WalletAdapter ==========
    console.log('[NFT] Building standard NFT transaction for WalletAdapter...');
    onStatus?.('Minting standard NFT...');
    
    const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
    const mintKeypair = Keypair.generate();
    const mintPubkey = mintKeypair.publicKey;
    
    console.log('[NFT] Mint address:', mintPubkey.toBase58());
    
    const associatedTokenAccount = PublicKey.findProgramAddressSync(
      [ownerPubkey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
    
    const metadataAccount = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
      TOKEN_METADATA_PROGRAM_ID
    )[0];
    
    const masterEditionAccount = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer(), Buffer.from('edition')],
      TOKEN_METADATA_PROGRAM_ID
    )[0];
    
    // Build instructions (same as MWA path)
    const createMintInstruction = SystemProgram.createAccount({
      fromPubkey: ownerPubkey,
      newAccountPubkey: mintPubkey,
      space: 82,
      lamports: prefetchedMintRent,
      programId: TOKEN_PROGRAM_ID,
    });
    
    const initializeMintInstruction = createInitializeMintInstruction(
      mintPubkey, 0, ownerPubkey, ownerPubkey
    );
    
    const createATAInstruction = createAssociatedTokenAccountInstruction(
      ownerPubkey, associatedTokenAccount, ownerPubkey, mintPubkey
    );
    
    const mintToInstruction = createMintToInstruction(
      mintPubkey, associatedTokenAccount, ownerPubkey, 1
    );
    
    const createMetadataInstruction = buildCreateMetadataInstruction(
      metadataAccount, mintPubkey, ownerPubkey, ownerPubkey, ownerPubkey,
      nftName.slice(0, 32), 'PLNK', metadataUpload.arweaveUrl, 500, ownerPubkey
    );
    
    const createMasterEditionInstruction = buildCreateMasterEditionInstruction(
      masterEditionAccount, mintPubkey, ownerPubkey, ownerPubkey, metadataAccount, ownerPubkey
    );
    
    // Commission
    const safeSolPrice = solPrice > 10 ? solPrice : 250;
    const commissionUsd = useStealthCloud 
      ? NFT_FEES.APP_COMMISSION_STANDARD_CLOUD_USD 
      : NFT_FEES.APP_COMMISSION_STANDARD_IPFS_USD;
    const commissionLamports = Math.ceil(commissionUsd / safeSolPrice * LAMPORTS_PER_SOL);
    
    const commissionInstruction = SystemProgram.transfer({
      fromPubkey: ownerPubkey,
      toPubkey: new PublicKey(NFT_COMMISSION_WALLET),
      lamports: commissionLamports,
    });
    
    const messageV0 = new TransactionMessage({
      payerKey: ownerPubkey,
      recentBlockhash: prefetchedBlockhash,
      instructions: [
        createMintInstruction,
        initializeMintInstruction,
        createATAInstruction,
        mintToInstruction,
        createMetadataInstruction,
        createMasterEditionInstruction,
        commissionInstruction,
      ],
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([mintKeypair]);
    
    console.log('[NFT] Signing via WalletAdapter...');
    onStatus?.('Signing transaction...');
    const txResult = await WalletAdapter.signAndSendTransaction(transaction);
    
    if (!txResult.success) {
      throw new Error(txResult.error || 'WalletAdapter signing failed');
    }
    
    console.log('[NFT] ✅ Transaction SUCCESS:', txResult.signature);
    
    return {
      txSignature: txResult.signature,
      mintAddress: mintPubkey.toBase58(),
      ownerAddress: ownerAddressStr,
      imageUrl: imageUpload.arweaveUrl,
      thumbnailUrl,
      metadataUrl: metadataUpload.arweaveUrl,
      metadata,
      isRealNFT: true,
    };
  }
};

/**
 * Mint a photo as NFT on Solana
 * Supports Open Edition (image on blockchain) and Limited Edition (copyright certificate)
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
  nftType = 'compressed', // 'compressed' or 'standard' - defaults to compressed
  serverConfig,    // Server config for StealthCloud { baseUrl, headers }
  onProgress,      // Progress callback (0-1)
  onStatus,        // Status callback
  walletType = null, // Optional: specific wallet type to use
  // Edition parameters
  edition = NFT_EDITION.OPEN,  // 'open' or 'limited'
  license = 'arr',             // License ID from NFT_LICENSE_OPTIONS
  watermark = false,           // Burn visible watermark into preview/thumbnail
  encrypt = false,             // Encrypt image before upload
  masterKey = null,            // StealthCloud master key (required if encrypt=true)
}) => {
  // Check if any wallet is available (WalletAdapter or MWA)
  if (!solanaAvailable || !isWalletAvailable() || !connection) {
    return { success: false, error: 'Solana not available' };
  }
  
  // Validate required parameters
  if (!filePath) {
    console.error('[NFT] No file path provided');
    return { success: false, error: 'No image file provided' };
  }
  
  if (encrypt && !masterKey) {
    return { success: false, error: 'Master key required for encryption' };
  }
  
  const isLimited = edition === NFT_EDITION.LIMITED;
  console.log('[NFT] Edition:', isLimited ? 'Limited' : 'Open', '| License:', license, '| Watermark:', watermark, '| Encrypt:', encrypt);
  
  try {
    onStatus?.('Preparing NFT...');
    onProgress?.(0.05);
    
    // Validate file exists
    const fileInfo = await FileSystem.getInfoAsync(filePath);
    if (!fileInfo.exists) {
      console.error('[NFT] File does not exist:', filePath);
      return { success: false, error: 'Image file not found' };
    }
    const fileSize = fileInfo.size || 0;
    console.log('[NFT] File validated:', filePath, 'size:', fileSize);
    
    // Get asset info for EXIF
    const info = await MediaLibrary.getAssetInfoAsync(asset.id);
    const exifData = extractExifForNFT(asset, info);
    
    // Compute EXIF hash (deterministic, for integrity proof)
    const exifHash = computeExifHash(exifData);
    
    // Compute camera serial hash (Limited Edition — device-binding proof)
    const camSerialHash = isLimited ? computeCameraSerialHash(info) : null;
    
    // Determine original format and resolution
    const filename = asset.filename || info?.filename || '';
    const ext = filename.split('.').pop()?.toUpperCase() || 'JPEG';
    const originalFormat = ext;
    const originalResolution = (asset.width && asset.height) ? `${asset.width}x${asset.height}` : null;
    
    onStatus?.('Estimating costs...');
    onProgress?.(0.1);
    
    // Estimate costs with correct storage option and NFT type
    const useCompressed = nftType === 'compressed';
    const costEstimate = await estimateNFTMintCost(fileSize, storageOption, useCompressed);
    console.log('[NFT] Cost estimate:', costEstimate.total, 'storage:', storageOption, 'compressed:', useCompressed);
    
    // ========== STEP 1: Get wallet address first (universal) ==========
    onStatus?.('Connecting wallet...');
    onProgress?.(0.15);
    
    // Get wallet address using universal helper (supports WalletAdapter + MWA fallback)
    let ownerAddressStr;
    let ownerPubkey;
    let currentWalletType;
    
    const walletResult = await getConnectedWalletAddress();
    if (!walletResult.success) {
      return { success: false, error: walletResult.error || 'Wallet connection failed' };
    }
    
    ownerAddressStr = walletResult.address;
    ownerPubkey = walletResult.pubkey;
    currentWalletType = walletResult.walletType;
    console.log('[NFT] Owner address (base58):', ownerAddressStr, 'via', currentWalletType);
    
    // ========== STEP 2: Do all uploads OUTSIDE wallet session ==========
    // Handle EXIF stripping if requested
    let uploadFilePath = filePath;
    let cleanupTempFiles = [];
    
    if (stripExif) {
      onStatus?.('Removing private data...');
      onProgress?.(0.2);
      
      try {
        const stripResult = await stripExifFromImage(filePath);
        if (stripResult.success && stripResult.stripped) {
          uploadFilePath = stripResult.cleanPath;
          cleanupTempFiles.push(stripResult.cleanPath);
          console.log('[NFT] Using EXIF-stripped image');
        } else {
          console.warn('[NFT] EXIF stripping skipped, using original:', stripResult.error || 'not stripped');
        }
      } catch (stripError) {
        console.warn('[NFT] EXIF stripping error, using original:', stripError?.message || stripError);
      }
    }
    
    // ========== EDITION-SPECIFIC IMAGE PROCESSING ==========
    const useStealthCloud = storageOption === NFT_STORAGE_OPTIONS.STEALTHCLOUD && serverConfig;
    let imageToUploadPath = uploadFilePath;
    let encryptionData = null; // Stored locally for decryption
    
    if (isLimited) {
      // LIMITED EDITION: Generate high-quality thumbnail only — original stays on device
      onStatus?.('Creating certificate image...');
      onProgress?.(0.22);
      const thumbResult = await generateLimitedEditionThumb(uploadFilePath);
      if (thumbResult.success) {
        imageToUploadPath = thumbResult.thumbPath;
        cleanupTempFiles.push(thumbResult.thumbPath);
      } else {
        console.warn('[NFT] Limited Edition thumb failed, using gallery thumbnail');
        const fallback = await generateThumbnail(uploadFilePath);
        if (fallback.success) {
          imageToUploadPath = fallback.thumbnailPath;
          cleanupTempFiles.push(fallback.thumbnailPath);
        }
      }
    } else {
      // OPEN EDITION: Generate optimized preview (1200px)
      onStatus?.('Creating preview...');
      onProgress?.(0.22);
      const previewResult = await generateOptimizedPreview(uploadFilePath);
      if (previewResult.success) {
        imageToUploadPath = previewResult.previewPath;
        cleanupTempFiles.push(previewResult.previewPath);
      } else {
        console.warn('[NFT] Preview generation failed, using original');
      }
    }
    
    // Apply watermark if requested (burns into preview/thumbnail before upload)
    if (watermark) {
      onStatus?.('Applying watermark...');
      const wmResult = await burnWatermark(imageToUploadPath);
      if (wmResult.success) {
        cleanupTempFiles.push(wmResult.watermarkedPath);
        imageToUploadPath = wmResult.watermarkedPath;
      }
    }
    
    // Encrypt image if requested
    if (encrypt && masterKey) {
      onStatus?.('Encrypting image...');
      onProgress?.(0.24);
      const encResult = await encryptNFTImage(imageToUploadPath, masterKey);
      if (encResult.success) {
        imageToUploadPath = encResult.encryptedPath;
        cleanupTempFiles.push(encResult.encryptedPath);
        encryptionData = {
          wrappedKey: encResult.wrappedKey,
          wrapNonce: encResult.wrapNonce,
          nonce: encResult.nonce,
          originalSize: encResult.originalSize,
        };
        console.log('[NFT] Image encrypted for upload');
      } else {
        console.warn('[NFT] Encryption failed, uploading unencrypted:', encResult.error);
      }
    }
    
    // Upload processed image
    let imageUpload;
    if (useStealthCloud) {
      onStatus?.('Uploading to StealthCloud...');
      onProgress?.(0.25);
      imageUpload = await uploadToStealthCloud(imageToUploadPath, serverConfig);
    } else {
      onStatus?.('Uploading to IPFS...');
      onProgress?.(0.25);
      const ipfsContentType = (encrypt && encryptionData) ? 'application/octet-stream' : 'image/jpeg';
      imageUpload = await uploadToArweave(imageToUploadPath, ipfsContentType, {
        'NFT-Owner': ownerAddressStr,
        'Photo-Date': stripExif ? 'Private' : (exifData.dateTaken || 'Unknown'),
        'NFT-Edition': isLimited ? 'Limited' : 'Open',
      });
    }
    
    if (!imageUpload.success) {
      throw new Error('Image upload failed: ' + imageUpload.error);
    }
    
    console.log(`[NFT] Image uploaded via ${useStealthCloud ? 'StealthCloud' : 'IPFS'}:`, imageUpload.arweaveUrl);
    
    // Generate and upload gallery thumbnail to StealthCloud (400px, for fast loading)
    // If watermark is enabled, apply it to the thumbnail too so the public preview is protected
    let thumbnailUrl = null;
    if (serverConfig) {
      onStatus?.('Creating thumbnail...');
      onProgress?.(0.30);
      
      const thumbnailResult = await generateThumbnail(uploadFilePath);
      if (thumbnailResult.success) {
        let thumbToUpload = thumbnailResult.thumbnailPath;
        
        // Apply watermark to thumbnail if requested (protect the public preview)
        if (watermark) {
          const wmThumb = await burnWatermark(thumbToUpload);
          if (wmThumb.success) {
            cleanupTempFiles.push(wmThumb.watermarkedPath);
            thumbToUpload = wmThumb.watermarkedPath;
            console.log('[NFT] Watermark applied to gallery thumbnail');
          }
        }
        
        const nftName = name || `PhotoLynk_${Date.now()}`;
        const uploadResult = await uploadThumbnailToStealthCloud(
          thumbToUpload, 
          nftName, 
          serverConfig
        );
        if (uploadResult.success) {
          thumbnailUrl = uploadResult.thumbnailUrl;
          console.log('[NFT] Thumbnail stored:', thumbnailUrl);
        }
      }
    }
    
    onStatus?.('Computing integrity proof...');
    onProgress?.(0.35);
    
    // Compute content hash of ORIGINAL file (not the preview/thumbnail)
    // This anchors the NFT to the actual full-resolution file
    const contentHash = await computeContentHash(filePath);
    
    onStatus?.('Building metadata...');
    onProgress?.(0.4);
    
    // Build NFT metadata with edition support
    const nftName = name || `PhotoLynk #${Date.now()}`;
    const nftDescription = description || null; // Let buildNFTMetadata set default per edition
    
    // Build metadata - exclude EXIF if privacy mode is on
    const metadataExif = stripExif ? null : exifData;
    
    const metadata = buildNFTMetadata({
      name: nftName,
      description: nftDescription,
      imageUrl: imageUpload.arweaveUrl,
      ownerAddress: ownerAddressStr,
      exifData: metadataExif,
      creatorAddress: ownerAddressStr,
      contentHash,
      fileSize,
      edition,
      license,
      watermarked: watermark,
      encrypted: !!(encrypt && encryptionData),
      exifHash,
      cameraSerialHash: camSerialHash,
      originalFormat,
      originalResolution,
    });
    
    // Upload metadata
    const metadataUpload = await uploadMetadataToArweave(metadata);
    if (!metadataUpload.success) {
      throw new Error('Metadata upload failed: ' + metadataUpload.error);
    }
    
    // ========== STEP 3: Pre-fetch blockhash and SOL price BEFORE wallet session ==========
    onStatus?.('Creating NFT on Solana...');
    onProgress?.(0.55);
    
    // Pre-fetch everything needed for transaction BEFORE opening wallet session
    const latestBlockhashResult = await connection.getLatestBlockhash('confirmed');
    const prefetchedBlockhash = latestBlockhashResult.blockhash;
    const solPrice = await fetchSolPrice();
    // Pre-fetch rent for standard NFT (in case of fallback)
    const prefetchedMintRent = await connection.getMinimumBalanceForRentExemption(82); // MINT_SIZE = 82
    console.log('[NFT] Pre-fetched blockhash:', prefetchedBlockhash, 'SOL price:', solPrice, 'mintRent:', prefetchedMintRent);
    
    // Determine if we should use WalletAdapter or MWA
    const useWalletAdapter = walletAdapterAvailable && WalletAdapter && currentWalletType && currentWalletType !== 'mwa';
    console.log('[NFT] Wallet type:', currentWalletType, 'useWalletAdapter:', useWalletAdapter);
    
    let result;
    
    if (useWalletAdapter) {
      // ========== NON-MWA WALLET PATH (Phantom deeplink, WalletConnect, etc.) ==========
      result = await mintWithWalletAdapter({
        nftType,
        ownerPubkey,
        ownerAddressStr,
        prefetchedBlockhash,
        prefetchedMintRent,
        solPrice,
        imageUpload,
        thumbnailUrl,
        metadataUpload,
        metadata,
        nftName,
        useStealthCloud,
        onStatus,
        onProgress,
      });
    } else {
      // ========== MWA WALLET PATH (Seeker, Phantom MWA, etc.) ==========
      result = await transact(async (wallet) => {
        // Re-authorize wallet for signing
        console.log('[NFT] Re-authorizing wallet for signing via MWA...');
        await wallet.authorize({
          cluster: 'mainnet-beta',
          identity: APP_IDENTITY,
        });
      
      // ========== TRY COMPRESSED NFT IF USER SELECTED IT (99.99% CHEAPER) ==========
      const useCompressedNFT = nftType === 'compressed' && cNFTAvailable;
      if (useCompressedNFT) {
        try {
          console.log('[NFT] Attempting compressed NFT (cNFT) mint (user selected)...');
          onStatus?.('Minting compressed NFT...');
          
          // INLINE cNFT minting to avoid async calls that close the wallet session
          // All data is pre-fetched before this transact block
          const merkleTreePubkey = new PublicKey(PHOTOLYNK_MERKLE_TREE);
          const BUBBLEGUM_PROGRAM_ID = new PublicKey('BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY');
          const SPL_NOOP_PROGRAM_ID = new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');
          const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey('cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK');
          
          // Derive tree config PDA
          const [treeConfig] = PublicKey.findProgramAddressSync(
            [merkleTreePubkey.toBuffer()],
            BUBBLEGUM_PROGRAM_ID
          );
          
          // Build metadata for the cNFT
          // Note: creators.address must be base58 string for serialization
          const metadataArgs = {
            name: nftName.slice(0, 32),
            symbol: 'PLNK',
            uri: metadataUpload.arweaveUrl,
            sellerFeeBasisPoints: 500,
            primarySaleHappened: false,
            isMutable: true,
            editionNonce: null,
            tokenStandard: null,
            collection: null,
            uses: null,
            tokenProgramVersion: 0,
            creators: [{ address: ownerPubkey, verified: true, share: 100 }],
          };
          
          const metadataBuffer = serializeMetadataArgs(metadataArgs);
          
          // Build mintV1 instruction using proper TransactionInstruction
          // Discriminator is 8 bytes: [145, 98, 192, 118, 184, 147, 118, 104]
          const MINT_V1_DISCRIMINATOR = new Uint8Array([145, 98, 192, 118, 184, 147, 118, 104]);
          
          // Combine discriminator and metadata into single Uint8Array
          const instructionData = new Uint8Array(MINT_V1_DISCRIMINATOR.length + metadataBuffer.length);
          instructionData.set(MINT_V1_DISCRIMINATOR, 0);
          instructionData.set(metadataBuffer, MINT_V1_DISCRIMINATOR.length);
          
          const mintV1Instruction = new TransactionInstruction({
            keys: [
              { pubkey: treeConfig, isSigner: false, isWritable: true },      // 0: treeConfig
              { pubkey: ownerPubkey, isSigner: false, isWritable: false },    // 1: leafOwner
              { pubkey: ownerPubkey, isSigner: false, isWritable: false },    // 2: leafDelegate
              { pubkey: merkleTreePubkey, isSigner: false, isWritable: true },// 3: merkleTree
              { pubkey: ownerPubkey, isSigner: true, isWritable: true },      // 4: payer
              { pubkey: ownerPubkey, isSigner: true, isWritable: false },     // 5: treeCreatorOrDelegate
              { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false }, // 6: logWrapper
              { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false }, // 7: compressionProgram
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 8: systemProgram
            ],
            programId: BUBBLEGUM_PROGRAM_ID,
            data: instructionData,
          });
          
          // App commission transfer - use pre-fetched SOL price
          // Sanity check: if solPrice is unreasonably low, use fallback
          const safeSolPrice = solPrice > 10 ? solPrice : 250;
          const commissionUsd = useStealthCloud 
            ? NFT_FEES.APP_COMMISSION_CNFT_CLOUD_USD 
            : NFT_FEES.APP_COMMISSION_CNFT_IPFS_USD;
          const commissionLamports = Math.ceil(commissionUsd / safeSolPrice * LAMPORTS_PER_SOL);
          console.log('[cNFT] Commission:', commissionUsd, 'USD =', commissionLamports, 'lamports at SOL price', safeSolPrice, 'storage:', useStealthCloud ? 'cloud' : 'ipfs');
          const commissionWalletPubkey = new PublicKey(NFT_COMMISSION_WALLET);
          console.log('[cNFT] Commission wallet:', NFT_COMMISSION_WALLET);
          console.log('[cNFT] Commission lamports:', commissionLamports, '(', commissionLamports / LAMPORTS_PER_SOL, 'SOL)');
          
          const commissionInstruction = SystemProgram.transfer({
            fromPubkey: ownerPubkey,
            toPubkey: commissionWalletPubkey,
            lamports: commissionLamports,
          });
          
          // Build transaction using pre-fetched blockhash
          const messageV0 = new TransactionMessage({
            payerKey: ownerPubkey,
            recentBlockhash: prefetchedBlockhash,
            instructions: [mintV1Instruction, commissionInstruction],
          }).compileToV0Message();
          
          const cNFTTransaction = new VersionedTransaction(messageV0);
          
          console.log('[cNFT] Sending transaction to wallet for signing...');
          console.log('[cNFT] Transaction has 2 instructions: mintV1 + commission transfer');
          console.log('[cNFT] Blockhash:', prefetchedBlockhash);
          
          // Use signTransactions (not signAndSendTransactions) - more reliable
          // We'll send the transaction manually outside the wallet session
          console.log('[cNFT] Calling wallet.signTransactions...');
          const signedTransactions = await wallet.signTransactions({
            transactions: [cNFTTransaction],
          });
          console.log('[cNFT] Transaction signed by wallet');
          
          // Return signed transaction to send outside wallet session
          return {
            _signedTransaction: signedTransactions[0],
            ownerAddress: ownerAddressStr,
            imageUrl: imageUpload.arweaveUrl,
            thumbnailUrl,
            metadataUrl: metadataUpload.arweaveUrl,
            metadata,
            commissionUsd,
            isCompressed: true,
            merkleTree: PHOTOLYNK_MERKLE_TREE,
          };
        } catch (cNFTError) {
          console.error('[cNFT] FAILED - Full error:', cNFTError);
          console.error('[cNFT] Error message:', cNFTError.message);
          console.error('[cNFT] Error stack:', cNFTError.stack);
          // Don't fallback - let the error propagate so user can retry
          throw cNFTError;
        }
      }
      
      // ========== STANDARD NFT (user selected or fallback) ==========
      console.log('[NFT] Using standard NFT minting (nftType:', nftType, ')...');
      
      // Metaplex Token Metadata Program ID
      const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
      
      // Generate mint keypair for the NFT
      const mintKeypair = Keypair.generate();
      const mintPubkey = mintKeypair.publicKey;
      
      console.log('[NFT] Mint address:', mintPubkey.toBase58());
      
      // Use pre-fetched blockhash and rent (avoid network calls inside transact block)
      const blockhash = prefetchedBlockhash;
      const mintRent = prefetchedMintRent;
      
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
      console.log('[NFT] Standard commission:', costEstimate.breakdown.appCommission.usd, 'USD =', commissionLamports, 'lamports');
      console.log('[NFT] Commission wallet:', NFT_COMMISSION_WALLET);
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
        recentBlockhash: prefetchedBlockhash,
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
      
      console.log('[NFT] ✅ Transaction SUCCESS:', txSignature);
      console.log('[NFT] ✅ Commission of', costEstimate.breakdown.appCommission.usd, 'USD (', commissionLamports, 'lamports) sent to', NFT_COMMISSION_WALLET);
      
      onStatus?.('Confirming transaction...');
      onProgress?.(0.85);
      
      return {
        txSignature,
        mintAddress: mintPubkey.toBase58(),
        ownerAddress: ownerAddressStr,
        imageUrl: imageUpload.arweaveUrl,
        thumbnailUrl, // StealthCloud thumbnail for fast gallery loading
        metadataUrl: metadataUpload.arweaveUrl,
        metadata,
        isRealNFT: true,
      };
    });
    } // End of else (MWA path)
    
    // If cNFT with signed transaction, send it manually outside the wallet session
    if (result._signedTransaction && result.isCompressed) {
      console.log('[cNFT] Sending signed transaction to network...');
      onStatus?.('Confirming transaction...');
      onProgress?.(0.75);
      
      // Small delay to let MWA session fully close
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Send the signed transaction with retry across RPC endpoints
      let txSignature = null;
      let sendError = null;
      
      const RPC_ENDPOINTS = [
        'https://api.mainnet-beta.solana.com',
        'https://solana-mainnet.g.alchemy.com/v2/demo',
        'https://rpc.ankr.com/solana',
      ];
      
      for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
        try {
          const endpoint = RPC_ENDPOINTS[i];
          const sendConnection = new Connection(endpoint, 'confirmed');
          
          const signature = await sendConnection.sendRawTransaction(
            result._signedTransaction.serialize(),
            {
              skipPreflight: true,
              preflightCommitment: 'confirmed',
              maxRetries: 3,
            }
          );
          
          txSignature = signature;
          console.log('[cNFT] ✅ Transaction sent successfully:', txSignature);
          console.log('[cNFT] ✅ Commission of', result.commissionUsd, 'USD sent to', NFT_COMMISSION_WALLET);
          break;
        } catch (e) {
          if (i === RPC_ENDPOINTS.length - 1) {
            console.error('[cNFT] All RPC endpoints failed:', e.message);
          }
          sendError = e;
        }
      }
      
      if (!txSignature) {
        throw sendError || new Error('Failed to send cNFT transaction');
      }
      
      // Update result with txSignature
      result.txSignature = txSignature;
      result.isRealNFT = true;
      result._needsDasLookup = true;
      delete result._signedTransaction;
      delete result.commissionUsd;
    }
    
    // If cNFT, do DAS lookup OUTSIDE the transact block to get real asset ID
    if (result._needsDasLookup) {
      console.log('[cNFT] Doing DAS lookup outside transact...');
      onStatus?.('Finalizing...');
      onProgress?.(0.90);
      
      let realAssetId = null;
      try {
        // Wait for indexing
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const dasResponse = await fetch(SOLANA_RPC_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'get-cnft-asset',
            method: 'getAssetsByOwner',
            params: {
              ownerAddress: result.ownerAddress,
              page: 1,
              limit: 10,
              sortBy: { sortBy: 'created', sortDirection: 'desc' },
            },
          }),
        });
        const dasData = await dasResponse.json();
        
        if (dasData.result?.items) {
          const matchingAsset = dasData.result.items.find(item => 
            item.content?.json_uri === result.metadataUrl ||
            item.content?.metadata?.name === result.metadata?.name
          );
          if (matchingAsset) {
            realAssetId = matchingAsset.id;
            console.log('[cNFT] ✅ Found real asset ID:', realAssetId);
          }
        }
      } catch (dasError) {
        console.log('[cNFT] DAS lookup failed, using tx-based ID:', dasError.message);
      }
      
      // Update result with proper mintAddress
      result.mintAddress = realAssetId 
        ? `cnft_${realAssetId}` 
        : `cnft_tx_${result.txSignature}`;
      delete result._needsDasLookup;
    }
    
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
    
    // Cleanup temp files (best-effort)
    for (const tmp of cleanupTempFiles) {
      try { await FileSystem.deleteAsync(tmp, { idempotent: true }); } catch (_) {}
    }
    
    // Save NFT to local storage AND sync to server
    const serverUrl = serverConfig?.baseUrl || null;
    const authHeaders = serverConfig?.headers || null;
    await saveNFTToStorage({
      mintAddress: result.mintAddress,
      ownerAddress: result.ownerAddress,
      name: name || `PhotoLynk #${Date.now()}`,
      description,
      imageUrl: result.thumbnailUrl || result.imageUrl || localImagePath || asset.uri,
      thumbnailUrl: result.thumbnailUrl,
      arweaveUrl: result.imageUrl,
      metadataUrl: result.metadataUrl,
      txSignature: result.txSignature,
      assetId: asset.id,
      createdAt: new Date().toISOString(),
      exifData,
      storageType: storageOption,
      isCompressed: nftType === 'compressed',
      // Edition fields
      edition,
      license,
      watermarked: watermark,
      encrypted: !!(encrypt && encryptionData),
      encryptionData: encryptionData || null, // wrappedKey, wrapNonce, nonce for decryption
    }, serverUrl, authHeaders);
    
    // Auto-generate Certificate of Authenticity for Limited Edition
    if (isLimited) {
      try {
        const cert = generateCertificate({
          mintAddress: result.mintAddress,
          txSignature: result.txSignature,
          ownerAddress: result.ownerAddress,
          name: nftName,
          description: nftDescription,
          edition,
          license,
          watermarked: watermark,
          encrypted: !!(encrypt && encryptionData),
          storageType: storageOption,
          arweaveUrl: result.imageUrl,
          metadataUrl: result.metadataUrl,
          metadata,
          createdAt: new Date().toISOString(),
        });
        if (cert) {
          await saveCertificate(cert, serverUrl, authHeaders);
          console.log('[NFT] Certificate of Authenticity generated and saved:', cert.id);
        }
      } catch (certErr) {
        console.warn('[NFT] Certificate generation failed (non-critical):', certErr?.message);
      }
    }
    
    return {
      success: true,
      mintAddress: result.mintAddress,
      txSignature: result.txSignature,
      imageUrl: result.imageUrl,
      metadataUrl: result.metadataUrl,
      ownerAddress: result.ownerAddress,
      edition,
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
  // Only treat as domain if it explicitly ends with .skr or .sol
  // Do NOT treat plain alphanumeric strings as domains (they could be Solana addresses)
  return trimmed.endsWith('.skr') || trimmed.endsWith('.sol');
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
 * Transfer a compressed NFT (cNFT) using Bubblegum program
 * Requires fetching asset proof from DAS API
 * @param {string} mintAddress - cNFT ID (format: cnft_<assetId> or cnft_tx_<txSig>)
 * @param {string} recipientInput - Recipient's Solana wallet address or .sol domain
 * @returns {Object} { success, txSignature, recipientAddress, error }
 */
const transferCompressedNFT = async (mintAddress, recipientInput, walletType = null) => {
  // Check Solana availability
  if (!solanaAvailable || !isWalletAvailable()) {
    return { success: false, error: 'Solana not available' };
  }
  
  // Ensure connection is initialized
  if (!connection) {
    connection = new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
  }
  
  const DAS_RPC_URL = 'https://api.mainnet-beta.solana.com';
  
  try {
    // Resolve recipient
    const resolved = await resolveRecipient(recipientInput);
    if (!resolved.success) {
      return { success: false, error: resolved.error };
    }
    
    const recipientAddress = resolved.address;
    const newLeafOwner = new PublicKey(recipientAddress);
    
    // Extract asset ID from mintAddress
    let assetId = mintAddress.replace('cnft_', '');
    
    // Handle tx-based IDs (fallback format)
    if (assetId.startsWith('tx_')) {
      return { success: false, error: 'Cannot transfer cNFT with transaction-based ID. Please refresh your NFT list first.' };
    }
    
    console.log('[cNFT Transfer] Asset ID:', assetId);
    console.log('[cNFT Transfer] Recipient:', recipientAddress);
    
    // Fetch asset data from DAS API
    const assetResponse = await fetch(DAS_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-asset',
        method: 'getAsset',
        params: { id: assetId },
      }),
    });
    const assetData = await assetResponse.json();
    
    if (assetData.error || !assetData.result) {
      console.error('[cNFT Transfer] Failed to fetch asset:', assetData.error);
      return { success: false, error: 'Failed to fetch cNFT data. Please try again.' };
    }
    
    const asset = assetData.result;
    console.log('[cNFT Transfer] Asset owner:', asset.ownership?.owner);
    
    // Fetch asset proof from DAS API
    const proofResponse = await fetch(DAS_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'get-asset-proof',
        method: 'getAssetProof',
        params: { id: assetId },
      }),
    });
    const proofData = await proofResponse.json();
    
    if (proofData.error || !proofData.result) {
      console.error('[cNFT Transfer] Failed to fetch proof:', proofData.error);
      return { success: false, error: 'Failed to fetch cNFT proof. Please try again.' };
    }
    
    const proof = proofData.result;
    console.log('[cNFT Transfer] Proof fetched, tree:', proof.tree_id);
    
    // Build transfer instruction
    const BUBBLEGUM_PROGRAM_ID = new PublicKey('BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY');
    const SPL_NOOP_PROGRAM_ID = new PublicKey('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');
    const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey('cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK');
    
    const merkleTree = new PublicKey(proof.tree_id);
    
    // DAS API returns hashes as base58 strings, decode them properly
    const decodeHash = (hash) => {
      if (!hash) return Buffer.alloc(32);
      // If it starts with 0x, it's hex
      if (hash.startsWith('0x')) {
        return Buffer.from(hash.slice(2), 'hex');
      }
      // Otherwise it's base58 - use PublicKey to decode
      try {
        return new PublicKey(hash).toBuffer();
      } catch {
        // Fallback: try as raw bytes array
        return Buffer.from(hash);
      }
    };
    
    const root = decodeHash(proof.root);
    const dataHash = decodeHash(asset.compression.data_hash);
    const creatorHash = decodeHash(asset.compression.creator_hash);
    const leafIndex = asset.compression.leaf_id;
    const nonce = BigInt(leafIndex);
    
    console.log('[cNFT Transfer] Root length:', root.length, 'DataHash length:', dataHash.length);
    
    // Derive tree config PDA
    const [treeConfig] = PublicKey.findProgramAddressSync(
      [merkleTree.toBuffer()],
      BUBBLEGUM_PROGRAM_ID
    );
    
    // Build proof path (remaining accounts)
    const proofPath = proof.proof.map(p => ({
      pubkey: new PublicKey(p),
      isSigner: false,
      isWritable: false,
    }));
    
    // Get current wallet address
    const walletResult = await getConnectedWalletAddress();
    if (!walletResult.success) {
      return { success: false, error: walletResult.error || 'Wallet not connected' };
    }
    
    const leafOwner = walletResult.pubkey;
    const currentWalletType = walletResult.walletType;
    
    // Verify ownership
    if (leafOwner.toBase58() !== asset.ownership?.owner) {
      return { success: false, error: 'You do not own this NFT' };
    }
    
    // Build transfer instruction data
    const discriminator = Buffer.from([163, 52, 200, 231, 140, 3, 69, 186]);
    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(nonce, 0);
    const indexBuffer = Buffer.alloc(4);
    indexBuffer.writeUInt32LE(leafIndex, 0);
    
    const instructionData = Buffer.concat([
      discriminator, root, dataHash, creatorHash, nonceBuffer, indexBuffer,
    ]);
    
    console.log('[cNFT Transfer] Instruction data length:', instructionData.length);
    
    const transferAccounts = [
      { pubkey: treeConfig, isSigner: false, isWritable: false },
      { pubkey: leafOwner, isSigner: true, isWritable: false },
      { pubkey: leafOwner, isSigner: false, isWritable: false },
      { pubkey: newLeafOwner, isSigner: false, isWritable: false },
      { pubkey: merkleTree, isSigner: false, isWritable: true },
      { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...proofPath,
    ];
    
    const transferInstruction = new TransactionInstruction({
      programId: BUBBLEGUM_PROGRAM_ID,
      keys: transferAccounts,
      data: instructionData,
    });
    
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    
    const messageV0 = new TransactionMessage({
      payerKey: leafOwner,
      recentBlockhash: blockhash,
      instructions: [transferInstruction],
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    
    // Use WalletAdapter for non-MWA wallets, MWA for others
    let txSignature;
    const useWalletAdapter = walletAdapterAvailable && WalletAdapter && currentWalletType && currentWalletType !== 'mwa';
    
    if (useWalletAdapter) {
      console.log('[cNFT Transfer] Using WalletAdapter for signing...');
      const txResult = await WalletAdapter.signAndSendTransaction(transaction);
      if (!txResult.success) {
        throw new Error(txResult.error || 'WalletAdapter signing failed');
      }
      txSignature = txResult.signature;
    } else {
      console.log('[cNFT Transfer] Using MWA for signing...');
      txSignature = await transact(async (wallet) => {
        await wallet.authorize({ cluster: 'mainnet-beta', identity: APP_IDENTITY });
        const signedTxs = await wallet.signTransactions({ transactions: [transaction] });
        return signedTxs[0];
      });
      
      // Send manually outside MWA session
      await new Promise(resolve => setTimeout(resolve, 500));
      const signature = await connection.sendRawTransaction(txSignature.serialize(), {
        skipPreflight: true,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });
      txSignature = signature;
    }
    
    // Update local storage
    await removeNFTFromStorage(mintAddress);
    
    console.log(`[cNFT Transfer] Success: ${txSignature}`);
    
    return {
      success: true,
      txSignature,
      recipientAddress,
      isDomain: resolved.isDomain,
      domainName: resolved.domainName,
    };
  } catch (e) {
    console.error('[cNFT Transfer] Failed:', e);
    return { success: false, error: e.message };
  }
};

/**
 * Transfer NFT to another wallet address
 * @param {string} mintAddress - NFT mint address
 * @param {string} recipientInput - Recipient's Solana wallet address or .sol domain
 * @returns {Object} { success, txSignature, recipientAddress, error }
 */
export const transferNFT = async (mintAddress, recipientInput, walletType = null) => {
  if (!solanaAvailable || !isWalletAvailable()) {
    return { success: false, error: 'Solana not available' };
  }
  
  // Ensure connection is initialized
  if (!connection) {
    connection = new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
  }
  
  // Check if this is a compressed NFT (cNFT)
  const isCompressedNFT = mintAddress?.startsWith('cnft_');
  if (isCompressedNFT) {
    // cNFT transfers use Bubblegum program
    return await transferCompressedNFT(mintAddress, recipientInput);
  }
  
  // Standard NFT transfer requires SPL Token
  if (!splTokenAvailable) {
    return { success: false, error: 'SPL Token not available. Please restart the app.' };
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
    
    // Get current wallet address
    const walletResult = await getConnectedWalletAddress();
    if (!walletResult.success) {
      return { success: false, error: walletResult.error || 'Wallet not connected' };
    }
    
    const ownerPubkey = walletResult.pubkey;
    const currentWalletType = walletResult.walletType;
    
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
      instructions.push(
        createAssociatedTokenAccountInstruction(
          ownerPubkey, destinationATA, recipientPubkey, mintPubkey,
          TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }
    
    // Add transfer instruction
    const splToken = require('@solana/spl-token');
    instructions.push(
      splToken.createTransferInstruction(
        sourceATA, destinationATA, ownerPubkey, 1, [], TOKEN_PROGRAM_ID
      )
    );
    
    const messageV0 = new TransactionMessage({
      payerKey: ownerPubkey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    
    const transaction = new VersionedTransaction(messageV0);
    
    // Use WalletAdapter for non-MWA wallets, MWA for others
    let txSignature;
    const useWalletAdapter = walletAdapterAvailable && WalletAdapter && currentWalletType && currentWalletType !== 'mwa';
    
    if (useWalletAdapter) {
      console.log('[NFT Transfer] Using WalletAdapter for signing...');
      const txResult = await WalletAdapter.signAndSendTransaction(transaction);
      if (!txResult.success) {
        throw new Error(txResult.error || 'WalletAdapter signing failed');
      }
      txSignature = txResult.signature;
    } else {
      console.log('[NFT Transfer] Using MWA for signing...');
      const signedTx = await transact(async (wallet) => {
        await wallet.authorize({ cluster: 'mainnet-beta', identity: APP_IDENTITY });
        const signedTxs = await wallet.signTransactions({ transactions: [transaction] });
        return signedTxs[0];
      });
      
      // Send manually outside MWA session
      await new Promise(resolve => setTimeout(resolve, 500));
      txSignature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: true,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });
    }
    
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
 * Detect storage type from NFT URLs (for legacy NFTs without storageType field)
 */
const detectStorageType = (nft) => {
  // Check arweaveUrl first (original full image URL)
  const urlToCheck = nft.arweaveUrl || nft.imageUrl || nft.thumbnailUrl || '';
  
  // StealthCloud URLs contain stealthlynk.io
  if (urlToCheck.includes('stealthlynk.io') || urlToCheck.includes('nft.stealthlynk.io')) {
    return 'cloud';
  }
  
  // IPFS URLs contain ipfs, pinata, w3s.link, or arweave (decentralized)
  if (urlToCheck.includes('ipfs') || urlToCheck.includes('pinata') || 
      urlToCheck.includes('w3s.link') || urlToCheck.includes('arweave.net') ||
      urlToCheck.includes('irys.xyz')) {
    return 'ipfs';
  }
  
  // Default to IPFS for unknown
  return 'ipfs';
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
    let nfts = stored ? JSON.parse(stored) : [];
    
    // Auto-fix legacy NFTs without storageType field
    let needsSave = false;
    nfts = nfts.map(nft => {
      if (!nft.storageType) {
        needsSave = true;
        return { ...nft, storageType: detectStorageType(nft) };
      }
      return nft;
    });
    
    // Save back if we fixed any NFTs
    if (needsSave) {
      await FileSystem.writeAsStringAsync(NFT_STORAGE_FILE, JSON.stringify(nfts));
      console.log('[NFT] Auto-fixed storageType for legacy NFTs');
    }
    
    return nfts;
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
    
    // Merge: add server NFTs that aren't local, and update local NFTs with missing imageUrl
    let merged = 0;
    for (const serverNFT of serverNFTs) {
      if (!localMints.has(serverNFT.mintAddress)) {
        localNFTs.push(serverNFT);
        merged++;
      } else {
        // Update local NFT with server data if local is missing imageUrl
        const localIdx = localNFTs.findIndex(n => n.mintAddress === serverNFT.mintAddress);
        if (localIdx >= 0 && !localNFTs[localIdx].imageUrl && serverNFT.imageUrl) {
          localNFTs[localIdx].imageUrl = serverNFT.imageUrl;
          merged++;
        }
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
 * Remove NFT from local storage, image cache, AND server
 */
export const removeNFTFromStorage = async (mintAddress, serverUrl = null, authHeaders = null) => {
  try {
    const existing = await getStoredNFTs();
    
    // Find the NFT to get its image URLs before removing
    const nftToRemove = existing.find(nft => nft.mintAddress === mintAddress);
    
    const filtered = existing.filter(nft => nft.mintAddress !== mintAddress);
    await saveNFTsToFile(filtered);
    
    // Clear image from cache
    if (nftToRemove) {
      try {
        // Remove all possible image URLs from cache
        if (nftToRemove.imageUrl) await removeNFTImageFromCache(nftToRemove.imageUrl);
        if (nftToRemove.thumbnailUrl) await removeNFTImageFromCache(nftToRemove.thumbnailUrl);
        if (nftToRemove.arweaveUrl) await removeNFTImageFromCache(nftToRemove.arweaveUrl);
        console.log('[NFT] Cleared image cache for:', mintAddress);
      } catch (cacheErr) {
        console.log('[NFT] Could not clear image cache:', cacheErr.message);
      }
    }
    
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
 * @param {string} mintAddress - The mint address or cNFT asset ID
 * @param {string} txSignature - Optional transaction signature for cNFT verification fallback
 */
export const verifyNFTOnChain = async (mintAddress, txSignature = null) => {
  // Initialize connection if not available
  if (!connection) {
    await initializeNFT();
  }
  
  if (!connection) {
    return { verified: false, error: 'Could not connect to Solana' };
  }
  
  try {
    // Handle compressed NFTs (cNFTs) - use DAS API
    if (mintAddress?.startsWith('cnft_')) {
      // Check if it's a tx-based ID (fallback when DAS wasn't ready)
      if (mintAddress.startsWith('cnft_tx_')) {
        const txSig = mintAddress.replace('cnft_tx_', '');
        // Verify the transaction exists
        try {
          const txInfo = await connection.getTransaction(txSig, { maxSupportedTransactionVersion: 0 });
          if (txInfo && !txInfo.meta?.err) {
            return {
              verified: true,
              exists: true,
              compressed: true,
              txBased: true,
              note: 'Verified via transaction',
            };
          }
        } catch (txError) {
          console.log('[Verify] Could not verify tx:', txError.message);
        }
        return { verified: false, error: 'Transaction not found or failed' };
      }
      
      // Real asset ID - use DAS API
      const assetId = mintAddress.replace('cnft_', '');
      
      // Check if assetId looks valid (base58, 32-44 chars)
      if (assetId.length >= 32 && assetId.length <= 44) {
        const response = await fetch(SOLANA_RPC_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'verify-cnft',
            method: 'getAsset',
            params: { id: assetId },
          }),
        });
        const data = await response.json();
        
        if (data.result && data.result.id) {
          return {
            verified: true,
            exists: true,
            owner: data.result.ownership?.owner,
            compressed: true,
            tree: data.result.compression?.tree,
          };
        }
      }
      
      // Old format or DAS failed - try txSignature if provided
      if (txSignature) {
        try {
          console.log('[Verify] Trying txSignature fallback:', txSignature.slice(0, 20));
          const txInfo = await connection.getTransaction(txSignature, { maxSupportedTransactionVersion: 0 });
          if (txInfo && !txInfo.meta?.err) {
            return {
              verified: true,
              exists: true,
              compressed: true,
              txBased: true,
              note: 'Verified via transaction',
            };
          }
        } catch (txError) {
          console.log('[Verify] txSignature fallback failed:', txError.message);
        }
      }
      
      return { verified: false, error: 'Asset not found (try rescanning wallet)' };
    }
    
    // Standard NFT verification
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
    
    console.log(`[NFT] Successfully fetched ${nfts.length} standard NFTs`);
    
    // Also fetch compressed NFTs (cNFTs) using DAS API
    try {
      console.log('[NFT] Fetching compressed NFTs via DAS API...');
      const cNFTs = await fetchCompressedNFTs(walletAddress);
      if (cNFTs && cNFTs.length > 0) {
        console.log(`[NFT] Found ${cNFTs.length} compressed NFTs`);
        nfts.push(...cNFTs);
      }
    } catch (cNFTError) {
      console.log('[NFT] cNFT fetch failed (non-critical):', cNFTError.message);
    }
    
    console.log(`[NFT] Total NFTs fetched: ${nfts.length}`);
    return { success: true, nfts };
  } catch (e) {
    console.error('[NFT] Fetch NFTs failed:', e);
    return { success: false, error: e.message };
  }
};

/**
 * Fetch compressed NFTs (cNFTs) using DAS API
 * @param {string} walletAddress - Owner's wallet address
 * @returns {Array} Array of cNFT objects
 */
const fetchCompressedNFTs = async (walletAddress) => {
  // Use Solana mainnet RPC which supports DAS API
  const DAS_RPC_URL = 'https://api.mainnet-beta.solana.com';
  
  console.log('[cNFT] Fetching compressed NFTs for:', walletAddress);
  
  try {
    const response = await fetch(DAS_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'photolynk-cnft-fetch',
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: walletAddress,
          page: 1,
          limit: 100,
        },
      }),
    });
    
    const data = await response.json();
    console.log('[cNFT] DAS API response status:', response.status);
    
    if (data.error) {
      console.log('[cNFT] DAS API error:', JSON.stringify(data.error));
      return [];
    }
    
    if (!data.result?.items) {
      console.log('[cNFT] No items in response');
      return [];
    }
    
    console.log('[cNFT] Total assets from DAS:', data.result.items.length);
    
    // Filter for compressed NFTs only
    const compressedItems = data.result.items.filter(item => item.compression?.compressed === true);
    console.log('[cNFT] Compressed items:', compressedItems.length);
    
    // Fetch metadata for each cNFT to get image URLs
    const cNFTs = [];
    for (const item of compressedItems) {
      let imageUrl = item.content?.links?.image || item.content?.files?.[0]?.uri || '';
      const metadataUrl = item.content?.json_uri || '';
      
      // If no image URL but we have metadata URL, fetch the metadata to get image
      if (!imageUrl && metadataUrl) {
        try {
          console.log('[cNFT] Fetching metadata for:', item.content?.metadata?.name);
          
          // Try multiple IPFS gateways as fallback
          // Extract CID from URL
          const cidMatch = metadataUrl.match(/ipfs\/([a-zA-Z0-9]+)/);
          const cid = cidMatch ? cidMatch[1] : null;
          
          // Use w3s.link (web3.storage) and nftstorage.link as primary - more reliable
          const gateways = cid ? [
            `https://w3s.link/ipfs/${cid}`,
            `https://nftstorage.link/ipfs/${cid}`,
            `https://ipfs.io/ipfs/${cid}`,
            `https://cf-ipfs.com/ipfs/${cid}`,
          ] : [metadataUrl];
          
          for (const gateway of gateways) {
            try {
              console.log('[cNFT] Trying gateway:', gateway.slice(0, 50));
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
              const metaResponse = await fetch(gateway, { 
                signal: controller.signal,
                redirect: 'follow',
              });
              clearTimeout(timeoutId);
              
              console.log('[cNFT] Gateway response:', metaResponse.status);
              if (metaResponse.ok) {
                const metaJson = await metaResponse.json();
                imageUrl = metaJson.image || '';
                if (imageUrl) {
                  console.log('[cNFT] Got image from metadata:', imageUrl?.slice(0, 60));
                  break;
                }
              } else {
                console.log('[cNFT] Gateway returned:', metaResponse.status);
              }
            } catch (gwErr) {
              console.log('[cNFT] Gateway failed:', gwErr.name, gwErr.message);
              // Try next gateway
            }
          }
        } catch (metaErr) {
          console.log('[cNFT] Failed to fetch metadata:', metaErr.message);
        }
      }
      
      cNFTs.push({
        mintAddress: `cnft_${item.id}`,
        assetId: item.id,
        name: item.content?.metadata?.name || 'Compressed NFT',
        description: item.content?.metadata?.description || '',
        imageUrl, // IPFS image URL
        arweaveUrl: imageUrl, // Same as imageUrl for scanned NFTs (for fallback logic)
        metadataUrl,
        ownerAddress: walletAddress,
        createdAt: new Date().toISOString(),
        source: 'das',
        isCompressed: true,
        merkleTree: item.compression?.tree,
      });
    }
    
    console.log('[cNFT] Compressed NFTs found:', cNFTs.length);
    return cNFTs;
  } catch (e) {
    console.error('[cNFT] fetchCompressedNFTs error:', e.message);
    return [];
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
// CERTIFICATES OF AUTHENTICITY (CoA) — Limited Edition
// ============================================================================

const CERTIFICATES_STORAGE_KEY = 'photolynk_nft_certificates';

/**
 * Generate a Certificate of Authenticity JSON for a Limited Edition NFT
 * @param {Object} nftData - Minted NFT data from saveNFTToStorage
 * @returns {Object} Certificate object
 */
export const generateCertificate = (nftData) => {
  if (!nftData) return null;
  const cert = {
    id: `cert_${nftData.mintAddress || Date.now()}`,
    version: 1,
    type: 'PhotoLynk Certificate of Authenticity',
    edition: nftData.edition || 'limited',
    mintAddress: nftData.mintAddress,
    txSignature: nftData.txSignature,
    creatorWallet: nftData.ownerAddress,
    name: nftData.name,
    description: nftData.description,
    contentHash: null,
    exifHash: null,
    license: nftData.license || 'arr',
    watermarked: !!nftData.watermarked,
    encrypted: !!nftData.encrypted,
    storageType: nftData.storageType,
    imageUrl: nftData.arweaveUrl || nftData.imageUrl,
    metadataUrl: nftData.metadataUrl,
    createdAt: nftData.createdAt || new Date().toISOString(),
    issuedAt: new Date().toISOString(),
  };

  // Extract hashes from metadata attributes if available
  if (nftData.metadata?.attributes) {
    for (const attr of nftData.metadata.attributes) {
      if (attr.trait_type === 'Content Hash') cert.contentHash = attr.value;
      if (attr.trait_type === 'EXIF Hash') cert.exifHash = attr.value;
    }
  }

  return cert;
};

/**
 * Save a certificate to local storage
 */
export const saveCertificate = async (cert, serverUrl = null, authHeaders = null) => {
  try {
    const raw = await SecureStore.getItemAsync(CERTIFICATES_STORAGE_KEY);
    const certs = raw ? JSON.parse(raw) : [];
    // Avoid duplicates
    const idx = certs.findIndex(c => c.id === cert.id);
    if (idx >= 0) {
      certs[idx] = cert;
    } else {
      certs.unshift(cert);
    }
    await SecureStore.setItemAsync(CERTIFICATES_STORAGE_KEY, JSON.stringify(certs));
    console.log('[NFT] Certificate saved:', cert.id);
    
    // Sync to server (best-effort, non-blocking)
    if (serverUrl && authHeaders) {
      try {
        await axios.post(`${serverUrl}/api/nft/certificates`, {
          action: 'add',
          certificate: cert,
        }, { headers: authHeaders, timeout: 10000 });
        console.log('[NFT] Certificate synced to server:', cert.id);
      } catch (syncErr) {
        console.log('[NFT] Certificate server sync failed (will retry later):', syncErr.message);
      }
    }
    
    return { success: true };
  } catch (e) {
    console.error('[NFT] Save certificate failed:', e.message);
    return { success: false, error: e.message };
  }
};

/**
 * Get all stored certificates
 */
export const getStoredCertificates = async () => {
  try {
    const raw = await SecureStore.getItemAsync(CERTIFICATES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('[NFT] Load certificates failed:', e?.message);
    return [];
  }
};

/**
 * Remove a certificate by ID
 */
export const removeCertificate = async (certId) => {
  try {
    const raw = await SecureStore.getItemAsync(CERTIFICATES_STORAGE_KEY);
    let certs = raw ? JSON.parse(raw) : [];
    certs = certs.filter(c => c.id !== certId);
    await SecureStore.setItemAsync(CERTIFICATES_STORAGE_KEY, JSON.stringify(certs));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
};

/**
 * Build a shareable text representation of a certificate
 * Suitable for sharing via social media, saving to device, or printing
 */
export const formatCertificateForExport = (cert) => {
  if (!cert) return '';
  const lines = [
    '═══════════════════════════════════════════',
    '       CERTIFICATE OF AUTHENTICITY',
    '              PhotoLynk NFT',
    '═══════════════════════════════════════════',
    '',
    `Name:           ${cert.name || 'Untitled'}`,
    `Edition:        ${cert.edition === 'limited' ? 'Limited Edition' : 'Open Edition'}`,
    `License:        ${cert.license || 'All Rights Reserved'}`,
    '',
    '── Blockchain Proof ──',
    `Mint Address:   ${cert.mintAddress || 'N/A'}`,
    `Transaction:    ${cert.txSignature || 'N/A'}`,
    `Creator Wallet: ${cert.creatorWallet || 'N/A'}`,
    '',
    '── Integrity Proof ──',
    `Content Hash:   ${cert.contentHash || 'N/A'}`,
    `EXIF Hash:      ${cert.exifHash || 'N/A'}`,
    '',
    '── Details ──',
    `Watermarked:    ${cert.watermarked ? 'Yes' : 'No'}`,
    `Encrypted:      ${cert.encrypted ? 'Yes' : 'No'}`,
    `Storage:        ${cert.storageType === 'cloud' ? 'StealthCloud' : 'IPFS'}`,
    `Issued:         ${cert.issuedAt || cert.createdAt || 'N/A'}`,
    '',
    '── Verify ──',
    `Solscan:        https://solscan.io/token/${cert.mintAddress || ''}`,
    `Explorer:       https://explorer.solana.com/address/${cert.mintAddress || ''}`,
    '',
    '═══════════════════════════════════════════',
    '  Issued by PhotoLynk • stealthlynk.io',
    '═══════════════════════════════════════════',
  ];
  return lines.join('\n');
};

// ============================================================================
// EXPORTS
// ============================================================================

// Check if cNFT is available
export const isCNFTAvailable = () => cNFTAvailable;

export default {
  initializeNFT,
  fetchSolPrice,
  usdToSol,
  extractExifForNFT,
  estimateArweaveUploadCost,
  uploadToArweave,
  computeContentHash,
  computeExifHash,
  computeCameraSerialHash,
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
  isCNFTAvailable,
  isWalletAvailable,
  // Edition system
  generateOptimizedPreview,
  generateLimitedEditionThumb,
  burnWatermark,
  encryptNFTImage,
  decryptNFTImage,
  NFT_EDITION,
  NFT_LICENSE_OPTIONS,
  EDITION_ROYALTY_BPS,
  // Certificates
  generateCertificate,
  saveCertificate,
  getStoredCertificates,
  removeCertificate,
  formatCertificateForExport,
  // Existing constants
  NFT_FEES,
  NFT_COMMISSION_WALLET,
  CNFT_MODE,
  PHOTOLYNK_MERKLE_TREE,
  walletAdapterAvailable: () => walletAdapterAvailable,
};
