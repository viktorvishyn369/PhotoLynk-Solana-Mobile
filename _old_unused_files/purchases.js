// ============================================================================
// PURCHASES MODULE - SOLANA BLOCKCHAIN PAYMENTS
// ============================================================================
// This module now uses Solana blockchain for payments instead of RevenueCat.
// RevenueCat code is preserved in comments at the bottom for future reactivation.
//
// For Solana payments implementation, see: solanaPurchases.js
// ============================================================================

import { Platform } from 'react-native';

// Import Solana purchases module
import * as SolanaPurchases from './solanaPurchases';

// Re-export Solana functions as the primary payment interface
export const {
  initializeSolana,
  connectWallet,
  disconnectWallet,
  getConnectedWallet,
  getWalletBalance,
  fetchSolPrice,
  usdToSol,
  getPlanPriceInSol,
  purchaseWithSol,
  getPaymentHistory,
  PAYMENT_WALLET,
  PLAN_PRICES_USD,
  PLAN_DURATIONS,
} = SolanaPurchases;

// Grace period in days (matches server SUBSCRIPTION_GRACE_DAYS)
export const GRACE_PERIOD_DAYS = 3;

let isInitialized = false;

// ============================================================================
// SOLANA-BASED IMPLEMENTATIONS (Active)
// ============================================================================

/**
 * Initialize purchases - now uses Solana
 * @param {string} appUserId - User's email or unique ID
 */
export const initializePurchases = async (appUserId = null) => {
  if (isInitialized) return;
  
  try {
    const success = await SolanaPurchases.initializeSolana();
    if (success) {
      isInitialized = true;
      console.log('Solana purchases initialized successfully');
    }
  } catch (e) {
    console.error('Solana initialization failed:', e);
  }
};

/**
 * Get subscription status from server
 * @param {string} token - Auth token
 * @param {string} deviceUuid - Device UUID
 */
export const getSubscriptionStatus = async (token, deviceUuid) => {
  return SolanaPurchases.getSubscriptionStatus(token, deviceUuid);
};

/**
 * Get available plans with SOL prices
 */
export const getAvailablePlans = async () => {
  return SolanaPurchases.getAvailablePlans();
};

/**
 * Check upload access
 * @param {string} token - Auth token
 * @param {string} deviceUuid - Device UUID
 */
export const checkUploadAccess = async (token, deviceUuid) => {
  return SolanaPurchases.checkUploadAccess(token, deviceUuid);
};

/**
 * Purchase subscription with SOL
 * @param {number} tierGb - Plan tier in GB
 * @param {string} authToken - User's auth token for server authentication
 * @param {string} duration - 'monthly' or 'yearly'
 */
export const purchaseSubscription = async (tierGb, authToken, duration = 'monthly') => {
  return SolanaPurchases.purchaseWithSol(tierGb, authToken, duration);
};

/**
 * Restore purchases - checks server for existing subscription
 * @param {string} token - Auth token
 * @param {string} deviceUuid - Device UUID
 */
export const restorePurchases = async (token, deviceUuid) => {
  const status = await SolanaPurchases.getSubscriptionStatus(token, deviceUuid);
  return {
    success: status.isActive,
    hasActiveSubscription: status.isActive,
    status,
  };
};

/**
 * Get formatted price for a tier in SOL
 * @param {number} tierGb - Plan tier in GB
 */
export const getPriceForTier = async (tierGb) => {
  const price = await SolanaPurchases.getPlanPriceInSol(tierGb);
  return price.solFormatted ? `${price.solFormatted} SOL` : null;
};

// Stub functions for compatibility with existing code
export const identifyUser = async () => {};
export const logoutUser = async () => {};
export const getOfferings = async () => null;
export const addSubscriptionListener = () => () => {};

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default {
  // Solana functions
  initializeSolana: SolanaPurchases.initializeSolana,
  connectWallet: SolanaPurchases.connectWallet,
  disconnectWallet: SolanaPurchases.disconnectWallet,
  getConnectedWallet: SolanaPurchases.getConnectedWallet,
  getWalletBalance: SolanaPurchases.getWalletBalance,
  fetchSolPrice: SolanaPurchases.fetchSolPrice,
  usdToSol: SolanaPurchases.usdToSol,
  getPlanPriceInSol: SolanaPurchases.getPlanPriceInSol,
  purchaseWithSol: SolanaPurchases.purchaseWithSol,
  getPaymentHistory: SolanaPurchases.getPaymentHistory,
  PAYMENT_WALLET: SolanaPurchases.PAYMENT_WALLET,
  PLAN_PRICES_USD: SolanaPurchases.PLAN_PRICES_USD,
  PLAN_DURATIONS: SolanaPurchases.PLAN_DURATIONS,
  
  // Compatibility functions
  initializePurchases,
  identifyUser,
  logoutUser,
  getOfferings,
  getSubscriptionStatus,
  purchaseSubscription,
  restorePurchases,
  getPriceForTier,
  getAvailablePlans,
  checkUploadAccess,
  addSubscriptionListener,
  GRACE_PERIOD_DAYS,
};

// ============================================================================
// REVENUECAT CODE - COMMENTED OUT FOR POTENTIAL FUTURE REACTIVATION
// ============================================================================
// To reactivate RevenueCat:
// 1. Uncomment the code below
// 2. Add react-native-purchases to package.json
// 3. Replace the Solana implementations above with RevenueCat versions
// 4. Run npm install and rebuild native modules
// ============================================================================

/*
// RevenueCat imports
let Purchases = null;
let purchasesAvailable = false;
try {
  Purchases = require('react-native-purchases').default;
  purchasesAvailable = true;
} catch (e) {
  console.log('RevenueCat not available (native rebuild required)');
}

// RevenueCat API Keys
const REVENUECAT_API_KEY_IOS = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || 'appl_YOUR_IOS_API_KEY';
const REVENUECAT_API_KEY_ANDROID = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || 'goog_YOUR_ANDROID_API_KEY';

// Product IDs
export const PRODUCT_IDS = {
  MONTHLY_100GB: 'stealthcloud.100gb.monthly',
  MONTHLY_200GB: 'stealthcloud.200gb.monthly',
  MONTHLY_400GB: 'stealthcloud.400gb.monthly',
  MONTHLY_1TB: 'stealthcloud.1tb.monthly',
};

export const TIER_TO_PRODUCT = {
  100: PRODUCT_IDS.MONTHLY_100GB,
  200: PRODUCT_IDS.MONTHLY_200GB,
  400: PRODUCT_IDS.MONTHLY_400GB,
  1000: PRODUCT_IDS.MONTHLY_1TB,
};

export const PRODUCT_TO_TIER = {
  [PRODUCT_IDS.MONTHLY_100GB]: 100,
  [PRODUCT_IDS.MONTHLY_200GB]: 200,
  [PRODUCT_IDS.MONTHLY_400GB]: 400,
  [PRODUCT_IDS.MONTHLY_1TB]: 1000,
};

export const ENTITLEMENT_ID = 'stealthcloud_access';

export const initializePurchases_REVENUECAT = async (appUserId = null) => {
  if (isInitialized) return;
  if (!purchasesAvailable || !Purchases) {
    console.log('RevenueCat skipped (native module not available)');
    return;
  }
  
  try {
    const apiKeyRaw = Platform.OS === 'ios' ? REVENUECAT_API_KEY_IOS : REVENUECAT_API_KEY_ANDROID;
    const apiKey = (apiKeyRaw || '').trim();
    if (!apiKey || apiKey.includes('YOUR_')) {
      console.log('RevenueCat skipped (missing EXPO_PUBLIC_REVENUECAT_* key)');
      return;
    }
    
    if (appUserId) {
      await Purchases.configure({ apiKey, appUserID: appUserId });
    } else {
      await Purchases.configure({ apiKey });
    }
    
    isInitialized = true;
    console.log('RevenueCat initialized successfully');
  } catch (e) {
    console.error('RevenueCat initialization failed:', e);
    throw e;
  }
};

export const identifyUser_REVENUECAT = async (appUserId) => {
  if (!appUserId) return;
  if (!purchasesAvailable || !Purchases || !isInitialized) return;
  
  try {
    await Purchases.logIn(appUserId);
    console.log('RevenueCat user identified:', appUserId);
  } catch (e) {
    console.error('RevenueCat identify failed:', e);
  }
};

export const getSubscriptionStatus_REVENUECAT = async () => {
  if (!purchasesAvailable || !Purchases || !isInitialized) {
    return { isActive: false, isInGracePeriod: false, expiresAt: null, tierGb: null, productId: null };
  }
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
    
    if (!entitlement) {
      return { isActive: false, isInGracePeriod: false, expiresAt: null, tierGb: null, productId: null };
    }
    
    const expiresAt = entitlement.expirationDate ? new Date(entitlement.expirationDate) : null;
    const now = new Date();
    const isExpired = expiresAt && expiresAt < now;
    
    let isInGracePeriod = false;
    if (isExpired && expiresAt) {
      const gracePeriodEnd = new Date(expiresAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
      isInGracePeriod = now < gracePeriodEnd;
    }
    
    const productId = entitlement.productIdentifier;
    const tierGb = PRODUCT_TO_TIER[productId] || null;
    
    return {
      isActive: !isExpired,
      isInGracePeriod,
      expiresAt,
      tierGb,
      productId,
      willRenew: entitlement.willRenew,
      periodType: entitlement.periodType,
    };
  } catch (e) {
    // Silently fail - don't spam console with subscription errors
    return { isActive: false, isInGracePeriod: false, expiresAt: null, tierGb: null, productId: null };
  }
};

export const purchaseSubscription_REVENUECAT = async (tierGb) => {
  if (!purchasesAvailable || !Purchases || !isInitialized) {
    return { success: false, error: 'In-app purchases not available' };
  }
  try {
    const offerings = await Purchases.getOfferings();
    
    if (!offerings || !offerings.current) {
      return { success: false, error: 'No offerings available' };
    }
    
    const productId = TIER_TO_PRODUCT[tierGb];
    if (!productId) {
      return { success: false, error: 'Invalid tier' };
    }
    
    let targetPackage = null;
    const allPackages = offerings.current.availablePackages || [];
    
    for (const pkg of allPackages) {
      if (pkg.product && pkg.product.identifier === productId) {
        targetPackage = pkg;
        break;
      }
    }
    
    if (!targetPackage) {
      return { success: false, error: `Package for ${tierGb}GB not found` };
    }
    
    const { customerInfo } = await Purchases.purchasePackage(targetPackage);
    const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
    
    if (entitlement) {
      return { success: true, customerInfo };
    }
    
    return { success: false, error: 'Purchase completed but entitlement not active' };
  } catch (e) {
    if (e.userCancelled) {
      return { success: false, error: 'cancelled', userCancelled: true };
    }
    console.error('Purchase failed:', e);
    return { success: false, error: e.message || 'Purchase failed' };
  }
};

export const restorePurchases_REVENUECAT = async () => {
  if (!purchasesAvailable || !Purchases || !isInitialized) {
    return { success: false, error: 'In-app purchases not available' };
  }
  try {
    const customerInfo = await Purchases.restorePurchases();
    const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
    
    return {
      success: !!entitlement,
      customerInfo,
      hasActiveSubscription: !!entitlement,
    };
  } catch (e) {
    console.error('Restore failed:', e);
    return { success: false, error: e.message || 'Restore failed' };
  }
};

export const getAvailablePlans_REVENUECAT = async () => {
  if (!purchasesAvailable || !Purchases || !isInitialized) return [];
  try {
    const offerings = await Purchases.getOfferings();
    if (!offerings || !offerings.current) return [];
    
    const plans = [];
    const allPackages = offerings.current.availablePackages || [];
    
    for (const pkg of allPackages) {
      const productId = pkg.product?.identifier;
      const tierGb = PRODUCT_TO_TIER[productId];
      
      if (tierGb) {
        plans.push({
          tierGb,
          productId,
          price: pkg.product.price,
          priceString: pkg.product.priceString,
          title: tierGb === 1000 ? '1 TB' : `${tierGb} GB`,
          description: pkg.product.description || 'Monthly subscription',
          package: pkg,
        });
      }
    }
    
    plans.sort((a, b) => a.tierGb - b.tierGb);
    return plans;
  } catch (e) {
    console.error('Failed to get available plans:', e);
    return [];
  }
};
*/
