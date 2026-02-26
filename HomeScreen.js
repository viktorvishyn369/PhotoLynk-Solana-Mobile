/**
 * HomeScreen.js
 * 
 * Premium Home UI with bottom tab navigation.
 * 4 tabs: Home (Backup/Sync), Authenticity (Certify/Originals/Proofs), Tools (Clean/AI), Share (P2P).
 * Dark glass aesthetic with premium palette. Fits all screen sizes.
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
  Platform,
  StatusBar,
  useWindowDimensions,
  Animated,
  LayoutAnimation,
  UIManager,
} from 'react-native';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { t } from './i18n';
import { GradientSpinner } from './uiComponents';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SCREEN_HEIGHT_FULL = Dimensions.get('screen').height;
const ANDROID_NAV_BAR_HEIGHT = Platform.OS === 'android' ? Math.max(48, SCREEN_HEIGHT_FULL - SCREEN_HEIGHT) : 0;
const MIN_DIMENSION = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT);

const isVerySmallPhone = MIN_DIMENSION < 340;
const isSmallPhone = MIN_DIMENSION >= 340 && MIN_DIMENSION < 375;
const isMediumPhone = MIN_DIMENSION >= 375 && MIN_DIMENSION < 400;
const isLargePhone = MIN_DIMENSION >= 400 && MIN_DIMENSION < 600;
const isTablet = MIN_DIMENSION >= 600;
const isLargeTablet = MIN_DIMENSION >= 768;
const isShortScreen = SCREEN_HEIGHT < 700;
const isTallScreen = SCREEN_HEIGHT > 900;
const isAndroid = Platform.OS === 'android';

const scale = (size) => {
  let r = size;
  if (isLargeTablet) r = size * 1.3;
  else if (isTablet) r = size * 1.15;
  else if (isVerySmallPhone) r = size * 0.78;
  else if (isSmallPhone) r = size * 0.85;
  else if (isMediumPhone) r = size * 0.92;
  if (isShortScreen) r *= 0.9;
  return r;
};

const scaleStatus = (size) => {
  if (isShortScreen) return size * 0.55;
  if (isVerySmallPhone) return size * 0.65;
  if (isSmallPhone) return size * 0.7;
  if (isMediumPhone) return size * 0.82;
  if (isLargeTablet) return size * 1.3;
  if (isTablet) return size * 1.15;
  return size;
};

const scaleSpacing = (size) => {
  let r = size;
  if (isLargeTablet) r = size * 1.2;
  else if (isTablet) r = size * 1.1;
  else if (isVerySmallPhone) r = size * 0.6;
  else if (isSmallPhone) r = size * 0.7;
  else if (isMediumPhone) r = size * 0.8;
  else r = size * 0.9;
  if (isShortScreen) r *= 0.75;
  return r;
};

// Premium dark palette
const COLORS = {
  primary: '#03E1FF',    // Cyan
  secondary: '#00FFA3',  // Mint
  accent: '#DC1FFF',     // Magenta
  nft: '#9945FF',        // Authenticity purple
  gold: '#D4AF37',       // Premium gold accent
  bg: '#060608',         // Near-black
  card: '#111114',       // Dark card
  cardLight: '#18181C',  // Slightly lighter
  cardElevated: '#1E1E24', // Elevated surface
  border: '#252530',     // Subtle border
  borderLight: '#35354A', // Lighter border
  text: '#F0F0F5',       // Off-white
  textMuted: '#8888A0',  // Muted
  textDim: '#55556A',    // Dim
  tabBar: '#0C0C10',     // Tab bar bg
  tabBarBorder: '#1A1A24', // Tab bar top border
};

// ─── TAB DEFINITIONS ────────────────────────────────────────────────
const TAB_DEFS = [
  { key: 'home',     icon: 'image',    labelKey: 'home.home',     color: COLORS.primary },
  { key: 'info',     icon: 'info',     labelKey: 'home.info',     color: COLORS.gold },
  { key: 'settings', icon: 'settings', labelKey: 'home.settings', color: COLORS.textMuted },
];

// Tab bar height (including bottom safe area on Android)
const TAB_BAR_HEIGHT = scale(56);
const TAB_BAR_TOTAL = TAB_BAR_HEIGHT + (Platform.OS === 'android' ? ANDROID_NAV_BAR_HEIGHT : 0);

// ─── ANIMATED PRESSABLE (scale on press) ────────────────────────────
const AnimatedPressable = ({ children, style, onPress, onLongPress, delayLongPress, disabled, activeOpacity = 0.9 }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 0.965, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
  }, []);
  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  }, []);
  const flat = StyleSheet.flatten(style) || {};
  const { flex, width, height, alignSelf, ...innerStyle } = flat;
  const outerStyle = {};
  if (flex !== undefined) outerStyle.flex = flex;
  if (width !== undefined) outerStyle.width = width;
  if (height !== undefined) outerStyle.height = height;
  if (alignSelf !== undefined) outerStyle.alignSelf = alignSelf;
  const needsStretch = alignSelf === 'stretch';
  return (
    <TouchableOpacity style={outerStyle} onPress={onPress} onLongPress={onLongPress} delayLongPress={delayLongPress} disabled={disabled} activeOpacity={activeOpacity}
      onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View style={[innerStyle, needsStretch && { flex: 1 }, { transform: [{ scale: scaleAnim }] }]}>{children}</Animated.View>
    </TouchableOpacity>
  );
};

// ─── GLOW CARD (gradient border + shadow) ───────────────────────────
const GlowCard = ({ children, style, glowColor, gradientColors }) => {
  const colors = gradientColors || [`${glowColor || COLORS.primary}08`, `${glowColor || COLORS.primary}03`];
  return (
    <View style={[styles.glowCardOuter, style, glowColor && !isAndroid && { shadowColor: glowColor }]}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.glowCardGradient}>
        {children}
      </LinearGradient>
    </View>
  );
};

// ─── SECTION HEADER (gradient dot + premium typography) ─────────────
const SectionHeader = ({ icon, title, color, subtitle }) => (
  <View style={styles.sectionHeader}>
    <LinearGradient colors={[color, `${color}80`]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.sectionHeaderDot} />
    <View style={{ flex: 1 }}>
      <Text style={[styles.sectionHeaderTitle, { color }]}>{title}</Text>
      {subtitle ? <Text style={styles.sectionHeaderSub}>{subtitle}</Text> : null}
    </View>
  </View>
);

// ─── GRADIENT SEPARATOR ─────────────────────────────────────────────
const GradientSeparator = ({ color }) => (
  <LinearGradient colors={['transparent', `${color || COLORS.border}40`, 'transparent']}
    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
    style={{ height: StyleSheet.hairlineWidth, marginVertical: scaleSpacing(4) }} />
);

export const HomeScreen = ({
  appDisplayName,
  serverType,
  status,
  progress,
  progressAction,
  loading,
  glassModeEnabled,
  infoContent,
  settingsContent,
  onLogout,
  onCleanBestMatches,
  onCleanSimilar,
  onBackupAll,
  onLongPressBackup,
  onBackupSelected,
  onSyncAll,
  onLongPressSync,
  onSyncSelected,
  showCompletionTick,
  completionMessage,
  onDismissCompletionTick,
  onMintNFT,
  onViewNFTs,
  onViewCertificates,
  onTabChange,
  qsEmail,
  qsWalletAddress,
  qsNftCount,
  qsLastBackupTime,
  appVersion,
}) => {
  const [activeTab, setActiveTab] = useState('home');
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // Tap-to-toggle collapse for quick-stats (no scroll-driven bounce)
  const [qsCollapsed, setQsCollapsed] = useState(false);
  const qsExpandedOpacity = useRef(new Animated.Value(1)).current;
  const qsCollapsedOpacity = useRef(new Animated.Value(0)).current;
  const QS_EXPANDED = scale(100);
  const QS_COLLAPSED = scale(36);

  const toggleQsCollapse = useCallback(() => {
    const next = !qsCollapsed;
    LayoutAnimation.configureNext(LayoutAnimation.create(250, 'easeInEaseOut', 'opacity'));
    setQsCollapsed(next);
    Animated.parallel([
      Animated.timing(qsExpandedOpacity, { toValue: next ? 0 : 1, duration: 200, useNativeDriver: true }),
      Animated.timing(qsCollapsedOpacity, { toValue: next ? 1 : 0, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [qsCollapsed]);

  const serverLabel = serverType === 'stealthcloud' ? 'StealthCloud' : serverType === 'remote' ? t('home.remoteServer') : t('home.localServer');
  const serverIcon = serverType === 'stealthcloud' ? 'cloud' : serverType === 'remote' ? 'globe' : 'wifi';

  // Status detection
  const isBackingUp = progressAction === 'backup';
  const isSyncing = progressAction === 'sync';
  const isCleaning = progressAction === 'cleanup';
  const isCertifying = progressAction === 'nft';
  const isIdle = !isBackingUp && !isSyncing && !isCleaning && !isCertifying;
  const isFetching = loading && isIdle;

  const progressPercent = Math.min(Math.max(progress, 0), 1) * 100;
  const showProgress = progressPercent > 0 && !isFetching && !isIdle;

  const getStatusColor = () => {
    if (isCertifying) return COLORS.nft;
    if (isCleaning) return COLORS.accent;
    if (isSyncing) return COLORS.secondary;
    if (isBackingUp) return COLORS.primary;
    if (loading) return COLORS.primary;
    if (isIdle) return COLORS.secondary;
    return COLORS.primary;
  };
  const statusColor = getStatusColor();

  // ─── COLLAPSIBLE QUICK-STATS BAR (always visible above scroll) ──
  const renderQuickStatsBar = () => {
    if (activeTab !== 'home') return null;

    const isActive = !isIdle && !isFetching;
    const operationLabel = isCertifying ? t('home.mintingNft') : isCleaning ? t('home.scanning') : isSyncing ? t('home.syncing') : t('home.backingUp');

    return (
      <View style={styles.qsBarWrap}>
        <LinearGradient colors={[`${statusColor}18`, `${statusColor}0C`, `${statusColor}10`]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.qsBarGradient}>
          <LinearGradient colors={[`${statusColor}22`, `${statusColor}0A`, 'transparent']}
            start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />

          {/* 2×2 grid — always visible */}
          <View style={{ paddingVertical: scaleSpacing(4), paddingHorizontal: scaleSpacing(10) }}>
            <View style={styles.qsRow}>
              <View style={styles.qsCell}>
                <View style={[styles.qsIcon, { backgroundColor: `${COLORS.primary}18` }]}>
                  <Feather name="user" size={scale(13)} color={COLORS.primary} />
                </View>
                <View style={styles.qsText}>
                  <Text style={styles.qsLabel}>{t('home.qsAccount')}</Text>
                  <Text style={styles.qsValue} numberOfLines={1}>{qsEmail || '—'}</Text>
                </View>
              </View>
              <View style={[styles.qsCell, styles.qsCellRight]}>
                <View style={[styles.qsIcon, { backgroundColor: `${COLORS.secondary}18` }]}>
                  <View style={[styles.qsDot, { backgroundColor: COLORS.secondary }]} />
                </View>
                <View style={styles.qsText}>
                  <Text style={styles.qsLabel}>{t('home.qsServer')}</Text>
                  <Text style={styles.qsValue} numberOfLines={1}>{serverLabel}</Text>
                </View>
              </View>
            </View>
            <View style={styles.qsRow}>
              <View style={styles.qsCell}>
                <View style={[styles.qsIcon, { backgroundColor: 'rgba(99,102,241,0.15)' }]}>
                  <Feather name="cloud" size={scale(13)} color="#6366F1" />
                </View>
                <View style={styles.qsText}>
                  <Text style={styles.qsLabel}>{t('home.qsLastBackup')}</Text>
                  <Text style={styles.qsValue} numberOfLines={1}>{qsLastBackupTime || '—'}</Text>
                </View>
              </View>
              <View style={[styles.qsCell, styles.qsCellRight]}>
                <View style={[styles.qsIcon, { backgroundColor: `${COLORS.nft}18` }]}>
                  <Feather name="shield" size={scale(13)} color={COLORS.nft} />
                </View>
                <View style={styles.qsText}>
                  <Text style={styles.qsLabel}>{t('home.qsNfts')}</Text>
                  <Text style={styles.qsValue} numberOfLines={1}>{qsNftCount != null ? String(qsNftCount) : '—'}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Progress overlay — sits on top of stats during active operations */}
          {isActive && (
            <View style={styles.heroOverlay}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.card }]} />
              <LinearGradient colors={[`${statusColor}30`, `${statusColor}08`]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <View style={styles.heroTopRow}>
                <View style={styles.heroSpinnerWrap}>
                  <GradientSpinner size={scale(28)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.heroTitle, { color: statusColor }]} numberOfLines={1}>{operationLabel}</Text>
                  {status ? <Text style={styles.heroStatus} numberOfLines={1}>{status}</Text> : null}
                </View>
                {showProgress ? (
                  <Text style={[styles.heroPct, { color: statusColor }]}>{Math.round(progressPercent)}%</Text>
                ) : null}
              </View>
              {showProgress ? (
                <View style={styles.heroTrack}>
                  <LinearGradient colors={[statusColor, `${statusColor}BB`]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={[styles.heroFill, { width: `${progressPercent}%` }]} />
                </View>
              ) : (
                <View style={styles.heroTrack}>
                  <View style={[styles.heroFillIndeterminate, { backgroundColor: `${statusColor}40` }]} />
                </View>
              )}
            </View>
          )}
        </LinearGradient>
      </View>
    );
  };

  // ─── TAB: HOME ──────────────────────────────────────────────────
  const renderHomeTab = () => (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      <SectionHeader icon="cloud" title={t('home.backupSync')} color={COLORS.primary} />

      {/* Backup — gradient button with glow */}
      <View style={styles.actionRow}>
        <AnimatedPressable style={[styles.primaryBtn, loading && styles.disabled, isAndroid ? { elevation: 2 } : { shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }]}
          onPress={onBackupAll} onLongPress={onLongPressBackup} delayLongPress={2000} disabled={loading}>
          <LinearGradient colors={['rgba(3,225,255,0.15)', 'rgba(3,225,255,0.06)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryBtnGrad}>
            <View style={styles.primaryBtnIcon}>
              <Feather name="upload-cloud" size={scale(24)} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.primaryBtnTitle}>{t('home.backupAll')}</Text>
              <Text style={styles.primaryBtnSub}>{t('home.uploadToCloud')}</Text>
            </View>
            <Feather name="chevron-right" size={scale(20)} color="rgba(255,255,255,0.4)" />
          </LinearGradient>
        </AnimatedPressable>
        <AnimatedPressable style={[styles.sideBtn, { borderColor: `${COLORS.primary}35` }, loading && styles.disabled]}
          onPress={onBackupSelected} disabled={loading}>
          <Feather name="check-square" size={scale(20)} color={COLORS.primary} />
          <Text style={[styles.sideBtnLabel, { color: COLORS.primary }]}>{t('home.select')}</Text>
        </AnimatedPressable>
      </View>

      {/* Sync — gradient button with glow */}
      <View style={styles.actionRow}>
        <AnimatedPressable style={[styles.primaryBtn, loading && styles.disabled, isAndroid ? { elevation: 2 } : { shadowColor: COLORS.secondary, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }]}
          onPress={onSyncAll} onLongPress={onLongPressSync} delayLongPress={2000} disabled={loading}>
          <LinearGradient colors={['rgba(0,255,163,0.15)', 'rgba(0,255,163,0.06)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryBtnGrad}>
            <View style={styles.primaryBtnIcon}>
              <Feather name="download-cloud" size={scale(24)} color="#FFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.primaryBtnTitle}>{t('home.syncAll')}</Text>
              <Text style={styles.primaryBtnSub}>{t('home.downloadFromCloud')}</Text>
            </View>
            <Feather name="chevron-right" size={scale(20)} color="rgba(255,255,255,0.4)" />
          </LinearGradient>
        </AnimatedPressable>
        <AnimatedPressable style={[styles.sideBtn, { borderColor: `${COLORS.secondary}35` }, loading && styles.disabled]}
          onPress={onSyncSelected} disabled={loading}>
          <Feather name="check-square" size={scale(20)} color={COLORS.secondary} />
          <Text style={[styles.sideBtnLabel, { color: COLORS.secondary }]}>{t('home.select')}</Text>
        </AnimatedPressable>
      </View>


      <SectionHeader icon="tool" title={t('home.cleanDuplicates') || 'CLEAN DUPLICATES'} color={COLORS.accent} />

      <View style={styles.actionRow}>
        <AnimatedPressable style={[styles.toolCard, loading && styles.disabled, isAndroid ? { elevation: 1 } : { shadowColor: COLORS.accent, shadowOpacity: 0.12, shadowRadius: 8 }]}
          onPress={onCleanBestMatches} disabled={loading}>
          <LinearGradient colors={[`${COLORS.accent}10`, `${COLORS.accent}04`]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.toolCardGrad}>
            <View style={[styles.toolCardIcon, { backgroundColor: `${COLORS.accent}18` }]}>
              <Feather name="copy" size={scale(26)} color={COLORS.accent} />
            </View>
            <Text style={styles.toolCardTitle}>{t('home.identical')}</Text>
            <Text style={styles.toolCardSub}>{t('home.exactDuplicates')}</Text>
          </LinearGradient>
        </AnimatedPressable>

        <AnimatedPressable style={[styles.toolCard, loading && styles.disabled, isAndroid ? { elevation: 1 } : { shadowColor: COLORS.accent, shadowOpacity: 0.12, shadowRadius: 8 }]}
          onPress={onCleanSimilar} disabled={loading}>
          <LinearGradient colors={[`${COLORS.accent}10`, `${COLORS.accent}04`]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.toolCardGrad}>
            <View style={[styles.toolCardIcon, { backgroundColor: `${COLORS.accent}18` }]}>
              <Feather name="layers" size={scale(26)} color={COLORS.accent} />
            </View>
            <Text style={styles.toolCardTitle}>{t('home.similar')}</Text>
            <Text style={styles.toolCardSub}>{t('home.nearMatches')}</Text>
          </LinearGradient>
        </AnimatedPressable>
      </View>


      {/* ── Authenticity Section ── */}
      <SectionHeader icon="shield" title={t('home.solanaNft') || 'AUTHENTICITY'} color={COLORS.nft} />

      <AnimatedPressable style={[styles.nftHeroCard, loading && styles.disabled]}
        onPress={onMintNFT} disabled={loading}>
        <LinearGradient colors={['rgba(153,69,255,0.18)', 'rgba(153,69,255,0.08)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.nftHeroGrad}>
          <View style={styles.nftHeroGlow} />
          <View style={styles.nftHeroIconWrap}>
            <Feather name="shield" size={scale(32)} color="#FFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.nftHeroTitle}>{t('home.createNft')}</Text>
            <Text style={styles.nftHeroSub}>{t('home.mintPhotoSub')}</Text>
          </View>
          <Feather name="arrow-right" size={scale(20)} color="rgba(255,255,255,0.5)" />
        </LinearGradient>
      </AnimatedPressable>

      <View style={styles.actionRow}>
        <AnimatedPressable style={[styles.featureCard, isAndroid ? { elevation: 1 } : { shadowColor: COLORS.nft, shadowOpacity: 0.15, shadowRadius: 10 }]}
          onPress={onViewNFTs}>
          <LinearGradient colors={['rgba(153,69,255,0.12)', 'rgba(153,69,255,0.05)']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.featureCardGrad}>
            <View style={[styles.featureCardIcon, { backgroundColor: 'rgba(153,69,255,0.18)' }]}>
              <Feather name="image" size={scale(24)} color={COLORS.nft} />
            </View>
            <Text style={[styles.featureCardTitle, { color: '#FFF' }]}>{t('home.album')}</Text>
            <Text style={styles.featureCardSub}>{t('home.viewCollection')}</Text>
          </LinearGradient>
        </AnimatedPressable>

        <AnimatedPressable style={[styles.featureCard, isAndroid ? { elevation: 1 } : { shadowColor: '#f59e0b', shadowOpacity: 0.15, shadowRadius: 10 }]}
          onPress={onViewCertificates}>
          <LinearGradient colors={['rgba(245,158,11,0.12)', 'rgba(245,158,11,0.05)']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.featureCardGrad}>
            <View style={[styles.featureCardIcon, { backgroundColor: 'rgba(245,158,11,0.18)' }]}>
              <Feather name="award" size={scale(24)} color="#f59e0b" />
            </View>
            <Text style={[styles.featureCardTitle, { color: '#FFF' }]}>{t('home.viewCerts')}</Text>
            <Text style={styles.featureCardSub}>{t('home.authenticityProofs')}</Text>
          </LinearGradient>
        </AnimatedPressable>
      </View>
    </ScrollView>
  );

  // ─── TAB: TOOLS (AI Detector only — Clean Dups moved to Home) ──
  const renderToolsTab = () => (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      <SectionHeader icon="cpu" title={t('home.aiDetector')} color={COLORS.gold} subtitle={t('home.comingSoon')} />
      <GlowCard glowColor={COLORS.gold} gradientColors={[`${COLORS.gold}08`, COLORS.card]}>
        <View style={styles.comingSoonCard}>
          <LinearGradient colors={[`${COLORS.gold}20`, `${COLORS.gold}08`]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.comingSoonIcon}>
            <Feather name="cpu" size={scale(28)} color={COLORS.gold} />
          </LinearGradient>
          <Text style={[styles.comingSoonTitle, { textShadowColor: `${COLORS.gold}30`, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: isAndroid ? 2 : 8 }]}>{t('home.aiDetectorTitle')}</Text>
          <Text style={styles.comingSoonSub}>{t('home.aiDetectorSub')}</Text>
        </View>
      </GlowCard>
    </ScrollView>
  );

  // ─── TAB: SHARE ─────────────────────────────────────────────────
  const renderShareTab = () => (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.tabContent} showsVerticalScrollIndicator={false}>
      <SectionHeader icon="send" title={t('home.p2pSharing')} color={COLORS.secondary} subtitle={t('home.endToEndEncrypted')} />
      <GlowCard glowColor={COLORS.secondary} gradientColors={[`${COLORS.secondary}08`, COLORS.card]}>
        <View style={styles.comingSoonCard}>
          <LinearGradient colors={[`${COLORS.secondary}20`, `${COLORS.secondary}08`]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.comingSoonIcon}>
            <Feather name="lock" size={scale(28)} color={COLORS.secondary} />
          </LinearGradient>
          <Text style={[styles.comingSoonTitle, { textShadowColor: `${COLORS.secondary}30`, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: isAndroid ? 2 : 8 }]}>{t('home.p2pSharingTitle')}</Text>
          <Text style={styles.comingSoonSub}>{t('home.p2pSharingSub')}</Text>
        </View>
      </GlowCard>
    </ScrollView>
  );

  // ─── RENDER ─────────────────────────────────────────────────────
  const renderTabContent = () => {
    switch (activeTab) {
      case 'home':  return renderHomeTab();
      case 'info':  return infoContent || null;
      case 'settings': return settingsContent || null;
      default:      return renderHomeTab();
    }
  };

  return (
    <View style={styles.container}>
      {/* ── HEADER — gradient border ── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: scaleSpacing(6) }}>
            <Text style={styles.appName}>{appDisplayName}</Text>
            {appVersion ? <Text style={styles.versionBadge}>v{appVersion}</Text> : null}
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={onLogout} style={styles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="log-out" size={scale(17)} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>
        <LinearGradient colors={['transparent', `${COLORS.border}60`, 'transparent']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth }} />
      </View>

      {/* ── COLLAPSIBLE QUICK-STATS ── */}
      {renderQuickStatsBar()}

      {/* ── TAB CONTENT ── */}
      <View style={{ flex: 1 }}>
        {renderTabContent()}
      </View>

      {/* ── BOTTOM TAB BAR — glass effect ── */}
      <LinearGradient colors={[`${COLORS.tabBar}E0`, COLORS.tabBar]}
        start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.tabBar}>
        <LinearGradient colors={['transparent', `${COLORS.tabBarBorder}50`, 'transparent']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth }} />
        {TAB_DEFS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tabItem}
              onPress={() => { setActiveTab(tab.key); onTabChange?.(tab.key); }}
              activeOpacity={0.7}
            >
              {active ? (
                <LinearGradient colors={[`${tab.color}20`, `${tab.color}08`]}
                  start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.tabIconWrap}>
                  <Feather name={tab.icon} size={scale(20)} color={tab.color} />
                </LinearGradient>
              ) : (
                <View style={styles.tabIconWrap}>
                  <Feather name={tab.icon} size={scale(20)} color={COLORS.textDim} />
                </View>
              )}
              <Text style={[styles.tabLabel, active ? { color: tab.color, fontWeight: '700', textShadowColor: `${tab.color}50`, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: isAndroid ? 2 : 6 } : { color: COLORS.textDim }]}>
                {t(tab.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </LinearGradient>

      {/* ── COMPLETION OVERLAY ── */}
      {showCompletionTick && (
        <TouchableOpacity style={styles.completionOverlay} activeOpacity={1} onPress={onDismissCompletionTick}>
          <View style={styles.completionCard}>
            <View style={styles.completionCircle}>
              <Feather name="check" size={scale(36)} color={COLORS.secondary} />
            </View>
            {completionMessage ? <Text style={styles.completionMsg}>{completionMessage}</Text> : null}
            {completionMessage && !completionMessage.startsWith('0 ') && !completionMessage.startsWith('0개') && !completionMessage.startsWith('0 ف') && (completionMessage.includes('deleted') || completionMessage.includes('slettet') || completionMessage.includes('eliminad') || completionMessage.includes('dihapus') || completionMessage.includes('удален') || completionMessage.includes('smazán') || completionMessage.includes('excluíd') || completionMessage.includes('삭제') || completionMessage.includes('șters') || completionMessage.includes('हटा') || completionMessage.includes('supprimé') || completionMessage.includes('διαγράφ') || completionMessage.includes('kustuta') || completionMessage.includes('изтрит') || completionMessage.includes('izbris') || completionMessage.includes('cancella') || completionMessage.includes('eliminad') || completionMessage.includes('raderad') || completionMessage.includes('izdzēst') || completionMessage.includes('حذف') || completionMessage.includes(t('results.cleanupDone'))) ? (
              <Text style={[styles.completionHint, { marginTop: scaleSpacing(8), marginBottom: scaleSpacing(4), fontWeight: '600' }]}>
                {Platform.OS === 'ios' ? t('results.filesMovedToRecentlyDeleted') : t('results.filesMovedToDeleted')}
              </Text>
            ) : null}
            <Text style={styles.completionHint}>{t('home.tapToDismiss')}</Text>
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════════
// STYLES — Premium dark glass aesthetic
// ═══════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: scaleSpacing(20),
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 6 : Math.min(56, SCREEN_HEIGHT * 0.04 + 16),
    paddingBottom: scaleSpacing(8),
    position: 'relative',
  },
  headerLeft: { flex: 1 },
  appName: {
    fontSize: scale(22),
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  versionBadge: {
    fontSize: scale(11),
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  headerActions: {
    flexDirection: 'row',
    gap: scaleSpacing(2),
  },
  headerBtn: {
    width: scale(36),
    height: scale(36),
    borderRadius: scale(18),
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Tab bar (glass) ──
  tabBar: {
    flexDirection: 'row',
    paddingTop: scaleSpacing(6),
    paddingBottom: Platform.OS === 'android' ? ANDROID_NAV_BAR_HEIGHT + scaleSpacing(4) : scaleSpacing(6),
    paddingHorizontal: scaleSpacing(8),
    position: 'relative',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabIconWrap: {
    width: scale(36),
    height: scale(28),
    borderRadius: scale(14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: scale(10),
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // ── Tab content ──
  tabContent: {
    paddingHorizontal: scaleSpacing(16),
    paddingTop: scaleSpacing(12),
    paddingBottom: scaleSpacing(16),
    gap: scaleSpacing(10),
  },

  // ── GlowCard ──
  glowCardOuter: {
    borderRadius: scale(20),
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.2, shadowRadius: 16 },
      android: { elevation: 2 },
    }),
  },
  glowCardGradient: {
    borderRadius: scale(20),
  },

  // ── Quick Stats Bar (collapsible) ──
  qsBarWrap: {
    marginHorizontal: scaleSpacing(16),
    marginTop: scaleSpacing(6),
    borderRadius: scale(16),
    overflow: 'hidden',
  },
  qsBarGradient: {
    borderRadius: scale(16),
    position: 'relative',
    overflow: 'hidden',
  },
  // Expanded 2×2 grid cells
  qsRow: {
    flexDirection: 'row',
  },
  qsCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: scaleSpacing(6),
    paddingVertical: scaleSpacing(6),
    paddingHorizontal: scaleSpacing(4),
  },
  qsCellRight: {
    justifyContent: 'flex-start',
  },
  qsIcon: {
    width: scale(26),
    height: scale(26),
    borderRadius: scale(7),
    alignItems: 'center',
    justifyContent: 'center',
  },
  qsDot: {
    width: scale(6),
    height: scale(6),
    borderRadius: scale(3),
  },
  qsText: {
    flex: 1,
    minWidth: 0,
  },
  qsLabel: {
    fontSize: scale(9),
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: COLORS.textMuted,
    lineHeight: scale(12),
    marginBottom: 1,
  },
  qsValue: {
    fontSize: scale(12),
    fontWeight: '600',
    color: COLORS.text,
    lineHeight: scale(16),
  },
  // Collapsed single-line
  qsCollapsedRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: scaleSpacing(12),
    gap: scaleSpacing(5),
  },
  qsCollapsedText: {
    fontSize: scale(11),
    fontWeight: '600',
    color: COLORS.text,
    maxWidth: scale(70),
  },
  qsCollapsedDot: {
    width: scale(3),
    height: scale(3),
    borderRadius: scale(2),
    opacity: 0.4,
  },
  // Hero progress overlay (during active operations — sits on top of stats)
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: scale(16),
    paddingVertical: scaleSpacing(12),
    paddingHorizontal: scaleSpacing(14),
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 2,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scaleSpacing(10),
    marginBottom: scaleSpacing(10),
  },
  heroSpinnerWrap: {
    width: scale(36),
    height: scale(36),
    borderRadius: scale(10),
    backgroundColor: 'rgba(0,0,0,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: scale(15),
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  heroStatus: {
    fontSize: scale(11),
    color: '#FFFFFF',
    marginTop: 2,
    lineHeight: scale(15),
  },
  heroPct: {
    fontSize: scale(22),
    fontWeight: '800',
    letterSpacing: -0.5,
    minWidth: scale(50),
    textAlign: 'right',
  },
  heroTrack: {
    height: scale(6),
    backgroundColor: COLORS.border,
    borderRadius: scale(3),
    overflow: 'hidden',
  },
  heroFill: {
    height: '100%',
    borderRadius: scale(3),
  },
  heroFillIndeterminate: {
    height: '100%',
    width: '30%',
    borderRadius: scale(3),
  },

  // ── Section header ──
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scaleSpacing(8),
    marginTop: scaleSpacing(4),
    marginBottom: scaleSpacing(2),
    paddingHorizontal: scaleSpacing(4),
  },
  sectionHeaderDot: {
    width: scale(4),
    height: scale(16),
    borderRadius: scale(2),
  },
  sectionHeaderTitle: {
    fontSize: scale(11),
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  sectionHeaderSub: {
    fontSize: scale(10),
    color: COLORS.textDim,
    marginTop: 1,
  },

  // ── Action rows ──
  actionRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: scaleSpacing(8),
  },

  // ── Primary button (Backup/Sync) — gradient fill ──
  primaryBtn: {
    flex: 1,
    borderRadius: scale(14),
    overflow: 'hidden',
  },
  primaryBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: scaleSpacing(14),
    paddingHorizontal: scaleSpacing(14),
    borderRadius: scale(14),
  },
  primaryBtnIcon: {
    width: scale(42),
    height: scale(42),
    borderRadius: scale(12),
    backgroundColor: 'rgba(0,0,0,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: scaleSpacing(10),
  },
  primaryBtnTitle: {
    fontSize: scale(16),
    fontWeight: '700',
    color: '#FFF',
  },
  primaryBtnSub: {
    fontSize: scale(11),
    color: 'rgba(255,255,255,0.6)',
    marginTop: 1,
  },

  // ── Side button (Select) ──
  sideBtn: {
    width: scale(56),
    alignSelf: 'stretch',
    borderRadius: scale(14),
    borderWidth: 1,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: scaleSpacing(2),
  },
  sideBtnLabel: {
    fontSize: scale(9),
    fontWeight: '600',
  },

  // ── NFT hero card — gradient fill ──
  nftHeroCard: {
    borderRadius: scale(16),
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: COLORS.nft, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 14 },
      android: { elevation: 2 },
    }),
  },
  nftHeroGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: scaleSpacing(16),
    paddingHorizontal: scaleSpacing(16),
    borderRadius: scale(16),
    position: 'relative',
    overflow: 'hidden',
  },
  nftHeroGlow: {
    position: 'absolute',
    top: -20,
    right: -20,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  nftHeroIconWrap: {
    width: scale(48),
    height: scale(48),
    borderRadius: scale(14),
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: scaleSpacing(12),
  },
  nftHeroTitle: {
    fontSize: scale(17),
    fontWeight: '700',
    color: '#FFF',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  nftHeroSub: {
    fontSize: scale(11),
    color: 'rgba(255,255,255,0.65)',
    marginTop: 2,
  },

  // ── Feature card (Album, Certs) — gradient fill ──
  featureCard: {
    flex: 1,
    borderRadius: scale(14),
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  featureCardGrad: {
    paddingVertical: scaleSpacing(16),
    paddingHorizontal: scaleSpacing(14),
    alignItems: 'center',
    borderRadius: scale(14),
  },
  featureCardIcon: {
    width: scale(48),
    height: scale(48),
    borderRadius: scale(14),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: scaleSpacing(8),
  },
  featureCardTitle: {
    fontSize: scale(13),
    fontWeight: '700',
  },
  featureCardSub: {
    fontSize: scale(10),
    color: COLORS.textDim,
    marginTop: 2,
    textAlign: 'center',
  },

  // ── Tool card (Clean dups) — gradient fill ──
  toolCard: {
    flex: 1,
    borderRadius: scale(14),
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.border,
  },
  toolCardGrad: {
    paddingVertical: scaleSpacing(16),
    paddingHorizontal: scaleSpacing(14),
    alignItems: 'center',
    borderRadius: scale(14),
  },
  toolCardIcon: {
    width: scale(52),
    height: scale(52),
    borderRadius: scale(16),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: scaleSpacing(8),
  },
  toolCardTitle: {
    fontSize: scale(14),
    fontWeight: '700',
    color: COLORS.text,
  },
  toolCardSub: {
    fontSize: scale(11),
    color: COLORS.textMuted,
    marginTop: 2,
  },

  // ── Coming soon ──
  comingSoonCard: {
    alignItems: 'center',
    paddingVertical: scaleSpacing(24),
    paddingHorizontal: scaleSpacing(20),
  },
  comingSoonIcon: {
    width: scale(56),
    height: scale(56),
    borderRadius: scale(18),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: scaleSpacing(12),
  },
  comingSoonTitle: {
    fontSize: scale(15),
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: scaleSpacing(6),
  },
  comingSoonSub: {
    fontSize: scale(12),
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: scale(17),
  },

  // ── Disabled ──
  disabled: {
    opacity: 0.5,
  },

  // ── Completion overlay ──
  completionOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.92)',
  },
  completionCard: {
    backgroundColor: COLORS.card,
    borderRadius: scale(24),
    paddingVertical: scaleSpacing(28),
    paddingHorizontal: scaleSpacing(36),
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${COLORS.secondary}30`,
    minWidth: scale(200),
    shadowColor: COLORS.secondary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  completionCircle: {
    width: scale(72),
    height: scale(72),
    borderRadius: scale(36),
    backgroundColor: `${COLORS.secondary}20`,
    borderWidth: 2.5,
    borderColor: COLORS.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completionMsg: {
    marginTop: scaleSpacing(16),
    color: COLORS.text,
    fontSize: scale(17),
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  completionHint: {
    marginTop: scaleSpacing(12),
    color: COLORS.textDim,
    fontSize: scale(12),
    fontWeight: '400',
    textAlign: 'center',
  },
});

export default HomeScreen;
