/**
 * SettingsScreen.js
 * 
 * Modern 2025 Settings UI following Material Design and iOS Human Interface Guidelines
 * - Grouped sections with headers
 * - List-style rows with icons
 * - Clean typography hierarchy
 * - Proper containment and spacing
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

// Icons as simple View components (no external dependencies)
const Icon = ({ name, size = 22, color = '#FFFFFF' }) => {
  const s = scale(size);
  
  const icons = {
    server: (
      <View style={{ width: s, height: s, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ width: s * 0.8, height: s * 0.2, backgroundColor: color, borderRadius: 2, marginBottom: 2 }} />
        <View style={{ width: s * 0.8, height: s * 0.2, backgroundColor: color, borderRadius: 2, marginBottom: 2 }} />
        <View style={{ width: s * 0.8, height: s * 0.2, backgroundColor: color, borderRadius: 2 }} />
      </View>
    ),
    speed: (
      <View style={{ width: s, height: s, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ width: s * 0.8, height: s * 0.8, borderWidth: 2, borderColor: color, borderRadius: s * 0.4 }}>
          <View style={{ position: 'absolute', top: '50%', left: '50%', width: s * 0.35, height: 2, backgroundColor: color, transform: [{ rotate: '-45deg' }, { translateX: -s * 0.1 }] }} />
        </View>
      </View>
    ),
    palette: (
      <View style={{ width: s, height: s, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ width: s * 0.7, height: s * 0.7, borderRadius: s * 0.35, borderWidth: 2, borderColor: color }}>
          <View style={{ position: 'absolute', top: s * 0.15, left: s * 0.15, width: s * 0.15, height: s * 0.15, backgroundColor: '#FF6B6B', borderRadius: s * 0.075 }} />
          <View style={{ position: 'absolute', top: s * 0.15, right: s * 0.15, width: s * 0.15, height: s * 0.15, backgroundColor: '#4ECDC4', borderRadius: s * 0.075 }} />
          <View style={{ position: 'absolute', bottom: s * 0.15, left: s * 0.25, width: s * 0.15, height: s * 0.15, backgroundColor: '#FFE66D', borderRadius: s * 0.075 }} />
        </View>
      </View>
    ),
    cloud: (
      <View style={{ width: s, height: s, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ width: s * 0.8, height: s * 0.5, backgroundColor: color, borderRadius: s * 0.25, marginTop: s * 0.15 }} />
        <View style={{ position: 'absolute', top: s * 0.1, left: s * 0.15, width: s * 0.35, height: s * 0.35, backgroundColor: color, borderRadius: s * 0.175 }} />
        <View style={{ position: 'absolute', top: s * 0.05, right: s * 0.2, width: s * 0.3, height: s * 0.3, backgroundColor: color, borderRadius: s * 0.15 }} />
      </View>
    ),
    trash: (
      <View style={{ width: s, height: s, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ width: s * 0.6, height: s * 0.1, backgroundColor: color, borderRadius: 1 }} />
        <View style={{ width: s * 0.5, height: s * 0.6, backgroundColor: color, borderRadius: 2, marginTop: 2 }} />
      </View>
    ),
    chevron: (
      <View style={{ width: s * 0.4, height: s * 0.4, borderRightWidth: 2, borderBottomWidth: 2, borderColor: color, transform: [{ rotate: '-45deg' }] }} />
    ),
    wifi: (
      <View style={{ width: s, height: s, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ width: s * 0.15, height: s * 0.15, backgroundColor: color, borderRadius: s * 0.075, position: 'absolute', bottom: s * 0.1 }} />
        <View style={{ width: s * 0.5, height: s * 0.25, borderWidth: 2, borderColor: color, borderRadius: s * 0.25, borderBottomWidth: 0, position: 'absolute', bottom: s * 0.25 }} />
        <View style={{ width: s * 0.8, height: s * 0.4, borderWidth: 2, borderColor: color, borderRadius: s * 0.4, borderBottomWidth: 0, position: 'absolute', bottom: s * 0.4 }} />
      </View>
    ),
    globe: (
      <View style={{ width: s, height: s, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ width: s * 0.8, height: s * 0.8, borderWidth: 2, borderColor: color, borderRadius: s * 0.4 }}>
          <View style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1.5, backgroundColor: color, marginTop: -0.75 }} />
          <View style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1.5, backgroundColor: color, marginLeft: -0.75 }} />
        </View>
      </View>
    ),
    qr: (
      <View style={{ width: s, height: s, justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ width: s * 0.8, height: s * 0.8, flexDirection: 'row', flexWrap: 'wrap' }}>
          <View style={{ width: '45%', height: '45%', borderWidth: 2, borderColor: color, margin: '2.5%' }} />
          <View style={{ width: '45%', height: '45%', borderWidth: 2, borderColor: color, margin: '2.5%' }} />
          <View style={{ width: '45%', height: '45%', borderWidth: 2, borderColor: color, margin: '2.5%' }} />
          <View style={{ width: '45%', height: '45%', backgroundColor: color, margin: '2.5%' }} />
        </View>
      </View>
    ),
  };
  
  return icons[name] || <View style={{ width: s, height: s }} />;
};

// Section Header Component
const SectionHeader = ({ title, glassModeEnabled }) => (
  <View style={settingsStyles.sectionHeader}>
    <Text style={[settingsStyles.sectionHeaderText, glassModeEnabled && { color: 'rgba(255,255,255,0.6)' }]}>
      {title.toUpperCase()}
    </Text>
  </View>
);

// Settings Row Component
const SettingsRow = ({ 
  icon, 
  iconColor = '#3B82F6',
  title, 
  subtitle, 
  value,
  onPress, 
  rightElement,
  isFirst,
  isLast,
  glassModeEnabled,
  danger = false,
}) => (
  <TouchableOpacity 
    style={[
      settingsStyles.row,
      isFirst && settingsStyles.rowFirst,
      isLast && settingsStyles.rowLast,
      glassModeEnabled && settingsStyles.rowGlass,
    ]}
    onPress={onPress}
    disabled={!onPress}
    activeOpacity={onPress ? 0.7 : 1}
  >
    {icon && (
      <View style={[settingsStyles.iconContainer, { backgroundColor: danger ? 'rgba(239,68,68,0.15)' : `${iconColor}20` }]}>
        <Icon name={icon} size={18} color={danger ? '#EF4444' : iconColor} />
      </View>
    )}
    <View style={settingsStyles.rowContent}>
      <View style={settingsStyles.rowTextContainer}>
        <Text style={[settingsStyles.rowTitle, danger && { color: '#EF4444' }]}>{title}</Text>
        {subtitle && <Text style={settingsStyles.rowSubtitle}>{subtitle}</Text>}
      </View>
      {value && <Text style={settingsStyles.rowValue}>{value}</Text>}
      {rightElement}
      {onPress && !rightElement && <Icon name="chevron" size={14} color="#666" />}
    </View>
  </TouchableOpacity>
);

// Toggle Row Component
const ToggleRow = ({
  icon,
  iconColor = '#3B82F6',
  title,
  subtitle,
  value,
  onValueChange,
  trackColor = '#3B82F6',
  isFirst,
  isLast,
  glassModeEnabled,
}) => (
  <View 
    style={[
      settingsStyles.row,
      isFirst && settingsStyles.rowFirst,
      isLast && settingsStyles.rowLast,
      glassModeEnabled && settingsStyles.rowGlass,
    ]}
  >
    {icon && (
      <View style={[settingsStyles.iconContainer, { backgroundColor: `${iconColor}20` }]}>
        <Icon name={icon} size={18} color={iconColor} />
      </View>
    )}
    <View style={settingsStyles.rowContent}>
      <View style={settingsStyles.rowTextContainer}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        {subtitle && <Text style={settingsStyles.rowSubtitle}>{subtitle}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#3A3A3C', true: '#3B82F6' }}
        thumbColor="#FFFFFF"
        ios_backgroundColor="#3A3A3C"
      />
    </View>
  </View>
);

// Server Type Selector Component
const ServerTypeSelector = ({ serverType, onSelect, glassModeEnabled }) => (
  <View style={[settingsStyles.segmentedControl, glassModeEnabled && settingsStyles.segmentedControlGlass]}>
    {['local', 'remote', 'stealthcloud'].map((type, index) => (
      <TouchableOpacity
        key={type}
        style={[
          settingsStyles.segment,
          serverType === type && settingsStyles.segmentActive,
          index === 0 && settingsStyles.segmentFirst,
          index === 2 && settingsStyles.segmentLast,
        ]}
        onPress={() => onSelect(type)}
      >
        <Text style={[
          settingsStyles.segmentText,
          serverType === type && settingsStyles.segmentTextActive,
        ]}>
          {type === 'local' ? 'Local' : type === 'remote' ? 'Remote' : 'StealthCloud'}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

// Main Settings Screen Component
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

  const handleSaveServerSettings = async () => {
    await SecureStore.setItemAsync('server_type', serverType);
    if (serverType === 'remote') {
      await SecureStore.setItemAsync('remote_host', remoteHost);
    } else if (serverType === 'local') {
      await SecureStore.setItemAsync('local_host', localHost);
    }
    await logout();
    showDarkAlert('Saved', 'Server settings updated. Please log in again.');
  };

  return (
    <View style={settingsStyles.container}>
      {/* Header */}
      <View style={settingsStyles.header}>
        <TouchableOpacity onPress={onBack} style={settingsStyles.backButton}>
          <Text style={settingsStyles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={settingsStyles.headerTitle}>Settings</Text>
        <View style={{ width: scaleSpacing(60) }} />
      </View>

      <ScrollView 
        style={settingsStyles.scrollView}
        contentContainerStyle={settingsStyles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* CONNECTION SECTION */}
        <SectionHeader title="Connection" glassModeEnabled={glassModeEnabled} />
        <View style={[settingsStyles.section, glassModeEnabled && settingsStyles.sectionGlass]}>
          <View style={settingsStyles.serverTypeContainer}>
            <Text style={settingsStyles.serverTypeLabel}>Server Type</Text>
            <ServerTypeSelector 
              serverType={serverType} 
              onSelect={handleServerTypeChange}
              glassModeEnabled={glassModeEnabled}
            />
          </View>

          {serverType === 'local' && (
            <>
              <View style={settingsStyles.divider} />
              <View style={settingsStyles.inputRow}>
                <View style={settingsStyles.inputIconContainer}>
                  <Icon name="wifi" size={18} color="#10B981" />
                </View>
                <View style={settingsStyles.inputWrapper}>
                  <Text style={settingsStyles.inputLabel}>Local Server IP</Text>
                  <View style={settingsStyles.inputWithButton}>
                    <TextInput
                      style={settingsStyles.textInput}
                      placeholder="192.168.1.100"
                      placeholderTextColor="#666"
                      value={localHost}
                      onChangeText={(t) => setLocalHost(normalizeHostInput(t))}
                      autoCapitalize="none"
                      keyboardType="url"
                    />
                    <TouchableOpacity style={settingsStyles.qrButton} onPress={onQrScan}>
                      <Icon name="qr" size={20} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
              <Text style={settingsStyles.helperText}>
                Server running on the same WiFi network
              </Text>
            </>
          )}

          {serverType === 'remote' && (
            <>
              <View style={settingsStyles.divider} />
              <View style={settingsStyles.inputRow}>
                <View style={settingsStyles.inputIconContainer}>
                  <Icon name="globe" size={18} color="#8B5CF6" />
                </View>
                <View style={settingsStyles.inputWrapper}>
                  <Text style={settingsStyles.inputLabel}>Remote Server Address</Text>
                  <TextInput
                    style={[settingsStyles.textInput, { flex: 1 }]}
                    placeholder="your-server.com or IP address"
                    placeholderTextColor="#666"
                    value={remoteHost}
                    onChangeText={(t) => setRemoteHost(normalizeHostInput(t))}
                    autoCapitalize="none"
                    keyboardType="url"
                  />
                </View>
              </View>
              <Text style={settingsStyles.helperText}>
                Server accessible from anywhere (port 3000 must be open)
              </Text>
            </>
          )}

          {serverType === 'stealthcloud' && (
            <>
              <View style={settingsStyles.divider} />
              <View style={settingsStyles.cloudInfo}>
                <Icon name="cloud" size={24} color="#3B82F6" />
                <Text style={settingsStyles.cloudInfoText}>
                  End-to-end encrypted cloud storage
                </Text>
              </View>
            </>
          )}

          {/* Current Connection */}
          <View style={settingsStyles.divider} />
          <View style={settingsStyles.connectionStatus}>
            <Text style={settingsStyles.connectionLabel}>Current Connection</Text>
            <Text style={settingsStyles.connectionUrl} numberOfLines={1}>{getServerUrl()}</Text>
          </View>

          {/* Save Button for Local/Remote */}
          {serverType !== 'stealthcloud' && (
            <TouchableOpacity 
              style={settingsStyles.saveButton}
              onPress={handleSaveServerSettings}
            >
              <Text style={settingsStyles.saveButtonText}>Save & Reconnect</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* PERFORMANCE SECTION */}
        <SectionHeader title="Performance" glassModeEnabled={glassModeEnabled} />
        <View style={[settingsStyles.section, glassModeEnabled && settingsStyles.sectionGlass]}>
          <ToggleRow
            icon="speed"
            iconColor="#F59E0B"
            title={fastModeEnabled ? 'Fast Mode' : 'Standard Mode'}
            subtitle={fastModeEnabled 
              ? 'Faster uploads, higher CPU/battery usage' 
              : 'Balanced speed and battery efficiency'}
            value={fastModeEnabled}
            onValueChange={persistFastModeEnabled}
            trackColor="#3B82F6"
            isFirst
            isLast
            glassModeEnabled={glassModeEnabled}
          />
        </View>
        <Text style={settingsStyles.footerText}>
          Screen stays on while app is active. Activity pauses when backgrounded.
        </Text>

        {/* APPEARANCE SECTION */}
        <SectionHeader title="Appearance" glassModeEnabled={glassModeEnabled} />
        <View style={[settingsStyles.section, glassModeEnabled && settingsStyles.sectionGlass]}>
          <ToggleRow
            icon="palette"
            iconColor="#EC4899"
            title={glassModeEnabled ? 'Glass Mode' : 'Standard Mode'}
            subtitle={glassModeEnabled 
              ? 'Frosted glass effect on cards' 
              : 'Classic solid backgrounds'}
            value={glassModeEnabled}
            onValueChange={persistGlassModeEnabled}
            trackColor="#3B82F6"
            isFirst
            isLast
            glassModeEnabled={glassModeEnabled}
          />
        </View>

        {/* DANGER ZONE SECTION */}
        <SectionHeader title="Danger Zone" glassModeEnabled={glassModeEnabled} />
        <View style={[settingsStyles.section, settingsStyles.sectionDanger, glassModeEnabled && settingsStyles.sectionGlass]}>
          <SettingsRow
            icon="trash"
            title="Delete All Server Data"
            subtitle="Permanently removes all your backed up files"
            onPress={serverType === 'stealthcloud' ? purgeStealthCloudData : purgeClassicServerData}
            isFirst
            isLast
            glassModeEnabled={glassModeEnabled}
            danger
          />
        </View>
        <Text style={settingsStyles.footerText}>
          This action cannot be undone. All data will be permanently deleted.
        </Text>

        {/* Bottom Spacing */}
        <View style={{ height: scaleSpacing(40) }} />
      </ScrollView>
    </View>
  );
};

// Styles
const settingsStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scaleSpacing(20),
    paddingTop: Math.min(60, Dimensions.get('window').height * 0.04 + 20),
    paddingBottom: scaleSpacing(16),
    backgroundColor: '#0A0A0A',
  },
  headerTitle: {
    fontSize: scale(28),
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  backButton: {
    paddingHorizontal: scaleSpacing(16),
    paddingVertical: scaleSpacing(8),
  },
  backButtonText: {
    fontSize: scale(16),
    color: '#03DAC6',
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: scaleSpacing(16),
    paddingTop: scaleSpacing(8),
  },
  sectionHeader: {
    paddingHorizontal: scaleSpacing(4),
    paddingTop: scaleSpacing(24),
    paddingBottom: scaleSpacing(8),
  },
  sectionHeaderText: {
    fontSize: scale(13),
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: '#1C1C1E',
    borderRadius: scaleSpacing(12),
    overflow: 'hidden',
  },
  sectionGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  sectionDanger: {
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: scaleSpacing(12),
    paddingHorizontal: scaleSpacing(16),
    backgroundColor: '#1C1C1E',
    minHeight: scaleSpacing(56),
  },
  rowFirst: {
    borderTopLeftRadius: scaleSpacing(12),
    borderTopRightRadius: scaleSpacing(12),
  },
  rowLast: {
    borderBottomLeftRadius: scaleSpacing(12),
    borderBottomRightRadius: scaleSpacing(12),
  },
  rowGlass: {
    backgroundColor: 'transparent',
  },
  iconContainer: {
    width: scaleSpacing(36),
    height: scaleSpacing(36),
    borderRadius: scaleSpacing(8),
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: scaleSpacing(12),
  },
  rowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowTextContainer: {
    flex: 1,
    marginRight: scaleSpacing(12),
  },
  rowTitle: {
    fontSize: scale(16),
    fontWeight: '500',
    color: '#FFFFFF',
  },
  rowSubtitle: {
    fontSize: scale(13),
    color: '#8E8E93',
    marginTop: scaleSpacing(2),
  },
  rowValue: {
    fontSize: scale(15),
    color: '#8E8E93',
    marginRight: scaleSpacing(8),
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#3A3A3C',
    marginLeft: scaleSpacing(64),
  },
  serverTypeContainer: {
    padding: scaleSpacing(16),
  },
  serverTypeLabel: {
    fontSize: scale(13),
    color: '#8E8E93',
    marginBottom: scaleSpacing(12),
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#2C2C2E',
    borderRadius: scaleSpacing(8),
    padding: scaleSpacing(2),
  },
  segmentedControlGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  segment: {
    flex: 1,
    paddingVertical: scaleSpacing(10),
    alignItems: 'center',
    borderRadius: scaleSpacing(6),
  },
  segmentFirst: {
    borderTopLeftRadius: scaleSpacing(6),
    borderBottomLeftRadius: scaleSpacing(6),
  },
  segmentLast: {
    borderTopRightRadius: scaleSpacing(6),
    borderBottomRightRadius: scaleSpacing(6),
  },
  segmentActive: {
    backgroundColor: '#3B82F6',
  },
  segmentText: {
    fontSize: scale(13),
    fontWeight: '500',
    color: '#8E8E93',
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: scaleSpacing(12),
    paddingHorizontal: scaleSpacing(16),
  },
  inputIconContainer: {
    width: scaleSpacing(36),
    height: scaleSpacing(36),
    borderRadius: scaleSpacing(8),
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: scaleSpacing(12),
  },
  inputWrapper: {
    flex: 1,
  },
  inputLabel: {
    fontSize: scale(13),
    color: '#8E8E93',
    marginBottom: scaleSpacing(8),
  },
  inputWithButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#2C2C2E',
    borderRadius: scaleSpacing(8),
    paddingHorizontal: scaleSpacing(14),
    paddingVertical: scaleSpacing(12),
    fontSize: scale(15),
    color: '#FFFFFF',
  },
  qrButton: {
    width: scaleSpacing(44),
    height: scaleSpacing(44),
    backgroundColor: '#3B82F6',
    borderRadius: scaleSpacing(8),
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: scaleSpacing(8),
  },
  helperText: {
    fontSize: scale(12),
    color: '#6B7280',
    paddingHorizontal: scaleSpacing(16),
    paddingBottom: scaleSpacing(12),
  },
  cloudInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: scaleSpacing(16),
  },
  cloudInfoText: {
    fontSize: scale(14),
    color: '#8E8E93',
    marginLeft: scaleSpacing(12),
  },
  connectionStatus: {
    padding: scaleSpacing(16),
  },
  connectionLabel: {
    fontSize: scale(12),
    color: '#6B7280',
    marginBottom: scaleSpacing(4),
  },
  connectionUrl: {
    fontSize: scale(14),
    color: '#10B981',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  saveButton: {
    marginHorizontal: scaleSpacing(16),
    marginBottom: scaleSpacing(16),
    backgroundColor: '#3B82F6',
    borderRadius: scaleSpacing(10),
    paddingVertical: scaleSpacing(14),
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: scale(16),
    fontWeight: '600',
    color: '#FFFFFF',
  },
  footerText: {
    fontSize: scale(12),
    color: '#6B7280',
    paddingHorizontal: scaleSpacing(20),
    paddingTop: scaleSpacing(8),
    paddingBottom: scaleSpacing(4),
    lineHeight: scale(18),
  },
});

export default SettingsScreen;
