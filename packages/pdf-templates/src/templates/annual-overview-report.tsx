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
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridCell: {
    width: '50%',
    paddingRight: 16,
    marginBottom: 8,
  },
  gridLabel: {
    fontSize: 9,
    color: '#555555',
    marginBottom: 2,
  },
  gridValue: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
  },
  gridChange: {
    fontSize: 9,
    color: '#16a34a',
    marginTop: 1,
  },
  gridChangeNeg: {
    fontSize: 9,
    color: '#dc2626',
    marginTop: 1,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  label: {
    width: '50%',
    color: '#555555',
  },
  value: {
    width: '50%',
    textAlign: 'right',
  },
  boldValue: {
    width: '50%',
    textAlign: 'right',
    fontFamily: 'Helvetica-Bold',
  },
  table: {
    marginTop: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f0f4ff',
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    borderBottom: '1 solid #c7d2fe',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottom: '0.5 solid #eeeeee',
    fontSize: 10,
  },
  colName: { width: '40%' },
  colCode: { width: '15%' },
  colShares: { width: '20%', textAlign: 'right' },
  colCapital: { width: '25%', textAlign: 'right' },
  totalRow: {
    flexDirection: 'row',
    marginTop: 10,
    paddingTop: 8,
    paddingHorizontal: 4,
    borderTop: '2 solid #333333',
    fontSize: 10,
  },
  totalLabel: {
    width: '55%',
    fontFamily: 'Helvetica-Bold',
  },
  totalValue: {
    width: '45%',
    textAlign: 'right',
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
});

export interface AnnualOverviewReportProps {
  coopName: string;
  year: number;
  capitalStart: number;
  capitalEnd: number;
  shareholdersStart: number;
  shareholdersEnd: number;
  totalPurchases: number;
  totalSales: number;
  totalDividendsGross: number;
  totalDividendsNet: number;
  shareClassBreakdown: { name: string; code: string; shares: number; capital: number }[];
  locale?: string;
}

export const AnnualOverviewReport: React.FC<AnnualOverviewReportProps> = ({
  coopName,
  year,
  capitalStart,
  capitalEnd,
  shareholdersStart,
  shareholdersEnd,
  totalPurchases,
  totalSales,
  totalDividendsGross,
  totalDividendsNet,
  shareClassBreakdown,
  locale = 'nl',
}) => {
  const t = locale === 'nl' ? {
    title: `Jaaroverzicht ${year}`,
    keyFigures: 'Kerncijfers',
    capitalStart: 'Kapitaal begin',
    capitalEnd: 'Kapitaal einde',
    shareholdersStart: 'Aandeelhouders begin',
    shareholdersEnd: 'Aandeelhouders einde',
    change: 'Wijziging',
    transactions: 'Transactiesamenvatting',
    totalPurchases: 'Totale aankopen',
    totalSales: 'Totale verkopen',
    dividends: 'Dividendensamenvatting',
    grossDividends: 'Bruto dividenden',
    withholdingTax: 'Roerende voorheffing',
    netDividends: 'Netto dividenden',
    shareClassBreakdown: 'Aandelenklassen',
    colName: 'Naam',
    colCode: 'Code',
    colShares: 'Aandelen',
    colCapital: 'Kapitaal',
    total: 'Totaal',
    generated: 'Gegenereerd op',
  } : {
    title: `Annual Overview ${year}`,
    keyFigures: 'Key Figures',
    capitalStart: 'Capital Start',
    capitalEnd: 'Capital End',
    shareholdersStart: 'Shareholders Start',
    shareholdersEnd: 'Shareholders End',
    change: 'Change',
    transactions: 'Transaction Summary',
    totalPurchases: 'Total Purchases',
    totalSales: 'Total Sales',
    dividends: 'Dividend Summary',
    grossDividends: 'Gross Dividends',
    withholdingTax: 'Withholding Tax',
    netDividends: 'Net Dividends',
    shareClassBreakdown: 'Share Class Breakdown',
    colName: 'Name',
    colCode: 'Code',
    colShares: 'Shares',
    colCapital: 'Capital',
    total: 'Total',
    generated: 'Generated on',
  };

  const fmtLocale = locale === 'nl' ? 'nl-BE' : 'en-US';
  const fmt = (n: number) =>
    new Intl.NumberFormat(fmtLocale, { style: 'currency', currency: 'EUR' }).format(n);
  const fmtPct = (start: number, end: number) => {
    if (start === 0) return '';
    const pct = ((end - start) / start) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };
  const fmtNum = (n: number) => new Intl.NumberFormat(fmtLocale).format(n);

  const capitalChange = fmtPct(capitalStart, capitalEnd);
  const capitalPositive = capitalEnd >= capitalStart;
  const shareholdersChange = fmtPct(shareholdersStart, shareholdersEnd);
  const shareholdersPositive = shareholdersEnd >= shareholdersStart;

  const totalShares = shareClassBreakdown.reduce((sum, sc) => sum + sc.shares, 0);
  const totalCapital = shareClassBreakdown.reduce((sum, sc) => sum + sc.capital, 0);

  const generatedDate = new Date().toLocaleDateString(fmtLocale);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{coopName}</Text>
          <Text style={styles.subtitle}>{t.title}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.keyFigures}</Text>
          <View style={styles.grid}>
            <View style={styles.gridCell}>
              <Text style={styles.gridLabel}>{t.capitalStart}</Text>
              <Text style={styles.gridValue}>{fmt(capitalStart)}</Text>
            </View>
            <View style={styles.gridCell}>
              <Text style={styles.gridLabel}>{t.capitalEnd}</Text>
              <Text style={styles.gridValue}>{fmt(capitalEnd)}</Text>
              {capitalChange !== '' && (
                <Text style={capitalPositive ? styles.gridChange : styles.gridChangeNeg}>
                  {capitalChange}
                </Text>
              )}
            </View>
            <View style={styles.gridCell}>
              <Text style={styles.gridLabel}>{t.shareholdersStart}</Text>
              <Text style={styles.gridValue}>{fmtNum(shareholdersStart)}</Text>
            </View>
            <View style={styles.gridCell}>
              <Text style={styles.gridLabel}>{t.shareholdersEnd}</Text>
              <Text style={styles.gridValue}>{fmtNum(shareholdersEnd)}</Text>
              {shareholdersChange !== '' && (
                <Text style={shareholdersPositive ? styles.gridChange : styles.gridChangeNeg}>
                  {shareholdersChange}
                </Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.transactions}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>{t.totalPurchases}</Text>
            <Text style={styles.value}>{fmt(totalPurchases)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t.totalSales}</Text>
            <Text style={styles.value}>{fmt(totalSales)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.dividends}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>{t.grossDividends}</Text>
            <Text style={styles.value}>{fmt(totalDividendsGross)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t.withholdingTax}</Text>
            <Text style={styles.value}>- {fmt(totalDividendsGross - totalDividendsNet)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t.netDividends}</Text>
            <Text style={styles.boldValue}>{fmt(totalDividendsNet)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.shareClassBreakdown}</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.colName}>{t.colName}</Text>
              <Text style={styles.colCode}>{t.colCode}</Text>
              <Text style={styles.colShares}>{t.colShares}</Text>
              <Text style={styles.colCapital}>{t.colCapital}</Text>
            </View>
            {shareClassBreakdown.map((sc, index) => (
              <View key={index} style={styles.tableRow}>
                <Text style={styles.colName}>{sc.name}</Text>
                <Text style={styles.colCode}>{sc.code}</Text>
                <Text style={styles.colShares}>{fmtNum(sc.shares)}</Text>
                <Text style={styles.colCapital}>{fmt(sc.capital)}</Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={[styles.colName, { fontFamily: 'Helvetica-Bold' }]}>{t.total}</Text>
              <Text style={styles.colCode} />
              <Text style={[styles.colShares, { fontFamily: 'Helvetica-Bold' }]}>{fmtNum(totalShares)}</Text>
              <Text style={[styles.colCapital, { fontFamily: 'Helvetica-Bold' }]}>{fmt(totalCapital)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Text>{coopName} - {t.title} - {t.generated} {generatedDate}</Text>
        </View>
      </Page>
    </Document>
  );
};
