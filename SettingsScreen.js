/**
 * SettingsScreen.js
 * 
 * Professional Settings UI - Clean, minimal, premium feel
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  StyleSheet,
  Platform,
  Dimensions,
  StatusBar,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { t, SUPPORTED_LANGUAGES, isUsingEnglish, setUseEnglish, getSystemLanguage, getCurrentLanguage } from './i18n';

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

// Height-based scaling for fitting content within screen bounds
// Base height: 844px (iPhone 12/13/14)
const BASE_HEIGHT = 844;
const heightRatio = SCREEN_HEIGHT / BASE_HEIGHT;
const isShortScreen = SCREEN_HEIGHT < 700; // iPhone SE, small Android
const isTallScreen = SCREEN_HEIGHT > 900; // iPhone Pro Max, tall Android

// Responsive scale factor based on screen width (base: 390px - iPhone 12/13)
const BASE_WIDTH = 390;
const scaleFactor = Math.min(Math.max(SCREEN_WIDTH / BASE_WIDTH, 0.75), 1.5);

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

// Server Option Button
const ServerOption = ({ icon, label, description, isSelected, onPress, glassModeEnabled }) => (
  <TouchableOpacity
    style={[
      styles.serverOption,
      isSelected && styles.serverOptionSelected,
      glassModeEnabled && styles.serverOptionGlass,
    ]}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View style={[styles.serverOptionIcon, isSelected && styles.serverOptionIconSelected]}>
      <Feather name={icon} size={scale(20)} color={isSelected ? '#FFFFFF' : '#888888'} />
    </View>
    <View style={styles.serverOptionContent}>
      <Text style={[styles.serverOptionLabel, isSelected && styles.serverOptionLabelSelected]}>
        {label}
      </Text>
      {description && (
        <Text style={styles.serverOptionDesc}>{description}</Text>
      )}
    </View>
  </TouchableOpacity>
);

// Toggle Setting Row
const ToggleSetting = ({ icon, title, subtitle, value, onValueChange, glassModeEnabled }) => (
  <View style={[styles.settingRow, glassModeEnabled && styles.settingRowGlass]}>
    <View style={styles.settingIcon}>
      <Feather name={icon} size={scale(20)} color="#888888" />
    </View>
    <View style={styles.settingContent}>
      <Text style={styles.settingTitle}>{title}</Text>
      {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: '#3A3A3C', true: '#03E1FF' }}
      thumbColor="#FFFFFF"
      ios_backgroundColor="#3A3A3C"
    />
  </View>
);

// Action Button
const ActionButton = ({ title, subtitle, onPress, danger, disabled, glassModeEnabled }) => (
  <TouchableOpacity
    style={[
      styles.actionButton,
      danger && styles.actionButtonDanger,
      disabled && styles.actionButtonDisabled,
      glassModeEnabled && styles.actionButtonGlass,
    ]}
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.7}
  >
    <Text style={[styles.actionButtonText, danger && styles.actionButtonTextDanger]}>
      {title}
    </Text>
    {subtitle && <Text style={styles.actionButtonSubtitle}>{subtitle}</Text>}
  </TouchableOpacity>
);

// Main Settings Screen
export const SettingsScreen = ({
  onBack,
  serverType,
  setServerType,
  localHost,
  setLocalHost,
  remoteHost,
  setRemoteHost,
  getServerUrl,
  autoUploadEnabled,
  persistAutoUploadEnabled,
  fastModeEnabled,
  persistFastModeEnabled,
  glassModeEnabled,
  persistGlassModeEnabled,
  loading,
  logout,
  relogin,
  purgeStealthCloudData,
  purgeClassicServerData,
  showDarkAlert,
  onQrScan,
  normalizeHostInput,
  SecureStore,
  currentLanguage,
  onLanguageChange,
}) => {
  const [useEnglish, setUseEnglishState] = useState(isUsingEnglish());
  const systemLang = getSystemLanguage();
  const systemLangInfo = SUPPORTED_LANGUAGES.find(l => l.code === systemLang);
  const currentLangInfo = SUPPORTED_LANGUAGES.find(l => l.code === currentLanguage);

  const handleLanguageToggle = async (value) => {
    setUseEnglishState(value);
    await setUseEnglish(value);
    onLanguageChange(value ? 'en' : systemLang);
  };

  const handleServerTypeChange = async (type) => {
    if (type === 'stealthcloud') {
      await SecureStore.setItemAsync('server_type', 'stealthcloud');
      setServerType('stealthcloud');
      await logout();
    } else {
      setServerType(type);
    }
  };

  const handleSaveSettings = async () => {
    await SecureStore.setItemAsync('server_type', serverType);
    if (serverType === 'remote') {
      await SecureStore.setItemAsync('remote_host', remoteHost);
    } else if (serverType === 'local') {
      await SecureStore.setItemAsync('local_host', localHost);
    }
    // Relogin with new server settings instead of logging out
    if (relogin) {
      await relogin(serverType);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('settings.title')}</Text>
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
        {/* Server Selection */}
        <Text style={styles.sectionTitle}>{t('settings.server')}</Text>
        <Card glassModeEnabled={glassModeEnabled}>
          <ServerOption
            icon="cloud"
            label={t('settings.stealthcloud')}
            description={t('settings.stealthcloudDesc')}
            isSelected={serverType === 'stealthcloud'}
            onPress={() => handleServerTypeChange('stealthcloud')}
            glassModeEnabled={glassModeEnabled}
          />
          <View style={styles.divider} />
          <ServerOption
            icon="wifi"
            label={t('settings.localServer')}
            description={t('settings.localServerDesc')}
            isSelected={serverType === 'local'}
            onPress={() => handleServerTypeChange('local')}
            glassModeEnabled={glassModeEnabled}
          />
          <View style={styles.divider} />
          <ServerOption
            icon="globe"
            label={t('settings.remoteServer')}
            description={t('settings.remoteServerDesc')}
            isSelected={serverType === 'remote'}
            onPress={() => handleServerTypeChange('remote')}
            glassModeEnabled={glassModeEnabled}
          />
        </Card>

        {/* Server Configuration */}
        {serverType === 'local' && (
          <>
            <Text style={styles.sectionTitle}>{t('settings.localServer')}</Text>
            <Card glassModeEnabled={glassModeEnabled}>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>{t('settings.serverIpAddress')}</Text>
                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.textInput}
                    placeholder="192.168.1.100"
                    placeholderTextColor="#666"
                    value={localHost}
                    onChangeText={(t) => setLocalHost(normalizeHostInput(t))}
                    autoCapitalize="none"
                    keyboardType="url"
                  />
                  <TouchableOpacity style={styles.qrButton} onPress={onQrScan}>
                    <Feather name="maximize" size={scale(18)} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              </View>
              <ActionButton
                title={t('settings.saveAndConnect')}
                onPress={handleSaveSettings}
                glassModeEnabled={glassModeEnabled}
              />
            </Card>
          </>
        )}

        {serverType === 'remote' && (
          <>
            <Text style={styles.sectionTitle}>{t('settings.remoteServer')}</Text>
            <Card glassModeEnabled={glassModeEnabled}>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>{t('settings.serverAddress')}</Text>
                <TextInput
                  style={[styles.textInput, { flex: 0 }]}
                  placeholder="your-server.com or IP address"
                  placeholderTextColor="#666"
                  value={remoteHost}
                  onChangeText={(t) => setRemoteHost(normalizeHostInput(t))}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              </View>
              <ActionButton
                title={t('settings.saveAndConnect')}
                onPress={handleSaveSettings}
                glassModeEnabled={glassModeEnabled}
              />
            </Card>
          </>
        )}

        {/* Current Connection */}
        {serverType !== 'stealthcloud' && ((serverType === 'local' && localHost) || (serverType === 'remote' && remoteHost)) && (
          <View style={styles.connectionInfo}>
            <Feather name="link" size={scale(14)} color="#666" />
            <Text style={styles.connectionText}>{getServerUrl()}</Text>
          </View>
        )}

        {/* Preferences */}
        <Text style={styles.sectionTitle}>{t('settings.preferences')}</Text>
        <Card glassModeEnabled={glassModeEnabled}>
          {serverType === 'stealthcloud' && (
            <>
              <ToggleSetting
                icon="upload-cloud"
                title={t('settings.autoUpload') || 'Auto Upload'}
                subtitle={autoUploadEnabled 
                  ? (t('settings.autoUploadOnDesc') || 'New photos will be backed up automatically')
                  : (t('settings.autoUploadOffDesc') || 'Manual backup only')}
                value={autoUploadEnabled}
                onValueChange={persistAutoUploadEnabled}
                glassModeEnabled={glassModeEnabled}
              />
              <View style={styles.autoUploadNote}>
                <Text style={styles.autoUploadNoteText}>
                  {t('settings.autoUploadNote') || 'Background uploads depend on iOS/Android policies. For best results: keep the app open occasionally, connect to WiFi, and charge your device.'}
                </Text>
              </View>
              <View style={styles.divider} />
            </>
          )}
          <ToggleSetting
            icon="zap"
            title={t('settings.fastMode')}
            subtitle={fastModeEnabled ? t('settings.fastModeOnDesc') : t('settings.fastModeOffDesc')}
            value={fastModeEnabled}
            onValueChange={persistFastModeEnabled}
            glassModeEnabled={glassModeEnabled}
          />
          {/* Glass Effect toggle hidden for future use
          <View style={styles.divider} />
          <ToggleSetting
            icon="eye"
            title="Glass Effect"
            subtitle={glassModeEnabled ? 'Frosted glass UI' : 'Standard appearance'}
            value={glassModeEnabled}
            onValueChange={persistGlassModeEnabled}
            glassModeEnabled={glassModeEnabled}
          />
          */}
        </Card>

        {/* Language */}
        <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
        <Card glassModeEnabled={glassModeEnabled}>
          <View style={[styles.settingRow, glassModeEnabled && styles.settingRowGlass]}>
            <View style={styles.settingIcon}>
              <Text style={{ fontSize: scale(20) }}>🌐</Text>
            </View>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>{t('settings.useEnglish')}</Text>
              <Text style={styles.settingSubtitle}>
                {useEnglish 
                  ? t('settings.currentlyEnglish')
                  : `${t('settings.currentlySystem')}: ${systemLangInfo?.nativeName || 'English'}`
                }
              </Text>
            </View>
            <Switch
              value={useEnglish}
              onValueChange={handleLanguageToggle}
              trackColor={{ false: '#333', true: '#03E1FF' }}
              thumbColor={useEnglish ? '#fff' : '#888'}
            />
          </View>
          <View style={styles.languageNote}>
            <Text style={styles.languageNoteText}>
              {t('settings.englishDefaultNote')}
            </Text>
          </View>
        </Card>

        </View>

        {/* Danger Zone - pushed to bottom */}
        <View style={styles.dangerSection}>
          <Text style={[styles.sectionTitle, { color: '#EF4444', marginTop: 0 }]}>{t('settings.dangerZone')}</Text>
          <Card glassModeEnabled={glassModeEnabled} style={styles.dangerCard}>
            <ActionButton
              title={t('settings.deleteAllServerData')}
              subtitle={t('settings.cannotBeUndone')}
              onPress={serverType === 'stealthcloud' ? purgeStealthCloudData : purgeClassicServerData}
              danger
              disabled={loading}
              glassModeEnabled={glassModeEnabled}
            />
          </Card>
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
  dangerSection: {
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
  dangerCard: {
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#2A2A2A',
    marginLeft: scaleSpacing(56),
  },
  // Server Options
  serverOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: scaleSpacing(12),
    paddingHorizontal: scaleSpacing(14),
  },
  serverOptionSelected: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#03E1FF',
    borderRadius: scale(12),
    marginHorizontal: scaleSpacing(4),
    marginVertical: scaleSpacing(2),
  },
  serverOptionGlass: {},
  serverOptionIcon: {
    width: scaleSpacing(36),
    height: scaleSpacing(36),
    borderRadius: scaleSpacing(9),
    backgroundColor: '#2A2A2A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: scaleSpacing(10),
  },
  serverOptionIconSelected: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  serverOptionContent: {
    flex: 1,
  },
  serverOptionLabel: {
    fontSize: scale(16),
    fontWeight: '600',
    color: '#FFFFFF',
  },
  serverOptionLabelSelected: {
    color: '#FFFFFF',
  },
  serverOptionDesc: {
    fontSize: scale(13),
    color: '#888888',
    marginTop: scaleSpacing(2),
  },
  checkmark: {
    width: scaleSpacing(24),
    height: scaleSpacing(24),
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Settings Row
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: scaleSpacing(10),
    paddingHorizontal: scaleSpacing(14),
  },
  settingRowGlass: {},
  settingIcon: {
    width: scaleSpacing(36),
    height: scaleSpacing(36),
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: scaleSpacing(10),
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: scale(16),
    fontWeight: '500',
    color: '#FFFFFF',
  },
  settingSubtitle: {
    fontSize: scale(13),
    color: '#666666',
    marginTop: 2,
  },
  // Input
  inputContainer: {
    paddingHorizontal: scaleSpacing(16),
    paddingTop: scaleSpacing(16),
    paddingBottom: scaleSpacing(12),
  },
  inputLabel: {
    fontSize: scale(13),
    fontWeight: '500',
    color: '#888888',
    marginBottom: scaleSpacing(8),
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scaleSpacing(8),
  },
  textInput: {
    flex: 1,
    height: scaleSpacing(48),
    backgroundColor: '#0A0A0A',
    borderRadius: scaleSpacing(10),
    paddingHorizontal: scaleSpacing(16),
    fontSize: scale(16),
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  qrButton: {
    width: scaleSpacing(48),
    height: scaleSpacing(48),
    backgroundColor: '#2A2A2A',
    borderRadius: scaleSpacing(10),
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Action Button
  actionButton: {
    marginHorizontal: scaleSpacing(14),
    marginVertical: scaleSpacing(12),
    paddingVertical: scaleSpacing(12),
    backgroundColor: '#03E1FF',
    borderRadius: scaleSpacing(10),
    alignItems: 'center',
  },
  actionButtonGlass: {},
  actionButtonDanger: {
    backgroundColor: 'transparent',
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    fontSize: scale(16),
    fontWeight: '600',
    color: '#000000',
  },
  actionButtonTextDanger: {
    color: '#EF4444',
  },
  actionButtonSubtitle: {
    fontSize: scale(12),
    color: '#888888',
    marginTop: 2,
  },
  // Connection Info
  connectionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: scaleSpacing(12),
    gap: scaleSpacing(6),
  },
  connectionText: {
    fontSize: scale(13),
    color: '#666666',
  },
  // Language Note
  languageNote: {
    paddingHorizontal: scaleSpacing(14),
    paddingBottom: scaleSpacing(8),
    paddingTop: scaleSpacing(2),
  },
  languageNoteText: {
    fontSize: scale(11),
    color: '#666666',
    fontStyle: 'italic',
  },
  // Auto Upload Note
  autoUploadNote: {
    paddingHorizontal: scaleSpacing(14),
    paddingBottom: scaleSpacing(6),
    paddingTop: scaleSpacing(1),
  },
  autoUploadNoteText: {
    fontSize: scale(10),
    color: '#888888',
    lineHeight: scale(14),
  },
});
