#!/bin/bash

# Production build script for PhotoLynk Solana (Solana Mobile dApp Store)
# Usage: ./build-release.sh
#
# Outputs:
#   Android: Signed .apk file for Solana Mobile dApp Store
#
# Note: Solana Mobile dApp Store requires APK, not AAB
# Prerequisites:
#   - Android keystore configured in android/app/build.gradle

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$PROJECT_DIR/builds"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

cd "$PROJECT_DIR"

echo "╔════════════════════════════════════════════════════╗"
echo "║   PhotoLynk Solana - Production Build (dApp Store)  ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo "📁 Project: $PROJECT_DIR"
echo "🎯 Target: Solana Mobile dApp Store (APK)"
echo ""

# Create builds directory
mkdir -p "$BUILD_DIR"

# Kill any running processes
echo "🛑 Stopping Metro bundler..."
lsof -ti:8081 | xargs kill -9 2>/dev/null || true
pkill -f "react-native" 2>/dev/null || true
pkill -f "metro" 2>/dev/null || true

# Clean caches (preserve native modules)
echo "🧹 Clearing caches (preserving native modules)..."
watchman watch-del-all 2>/dev/null || true
rm -rf /tmp/metro-* 2>/dev/null || true
rm -rf ~/.expo/cache 2>/dev/null || true

# IMPORTANT: Do NOT run prebuild --clean or delete ios/android folders
# Native modules (PixelHash, ExifExtractor, MediaDelete) are preserved
echo "⚠️  Preserving android folder with native modules"

# Install dependencies
echo "📦 Installing dependencies..."
npm install --legacy-peer-deps

# Fix expo versions
echo "🔧 Fixing dependency versions..."
npx expo install --fix

# ============================================
# Android Build (APK for Solana dApp Store)
# ============================================
echo ""
echo "════════════════════════════════════════"
echo "🤖 Building Android Release (APK)"
echo "════════════════════════════════════════"

# Check for keystore
KEYSTORE_PATH="$PROJECT_DIR/android/app/photolynk-solana.keystore"
if [ ! -f "$KEYSTORE_PATH" ]; then
  echo ""
  echo "⚠️  No keystore found at: $KEYSTORE_PATH"
  echo ""
  echo "To create a keystore for Solana dApp Store signing:"
  echo ""
  echo "  keytool -genkeypair -v -storetype PKCS12 -keystore android/app/photolynk-solana.keystore \\"
  echo "    -alias photolynk -keyalg RSA -keysize 2048 -validity 10000"
  echo ""
  echo "Then add to android/app/build.gradle:"
  echo ""
  echo "  signingConfigs {"
  echo "      release {"
  echo "          storeFile file('photolynk-solana.keystore')"
  echo "          storePassword 'YOUR_STORE_PASSWORD'"
  echo "          keyAlias 'photolynk'"
  echo "          keyPassword 'YOUR_KEY_PASSWORD'"
  echo "      }"
  echo "  }"
  echo ""
  echo "Building with debug signing for now..."
  USE_DEBUG_SIGNING=true
else
  USE_DEBUG_SIGNING=false
  echo "✅ Keystore found: $KEYSTORE_PATH"
fi

# Clean Android build
echo "🧹 Cleaning Android build..."
(cd android && ./gradlew clean)

# Build APK (Solana dApp Store requires APK, not AAB)
echo "🏗️ Building signed APK for Solana Mobile dApp Store..."
(cd android && ./gradlew assembleRelease)

# Find and copy APK
APK_PATH=$(find android/app/build/outputs/apk -name "*release*.apk" 2>/dev/null | head -1)
if [ -n "$APK_PATH" ]; then
  mkdir -p "$BUILD_DIR/android"
  cp "$APK_PATH" "$BUILD_DIR/android/PhotoLynk-Solana_$TIMESTAMP.apk"
  
  # Also create a latest symlink
  ln -sf "PhotoLynk-Solana_$TIMESTAMP.apk" "$BUILD_DIR/android/PhotoLynk-Solana-latest.apk"
  
  echo ""
  echo "════════════════════════════════════════"
  echo "✅ Build Complete!"
  echo "════════════════════════════════════════"
  echo ""
  echo "📦 APK: $BUILD_DIR/android/PhotoLynk-Solana_$TIMESTAMP.apk"
  echo ""
  echo "📲 To install on Solana Seeker device:"
  echo "   adb install $BUILD_DIR/android/PhotoLynk-Solana_$TIMESTAMP.apk"
  echo ""
  echo "📤 To submit to Solana dApp Store:"
  echo "   1. Go to https://publisher.solanamobile.com"
  echo "   2. Upload the APK file"
  echo "   3. Fill in app metadata and screenshots"
  echo ""
  
  # Show APK info
  echo "📊 APK Details:"
  ls -lh "$BUILD_DIR/android/PhotoLynk-Solana_$TIMESTAMP.apk"
  
  # Verify APK signing (if aapt available)
  if command -v aapt &> /dev/null; then
    echo ""
    echo "📋 Package info:"
    aapt dump badging "$BUILD_DIR/android/PhotoLynk-Solana_$TIMESTAMP.apk" 2>/dev/null | grep -E "package:|versionCode|versionName" || true
  fi
else
  echo "❌ APK build failed - no APK found in output directory"
  exit 1
fi
