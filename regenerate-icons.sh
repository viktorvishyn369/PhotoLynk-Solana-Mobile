#!/bin/bash

# Regenerate all iOS app icons from the source icon
SOURCE_ICON="assets/icon.png"
ICON_DIR="ios/PhotoLynk/Images.xcassets/AppIcon.appiconset"

echo "Regenerating iOS app icons from $SOURCE_ICON..."

# Generate all required sizes (preserving transparency)
magick "$SOURCE_ICON" -resize 20x20 "$ICON_DIR/icon-20x20@1x.png"
magick "$SOURCE_ICON" -resize 40x40 "$ICON_DIR/icon-20x20@2x.png"
magick "$SOURCE_ICON" -resize 60x60 "$ICON_DIR/icon-20x20@3x.png"

magick "$SOURCE_ICON" -resize 29x29 "$ICON_DIR/icon-29x29@1x.png"
magick "$SOURCE_ICON" -resize 58x58 "$ICON_DIR/icon-29x29@2x.png"
magick "$SOURCE_ICON" -resize 87x87 "$ICON_DIR/icon-29x29@3x.png"

magick "$SOURCE_ICON" -resize 40x40 "$ICON_DIR/icon-40x40@1x.png"
magick "$SOURCE_ICON" -resize 80x80 "$ICON_DIR/icon-40x40@2x.png"
magick "$SOURCE_ICON" -resize 120x120 "$ICON_DIR/icon-40x40@3x.png"

magick "$SOURCE_ICON" -resize 120x120 "$ICON_DIR/icon-60x60@2x.png"
magick "$SOURCE_ICON" -resize 180x180 "$ICON_DIR/icon-60x60@3x.png"

magick "$SOURCE_ICON" -resize 76x76 "$ICON_DIR/icon-76x76@1x.png"
magick "$SOURCE_ICON" -resize 152x152 "$ICON_DIR/icon-76x76@2x.png"

magick "$SOURCE_ICON" -resize 167x167 "$ICON_DIR/icon-83.5x83.5@2x.png"

magick "$SOURCE_ICON" -resize 1024x1024 "$ICON_DIR/icon-1024x1024@1x.png"
magick "$SOURCE_ICON" -resize 1024x1024 "$ICON_DIR/App-Icon-1024x1024@1x.png"
magick "$SOURCE_ICON" -resize 1024x1024 "$ICON_DIR/App-Icon-1024x1024-Dark@1x.png"
magick "$SOURCE_ICON" -resize 1024x1024 "$ICON_DIR/App-Icon-1024x1024-Tinted@1x.png"

echo "✓ All iOS app icons regenerated with transparency preserved"
