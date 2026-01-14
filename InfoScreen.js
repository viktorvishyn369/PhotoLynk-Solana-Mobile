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
} from 'react-native';
import { Feather } from '@expo/vector-icons';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const isTablet = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) >= 600;
const isLargeTablet = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) >= 768;

const scale = (size) => {
  if (isLargeTablet) return size * 1.35;
  if (isTablet) return size * 1.2;
  return size;
};

const scaleSpacing = (size) => {
  if (isLargeTablet) return size * 1.25;
  if (isTablet) return size * 1.15;
  return size;
};

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
const PlanCard = ({ gb, price, isCurrent, onPress, disabled, glassModeEnabled }) => (
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
      {isCurrent ? 'Current' : 'per month'}
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
      showDarkAlert('Copied!', 'Device ID copied to clipboard');
    }
  };

  const handleOpenGitHub = () => {
    Linking.openURL('https://github.com/viktorvishyn369/PhotoLynk').catch(() => {
      showDarkAlert('Error', 'Could not open link');
    });
  };

  const handleOpenDeleteAccount = () => {
    Linking.openURL('https://viktorvishyn369.github.io/PhotoLynk/delete-account.html').catch(() => {
      showDarkAlert('Error', 'Could not open link');
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
      return sub.expiresAt ? `Active until ${new Date(sub.expiresAt).toLocaleDateString()}` : 'Active';
    }
    if (subStatus === 'trial') return '7-Day Free Trial';
    if (subStatus === 'grace') return `Expired (${GRACE_PERIOD_DAYS} days to sync)`;
    if (subStatus === 'grace_expired') return 'Grace Period Ended';
    if (subStatus === 'trial_expired') return 'Trial Expired';
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
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Info</Text>
        <View style={{ width: scaleSpacing(60) }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* App Info - Two column layout */}
        <Text style={styles.sectionTitle}>App</Text>
        <Card glassModeEnabled={glassModeEnabled}>
          <View style={styles.appInfoGrid}>
            <View style={styles.appInfoItem}>
              <Feather name="smartphone" size={scale(16)} color="#888888" />
              <Text style={styles.appInfoLabel}>{appDisplayName}</Text>
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
            <Text style={styles.sectionTitle}>StealthCloud Storage</Text>
            <Card glassModeEnabled={glassModeEnabled}>
              {stealthUsageLoading && (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color="#03E1FF" />
                  <Text style={styles.loadingText}>Loading usage...</Text>
                </View>
              )}

              {stealthUsageError && (
                <View style={styles.errorContainer}>
                  <Feather name="alert-circle" size={scale(18)} color="#EF4444" />
                  <Text style={styles.errorText}>{stealthUsageError}</Text>
                </View>
              )}

              {usageData && (
                <>
                  <View style={styles.usageGrid}>
                    <UsageStat label="Plan" value={usageData.planGb ? `${usageData.planGb} GB` : '—'} />
                    <UsageStat 
                      label="Status" 
                      value={getStatusText(usageData.subStatus, usageData.sub, usageData.isExpired, usageData.isGrace)}
                      color={getStatusColor(usageData.isExpired, usageData.isGrace)}
                    />
                    <UsageStat label="Used" value={formatBytesHumanDecimal(usageData.usedBytes)} />
                    <UsageStat label="Remaining" value={formatBytesHumanDecimal(usageData.remainingBytes)} />
                  </View>

                  {(usageData.isGrace || usageData.isExpired) && (
                    <View style={styles.warningBanner}>
                      <Feather name="alert-triangle" size={scale(16)} color="#F59E0B" />
                      <Text style={styles.warningText}>
                        {usageData.isGrace && !usageData.isExpired
                          ? `Your subscription expired. You have ${GRACE_PERIOD_DAYS} days to sync your data.`
                          : 'Your subscription has expired. Renew to continue backups.'}
                      </Text>
                    </View>
                  )}

                  {/* Cross-platform payment notice - only show for Apple/Google Pay subscriptions (not Solana) */}
                  {(() => {
                    const sub = stealthUsage?.subscription || {};
                    const serverPaymentType = sub.paymentType || sub.payment_type;
                    const hasPlan = usageData.planGb;
                    const isActive = usageData.subStatus === 'active' || usageData.subStatus === 'trial';
                    
                    // Only show notice for Apple Pay or Google Play subscriptions (not Solana)
                    // Solana payments don't need a "switch to SOL" message since they're already using SOL
                    if (serverPaymentType && (serverPaymentType === 'apple' || serverPaymentType === 'google') && hasPlan && isActive) {
                      const paymentLabel = serverPaymentType === 'apple' ? 'Apple App Store' : 'Google Play Store';
                      return (
                        <View style={styles.infoBanner}>
                          <Feather name="info" size={scale(16)} color="#03E1FF" />
                          <Text style={styles.infoText}>
                            Subscription via {paymentLabel}. To switch to SOL, let it expire first.
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
            <Text style={styles.sectionTitle}>Manage Subscription</Text>
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
                    />
                  );
                })}
              </View>
            </Card>
          </>
        )}

        {/* Resources */}
        <Text style={styles.sectionTitle}>Resources</Text>
        <View style={styles.resourcesRow}>
          <TouchableOpacity
            style={styles.resourceCard}
            onPress={handleOpenGitHub}
            activeOpacity={0.7}
          >
            <View style={styles.resourceCardIcon}>
              <Feather name="github" size={scale(20)} color="#03E1FF" />
            </View>
            <Text style={styles.resourceCardTitle}>GitHub</Text>
            <Feather name="external-link" size={scale(12)} color="#666666" />
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.resourceCard}
            onPress={handleOpenDeleteAccount}
            activeOpacity={0.7}
          >
            <View style={[styles.resourceCardIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
              <Feather name="trash-2" size={scale(20)} color="#EF4444" />
            </View>
            <Text style={styles.resourceCardTitle}>Delete Account</Text>
            <Feather name="external-link" size={scale(12)} color="#666666" />
          </TouchableOpacity>
        </View>

        {/* Footer spacer */}

        <View style={{ height: scaleSpacing(40) }} />
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
    paddingTop: Math.min(60, SCREEN_HEIGHT * 0.04 + 20),
    paddingBottom: scaleSpacing(16),
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
    paddingHorizontal: scaleSpacing(20),
    paddingTop: scaleSpacing(8),
  },
  sectionTitle: {
    fontSize: scale(13),
    fontWeight: '600',
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: scaleSpacing(24),
    marginBottom: scaleSpacing(12),
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
    gap: scaleSpacing(10),
  },
  resourceCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: scale(12),
    borderWidth: 1,
    borderColor: '#2A2A2A',
    padding: scaleSpacing(12),
    gap: scaleSpacing(10),
  },
  resourceCardIcon: {
    width: scale(36),
    height: scale(36),
    borderRadius: scale(10),
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resourceCardTitle: {
    flex: 1,
    fontSize: scale(13),
    fontWeight: '600',
    color: '#FFFFFF',
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
  // Plan Grid
  planGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: scaleSpacing(12),
    gap: scaleSpacing(10),
  },
  planCard: {
    flex: 1,
    minWidth: '45%',
    maxWidth: '48%',
    backgroundColor: '#2A2A2A',
    borderRadius: scale(12),
    padding: scaleSpacing(16),
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  planCardCurrent: {
    backgroundColor: '#2A2A2A',
    borderColor: '#03E1FF',
  },
  planCardDisabled: {
    opacity: 0.5,
  },
  planCardGlass: {},
  planCardGb: {
    fontSize: scale(18),
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  planCardGbCurrent: {
    color: '#03E1FF',
  },
  planCardPrice: {
    fontSize: scale(14),
    color: '#888888',
    marginTop: scaleSpacing(4),
  },
  planCardPriceCurrent: {
    color: '#FFFFFF',
  },
  planCardMeta: {
    fontSize: scale(11),
    color: '#666666',
    marginTop: scaleSpacing(2),
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
