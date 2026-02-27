// Mobile Wallet Adapter (MWA) - Android Solana Wallets
// Supports: Seeker/Saga hardware wallet, Phantom, Solflare, and other MWA-compatible wallets
// Platform: Android only

import { Platform } from 'react-native';

// Solana imports
let Connection, PublicKey, LAMPORTS_PER_SOL;
let transact;
let mwaAvailable = false;

try {
  const web3 = require('@solana/web3.js');
  Connection = web3.Connection;
  PublicKey = web3.PublicKey;
  LAMPORTS_PER_SOL = web3.LAMPORTS_PER_SOL;
  
  const mwa = require('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
  transact = mwa.transact;
  
  mwaAvailable = true;
  console.log('[MWAAdapter] Mobile Wallet Adapter loaded');
} catch (e) {
  console.log('[MWAAdapter] MWA not available:', e.message);
}

// Configuration
const SOLANA_RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';

const APP_IDENTITY = {
  name: 'PhotoLynk',
  uri: 'https://stealthlynk.io',
  icon: 'favicon.ico',
};

// State
let connection = null;
let authToken = null;
let connectedAddress = null;

// ============================================================================
// ADAPTER INTERFACE
// ============================================================================

/**
 * Check if MWA is available on this device
 */
export const isAvailable = async () => {
  // MWA only works on Android
  if (Platform.OS !== 'android') {
    return false;
  }
  return mwaAvailable;
};

/**
 * Get adapter name
 */
export const getName = () => 'Mobile Wallet Adapter';

/**
 * Connect to wallet via MWA
 * @returns {Object} { success, address, error }
 */
export const connect = async () => {
  if (!mwaAvailable || !transact) {
    return { success: false, error: 'MWA not available' };
  }
  
  try {
    // Initialize connection if needed
    if (!connection) {
      connection = new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
    }
    
    const result = await transact(async (wallet) => {
      const authResult = await wallet.authorize({
        cluster: 'mainnet-beta',
        identity: APP_IDENTITY,
      });
      
      // MWA returns address as base64, convert to string
      const addressBytes = typeof authResult.accounts[0].address === 'string'
        ? Uint8Array.from(atob(authResult.accounts[0].address), c => c.charCodeAt(0))
        : new Uint8Array(authResult.accounts[0].address);
      const pubkey = new PublicKey(addressBytes);
      
      return {
        address: pubkey.toBase58(),
        authToken: authResult.auth_token,
        label: authResult.accounts[0].label || null,
      };
    });
    
    connectedAddress = result.address;
    authToken = result.authToken;
    
    console.log('[MWAAdapter] Connected:', result.address, 'label:', result.label);
    return { success: true, address: result.address, label: result.label || null };
  } catch (e) {
    if (e.message?.includes('User rejected') || e.message?.includes('cancelled')) {
      return { success: false, error: 'User cancelled', userCancelled: true };
    }
    console.error('[MWAAdapter] Connection failed:', e);
    return { success: false, error: e.message };
  }
};

/**
 * Disconnect wallet
 */
export const disconnect = async () => {
  connectedAddress = null;
  authToken = null;
  console.log('[MWAAdapter] Disconnected');
};

/**
 * Sign and send a transaction
 * @param {Object} transaction - Solana VersionedTransaction
 * @returns {Object} { success, signature, error }
 */
export const signAndSendTransaction = async (transaction) => {
  if (!mwaAvailable || !transact) {
    return { success: false, error: 'MWA not available' };
  }
  
  try {
    const signature = await transact(async (wallet) => {
      // Re-authorize for signing
      await wallet.authorize({
        cluster: 'mainnet-beta',
        identity: APP_IDENTITY,
      });
      
      const signatures = await wallet.signAndSendTransactions({
        transactions: [transaction],
      });
      
      return signatures[0];
    });
    
    console.log('[MWAAdapter] Transaction sent:', signature);
    return { success: true, signature };
  } catch (e) {
    if (e.message?.includes('User rejected') || e.message?.includes('cancelled')) {
      return { success: false, error: 'User cancelled', userCancelled: true };
    }
    console.error('[MWAAdapter] Transaction failed:', e);
    return { success: false, error: e.message };
  }
};

/**
 * Sign a message
 * @param {Uint8Array} message - Message bytes to sign
 * @returns {Object} { success, signature, error }
 */
export const signMessage = async (message) => {
  if (!mwaAvailable || !transact) {
    return { success: false, error: 'MWA not available' };
  }
  
  try {
    const signature = await transact(async (wallet) => {
      await wallet.authorize({
        cluster: 'mainnet-beta',
        identity: APP_IDENTITY,
      });
      
      const messageBytes = typeof message === 'string' 
        ? new TextEncoder().encode(message)
        : message;
      
      const signatures = await wallet.signMessages({
        addresses: [connectedAddress],
        payloads: [messageBytes],
      });
      
      return signatures[0];
    });
    
    return { success: true, signature };
  } catch (e) {
    if (e.message?.includes('User rejected') || e.message?.includes('cancelled')) {
      return { success: false, error: 'User cancelled', userCancelled: true };
    }
    console.error('[MWAAdapter] Message signing failed:', e);
    return { success: false, error: e.message };
  }
};

/**
 * Get wallet balance in SOL
 * @param {string} address - Wallet address
 * @returns {number} Balance in SOL
 */
export const getBalance = async (address) => {
  if (!connection) {
    connection = new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
  }
  
  try {
    const pubkey = new PublicKey(address);
    const balance = await connection.getBalance(pubkey);
    return balance / LAMPORTS_PER_SOL;
  } catch (e) {
    console.error('[MWAAdapter] Balance fetch failed:', e);
    return 0;
  }
};

/**
 * Execute a transact session with callback
 * This allows external code to use MWA directly for complex operations
 * @param {Function} callback - Async function receiving wallet object
 * @returns {any} Result from callback
 */
export const executeTransaction = async (callback) => {
  if (!mwaAvailable || !transact) {
    throw new Error('MWA not available');
  }
  
  return await transact(callback);
};

/**
 * Get the APP_IDENTITY for external use
 */
export const getAppIdentity = () => APP_IDENTITY;

/**
 * Get connection instance
 */
export const getConnection = () => {
  if (!connection) {
    connection = new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
  }
  return connection;
};

export default {
  isAvailable,
  getName,
  connect,
  disconnect,
  signAndSendTransaction,
  signMessage,
  getBalance,
  executeTransaction,
  getAppIdentity,
  getConnection,
};
