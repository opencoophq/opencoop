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
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#666666',
    marginBottom: 4,
  },
  dateRange: {
    fontSize: 10,
    color: '#888888',
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
  balanceBox: {
    backgroundColor: '#f0f4ff',
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 12,
    color: '#1e40af',
    fontFamily: 'Helvetica-Bold',
  },
  balanceValue: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#1e40af',
  },
  closingBalanceBox: {
    backgroundColor: '#1e40af',
    padding: 12,
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  closingBalanceLabel: {
    fontSize: 12,
    color: '#ffffff',
    fontFamily: 'Helvetica-Bold',
  },
  closingBalanceValue: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
  },
  table: {
    marginTop: 4,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f0f4ff',
    paddingVertical: 5,
    paddingHorizontal: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    borderBottom: '1 solid #c7d2fe',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottom: '0.5 solid #eeeeee',
    fontSize: 9,
  },
  tableRowAlt: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottom: '0.5 solid #eeeeee',
    fontSize: 9,
    backgroundColor: '#fafafa',
  },
  colDate: { width: '12%' },
  colType: { width: '14%' },
  colShareholder: { width: '26%' },
  colShareClass: { width: '18%' },
  colQty: { width: '10%', textAlign: 'right' },
  colAmount: { width: '20%', textAlign: 'right' },
  footer: {
    position: 'absolute',
    bottom: 40,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 9,
    color: '#999999',
    borderTop: '1 solid #eeeeee',
    paddingTop: 10,
  },
});

export interface CapitalStatementReportProps {
  coopName: string;
  fromDate: string;
  toDate: string;
  openingBalance: number;
  closingBalance: number;
  movements: {
    date: string;
    type: string;
    shareholderName: string;
    shareClass: string;
    quantity: number;
    amount: number;
  }[];
  locale?: string;
}

export const CapitalStatementReport: React.FC<CapitalStatementReportProps> = ({
  coopName,
  fromDate,
  toDate,
  openingBalance,
  closingBalance,
  movements,
  locale = 'nl',
}) => {
  const t = locale === 'nl' ? {
    title: 'Kapitaaloverzicht',
    period: 'Periode',
    openingBalance: 'Beginsaldo',
    closingBalance: 'Eindsaldo',
    movements: 'Kapitaalbewegingen',
    colDate: 'Datum',
    colType: 'Type',
    colShareholder: 'Aandeelhouder',
    colShareClass: 'Aandelenklasse',
    colQty: 'Aantal',
    colAmount: 'Bedrag',
    generated: 'Gegenereerd op',
    page: 'Pagina',
  } : {
    title: 'Capital Statement',
    period: 'Period',
    openingBalance: 'Opening Balance',
    closingBalance: 'Closing Balance',
    movements: 'Capital Movements',
    colDate: 'Date',
    colType: 'Type',
    colShareholder: 'Shareholder',
    colShareClass: 'Share Class',
    colQty: 'Qty',
    colAmount: 'Amount',
    generated: 'Generated on',
    page: 'Page',
  };

  const fmtLocale = locale === 'nl' ? 'nl-BE' : 'en-US';
  const fmt = (n: number) =>
    new Intl.NumberFormat(fmtLocale, { style: 'currency', currency: 'EUR' }).format(n);
  const fmtNum = (n: number) => new Intl.NumberFormat(fmtLocale).format(n);

  const generatedDate = new Date().toLocaleDateString(fmtLocale);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{coopName}</Text>
          <Text style={styles.subtitle}>{t.title}</Text>
          <Text style={styles.dateRange}>
            {t.period}: {fromDate} - {toDate}
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.balanceBox}>
            <Text style={styles.balanceLabel}>{t.openingBalance}</Text>
            <Text style={styles.balanceValue}>{fmt(openingBalance)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.movements}</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader} fixed>
              <Text style={styles.colDate}>{t.colDate}</Text>
              <Text style={styles.colType}>{t.colType}</Text>
              <Text style={styles.colShareholder}>{t.colShareholder}</Text>
              <Text style={styles.colShareClass}>{t.colShareClass}</Text>
              <Text style={styles.colQty}>{t.colQty}</Text>
              <Text style={styles.colAmount}>{t.colAmount}</Text>
            </View>
            {movements.map((mv, index) => (
              <View key={index} wrap={false} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                <Text style={styles.colDate}>{mv.date}</Text>
                <Text style={styles.colType}>{mv.type}</Text>
                <Text style={styles.colShareholder}>{mv.shareholderName}</Text>
                <Text style={styles.colShareClass}>{mv.shareClass}</Text>
                <Text style={styles.colQty}>{fmtNum(mv.quantity)}</Text>
                <Text style={styles.colAmount}>{fmt(mv.amount)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View wrap={false} style={styles.section}>
          <View style={styles.closingBalanceBox}>
            <Text style={styles.closingBalanceLabel}>{t.closingBalance}</Text>
            <Text style={styles.closingBalanceValue}>{fmt(closingBalance)}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>{coopName} - {t.title} - {t.generated} {generatedDate}</Text>
          <Text
            render={({ pageNumber, totalPages }) => `${t.page} ${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
};
