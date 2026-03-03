PhotoLynk Demo Script (≈2:00)

Opening (0:00–0:10)

Visual: App icon → splash → home screen

Voiceover:

PhotoLynk turns any photo into cryptographic proof of authenticity in one tap.

Text Overlay:
Camera → Hash → Timestamp → Solana NFT

Capture & Mint (0:10–0:40)

Visual: Open camera → capture photo → tap “Use Photo”

Voiceover:

I capture a photo. PhotoLynk computes a SHA-256 hash — a unique fingerprint of the exact image bytes.

Visual: Mint screen → enter title → tap “Certify Original”

I add a title and tap ‘Certify Original.’ The app prepares a compressed NFT and invokes Mobile Wallet Adapter.

Visual: Wallet popup → biometric auth → confirmation

I approve with biometric auth. In seconds, the NFT is minted on Solana mainnet.

Text Overlay:
Compressed NFT
Sub-cent cost
~4s confirmation

View Proof (0:40–1:15)

Visual: Navigate to Proofs tab → open proof detail

Voiceover:

Each proof contains four cryptographic hashes: content hash proving the exact photo, raw EXIF hash preserving camera metadata, normalized EXIF hash for consistent verification, and binding hash tying everything together.

Visual: Expand RFC 3161 section

The app also generates an RFC 3161 timestamp from FreeTSA — proving the photo existed at this exact moment, independently of the blockchain.

Text Overlay:
On-chain + Timestamp Authority
Dual proof

Verify (1:15–1:45)

Visual: Tap “View in Proof Vault” → show NFT in album

Voiceover:

The NFT stores all hashes on Solana. Anyone can view it — no PhotoLynk account required.

Visual: Tap “View on Solana Explorer”

Using OpenSSL, I can verify the RFC 3161 timestamp. Running SHA-256 on the photo produces the same hash on-chain. If the hash matches, the photo is authentic. If one byte changes, verification fails.

Closing (1:45–2:00)

Visual: Montage — photographer, journalist, creator

Voiceover:

PhotoLynk makes authenticity mobile-first. No desktop tools. Just capture, approve, mint. Immutable proof on Solana — all from your phone.

Final Screen Text:

PhotoLynk
Camera-to-Blockchain Authenticity
Built for Solana Mobile