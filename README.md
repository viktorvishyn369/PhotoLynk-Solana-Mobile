# PhotoLynk - Solana Mobile Monolith Hackathon Submission

**Camera-to-Blockchain Authenticity Proof in One Tap**

PhotoLynk is a mobile-first Android app that transforms your phone's camera into a blockchain-powered authenticity engine. Capture a photo, and in seconds it's minted as a compressed NFT on Solana with cryptographic proof of authenticity — complete with RFC 3161 trusted timestamps, C2PA provenance manifests, and EXIF integrity hashing.

[![Solana Mobile](https://img.shields.io/badge/Solana-Mobile-9945FF?style=flat&logo=solana)](https://solanamobile.com/)
[![Android](https://img.shields.io/badge/Platform-Android-3DDC84?style=flat&logo=android)](https://developer.android.com/)
[![React Native](https://img.shields.io/badge/React_Native-0.76-61DAFB?style=flat&logo=react)](https://reactnative.dev/)

---

## 🎯 Problem

Photographers, content creators, and mobile-first users face:
- **Theft & Misattribution**: Photos stolen, reposted without credit
- **Deepfake Concerns**: No way to prove "I took this photo at this time"
- **Centralized Platforms**: Locked into Instagram/TikTok with no ownership
- **Complex NFT Tools**: Existing solutions require desktop, multiple steps, technical knowledge

## 💡 Solution

PhotoLynk makes authenticity proof **instant and mobile-native**:

1. **Capture** → Tap camera button
2. **Certify** → One-tap minting with biometric auth
3. **Verify** → Anyone can verify authenticity via on-chain certificate

All powered by Solana's speed and Mobile Wallet Adapter for seamless UX.

---

## ✨ Key Features

### 📸 Camera-to-Blockchain Pipeline
- **Native Camera Integration**: Capture photos directly in-app
- **Instant Minting**: Compressed NFTs (cNFTs) via Metaplex Bubblegum
- **Sub-$0.01 Cost**: Solana's efficiency enables mass adoption

### 🔐 Cryptographic Proof Stack
- **RFC 3161 Timestamps**: Trusted third-party proof via FreeTSA.org
- **C2PA Manifests**: Industry-standard provenance metadata
- **4-Layer EXIF Hashing**: Content, raw EXIF, normalized EXIF, binding hash
- **SHA-256 Everywhere**: Tamper-evident cryptographic fingerprints

### 🏆 Certificate of Authenticity
- **On-Chain Metadata**: All hashes + timestamps stored in NFT attributes
- **Verifiable by Anyone**: No PhotoLynk account needed to verify
- **Offline Verification**: Export certificate, verify via command-line tools

### ☁️ StealthCloud Backup (Optional)
- **End-to-End Encrypted**: AES-256 + NaCl secretbox
- **Cross-Device Sync**: Android ↔ Desktop ↔ iOS
- **Zero-Knowledge**: Server never sees plaintext

### 🔗 Solana Mobile Stack Integration
- **Mobile Wallet Adapter**: Seamless transaction signing
- **Phantom/Solflare Support**: Works with popular mobile wallets
- **Biometric Auth**: Fingerprint/Face ID for minting approval

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    PhotoLynk Android App                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Camera     │  │  NFT Minting │  │ Certificate  │  │
│  │  Capture     │→ │   Engine     │→ │   Viewer     │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│         ↓                  ↓                  ↑          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ EXIF Extract │  │ Wallet Auth  │  │ StealthCloud │  │
│  │  (Native)    │  │   (MWA)      │  │    Backup    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                          ↓
         ┌────────────────┴────────────────┐
         ↓                                  ↓
┌──────────────────┐            ┌──────────────────┐
│  Solana Mainnet  │            │  FreeTSA.org     │
│  (Compressed NFT)│            │  (RFC 3161 TSA)  │
└──────────────────┘            └──────────────────┘
```

### Tech Stack
- **Frontend**: React Native 0.76, Expo SDK 52
- **Blockchain**: Solana Web3.js, Metaplex Bubblegum (cNFTs)
- **Wallet**: Mobile Wallet Adapter, Phantom/Solflare
- **Crypto**: NaCl (TweetNaCl.js), SHA-256 (js-sha256)
- **Native Modules**: Swift (iOS), Kotlin (Android) for EXIF extraction
- **Backend**: Node.js server for minting orchestration (optional)

---

## 🚀 Getting Started

### Prerequisites
- Android device or emulator (API 24+)
- Solana wallet (Phantom or Solflare mobile app)
- Small amount of SOL for minting (~$0.001 per photo)

### Installation

1. **Download APK**
   ```bash
   # Production build included in submission
   photolynk-solana-2.0.0-62.apk
   ```

2. **Install on Android**
   ```bash
   adb install photolynk-solana-2.0.0-62.apk
   ```

3. **Setup Wallet**
   - Install Phantom or Solflare from Google Play
   - Create/import wallet
   - Add small amount of SOL

4. **Launch PhotoLynk**
   - Grant camera permissions
   - Connect wallet via Mobile Wallet Adapter
   - Start minting!

### Development Setup

```bash
# Clone repo
git clone https://github.com/viktorvishyn369/PhotoLynk-Mobile.git
cd PhotoLynk-Mobile

# Install dependencies
npm install

# Run on Android
npx expo run:android

# Build production APK
eas build --platform android --profile production
```

---

## 📱 User Flow

### 1. Capture Photo
```
Camera Screen → Tap Shutter → Preview → ✓ Use Photo
```

### 2. Mint NFT
```
Mint Screen → Enter Title/Description → Tap "Certify Original"
              ↓
Mobile Wallet Adapter → Biometric Auth → Transaction Signed
              ↓
Blockchain Confirmation (2-5 seconds)
              ↓
Certificate Generated & Saved
```

### 3. View Certificate
```
Certificates Tab → Select Photo → View Details
                                    ↓
                    ┌───────────────┴───────────────┐
                    ↓                               ↓
            Proof Details                   Verification Commands
            • Content Hash                  • OpenSSL verify RFC 3161
            • EXIF Hashes (4x)             • FreeTSA.org verification
            • RFC 3161 Token               • SHA-256 hash check
            • C2PA Manifest                • Solana Explorer link
```

---

## 🔍 Technical Highlights

### Mobile Wallet Adapter Integration
```javascript
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol';

const signature = await transact(async (wallet) => {
  const authResult = await wallet.authorize({
    cluster: 'mainnet-beta',
    identity: { name: 'PhotoLynk' }
  });
  
  return await wallet.signAndSendTransactions({
    transactions: [mintTransaction]
  });
});
```

### Compressed NFT Minting
```javascript
import { createTree, mintV1 } from '@metaplex-foundation/mpl-bubblegum';

// Create Merkle tree (one-time setup)
const tree = await createTree(umi, {
  maxDepth: 14,
  maxBufferSize: 64
});

// Mint compressed NFT (~$0.0005 per mint)
await mintV1(umi, {
  leafOwner: walletPublicKey,
  merkleTree: treeAddress,
  metadata: {
    name: 'Sunset at Golden Gate',
    uri: ipfsMetadataUrl,
    sellerFeeBasisPoints: 500,
    collection: null,
    creators: [{ address: creatorWallet, verified: true, share: 100 }]
  }
});
```

### EXIF Integrity Hashing
```javascript
// 4-layer hash pyramid for tamper detection
const contentHash = sha256(imageBytes);
const exifRawHash = sha256(rawExifBytes);
const exifNormalizedHash = sha256(normalizedExifJson);
const exifBindingHash = sha256(contentHash + exifNormalizedHash);

// Stored in NFT attributes for on-chain verification
attributes: [
  { trait_type: 'Content Hash', value: `SHA256:${contentHash}` },
  { trait_type: 'EXIF Raw Hash', value: `SHA256:${exifRawHash}` },
  { trait_type: 'EXIF Hash', value: `SHA256:${exifNormalizedHash}` },
  { trait_type: 'EXIF Binding Hash', value: `SHA256:${exifBindingHash}` }
]
```

### RFC 3161 Trusted Timestamp
```javascript
// Request timestamp from FreeTSA.org
const tsaToken = await requestRFC3161Timestamp(contentHash);

// Verify timestamp (anyone can do this)
$ openssl ts -verify \
  -data photo.jpg \
  -in timestamp.tsr \
  -CAfile freetsa-cacert.pem \
  -untrusted tsa-cert.pem
```

---

## 🎨 Screenshots

### Main Flow
| Camera Capture | Mint Screen | Certificate Viewer |
|---------------|-------------|-------------------|
| ![Camera](docs/screenshots/camera.png) | ![Mint](docs/screenshots/mint.png) | ![Certificate](docs/screenshots/certificate.png) |

### Verification
| Proof Details | RFC 3161 Token | Solana Explorer |
|--------------|----------------|-----------------|
| ![Proof](docs/screenshots/proof.png) | ![Token](docs/screenshots/rfc3161.png) | ![Explorer](docs/screenshots/explorer.png) |

---

## 🏆 Hackathon Evaluation Criteria

### 1. Stickiness & PMF (25%)
- **Daily Habit**: Photographers mint photos daily (like Instagram posting)
- **Seeker Fit**: Mobile-first crypto users who value ownership
- **Network Effects**: Certificates shareable, verifiable by anyone
- **Retention Hook**: StealthCloud backup = ongoing utility

### 2. User Experience (25%)
- **One-Tap Minting**: Camera → Blockchain in 3 taps
- **Biometric Security**: No password typing on mobile
- **Clean UI**: Certificate viewer shows only essential info
- **Fast**: 2-5 second confirmation (Solana speed)

### 3. Innovation / X-factor (25%)
- **Unique**: Only mobile app doing camera → cNFT → RFC 3161 in one flow
- **Technical Depth**: 4-layer EXIF hashing, C2PA, encrypted backup
- **Novel Use Case**: Authenticity for photographers (not just art/collectibles)
- **Production-Ready**: Already deployed, real users

### 4. Presentation & Demo (25%)
- **Clear Problem/Solution**: Deepfakes, theft → blockchain proof
- **Live Demo**: Working APK, real transactions on mainnet
- **Technical Credibility**: Open source, detailed architecture
- **Market Opportunity**: 1B+ smartphone photographers globally

---

## 🔐 Security & Privacy

### Wallet Security
- **Non-Custodial**: PhotoLynk never holds private keys
- **MWA Standard**: Uses Solana Mobile's secure protocol
- **Biometric Auth**: Device-level security for transactions

### Photo Privacy
- **Optional Encryption**: StealthCloud backup is E2E encrypted
- **Local-First**: Photos stay on device unless you backup
- **Zero-Knowledge**: Server never sees plaintext images

### API Key Management
- **No Hardcoded Secrets**: All API keys via environment variables
- **Server-Side Minting**: Helius API keys on backend only
- **Public RPC Fallback**: Works without proprietary APIs

---

## 📊 Metrics & Traction

- **Minting Cost**: ~$0.0005 per photo (100x cheaper than standard NFTs)
- **Confirmation Time**: 2-5 seconds average
- **Storage**: Compressed NFTs = 99% smaller on-chain footprint
- **Verification**: Anyone can verify without PhotoLynk account

---

## 🛣️ Roadmap

### Phase 1: Core Features (✅ Complete)
- [x] Camera capture + EXIF extraction
- [x] Compressed NFT minting
- [x] RFC 3161 timestamps
- [x] C2PA manifests
- [x] Certificate viewer
- [x] StealthCloud backup

### Phase 2: Solana dApp Store Launch (Q2 2026)
- [ ] Publish to Solana dApp Store
- [ ] In-app SOL purchase (Moonpay/Ramp)
- [ ] Social sharing (Twitter, Instagram)
- [ ] Batch minting (photo albums)

### Phase 3: Creator Economy (Q3 2026)
- [ ] NFT marketplace integration
- [ ] Royalty splits for collaborations
- [ ] Verified photographer badges
- [ ] Portfolio websites (auto-generated)

### Phase 4: Enterprise (Q4 2026)
- [ ] Press/journalism verification
- [ ] Legal evidence timestamping
- [ ] Insurance claim documentation
- [ ] White-label licensing

---

## 🤝 Contributing

PhotoLynk is open source! Contributions welcome.

```bash
# Fork repo
git clone https://github.com/viktorvishyn369/PhotoLynk-Mobile.git

# Create feature branch
git checkout -b feature/amazing-feature

# Commit changes
git commit -m "Add amazing feature"

# Push and create PR
git push origin feature/amazing-feature
```

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file

---

## 🔗 Links

- **Demo Video**: [YouTube Link]
- **Pitch Deck**: [Slides Link]
- **Solana Explorer**: [View Minted NFTs](https://explorer.solana.com/)
- **FreeTSA Verification**: [freetsa.org](https://freetsa.org/)
- **Twitter**: [@PhotoLynk](https://twitter.com/photolynk)
- **Website**: [photolynk.io](https://photolynk.io)

---

## 🙏 Acknowledgments

- **Solana Mobile**: Mobile Wallet Adapter, Saga phone, Seeker community
- **Metaplex**: Bubblegum protocol for compressed NFTs
- **FreeTSA**: Free RFC 3161 timestamping service
- **C2PA**: Content Authenticity Initiative standards

---

## 📧 Contact

**Team**: Viktor Vishyn  
**Email**: support@photolynk.io  
**Discord**: [Join Community]  
**Hackathon**: Solana Mobile Monolith 2026

---

**Built for the Seeker community. Powered by Solana. Secured by cryptography.**
