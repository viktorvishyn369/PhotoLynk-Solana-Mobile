/**
 * LoginScreen.js
 * 
 * Professional Login UI - Clean, minimal, premium feel
 * Matches SettingsScreen/InfoScreen theme
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Platform,
  Dimensions,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  StatusBar,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { t } from './i18n';

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

// Reusable Card Component
const Card = ({ children, style }) => (
  <View style={[styles.card, style]}>
    {children}
  </View>
);

// Server Option Button
const ServerOption = ({ icon, label, badge, isSelected, onPress }) => (
  <TouchableOpacity
    style={[styles.serverOption, isSelected && styles.serverOptionSelected]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View style={[styles.serverOptionIcon, isSelected && styles.serverOptionIconSelected]}>
      <Feather name={icon} size={scale(18)} color={isSelected ? '#FFFFFF' : '#888888'} />
    </View>
    <Text style={[styles.serverOptionLabel, isSelected && styles.serverOptionLabelSelected]}>
      {label}
    </Text>
    {badge && (
      <View style={styles.serverOptionBadge}>
        <Text style={styles.serverOptionBadgeText}>{badge}</Text>
      </View>
    )}
  </TouchableOpacity>
);

// Input Field Component
const InputField = ({ icon, placeholder, value, onChangeText, secureTextEntry, keyboardType, autoCapitalize, autoComplete, textContentType, importantForAutofill, style }) => (
  <View style={[styles.inputContainer, style]}>
    <View style={styles.inputIcon}>
      <Feather name={icon} size={scale(18)} color="#666666" />
    </View>
    <TextInput
      style={styles.input}
      placeholder={placeholder}
      placeholderTextColor="#666666"
      value={value}
      onChangeText={onChangeText}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize || 'none'}
      autoComplete={autoComplete}
      textContentType={textContentType}
      importantForAutofill={importantForAutofill}
    />
  </View>
);

// Primary Button
const PrimaryButton = ({ title, onPress, loading, disabled, icon }) => (
  <TouchableOpacity
    style={[styles.primaryButton, (loading || disabled) && styles.primaryButtonDisabled]}
    onPress={onPress}
    disabled={loading || disabled}
    activeOpacity={0.8}
  >
    {loading ? (
      <ActivityIndicator size="small" color="#000000" />
    ) : (
      <>
        {icon && <Feather name={icon} size={scale(18)} color="#000000" style={{ marginRight: scaleSpacing(8) }} />}
        <Text style={styles.primaryButtonText}>{title}</Text>
      </>
    )}
  </TouchableOpacity>
);

// Secondary Button
const SecondaryButton = ({ title, onPress, disabled }) => (
  <TouchableOpacity
    style={styles.secondaryButton}
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.7}
  >
    <Text style={styles.secondaryButtonText}>{title}</Text>
  </TouchableOpacity>
);

// Link Button
const LinkButton = ({ title, onPress, color }) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
    <Text style={[styles.linkButton, color && { color }]}>{title}</Text>
  </TouchableOpacity>
);

// Plan Card Component
const PlanCard = ({ gb, price, isSelected, disabled, soldOut, onPress }) => (
  <TouchableOpacity
    style={[
      styles.planCard,
      isSelected && styles.planCardSelected,
      disabled && styles.planCardDisabled,
    ]}
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.8}
  >
    <Text style={[styles.planCardGb, isSelected && styles.planCardGbSelected]}>
      {gb === 1000 ? '1 TB' : `${gb} GB`}
    </Text>
    <Text style={[styles.planCardPrice, isSelected && styles.planCardPriceSelected]}>
      {price || '—'}
    </Text>
    <Text style={styles.planCardMeta}>{t('login.perMonth')}</Text>
    {soldOut && (
      <View style={styles.soldOutBadge}>
        <Text style={styles.soldOutText}>SOLD OUT</Text>
      </View>
    )}
  </TouchableOpacity>
);

// Main Login Screen
export const LoginScreen = ({
  appDisplayName,
  appIcon,
  serverType,
  setServerType,
  authMode,
  setAuthMode,
  isFirstRun = false,
  email,
  setEmail,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  newPassword,
  setNewPassword,
  localHost,
  setLocalHost,
  remoteHost,
  setRemoteHost,
  termsAccepted,
  setTermsAccepted,
  selectedStealthPlanGb,
  setSelectedStealthPlanGb,
  loading,
  authLoadingLabel,
  handleAuth,
  handleResetPassword,
  normalizeHostInput,
  openQrScanner,
  openQuickSetupGuide,
  STEALTH_PLAN_TIERS,
  availablePlans,
  getStealthCloudTierStatus,
  stealthCapacityLoading,
  stealthCapacityError,
  stealthCapacity,
  plansLoading,
  purchaseLoading,
}) => {
  // State for collapsed other servers section
  const [showOtherServers, setShowOtherServers] = useState(serverType !== 'stealthcloud');

  // Auto-expand if non-stealthcloud server is selected
  const isOtherServerSelected = serverType === 'local' || serverType === 'remote';

  const handleOpenTerms = () => {
    Linking.openURL('https://viktorvishyn369.github.io/PhotoLynk/terms.html');
  };

  const handleOpenPrivacy = () => {
    Linking.openURL('https://viktorvishyn369.github.io/PhotoLynk/privacy-policy.html');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={true}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Image source={appIcon} style={styles.appIcon} />
            <View style={styles.headerTitleWrap}>
              <Text style={styles.title}>PhotoLynk</Text>
              <Text style={styles.subtitle}>{t('app.tagline')}</Text>
            </View>
          </View>
        </View>

        {/* Server Selection - Hide in forgot mode */}
        {authMode !== 'forgot' && (
          <>
        <Text style={styles.sectionTitle}>{t('login.chooseServer')}</Text>
        <Card>
          {/* StealthCloud - always shown as primary option */}
          <ServerOption
            icon="cloud"
            label={t('settings.stealthcloud')}
            badge={t('login.stealthcloudBadge')}
            isSelected={serverType === 'stealthcloud'}
            onPress={() => {
              setServerType('stealthcloud');
              setShowOtherServers(false);
            }}
          />
          
          {/* Other Servers - Collapsible */}
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.otherServersToggle}
            onPress={() => setShowOtherServers(!showOtherServers)}
            activeOpacity={0.7}
          >
            <View style={styles.otherServersToggleLeft}>
              <Feather name="server" size={scale(16)} color="#666666" />
              <Text style={styles.otherServersToggleText}>{t('login.otherServers')}</Text>
            </View>
            <Feather 
              name={showOtherServers || isOtherServerSelected ? "chevron-up" : "chevron-down"} 
              size={scale(18)} 
              color="#666666" 
            />
          </TouchableOpacity>
          
          {/* Expanded other servers */}
          {(showOtherServers || isOtherServerSelected) && (
            <>
              <View style={styles.divider} />
              <ServerOption
                icon="wifi"
                label={t('login.localNetwork')}
                isSelected={serverType === 'local'}
                onPress={() => setServerType('local')}
              />
              <View style={styles.divider} />
              <ServerOption
                icon="globe"
                label={t('settings.remoteServer')}
                isSelected={serverType === 'remote'}
                onPress={() => setServerType('remote')}
              />
            </>
          )}
        </Card>
          </>
        )}

        {/* Server-specific config - Hide in forgot mode */}
        {authMode !== 'forgot' && serverType === 'stealthcloud' && (
          <View style={styles.serverHint}>
            <Feather name="shield" size={scale(16)} color="#03E1FF" />
            <Text style={styles.serverHintText}>
              {t('login.stealthcloudHint')}
            </Text>
          </View>
        )}

        {authMode !== 'forgot' && serverType === 'local' && (
          <Card style={{ marginTop: scaleSpacing(16) }}>
            <View style={styles.inputRow}>
              <InputField
                icon="wifi"
                placeholder={t('login.enterLocalIp')}
                value={localHost}
                onChangeText={(t) => setLocalHost(normalizeHostInput(t))}
                keyboardType="url"
                autoComplete="off"
                importantForAutofill="no"
                style={{ flex: 1, marginRight: scaleSpacing(10) }}
              />
              <TouchableOpacity style={styles.qrButton} onPress={openQrScanner}>
                <Feather name="maximize" size={scale(20)} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <Text style={styles.inputHint}>{t('login.localIpHint')}</Text>
            <TouchableOpacity style={styles.quickSetupLinkInline} onPress={openQuickSetupGuide}>
              <Feather name="book-open" size={scale(14)} color="#03E1FF" />
              <Text style={styles.quickSetupTextInline}>{t('login.quickSetupGuide')}</Text>
            </TouchableOpacity>
          </Card>
        )}

        {authMode !== 'forgot' && serverType === 'remote' && (
          <Card style={{ marginTop: scaleSpacing(16) }}>
            <InputField
              icon="globe"
              placeholder={t('login.enterRemoteDomain')}
              value={remoteHost}
              onChangeText={(t) => setRemoteHost(normalizeHostInput(t))}
              keyboardType="url"
              autoComplete="off"
              importantForAutofill="no"
            />
            <Text style={styles.inputHint}>{t('login.remoteDomainHint')}</Text>
            <TouchableOpacity style={styles.quickSetupLinkInline} onPress={openQuickSetupGuide}>
              <Feather name="book-open" size={scale(14)} color="#03E1FF" />
              <Text style={styles.quickSetupTextInline}>{t('login.quickSetupGuide')}</Text>
            </TouchableOpacity>
          </Card>
        )}

        {/* Plan Selection (StealthCloud Register only) - Hide in forgot mode */}
        {authMode !== 'forgot' && serverType === 'stealthcloud' && authMode === 'register' && (
          <>
            <Text style={styles.sectionTitle}>{t('login.choosePlan')}</Text>
            <Card>
              <View style={styles.planHeader}>
                <Text style={styles.planHeaderText}>{t('login.freeTrialCancel')}</Text>
                {(stealthCapacityLoading || plansLoading) && (
                  <ActivityIndicator size="small" color="#03E1FF" />
                )}
              </View>
              <View style={styles.planGrid}>
                {STEALTH_PLAN_TIERS.map((gb) => {
                  const st = getStealthCloudTierStatus(gb);
                  const disabled = st.canCreate === false || purchaseLoading;
                  const selected = selectedStealthPlanGb === gb;
                  const plan = availablePlans.find(p => p.tierGb === gb);
                  const priceStr = plan ? plan.priceString : null;
                  return (
                    <PlanCard
                      key={String(gb)}
                      gb={gb}
                      price={priceStr}
                      isSelected={selected}
                      disabled={disabled}
                      soldOut={st.canCreate === false}
                      onPress={() => !disabled && setSelectedStealthPlanGb(gb)}
                    />
                  );
                })}
              </View>
              {stealthCapacityError && (
                <Text style={styles.planHint}>{t('login.capacityCheckUnavailable')}</Text>
              )}
            </Card>
          </>
        )}

        {/* Credentials */}
        <Text style={styles.sectionTitle}>
          {authMode === 'forgot' ? t('auth.resetPassword') : t('login.credentials')}
        </Text>
        <Card>
          {authMode !== 'forgot' && (
            <InputField
              icon="user"
              placeholder={t('login.emailOrSeekerIdPlaceholder')}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="username"
            />
          )}

          {(authMode === 'login' || authMode === 'register') && (
            <InputField
              icon="lock"
              placeholder={t('login.passwordPlaceholder')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              style={{ marginTop: scaleSpacing(12) }}
            />
          )}

          {authMode === 'register' && (
            <InputField
              icon="lock"
              placeholder={t('auth.confirmPassword')}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              style={{ marginTop: scaleSpacing(12) }}
            />
          )}

          {authMode === 'forgot' && (
            <>
              <Text style={styles.forgotHint}>
                {t('login.forgotHint')}
              </Text>
              <InputField
                icon="lock"
                placeholder={t('login.newPasswordPlaceholder')}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                style={{ marginTop: scaleSpacing(12) }}
              />
            </>
          )}
        </Card>

        {/* Terms Checkbox (Register only) */}
        {authMode === 'register' && (
          <TouchableOpacity
            style={styles.termsRow}
            onPress={() => setTermsAccepted(!termsAccepted)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}>
              {termsAccepted && <Feather name="check" size={scale(14)} color="#FFFFFF" />}
            </View>
            <Text style={styles.termsText}>
              {t('login.agreeToThe')}{' '}
              <Text style={styles.termsLink} onPress={handleOpenTerms}>{t('settings.termsOfService')}</Text>
              {' '}{t('common.and')}{' '}
              <Text style={styles.termsLink} onPress={handleOpenPrivacy}>{t('settings.privacyPolicy')}</Text>
            </Text>
          </TouchableOpacity>
        )}

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          {authMode === 'login' && (
            <>
              <PrimaryButton
                title={loading ? authLoadingLabel : t('auth.login')}
                onPress={() => handleAuth('login')}
                loading={loading}
                icon="log-in"
              />
              <View style={styles.authLinks}>
                <LinkButton title={t('auth.createAccount')} onPress={() => {
                  setAuthMode('register');
                  setConfirmPassword('');
                  setTermsAccepted(false);
                }} color="#03E1FF" />
                <LinkButton title={t('auth.forgotPassword')} onPress={() => setAuthMode('forgot')} color="#888888" />
              </View>
            </>
          )}

          {authMode === 'register' && (
            <>
              <PrimaryButton
                title={loading ? t('auth.registering') : t('auth.createAccount')}
                onPress={() => handleAuth('register')}
                loading={loading}
                disabled={!termsAccepted}
                icon="user-plus"
              />
              <SecondaryButton
                title={t('login.backToLogin')}
                onPress={() => {
                  setAuthMode('login');
                  setConfirmPassword('');
                  setTermsAccepted(false);
                }}
                disabled={loading}
              />
            </>
          )}

          {authMode === 'forgot' && (
            <>
              <PrimaryButton
                title={loading ? authLoadingLabel : t('auth.resetPassword')}
                onPress={handleResetPassword}
                loading={loading}
                icon="refresh-cw"
              />
              <SecondaryButton
                title={t('login.backToLogin')}
                onPress={() => {
                  setAuthMode('login');
                  setNewPassword('');
                }}
                disabled={loading}
              />
            </>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Feather name="shield" size={scale(14)} color="#666666" />
          <Text style={styles.footerText}>{t('login.footerText')}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: scaleSpacing(20),
    paddingTop: scaleSpacing(40),
    paddingBottom: scaleSpacing(40),
  },
  // Header
  header: {
    marginBottom: scaleSpacing(12),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scaleSpacing(14),
  },
  headerTitleWrap: {
    alignItems: 'flex-start',
  },
  appIcon: {
    width: isTablet ? 70 : 56,
    height: isTablet ? 70 : 56,
    borderRadius: isTablet ? 16 : 12,
  },
  title: {
    fontSize: scale(28),
    fontWeight: '700',
    color: '#FFFFFF',
  },
  titleScript: {
    fontStyle: 'italic',
    fontWeight: '400',
  },
  subtitle: {
    fontSize: scale(12),
    color: '#888888',
    marginTop: scaleSpacing(2),
  },
  // Section
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
  // Card
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: scale(16),
    borderWidth: 1,
    borderColor: '#2A2A2A',
    overflow: 'hidden',
    padding: scaleSpacing(4),
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#2A2A2A',
    marginLeft: scaleSpacing(56),
  },
  // Server Option
  serverOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: scaleSpacing(14),
    paddingHorizontal: scaleSpacing(12),
    borderRadius: scaleSpacing(12),
  },
  serverOptionSelected: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#03E1FF',
  },
  serverOptionIcon: {
    width: scaleSpacing(40),
    height: scaleSpacing(40),
    borderRadius: scaleSpacing(10),
    backgroundColor: '#2A2A2A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: scaleSpacing(12),
  },
  serverOptionIconSelected: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  serverOptionLabel: {
    flex: 1,
    fontSize: scale(16),
    fontWeight: '600',
    color: '#FFFFFF',
  },
  serverOptionLabelSelected: {
    color: '#FFFFFF',
  },
  serverOptionBadge: {
    backgroundColor: '#16A34A',
    paddingHorizontal: scaleSpacing(8),
    paddingVertical: scaleSpacing(4),
    borderRadius: scaleSpacing(6),
    marginRight: scaleSpacing(8),
  },
  serverOptionBadgeText: {
    color: '#FFFFFF',
    fontSize: scale(10),
    fontWeight: '700',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  serverOptionCheck: {
    width: scaleSpacing(24),
    height: scaleSpacing(24),
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Server Hint
  serverHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    marginTop: scaleSpacing(12),
    padding: scaleSpacing(12),
    borderRadius: scaleSpacing(12),
    gap: scaleSpacing(10),
  },
  // Other Servers Toggle
  otherServersToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: scaleSpacing(12),
    paddingHorizontal: scaleSpacing(12),
  },
  otherServersToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scaleSpacing(10),
  },
  otherServersToggleText: {
    fontSize: scale(14),
    color: '#666666',
    fontWeight: '500',
  },
  serverHintText: {
    flex: 1,
    fontSize: scale(13),
    color: '#888888',
    lineHeight: scale(18),
  },
  // Input
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A0A0A',
    borderRadius: scaleSpacing(12),
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  inputIcon: {
    width: scaleSpacing(48),
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    paddingVertical: scaleSpacing(16),
    paddingRight: scaleSpacing(16),
    fontSize: scale(13),
    color: '#FFFFFF',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputHint: {
    fontSize: scale(12),
    color: '#666666',
    marginTop: scaleSpacing(8),
    marginLeft: scaleSpacing(4),
  },
  qrButton: {
    width: scaleSpacing(48),
    height: scaleSpacing(48),
    borderRadius: scaleSpacing(12),
    backgroundColor: '#2A2A2A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Plan
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: scaleSpacing(12),
    paddingVertical: scaleSpacing(12),
  },
  planHeaderText: {
    fontSize: scale(13),
    color: '#888888',
  },
  planGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: scaleSpacing(8),
    gap: scaleSpacing(10),
  },
  planCard: {
    width: (SCREEN_WIDTH - scaleSpacing(40) - scaleSpacing(8) - scaleSpacing(30)) / 2,
    backgroundColor: '#2A2A2A',
    borderRadius: scaleSpacing(12),
    padding: scaleSpacing(16),
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  planCardSelected: {
    borderColor: '#03E1FF',
    backgroundColor: 'rgba(3, 225, 255, 0.15)',
  },
  planCardDisabled: {
    opacity: 0.5,
  },
  planCardGb: {
    fontSize: scale(18),
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  planCardGbSelected: {
    color: '#03E1FF',
  },
  planCardPrice: {
    fontSize: scale(14),
    color: '#888888',
    marginTop: scaleSpacing(4),
  },
  planCardPriceSelected: {
    color: '#FFFFFF',
  },
  planCardMeta: {
    fontSize: scale(11),
    color: '#666666',
    marginTop: scaleSpacing(2),
  },
  soldOutBadge: {
    position: 'absolute',
    top: scaleSpacing(6),
    right: scaleSpacing(6),
    backgroundColor: '#D4A017',
    paddingHorizontal: scaleSpacing(6),
    paddingVertical: scaleSpacing(2),
    borderRadius: scaleSpacing(4),
  },
  soldOutText: {
    color: '#000000',
    fontSize: scale(9),
    fontWeight: '700',
  },
  planHint: {
    fontSize: scale(12),
    color: '#666666',
    textAlign: 'center',
    paddingHorizontal: scaleSpacing(12),
    paddingBottom: scaleSpacing(12),
  },
  // Quick Setup (inline in server cards)
  quickSetupLinkInline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: scaleSpacing(12),
    gap: scaleSpacing(6),
  },
  quickSetupTextInline: {
    fontSize: scale(13),
    color: '#03E1FF',
    fontWeight: '500',
  },
  // Forgot
  forgotHint: {
    fontSize: scale(14),
    color: '#888888',
    lineHeight: scale(20),
    marginBottom: scaleSpacing(8),
  },
  // Terms
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: scaleSpacing(16),
    gap: scaleSpacing(12),
  },
  checkbox: {
    width: scaleSpacing(24),
    height: scaleSpacing(24),
    borderRadius: scaleSpacing(6),
    borderWidth: 2,
    borderColor: '#444444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#03E1FF',
    borderColor: '#03E1FF',
  },
  termsText: {
    flex: 1,
    fontSize: scale(13),
    color: '#888888',
    lineHeight: scale(20),
  },
  termsLink: {
    color: '#03E1FF',
    textDecorationLine: 'underline',
  },
  // Action Buttons
  actionButtons: {
    marginTop: scaleSpacing(24),
    gap: scaleSpacing(12),
  },
  primaryButton: {
    flexDirection: 'row',
    backgroundColor: '#03E1FF',
    paddingVertical: scaleSpacing(16),
    borderRadius: scaleSpacing(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontSize: scale(16),
    fontWeight: '700',
    color: '#000000',
  },
  secondaryButton: {
    paddingVertical: scaleSpacing(14),
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: scale(15),
    color: '#888888',
    fontWeight: '600',
  },
  authLinks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: scaleSpacing(4),
  },
  linkButton: {
    fontSize: scale(14),
    color: '#03E1FF',
    fontWeight: '600',
  },
  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: scaleSpacing(32),
    gap: scaleSpacing(8),
  },
  footerText: {
    fontSize: scale(12),
    color: '#666666',
  },
});

export default LoginScreen;
