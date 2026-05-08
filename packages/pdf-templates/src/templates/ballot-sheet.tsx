import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';

export interface BallotSheetProps {
  coopName: string;
  coopLogoUrl?: string | null;
  meetingTitle: string;
  meetingScheduledAt: string; // already formatted by caller
  resolutions: Array<{
    order: number;
    title: string;
  }>;
  quantity: number; // number of ballots to render (will be rounded up to multiple of 3)
}

const styles = StyleSheet.create({
  page: { padding: '10mm', fontSize: 9, fontFamily: 'Helvetica' },
  ballot: {
    height: '92mm',
    paddingHorizontal: '8mm',
    paddingVertical: '6mm',
    borderBottomWidth: 0.5,
    borderBottomStyle: 'dashed',
    borderBottomColor: '#888',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  ballotLast: {
    borderBottomWidth: 0, // last ballot on a page: no cut line
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: '3mm',
    borderBottomWidth: 0.5,
    borderBottomColor: '#ddd',
  },
  logo: { width: 32, height: 32, objectFit: 'contain', marginRight: '6mm' },
  headerText: { flexDirection: 'column' },
  coopName: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  meetingLine: { fontSize: 9, color: '#444' },
  resolutionList: { flexGrow: 1, marginTop: '4mm' },
  resolutionRow: {
    marginBottom: '3mm',
  },
  resolutionTitle: { fontSize: 10, marginBottom: '1.5mm' },
  choices: { flexDirection: 'row', paddingLeft: '4mm' },
  choiceWrapper: { marginRight: '12mm' },
  choice: { flexDirection: 'row', alignItems: 'center' },
  checkbox: { width: 10, height: 10, borderWidth: 0.6, borderColor: '#333', marginRight: '2mm' },
  choiceLabel: { fontSize: 10 },
  footer: { fontSize: 7, color: '#666', fontStyle: 'italic', marginTop: '2mm', textAlign: 'center' },
});

function Ballot({ data, isLast }: { data: BallotSheetProps; isLast: boolean }) {
  return (
    <View style={[styles.ballot, isLast ? styles.ballotLast : {}]} wrap={false}>
      <View style={styles.header}>
        {data.coopLogoUrl ? <Image src={data.coopLogoUrl} style={styles.logo} /> : null}
        <View style={styles.headerText}>
          <Text style={styles.coopName}>{data.coopName}</Text>
          <Text style={styles.meetingLine}>
            {data.meetingTitle} — {data.meetingScheduledAt}
          </Text>
        </View>
      </View>
      <View style={styles.resolutionList}>
        {data.resolutions.map((r) => (
          <View key={r.order} style={styles.resolutionRow}>
            <Text style={styles.resolutionTitle}>
              {r.order}. {r.title}
            </Text>
            <View style={styles.choices}>
              <View style={styles.choiceWrapper}>
                <View style={styles.choice}>
                  <View style={styles.checkbox} />
                  <Text style={styles.choiceLabel}>VOOR</Text>
                </View>
              </View>
              <View style={styles.choiceWrapper}>
                <View style={styles.choice}>
                  <View style={styles.checkbox} />
                  <Text style={styles.choiceLabel}>TEGEN</Text>
                </View>
              </View>
              <View style={styles.choiceWrapper}>
                <View style={styles.choice}>
                  <View style={styles.checkbox} />
                  <Text style={styles.choiceLabel}>ONTHOUDING</Text>
                </View>
              </View>
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.footer}>
        Plaats deze stem in de stembus. Anoniem — geen naam invullen.
      </Text>
    </View>
  );
}

export const BallotSheetPdf: React.FC<BallotSheetProps> = (props) => {
  // Round up to multiple of 3, minimum 3
  const roundedQuantity = Math.max(3, Math.ceil(props.quantity / 3) * 3);
  const pages = Math.ceil(roundedQuantity / 3);

  return (
    <Document>
      {Array.from({ length: pages }).map((_, pageIdx) => {
        const ballotsThisPage = Math.min(3, roundedQuantity - pageIdx * 3);
        return (
          <Page key={pageIdx} size="A4" style={styles.page}>
            {Array.from({ length: ballotsThisPage }).map((_, i) => (
              <Ballot key={i} data={props} isLast={i === ballotsThisPage - 1} />
            ))}
          </Page>
        );
      })}
    </Document>
  );
};
