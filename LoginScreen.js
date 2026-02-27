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
import { LinearGradient } from 'expo-linear-gradient';
import { t } from './i18n';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SCREEN_HEIGHT_FULL = Dimensions.get('screen').height;
// Android navigation bar height detection - use minimum 48px if detection fails
const ANDROID_NAV_BAR_HEIGHT = Platform.OS === 'android' ? Math.max(48, SCREEN_HEIGHT_FULL - SCREEN_HEIGHT) : 0;
const isTablet = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) >= 600;
const isLargeTablet = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) >= 768;
// 7+ inch tablets (diagonal ~7 inches = ~600dp minimum dimension typically)
const is7InchOrLarger = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) >= 600 && Math.max(SCREEN_WIDTH, SCREEN_HEIGHT) >= 960;
const PLAN_CARDS_PER_ROW = is7InchOrLarger ? 4 : 2;

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
      <Feather name={icon} size={scale(18)} color={isSelected ? '#FFFFFF' : '#8888A0'} />
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

// Input Field Component with styled placeholder
const InputField = ({ icon, placeholder, value, onChangeText, secureTextEntry, keyboardType, autoCapitalize, autoComplete, textContentType, importantForAutofill, style }) => {
  const renderPlaceholder = () => {
    if (!placeholder || value) return null;
    
    const match = placeholder.match(/^(.*)\((.*)\)$/);
    if (!match) {
      return <Text style={styles.placeholderText}>{placeholder}</Text>;
    }
    
    const [, mainText, hintText] = match;
    return (
      <Text style={styles.placeholderText}>
        {mainText.trim()}{' '}
        <Text style={styles.placeholderHint}>({hintText})</Text>
      </Text>
    );
  };

  return (
    <View style={[styles.inputContainer, style]}>
      <View style={styles.inputIcon}>
        <Feather name={icon} size={scale(18)} color="#55556A" />
      </View>
      <TextInput
        style={styles.input}
        placeholder=""
        placeholderTextColor="#55556A"
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize || 'none'}
        autoComplete={autoComplete}
        textContentType={textContentType}
        importantForAutofill={importantForAutofill}
        editable={true}
        selectTextOnFocus={true}
      />
      <View pointerEvents="none" style={styles.placeholderWrapper}>
        {renderPlaceholder()}
      </View>
    </View>
  );
};

// Primary Button with gradient
const PrimaryButton = ({ title, onPress, loading, disabled, icon }) => (
  <TouchableOpacity
    style={[styles.primaryButton, (loading || disabled) && styles.primaryButtonDisabled]}
    onPress={onPress}
    disabled={loading || disabled}
    activeOpacity={0.8}
  >
    <LinearGradient
      colors={['#03E1FF', '#00B4CC']}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={styles.primaryButtonGradient}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#000000" />
      ) : (
        <>
          {icon && <Feather name={icon} size={scale(16)} color="#000000" style={{ marginRight: scaleSpacing(6) }} />}
          <Text style={styles.primaryButtonText}>{title}</Text>
        </>
      )}
    </LinearGradient>
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

// Plan Row Component — compact inline radio style
const PlanRow = ({ gb, price, isSelected, disabled, soldOut, onPress }) => (
  <TouchableOpacity
    style={[styles.planRow, isSelected && styles.planRowSelected, disabled && { opacity: 0.4 }]}
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.7}
  >
    <View style={[styles.planRadio, isSelected && styles.planRadioSelected]}>
      {isSelected && <View style={styles.planRadioDot} />}
    </View>
    <Text style={[styles.planRowGb, isSelected && styles.planRowGbSelected]}>
      {gb === 1000 ? '1 TB' : `${gb} GB`}
    </Text>
    <Text style={[styles.planRowPrice, isSelected && styles.planRowPriceSelected]}>
      {price ? `${price}/${t('login.perMonth')}` : '—'}
    </Text>
    {soldOut && <Text style={styles.planRowSoldOut}>SOLD OUT</Text>}
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
  const [showOtherServers, setShowOtherServers] = useState(false);

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
          <ServerOption
            icon="cloud"
            label={t('settings.stealthcloud')}
            badge={t('login.stealthcloudBadge')}
            isSelected={serverType === 'stealthcloud'}
            onPress={() => setServerType('stealthcloud')}
          />
          {authMode === 'login' ? (
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
          ) : authMode === 'register' && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.otherServersToggle}
                onPress={() => setShowOtherServers(!showOtherServers)}
                activeOpacity={0.7}
              >
                <View style={styles.otherServersToggleLeft}>
                  <Feather name="server" size={scale(16)} color="#55556A" />
                  <Text style={styles.otherServersToggleText}>{t('login.otherServers')}</Text>
                </View>
                <Feather
                  name={showOtherServers ? 'chevron-up' : 'chevron-down'}
                  size={scale(18)}
                  color="#55556A"
                />
              </TouchableOpacity>
              {showOtherServers && (
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
            </>
          )}
        </Card>
          </>
        )}

        {/* Server-specific config - Hide in forgot mode */}
        {authMode === 'login' && serverType === 'stealthcloud' && (
          <View style={styles.serverHint}>
            <Feather name="shield" size={scale(16)} color="#03E1FF" />
            <Text style={styles.serverHintText}>
              {t('login.stealthcloudHint')}
            </Text>
          </View>
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
              {STEALTH_PLAN_TIERS.map((gb) => {
                const st = getStealthCloudTierStatus(gb);
                const disabled = st.canCreate === false || purchaseLoading;
                const selected = selectedStealthPlanGb === gb;
                const plan = availablePlans.find(p => p.tierGb === gb);
                const priceStr = plan ? plan.priceString : null;
                return (
                  <PlanRow
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

        {/* Local Network Config - After credentials, before terms */}
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

        {/* Remote Server Config - After credentials, before terms */}
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

        {/* Spacer — pushes footer down when content is short */}
        <View style={{ flexGrow: 1, minHeight: scaleSpacing(20) }} />

        {/* Footer */}
        <View style={styles.footer}>
          <Feather name="shield" size={scale(14)} color="#55556A" />
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
    backgroundColor: '#060608',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: scaleSpacing(20),
    paddingTop: Platform.OS === 'ios' ? scaleSpacing(20) : (StatusBar.currentHeight || 24),
    paddingBottom: scaleSpacing(30),
  },
  // Header
  header: {
    alignItems: 'center',
    marginBottom: scaleSpacing(8),
    paddingTop: scaleSpacing(10),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scaleSpacing(14),
  },
  headerTitleWrap: {
    alignItems: 'flex-start',
  },
  appIcon: {
    width: isTablet ? 64 : 48,
    height: isTablet ? 64 : 48,
    borderRadius: isTablet ? 14 : 10,
  },
  title: {
    fontSize: scale(24),
    fontWeight: '700',
    color: '#FFFFFF',
  },
  titleScript: {
    fontStyle: 'italic',
    fontWeight: '400',
  },
  subtitle: {
    fontSize: scale(12),
    color: '#8888A0',
    marginTop: scaleSpacing(2),
  },
  // Section
  sectionTitle: {
    fontSize: scale(12),
    fontWeight: '600',
    color: '#8888A0',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: scaleSpacing(18),
    marginBottom: scaleSpacing(8),
    marginLeft: scaleSpacing(4),
  },
  // Card
  card: {
    backgroundColor: '#10101A',
    borderRadius: scale(16),
    borderWidth: 1,
    borderColor: '#1A1A24',
    overflow: 'hidden',
    padding: scaleSpacing(4),
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#1A1A24',
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
    backgroundColor: '#1A1A24',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: scaleSpacing(12),
  },
  serverOptionIconSelected: {
    backgroundColor: 'rgba(3, 225, 255, 0.15)',
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
    color: '#55556A',
    fontWeight: '500',
  },
  serverHintText: {
    flex: 1,
    fontSize: scale(13),
    color: '#8888A0',
    lineHeight: scale(18),
  },
  // Input
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#060608',
    borderRadius: scaleSpacing(12),
    borderWidth: 1,
    borderColor: '#1A1A24',
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
    backgroundColor: '#060608',
  },
  placeholderWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  placeholderText: {
    marginLeft: scaleSpacing(48),
    fontSize: scale(13),
    color: '#55556A',
  },
  placeholderHint: {
    fontSize: scale(11),
    color: '#55556A',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputHint: {
    fontSize: scale(12),
    color: '#55556A',
    marginTop: scaleSpacing(8),
    marginLeft: scaleSpacing(4),
  },
  qrButton: {
    width: scaleSpacing(48),
    height: scaleSpacing(48),
    borderRadius: scaleSpacing(12),
    backgroundColor: '#1A1A24',
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
    color: '#8888A0',
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: scaleSpacing(10),
    paddingHorizontal: scaleSpacing(12),
    borderRadius: scaleSpacing(8),
    marginHorizontal: scaleSpacing(4),
    marginBottom: scaleSpacing(2),
  },
  planRowSelected: {
    backgroundColor: 'rgba(3, 225, 255, 0.08)',
  },
  planRadio: {
    width: scaleSpacing(20),
    height: scaleSpacing(20),
    borderRadius: scaleSpacing(10),
    borderWidth: 2,
    borderColor: '#35354A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: scaleSpacing(12),
  },
  planRadioSelected: {
    borderColor: '#03E1FF',
  },
  planRadioDot: {
    width: scaleSpacing(10),
    height: scaleSpacing(10),
    borderRadius: scaleSpacing(5),
    backgroundColor: '#03E1FF',
  },
  planRowGb: {
    fontSize: scale(14),
    fontWeight: '700',
    color: '#F0F0F5',
    minWidth: scale(50),
  },
  planRowGbSelected: {
    color: '#03E1FF',
  },
  planRowPrice: {
    flex: 1,
    fontSize: scale(12),
    color: '#8888A0',
    textAlign: 'right',
  },
  planRowPriceSelected: {
    color: '#F0F0F5',
  },
  planRowSoldOut: {
    fontSize: scale(9),
    fontWeight: '700',
    color: '#D4A017',
    marginLeft: scaleSpacing(8),
    letterSpacing: 0.5,
  },
  planHint: {
    fontSize: scale(12),
    color: '#55556A',
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
    color: '#8888A0',
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
    borderColor: '#35354A',
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
    color: '#8888A0',
    lineHeight: scale(20),
  },
  termsLink: {
    color: '#03E1FF',
    textDecorationLine: 'underline',
  },
  // Action Buttons
  actionButtons: {
    marginTop: scaleSpacing(20),
    gap: scaleSpacing(10),
  },
  primaryButton: {
    borderRadius: scaleSpacing(12),
    overflow: 'hidden',
    shadowColor: '#03E1FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  primaryButtonGradient: {
    flexDirection: 'row',
    paddingVertical: scaleSpacing(14),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: scaleSpacing(12),
  },
  primaryButtonDisabled: {
    opacity: 0.5,
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryButtonText: {
    fontSize: scale(15),
    fontWeight: '700',
    color: '#000000',
  },
  secondaryButton: {
    paddingVertical: scaleSpacing(14),
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: scale(15),
    color: '#8888A0',
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
    marginTop: scaleSpacing(24),
    gap: scaleSpacing(8),
  },
  footerText: {
    fontSize: scale(12),
    color: '#55556A',
  },
});

export default LoginScreen;
