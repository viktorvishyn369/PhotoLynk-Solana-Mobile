# PhotoLynk Demo Video Script
**Duration**: 2:30 minutes  
**Target**: Solana Mobile Monolith Hackathon Judges

---

## OPENING (0:00 - 0:15)
**Visual**: App icon → Splash screen → Home screen  
**Voiceover**:
> "Every day, millions of photos are stolen, deepfaked, or misattributed. What if your phone's camera could prove authenticity the moment you press the shutter?"

**Text Overlay**: "PhotoLynk: Camera-to-Blockchain in One Tap"

---

## PROBLEM (0:15 - 0:30)
**Visual**: Split screen showing:
- Left: Instagram post "Photo stolen, no credit"
- Right: News headline "Deepfakes threaten journalism"

**Voiceover**:
> "Photographers face theft. Journalists need proof. Content creators lose ownership. Existing NFT tools require desktops, multiple steps, and technical knowledge."

**Text Overlay**: "The Problem: No Mobile-First Authenticity Proof"

---

## SOLUTION (0:30 - 0:45)
**Visual**: PhotoLynk app opening, camera screen

**Voiceover**:
> "PhotoLynk solves this with Solana's speed and Mobile Wallet Adapter. Capture a photo, tap once, and it's minted as a compressed NFT with cryptographic proof — all on your phone."

**Text Overlay**: 
- "✓ Compressed NFTs (99% cheaper)"
- "✓ RFC 3161 Timestamps"
- "✓ C2PA Provenance"
- "✓ Sub-$0.01 per mint"

---

## DEMO PART 1: CAPTURE & MINT (0:45 - 1:15)
**Visual**: Screen recording with finger taps highlighted

**Actions**:
1. Tap camera button (0:45)
2. Capture photo of sunset (0:48)
3. Tap "Use Photo" (0:50)
4. Mint screen appears with title field (0:52)
5. Type "Golden Gate Sunset" (0:54)
6. Tap "Certify Original" button (0:58)
7. Mobile Wallet Adapter popup (1:00)
8. Biometric auth (fingerprint animation) (1:02)
9. Transaction confirmed (1:05)
10. Success checkmark animation (1:08)

**Voiceover**:
> "Watch: I capture a photo, add a title, and tap 'Certify Original'. Mobile Wallet Adapter handles the transaction with biometric auth. In 5 seconds, it's minted on Solana mainnet."

**Text Overlay** (at 1:10):
- "Transaction Cost: $0.0005"
- "Confirmation Time: 4.2 seconds"

---

## DEMO PART 2: CERTIFICATE VIEWER (1:15 - 1:50)
**Visual**: Navigate to Certificates tab

**Actions**:
1. Tap "Certificates" tab (1:15)
2. Scroll through certificate list (1:17)
3. Tap on "Golden Gate Sunset" certificate (1:20)
4. Certificate detail view opens (1:22)
5. Scroll through proof details:
   - Content Hash: SHA256:a3f2... (1:25)
   - EXIF Raw Hash: SHA256:b7e1... (1:27)
   - EXIF Hash: SHA256:c9d4... (1:29)
   - EXIF Binding Hash: SHA256:f1a8... (1:31)
6. Expand "RFC 3161 Timestamp" section (1:33)
7. Show full TSA token (base64, scrolling) (1:35)
8. Show verification command (1:38)
9. Tap "View on Solana Explorer" (1:42)
10. Browser opens to Solana Explorer showing NFT (1:45)

**Voiceover**:
> "The certificate shows four cryptographic hashes — content, raw EXIF, normalized EXIF, and binding hash. The RFC 3161 timestamp from FreeTSA proves when this photo was taken. Anyone can verify this without a PhotoLynk account."

**Text Overlay** (at 1:40):
- "✓ Verifiable by Anyone"
- "✓ No Account Needed"
- "✓ Offline Verification Supported"

---

## DEMO PART 3: VERIFICATION (1:50 - 2:10)
**Visual**: Terminal window showing verification commands

**Actions**:
1. Show terminal with verification script (1:50)
2. Run: `openssl ts -verify -data photo.jpg -in timestamp.tsr` (1:52)
3. Output: "Verification: OK" (1:55)
4. Run: `sha256sum photo.jpg` (1:58)
5. Output matches on-chain hash (2:00)
6. Show Solana Explorer with NFT metadata (2:03)
7. Highlight matching hashes in metadata attributes (2:06)

**Voiceover**:
> "Here's the verification: OpenSSL confirms the RFC 3161 timestamp. SHA-256 matches the on-chain hash. The Solana blockchain provides immutable proof that this exact photo existed at this exact time."

**Text Overlay** (at 2:08):
- "Cryptographically Verified ✓"

---

## CLOSING: IMPACT (2:10 - 2:30)
**Visual**: Montage of use cases:
- Photographer at event
- Journalist in field
- Content creator filming
- Legal professional documenting

**Voiceover**:
> "PhotoLynk brings blockchain authenticity to the Seeker community — mobile-first users who value ownership. From photographers to journalists to creators, anyone with a phone can now prove their work is original."

**Text Overlay**:
- "Built for Solana Mobile"
- "Powered by Compressed NFTs"
- "Secured by Cryptography"

**Final Screen**:
```
PhotoLynk
Camera-to-Blockchain Authenticity

Download: photolynk.io
GitHub: github.com/viktorvishyn369/PhotoLynk-Mobile
Twitter: @PhotoLynk

Solana Mobile Monolith Hackathon 2026
```

---

## TECHNICAL NOTES FOR RECORDING

### Screen Recording Setup
- **Device**: Android phone (Pixel 7 or similar)
- **Resolution**: 1080x1920 (portrait)
- **Frame Rate**: 60fps
- **Screen Recorder**: AZ Screen Recorder or built-in Android recorder

### Editing Software
- **Recommended**: DaVinci Resolve (free) or Adobe Premiere
- **Transitions**: Quick cuts, no fancy effects
- **Text Overlays**: Sans-serif font (Roboto or Inter), white text with subtle shadow
- **Music**: Upbeat, tech-focused background track (low volume, ~20%)

### Voiceover Tips
- **Tone**: Confident, clear, enthusiastic but professional
- **Pace**: Moderate (not too fast), pause for emphasis
- **Microphone**: USB mic or good phone mic in quiet room
- **Script Timing**: Practice to hit 2:30 exactly

### B-Roll Suggestions
- Close-up of finger tapping buttons
- Wallet adapter popup animation
- Transaction confirmation animation
- Solana Explorer page loading
- Terminal commands running

### Export Settings
- **Format**: MP4 (H.264)
- **Resolution**: 1920x1080 (landscape) or 1080x1920 (portrait)
- **Bitrate**: 10-15 Mbps
- **Audio**: AAC, 192 kbps
- **File Size**: Target <100MB for easy upload

---

## SHOT LIST CHECKLIST

- [ ] App icon and splash screen
- [ ] Home screen overview
- [ ] Camera capture (sunset or interesting subject)
- [ ] Mint screen with title entry
- [ ] Mobile Wallet Adapter popup
- [ ] Biometric auth (fingerprint animation)
- [ ] Transaction confirmation
- [ ] Success animation
- [ ] Certificates list view
- [ ] Certificate detail view (full scroll)
- [ ] RFC 3161 token section
- [ ] Verification commands section
- [ ] Solana Explorer view
- [ ] Terminal verification (OpenSSL)
- [ ] SHA-256 hash verification
- [ ] Use case montage (stock footage or staged)
- [ ] Closing title card

---

## BACKUP SCRIPT (90 SECOND VERSION)

If 2:30 is too long, here's a condensed version:

**0:00-0:10**: Problem (photo theft, deepfakes)  
**0:10-0:20**: Solution (PhotoLynk + Solana Mobile)  
**0:20-0:50**: Demo (capture → mint → confirm)  
**0:50-1:15**: Certificate viewer (hashes, RFC 3161, verification)  
**1:15-1:30**: Impact (Seeker community, closing)

---

## POST-PRODUCTION CHECKLIST

- [ ] Color grade for consistency
- [ ] Add subtle zoom/pan to static shots
- [ ] Sync voiceover perfectly with visuals
- [ ] Add sound effects (button taps, success chime)
- [ ] Background music at 15-20% volume
- [ ] Text overlays readable on mobile screens
- [ ] Captions/subtitles for accessibility
- [ ] Test on mobile device before submission
- [ ] Export in multiple formats (MP4, WebM)
- [ ] Upload to YouTube (unlisted) for submission link
