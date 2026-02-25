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
  dateText: {
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
  tableTotalRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderTop: '2 solid #333333',
    marginTop: 2,
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    backgroundColor: '#f0f4ff',
  },
  colName: { width: '22%' },
  colType: { width: '11%' },
  colEmail: { width: '27%' },
  colShares: { width: '12%', textAlign: 'right' },
  colValue: { width: '16%', textAlign: 'right' },
  colDate: { width: '12%', textAlign: 'right' },
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

export interface ShareholderRegisterReportProps {
  coopName: string;
  date: string;
  shareholders: {
    name: string;
    type: string;
    email: string;
    shareCount: number;
    totalValue: number;
    joinDate: string;
  }[];
  totalShareCount: number;
  totalValue: number;
  locale?: string;
}

export const ShareholderRegisterReport: React.FC<ShareholderRegisterReportProps> = ({
  coopName,
  date,
  shareholders,
  totalShareCount,
  totalValue,
  locale = 'nl',
}) => {
  const t = locale === 'nl' ? {
    title: 'Aandeelhoudersregister',
    asOf: 'Per datum',
    colName: 'Naam',
    colType: 'Type',
    colEmail: 'E-mail',
    colShares: 'Aandelen',
    colValue: 'Waarde',
    colDate: 'Lid sinds',
    total: 'Totaal',
    generated: 'Gegenereerd op',
    page: 'Pagina',
    types: { INDIVIDUAL: 'Particulier', COMPANY: 'Rechtspersoon', MINOR: 'Minderjarige' },
  } : {
    title: 'Shareholder Register',
    asOf: 'As of',
    colName: 'Name',
    colType: 'Type',
    colEmail: 'Email',
    colShares: 'Shares',
    colValue: 'Value',
    colDate: 'Member Since',
    total: 'Total',
    generated: 'Generated on',
    page: 'Page',
    types: { INDIVIDUAL: 'Individual', COMPANY: 'Company', MINOR: 'Minor' },
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
          <Text style={styles.dateText}>{t.asOf}: {date}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.title}</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader} fixed>
              <Text style={styles.colName}>{t.colName}</Text>
              <Text style={styles.colType}>{t.colType}</Text>
              <Text style={styles.colEmail}>{t.colEmail}</Text>
              <Text style={styles.colShares}>{t.colShares}</Text>
              <Text style={styles.colValue}>{t.colValue}</Text>
              <Text style={styles.colDate}>{t.colDate}</Text>
            </View>
            {shareholders.map((sh, index) => (
              <View key={index} wrap={false} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                <Text style={styles.colName}>{sh.name}</Text>
                <Text style={styles.colType}>
                  {t.types[sh.type as keyof typeof t.types] || sh.type}
                </Text>
                <Text style={styles.colEmail}>{sh.email}</Text>
                <Text style={styles.colShares}>{fmtNum(sh.shareCount)}</Text>
                <Text style={styles.colValue}>{fmt(sh.totalValue)}</Text>
                <Text style={styles.colDate}>{sh.joinDate}</Text>
              </View>
            ))}
            <View wrap={false} style={styles.tableTotalRow}>
              <Text style={styles.colName}>{t.total}</Text>
              <Text style={styles.colType} />
              <Text style={styles.colEmail} />
              <Text style={styles.colShares}>{fmtNum(totalShareCount)}</Text>
              <Text style={styles.colValue}>{fmt(totalValue)}</Text>
              <Text style={styles.colDate} />
            </View>
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
