#!/bin/bash

# Android Icon Cleanup Script for Solana-Seeker
# Removes WebP duplicates that Android auto-generates during build

ANDROID_RES="android/app/src/main/res"

echo "🧹 Cleaning up Android icon duplicates in solana-seeker..."

# Remove any WebP versions of launcher icons (Android creates these automatically)
find "$ANDROID_RES" -name "ic_launcher*.webp" -delete
find "$ANDROID_RES" -name "ic_launcher_*.webp" -delete

echo "✅ Android icons cleaned - no WebP duplicates!"
echo "Your APK should build successfully now."
