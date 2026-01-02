#!/bin/bash

# Regenerate all Android app icons from the source adaptive icon
SOURCE_ICON="assets/adaptive-icon.png"
ANDROID_RES="android/app/src/main/res"

echo "Regenerating Android app icons from $SOURCE_ICON..."

# Create mipmap directories if they don't exist
mkdir -p "$ANDROID_RES/mipmap-mdpi"
mkdir -p "$ANDROID_RES/mipmap-hdpi"
mkdir -p "$ANDROID_RES/mipmap-xhdpi"
mkdir -p "$ANDROID_RES/mipmap-xxhdpi"
mkdir -p "$ANDROID_RES/mipmap-xxxhdpi"

# Generate all required sizes for Android
magick "$SOURCE_ICON" -resize 48x48 "$ANDROID_RES/mipmap-mdpi/ic_launcher.png"
magick "$SOURCE_ICON" -resize 48x48 "$ANDROID_RES/mipmap-mdpi/ic_launcher_round.png"

magick "$SOURCE_ICON" -resize 72x72 "$ANDROID_RES/mipmap-hdpi/ic_launcher.png"
magick "$SOURCE_ICON" -resize 72x72 "$ANDROID_RES/mipmap-hdpi/ic_launcher_round.png"

magick "$SOURCE_ICON" -resize 96x96 "$ANDROID_RES/mipmap-xhdpi/ic_launcher.png"
magick "$SOURCE_ICON" -resize 96x96 "$ANDROID_RES/mipmap-xhdpi/ic_launcher_round.png"

magick "$SOURCE_ICON" -resize 144x144 "$ANDROID_RES/mipmap-xxhdpi/ic_launcher.png"
magick "$SOURCE_ICON" -resize 144x144 "$ANDROID_RES/mipmap-xxhdpi/ic_launcher_round.png"

magick "$SOURCE_ICON" -resize 192x192 "$ANDROID_RES/mipmap-xxxhdpi/ic_launcher.png"
magick "$SOURCE_ICON" -resize 192x192 "$ANDROID_RES/mipmap-xxxhdpi/ic_launcher_round.png"

echo "✓ All Android app icons regenerated"
