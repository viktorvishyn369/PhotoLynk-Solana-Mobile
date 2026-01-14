// PhotoLynk Multi-language Support
// Auto-detects device language, persists user preference, fallback to English

import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import * as SecureStore from 'expo-secure-store';

// Import all translations
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import ru from './locales/ru.json';
import uk from './locales/uk.json';
import ar from './locales/ar.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import hi from './locales/hi.json';
import tr from './locales/tr.json';
import pl from './locales/pl.json';
import lt from './locales/lt.json';
import lv from './locales/lv.json';
import et from './locales/et.json';
import no from './locales/no.json';
import sv from './locales/sv.json';
import pt from './locales/pt.json';
import nl from './locales/nl.json';
import da from './locales/da.json';
import fi from './locales/fi.json';
import it from './locales/it.json';

const i18n = new I18n({
  en, es, fr, de, ru, uk, ar, zh, ja, ko, hi, tr, pl,
  lt, lv, et, no, sv, pt, nl, da, fi, it
});

// Language metadata for UI display
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', rtl: true },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių', flag: '🇱🇹' },
  { code: 'lv', name: 'Latvian', nativeName: 'Latviešu', flag: '🇱🇻' },
  { code: 'et', name: 'Estonian', nativeName: 'Eesti', flag: '🇪🇪' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', flag: '🇳🇴' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', flag: '🇩🇰' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', flag: '🇫🇮' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
];

// Storage key for persisted language
const LANGUAGE_KEY = 'app_language';

// Default settings
i18n.defaultLocale = 'en';
i18n.enableFallback = true;

// Get device locale code (e.g., 'en', 'fr', 'de')
const getDeviceLocale = () => {
  const locale = Localization.locale || 'en';
  // Extract language code (e.g., 'en-US' -> 'en')
  return locale.split('-')[0].toLowerCase();
};

// Check if language is supported
const isSupported = (code) => {
  return SUPPORTED_LANGUAGES.some(lang => lang.code === code);
};

// Initialize language - call this on app start
export const initializeLanguage = async () => {
  try {
    // Check for persisted preference
    const savedLanguage = await SecureStore.getItemAsync(LANGUAGE_KEY);
    
    if (savedLanguage && isSupported(savedLanguage)) {
      i18n.locale = savedLanguage;
      console.log(`[i18n] Loaded saved language: ${savedLanguage}`);
      return savedLanguage;
    }
    
    // Auto-detect from device
    const deviceLocale = getDeviceLocale();
    const detectedLanguage = isSupported(deviceLocale) ? deviceLocale : 'en';
    
    i18n.locale = detectedLanguage;
    await SecureStore.setItemAsync(LANGUAGE_KEY, detectedLanguage);
    console.log(`[i18n] Auto-detected language: ${detectedLanguage}`);
    return detectedLanguage;
  } catch (e) {
    console.log('[i18n] Error initializing language:', e);
    i18n.locale = 'en';
    return 'en';
  }
};

// Change language and persist
export const setLanguage = async (code) => {
  if (!isSupported(code)) {
    console.log(`[i18n] Language not supported: ${code}`);
    return false;
  }
  
  try {
    i18n.locale = code;
    await SecureStore.setItemAsync(LANGUAGE_KEY, code);
    console.log(`[i18n] Language changed to: ${code}`);
    return true;
  } catch (e) {
    console.log('[i18n] Error saving language:', e);
    return false;
  }
};

// Quick switch to English (accessible from any language)
export const switchToEnglish = async () => {
  return setLanguage('en');
};

// Get current language code
export const getCurrentLanguage = () => {
  return i18n.locale;
};

// Get language info
export const getLanguageInfo = (code) => {
  return SUPPORTED_LANGUAGES.find(lang => lang.code === code);
};

// Check if current language is RTL
export const isRTL = () => {
  const lang = getLanguageInfo(i18n.locale);
  return lang?.rtl || false;
};

// Translation function - main export
export const t = (key, options) => {
  return i18n.t(key, options);
};

// Export i18n instance for advanced usage
export default i18n;
