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
    marginBottom: 8,
  },
  coopName: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
  },
  divider: {
    borderBottom: `1.5 solid ${BLUE}`,
    marginTop: 6,
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: BLUE,
    marginBottom: 4,
  },
  meta: {
    fontSize: 10,
    color: '#374151',
    marginBottom: 2,
  },
  metaLabel: {
    fontFamily: 'Helvetica-Bold',
  },
  contentBlock: {
    marginTop: 16,
  },
  paragraph: {
    fontSize: 10,
    lineHeight: 1.55,
    marginBottom: 8,
  },
  signatureBlock: {
    marginTop: 40,
  },
  signatureLabel: {
    fontSize: 9,
    color: '#4b5563',
    marginBottom: 6,
  },
  signatureLine: {
    borderTop: `1 solid #374151`,
    width: 240,
    paddingTop: 4,
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
  },
  placeholderLine: {
    borderTop: `1 solid ${BORDER_COLOR}`,
    width: 240,
    paddingTop: 4,
    fontSize: 9,
    color: '#6b7280',
    fontStyle: 'italic',
  },
});

export interface MeetingMinutesPdfProps {
  coop: { name: string };
  meeting: { title: string; scheduledAt: Date; location: string };
  content: string;
  signedByName?: string;
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('nl-BE', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

function splitIntoParagraphs(text: string): string[] {
  if (!text) return [];
  // Paragraphs split on blank line; each paragraph preserves interior single line breaks.
  return text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
}

export const MeetingMinutesPdf: React.FC<MeetingMinutesPdfProps> = ({
  coop,
  meeting,
  content,
  signedByName,
}) => {
  const when = formatDateTime(meeting.scheduledAt);
  const paragraphs = splitIntoParagraphs(content);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.coopName}>{coop.name}</Text>
        </View>
        <View style={styles.divider} />

        <Text style={styles.title}>{meeting.title}</Text>
        <Text style={styles.meta}>
          <Text style={styles.metaLabel}>Datum: </Text>
          {when}
        </Text>
        <Text style={styles.meta}>
          <Text style={styles.metaLabel}>Locatie: </Text>
          {meeting.location}
        </Text>

        <View style={styles.contentBlock}>
          {paragraphs.length === 0 ? (
            <Text style={styles.paragraph}>{content}</Text>
          ) : (
            paragraphs.map((p, idx) => (
              <Text key={idx} style={styles.paragraph}>
                {p}
              </Text>
            ))
          )}
        </View>

        <View style={styles.signatureBlock}>
          <Text style={styles.signatureLabel}>Ondertekend door:</Text>
          {signedByName ? (
            <View style={styles.signatureLine}>
              <Text>{signedByName}</Text>
            </View>
          ) : (
            <View style={styles.placeholderLine}>
              <Text>(niet ondertekend)</Text>
            </View>
          )}
        </View>
      </Page>
    </Document>
  );
};
