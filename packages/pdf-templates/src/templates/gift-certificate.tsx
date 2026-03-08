import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 11,
  },
  logo: {
    width: 60,
    height: 60,
    marginBottom: 12,
    alignSelf: 'center',
  },
  header: {
    textAlign: 'center',
    marginBottom: 30,
    paddingBottom: 16,
    borderBottom: '2 solid #1e40af',
  },
  coopName: {
    fontSize: 24,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 6,
  },
  title: {
    fontSize: 16,
    color: '#666666',
  },
  detailsBox: {
    backgroundColor: '#f5f5f5',
    padding: 20,
    marginBottom: 24,
    borderRadius: 4,
  },
  detailRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  detailLabel: {
    width: '40%',
    color: '#555555',
  },
  detailValue: {
    width: '60%',
    fontFamily: 'Helvetica-Bold',
  },
  codeBox: {
    border: '2 dashed #999999',
    padding: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  codeLabel: {
    fontSize: 10,
    color: '#666666',
    marginBottom: 6,
  },
  codeText: {
    fontSize: 28,
    fontFamily: 'Courier-Bold',
    letterSpacing: 3,
  },
  qrSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  qrImage: {
    width: 150,
    height: 150,
    marginBottom: 8,
  },
  instruction: {
    fontSize: 10,
    color: '#666666',
    textAlign: 'center',
    marginBottom: 4,
  },
  claimUrl: {
    fontSize: 9,
    color: '#999999',
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 9,
    color: '#999999',
    borderTop: '1 solid #eeeeee',
    paddingTop: 10,
  },
});

const translations = {
  nl: {
    title: 'Cadeaubon',
    shareClass: 'Aandelencategorie',
    quantity: 'Aantal aandelen',
    shares: 'aandelen',
    value: 'Waarde',
    code: 'Inwisselcode',
    instruction: 'Scan de QR-code of ga naar onderstaande link om uw aandelen te claimen.',
  },
  en: {
    title: 'Gift Certificate',
    shareClass: 'Share Class',
    quantity: 'Quantity',
    shares: 'shares',
    value: 'Value',
    code: 'Redemption Code',
    instruction: 'Scan the QR code or visit the link below to claim your shares.',
  },
  fr: {
    title: 'Chèque-cadeau',
    shareClass: 'Catégorie d\'actions',
    quantity: 'Quantité',
    shares: 'actions',
    value: 'Valeur',
    code: 'Code de réclamation',
    instruction: 'Scannez le code QR ou visitez le lien ci-dessous pour réclamer vos actions.',
  },
  de: {
    title: 'Geschenkgutschein',
    shareClass: 'Aktienkategorie',
    quantity: 'Anzahl',
    shares: 'Aktien',
    value: 'Wert',
    code: 'Einlösecode',
    instruction:
      'Scannen Sie den QR-Code oder besuchen Sie den untenstehenden Link, um Ihre Aktien einzulösen.',
  },
};

export interface GiftCertificateProps {
  coopName: string;
  primaryColor: string;
  logoUrl?: string;
  shareClassName: string;
  quantity: number;
  totalValue: number;
  giftCode: string;
  claimUrl: string;
  qrCodeDataUrl: string;
  locale: string;
}

export const GiftCertificate: React.FC<GiftCertificateProps> = ({
  coopName,
  primaryColor,
  logoUrl,
  shareClassName,
  quantity,
  totalValue,
  giftCode,
  claimUrl,
  qrCodeDataUrl,
  locale,
}) => {
  const t = translations[locale as keyof typeof translations] || translations.en;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={[styles.header, { borderBottomColor: primaryColor }]}>
          {logoUrl && <Image src={logoUrl} style={styles.logo} />}
          <Text style={[styles.coopName, { color: primaryColor }]}>{coopName}</Text>
          <Text style={styles.title}>{t.title}</Text>
        </View>

        <View style={styles.detailsBox}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t.shareClass}</Text>
            <Text style={styles.detailValue}>{shareClassName}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t.quantity}</Text>
            <Text style={styles.detailValue}>
              {quantity} {t.shares}
            </Text>
          </View>
          <View style={[styles.detailRow, { marginBottom: 0 }]}>
            <Text style={styles.detailLabel}>{t.value}</Text>
            <Text style={styles.detailValue}>{`\u20AC ${totalValue.toFixed(2)}`}</Text>
          </View>
        </View>

        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>{t.code}</Text>
          <Text style={styles.codeText}>{giftCode}</Text>
        </View>

        <View style={styles.qrSection}>
          <Image src={qrCodeDataUrl} style={styles.qrImage} />
          <Text style={styles.instruction}>{t.instruction}</Text>
          <Text style={styles.claimUrl}>{claimUrl}</Text>
        </View>

        <View style={styles.footer}>
          <Text>{coopName}</Text>
        </View>
      </Page>
    </Document>
  );
};
