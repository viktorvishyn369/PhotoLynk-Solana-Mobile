#!/bin/bash

# Comprehensive Clean Rebuild Script
# Clears ALL caches but PRESERVES native modules (android/ios folders)
# Usage: ./clean-rebuild.sh [project-path]

set -e

PROJECT_PATH=${1:-"."}
cd "$PROJECT_PATH"

echo "🧹 Comprehensive Clean Rebuild (Preserves Native Modules)"
echo "Project: $(pwd)"

# Kill all related processes
echo "🛑 Killing Metro bundler and related processes..."
lsof -ti:8081,8082,8083 2>/dev/null | xargs kill -9 2>/dev/null || true
pkill -f "react-native\|metro\|expo" 2>/dev/null || true

# Clear watchman
echo "🧽 Clearing watchman cache..."
watchman watch-del-all 2>/dev/null || true

# Clear Metro bundler caches
echo "🗑️ Clearing Metro bundler caches..."
rm -rf /tmp/metro-* 2>/dev/null || true
rm -rf /tmp/haste-map-* 2>/dev/null || true
rm -rf ~/.metro 2>/dev/null || true

# Clear Expo caches
echo "🎭 Clearing Expo caches..."
rm -rf .expo 2>/dev/null || true
rm -rf ~/.expo/cache 2>/dev/null || true

# Clear npm/node caches
echo "📦 Clearing npm/node caches..."
rm -rf node_modules/.cache 2>/dev/null || true
npm cache clean --force 2>/dev/null || true

# Clear React Native build artifacts (BUT NOT android/ios folders!)
echo "🔧 Clearing React Native build artifacts..."
rm -rf .bundle 2>/dev/null || true
rm -rf vendor/bundle 2>/dev/null || true

# Clear Android build cache (preserves android/ folder and native modules)
echo "🤖 Clearing Android build cache..."
if [ -d "android" ]; then
    (cd android && ./gradlew clean 2>/dev/null || true)
    rm -rf android/app/build/intermediates 2>/dev/null || true
    rm -rf android/app/build/tmp 2>/dev/null || true
    rm -rf android/.gradle 2>/dev/null || true
fi

# Clear iOS build artifacts (preserves ios/ folder and native modules)
echo "🍎 Clearing iOS build artifacts..."
if [ -d "ios" ]; then
    rm -rf ios/build 2>/dev/null || true
    rm -rf ios/Pods 2>/dev/null || true
    rm -rf ios/Podfile.lock 2>/dev/null || true
fi

# Clear Electron/Desktop caches
echo "🖥️ Clearing Electron/Desktop caches..."
rm -rf dist 2>/dev/null || true
rm -rf build/dist 2>/dev/null || true
rm -rf node_modules/.cache/electron-builder 2>/dev/null || true

# Clear macOS specific caches
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🍎 Clearing macOS-specific caches..."
    rm -rf ~/Library/Developer/Xcode/DerivedData/$(basename $(pwd))* 2>/dev/null || true
    rm -rf ~/Library/Caches/com.expo.* 2>/dev/null || true
    rm -rf ~/Library/Caches/org.reactnative.* 2>/dev/null || true
fi

# Reinstall dependencies
echo "📦 Reinstalling dependencies..."
npm install --legacy-peer-deps

# Fix Expo dependencies
echo "🔧 Fixing Expo dependencies..."
npx expo install --fix

echo "✅ Clean rebuild complete! Native modules preserved."
echo ""
echo "🚀 Ready to rebuild:"
echo "  Mobile: npx expo run:android  OR  npx expo run:ios"
echo "  Desktop: npm run build"
