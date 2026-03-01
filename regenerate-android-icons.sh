#!/bin/bash

# Regenerate all Android app icons from the source icon
SOURCE_ICON="assets/icon.png"
ANDROID_RES="android/app/src/main/res"

echo "Regenerating Android app icons from $SOURCE_ICON..."

# Create mipmap directories if they don't exist
mkdir -p "$ANDROID_RES/mipmap-mdpi"
mkdir -p "$ANDROID_RES/mipmap-hdpi"
mkdir -p "$ANDROID_RES/mipmap-xhdpi"
mkdir -p "$ANDROID_RES/mipmap-xxhdpi"
mkdir -p "$ANDROID_RES/mipmap-xxxhdpi"

# Function to generate icon with safe zone padding
generate_icon() {
    local size=$1
    local output=$2
    local safe_size=$(echo "scale=0; $size * 0.72" | bc)
    magick "$SOURCE_ICON" \
        -background transparent \
        -resize ${safe_size}x${safe_size} \
        -gravity center \
        -extent ${size}x${size} \
        -quality 100 \
        "$output"
}

# Generate all required sizes for Android with safe zone padding
echo "Generating mdpi (48x48) with 72% safe zone..."
generate_icon 48 "$ANDROID_RES/mipmap-mdpi/ic_launcher.png"

echo "Generating hdpi (72x72) with 72% safe zone..."
generate_icon 72 "$ANDROID_RES/mipmap-hdpi/ic_launcher.png"

echo "Generating xhdpi (96x96) with 72% safe zone..."
generate_icon 96 "$ANDROID_RES/mipmap-xhdpi/ic_launcher.png"

echo "Generating xxhdpi (144x144) with 72% safe zone..."
generate_icon 144 "$ANDROID_RES/mipmap-xxhdpi/ic_launcher.png"

echo "Generating xxxhdpi (192x192) with 72% safe zone..."
generate_icon 192 "$ANDROID_RES/mipmap-xxxhdpi/ic_launcher.png"

# Generate adaptive icon components
echo "Generating adaptive icon components..."
cp "$ANDROID_RES/mipmap-mdpi/ic_launcher.png" "$ANDROID_RES/mipmap-mdpi/ic_launcher_foreground.png"
cp "$ANDROID_RES/mipmap-hdpi/ic_launcher.png" "$ANDROID_RES/mipmap-hdpi/ic_launcher_foreground.png"
cp "$ANDROID_RES/mipmap-xhdpi/ic_launcher.png" "$ANDROID_RES/mipmap-xhdpi/ic_launcher_foreground.png"
cp "$ANDROID_RES/mipmap-xxhdpi/ic_launcher.png" "$ANDROID_RES/mipmap-xxhdpi/ic_launcher_foreground.png"
cp "$ANDROID_RES/mipmap-xxxhdpi/ic_launcher.png" "$ANDROID_RES/mipmap-xxxhdpi/ic_launcher_foreground.png"

# Generate monochrome versions (grayscale)
echo "Generating monochrome adaptive icons..."
magick "$SOURCE_ICON" -resize 48x48 -colorspace Gray -contrast-stretch 0 -quality 100 "$ANDROID_RES/mipmap-mdpi/ic_launcher_monochrome.png"
magick "$SOURCE_ICON" -resize 72x72 -colorspace Gray -contrast-stretch 0 -quality 100 "$ANDROID_RES/mipmap-hdpi/ic_launcher_monochrome.png"
magick "$SOURCE_ICON" -resize 96x96 -colorspace Gray -contrast-stretch 0 -quality 100 "$ANDROID_RES/mipmap-xhdpi/ic_launcher_monochrome.png"
magick "$SOURCE_ICON" -resize 144x144 -colorspace Gray -contrast-stretch 0 -quality 100 "$ANDROID_RES/mipmap-xxhdpi/ic_launcher_monochrome.png"
magick "$SOURCE_ICON" -resize 192x192 -colorspace Gray -contrast-stretch 0 -quality 100 "$ANDROID_RES/mipmap-xxxhdpi/ic_launcher_monochrome.png"

echo "✓ All Android app icons regenerated with safe zone padding and high quality"
