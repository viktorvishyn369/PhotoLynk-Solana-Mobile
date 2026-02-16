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
  Modal,
  FlatList,
  Share,
  Alert,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import NFTOperations from './nftOperations';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

const CertificatesViewer = ({ visible, onClose }) => {
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCert, setSelectedCert] = useState(null);

  const loadCertificates = useCallback(async () => {
    setLoading(true);
    try {
      const certs = await NFTOperations.getStoredCertificates();
      setCertificates(certs.sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt)));
    } catch (e) {
      console.warn('[Certs] Failed to load:', e?.message);
      setCertificates([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (visible) loadCertificates();
  }, [visible, loadCertificates]);

  const handleShare = async (cert) => {
    try {
      const text = NFTOperations.formatCertificateForExport(cert);
      await Share.share({ message: text, title: `Certificate — ${cert.name}` });
    } catch (e) {
      if (e.message !== 'User did not share') {
        Alert.alert('Error', e.message);
      }
    }
  };

  const handleDelete = (cert) => {
    Alert.alert(
      'Delete Certificate',
      `Remove certificate for "${cert.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
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
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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
          <Text style={styles.certCardName} numberOfLines={1}>{item.name || 'Untitled'}</Text>
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
          <Text style={styles.certTagText}>Limited Edition</Text>
        </View>
        {item.encrypted && (
          <View style={[styles.certTag, { borderColor: '#9945FF40' }]}>
            <Feather name="lock" size={10} color="#9945FF" />
            <Text style={[styles.certTagText, { color: '#9945FF' }]}>Encrypted</Text>
          </View>
        )}
        {item.watermarked && (
          <View style={[styles.certTag, { borderColor: 'rgba(34, 197, 94, 0.3)' }]}>
            <Text style={[styles.certTagText, { color: '#22c55e' }]}>Watermarked</Text>
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
          <Text style={styles.detailTitle} numberOfLines={1}>{c.name || 'Certificate'}</Text>
          <TouchableOpacity onPress={() => handleShare(c)} style={styles.detailShareBtn}>
            <Feather name="share-2" size={18} color="#f59e0b" />
          </TouchableOpacity>
        </View>

        <View style={styles.detailCard}>
          <View style={styles.detailBadgeRow}>
            <Feather name="award" size={32} color="#f59e0b" />
            <Text style={styles.detailBadgeText}>Certificate of Authenticity</Text>
          </View>

          <View style={styles.detailDivider} />

          <DetailRow label="Edition" value="Limited Edition" />
          <DetailRow label="License" value={c.license || 'All Rights Reserved'} />
          <DetailRow label="Issued" value={formatDate(c.issuedAt)} />

          <View style={styles.detailDivider} />
          <Text style={styles.detailSectionTitle}>Blockchain Proof</Text>
          <DetailRow label="Mint Address" value={c.mintAddress || 'N/A'} mono />
          <DetailRow label="Transaction" value={c.txSignature || 'N/A'} mono />
          <DetailRow label="Creator Wallet" value={c.creatorWallet || 'N/A'} mono />

          <View style={styles.detailDivider} />
          <Text style={styles.detailSectionTitle}>Integrity Proof</Text>
          <DetailRow label="Content Hash" value={c.contentHash || 'N/A'} mono />
          <DetailRow label="EXIF Hash" value={c.exifHash || 'N/A'} mono />

          <View style={styles.detailDivider} />
          <Text style={styles.detailSectionTitle}>Details</Text>
          <DetailRow label="Watermarked" value={c.watermarked ? 'Yes' : 'No'} />
          <DetailRow label="Encrypted" value={c.encrypted ? 'Yes' : 'No'} />
          <DetailRow label="Storage" value={c.storageType === 'cloud' ? 'StealthCloud' : 'IPFS'} />
        </View>
      </View>
    );
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Feather name="x" size={24} color={COLORS.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Certificates</Text>
            <Text style={styles.headerSubtitle}>{certificates.length} {certificates.length === 1 ? 'certificate' : 'certificates'}</Text>
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
            <Text style={styles.emptyTitle}>No Certificates Yet</Text>
            <Text style={styles.emptySubtitle}>
              Mint a Limited Edition NFT to receive a Certificate of Authenticity
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
      </View>
    </Modal>
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
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
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
    gap: 12,
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
});

export default CertificatesViewer;
