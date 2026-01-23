// Solana Blockchain Purchases Integration for StealthCloud
// Handles subscription payments via SOL transfers on Solana blockchain
// Uses Mobile Wallet Adapter for Solana Seeker/Saga devices

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';

// Solana imports - will be available after npm install
let Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, TransactionMessage, VersionedTransaction;
let transact, Web3MobileWallet;
let solanaAvailable = false;

try {
  const web3 = require('@solana/web3.js');
  Connection = web3.Connection;
  PublicKey = web3.PublicKey;
  Transaction = web3.Transaction;
  SystemProgram = web3.SystemProgram;
  LAMPORTS_PER_SOL = web3.LAMPORTS_PER_SOL;
  TransactionMessage = web3.TransactionMessage;
  VersionedTransaction = web3.VersionedTransaction;
  
  const mwa = require('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
  transact = mwa.transact;
  Web3MobileWallet = mwa.Web3MobileWallet;
  
  solanaAvailable = true;
} catch (e) {
  console.log('Solana libraries not available (run npm install):', e.message);
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// Payment recipient wallet address (your business wallet)
export const PAYMENT_WALLET = 'HttTZkUG8xn5A1uJPjRDJqqufdwvHmNQroEGmST8iimU';

// Solana RPC endpoint (mainnet-beta for production)
const SOLANA_RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
// For testing, use devnet:
// const SOLANA_RPC_ENDPOINT = 'https://api.devnet.solana.com';

// StealthCloud server base URL
const STEALTHCLOUD_BASE_URL = 'https://stealthlynk.io';

// App identity for Mobile Wallet Adapter
const APP_IDENTITY = {
  name: 'PhotoLynk',
  uri: 'https://stealthlynk.io',
  icon: 'favicon.ico',
};

// Plan pricing in USD (monthly)
export const PLAN_PRICES_USD = {
  100: 1.75,   // 100 GB
  200: 2.45,   // 200 GB
  400: 3.99,   // 400 GB
  1000: 7.99,  // 1 TB
};

// Plan durations in days
export const PLAN_DURATIONS = {
  monthly: 30,
  yearly: 365,
};

// Grace period in days (matches server SUBSCRIPTION_GRACE_DAYS)
export const GRACE_PERIOD_DAYS = 3;

// ============================================================================
// STATE
// ============================================================================

let connection = null;
let cachedSolPrice = null;
let solPriceLastFetch = 0;
const SOL_PRICE_CACHE_MS = 60000; // Cache SOL price for 1 minute
const SOL_PRICE_STORAGE_KEY = 'solana_purchases_sol_price';

let connectedWallet = null;
let authToken = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize Solana connection
 */
export const initializeSolana = async () => {
  if (!solanaAvailable) {
    console.log('Solana not available (native rebuild required)');
    return false;
  }
  
  try {
    connection = new Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
    console.log('Solana connection initialized');
    return true;
  } catch (e) {
    console.error('Failed to initialize Solana:', e);
    return false;
  }
};

// ============================================================================
// WALLET CONNECTION (Mobile Wallet Adapter)
// ============================================================================

/**
 * Connect to a Solana wallet using Mobile Wallet Adapter
 * @returns {Object} { success, publicKey, error }
 */
export const connectWallet = async () => {
  if (!solanaAvailable || !transact) {
    return { success: false, error: 'Solana not available' };
  }
  
  try {
    const result = await transact(async (wallet) => {
      // Request authorization from the wallet
      const authResult = await wallet.authorize({
        cluster: 'mainnet-beta', // Use 'devnet' for testing
        identity: APP_IDENTITY,
      });
      
      return {
        publicKey: authResult.accounts[0].address,
        authToken: authResult.auth_token,
      };
    });
    
    connectedWallet = result.publicKey;
    authToken = result.authToken;
    
    // Store wallet address for future sessions
    await SecureStore.setItemAsync('solana_wallet', result.publicKey);
    
    console.log('Wallet connected:', result.publicKey);
    return { success: true, publicKey: result.publicKey };
  } catch (e) {
    console.error('Wallet connection failed:', e);
    return { success: false, error: e.message || 'Connection failed' };
  }
};

/**
 * Disconnect wallet
 */
export const disconnectWallet = async () => {
  connectedWallet = null;
  authToken = null;
  await SecureStore.deleteItemAsync('solana_wallet');
  console.log('Wallet disconnected');
};

/**
 * Get connected wallet address
 * @returns {string|null} Wallet public key or null
 */
export const getConnectedWallet = async () => {
  if (connectedWallet) return connectedWallet;
  
  // Try to restore from secure storage
  try {
    const stored = await SecureStore.getItemAsync('solana_wallet');
    if (stored) {
      connectedWallet = stored;
      return stored;
    }
  } catch (e) {
    console.error('Failed to get stored wallet:', e);
  }
  
  return null;
};

/**
 * Get wallet SOL balance
 * @param {string} walletAddress - Wallet public key
 * @returns {number} Balance in SOL
 */
export const getWalletBalance = async (walletAddress = null) => {
  if (!solanaAvailable || !connection) {
    return 0;
  }
  
  try {
    const address = walletAddress || connectedWallet;
    if (!address) return 0;
    
    const pubkey = new PublicKey(address);
    const balance = await connection.getBalance(pubkey);
    return balance / LAMPORTS_PER_SOL;
  } catch (e) {
    console.error('Failed to get balance:', e);
    return 0;
  }
};

// ============================================================================
// SOL PRICE CONVERSION
// ============================================================================

/**
 * Fetch current SOL price in USD from multiple APIs with fallbacks
 * @returns {number} SOL price in USD
 */
export const fetchSolPrice = async () => {
  const now = Date.now();
  
  // Return cached price if still valid
  if (cachedSolPrice && cachedSolPrice > 0 && (now - solPriceLastFetch) < SOL_PRICE_CACHE_MS) {
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
          console.log('[SolanaPurchases] Loaded persisted SOL price:', cachedSolPrice);
        }
      }
    } catch (e) {
      console.log('[SolanaPurchases] Could not load persisted price:', e.message);
    }
  }
  
  // Try multiple price APIs with fallbacks
  const priceApis = [
    {
      name: 'CoinGecko',
      url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
      extract: (data) => data?.solana?.usd,
    },
    {
      name: 'Binance',
      url: 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
      extract: (data) => parseFloat(data?.price),
    },
    {
      name: 'CoinCap',
      url: 'https://api.coincap.io/v2/assets/solana',
      extract: (data) => parseFloat(data?.data?.priceUsd),
    },
  ];
  
  for (const api of priceApis) {
    try {
      const response = await axios.get(api.url, { timeout: 8000 });
      const price = api.extract(response.data);
      
      if (price && typeof price === 'number' && price > 0) {
        cachedSolPrice = price;
        solPriceLastFetch = now;
        console.log(`[SolanaPurchases] SOL price from ${api.name}:`, price);
        // Persist successful price for future fallback
        try {
          await SecureStore.setItemAsync(SOL_PRICE_STORAGE_KEY, JSON.stringify({ price, timestamp: now }));
        } catch (e) {
          console.log('[SolanaPurchases] Could not persist price:', e.message);
        }
        return price;
      }
    } catch (e) {
      console.warn(`[SolanaPurchases] ${api.name} price fetch failed:`, e.message);
      // Continue to next API
    }
  }
  
  // Fallback to last stored price if all APIs fail
  if (cachedSolPrice && cachedSolPrice > 0) {
    console.log('[SolanaPurchases] All price APIs failed, using last stored price:', cachedSolPrice);
    return cachedSolPrice;
  }
  
  console.error('[SolanaPurchases] All price APIs failed and no stored price available');
  return null;
};

/**
 * Convert USD to SOL
 * @param {number} usdAmount - Amount in USD
 * @returns {number} Amount in SOL
 */
export const usdToSol = async (usdAmount) => {
  const solPrice = await fetchSolPrice();
  return usdAmount / solPrice;
};

/**
 * Get plan price in SOL
 * @param {number} tierGb - Plan tier in GB (100, 200, 400, 1000)
 * @returns {Object} { usd, sol, solPrice }
 */
export const getPlanPriceInSol = async (tierGb) => {
  const usdPrice = PLAN_PRICES_USD[tierGb];
  if (!usdPrice) {
    return { usd: 0, sol: 0, solPrice: 0 };
  }
  
  const solPrice = await fetchSolPrice();
  const solAmount = usdPrice / solPrice;
  
  return {
    usd: usdPrice,
    sol: solAmount,
    solFormatted: solAmount.toFixed(6),
    solPrice,
  };
};

// ============================================================================
// PAYMENT PROCESSING
// ============================================================================

/**
 * Create a payment memo with user info for tracking
 * @param {string} userUuid - User's unique identifier
 * @param {number} tierGb - Plan tier
 * @param {string} duration - 'monthly' or 'yearly'
 * @returns {string} Memo string
 */
const createPaymentMemo = (userUuid, tierGb, duration = 'monthly') => {
  // Format: PHOTOLYNK|<uuid>|<tier>|<duration>
  return `PHOTOLYNK|${userUuid}|${tierGb}GB|${duration}`;
};

/**
 * Purchase a subscription plan using SOL
 * @param {number} tierGb - Plan tier in GB (100, 200, 400, 1000)
 * @param {string} authToken - User's auth token for server authentication
 * @param {string} duration - 'monthly' or 'yearly'
 * @returns {Object} { success, txSignature, error }
 */
export const purchaseWithSol = async (tierGb, authToken, duration = 'monthly') => {
  if (!solanaAvailable || !transact || !connection) {
    return { success: false, error: 'Solana not available' };
  }
  
  if (!authToken) {
    return { success: false, error: 'Auth token required' };
  }
  
  try {
    // Get price in SOL
    const priceInfo = await getPlanPriceInSol(tierGb);
    if (!priceInfo.sol || priceInfo.sol <= 0) {
      return { success: false, error: 'Invalid plan tier' };
    }
    
    // Convert SOL to lamports (1 SOL = 1,000,000,000 lamports)
    const lamports = Math.ceil(priceInfo.sol * LAMPORTS_PER_SOL);
    
    console.log(`Initiating payment: ${priceInfo.sol.toFixed(6)} SOL ($${priceInfo.usd}) for ${tierGb}GB ${duration}`);
    
    // Execute transaction via Mobile Wallet Adapter
    const txSignature = await transact(async (wallet) => {
      // Authorize if needed
      const authResult = await wallet.authorize({
        cluster: 'mainnet-beta',
        identity: APP_IDENTITY,
      });
      
      // Get payer's public key - MWA returns address as base64 string, convert to bytes then PublicKey
      const payerAddress = authResult.accounts[0].address;
      // Decode base64 to bytes, then create PublicKey
      const payerBytes = typeof payerAddress === 'string'
        ? Uint8Array.from(atob(payerAddress), c => c.charCodeAt(0))
        : new Uint8Array(payerAddress);
      const payerPubkey = new PublicKey(payerBytes);
      const recipientPubkey = new PublicKey(PAYMENT_WALLET);
      
      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      
      // Create transfer instruction
      const transferInstruction = SystemProgram.transfer({
        fromPubkey: payerPubkey,
        toPubkey: recipientPubkey,
        lamports,
      });
      
      // Create transaction message
      const messageV0 = new TransactionMessage({
        payerKey: payerPubkey,
        recentBlockhash: blockhash,
        instructions: [transferInstruction],
      }).compileToV0Message();
      
      // Create versioned transaction
      const transaction = new VersionedTransaction(messageV0);
      
      // Sign and send via wallet
      const signatures = await wallet.signAndSendTransactions({
        transactions: [transaction],
      });
      
      return signatures[0];
    });
    
    console.log('Transaction submitted:', txSignature);
    
    // Notify server about the payment immediately - server will verify on-chain
    // Don't wait for client-side confirmation as MWA session may timeout
    const serverResult = await notifyServerOfPayment(txSignature, authToken, tierGb, duration, priceInfo.sol);
    
    if (serverResult.success) {
      console.log('Payment verified by server:', txSignature);
      return {
        success: true,
        txSignature,
        solAmount: priceInfo.sol,
        usdAmount: priceInfo.usd,
        serverNotified: true,
      };
    } else {
      // Server couldn't verify - might still be pending, return partial success
      console.log('Server verification pending:', serverResult.error);
      return {
        success: true,
        txSignature,
        solAmount: priceInfo.sol,
        usdAmount: priceInfo.usd,
        serverNotified: false,
        pendingVerification: true,
      };
    }
  } catch (e) {
    // User cancelled or rejected the transaction
    if (e.message?.includes('User rejected') || e.message?.includes('cancelled') || e.message?.includes('CancellationException')) {
      return { success: false, error: 'cancelled', userCancelled: true };
    }
    // Check if we got a txSignature before the error (timeout after send)
    if (e.message?.includes('timeout') || e.message?.includes('TimeoutException')) {
      console.log('Transaction may have been sent, check wallet for confirmation');
      return { success: false, errorKey: 'transactionTimeout', timeout: true };
    }
    console.error('Payment failed:', e);
    return { success: false, errorKey: 'paymentFailed' };
  }
};

/**
 * Notify the StealthCloud server about a successful payment
 * Server will verify the transaction on-chain and activate the subscription
 */
const notifyServerOfPayment = async (txSignature, authToken, tierGb, duration, solAmount) => {
  console.log('notifyServerOfPayment called with authToken:', authToken ? 'present' : 'missing');
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const response = await axios.post(`${STEALTHCLOUD_BASE_URL}/api/solana/verify-payment`, {
      txSignature,
      tierGb,
      duration,
      solAmount,
      paymentWallet: PAYMENT_WALLET,
    }, {
      timeout: 30000,
      headers,
    });
    
    if (response.data?.success) {
      console.log('Server verified payment successfully');
      return { success: true };
    }
    
    return { success: false, error: response.data?.error || 'Verification failed' };
  } catch (e) {
    console.error('Failed to notify server:', e.message);
    // Payment was successful on-chain, server will pick it up via polling
    return { success: false, error: e.message };
  }
};

// ============================================================================
// SUBSCRIPTION STATUS
// ============================================================================

/**
 * Get current subscription status from server
 * @param {string} token - Auth token
 * @param {string} deviceUuid - Device UUID
 * @returns {Object} Subscription status
 */
export const getSubscriptionStatus = async (token, deviceUuid) => {
  try {
    const response = await axios.get(`${STEALTHCLOUD_BASE_URL}/api/cloud/usage`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-Device-UUID': deviceUuid,
      },
      timeout: 30000,
    });
    
    const data = response.data || {};
    const subscription = data.subscription || {};
    
    return {
      isActive: subscription.status === 'active' || subscription.status === 'trial',
      isInGracePeriod: subscription.status === 'grace',
      status: subscription.status || 'none',
      tierGb: data.planGb || null,
      expiresAt: subscription.expiresAt ? new Date(subscription.expiresAt) : null,
      usedBytes: data.usedBytes || 0,
      remainingBytes: data.remainingBytes || 0,
      quotaBytes: data.quotaBytes || 0,
      purchasedVia: subscription.purchased_via || subscription.purchasedVia || null,
    };
  } catch (e) {
    // Silently fail - don't spam console with subscription errors
    return {
      isActive: false,
      isInGracePeriod: false,
      status: 'unknown',
      tierGb: null,
      expiresAt: null,
    };
  }
};

/**
 * Check if user can upload (active subscription or in grace period)
 * @param {string} token - Auth token
 * @param {string} deviceUuid - Device UUID
 * @returns {Object} { canUpload, reason, message }
 */
export const checkUploadAccess = async (token, deviceUuid) => {
  const status = await getSubscriptionStatus(token, deviceUuid);
  
  if (status.isActive) {
    return { canUpload: true, reason: 'active' };
  }
  
  if (status.isInGracePeriod) {
    return {
      canUpload: false,
      canSync: true,
      reason: 'grace',
      message: 'Subscription expired. You have a few days to sync your data.',
    };
  }
  
  return {
    canUpload: false,
    canSync: false,
    reason: 'expired',
    message: 'Subscription expired. Please renew with SOL to continue.',
  };
};

// ============================================================================
// AVAILABLE PLANS
// ============================================================================

/**
 * Get all available plans with current SOL prices
 * @returns {Array} [{ tierGb, usd, sol, solFormatted, title }]
 */
export const getAvailablePlans = async () => {
  const solPrice = await fetchSolPrice();
  
  const plans = [];
  for (const [tierGb, usdPrice] of Object.entries(PLAN_PRICES_USD)) {
    const tier = parseInt(tierGb);
    const solAmount = usdPrice / solPrice;
    
    plans.push({
      tierGb: tier,
      usd: usdPrice,
      sol: solAmount,
      solFormatted: solAmount.toFixed(6),
      solPrice,
      title: tier === 1000 ? '1 TB' : `${tier} GB`,
      description: 'Monthly subscription',
      priceString: `${solAmount.toFixed(4)} SOL (~$${usdPrice})`,
    });
  }
  
  // Sort by tier size
  plans.sort((a, b) => a.tierGb - b.tierGb);
  
  return plans;
};

// ============================================================================
// TRANSACTION HISTORY
// ============================================================================

/**
 * Get recent payment transactions for the connected wallet
 * @param {number} limit - Number of transactions to fetch
 * @returns {Array} Transaction history
 */
export const getPaymentHistory = async (limit = 10) => {
  if (!solanaAvailable || !connection || !connectedWallet) {
    return [];
  }
  
  try {
    const pubkey = new PublicKey(connectedWallet);
    const recipientPubkey = new PublicKey(PAYMENT_WALLET);
    
    // Get recent signatures
    const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 50 });
    
    const payments = [];
    for (const sig of signatures) {
      try {
        const tx = await connection.getTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });
        
        if (!tx || !tx.meta) continue;
        
        // Check if this is a payment to our wallet
        const accountKeys = tx.transaction.message.staticAccountKeys || 
                           tx.transaction.message.accountKeys;
        
        const recipientIndex = accountKeys.findIndex(
          (key) => key.toBase58() === PAYMENT_WALLET
        );
        
        if (recipientIndex === -1) continue;
        
        // Get the transfer amount
        const preBalance = tx.meta.preBalances[recipientIndex];
        const postBalance = tx.meta.postBalances[recipientIndex];
        const amount = (postBalance - preBalance) / LAMPORTS_PER_SOL;
        
        if (amount > 0) {
          payments.push({
            signature: sig.signature,
            amount,
            timestamp: sig.blockTime ? new Date(sig.blockTime * 1000) : null,
            status: tx.meta.err ? 'failed' : 'confirmed',
          });
        }
        
        if (payments.length >= limit) break;
      } catch (e) {
        // Skip failed transaction fetches
      }
    }
    
    return payments;
  } catch (e) {
    console.error('Failed to get payment history:', e);
    return [];
  }
};

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  initializeSolana,
  connectWallet,
  disconnectWallet,
  getConnectedWallet,
  getWalletBalance,
  fetchSolPrice,
  usdToSol,
  getPlanPriceInSol,
  purchaseWithSol,
  getSubscriptionStatus,
  checkUploadAccess,
  getAvailablePlans,
  getPaymentHistory,
  PAYMENT_WALLET,
  PLAN_PRICES_USD,
  PLAN_DURATIONS,
  GRACE_PERIOD_DAYS,
  solanaAvailable: () => solanaAvailable,
};
