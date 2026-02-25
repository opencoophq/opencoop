import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 11,
  },
  header: {
    textAlign: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 24,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666666',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 8,
    borderBottom: '1 solid #1e40af',
    paddingBottom: 4,
    color: '#1e40af',
  },
  row: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  label: {
    width: '40%',
    color: '#555555',
  },
  value: {
    width: '60%',
    fontFamily: 'Helvetica-Bold',
  },
  certificateNumber: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 20,
    marginBottom: 20,
    padding: 10,
    backgroundColor: '#f0f4ff',
    color: '#1e40af',
    fontFamily: 'Helvetica-Bold',
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
  signature: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 40,
  },
  signatureBlock: {
    width: '40%',
    textAlign: 'center',
  },
  signatureLine: {
    borderTop: '1 solid #333333',
    marginTop: 40,
    paddingTop: 4,
    fontSize: 10,
  },
});

export interface ShareCertificateProps {
  certificateNumber: string;
  coopName: string;
  shareholderName: string;
  shareholderType: string;
  nationalId?: string;
  companyId?: string;
  shareClassName: string;
  shareClassCode: string;
  quantity: number;
  pricePerShare: number;
  totalValue: number;
  purchaseDate: string;
  issueDate: string;
  locale?: string;
}

export const ShareCertificate: React.FC<ShareCertificateProps> = ({
  certificateNumber,
  coopName,
  shareholderName,
  shareholderType,
  nationalId,
  companyId,
  shareClassName,
  shareClassCode,
  quantity,
  pricePerShare,
  totalValue,
  purchaseDate,
  issueDate,
  locale = 'nl',
}) => {
  const t = locale === 'nl' ? {
    title: 'Aandelencertificaat',
    subtitle: 'Certificaat van deelneming',
    certNumber: 'Certificaatnummer',
    shareholderInfo: 'Aandeelhouder',
    name: 'Naam',
    type: 'Type',
    nationalId: 'Rijksregisternummer',
    companyId: 'Ondernemingsnummer',
    shareInfo: 'Aandelengegevens',
    shareClass: 'Aandelencategorie',
    quantity: 'Aantal aandelen',
    pricePerShare: 'Prijs per aandeel',
    totalValue: 'Totale waarde',
    purchaseDate: 'Aankoopdatum',
    issueDate: 'Uitgiftedatum',
    signature: 'Bestuurder',
    types: { INDIVIDUAL: 'Particulier', COMPANY: 'Rechtspersoon', MINOR: 'Minderjarige' },
  } : {
    title: 'Share Certificate',
    subtitle: 'Certificate of Participation',
    certNumber: 'Certificate Number',
    shareholderInfo: 'Shareholder',
    name: 'Name',
    type: 'Type',
    nationalId: 'National ID',
    companyId: 'Company Number',
    shareInfo: 'Share Details',
    shareClass: 'Share Class',
    quantity: 'Number of Shares',
    pricePerShare: 'Price per Share',
    totalValue: 'Total Value',
    purchaseDate: 'Purchase Date',
    issueDate: 'Issue Date',
    signature: 'Director',
    types: { INDIVIDUAL: 'Individual', COMPANY: 'Company', MINOR: 'Minor' },
  };

  const fmtLocale = locale === 'nl' ? 'nl-BE' : 'en-US';
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(fmtLocale, { style: 'currency', currency: 'EUR' }).format(amount);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{coopName}</Text>
          <Text style={styles.subtitle}>{t.title}</Text>
        </View>

        <View style={styles.certificateNumber}>
          <Text>{t.certNumber}: {certificateNumber}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.shareholderInfo}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>{t.name}</Text>
            <Text style={styles.value}>{shareholderName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t.type}</Text>
            <Text style={styles.value}>{t.types[shareholderType as keyof typeof t.types] || shareholderType}</Text>
          </View>
          {nationalId && (
            <View style={styles.row}>
              <Text style={styles.label}>{t.nationalId}</Text>
              <Text style={styles.value}>{nationalId}</Text>
            </View>
          )}
          {companyId && (
            <View style={styles.row}>
              <Text style={styles.label}>{t.companyId}</Text>
              <Text style={styles.value}>{companyId}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.shareInfo}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>{t.shareClass}</Text>
            <Text style={styles.value}>{shareClassName} ({shareClassCode})</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t.quantity}</Text>
            <Text style={styles.value}>{quantity}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t.pricePerShare}</Text>
            <Text style={styles.value}>{formatCurrency(pricePerShare)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t.totalValue}</Text>
            <Text style={styles.value}>{formatCurrency(totalValue)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t.purchaseDate}</Text>
            <Text style={styles.value}>{purchaseDate}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t.issueDate}</Text>
            <Text style={styles.value}>{issueDate}</Text>
          </View>
        </View>

        <View style={styles.signature}>
          <View style={styles.signatureBlock}>
            <Text style={styles.signatureLine}>{t.signature}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text>{coopName} - {t.title}</Text>
        </View>
      </Page>
    </Document>
  );
};
