// PhotoLynk Mobile App - Styles
import { StyleSheet, Platform, Dimensions, PixelRatio, StatusBar } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Responsive scaling for tablets (11-13 inch iPads)
const isTablet = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) >= 600;
const isLargeTablet = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) >= 768;

// Scale factor for fonts and spacing on tablets
const scale = (size) => {
  if (isLargeTablet) return size * 1.35; // 13" iPad
  if (isTablet) return size * 1.2; // 11" iPad
  return size; // Phone
};

// Scale for spacing/padding (less aggressive than fonts)
const scaleSpacing = (size) => {
  if (isLargeTablet) return size * 1.25;
  if (isTablet) return size * 1.15;
  return size;
};

export const THEME = {
  bg: '#121212',
  card: '#1E1E1E',
  text: '#FFFFFF',
  textSec: '#AAAAAA',
  primary: '#3B82F6',    // Ocean blue
  secondary: '#00FFA3',  // Solana bright mint/green
  accent: '#03E1FF',     // Solana ocean blue/cyan
  error: '#CF6679'
};

// Export for use in App.js if needed
export { isTablet, isLargeTablet, scale, scaleSpacing };

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    paddingTop: Platform.OS === 'ios' ? 0 : 0,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Auth Screen
  authHeader: {
    alignItems: 'center',
    marginBottom: Math.max(20, SCREEN_HEIGHT * 0.03),
    marginTop: Platform.OS === 'android' ? Math.max(40, SCREEN_HEIGHT * 0.08) : 0,
  },
  appIcon: {
    width: isTablet ? 140 : Math.min(100, SCREEN_WIDTH * 0.25),
    height: isTablet ? 140 : Math.min(100, SCREEN_WIDTH * 0.25),
    borderRadius: isTablet ? 28 : 20,
    marginBottom: scaleSpacing(16),
  },
  title: {
    fontSize: scale(32),
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: scaleSpacing(8),
  },
  subtitle: {
    fontSize: scale(14),
    color: '#AAAAAA',
    textAlign: 'center',
    paddingHorizontal: scaleSpacing(30),
  },
  form: {
    paddingHorizontal: Math.max(20, SCREEN_WIDTH * 0.05),
    gap: scaleSpacing(12),
    maxWidth: isTablet ? 600 : 500,
    width: '100%',
    alignSelf: 'center',
    marginBottom: scaleSpacing(20),
  },
  input: {
    backgroundColor: '#1A1A1A',
    color: '#FFFFFF',
    padding: scaleSpacing(18),
    borderRadius: scaleSpacing(12),
    fontSize: scale(16),
    borderWidth: 1,
    borderColor: '#333333',
  },
  btnPrimary: {
    backgroundColor: '#2A2A2A',
    borderWidth: 2,
    borderColor: '#3B82F6',
    padding: scaleSpacing(18),
    borderRadius: scaleSpacing(12),
    alignItems: 'center',
    width: '100%',
    marginTop: scaleSpacing(10),
  },
  btnSecondary: {
    padding: scaleSpacing(18),
    alignItems: 'center',
  },
  btnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: scale(16),
  },
  btnDanger: {
    backgroundColor: '#7A1E2A',
    padding: scaleSpacing(16),
    borderRadius: scaleSpacing(12),
    alignItems: 'center',
    width: '100%',
    marginTop: scaleSpacing(12),
    borderWidth: 1,
    borderColor: '#CF6679',
  },
  btnDangerText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: scale(15),
  },
  btnTextSec: {
    color: '#AAAAAA',
    fontSize: scale(16),
  },
  authFooter: {
    alignItems: 'center',
    paddingVertical: scaleSpacing(20),
    paddingBottom: scaleSpacing(40),
  },
  footerText: {
    color: '#666666',
    fontSize: scale(12),
  },
  // Main Screen
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: scaleSpacing(20),
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44,
    paddingBottom: scaleSpacing(16),
    backgroundColor: '#0A0A0A',
  },
  headerTitle: {
    fontSize: scale(28),
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: scale(14),
    color: '#888888',
    marginTop: 2,
  },
  logoutBtn: {
    backgroundColor: '#1A1A1A',
    paddingHorizontal: scaleSpacing(16),
    paddingVertical: scaleSpacing(8),
    borderRadius: scaleSpacing(8),
  },
  logoutText: {
    color: '#FF6B6B',
    fontSize: scale(14),
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
    padding: Math.max(scaleSpacing(16), SCREEN_WIDTH * 0.04),
    maxWidth: isTablet ? 800 : 600,
    width: '100%',
    alignSelf: 'center',
  },
  statusCard: {
    backgroundColor: '#1A1A1A',
    padding: scaleSpacing(20),
    borderRadius: scaleSpacing(16),
    marginBottom: scaleSpacing(30),
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  statusCardGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.25)',
    ...Platform.select({
      ios: {
        shadowColor: '#fff',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: scaleSpacing(12),
  },
  statusLabel: {
    color: '#03DAC6',
    fontWeight: 'bold',
    fontSize: scale(12),
    letterSpacing: 2,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: scale(16),
    flexShrink: 1,
  },
  progressBar: {
    height: isTablet ? 8 : 6,
    backgroundColor: '#2A2A2A',
    borderRadius: isTablet ? 4 : 3,
    marginTop: scaleSpacing(12),
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#03DAC6',
  },
  actionsContainer: {
    flex: 1,
    gap: scaleSpacing(12),
    marginBottom: scaleSpacing(20),
  },
  actionCard: {
    flex: 1,
    padding: scaleSpacing(16),
    borderRadius: scaleSpacing(16),
    borderWidth: 2,
    minHeight: isTablet ? 100 : 80,
  },
  backupCard: {
    backgroundColor: '#1A2A3A',
    borderColor: '#4A9FE8',
  },
  backupCardGlass: {
    backgroundColor: 'rgba(26, 42, 58, 0.7)',
    borderColor: 'rgba(74, 159, 232, 0.6)',
    ...Platform.select({
      ios: {
        shadowColor: '#4A9FE8',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  syncCard: {
    backgroundColor: '#0A2A2A',
    borderColor: '#03DAC6',
  },
  syncCardGlass: {
    backgroundColor: 'rgba(10, 42, 42, 0.7)',
    borderColor: 'rgba(3, 218, 198, 0.6)',
    ...Platform.select({
      ios: {
        shadowColor: '#03DAC6',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  cleanupCard: {
    backgroundColor: '#1E1B2E',
    borderColor: '#6366F1',
  },
  cleanupCardGlass: {
    backgroundColor: 'rgba(30, 27, 46, 0.7)',
    borderColor: 'rgba(99, 102, 241, 0.6)',
    ...Platform.select({
      ios: {
        shadowColor: '#6366F1',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  disabledCard: {
    opacity: 0.5,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.97)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: scaleSpacing(20),
  },
  overlayGlass: {
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  overlayCard: {
    width: '100%',
    maxWidth: isTablet ? 550 : 400,
    backgroundColor: '#000000',
    borderRadius: scaleSpacing(20),
    padding: scaleSpacing(24),
    borderWidth: 1,
    borderColor: '#333333',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  overlayCardGlass: {
    backgroundColor: '#000000',
    borderColor: '#333333',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  overlayTitle: {
    color: '#FFFFFF',
    fontSize: scale(22),
    fontWeight: '700',
    marginBottom: scaleSpacing(8),
    textAlign: 'center',
  },
  overlaySubtitle: {
    color: '#888888',
    fontSize: scale(14),
    lineHeight: scale(20),
    marginBottom: scaleSpacing(20),
    textAlign: 'center',
  },
  overlayBtnPrimary: {
    backgroundColor: '#000000',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    paddingVertical: scaleSpacing(16),
    borderRadius: scaleSpacing(14),
    alignItems: 'center',
    marginTop: scaleSpacing(8),
  },
  overlayBtnPrimaryGlass: {
    backgroundColor: '#000000',
    borderColor: '#FFFFFF',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  overlayBtnPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: scale(16),
  },
  overlayBtnSecondary: {
    backgroundColor: '#000000',
    paddingVertical: scaleSpacing(16),
    borderRadius: scaleSpacing(14),
    alignItems: 'center',
    marginTop: scaleSpacing(8),
    borderWidth: 1.5,
    borderColor: '#666666',
  },
  overlayBtnSecondaryGlass: {
    backgroundColor: '#000000',
    borderColor: '#666666',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  overlayBtnSecondaryText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: scale(16),
  },
  overlayBtnGhost: {
    paddingVertical: scaleSpacing(14),
    alignItems: 'center',
    marginTop: scaleSpacing(12),
  },
  overlayBtnGhostGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 10,
  },
  overlayBtnGhostText: {
    color: '#666666',
    fontSize: scale(15),
    fontWeight: '600',
  },
  pickerCard: {
    width: '100%',
    maxWidth: isTablet ? 800 : 650,
    maxHeight: '86%',
    backgroundColor: '#121212',
    borderRadius: scaleSpacing(16),
    borderWidth: 1,
    borderColor: '#2A2A2A',
    overflow: 'hidden',
  },
  pickerCardGlass: {
    backgroundColor: 'rgba(18, 18, 18, 0.92)',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    ...Platform.select({
      ios: {
        shadowColor: '#fff',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: scaleSpacing(12),
    paddingVertical: scaleSpacing(10),
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
    backgroundColor: '#0A0A0A',
  },
  pickerHeaderBtn: {
    paddingHorizontal: scaleSpacing(10),
    paddingVertical: scaleSpacing(8),
  },
  pickerHeaderBtnText: {
    color: THEME.accent,
    fontSize: scale(14),
    fontWeight: '700',
  },
  pickerHeaderTitle: {
    color: '#FFFFFF',
    fontSize: scale(14),
    fontWeight: '800',
  },
  pickerHeaderSubtitle: {
    color: '#8A8A8A',
    fontSize: scale(12),
    marginTop: 2,
  },
  pickerGrid: {
    padding: scaleSpacing(10),
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  pickerItem: {
    width: isTablet ? '24%' : '32%',
    aspectRatio: 1,
    borderRadius: scaleSpacing(12),
    overflow: 'hidden',
    marginBottom: scaleSpacing(8),
    borderWidth: 2,
    borderColor: '#1A1A1A',
  },
  pickerItemSelected: {
    borderColor: THEME.accent,
  },
  pickerItemSelectedGreen: {
    borderColor: THEME.secondary,
  },
  pickerThumb: {
    width: '100%',
    height: '100%',
  },
  pickerBadge: {
    position: 'absolute',
    left: scaleSpacing(6),
    bottom: scaleSpacing(6),
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: scaleSpacing(8),
    paddingHorizontal: scaleSpacing(8),
    paddingVertical: scaleSpacing(4),
  },
  pickerBadgeText: {
    color: '#FFFFFF',
    fontSize: scale(10),
    fontWeight: '800',
  },
  pickerCheck: {
    position: 'absolute',
    right: scaleSpacing(6),
    top: scaleSpacing(6),
    width: isTablet ? 28 : 22,
    height: isTablet ? 28 : 22,
    borderRadius: isTablet ? 14 : 11,
    backgroundColor: 'rgba(3, 225, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCheckGreen: {
    position: 'absolute',
    right: scaleSpacing(6),
    top: scaleSpacing(6),
    width: isTablet ? 28 : 22,
    height: isTablet ? 28 : 22,
    borderRadius: isTablet ? 14 : 11,
    backgroundColor: 'rgba(0, 255, 163, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCheckText: {
    color: '#000000',
    fontWeight: '900',
    fontSize: scale(14),
    includeFontPadding: false,
  },
  syncPickerList: {
    padding: scaleSpacing(10),
  },
  syncPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: scaleSpacing(12),
    paddingHorizontal: scaleSpacing(12),
    borderRadius: scaleSpacing(12),
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginBottom: scaleSpacing(10),
  },
  syncPickerRowSelected: {
    borderColor: THEME.secondary,
  },
  syncPickerRowLeft: {
    flex: 1,
    paddingRight: scaleSpacing(12),
  },
  syncPickerRowTitle: {
    color: '#FFFFFF',
    fontSize: scale(13),
    fontWeight: '800',
    marginBottom: scaleSpacing(4),
  },
  syncPickerRowMeta: {
    color: '#8A8A8A',
    fontSize: scale(12),
  },
  syncPickerCheck: {
    width: isTablet ? 30 : 24,
    height: isTablet ? 30 : 24,
    borderRadius: isTablet ? 15 : 12,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncPickerCheckOn: {
    backgroundColor: 'rgba(0, 255, 163, 0.92)',
    borderColor: 'rgba(0, 255, 163, 0.92)',
  },
  syncPickerCheckText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: scale(14),
  },
  syncPickerCheckTextOn: {
    color: '#000000',
  },
  cardIcon: {
    width: isTablet ? 60 : 48,
    height: isTablet ? 60 : 48,
    borderRadius: isTablet ? 30 : 24,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: scaleSpacing(10),
  },
  cardIconText: {
    fontSize: scale(24),
  },
  cardTitle: {
    fontSize: scale(17),
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: scaleSpacing(4),
  },
  cardDescription: {
    fontSize: scale(SCREEN_WIDTH < 380 ? 12 : 13),
    color: '#AAAAAA',
    lineHeight: scale(SCREEN_WIDTH < 380 ? 17 : 18),
  },
  infoCard: {
    backgroundColor: '#1A1A1A',
    padding: scaleSpacing(16),
    borderRadius: scaleSpacing(12),
    borderLeftWidth: isTablet ? 5 : 4,
    borderLeftColor: '#03DAC6',
  },
  infoCardGlass: {
    backgroundColor: 'rgba(3, 218, 198, 0.1)',
  },
  infoText: {
    color: '#AAAAAA',
    fontSize: scale(13),
  },
  // Server configuration
  serverConfig: {
    marginBottom: scaleSpacing(20),
  },
  serverLabel: {
    color: '#AAAAAA',
    fontSize: scale(12),
    marginBottom: scaleSpacing(8),
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  serverToggle: {
    flexDirection: 'row',
    gap: scaleSpacing(SCREEN_WIDTH < 380 ? 6 : 10),
    marginTop: scaleSpacing(12),
  },
  serverExplanation: {
    marginTop: scaleSpacing(12),
    padding: scaleSpacing(12),
    backgroundColor: '#1A1A1A',
    borderRadius: scaleSpacing(8),
    borderLeftWidth: isTablet ? 4 : 3,
    borderLeftColor: THEME.primary,
  },
  serverExplanationText: {
    color: '#CCCCCC',
    fontSize: scale(13),
    lineHeight: scale(20),
  },
  toggleBtn: {
    flex: 1,
    minHeight: isTablet ? 54 : (SCREEN_WIDTH < 380 ? 40 : 44),
    paddingVertical: scaleSpacing(SCREEN_WIDTH < 380 ? 8 : 10),
    paddingHorizontal: scaleSpacing(SCREEN_WIDTH < 380 ? 6 : 10),
    borderRadius: scaleSpacing(8),
    backgroundColor: '#1A1A1A',
    borderWidth: 2,
    borderColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtnActive: {
    backgroundColor: '#1A1A1A',
    borderColor: '#3B82F6',
  },
  toggleText: {
    color: '#888888',
    fontSize: scale(SCREEN_WIDTH < 380 ? 12 : 13),
    fontWeight: '600',
    textAlign: 'center',
    includeFontPadding: false,
  },
  toggleTextActive: {
    color: '#FFFFFF',
  },
  serverHint: {
    color: '#666666',
    fontSize: scale(12),
    marginTop: scaleSpacing(8),
    textAlign: 'center',
  },
  // Settings screen
  settingsCard: {
    backgroundColor: '#1A1A1A',
    padding: scaleSpacing(16),
    borderRadius: scaleSpacing(12),
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginBottom: scaleSpacing(16),
  },
  glassCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.25)',
    borderWidth: 1.5,
    ...Platform.select({
      ios: {
        shadowColor: '#fff',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  settingsTitle: {
    fontSize: scale(24),
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: scaleSpacing(8),
  },
  settingsDescription: {
    fontSize: scale(14),
    color: '#AAAAAA',
    marginBottom: scaleSpacing(16),
  },
  uuidBox: {
    backgroundColor: '#0A0A0A',
    padding: scaleSpacing(12),
    borderRadius: scaleSpacing(8),
    marginBottom: scaleSpacing(16),
  },
  uuidLabel: {
    fontSize: scale(11),
    color: '#888888',
    marginBottom: scaleSpacing(6),
  },
  uuidText: {
    fontSize: scale(11),
    color: '#03DAC6',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  inputLabel: {
    color: '#AAAAAA',
    fontSize: scale(14),
    marginBottom: scaleSpacing(8),
    marginTop: scaleSpacing(16),
  },
  inputHint: {
    color: '#666666',
    fontSize: scale(12),
    marginTop: scaleSpacing(6),
    fontStyle: 'italic',
  },
  stealthPlanBox: {
    marginTop: scaleSpacing(14),
    padding: scaleSpacing(14),
    borderRadius: scaleSpacing(14),
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  stealthPlanHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: scaleSpacing(8),
  },
  stealthPlanTitle: {
    color: '#FFFFFF',
    fontSize: scale(14),
    fontWeight: '700',
  },
  stealthPlanHint: {
    color: '#8A8A8A',
    fontSize: scale(12),
    marginBottom: scaleSpacing(10),
  },
  stealthPlanGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    gap: scaleSpacing(4),
  },
  stealthPlanCard: {
    flexBasis: isTablet ? '23%' : '24%',
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    backgroundColor: '#1A1A1A',
    borderRadius: scaleSpacing(10),
    padding: scaleSpacing(8),
    borderWidth: 1,
    borderColor: '#2A2A2A',
    minHeight: isTablet ? 90 : 70,
  },
  stealthPlanCardSelected: {
    borderColor: THEME.primary,
  },
  stealthPlanCardDisabled: {
    opacity: 0.55,
  },
  stealthPlanGb: {
    color: '#FFFFFF',
    fontSize: scale(13),
    fontWeight: '800',
    marginBottom: scaleSpacing(4),
  },
  stealthPlanMeta: {
    color: '#AAAAAA',
    fontSize: scale(9),
    marginBottom: scaleSpacing(6),
  },
  stealthPlanSoldOut: {
    color: '#FFB74D',
    fontSize: scale(11),
    lineHeight: scale(14),
  },
  stealthPlanPrice: {
    color: THEME.secondary,
    fontSize: scale(11),
    fontWeight: '700',
    marginBottom: scaleSpacing(2),
  },
  usageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: scaleSpacing(8),
  },
  usageItem: {
    width: '50%',
    paddingRight: scaleSpacing(10),
    marginBottom: scaleSpacing(10),
  },
  restorePurchasesBtn: {
    marginTop: scaleSpacing(12),
    paddingVertical: scaleSpacing(10),
    alignItems: 'center',
  },
  restorePurchasesText: {
    color: THEME.primary,
    fontSize: scale(14),
    fontWeight: '500',
  },
  serverInfo: {
    marginTop: scaleSpacing(16),
    padding: scaleSpacing(12),
    backgroundColor: '#0A0A0A',
    borderRadius: scaleSpacing(8),
  },
  serverInfoLabel: {
    color: '#888888',
    fontSize: scale(11),
    marginBottom: scaleSpacing(4),
  },
  serverInfoText: {
    color: '#9D9D9D',
    fontSize: scale(12),
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    flex: 1,
  },
  serverHelp: {
    marginTop: scaleSpacing(16),
    padding: scaleSpacing(14),
    backgroundColor: '#111111',
    borderRadius: scaleSpacing(10),
    borderWidth: 1,
    borderColor: '#222222',
  },
  serverHelpTitle: {
    color: '#FFFFFF',
    fontSize: scale(15),
    fontWeight: '700',
    marginBottom: scaleSpacing(8),
  },
  serverHelpSubtitle: {
    color: '#E0E0E0',
    fontSize: scale(13),
    fontWeight: '600',
    marginTop: scaleSpacing(6),
    marginBottom: scaleSpacing(4),
  },
  serverHelpText: {
    color: '#B0B0B0',
    fontSize: scale(12),
    lineHeight: scale(18),
    marginLeft: scaleSpacing(4),
  },
  headerButtons: {
    flexDirection: 'row',
    gap: scaleSpacing(10),
  },
  infoBtn: {
    backgroundColor: 'transparent',
    width: isTablet ? 44 : 36,
    height: isTablet ? 44 : 36,
    borderRadius: isTablet ? 22 : 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
  },
  infoBtnText: {
    fontSize: scale(20),
    fontWeight: 'bold',
    color: '#03DAC6',
  },
  settingsBtn: {
    backgroundColor: '#1A1A1A',
    paddingHorizontal: scaleSpacing(12),
    paddingVertical: scaleSpacing(8),
    borderRadius: scaleSpacing(8),
  },
  settingsText: {
    fontSize: scale(20),
  },
  backBtn: {
    paddingHorizontal: scaleSpacing(16),
    paddingVertical: scaleSpacing(8),
  },
  backText: {
    color: '#03DAC6',
    fontSize: scale(16),
  },
  // Setup Guide
  guideSteps: {
    marginTop: scaleSpacing(16),
    gap: scaleSpacing(16),
  },
  guideStep: {
    flexDirection: 'row',
    gap: scaleSpacing(12),
  },
  stepNumber: {
    width: isTablet ? 40 : 32,
    height: isTablet ? 40 : 32,
    borderRadius: isTablet ? 20 : 16,
    backgroundColor: '#3B3B3B',
    color: '#FFFFFF',
    fontSize: scale(16),
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: isTablet ? 40 : 32,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    color: '#FFFFFF',
    fontSize: scale(16),
    fontWeight: '600',
    marginBottom: scaleSpacing(4),
  },
  stepText: {
    color: '#AAAAAA',
    fontSize: scale(14),
    lineHeight: scale(20),
  },
  // How It Works
  howItWorksText: {
    color: '#CCCCCC',
    fontSize: scale(14),
    lineHeight: scale(22),
    marginTop: scaleSpacing(12),
  },
  boldText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  setupGuideBtn: {
    backgroundColor: THEME.primary,
    padding: scaleSpacing(18),
    borderRadius: scaleSpacing(12),
    alignItems: 'center',
    width: '100%',
    marginBottom: scaleSpacing(12),
  },
  setupGuideBtnText: {
    color: '#000000',
    fontSize: scale(15),
    fontWeight: '600',
  },
  quickStepsTitle: {
    color: '#FFFFFF',
    fontSize: scale(14),
    fontWeight: '600',
    marginBottom: scaleSpacing(8),
  },
  quickStepsText: {
    color: '#CCCCCC',
    fontSize: scale(13),
    lineHeight: scale(22),
  },
  linkList: {
    gap: scaleSpacing(8),
    marginTop: scaleSpacing(8),
  },
  linkButton: {
    backgroundColor: '#2A2A2A',
    paddingVertical: scaleSpacing(10),
    paddingHorizontal: scaleSpacing(14),
    borderRadius: scaleSpacing(10),
    borderWidth: 1,
    borderColor: '#3A3A3A',
  },
  linkButtonText: {
    color: '#FFFFFF',
    fontSize: scale(13),
    fontWeight: '600',
  },
  codeLine: {
    color: '#FFFFFF',
    fontSize: scale(12),
    backgroundColor: '#1A1A1A',
    paddingVertical: scaleSpacing(6),
    paddingHorizontal: scaleSpacing(10),
    borderRadius: scaleSpacing(6),
    marginTop: scaleSpacing(2),
  },
  codeHint: {
    color: '#888888',
    fontSize: scale(11),
    marginTop: scaleSpacing(2),
  },
  guideStepNumber: {
    width: isTablet ? 40 : 32,
    height: isTablet ? 40 : 32,
    borderRadius: isTablet ? 20 : 16,
    backgroundColor: THEME.primary,
    color: '#FFFFFF',
    fontSize: scale(16),
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: isTablet ? 40 : 32,
  },
  guideStepContent: {
    flex: 1,
  },
  guideStepTitle: {
    color: '#FFFFFF',
    fontSize: scale(15),
    fontWeight: '600',
    marginBottom: scaleSpacing(4),
  },
  guideStepDesc: {
    color: '#AAAAAA',
    fontSize: scale(13),
    lineHeight: scale(18),
  },
  copyLinkBtn: {
    backgroundColor: THEME.primary,
    paddingVertical: scaleSpacing(8),
    paddingHorizontal: scaleSpacing(16),
    borderRadius: scaleSpacing(8),
    marginTop: scaleSpacing(8),
    alignSelf: 'flex-start',
  },
  copyLinkText: {
    color: '#FFFFFF',
    fontSize: scale(14),
    fontWeight: '600',
  },
  // Resources
  resourceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    paddingVertical: scaleSpacing(10),
    paddingHorizontal: scaleSpacing(12),
    borderRadius: scaleSpacing(12),
    marginBottom: scaleSpacing(8),
    borderWidth: 1,
    borderColor: '#333333',
  },
  resourceIcon: {
    fontSize: scale(22),
    marginRight: scaleSpacing(10),
  },
  resourceContent: {
    flex: 1,
  },
  resourceTitle: {
    color: '#FFFFFF',
    fontSize: scale(14),
    fontWeight: '600',
    marginBottom: scaleSpacing(2),
  },
  resourceDesc: {
    color: '#AAAAAA',
    fontSize: scale(12),
  },
  resourceArrow: {
    color: '#666666',
    fontSize: scale(20),
    fontWeight: 'bold',
  },
  openSourceBadge: {
    backgroundColor: '#1A1A1A',
    paddingVertical: scaleSpacing(10),
    paddingHorizontal: scaleSpacing(12),
    borderRadius: scaleSpacing(8),
    borderWidth: 1,
    borderColor: '#444444',
    marginTop: scaleSpacing(6),
  },
  openSourceText: {
    color: '#888888',
    fontSize: scale(12),
    textAlign: 'center',
    fontWeight: '600',
  },
  // Settings Footer
  settingsFooter: {
    alignItems: 'center',
    paddingVertical: scaleSpacing(16),
    gap: scaleSpacing(6),
  },
  footerVersion: {
    color: '#666666',
    fontSize: scale(12),
    textAlign: 'center',
  },
  footerCopyright: {
    color: '#666666',
    fontSize: scale(12),
  },
});
