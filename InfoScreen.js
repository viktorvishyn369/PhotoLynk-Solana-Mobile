/**
 * InfoScreen.js
 * 
 * Professional Info UI - Clean, minimal, premium feel
 * Matches SettingsScreen theme
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Dimensions,
  ActivityIndicator,
  Linking,
  Clipboard,
  StatusBar,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { t } from './i18n';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MIN_DIMENSION = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT);

// Device categories based on viewport widths:
// iPhone SE (1st-3rd): 320px | iPhone 6/7/8/X/XS/11Pro/12mini/13mini: 375px
// iPhone 6+/7+/8+: 414px | iPhone XR/11/12/13/14: 390px | iPhone 12-15 Pro: 390-393px
// iPhone 12-15 Pro Max/Plus: 428-430px | Small Android: 320-360px
// Tablets: 600px+ | Large tablets: 768px+
const isVerySmallPhone = MIN_DIMENSION < 340; // iPhone SE 1st gen, very small Android
const isSmallPhone = MIN_DIMENSION >= 340 && MIN_DIMENSION < 375; // Small Android
const isMediumPhone = MIN_DIMENSION >= 375 && MIN_DIMENSION < 400; // iPhone X/12/13, most phones
const isLargePhone = MIN_DIMENSION >= 400 && MIN_DIMENSION < 600; // iPhone Plus/Max
const isTablet = MIN_DIMENSION >= 600;
const isLargeTablet = MIN_DIMENSION >= 768;

// Responsive scale factor based on screen width (base: 390px - iPhone 12/13)
const BASE_WIDTH = 390;
const scaleFactor = Math.min(Math.max(SCREEN_WIDTH / BASE_WIDTH, 0.75), 1.5);

// Height-based scaling for fitting content within screen bounds
// Base height: 844px (iPhone 12/13/14)
const BASE_HEIGHT = 844;
const heightRatio = SCREEN_HEIGHT / BASE_HEIGHT;
const isShortScreen = SCREEN_HEIGHT < 700; // iPhone SE, small Android
const isTallScreen = SCREEN_HEIGHT > 900; // iPhone Pro Max, tall Android

const scale = (size) => {
  let result = size;
  if (isLargeTablet) result = size * 1.3;
  else if (isTablet) result = size * 1.15;
  else if (isVerySmallPhone) result = size * 0.78;
  else if (isSmallPhone) result = size * 0.85;
  else if (isMediumPhone) result = size * 0.92;
  // Apply height-based compression for short screens
  if (isShortScreen) result *= 0.9;
  return result;
};

const scaleSpacing = (size) => {
  let result = size;
  if (isLargeTablet) result = size * 1.2;
  else if (isTablet) result = size * 1.1;
  else if (isVerySmallPhone) result = size * 0.6;
  else if (isSmallPhone) result = size * 0.7;
  else if (isMediumPhone) result = size * 0.8;
  else result = size * 0.9;
  // Apply height-based compression for short screens
  if (isShortScreen) result *= 0.75;
  return result;
};

// Calculate plan card width for 2x2 grid
// Use percentage-based width: 48% each card with 4% gap between
// This ensures 2 cards per row on ALL screen sizes

const GRACE_PERIOD_DAYS = 7;

// Format bytes to human readable
const formatBytesHumanDecimal = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1000;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Reusable Card Component
const Card = ({ children, style, glassModeEnabled }) => (
  <View style={[
    styles.card,
    glassModeEnabled && styles.cardGlass,
    style
  ]}>
    {children}
  </View>
);

// Info Row Component
const InfoRow = ({ icon, label, value, onPress, glassModeEnabled }) => (
  <TouchableOpacity
    style={[styles.infoRow, glassModeEnabled && styles.infoRowGlass]}
    onPress={onPress}
    disabled={!onPress}
    activeOpacity={onPress ? 0.7 : 1}
  >
    <View style={styles.infoRowIcon}>
      <Feather name={icon} size={scale(18)} color="#888888" />
    </View>
    <View style={styles.infoRowContent}>
      <Text style={styles.infoRowLabel}>{label}</Text>
      <Text style={styles.infoRowValue} numberOfLines={1}>{value}</Text>
    </View>
    {onPress && (
      <Feather name="copy" size={scale(16)} color="#666666" />
    )}
  </TouchableOpacity>
);

// Link Row Component
const LinkRow = ({ icon, title, subtitle, onPress, glassModeEnabled }) => (
  <TouchableOpacity
    style={[styles.linkRow, glassModeEnabled && styles.linkRowGlass]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View style={styles.linkRowIcon}>
      <Feather name={icon} size={scale(20)} color="#03E1FF" />
    </View>
    <View style={styles.linkRowContent}>
      <Text style={styles.linkRowTitle}>{title}</Text>
      {subtitle && <Text style={styles.linkRowSubtitle}>{subtitle}</Text>}
    </View>
    <Feather name="external-link" size={scale(16)} color="#666666" />
  </TouchableOpacity>
);

// Usage Stat Component
const UsageStat = ({ label, value, color }) => (
  <View style={styles.usageStat}>
    <Text style={styles.usageStatLabel}>{label}</Text>
    <Text style={[styles.usageStatValue, color && { color }]}>{value}</Text>
  </View>
);

// Plan Card Component
const PlanCard = ({ gb, price, isCurrent, onPress, disabled, glassModeEnabled, currentLabel, perMonthLabel }) => (
  <TouchableOpacity
    style={[
      styles.planCard,
      isCurrent && styles.planCardCurrent,
      disabled && styles.planCardDisabled,
      glassModeEnabled && styles.planCardGlass,
    ]}
    onPress={onPress}
    disabled={disabled || isCurrent}
    activeOpacity={0.7}
  >
    <Text style={[styles.planCardGb, isCurrent && styles.planCardGbCurrent]}>
      {gb === 1000 ? '1 TB' : `${gb} GB`}
    </Text>
    <Text style={[styles.planCardPrice, isCurrent && styles.planCardPriceCurrent]}>
      {price}
    </Text>
    <Text style={styles.planCardMeta}>
      {isCurrent ? currentLabel : perMonthLabel}
    </Text>
  </TouchableOpacity>
);

// Main Info Screen
export const InfoScreen = ({
  onBack,
  appDisplayName,
  appVersion,
  deviceUuid,
  serverType,
  stealthUsage,
  stealthUsageLoading,
  stealthUsageError,
  availablePlans,
  purchaseLoading,
  glassModeEnabled,
  showDarkAlert,
  openPaywall,
  STEALTH_PLAN_TIERS,
}) => {

  const handleCopyDeviceId = () => {
    if (deviceUuid) {
      Clipboard.setString(deviceUuid);
      showDarkAlert(t('info.copied'), t('info.deviceIdCopied'));
    }
  };

  const handleOpenGitHub = () => {
    Linking.openURL('https://github.com/viktorvishyn369/PhotoLynk/releases').catch(() => {
      showDarkAlert(t('alerts.error'), t('alerts.couldNotOpenLink'));
    });
  };

  const handleOpenDeleteAccount = () => {
    Linking.openURL('https://viktorvishyn369.github.io/PhotoLynk/delete-account.html').catch(() => {
      showDarkAlert(t('alerts.error'), t('alerts.couldNotOpenLink'));
    });
  };

  const handleOpenSupport = () => {
    Linking.openURL('mailto:support@stealthlynk.io?subject=PhotoLynk%20Support').catch(() => {
      showDarkAlert(t('alerts.error'), t('alerts.couldNotOpenLink'));
    });
  };

  // Parse StealthCloud usage data
  const getUsageData = () => {
    if (!stealthUsage) return null;
    
    const quotaBytes = Number(stealthUsage.quotaBytes ?? stealthUsage.quota_bytes ?? stealthUsage.quota ?? 0) || 0;
    const usedBytes = Number(stealthUsage.usedBytes ?? stealthUsage.used_bytes ?? stealthUsage.used ?? 0) || 0;
    const remainingBytes = Number(
      (stealthUsage.remainingBytes ?? stealthUsage.remaining_bytes ?? stealthUsage.remaining) ??
      (quotaBytes ? (quotaBytes - usedBytes) : 0)
    ) || 0;
    const sub = stealthUsage.subscription || {};
    const subStatus = sub.status || 'none';
    const isGrace = subStatus === 'grace' || subStatus === 'grace_expired';
    const isExpired = subStatus === 'trial_expired' || subStatus === 'grace_expired';
    const planGb = stealthUsage.planGb || stealthUsage.plan_gb;

    return { quotaBytes, usedBytes, remainingBytes, sub, subStatus, isGrace, isExpired, planGb };
  };

  const getStatusText = (subStatus, sub, isExpired, isGrace) => {
    if (subStatus === 'active') {
      return sub.expiresAt ? `${t('info.activeUntil')} ${new Date(sub.expiresAt).toLocaleDateString()}` : t('info.active');
    }
    if (subStatus === 'trial') return t('info.freeTrialStatus');
    if (subStatus === 'grace') return t('info.expiredGraceDays');
    if (subStatus === 'grace_expired') return t('info.gracePeriodEnded');
    if (subStatus === 'trial_expired') return t('info.trialExpired');
    return '—';
  };

  const getStatusColor = (isExpired, isGrace) => {
    if (isExpired) return '#EF4444';
    if (isGrace) return '#F59E0B';
    return '#10B981';
  };

  const usageData = getUsageData();

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('info.title')}</Text>
        <View style={{ width: scaleSpacing(60) }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
        alwaysBounceVertical={false}
        scrollEnabled={false}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.sectionsContainer}>
        {/* App Info - Two column layout */}
        <Text style={styles.sectionTitle}>{t('info.app')}</Text>
        <Card glassModeEnabled={glassModeEnabled}>
          <View style={styles.appInfoGrid}>
            <View style={styles.appInfoItem}>
              <Feather name="smartphone" size={scale(16)} color="#888888" />
              <View>
                <Text style={styles.appInfoLabel}>{appDisplayName}</Text>
                <Text style={styles.appInfoSubtitle}>stealthlynk.io</Text>
              </View>
            </View>
            <View style={styles.appInfoItem}>
              <Feather name="tag" size={scale(16)} color="#888888" />
              <Text style={styles.appInfoLabel}>v{appVersion}</Text>
            </View>
          </View>
          {deviceUuid && (
            <>
              <View style={styles.dividerFull} />
              <TouchableOpacity 
                style={styles.deviceIdRow}
                onPress={handleCopyDeviceId}
                activeOpacity={0.7}
              >
                <Feather name="hash" size={scale(16)} color="#888888" />
                <Text style={styles.deviceIdText} numberOfLines={1}>{deviceUuid}</Text>
                <Feather name="copy" size={scale(14)} color="#666666" />
              </TouchableOpacity>
            </>
          )}
        </Card>

        {/* StealthCloud Storage */}
        {serverType === 'stealthcloud' && (
          <>
            <Text style={styles.sectionTitle}>{t('info.stealthcloudStorage')}</Text>
            <Card glassModeEnabled={glassModeEnabled}>
              {/* Spinner hidden - data fetches silently in background */}

              {stealthUsageError && (
                <View style={styles.errorContainer}>
                  <Feather name="alert-circle" size={scale(18)} color="#EF4444" />
                  <Text style={styles.errorText}>{stealthUsageError}</Text>
                </View>
              )}

              {usageData && (
                <>
                  <View style={styles.usageGrid}>
                    <UsageStat label={t('info.plan')} value={usageData.planGb ? `${usageData.planGb} GB` : '—'} />
                    <UsageStat 
                      label={t('info.status')} 
                      value={getStatusText(usageData.subStatus, usageData.sub, usageData.isExpired, usageData.isGrace)}
                      color={getStatusColor(usageData.isExpired, usageData.isGrace)}
                    />
                    <UsageStat label={t('info.used')} value={formatBytesHumanDecimal(usageData.usedBytes)} />
                    <UsageStat label={t('info.remaining')} value={formatBytesHumanDecimal(usageData.remainingBytes)} />
                  </View>

                  {(usageData.isGrace || usageData.isExpired) && (
                    <View style={styles.warningBanner}>
                      <Feather name="alert-triangle" size={scale(16)} color="#F59E0B" />
                      <Text style={styles.warningText}>
                        {usageData.isGrace && !usageData.isExpired
                          ? t('info.subscriptionExpiredGrace')
                          : t('info.subscriptionExpiredRenew')}
                      </Text>
                    </View>
                  )}

                  {/* Cross-platform payment notice - only show for Apple/Google Pay subscriptions (not Solana) */}
                  {(() => {
                    const sub = stealthUsage?.subscription || {};
                    const purchasedVia = sub.purchased_via || sub.purchasedVia || sub.paymentType || sub.payment_type;
                    const hasPlan = usageData.planGb;
                    const isActive = usageData.subStatus === 'active' || usageData.subStatus === 'trial';
                    
                    // Only show notice for Apple Pay or Google Play subscriptions (not Solana)
                    // Solana payments don't need a "switch to SOL" message since they're already using SOL
                    if (purchasedVia && (purchasedVia === 'apple' || purchasedVia === 'google') && hasPlan && isActive) {
                      const paymentLabel = purchasedVia === 'apple' ? 'App Store' : 'Google Play';
                      return (
                        <View style={styles.infoBanner}>
                          <Feather name="info" size={scale(16)} color="#03E1FF" />
                          <Text style={styles.infoText}>
                            {t('info.subscriptionViaPlatform', { platform: paymentLabel })}
                          </Text>
                        </View>
                      );
                    }
                    return null;
                  })()}
                </>
              )}
            </Card>

            {/* Subscription Plans */}
            <Text style={styles.sectionTitle}>{t('info.manageSubscription')}</Text>
            <Card glassModeEnabled={glassModeEnabled}>
              <View style={styles.planGrid}>
                {STEALTH_PLAN_TIERS.map((gb) => {
                  const plan = availablePlans.find(p => p.tierGb === gb);
                  const priceStr = plan ? plan.priceString : '—';
                  const currentPlan = usageData?.planGb;
                  const isCurrent = currentPlan === gb;

                  return (
                    <PlanCard
                      key={String(gb)}
                      gb={gb}
                      price={priceStr}
                      isCurrent={isCurrent}
                      onPress={() => openPaywall(gb)}
                      disabled={purchaseLoading}
                      glassModeEnabled={glassModeEnabled}
                      currentLabel={t('info.current')}
                      perMonthLabel={t('info.perMonth')}
                    />
                  );
                })}
              </View>
            </Card>
          </>
        )}

        </View>

        {/* Resources - pushed to bottom */}
        <View style={styles.resourcesSection}>
          <Text style={[styles.sectionTitle, { marginTop: 0 }]}>{t('info.resources')}</Text>
          <View style={styles.resourcesRow}>
          <TouchableOpacity
            style={styles.resourceCard}
            onPress={handleOpenGitHub}
            activeOpacity={0.7}
          >
            <View style={styles.resourceCardIcon}>
              <Feather name="github" size={scale(18)} color="#03E1FF" />
            </View>
            <Text style={styles.resourceCardTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{t('info.github')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.resourceCard}
            onPress={handleOpenSupport}
            activeOpacity={0.7}
          >
            <View style={[styles.resourceCardIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <Feather name="mail" size={scale(18)} color="#10B981" />
            </View>
            <Text style={styles.resourceCardTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{t('info.support')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.resourceCard}
            onPress={handleOpenDeleteAccount}
            activeOpacity={0.7}
          >
            <View style={[styles.resourceCardIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <Feather name="trash-2" size={scale(18)} color="#EF4444" />
            </View>
            <Text style={styles.resourceCardTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{t('info.deleteAccount')}</Text>
          </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scaleSpacing(20),
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 8 : Math.min(60, SCREEN_HEIGHT * 0.04 + 20),
    paddingBottom: Platform.OS === 'android' ? 8 : scaleSpacing(16),
    backgroundColor: '#0A0A0A',
  },
  headerTitle: {
    fontSize: scale(22),
    fontWeight: '700',
    color: '#FFFFFF',
  },
  backButton: {
    paddingHorizontal: scaleSpacing(16),
    paddingVertical: scaleSpacing(8),
  },
  backButtonText: {
    fontSize: scale(16),
    color: '#03E1FF',
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: scaleSpacing(16),
    paddingTop: scaleSpacing(4),
    paddingBottom: Platform.OS === 'android' ? scaleSpacing(24) : scaleSpacing(20),
    justifyContent: 'space-between',
  },
  sectionsContainer: {
    flex: 1,
  },
  resourcesSection: {
    marginTop: scaleSpacing(8),
  },
  sectionTitle: {
    fontSize: scale(12),
    fontWeight: '600',
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: scaleSpacing(16),
    marginBottom: scaleSpacing(8),
    marginLeft: scaleSpacing(4),
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: scale(16),
    borderWidth: 1,
    borderColor: '#2A2A2A',
    overflow: 'hidden',
  },
  cardGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#2A2A2A',
    marginLeft: scaleSpacing(56),
  },
  dividerFull: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#2A2A2A',
  },
  // App Info Grid
  appInfoGrid: {
    flexDirection: 'row',
    paddingVertical: scaleSpacing(14),
    paddingHorizontal: scaleSpacing(16),
  },
  appInfoItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: scaleSpacing(8),
  },
  appInfoLabel: {
    fontSize: scale(15),
    fontWeight: '500',
    color: '#FFFFFF',
  },
  appInfoSubtitle: {
    fontSize: scale(11),
    fontWeight: '400',
    color: '#666666',
    marginTop: scaleSpacing(1),
  },
  deviceIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: scaleSpacing(12),
    paddingHorizontal: scaleSpacing(16),
    gap: scaleSpacing(10),
  },
  deviceIdText: {
    flex: 1,
    fontSize: scale(13),
    color: '#888888',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  // Info Row
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: scaleSpacing(14),
    paddingHorizontal: scaleSpacing(16),
  },
  infoRowGlass: {},
  infoRowIcon: {
    width: scaleSpacing(40),
    height: scaleSpacing(40),
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: scaleSpacing(12),
  },
  infoRowContent: {
    flex: 1,
  },
  infoRowLabel: {
    fontSize: scale(13),
    color: '#888888',
  },
  infoRowValue: {
    fontSize: scale(16),
    fontWeight: '500',
    color: '#FFFFFF',
    marginTop: scaleSpacing(2),
  },
  // Resources Row
  resourcesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: scaleSpacing(8),
  },
  resourceCard: {
    flex: 1,
    minWidth: scale(90),
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: scale(12),
    borderWidth: 1,
    borderColor: '#2A2A2A',
    paddingVertical: scaleSpacing(12),
    paddingHorizontal: scaleSpacing(8),
    gap: scaleSpacing(6),
  },
  resourceCardIcon: {
    width: scale(32),
    height: scale(32),
    borderRadius: scale(8),
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resourceCardTitle: {
    fontSize: scale(11),
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  // Loading & Error
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: scaleSpacing(20),
    gap: scaleSpacing(10),
  },
  loadingText: {
    fontSize: scale(14),
    color: '#888888',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: scaleSpacing(16),
    gap: scaleSpacing(10),
  },
  errorText: {
    fontSize: scale(14),
    color: '#EF4444',
    flex: 1,
  },
  // Usage Grid
  usageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: scaleSpacing(16),
  },
  usageStat: {
    width: '50%',
    paddingVertical: scaleSpacing(8),
  },
  usageStatLabel: {
    fontSize: scale(12),
    color: '#888888',
    marginBottom: scaleSpacing(4),
  },
  usageStatValue: {
    fontSize: scale(16),
    fontWeight: '600',
    color: '#FFFFFF',
  },
  // Warning & Info Banners
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    marginHorizontal: scaleSpacing(16),
    marginBottom: scaleSpacing(16),
    padding: scaleSpacing(12),
    borderRadius: scaleSpacing(10),
    gap: scaleSpacing(10),
  },
  warningText: {
    fontSize: scale(13),
    color: '#F59E0B',
    flex: 1,
    lineHeight: scale(18),
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(3, 225, 255, 0.1)',
    marginHorizontal: scaleSpacing(16),
    marginBottom: scaleSpacing(16),
    padding: scaleSpacing(12),
    borderRadius: scaleSpacing(10),
    gap: scaleSpacing(10),
  },
  infoText: {
    fontSize: scale(13),
    color: '#03E1FF',
    flex: 1,
    lineHeight: scale(18),
  },
  // Plan Grid - 2x2 responsive grid with proper gaps
  planGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: scaleSpacing(10),
    paddingVertical: scaleSpacing(10),
  },
  planCard: {
    width: '48%',
    marginBottom: scaleSpacing(10),
    backgroundColor: '#1E1E1E',
    borderRadius: scale(14),
    paddingVertical: scaleSpacing(14),
    paddingHorizontal: scaleSpacing(10),
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#333333',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  planCardCurrent: {
    backgroundColor: '#0D2A2E',
    borderColor: '#03E1FF',
    borderWidth: 2,
  },
  planCardDisabled: {
    opacity: 0.5,
  },
  planCardGlass: {},
  planCardGb: {
    fontSize: scale(20),
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  planCardGbCurrent: {
    color: '#03E1FF',
  },
  planCardPrice: {
    fontSize: scale(15),
    fontWeight: '500',
    color: '#AAAAAA',
    marginTop: scaleSpacing(6),
  },
  planCardPriceCurrent: {
    color: '#FFFFFF',
  },
  planCardMeta: {
    fontSize: scale(11),
    color: '#666666',
    marginTop: scaleSpacing(4),
    fontWeight: '400',
  },
  // Footer
  footer: {
    alignItems: 'center',
    paddingVertical: scaleSpacing(24),
  },
  footerText: {
    fontSize: scale(13),
    color: '#666666',
  },
});

export default InfoScreen;
