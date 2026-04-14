import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const BLUE = '#1e40af';
const BORDER_COLOR = '#d1d5db';

const styles = StyleSheet.create({
  page: {
    padding: 50,
    paddingBottom: 60,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#111827',
  },
  header: {
    marginBottom: 14,
  },
  coopName: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
  },
  coopMeta: {
    fontSize: 9,
    color: '#4b5563',
    lineHeight: 1.4,
  },
  divider: {
    borderBottom: `1.5 solid ${BLUE}`,
    marginTop: 8,
    marginBottom: 18,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
    textAlign: 'center',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginTop: 14,
    marginBottom: 8,
    color: BLUE,
  },
  fieldRow: {
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 9,
    color: '#6b7280',
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 11,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottom: `1 solid ${BORDER_COLOR}`,
    minHeight: 18,
  },
  blankLine: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottom: `1 solid #374151`,
    minHeight: 18,
  },
  legalBlock: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#f3f4f6',
    border: `1 solid ${BORDER_COLOR}`,
    fontSize: 9,
    lineHeight: 1.55,
    color: '#374151',
  },
  placeDateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 28,
    marginBottom: 4,
  },
  placeDateCol: {
    width: '48%',
  },
  placeDateLabel: {
    fontSize: 9,
    color: '#6b7280',
    marginBottom: 2,
  },
  placeDateLine: {
    borderBottom: '1 solid #374151',
    minHeight: 20,
  },
  signatureSection: {
    marginTop: 28,
  },
  signatureLabel: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 40,
  },
  signatureLine: {
    borderTop: '1 solid #374151',
    width: 240,
    paddingTop: 4,
    fontSize: 9,
    color: '#4b5563',
  },
});

export interface VolmachtFormProps {
  coop: { name: string; address: string; companyId: string };
  grantor: {
    firstName: string;
    lastName: string;
    address?: string;
    shareholderNumber: string;
  };
  delegate?: { firstName: string; lastName: string };
  meeting: { title: string; scheduledAt: Date };
  language: 'nl' | 'en' | 'fr' | 'de';
}

const LABELS = {
  nl: {
    title: 'Volmacht',
    grantorSection: 'De ondergetekende (volmachtgever)',
    name: 'Naam',
    address: 'Adres',
    shareholderNumber: 'Vennotennummer',
    delegateSection: 'geeft volmacht aan (gevolmachtigde)',
    delegateBlank: 'Naam van de gevolmachtigde',
    meetingSection: 'Om hem/haar te vertegenwoordigen op',
    meetingDate: 'Datum',
    legalTitle: 'Juridische bepaling',
    legal:
      'Overeenkomstig artikel 23 van de statuten kan elke vennoot zich op de Algemene Vergadering laten vertegenwoordigen door een andere vennoot, houder van een geldige volmacht. De gevolmachtigde stemt conform de instructies van de volmachtgever of, bij gebrek aan instructies, naar eigen beoordeling. Deze volmacht is enkel geldig voor bovenvermelde vergadering.',
    place: 'Plaats',
    date: 'Datum',
    signatureLabel: 'Handtekening van de volmachtgever',
    companyIdLabel: 'Ondernemingsnummer',
  },
  en: {
    title: 'Power of Attorney (Volmacht)',
    grantorSection: 'The undersigned (grantor)',
    name: 'Name',
    address: 'Address',
    shareholderNumber: 'Shareholder number',
    delegateSection: 'grants power of attorney to (delegate)',
    delegateBlank: 'Name of the delegate',
    meetingSection: 'To represent him/her at',
    meetingDate: 'Date',
    legalTitle: 'Legal provision',
    legal:
      'In accordance with article 23 of the articles of association, each shareholder may be represented at the General Meeting by another shareholder holding a valid power of attorney. The delegate votes in accordance with the instructions of the grantor or, absent instructions, at their own discretion. This power of attorney is valid only for the meeting referenced above.',
    place: 'Place',
    date: 'Date',
    signatureLabel: 'Signature of the grantor',
    companyIdLabel: 'Company number',
  },
  fr: {
    title: 'Procuration',
    grantorSection: 'Le/La soussigné(e) (mandant)',
    name: 'Nom',
    address: 'Adresse',
    shareholderNumber: 'Numéro de coopérateur',
    delegateSection: 'donne procuration à (mandataire)',
    delegateBlank: 'Nom du mandataire',
    meetingSection: 'Afin de le/la représenter à',
    meetingDate: 'Date',
    legalTitle: 'Disposition juridique',
    legal:
      "Conformément à l'article 23 des statuts, chaque coopérateur peut se faire représenter à l'Assemblée Générale par un autre coopérateur titulaire d'une procuration valable. Le mandataire vote conformément aux instructions du mandant ou, à défaut d'instructions, à sa propre appréciation. Cette procuration n'est valable que pour l'assemblée susmentionnée.",
    place: 'Lieu',
    date: 'Date',
    signatureLabel: 'Signature du mandant',
    companyIdLabel: "Numéro d'entreprise",
  },
  de: {
    title: 'Vollmacht',
    grantorSection: 'Der/Die Unterzeichnete (Vollmachtgeber)',
    name: 'Name',
    address: 'Adresse',
    shareholderNumber: 'Mitgliedsnummer',
    delegateSection: 'erteilt Vollmacht an (Bevollmächtigter)',
    delegateBlank: 'Name des Bevollmächtigten',
    meetingSection: 'Zur Vertretung bei',
    meetingDate: 'Datum',
    legalTitle: 'Rechtliche Bestimmung',
    legal:
      'Gemäß Artikel 23 der Satzung kann sich jeder Genosse in der Generalversammlung durch einen anderen Genossen mit gültiger Vollmacht vertreten lassen. Der Bevollmächtigte stimmt gemäß den Weisungen des Vollmachtgebers oder, mangels Weisungen, nach eigenem Ermessen ab. Diese Vollmacht ist nur für die oben genannte Versammlung gültig.',
    place: 'Ort',
    date: 'Datum',
    signatureLabel: 'Unterschrift des Vollmachtgebers',
    companyIdLabel: 'Unternehmensnummer',
  },
};

const LOCALE_MAP: Record<VolmachtFormProps['language'], string> = {
  nl: 'nl-BE',
  en: 'en-US',
  fr: 'fr-BE',
  de: 'de-DE',
};

function formatDateTime(date: Date, language: VolmachtFormProps['language']): string {
  const locale = LOCALE_MAP[language];
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

export const VolmachtFormPdf: React.FC<VolmachtFormProps> = ({
  coop,
  grantor,
  delegate,
  meeting,
  language,
}) => {
  const t = LABELS[language] ?? LABELS.nl;
  const grantorName = `${grantor.firstName} ${grantor.lastName}`.trim();
  const delegateName = delegate ? `${delegate.firstName} ${delegate.lastName}`.trim() : '';
  const when = formatDateTime(meeting.scheduledAt, language);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.coopName}>{coop.name}</Text>
          {coop.address ? <Text style={styles.coopMeta}>{coop.address}</Text> : null}
          {coop.companyId ? (
            <Text style={styles.coopMeta}>
              {t.companyIdLabel}: {coop.companyId}
            </Text>
          ) : null}
        </View>

        <View style={styles.divider} />

        <Text style={styles.title}>{t.title}</Text>

        <Text style={styles.sectionTitle}>{t.grantorSection}</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{t.name}</Text>
          <Text style={styles.fieldValue}>{grantorName}</Text>
        </View>
        {grantor.address ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{t.address}</Text>
            <Text style={styles.fieldValue}>{grantor.address}</Text>
          </View>
        ) : null}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{t.shareholderNumber}</Text>
          <Text style={styles.fieldValue}>{grantor.shareholderNumber}</Text>
        </View>

        <Text style={styles.sectionTitle}>{t.delegateSection}</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{t.delegateBlank}</Text>
          {delegateName ? (
            <Text style={styles.fieldValue}>{delegateName}</Text>
          ) : (
            <Text style={styles.blankLine}> </Text>
          )}
        </View>

        <Text style={styles.sectionTitle}>{t.meetingSection}</Text>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{t.name}</Text>
          <Text style={styles.fieldValue}>{meeting.title}</Text>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{t.meetingDate}</Text>
          <Text style={styles.fieldValue}>{when}</Text>
        </View>

        <View style={styles.legalBlock}>
          <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 4 }}>{t.legalTitle}</Text>
          <Text>{t.legal}</Text>
        </View>

        <View style={styles.placeDateRow}>
          <View style={styles.placeDateCol}>
            <Text style={styles.placeDateLabel}>{t.place}</Text>
            <Text style={styles.placeDateLine}> </Text>
          </View>
          <View style={styles.placeDateCol}>
            <Text style={styles.placeDateLabel}>{t.date}</Text>
            <Text style={styles.placeDateLine}> </Text>
          </View>
        </View>

        <View style={styles.signatureSection}>
          <Text style={styles.signatureLabel}>{t.signatureLabel}</Text>
          <View style={styles.signatureLine}>
            <Text>{grantorName}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
};
