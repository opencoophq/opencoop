import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const BLUE = '#1e40af';
const BORDER_COLOR = '#9ca3af';

const styles = StyleSheet.create({
  page: {
    padding: 36,
    paddingBottom: 60,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: '#111827',
  },
  header: {
    marginBottom: 10,
  },
  coopName: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
  },
  coopMeta: {
    fontSize: 9,
    color: '#4b5563',
  },
  divider: {
    borderBottom: `1.5 solid ${BLUE}`,
    marginTop: 6,
    marginBottom: 12,
  },
  title: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
    marginBottom: 4,
  },
  meetingLine: {
    fontSize: 10,
    color: '#111827',
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
    marginTop: 16,
    marginBottom: 6,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f0f4ff',
    borderTop: `1 solid ${BORDER_COLOR}`,
    borderBottom: `1 solid ${BORDER_COLOR}`,
    paddingVertical: 4,
    paddingHorizontal: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
  },
  tableRow: {
    flexDirection: 'row',
    // Pin text in non-signature columns to the top of the row so the
    // signature column has the full row height free for a wet-ink signature.
    alignItems: 'flex-start',
    borderBottom: `0.5 solid ${BORDER_COLOR}`,
    paddingVertical: 6,
    paddingHorizontal: 4,
    // Tall enough that an average wet signature fits without crowding the
    // text row above. Walk-in rows reuse this style so blank rows are also
    // signable.
    minHeight: 38,
    fontSize: 9,
  },
  colNum: { width: '6%' },
  colName: { width: '30%' },
  colShNr: { width: '14%' },
  colVia: { width: '26%' },
  colSig: { width: '24%' },
  colNumWi: { width: '6%' },
  colNameWi: { width: '40%' },
  colShNrWi: { width: '20%' },
  colSigWi: { width: '34%' },
  signatureFooter: {
    marginTop: 28,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  chairmanBlock: {
    width: 240,
  },
  chairmanLabel: {
    fontSize: 9,
    color: '#4b5563',
    marginBottom: 40,
  },
  chairmanLine: {
    borderTop: '1 solid #374151',
    paddingTop: 4,
    fontSize: 9,
  },
  mutedCell: {
    color: '#6b7280',
    fontStyle: 'italic',
  },
});

export interface AttendanceSheetProps {
  coop: { name: string; address: string };
  meeting: { title: string; scheduledAt: Date; location: string };
  rsvps: Array<{
    shareholderName: string;
    shareholderNumber: string;
    attendingVia: 'IN_PERSON' | 'VOLMACHT_TO';
    delegateName?: string;
  }>;
  language: 'nl' | 'en' | 'fr' | 'de';
}

const LABELS = {
  nl: {
    title: 'Aanwezigheidslijst',
    meetingLabel: 'Vergadering',
    dateLabel: 'Datum',
    locationLabel: 'Locatie',
    preRegistered: 'Vooraf geregistreerde vennoten',
    walkIn: 'Walk-ins (ter plaatse in te schrijven)',
    colNum: '#',
    colName: 'Vennoot',
    colShNr: 'Vennoot #',
    colVia: 'Aanwezig via',
    colSig: 'Handtekening',
    inPerson: 'In persoon',
    volmacht: (name: string) => `Volmacht aan ${name}`,
    chairmanLabel: 'Handtekening voorzitter',
  },
  en: {
    title: 'Attendance sheet',
    meetingLabel: 'Meeting',
    dateLabel: 'Date',
    locationLabel: 'Location',
    preRegistered: 'Pre-registered shareholders',
    walkIn: 'Walk-ins (to register on-site)',
    colNum: '#',
    colName: 'Shareholder',
    colShNr: 'Sh #',
    colVia: 'Attending via',
    colSig: 'Signature',
    inPerson: 'In person',
    volmacht: (name: string) => `Proxy to ${name}`,
    chairmanLabel: 'Chairman signature',
  },
  fr: {
    title: 'Liste de présence',
    meetingLabel: 'Assemblée',
    dateLabel: 'Date',
    locationLabel: 'Lieu',
    preRegistered: 'Coopérateurs préinscrits',
    walkIn: 'Inscriptions sur place',
    colNum: '#',
    colName: 'Coopérateur',
    colShNr: 'N° coop.',
    colVia: 'Présent via',
    colSig: 'Signature',
    inPerson: 'En personne',
    volmacht: (name: string) => `Procuration à ${name}`,
    chairmanLabel: 'Signature du président',
  },
  de: {
    title: 'Anwesenheitsliste',
    meetingLabel: 'Versammlung',
    dateLabel: 'Datum',
    locationLabel: 'Ort',
    preRegistered: 'Vorab registrierte Anteilseigner',
    walkIn: 'Vor-Ort-Anmeldungen',
    colNum: '#',
    colName: 'Anteilseigner',
    colShNr: 'Nr.',
    colVia: 'Anwesend durch',
    colSig: 'Unterschrift',
    inPerson: 'Persönlich',
    volmacht: (name: string) => `Vollmacht an ${name}`,
    chairmanLabel: 'Unterschrift Vorsitzender',
  },
};

const LOCALE_MAP: Record<AttendanceSheetProps['language'], string> = {
  nl: 'nl-BE',
  en: 'en-US',
  fr: 'fr-BE',
  de: 'de-DE',
};

function formatDateTime(date: Date, language: AttendanceSheetProps['language']): string {
  const locale = LOCALE_MAP[language];
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

const WALK_IN_ROWS = 20;

export const AttendanceSheetPdf: React.FC<AttendanceSheetProps> = ({
  coop,
  meeting,
  rsvps,
  language,
}) => {
  const t = LABELS[language] ?? LABELS.nl;
  const when = formatDateTime(meeting.scheduledAt, language);

  return (
    <Document>
      <Page size="A4" style={styles.page} orientation="portrait">
        <View style={styles.header}>
          <Text style={styles.coopName}>{coop.name}</Text>
          {coop.address ? <Text style={styles.coopMeta}>{coop.address}</Text> : null}
        </View>
        <View style={styles.divider} />

        <Text style={styles.title}>{t.title}</Text>
        <Text style={styles.meetingLine}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>{t.meetingLabel}: </Text>
          {meeting.title}
        </Text>
        <Text style={styles.meetingLine}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>{t.dateLabel}: </Text>
          {when}
        </Text>
        <Text style={styles.meetingLine}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>{t.locationLabel}: </Text>
          {meeting.location}
        </Text>

        {/* Main filtered table */}
        <Text style={styles.sectionTitle}>{t.preRegistered}</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.colNum}>{t.colNum}</Text>
          <Text style={styles.colName}>{t.colName}</Text>
          <Text style={styles.colShNr}>{t.colShNr}</Text>
          <Text style={styles.colVia}>{t.colVia}</Text>
          <Text style={styles.colSig}>{t.colSig}</Text>
        </View>
        {rsvps.length === 0 ? (
          <View style={styles.tableRow}>
            <Text style={styles.colNum}></Text>
            <Text style={[styles.colName, styles.mutedCell]}>—</Text>
            <Text style={styles.colShNr}></Text>
            <Text style={styles.colVia}></Text>
            <Text style={styles.colSig}></Text>
          </View>
        ) : (
          rsvps.map((r, idx) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={styles.colNum}>{idx + 1}</Text>
              <Text style={styles.colName}>{r.shareholderName}</Text>
              <Text style={styles.colShNr}>{r.shareholderNumber}</Text>
              <Text style={styles.colVia}>
                {r.attendingVia === 'IN_PERSON'
                  ? t.inPerson
                  : t.volmacht(r.delegateName ?? '—')}
              </Text>
              <Text style={styles.colSig}></Text>
            </View>
          ))
        )}

        {/* Walk-ins */}
        <Text style={styles.sectionTitle}>{t.walkIn}</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.colNumWi}>{t.colNum}</Text>
          <Text style={styles.colNameWi}>{t.colName}</Text>
          <Text style={styles.colShNrWi}>{t.colShNr}</Text>
          <Text style={styles.colSigWi}>{t.colSig}</Text>
        </View>
        {Array.from({ length: WALK_IN_ROWS }).map((_, idx) => (
          <View key={`wi-${idx}`} style={styles.tableRow}>
            <Text style={styles.colNumWi}>{idx + 1}</Text>
            <Text style={styles.colNameWi}></Text>
            <Text style={styles.colShNrWi}></Text>
            <Text style={styles.colSigWi}></Text>
          </View>
        ))}

        <View style={styles.signatureFooter}>
          <View style={styles.chairmanBlock}>
            <Text style={styles.chairmanLabel}>{t.chairmanLabel}</Text>
            <Text style={styles.chairmanLine}> </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
};
