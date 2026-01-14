/**
 * SettingsScreen.js
 * 
 * Professional Settings UI - Clean, minimal, premium feel
 */

import React from 'react';
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
  fastModeEnabled,
  persistFastModeEnabled,
  glassModeEnabled,
  persistGlassModeEnabled,
  loading,
  logout,
  purgeStealthCloudData,
  purgeClassicServerData,
  showDarkAlert,
  onQrScan,
  normalizeHostInput,
  SecureStore,
}) => {

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
    await logout();
    showDarkAlert('Saved', 'Server settings updated');
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: scaleSpacing(60) }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Server Selection */}
        <Text style={styles.sectionTitle}>Server</Text>
        <Card glassModeEnabled={glassModeEnabled}>
          <ServerOption
            icon="cloud"
            label="StealthCloud"
            description="Secure cloud backup"
            isSelected={serverType === 'stealthcloud'}
            onPress={() => handleServerTypeChange('stealthcloud')}
            glassModeEnabled={glassModeEnabled}
          />
          <View style={styles.divider} />
          <ServerOption
            icon="wifi"
            label="Local Server"
            description="Same WiFi network"
            isSelected={serverType === 'local'}
            onPress={() => handleServerTypeChange('local')}
            glassModeEnabled={glassModeEnabled}
          />
          <View style={styles.divider} />
          <ServerOption
            icon="globe"
            label="Remote Server"
            description="Internet connection"
            isSelected={serverType === 'remote'}
            onPress={() => handleServerTypeChange('remote')}
            glassModeEnabled={glassModeEnabled}
          />
        </Card>

        {/* Server Configuration */}
        {serverType === 'local' && (
          <>
            <Text style={styles.sectionTitle}>Local Server</Text>
            <Card glassModeEnabled={glassModeEnabled}>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Server IP Address</Text>
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
                title="Save & Connect"
                onPress={handleSaveSettings}
                glassModeEnabled={glassModeEnabled}
              />
            </Card>
          </>
        )}

        {serverType === 'remote' && (
          <>
            <Text style={styles.sectionTitle}>Remote Server</Text>
            <Card glassModeEnabled={glassModeEnabled}>
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Server Address</Text>
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
                title="Save & Connect"
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
        <Text style={styles.sectionTitle}>Preferences</Text>
        <Card glassModeEnabled={glassModeEnabled}>
          <ToggleSetting
            icon="zap"
            title="Fast Mode"
            subtitle={fastModeEnabled ? 'Higher speed, more battery usage' : 'Balanced performance'}
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

        {/* Danger Zone */}
        <Text style={[styles.sectionTitle, { color: '#EF4444' }]}>Danger Zone</Text>
        <Card glassModeEnabled={glassModeEnabled} style={styles.dangerCard}>
          <ActionButton
            title="Delete All Server Data"
            subtitle="This cannot be undone"
            onPress={serverType === 'stealthcloud' ? purgeStealthCloudData : purgeClassicServerData}
            danger
            disabled={loading}
            glassModeEnabled={glassModeEnabled}
          />
        </Card>

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
    paddingVertical: scaleSpacing(16),
    paddingHorizontal: scaleSpacing(16),
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
    paddingVertical: scaleSpacing(14),
    paddingHorizontal: scaleSpacing(16),
  },
  settingRowGlass: {},
  settingIcon: {
    width: scaleSpacing(40),
    height: scaleSpacing(40),
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: scaleSpacing(12),
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
    marginHorizontal: scaleSpacing(16),
    marginVertical: scaleSpacing(16),
    paddingVertical: scaleSpacing(14),
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
});
