import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

const BLUE = '#1e40af';
const GREY_BG = '#f3f4f6';
const BORDER_COLOR = '#d1d5db';

const styles = StyleSheet.create({
  page: {
    padding: 50,
    paddingBottom: 120,
    fontFamily: 'Helvetica',
    fontSize: 10,
  },
  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  headerTextBlock: {
    flex: 1,
  },
  logo: {
    width: 80,
    height: 80,
    objectFit: 'contain',
  },
  coopName: {
    fontSize: 26,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginBottom: 4,
    color: '#111827',
  },
  legalForm: {
    fontSize: 11,
    textAlign: 'center',
    color: '#4b5563',
    marginBottom: 2,
  },
  foundedDate: {
    fontSize: 10,
    textAlign: 'center',
    color: '#6b7280',
    marginBottom: 24,
  },
  // Divider
  divider: {
    borderBottom: `2 solid ${BLUE}`,
    marginBottom: 24,
  },
  // Section title
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // Table
  table: {
    marginBottom: 30,
    borderTop: `1 solid ${BORDER_COLOR}`,
    borderLeft: `1 solid ${BORDER_COLOR}`,
    borderRight: `1 solid ${BORDER_COLOR}`,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: `1 solid ${BORDER_COLOR}`,
    minHeight: 32,
  },
  labelCell: {
    width: '45%',
    backgroundColor: GREY_BG,
    padding: 8,
    justifyContent: 'center',
    borderRight: `1 solid ${BORDER_COLOR}`,
  },
  labelText: {
    fontSize: 10,
    color: '#374151',
    fontFamily: 'Helvetica-Bold',
  },
  valueCell: {
    width: '55%',
    padding: 8,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  valueText: {
    fontSize: 11,
    color: '#111827',
  },
  // Signature
  signatureSection: {
    marginTop: 40,
    marginBottom: 20,
  },
  signatureLabel: {
    fontSize: 10,
    color: '#374151',
    marginBottom: 30,
  },
  signatureLine: {
    borderTop: '1 solid #374151',
    width: 200,
    paddingTop: 4,
  },
  signatoryName: {
    fontSize: 10,
    color: '#111827',
    fontFamily: 'Helvetica-Bold',
  },
  // Footer notes
  footerNotes: {
    marginTop: 20,
  },
  footerNote: {
    fontSize: 8,
    color: '#6b7280',
    marginBottom: 4,
    lineHeight: 1.4,
  },
  // Company info footer
  companyFooter: {
    position: 'absolute',
    bottom: 30,
    left: 50,
    right: 50,
    borderTop: `1 solid ${BORDER_COLOR}`,
    paddingTop: 8,
    textAlign: 'center',
  },
  companyFooterText: {
    fontSize: 7.5,
    color: '#9ca3af',
    lineHeight: 1.5,
  },
});

export interface ShareCertificateProps {
  coopName: string;
  legalForm?: string;
  foundedDate?: string;
  certificateSignatory?: string;
  shareholderName: string;
  shareholderCity?: string;
  memberNumber?: number;
  quantity: number;
  totalValue: number;
  purchaseDate: string;
  // Coop footer info
  coopAddress?: string;
  coopPhone?: string;
  coopEmail?: string;
  coopWebsite?: string;
  vatNumber?: string;
  bankIban?: string;
  bankBic?: string;
  logoBase64?: string;
  locale?: string;
  // Legacy props kept for backward compatibility with existing callers
  certificateNumber?: string;
  shareholderType?: string;
  nationalId?: string;
  companyId?: string;
  shareClassName?: string;
  shareClassCode?: string;
  pricePerShare?: number;
  issueDate?: string;
}

const translations = {
  nl: {
    title: 'Aandelencertificaat',
    name: 'Naam',
    memberNumber: 'Vennotennummer',
    numberOfShares: 'Aantal aandelen',
    amount: 'Bedrag',
    registrationDate: 'Datum inschrijving in register van vennoten',
    signatureLabel: 'Voor de raad van bestuur:',
    registerNote: (coopName: string) =>
      `Aandeelhouders worden na hun storting ingeschreven in het register van ${coopName}.`,
    dividendNote:
      'Uw dividend zal na de beslissing van de Algemene Vergadering gestort worden op uw rekening.',
  },
  en: {
    title: 'Share Certificate',
    name: 'Name',
    memberNumber: 'Member number',
    numberOfShares: 'Number of shares',
    amount: 'Amount',
    registrationDate: 'Date of registration in shareholder register',
    signatureLabel: 'For the board of directors:',
    registerNote: (coopName: string) =>
      `Shareholders are registered in the register of ${coopName} after payment.`,
    dividendNote:
      'Your dividend will be deposited into your account after the decision of the General Meeting.',
  },
  fr: {
    title: 'Certificat d\'actions',
    name: 'Nom',
    memberNumber: 'Numéro de membre',
    numberOfShares: 'Nombre d\'actions',
    amount: 'Montant',
    registrationDate: 'Date d\'inscription au registre des actionnaires',
    signatureLabel: 'Pour le conseil d\'administration :',
    registerNote: (coopName: string) =>
      `Les actionnaires sont inscrits au registre de ${coopName} après leur versement.`,
    dividendNote:
      'Votre dividende sera versé sur votre compte après la décision de l\'Assemblée Générale.',
  },
  de: {
    title: 'Anteilsschein',
    name: 'Name',
    memberNumber: 'Mitgliedsnummer',
    numberOfShares: 'Anzahl Anteile',
    amount: 'Betrag',
    registrationDate: 'Datum der Eintragung im Gesellschafterregister',
    signatureLabel: 'Für den Vorstand:',
    registerNote: (coopName: string) =>
      `Anteilseigner werden nach ihrer Einzahlung im Register von ${coopName} eingetragen.`,
    dividendNote:
      'Ihre Dividende wird nach Beschluss der Generalversammlung auf Ihr Konto überwiesen.',
  },
};

export const ShareCertificate: React.FC<ShareCertificateProps> = ({
  coopName,
  legalForm,
  foundedDate,
  certificateSignatory,
  shareholderName,
  shareholderCity,
  memberNumber,
  quantity,
  totalValue,
  purchaseDate,
  coopAddress,
  coopPhone,
  coopEmail,
  coopWebsite,
  vatNumber,
  bankIban,
  bankBic,
  logoBase64,
  locale = 'nl',
}) => {
  const t = translations[locale as keyof typeof translations] || translations.nl;
  const fmtLocale = locale === 'nl' ? 'nl-BE' : locale === 'fr' ? 'fr-BE' : locale === 'de' ? 'de-DE' : 'en-US';

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(fmtLocale, { style: 'currency', currency: 'EUR' }).format(amount);

  const displayName = shareholderCity
    ? `${shareholderName}, ${shareholderCity}`
    : shareholderName;

  // Build company footer parts
  const footerParts: string[] = [];
  if (coopAddress) footerParts.push(coopAddress);
  if (coopPhone) footerParts.push(`Tel: ${coopPhone}`);
  if (coopEmail) footerParts.push(coopEmail);
  if (coopWebsite) footerParts.push(coopWebsite);

  const financialParts: string[] = [];
  if (vatNumber) financialParts.push(`BTW: ${vatNumber}`);
  if (bankIban) financialParts.push(`IBAN: ${bankIban}`);
  if (bankBic) financialParts.push(`BIC: ${bankBic}`);

  const tableRows: { label: string; value: string }[] = [
    { label: t.name, value: displayName },
  ];

  if (memberNumber !== undefined && memberNumber !== null) {
    tableRows.push({ label: t.memberNumber, value: String(memberNumber) });
  }

  tableRows.push(
    { label: t.numberOfShares, value: String(quantity) },
    { label: t.amount, value: formatCurrency(totalValue) },
    { label: t.registrationDate, value: purchaseDate },
  );

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header with optional logo */}
        {logoBase64 ? (
          <View style={styles.headerRow}>
            <View style={styles.headerTextBlock}>
              <Text style={styles.coopName}>{coopName}</Text>
            </View>
            <Image style={styles.logo} src={logoBase64} />
          </View>
        ) : (
          <Text style={styles.coopName}>{coopName}</Text>
        )}

        {/* Legal form subtitle */}
        {legalForm && <Text style={styles.legalForm}>{legalForm}</Text>}

        {/* Founded date */}
        {foundedDate && <Text style={styles.foundedDate}>{foundedDate}</Text>}

        {/* Blue divider */}
        <View style={styles.divider} />

        {/* Section title */}
        <Text style={styles.sectionTitle}>{t.title}</Text>

        {/* Data table */}
        <View style={styles.table}>
          {tableRows.map((row, idx) => (
            <View key={idx} style={styles.tableRow}>
              <View style={styles.labelCell}>
                <Text style={styles.labelText}>{row.label}</Text>
              </View>
              <View style={styles.valueCell}>
                <Text style={styles.valueText}>{row.value}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Signature block */}
        <View style={styles.signatureSection}>
          <Text style={styles.signatureLabel}>{t.signatureLabel}</Text>
          <View style={styles.signatureLine}>
            {certificateSignatory && (
              <Text style={styles.signatoryName}>{certificateSignatory}</Text>
            )}
          </View>
        </View>

        {/* Footer notes */}
        <View style={styles.footerNotes}>
          <Text style={styles.footerNote}>{t.registerNote(coopName)}</Text>
          <Text style={styles.footerNote}>{t.dividendNote}</Text>
        </View>

        {/* Company info footer */}
        {(footerParts.length > 0 || financialParts.length > 0) && (
          <View style={styles.companyFooter}>
            {footerParts.length > 0 && (
              <Text style={styles.companyFooterText}>{footerParts.join(' | ')}</Text>
            )}
            {financialParts.length > 0 && (
              <Text style={styles.companyFooterText}>{financialParts.join(' | ')}</Text>
            )}
          </View>
        )}
      </Page>
    </Document>
  );
};
