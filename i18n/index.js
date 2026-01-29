// PhotoLynk Multi-language Support
// Auto-detects device language, persists user preference, fallback to English
// Uses simple translation lookup without i18n-js to avoid make-plural dependency issues

import * as Localization from 'expo-localization';
import * as SecureStore from 'expo-secure-store';

// Import all translations
import en from './locales/en.json';
import uk from './locales/uk.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import es from './locales/es.json';
import it from './locales/it.json';
import pl from './locales/pl.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import da from './locales/da.json';
import nl from './locales/nl.json';
import fi from './locales/fi.json';
import no from './locales/no.json';
import sv from './locales/sv.json';
import tr from './locales/tr.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zh from './locales/zh.json';
import ar from './locales/ar.json';
import et from './locales/et.json';
import lt from './locales/lt.json';
import lv from './locales/lv.json';
import hi from './locales/hi.json';

// All translations indexed by language code
const translations = { en, uk, fr, de, es, it, pl, pt, ru, da, nl, fi, no, sv, tr, ja, ko, zh, ar, et, lt, lv, hi };

// Current language state
let currentLocale = 'en';

// Language metadata for UI display
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', flag: '🇺🇦' },
  { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', flag: '🇵🇱' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', flag: '🇩🇰' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands', flag: '🇳🇱' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', flag: '🇫🇮' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', flag: '🇳🇴' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', flag: '🇸🇪' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', rtl: true },
  { code: 'et', name: 'Estonian', nativeName: 'Eesti', flag: '🇪🇪' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių', flag: '🇱🇹' },
  { code: 'lv', name: 'Latvian', nativeName: 'Latviešu', flag: '🇱🇻' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳' },
];

// Storage key for persisted language preference (true = use English, false/null = use system)
const USE_ENGLISH_KEY = 'app_use_english';

// Check if language is supported
const isSupported = (code) => {
  return SUPPORTED_LANGUAGES.some(lang => lang.code === code);
};

// Get device locale code (e.g., 'en', 'fr', 'de')
const getDeviceLocale = () => {
  // Use getLocales() function to get FRESH locale data (not cached static properties)
  // This ensures we detect language changes after app restart
  let locales = [];
  try {
    locales = Localization.getLocales() || [];
  } catch (e) {
    // Fallback to static properties if getLocales() fails
    locales = Localization.locales || [];
  }
  
  // Also try static locale as fallback
  const staticLocale = Localization.locale || '';
  
  // Log raw values for debugging
  console.log(`[i18n] Raw locale: "${staticLocale}", getLocales(): ${JSON.stringify(locales?.slice(0, 3))}`);
  
  // Try getLocales() array first (most reliable, returns fresh data)
  if (locales && locales.length > 0) {
    for (const loc of locales) {
      const locStr = typeof loc === 'string' ? loc : loc?.languageCode || loc?.languageTag || '';
      const code = locStr.split(/[-_]/)[0].toLowerCase();
      if (code && isSupported(code)) {
        console.log(`[i18n] Found supported locale from getLocales(): ${code}`);
        return code;
      }
    }
    // Return first locale even if not supported
    const firstLoc = locales[0];
    const firstCode = typeof firstLoc === 'string' ? firstLoc : firstLoc?.languageCode || firstLoc?.languageTag || '';
    if (firstCode) {
      return firstCode.split(/[-_]/)[0].toLowerCase();
    }
  }
  
  // Fallback to static locale property
  if (staticLocale) {
    const code = staticLocale.split(/[-_]/)[0].toLowerCase();
    if (code && isSupported(code)) {
      return code;
    }
    return code || 'en';
  }
  
  return 'en';
};

// Get system language (returns 'en' if system language is not supported)
export const getSystemLanguage = () => {
  const deviceLocale = getDeviceLocale();
  return isSupported(deviceLocale) ? deviceLocale : 'en';
};

// Check if user has forced English mode
let useEnglishMode = false;

// Initialize language - call this on app start
// Auto-detects system language, defaults to English if unknown
export const initializeLanguage = async () => {
  try {
    // Clear any old language preference keys from previous versions
    try {
      await SecureStore.deleteItemAsync('app_language');
      await SecureStore.deleteItemAsync('selected_language');
    } catch (e) { /* ignore */ }
    
    // Check if user has forced English mode
    const savedUseEnglish = await SecureStore.getItemAsync(USE_ENGLISH_KEY);
    useEnglishMode = savedUseEnglish === 'true';
    
    if (useEnglishMode) {
      currentLocale = 'en';
      console.log(`[i18n] Using English (user preference)`);
      return 'en';
    }
    
    // Auto-detect from device system language
    const systemLang = getSystemLanguage();
    currentLocale = systemLang;
    console.log(`[i18n] Auto-detected system language: ${systemLang}`);
    return systemLang;
  } catch (e) {
    console.log('[i18n] Error initializing language:', e);
    currentLocale = 'en';
    return 'en';
  }
};

// Toggle between English and System language
export const setUseEnglish = async (useEnglish) => {
  try {
    useEnglishMode = useEnglish;
    await SecureStore.setItemAsync(USE_ENGLISH_KEY, useEnglish ? 'true' : 'false');
    
    if (useEnglish) {
      currentLocale = 'en';
      console.log(`[i18n] Switched to English`);
    } else {
      currentLocale = getSystemLanguage();
      console.log(`[i18n] Switched to system language: ${currentLocale}`);
    }
    return true;
  } catch (e) {
    console.log('[i18n] Error saving language preference:', e);
    return false;
  }
};

// Check if using English mode (vs system language)
export const isUsingEnglish = () => {
  return useEnglishMode;
};

// Change language directly (for backwards compatibility)
export const setLanguage = async (code) => {
  if (code === 'en') {
    return setUseEnglish(true);
  } else {
    // If setting to system language, disable English mode
    return setUseEnglish(false);
  }
};

// Quick switch to English (accessible from any language)
export const switchToEnglish = async () => {
  return setUseEnglish(true);
};

// Get current language code
export const getCurrentLanguage = () => {
  return currentLocale;
};

// Get language info
export const getLanguageInfo = (code) => {
  return SUPPORTED_LANGUAGES.find(lang => lang.code === code);
};

// Check if current language is RTL
export const isRTL = () => {
  const lang = getLanguageInfo(currentLocale);
  return lang?.rtl || false;
};

// Translation function - simple key lookup with fallback to English
export const t = (key, options = {}) => {
  const keys = key.split('.');
  let value = translations[currentLocale];
  
  // Navigate nested keys
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      // Fallback to English
      value = translations.en;
      for (const k2 of keys) {
        if (value && typeof value === 'object' && k2 in value) {
          value = value[k2];
        } else {
          return key; // Return key if not found
        }
      }
      break;
    }
  }
  
  // Handle interpolation (e.g., {{count}})
  if (typeof value === 'string' && options) {
    for (const [optKey, optVal] of Object.entries(options)) {
      value = value.replace(new RegExp(`{{${optKey}}}`, 'g'), String(optVal));
    }
  }
  
  return typeof value === 'string' ? value : key;
};

// Export translations for direct access if needed
export { translations };
