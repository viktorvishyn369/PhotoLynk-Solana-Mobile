#!/bin/bash
# Auto-sync mobile-v2 changes to private GitHub repo

set -e

cd "$(dirname "$0")"

echo "🔄 Syncing mobile apps to private GitHub repo..."

# Check if there are changes
if [[ -z $(git status -s) ]]; then
  echo "✅ No changes to sync"
  exit 0
fi

# Stage all changes
git add -A

# Commit with timestamp
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")
git commit -m "Auto-sync: $TIMESTAMP" || echo "Nothing to commit"

# Push to private repo
git push origin master

echo "✅ Synced to https://github.com/viktorvishyn369/PhotoLynk-Mobile"
