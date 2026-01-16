/**
 * HomeScreen.js
 * 
 * Premium Home UI - Bold, modern, asymmetric design
 * Hero status display with prominent messaging
 * Pill-shaped and rounded action buttons with visual hierarchy
 */

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { t } from './i18n';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const shortSide = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT);
const isTablet = shortSide >= 600;
const isLargeTablet = shortSide >= 768;

const scale = (size) => {
  if (isLargeTablet) return size * 1.0;
  if (isTablet) return size * 1.1;
  return size;
};

const scaleSpacing = (size) => {
  if (isLargeTablet) return size * 1.0;
  if (isTablet) return size * 1.05;
  return size;
};

// Theme colors - Solana inspired
const COLORS = {
  primary: '#03E1FF',    // Ocean blue
  secondary: '#00FFA3',  // Mint green
  accent: '#DC1FFF',     // Vibrant purple
  bg: '#0A0A0A',
  card: '#141414',
  cardLight: '#1A1A1A',
  border: '#2A2A2A',
  text: '#FFFFFF',
  textMuted: '#888888',
  textDim: '#555555',
};

export const HomeScreen = ({
  appDisplayName,
  serverType,
  status,
  progress,
  progressAction,
  loading,
  glassModeEnabled,
  onOpenInfo,
  onOpenSettings,
  onLogout,
  onCleanBestMatches,
  onCleanSimilar,
  onBackupAll,
  onBackupSelected,
  onSyncAll,
  onSyncSelected,
  showCompletionTick,
  completionMessage,
  onDismissCompletionTick,
  onMintNFT,
  onViewNFTs,
}) => {

  const serverLabel = serverType === 'stealthcloud' ? 'StealthCloud' : serverType === 'remote' ? 'Remote Server' : 'Local Server';
  const serverIcon = serverType === 'stealthcloud' ? 'cloud' : serverType === 'remote' ? 'globe' : 'wifi';
  
  // Status detection based on progressAction (language-independent)
  // Only show specific action states when progressAction is explicitly set
  const isBackingUp = progressAction === 'backup';
  const isSyncing = progressAction === 'sync';
  const isCleaning = progressAction === 'cleanup';
  const isMintingNFT = progressAction === 'nft';
  // Idle is the default - show Ready unless a specific action is in progress
  const isIdle = !isBackingUp && !isSyncing && !isCleaning && !isMintingNFT;
  const isFetching = loading && isIdle;
  
  const progressPercent = Math.min(Math.max(progress, 0), 1) * 100;
  // Hide progress bar during fetching/preparing phases, show during actual work (including 100%)
  const showProgress = progressPercent > 0 && !isFetching && !isIdle;

  // Status color based on activity
  const getStatusColor = () => {
    if (isIdle) return COLORS.secondary;
    if (isMintingNFT) return '#9945FF'; // Solana purple for NFT
    if (isCleaning) return COLORS.accent;
    if (isSyncing) return COLORS.secondary;
    return COLORS.primary;
  };

  const statusColor = getStatusColor();

  return (
    <View style={styles.container}>
      {/* Compact Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.appName}>{appDisplayName}</Text>
          <View style={styles.serverBadge}>
            <Feather name={serverIcon} size={scale(12)} color={COLORS.primary} />
            <Text style={styles.serverLabel}>{serverLabel}</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={onOpenInfo} style={styles.headerIconBtn}>
            <Feather name="info" size={scale(18)} color={COLORS.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onOpenSettings} style={styles.headerIconBtn}>
            <Feather name="settings" size={scale(18)} color={COLORS.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onLogout} style={styles.headerIconBtn}>
            <Feather name="log-out" size={scale(18)} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.mainContent}>
        {/* HERO STATUS SECTION */}
        <View style={styles.heroSection}>
          <View style={[styles.heroGradient, { backgroundColor: `${statusColor}08` }]} />
          
          {/* Large Status Icon */}
          <View style={[styles.heroIconContainer, { borderColor: `${statusColor}40` }]}>
            <View style={[styles.heroIconInner, { backgroundColor: `${statusColor}20` }]}>
              <Feather 
                name={isIdle ? 'check-circle' : isMintingNFT ? 'hexagon' : isCleaning ? 'search' : isSyncing ? 'download-cloud' : 'upload-cloud'} 
                size={scale(32)} 
                color={statusColor} 
              />
            </View>
          </View>

          {/* Status Text - Large and Prominent */}
          <Text style={[styles.heroStatusText, { color: statusColor }]}>
            {isIdle ? t('home.ready') : isMintingNFT ? t('home.mintingNft') : isCleaning ? t('home.scanning') : isSyncing ? t('home.syncing') : t('home.backingUp')}
          </Text>

          {/* Progress Ring/Bar */}
          {showProgress && (
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progressPercent}%`, backgroundColor: statusColor }]} />
              </View>
              <Text style={[styles.progressText, { color: statusColor }]}>{Math.round(progressPercent)}%</Text>
            </View>
          )}

          {/* Detailed Status Message */}
          <View style={styles.statusMessageContainer}>
            <Text style={styles.statusMessage} numberOfLines={3}>
              {status}
            </Text>
          </View>
        </View>

        {/* ACTION BUTTONS - Asymmetric Grid */}
        <View style={styles.actionsSection}>
          
          {/* BACKUP ROW - Full width primary action */}
          <View style={styles.actionRow}>
            <TouchableOpacity 
              style={[styles.primaryActionBtn, { backgroundColor: COLORS.primary }, loading && styles.actionDisabled]}
              onPress={onBackupAll}
              disabled={loading}
              activeOpacity={0.8}
            >
              <View style={styles.primaryActionGradient}>
                <View style={styles.primaryActionContent}>
                  <View style={styles.primaryActionIcon}>
                    <Feather name="upload-cloud" size={scale(28)} color="#000000" />
                  </View>
                  <View style={styles.primaryActionText}>
                    <Text style={[styles.primaryActionTitle, { color: '#000000' }]}>{t('home.backupAll')}</Text>
                    <Text style={[styles.primaryActionSubtitle, { color: 'rgba(0,0,0,0.6)' }]}>{t('home.uploadToCloud')}</Text>
                  </View>
                  <Feather name="chevron-right" size={scale(24)} color="rgba(0,0,0,0.4)" />
                </View>
              </View>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.secondaryActionBtn, { borderColor: `${COLORS.primary}40` }, loading && styles.actionDisabled]}
              onPress={onBackupSelected}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Feather name="check-square" size={scale(22)} color={COLORS.primary} />
              <Text style={[styles.secondaryActionText, { color: COLORS.primary }]}>{t('home.select')}</Text>
            </TouchableOpacity>
          </View>

          {/* SYNC ROW */}
          <View style={styles.actionRow}>
            <TouchableOpacity 
              style={[styles.primaryActionBtn, { backgroundColor: COLORS.secondary }, loading && styles.actionDisabled]}
              onPress={onSyncAll}
              disabled={loading}
              activeOpacity={0.8}
            >
              <View style={styles.primaryActionGradient}>
                <View style={styles.primaryActionContent}>
                  <View style={styles.primaryActionIcon}>
                    <Feather name="download-cloud" size={scale(28)} color="#000000" />
                  </View>
                  <View style={styles.primaryActionText}>
                    <Text style={[styles.primaryActionTitle, { color: '#000000' }]}>{t('home.syncAll')}</Text>
                    <Text style={[styles.primaryActionSubtitle, { color: 'rgba(0,0,0,0.6)' }]}>{t('home.downloadFromCloud')}</Text>
                  </View>
                  <Feather name="chevron-right" size={scale(24)} color="rgba(0,0,0,0.4)" />
                </View>
              </View>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.secondaryActionBtn, { borderColor: `${COLORS.secondary}40` }, loading && styles.actionDisabled]}
              onPress={onSyncSelected}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Feather name="check-square" size={scale(22)} color={COLORS.secondary} />
              <Text style={[styles.secondaryActionText, { color: COLORS.secondary }]}>{t('home.select')}</Text>
            </TouchableOpacity>
          </View>

          {/* CLEAN DUPLICATES - Two equal buttons */}
          <View style={styles.cleanRow}>
            <TouchableOpacity 
              style={[styles.cleanBtn, loading && styles.actionDisabled]}
              onPress={onCleanBestMatches}
              disabled={loading}
              activeOpacity={0.8}
            >
              <View style={[styles.cleanBtnIcon, { backgroundColor: `${COLORS.accent}20` }]}>
                <Feather name="copy" size={scale(24)} color={COLORS.accent} />
              </View>
              <Text style={styles.cleanBtnTitle}>{t('home.identical')}</Text>
              <Text style={styles.cleanBtnSubtitle}>{t('home.exactDuplicates')}</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.cleanBtn, loading && styles.actionDisabled]}
              onPress={onCleanSimilar}
              disabled={loading}
              activeOpacity={0.8}
            >
              <View style={[styles.cleanBtnIcon, { backgroundColor: `${COLORS.accent}20` }]}>
                <Feather name="layers" size={scale(24)} color={COLORS.accent} />
              </View>
              <Text style={styles.cleanBtnTitle}>{t('home.similar')}</Text>
              <Text style={styles.cleanBtnSubtitle}>{t('home.nearMatches')}</Text>
            </TouchableOpacity>
          </View>

          {/* Section Label */}
          <Text style={styles.sectionLabel}>{t('home.cleanDuplicates')}</Text>

          {/* NFT ROW - Same style as Backup/Sync */}
          <View style={styles.actionRow}>
            <TouchableOpacity 
              style={[styles.primaryActionBtn, { backgroundColor: '#9945FF' }, loading && styles.actionDisabled]}
              onPress={onMintNFT}
              disabled={loading}
              activeOpacity={0.8}
            >
              <View style={styles.primaryActionGradient}>
                <View style={styles.primaryActionContent}>
                  <View style={styles.primaryActionIcon}>
                    <Feather name="hexagon" size={scale(28)} color="#FFFFFF" />
                  </View>
                  <View style={styles.primaryActionText}>
                    <Text style={[styles.primaryActionTitle, { color: '#FFFFFF' }]}>{t('home.nftMemories')}</Text>
                    <Text style={[styles.primaryActionSubtitle, { color: 'rgba(255,255,255,0.7)' }]}>{t('home.ownPhotosForever')}</Text>
                  </View>
                  <Feather name="chevron-right" size={scale(24)} color="rgba(255,255,255,0.5)" />
                </View>
              </View>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.secondaryActionBtn, { borderColor: '#9945FF40' }, loading && styles.actionDisabled]}
              onPress={onViewNFTs}
              disabled={loading}
              activeOpacity={0.8}
            >
              <Feather name="image" size={scale(22)} color="#9945FF" />
              <Text style={[styles.secondaryActionText, { color: '#9945FF' }]}>{t('home.album')}</Text>
            </TouchableOpacity>
          </View>

          {/* Section Label */}
          <Text style={styles.sectionLabel}>{t('home.solanaNft')}</Text>
        </View>
      </View>

      {/* Completion Tick - Tap anywhere to dismiss */}
      {showCompletionTick && (
        <TouchableOpacity 
          style={styles.completionTickOverlay} 
          activeOpacity={1} 
          onPress={onDismissCompletionTick}
        >
          <View style={styles.completionCard}>
            <View style={styles.completionTickCircle}>
              <Feather name="check" size={scale(36)} color={COLORS.secondary} />
            </View>
            {completionMessage ? (
              <Text style={styles.completionMessage}>{completionMessage}</Text>
            ) : null}
            <Text style={styles.completionDismissHint}>{t('home.tapToDismiss')}</Text>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: scaleSpacing(20),
    paddingTop: Math.min(56, SCREEN_HEIGHT * 0.04 + 16),
    paddingBottom: scaleSpacing(8),
  },
  headerLeft: {
    flex: 1,
  },
  appName: {
    fontSize: scale(24),
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  serverBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: scaleSpacing(4),
    gap: scaleSpacing(6),
  },
  serverLabel: {
    fontSize: scale(13),
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  headerActions: {
    flexDirection: 'row',
    gap: scaleSpacing(4),
  },
  headerIconBtn: {
    width: scale(40),
    height: scale(40),
    borderRadius: scale(20),
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainContent: {
    flex: 1,
  },
  
  // Hero Status Section
  heroSection: {
    alignItems: 'center',
    paddingVertical: scaleSpacing(12),
    paddingHorizontal: scaleSpacing(16),
    position: 'relative',
  },
  heroGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: scale(200),
  },
  heroIconContainer: {
    width: scale(80),
    height: scale(80),
    borderRadius: scale(40),
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: scaleSpacing(8),
  },
  heroIconInner: {
    width: scale(64),
    height: scale(64),
    borderRadius: scale(32),
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroStatusText: {
    fontSize: scale(24),
    fontWeight: '800',
    letterSpacing: -1,
    marginBottom: scaleSpacing(4),
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scaleSpacing(8),
    marginBottom: scaleSpacing(6),
    width: '80%',
  },
  progressBar: {
    flex: 1,
    height: scale(6),
    backgroundColor: COLORS.border,
    borderRadius: scale(3),
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: scale(3),
  },
  progressText: {
    fontSize: scale(16),
    fontWeight: '700',
    minWidth: scale(50),
    textAlign: 'right',
  },
  statusMessageContainer: {
    backgroundColor: COLORS.card,
    borderRadius: scale(8),
    paddingVertical: scaleSpacing(8),
    paddingHorizontal: scaleSpacing(12),
    width: '100%',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statusMessage: {
    fontSize: scale(12),
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: scale(16),
  },

  // Actions Section
  actionsSection: {
    flex: 1,
    paddingHorizontal: scaleSpacing(16),
    gap: scaleSpacing(12),
    justifyContent: 'flex-end',
    paddingBottom: scaleSpacing(20),
  },
  actionRow: {
    flexDirection: 'row',
    gap: scaleSpacing(10),
  },
  primaryActionBtn: {
    flex: 1,
    borderRadius: scale(16),
    overflow: 'hidden',
  },
  primaryActionGradient: {
    paddingVertical: scaleSpacing(16),
    paddingHorizontal: scaleSpacing(16),
  },
  primaryActionContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  primaryActionIcon: {
    width: scale(48),
    height: scale(48),
    borderRadius: scale(14),
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: scaleSpacing(12),
  },
  primaryActionText: {
    flex: 1,
  },
  primaryActionTitle: {
    fontSize: scale(18),
    fontWeight: '700',
    color: '#FFFFFF',
  },
  primaryActionSubtitle: {
    fontSize: scale(12),
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  secondaryActionBtn: {
    width: scale(70),
    borderRadius: scale(16),
    borderWidth: 1.5,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: scaleSpacing(12),
    gap: scaleSpacing(4),
  },
  secondaryActionText: {
    fontSize: scale(11),
    fontWeight: '600',
  },
  cleanRow: {
    flexDirection: 'row',
    gap: scaleSpacing(10),
    marginTop: scaleSpacing(8),
  },
  cleanBtn: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: scale(16),
    paddingVertical: scaleSpacing(16),
    paddingHorizontal: scaleSpacing(14),
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cleanBtnIcon: {
    width: scale(52),
    height: scale(52),
    borderRadius: scale(16),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: scaleSpacing(10),
  },
  cleanBtnTitle: {
    fontSize: scale(16),
    fontWeight: '700',
    color: COLORS.text,
  },
  cleanBtnSubtitle: {
    fontSize: scale(12),
    color: COLORS.textMuted,
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: scale(11),
    fontWeight: '600',
    color: COLORS.textDim,
    letterSpacing: 1.5,
    textAlign: 'center',
    marginTop: scaleSpacing(4),
  },
  actionDisabled: {
    opacity: 0.5,
  },
  
  // Completion Tick Overlay
  completionTickOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  completionCard: {
    backgroundColor: COLORS.card,
    borderRadius: scale(24),
    paddingVertical: scaleSpacing(28),
    paddingHorizontal: scaleSpacing(36),
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    minWidth: scale(200),
    shadowColor: COLORS.secondary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  completionTickCircle: {
    width: scale(72),
    height: scale(72),
    borderRadius: scale(36),
    backgroundColor: `${COLORS.secondary}20`,
    borderWidth: 2.5,
    borderColor: COLORS.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completionMessage: {
    marginTop: scaleSpacing(16),
    color: COLORS.text,
    fontSize: scale(17),
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  completionDismissHint: {
    marginTop: scaleSpacing(12),
    color: COLORS.textDim,
    fontSize: scale(12),
    fontWeight: '400',
    textAlign: 'center',
  },
  
  // Inline Notification
  notificationContainer: {
    marginTop: scaleSpacing(12),
    backgroundColor: COLORS.card,
    borderRadius: scale(12),
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  notificationContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: scaleSpacing(12),
    gap: scaleSpacing(10),
  },
  notificationIcon: {
    width: scale(32),
    height: scale(32),
    borderRadius: scale(8),
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationText: {
    flex: 1,
  },
  notificationTitle: {
    fontSize: scale(14),
    fontWeight: '600',
    color: COLORS.text,
  },
  notificationMessage: {
    fontSize: scale(12),
    color: COLORS.textMuted,
    marginTop: 2,
  },
});

export default HomeScreen;
