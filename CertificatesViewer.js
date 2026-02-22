/**
 * CertificatesViewer.js
 * 
 * Modal viewer for NFT Certificates of Authenticity (Limited Edition).
 * Certificates persist via SecureStore across app restarts/updates.
 * Supports viewing, sharing, and deleting certificates.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Share,
  ActivityIndicator,
  Dimensions,
  Platform,
  ScrollView,
  BackHandler,
  StatusBar,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Clipboard from '@react-native-clipboard/clipboard';
import NFTOperations from './nftOperations';
import * as WalletAdapter from './WalletAdapter';
import { t } from './i18n';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SCREEN_HEIGHT_FULL = Dimensions.get('screen').height;
const ANDROID_NAV_BAR_HEIGHT = Platform.OS === 'android' ? Math.max(48, SCREEN_HEIGHT_FULL - SCREEN_HEIGHT) : 0;

const COLORS = {
  background: '#0a0a0a',
  surface: '#1a1a1a',
  card: '#222222',
  border: '#333333',
  text: '#ffffff',
  textSecondary: '#888888',
  primary: '#9945FF',
  accent: '#f59e0b',
  error: '#ef4444',
};

const CertificatesViewer = ({ visible, onClose, serverUrl, getAuthHeaders, onShowNFT, pendingSelectMint, onPendingSelectConsumed }) => {
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCert, setSelectedCert] = useState(null);
  const [darkAlert, setDarkAlert] = useState(null);

  const showDarkAlert = (title, message, buttons = [{ text: t('common.ok'), onPress: () => setDarkAlert(null) }]) => {
    setDarkAlert({ title, message, buttons });
  };

  const _certLoadingRef = React.useRef(false);
  const loadCertificates = useCallback(async (isBackground = false) => {
    // Prevent concurrent calls — previous cycle may still be running (IPFS fetches can take 30s+)
    if (_certLoadingRef.current) return;
    _certLoadingRef.current = true;
    if (!isBackground) setLoading(true);
    try {
      // Sync: pull remote certs (backup is handled by App.js every 5min — skip here entirely)
      if (serverUrl && getAuthHeaders) {
        try {
          const authConfig = await getAuthHeaders();
          const headers = authConfig?.headers || authConfig;
          await NFTOperations.syncCertificatesFromServer(serverUrl, headers);
        } catch (_) {}
      }
      const certs = await NFTOperations.getStoredCertificates();
      
      // Load NFTs once (used for both enrichment and ownership filter)
      const allNFTs = await NFTOperations.getStoredNFTs();
      const normMint = (m) => m ? String(m).replace(/^cnft_/, '') : '';
      const nftMap = {};
      for (const n of allNFTs) {
        const key = normMint(n.mintAddress);
        if (key) nftMap[key] = n;
      }
      
      // Enrich certs with data from matching NFTs (fills missing badges/hashes)
      let enriched = 0;
      try {
        for (const c of certs) {
          const nft = nftMap[normMint(c.mintAddress)];
          if (!nft) continue;
          const attrs = nft.metadata?.attributes || nft.attributes || [];
          if (!c.contentHash) { const a = attrs.find(x => x.trait_type === 'Content Hash'); if (a) { c.contentHash = a.value; enriched++; } }
          if (!c.exifHash) { const a = attrs.find(x => x.trait_type === 'EXIF Hash'); if (a) { c.exifHash = a.value; enriched++; } }
          if (!c.cameraHash) { const a = attrs.find(x => x.trait_type === 'Camera Hash'); if (a) { c.cameraHash = a.value; enriched++; } }
          if (!c.license || c.license === 'arr') { const a = attrs.find(x => x.trait_type === 'License'); if (a) { c.license = a.value; enriched++; } }
          if (!c.storageType && nft.storageType) { c.storageType = nft.storageType; enriched++; }
          if (!c.encrypted && nft.encrypted) { c.encrypted = nft.encrypted; enriched++; }
          if (!c.watermarked && nft.watermarked) { c.watermarked = nft.watermarked; enriched++; }
          // RFC 3161 from NFT metadata
          const metaCert = nft.metadata?.properties?.certificate;
          if (!c.rfc3161Token && metaCert?.rfc3161?.tsaTokenBase64) { c.rfc3161Token = metaCert.rfc3161.tsaTokenBase64; c.hasRfc3161 = true; enriched++; }
          // C2PA from NFT metadata
          if (!c.c2paManifest && nft.metadata?.properties?.c2pa) { c.c2paManifest = nft.metadata.properties.c2pa; c.hasC2pa = true; enriched++; }
          // Also check attributes for RFC3161/C2PA presence
          if (!c.rfc3161Token && !c.hasRfc3161) { const a = attrs.find(x => x.trait_type === 'RFC 3161 Timestamp'); if (a) { c.hasRfc3161 = true; enriched++; } }
          if (!c.c2paManifest && !c.hasC2pa) { const a = attrs.find(x => x.trait_type === 'C2PA Provenance'); if (a) { c.hasC2pa = true; enriched++; } }
          // Fallback: NFT-level flags (survive metadata stripping)
          if (!c.hasRfc3161 && nft.hasRfc3161) { c.hasRfc3161 = true; enriched++; }
          if (!c.hasC2pa && nft.hasC2pa) { c.hasC2pa = true; enriched++; }
          // All limited edition NFTs are minted with RFC3161 + C2PA
          if (c.edition === 'limited' && !c.hasRfc3161) { c.hasRfc3161 = true; enriched++; }
          if (c.edition === 'limited' && !c.hasC2pa) { c.hasC2pa = true; enriched++; }
        }
      } catch (_) {}
      
      // Filter by ownership using LOCAL NFTs only (no blockchain scan — fast)
      let filtered = certs;
      try {
        const status = WalletAdapter.getConnectionStatus ? WalletAdapter.getConnectionStatus() : null;
        const addr = status?.address || null;
        if (addr) {
          const ownedSet = new Set(
            allNFTs
              .filter(n => (n?.ownerAddress || '') === addr)
              .map(n => normMint(n?.mintAddress || n?.assetId || ''))
              .filter(Boolean)
          );
          filtered = certs.filter(c => {
            const id = normMint(c?.mintAddress || '');
            if (id && id.startsWith('tx_')) return true;
            return id && ownedSet.has(id);
          });
        }
      } catch (_) {}

      // Deduplicate by id
      const seen = new Set();
      const unique = filtered.filter(c => {
        if (!c.id || seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
      setCertificates(unique.sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt)));
      if (!isBackground) setLoading(false);
      
      // Background: fetch metadata from IPFS for certs missing actual rfc3161Token or c2paManifest data
      // Skip certs already attempted in the last 2 hours to avoid infinite retry loop
      const RECOVERY_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
      const now = Date.now();
      const needsMetaFetch = certs.filter(c => {
        if (c.rfc3161Token && c.c2paManifest) return false; // already have full data
        if (c._recoveryAttemptedAt && (now - c._recoveryAttemptedAt) < RECOVERY_COOLDOWN_MS) return false; // cooldown
        const nft = nftMap[normMint(c.mintAddress)];
        const metaUrl = c.metadataUrl || nft?.metadataUrl;
        return !!metaUrl;
      });
      if (needsMetaFetch.length > 0) {
        console.log(`[Certs] ${needsMetaFetch.length} certs need RFC3161/C2PA recovery (after cooldown filter)`);
        const IPFS_GWS = ['https://gateway.pinata.cloud/ipfs/', 'https://dweb.link/ipfs/', 'https://w3s.link/ipfs/', 'https://nftstorage.link/ipfs/', 'https://ipfs.io/ipfs/'];
        const extractCid = (url) => { const m = (url || '').match(/(?:ipfs\/|ipfs:\/\/)([a-zA-Z0-9]+)/); return m ? m[1] : null; };
        const fetchOne = async (c) => {
          try {
            const nft = nftMap[normMint(c.mintAddress)];
            const metaUrl = c.metadataUrl || nft?.metadataUrl;
            if (!metaUrl) return;
            const cid = extractCid(metaUrl);
            const urls = cid ? IPFS_GWS.map(g => g + cid) : [metaUrl];
            let metaJson = null;
            for (const u of urls) {
              try {
                const ctrl = new AbortController();
                const tid = setTimeout(() => ctrl.abort(), 6000);
                const resp = await fetch(u, { signal: ctrl.signal });
                clearTimeout(tid);
                if (!resp.ok) continue;
                const text = await resp.text();
                // Try JSON parse first (unencrypted metadata)
                try { metaJson = JSON.parse(text); break; } catch (_) {}
                // If JSON parse fails, metadata is encrypted — download as binary file and decrypt
                if (nft?.encrypted && nft?.encryptionData?.metadataNonce) {
                  try {
                    const { getStealthCloudMasterKey } = require('./backgroundTask');
                    const FileSystem = require('expo-file-system');
                    const masterKey = await getStealthCloudMasterKey();
                    if (masterKey) {
                      const tmpMeta = `${FileSystem.cacheDirectory}cert_meta_${Date.now()}.bin`;
                      const dl = await FileSystem.downloadAsync(u, tmpMeta);
                      if (dl?.status === 200) {
                        const b64 = await FileSystem.readAsStringAsync(tmpMeta, { encoding: FileSystem.EncodingType.Base64 });
                        FileSystem.deleteAsync(tmpMeta, { idempotent: true }).catch(() => {});
                        const decrypted = NFTOperations.decryptMetadataJSON(b64, nft.encryptionData, masterKey);
                        if (decrypted) { metaJson = decrypted; break; }
                      } else {
                        FileSystem.deleteAsync(tmpMeta, { idempotent: true }).catch(() => {});
                      }
                    }
                  } catch (_) {}
                }
              } catch (_) {}
            }
            // Mark as attempted regardless of result (prevents infinite retry)
            c._recoveryAttemptedAt = Date.now();
            if (!metaJson) {
              console.log(`[Certs] No metadata for ${c.name} (encrypted or unavailable)`);
              return;
            }
            const mc = metaJson.properties?.certificate;
            if (mc?.rfc3161?.tsaTokenBase64 && !c.rfc3161Token) { c.rfc3161Token = mc.rfc3161.tsaTokenBase64; c.hasRfc3161 = true; enriched++; }
            if (mc?.rfc3161?.tsa && !c.rfc3161Tsa) { c.rfc3161Tsa = mc.rfc3161.tsa; enriched++; }
            if (metaJson.properties?.c2pa && !c.c2paManifest) { c.c2paManifest = metaJson.properties.c2pa; c.hasC2pa = true; enriched++; }
            const fAttrs = metaJson.attributes || [];
            if (!c.contentHash) { const a = fAttrs.find(x => x.trait_type === 'Content Hash'); if (a) { c.contentHash = a.value; enriched++; } }
            if (!c.exifHash) { const a = fAttrs.find(x => x.trait_type === 'EXIF Hash'); if (a) { c.exifHash = a.value; enriched++; } }
            console.log(`[Certs] Fetched metadata for ${c.name}, rfc3161=${!!c.rfc3161Token} c2pa=${!!c.c2paManifest}`);
          } catch (_) { c._recoveryAttemptedAt = Date.now(); }
        };
        // Unencrypted: parallel batches of 3 (small JSON). Encrypted: one at a time (6MB download+decrypt).
        // Cap to 5 unenc + 2 enc per cycle to avoid hogging CPU/network
        const unenc = needsMetaFetch.filter(c => { const n = nftMap[normMint(c.mintAddress)]; return !n?.encrypted; }).slice(0, 5);
        const enc = needsMetaFetch.filter(c => { const n = nftMap[normMint(c.mintAddress)]; return n?.encrypted && n?.encryptionData?.metadataNonce; }).slice(0, 2);
        for (let i = 0; i < unenc.length; i += 5) {
          await Promise.all(unenc.slice(i, i + 5).map(fetchOne));
        }
        for (const c of enc) { await fetchOne(c); }
      }
      
      // Always save after recovery attempts (persists _recoveryAttemptedAt cooldown timestamps)
      if (enriched > 0 || needsMetaFetch.length > 0) {
        if (enriched > 0) console.log(`[Certs] Enriched ${enriched} fields total`);
        try { await NFTOperations.saveAllCertificates(certs); } catch (_) {}
        // Re-render with enriched data
        const seen2 = new Set();
        const unique2 = filtered.filter(c => {
          if (!c.id || seen2.has(c.id)) return false;
          seen2.add(c.id);
          return true;
        });
        setCertificates([...unique2.sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt))]);
      }
    } catch (e) {
      console.warn('[Certs] Failed to load:', e?.message);
    } finally {
      _certLoadingRef.current = false;
      if (!isBackground) setLoading(false);
    }
  }, [serverUrl, getAuthHeaders]);

  useEffect(() => {
    if (visible) loadCertificates(false);
    if (!visible) return;
    const interval = setInterval(() => loadCertificates(true), 60000);
    return () => clearInterval(interval);
  }, [visible, loadCertificates]);

  // Auto-select certificate when navigating from NFTGallery
  useEffect(() => {
    if (!visible || !pendingSelectMint || certificates.length === 0) return;
    const normMint = (m) => m ? String(m).replace(/^cnft_/, '') : '';
    const target = normMint(pendingSelectMint);
    const match = certificates.find(c => normMint(c.mintAddress) === target);
    if (match) {
      setSelectedCert(match);
    }
    onPendingSelectConsumed?.();
  }, [visible, pendingSelectMint, certificates]);

  const handleShare = async (cert) => {
    try {
      const text = NFTOperations.formatCertificateForExport(cert);
      await Share.share({ message: text, title: `${t('certificates.certificateOfAuth')} — ${cert.name}` });
    } catch (e) {
      if (e.message !== 'User did not share') {
        showDarkAlert(t('common.error'), e.message);
      }
    }
  };

  const handleDelete = (cert) => {
    showDarkAlert(
      t('certificates.deleteCert'),
      t('certificates.deleteConfirm', { name: cert.name }),
      [
        { text: t('common.cancel'), onPress: () => setDarkAlert(null) },
        {
          text: t('common.delete'),
          onPress: async () => {
            setDarkAlert(null);
            await NFTOperations.removeCertificate(cert.id);
            if (selectedCert?.id === cert.id) setSelectedCert(null);
            loadCertificates();
          },
        },
      ]
    );
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return dateStr; }
  };

  const renderCertCard = ({ item }) => (
    <TouchableOpacity
      style={[styles.certCard, selectedCert?.id === item.id && styles.certCardSelected]}
      onPress={() => setSelectedCert(item)}
      activeOpacity={0.7}
    >
      <View style={styles.certCardHeader}>
        <View style={styles.certBadge}>
          <Feather name="award" size={16} color="#f59e0b" />
        </View>
        <View style={styles.certCardInfo}>
          <Text style={styles.certCardName} numberOfLines={1}>{item.name || t('certificates.untitled')}</Text>
          <Text style={styles.certCardDate}>{formatDate(item.issuedAt)}</Text>
        </View>
        <View style={styles.certCardActions}>
          <TouchableOpacity onPress={() => handleShare(item)} style={styles.certIconBtn}>
            <Feather name="share-2" size={16} color={COLORS.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(item)} style={styles.certIconBtn}>
            <Feather name="trash-2" size={16} color={COLORS.error} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.certCardMeta}>
        <View style={styles.certTag}>
          <Text style={styles.certTagText}>{t('certificates.limitedEdition')}</Text>
        </View>
        {item.encrypted && (
          <View style={[styles.certTag, { borderColor: '#9945FF40' }]}>
            <Feather name="lock" size={10} color="#9945FF" />
            <Text style={[styles.certTagText, { color: '#9945FF' }]}>{t('certificates.encrypted')}</Text>
          </View>
        )}
        {item.watermarked && (
          <View style={[styles.certTag, { borderColor: 'rgba(34, 197, 94, 0.3)' }]}>
            <Text style={[styles.certTagText, { color: '#22c55e' }]}>{t('certificates.watermarked')}</Text>
          </View>
        )}
        {(item.rfc3161Token || item.hasRfc3161) && (
          <View style={[styles.certTag, { borderColor: 'rgba(16,185,129,0.4)', backgroundColor: 'rgba(16,185,129,0.08)' }]}>
            <Feather name="clock" size={10} color="#10b981" />
            <Text style={[styles.certTagText, { color: '#10b981' }]}>RFC 3161</Text>
          </View>
        )}
        {(item.c2paManifest || item.hasC2pa) && (
          <View style={[styles.certTag, { borderColor: 'rgba(59,130,246,0.4)', backgroundColor: 'rgba(59,130,246,0.08)' }]}>
            <Feather name="shield" size={10} color="#3b82f6" />
            <Text style={[styles.certTagText, { color: '#3b82f6' }]}>C2PA</Text>
          </View>
        )}
        {item.license && item.license !== 'arr' && (
          <View style={[styles.certTag, { borderColor: 'rgba(245,158,11,0.3)' }]}>
            <Text style={[styles.certTagText, { color: '#f59e0b' }]}>{item.license}</Text>
          </View>
        )}
        {item.license === 'arr' && (
          <View style={[styles.certTag, { borderColor: 'rgba(245,158,11,0.3)' }]}>
            <Text style={[styles.certTagText, { color: '#f59e0b' }]}>All Rights Reserved</Text>
          </View>
        )}
        {item.storageType === 'onchain' && (
          <View style={[styles.certTag, { borderColor: 'rgba(245,158,11,0.3)', backgroundColor: 'rgba(245,158,11,0.08)' }]}>
            <Feather name="code" size={10} color="#f59e0b" />
            <Text style={[styles.certTagText, { color: '#f59e0b' }]}>On-Chain</Text>
          </View>
        )}
        {item.storageType === 'cloud' && (
          <View style={[styles.certTag, { borderColor: 'rgba(59,130,246,0.3)', backgroundColor: 'rgba(59,130,246,0.08)' }]}>
            <Feather name="cloud" size={10} color="#3b82f6" />
            <Text style={[styles.certTagText, { color: '#3b82f6' }]}>StealthCloud</Text>
          </View>
        )}
      </View>
      {item.mintAddress && (
        <Text style={styles.certMintAddr} numberOfLines={1}>
          {item.mintAddress.slice(0, 20)}...{item.mintAddress.slice(-8)}
        </Text>
      )}
    </TouchableOpacity>
  );

  const renderDetail = () => {
    if (!selectedCert) return null;
    const c = selectedCert;
    return (
      <View style={styles.detailContainer}>
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={() => setSelectedCert(null)} style={styles.detailBack}>
            <Feather name="arrow-left" size={20} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.detailTitle} numberOfLines={1}>{c.name || t('certificates.title')}</Text>
          <TouchableOpacity onPress={() => handleShare(c)} style={styles.detailShareBtn}>
            <Feather name="share-2" size={18} color="#f59e0b" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.detailScrollContent} showsVerticalScrollIndicator={false} bounces={false}>
        <View style={styles.detailCard}>
          <View style={styles.detailBadgeRow}>
            <Feather name="award" size={32} color="#f59e0b" />
            <Text style={styles.detailBadgeText}>{t('certificates.certificateOfAuth')}</Text>
          </View>

          <View style={styles.detailDivider} />

          <DetailRow label={t('certificates.edition')} value={t('certificates.limitedEdition')} />
          <DetailRow label={t('certificates.license')} value={({'arr':'All Rights Reserved','cc-by':'CC BY 4.0','cc-by-sa':'CC BY-SA 4.0','cc-by-nc':'CC BY-NC 4.0','cc-by-nc-sa':'CC BY-NC-SA 4.0','cc-by-nd':'CC BY-ND 4.0','cc-by-nc-nd':'CC BY-NC-ND 4.0','cc0':'CC0 1.0 (Public Domain)','commercial':'Commercial License'})[c.license] || c.license || 'All Rights Reserved'} />
          <DetailRow label={t('certificates.issued')} value={formatDate(c.issuedAt)} />

          <View style={styles.detailDivider} />
          <Text style={styles.detailSectionTitle}>{t('certificates.blockchainProof')}</Text>
          <DetailRow label={t('certificates.mintAddress')} value={c.mintAddress || 'N/A'} mono />
          <DetailRow label={t('certificates.transaction')} value={c.txSignature || 'N/A'} mono />
          <DetailRow label={t('certificates.creatorWallet')} value={c.creatorWallet || 'N/A'} mono />

          <View style={styles.detailDivider} />
          <Text style={styles.detailSectionTitle}>{t('certificates.integrityProof')}</Text>
          <DetailRow label={t('certificates.contentHash')} value={c.contentHash || 'N/A'} mono />
          <DetailRow label={t('certificates.exifHash')} value={c.exifHash || 'N/A'} mono />

          <View style={styles.verifyBox}>
            <Text style={styles.verifyTitle}>{t('certificates.howToVerify')}</Text>
            <Text style={styles.verifyText}>
              <Text style={styles.verifyBold}>{t('certificates.contentHashVerify')}</Text>{' '}
              <Text style={styles.verifyCode}>sha256sum {'<file>'}</Text>
            </Text>
            <TouchableOpacity
              activeOpacity={0.6}
              onPress={() => {
                Clipboard.setString('sha256sum <file>');
                showDarkAlert(t('alerts.copied') || 'Copied', t('alerts.commandCopied') || 'Command copied to clipboard');
              }}
              style={styles.verifyCodeCopyable}
            >
              <Text style={styles.verifyCodeBlock} selectable>sha256sum {'<file>'}</Text>
              <Feather name="copy" size={12} color="#f59e0b" />
            </TouchableOpacity>
            <Text style={styles.verifyText}>
              <Text style={styles.verifyBold}>{t('certificates.exifHashVerify')}</Text>
            </Text>
            <TouchableOpacity
              activeOpacity={0.6}
              onPress={() => {
                const cmd = `python3 -c "import struct,hashlib; d=open('FILE','rb').read(); i=d.find(b'\\xff\\xe1'); l=struct.unpack('>H',d[i+2:i+4])[0]; print(hashlib.sha256(d[i+4:i+2+l]).hexdigest())"`;
                Clipboard.setString(cmd);
                showDarkAlert(t('alerts.copied') || 'Copied', t('alerts.commandCopied') || 'Command copied to clipboard');
              }}
              style={styles.verifyCodeCopyable}
            >
              <Text style={styles.verifyCodeBlock} selectable>
                {`python3 -c "import struct,hashlib; d=open('FILE','rb').read(); i=d.find(b'\\xff\\xe1'); l=struct.unpack('>H',d[i+2:i+4])[0]; print(hashlib.sha256(d[i+4:i+2+l]).hexdigest())"`}
              </Text>
              <Feather name="copy" size={12} color="#f59e0b" />
            </TouchableOpacity>
            <Text style={styles.verifyNote}>
              {t('certificates.verifyNote')}
            </Text>
          </View>

          <View style={styles.detailDivider} />
          <Text style={styles.detailSectionTitle}>{t('certificates.details')}</Text>
          <DetailRow label={t('certificates.watermarked')} value={c.watermarked ? t('common.yes') : t('common.no')} />
          <DetailRow label={t('certificates.encrypted')} value={c.encrypted ? t('common.yes') : t('common.no')} />
          <DetailRow label={t('certificates.storage')} value={c.storageType === 'cloud' ? 'StealthCloud' : c.storageType === 'arweave' ? 'Arweave (Permanent)' : c.storageType === 'onchain' ? 'Embedded (On-Chain)' : 'IPFS'} />
          {(c.rfc3161Token || c.hasRfc3161) && (
            <>
              <View style={styles.detailDivider} />
              <Text style={styles.detailSectionTitle}>{t('certificates.rfc3161Title')}</Text>
              <DetailRow label={t('certificates.rfc3161Authority')} value={t('certificates.rfc3161AuthorityValue')} />
              <DetailRow label={t('certificates.rfc3161Standard')} value={t('certificates.rfc3161StandardValue')} />
              <DetailRow label={t('certificates.rfc3161HashAlgo')} value={t('certificates.rfc3161HashAlgoValue')} />
              <VerifyBlock
                token={c.rfc3161Token || ''}
                contentHash={c.contentHash}
                onCopy={(cmd) => { Clipboard.setString(cmd); showDarkAlert(t('certificates.rfc3161CopiedTitle'), t('certificates.rfc3161CopiedMsg')); }}
              />
              {!c.rfc3161Token && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, paddingHorizontal: 4 }}>
                  <ActivityIndicator size="small" color="#10b981" />
                  <Text style={{ fontSize: 10, color: '#6b7280' }}>Recovering full token from on-chain metadata...</Text>
                </View>
              )}
            </>
          )}
          {(c.c2paManifest || c.hasC2pa) && (
            <>
              <View style={styles.detailDivider} />
              <Text style={styles.detailSectionTitle}>{t('certificates.c2paTitle')}</Text>
              <DetailRow label={t('certificates.c2paStandard')} value={t('certificates.c2paStandardValue')} />
              <DetailRow label={t('certificates.c2paClaimGenerator')} value={c.c2paManifest?.claim_generator || 'PhotoLynk/1.0'} />
              <DetailRow label={t('certificates.c2paCreated')} value={c.c2paManifest?.claim?.created || c.issuedAt || 'N/A'} />
            </>
          )}

          {/* Navigate to NFT in gallery */}
          {onShowNFT && c.mintAddress && (
            <>
              <View style={styles.detailDivider} />
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(153,69,255,0.15)', borderRadius: 10, paddingVertical: 12, marginTop: 8, gap: 8 }}
                activeOpacity={0.7}
                onPress={() => onShowNFT(c.mintAddress)}
              >
                <Feather name="image" size={16} color="#9945FF" />
                <Text style={{ color: '#9945FF', fontWeight: '600', fontSize: 14 }}>View NFT in Album</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        </ScrollView>
      </View>
    );
  };

  // Handle Android back button
  useEffect(() => {
    if (!visible) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedCert) { setSelectedCert(null); return true; }
      onClose(); return true;
    });
    return () => handler.remove();
  }, [visible, selectedCert, onClose]);

  if (!visible) return null;

  return (
    <View style={styles.fullOverlay}>
      <StatusBar backgroundColor="#0a0a0a" barStyle="light-content" />
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Feather name="x" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{t('certificates.title')}</Text>
            <Text style={styles.headerSubtitle}>{certificates.length === 1 ? t('certificates.countLabelOne') : t('certificates.countLabel', { count: certificates.length })}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {selectedCert ? (
          renderDetail()
        ) : loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="large" color={COLORS.accent} />
          </View>
        ) : certificates.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="award" size={48} color={COLORS.textSecondary} />
            <Text style={styles.emptyTitle}>{t('certificates.noCertsYet')}</Text>
            <Text style={styles.emptySubtitle}>
              {t('certificates.noCertsHint')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={certificates}
            keyExtractor={(item) => item.id}
            renderItem={renderCertCard}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}
        {/* Dark Alert */}
        {darkAlert && (
          <View style={styles.darkAlertOverlay}>
            <View style={styles.darkAlertCard}>
              <Text style={styles.darkAlertTitle}>{darkAlert.title}</Text>
              <Text style={styles.darkAlertMessage}>{darkAlert.message}</Text>
              <View style={styles.darkAlertButtons}>
                {darkAlert.buttons.map((btn, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.darkAlertButton, idx === darkAlert.buttons.length - 1 && styles.darkAlertButtonPrimary]}
                    onPress={btn.onPress}
                  >
                    <Text style={[styles.darkAlertButtonText, idx === darkAlert.buttons.length - 1 && styles.darkAlertButtonTextPrimary]}>
                      {btn.text}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

const VerifyBlock = ({ token, contentHash, onCopy }) => {
  const [macExpanded, setMacExpanded] = React.useState(false);
  const [winExpanded, setWinExpanded] = React.useState(false);
  const hash = contentHash ? contentHash.replace(/^SHA256:/, '') : null;
  const step1mac = `printf '%s' "${token}" | base64 -d > token.tsr`;
  const step1win = `[System.Convert]::FromBase64String("${token}") | Set-Content token.tsr -Encoding Byte`;
  const step2 = `curl -o cacert.pem https://freetsa.org/files/cacert.pem`;
  const step2win = `Invoke-WebRequest https://freetsa.org/files/cacert.pem -OutFile cacert.pem`;
  const step3 = hash
    ? `openssl ts -verify -in token.tsr -digest ${hash} -CAfile cacert.pem`
    : `openssl ts -verify -in token.tsr -digest <sha256_hash> -CAfile cacert.pem`;

  const CmdRow = ({ label, cmd, collapsible, expanded, onToggleExpand }) => (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{ fontSize: 9, color: '#10b981', fontWeight: '700' }}>{label}</Text>
        {collapsible && (
          <TouchableOpacity
            onPress={onToggleExpand}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: 'rgba(16,185,129,0.12)' }}
          >
            <Feather name={expanded ? 'eye-off' : 'eye'} size={10} color="#10b981" />
            <Text style={{ fontSize: 9, color: '#10b981' }}>{expanded ? t('certificates.collapse') || 'Hide' : t('certificates.expand') || 'Show'}</Text>
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity
        onPress={() => onCopy(cmd)}
        activeOpacity={0.7}
      >
        <View style={{ backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 6, padding: 7, flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          {collapsible && !expanded ? (
            <Text style={{ fontSize: 9, color: '#6b7280', fontFamily: 'monospace', flex: 1, fontStyle: 'italic' }}>
              {t('certificates.tokenHidden') || '(token hidden — tap Show to preview, tap row to copy)'}
            </Text>
          ) : (
            <Text style={{ fontSize: 9, color: '#a1a1aa', fontFamily: 'monospace', flex: 1 }} selectable>{cmd}</Text>
          )}
          <Feather name="copy" size={11} color="#10b981" style={{ marginTop: 1 }} />
        </View>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={{ marginTop: 6, padding: 10, backgroundColor: 'rgba(16,185,129,0.08)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(16,185,129,0.3)' }}>
      <Text style={{ fontSize: 10, color: '#10b981', fontWeight: '700', marginBottom: 8 }}>{t('certificates.rfc3161VerifyLabel')}</Text>
      <Text style={{ fontSize: 9, color: '#6b7280', marginBottom: 6 }}>{t('certificates.macLinuxTerminal')}</Text>
      <CmdRow label={t('certificates.rfc3161Step1')} cmd={step1mac} collapsible expanded={macExpanded} onToggleExpand={() => setMacExpanded(v => !v)} />
      <CmdRow label={t('certificates.rfc3161Step2')} cmd={step2} />
      <CmdRow label={t('certificates.rfc3161Step3')} cmd={step3} />
      <Text style={{ fontSize: 9, color: '#6b7280', marginTop: 6, marginBottom: 6 }}>{t('certificates.windowsPowershell')}</Text>
      <CmdRow label={t('certificates.rfc3161Step1')} cmd={step1win} collapsible expanded={winExpanded} onToggleExpand={() => setWinExpanded(v => !v)} />
      <CmdRow label={t('certificates.rfc3161Step2')} cmd={step2win} />
      <CmdRow label={t('certificates.rfc3161Step3')} cmd={step3} />
      <Text style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>{t('certificates.rfc3161Expected')}</Text>
    </View>
  );
};

const DetailRow = ({ label, value, mono }) => (
  <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={[styles.detailValue, mono && styles.detailValueMono]} numberOfLines={1} ellipsizeMode="middle">
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  fullOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  listContent: {
    padding: 16,
    paddingBottom: Platform.OS === 'android' ? ANDROID_NAV_BAR_HEIGHT + 16 : 16,
    gap: 12,
  },
  detailScrollContent: {
    paddingBottom: Platform.OS === 'android' ? ANDROID_NAV_BAR_HEIGHT + 16 : 16,
  },
  certCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  certCardSelected: {
    borderColor: '#f59e0b',
  },
  certCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  certBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  certCardInfo: {
    flex: 1,
  },
  certCardName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  certCardDate: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  certCardActions: {
    flexDirection: 'row',
    gap: 8,
  },
  certIconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  certCardMeta: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  certTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  certTagText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#f59e0b',
  },
  certMintAddr: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontFamily: 'monospace',
    marginTop: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  detailContainer: {
    flex: 1,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  detailBack: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  detailShareBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  detailCard: {
    margin: 16,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  detailBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  detailBadgeText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f59e0b',
  },
  detailDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 14,
  },
  detailSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  detailLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    flex: 0.4,
  },
  detailValue: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '500',
    flex: 0.6,
    textAlign: 'right',
  },
  detailValueMono: {
    fontFamily: 'monospace',
    fontSize: 11,
  },
  darkAlertOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  darkAlertCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: '#333',
  },
  darkAlertTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 12,
  },
  darkAlertMessage: {
    fontSize: 14,
    color: '#a1a1aa',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  darkAlertButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  darkAlertButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    backgroundColor: '#2a2a2a',
    minWidth: 100,
  },
  darkAlertButtonPrimary: {
    backgroundColor: COLORS.primary,
  },
  darkAlertButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a1a1aa',
    textAlign: 'center',
  },
  darkAlertButtonTextPrimary: {
    color: '#fff',
  },
  verifyBox: {
    marginTop: 10,
    padding: 10,
    backgroundColor: 'rgba(245,158,11,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.15)',
    borderRadius: 8,
  },
  verifyTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#f59e0b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  verifyText: {
    fontSize: 10,
    color: '#aaa',
    lineHeight: 16,
    marginBottom: 4,
  },
  verifyBold: {
    fontWeight: '600',
    color: '#ccc',
  },
  verifyCode: {
    fontFamily: 'monospace',
    color: '#f59e0b',
    fontSize: 10,
  },
  verifyCodeCopyable: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.3)',
    padding: 8,
    borderRadius: 4,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
  },
  verifyCodeBlock: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: '#888',
    flex: 1,
    lineHeight: 14,
  },
  verifyNote: {
    fontSize: 9,
    color: '#666',
    marginTop: 4,
    lineHeight: 13,
  },
});

export default CertificatesViewer;
