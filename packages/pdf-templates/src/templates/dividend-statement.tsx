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
    borderBottom: '1 solid #333333',
    paddingBottom: 4,
    marginBottom: 4,
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottom: '0.5 solid #eeeeee',
    fontSize: 10,
  },
  col1: { width: '25%' },
  col2: { width: '15%', textAlign: 'right' },
  col3: { width: '20%', textAlign: 'right' },
  col4: { width: '20%', textAlign: 'right' },
  col5: { width: '20%', textAlign: 'right' },
  totalRow: {
    flexDirection: 'row',
    marginTop: 10,
    paddingTop: 8,
    borderTop: '2 solid #333333',
  },
  totalLabel: {
    width: '50%',
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
  },
  totalValue: {
    width: '50%',
    textAlign: 'right',
    fontFamily: 'Helvetica-Bold',
    fontSize: 12,
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
  note: {
    marginTop: 20,
    fontSize: 9,
    color: '#666666',
    lineHeight: 1.5,
  },
});

interface DividendDetail {
  shareClassName: string;
  quantity: number;
  totalValue: number;
  dividendRate: number;
  dividendAmount: number;
}

export interface DividendStatementProps {
  coopName: string;
  shareholderName: string;
  shareholderType: string;
  nationalId?: string;
  companyId?: string;
  year: number;
  periodName?: string;
  exDividendDate: string;
  paymentDate?: string;
  details: DividendDetail[];
  grossAmount: number;
  withholdingTax: number;
  withholdingTaxRate: number;
  netAmount: number;
  locale?: string;
}

export const DividendStatement: React.FC<DividendStatementProps> = ({
  coopName,
  shareholderName,
  shareholderType,
  nationalId,
  companyId,
  year,
  periodName,
  exDividendDate,
  paymentDate,
  details,
  grossAmount,
  withholdingTax,
  withholdingTaxRate,
  netAmount,
  locale = 'nl',
}) => {
  const t = locale === 'nl' ? {
    title: 'Dividendafrekening',
    period: 'Periode',
    shareholderInfo: 'Aandeelhouder',
    name: 'Naam',
    type: 'Type',
    nationalId: 'Rijksregisternummer',
    companyId: 'Ondernemingsnummer',
    dividendDetails: 'Dividendberekening',
    shareClass: 'Categorie',
    quantity: 'Aantal',
    totalValue: 'Waarde',
    rate: 'Tarief',
    amount: 'Bedrag',
    summary: 'Samenvatting',
    grossDividend: 'Bruto dividend',
    withholdingTax: 'Roerende voorheffing',
    netDividend: 'Netto dividend',
    exDividendDate: 'Ex-dividenddatum',
    paymentDate: 'Betaaldatum',
    note: 'Dit document geldt als officieel dividendoverzicht voor belastingdoeleinden.',
    types: { INDIVIDUAL: 'Particulier', COMPANY: 'Rechtspersoon', MINOR: 'Minderjarige' },
  } : {
    title: 'Dividend Statement',
    period: 'Period',
    shareholderInfo: 'Shareholder',
    name: 'Name',
    type: 'Type',
    nationalId: 'National ID',
    companyId: 'Company Number',
    dividendDetails: 'Dividend Calculation',
    shareClass: 'Share Class',
    quantity: 'Quantity',
    totalValue: 'Value',
    rate: 'Rate',
    amount: 'Amount',
    summary: 'Summary',
    grossDividend: 'Gross Dividend',
    withholdingTax: 'Withholding Tax',
    netDividend: 'Net Dividend',
    exDividendDate: 'Ex-dividend Date',
    paymentDate: 'Payment Date',
    note: 'This document serves as the official dividend statement for tax purposes.',
    types: { INDIVIDUAL: 'Individual', COMPANY: 'Company', MINOR: 'Minor' },
  };

  const fmt = (n: number) => `€ ${n.toFixed(2).replace('.', ',')}`;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{coopName}</Text>
          <Text style={styles.subtitle}>{t.title} {periodName || year}</Text>
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
          <View style={styles.row}>
            <Text style={styles.label}>{t.exDividendDate}</Text>
            <Text style={styles.value}>{exDividendDate}</Text>
          </View>
          {paymentDate && (
            <View style={styles.row}>
              <Text style={styles.label}>{t.paymentDate}</Text>
              <Text style={styles.value}>{paymentDate}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.dividendDetails}</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.col1}>{t.shareClass}</Text>
              <Text style={styles.col2}>{t.quantity}</Text>
              <Text style={styles.col3}>{t.totalValue}</Text>
              <Text style={styles.col4}>{t.rate}</Text>
              <Text style={styles.col5}>{t.amount}</Text>
            </View>
            {details.map((detail, index) => (
              <View key={index} style={styles.tableRow}>
                <Text style={styles.col1}>{detail.shareClassName}</Text>
                <Text style={styles.col2}>{detail.quantity}</Text>
                <Text style={styles.col3}>{fmt(detail.totalValue)}</Text>
                <Text style={styles.col4}>{pct(detail.dividendRate)}</Text>
                <Text style={styles.col5}>{fmt(detail.dividendAmount)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.summary}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>{t.grossDividend}</Text>
            <Text style={styles.boldValue}>{fmt(grossAmount)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>{t.withholdingTax} ({pct(withholdingTaxRate)})</Text>
            <Text style={styles.value}>- {fmt(withholdingTax)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t.netDividend}</Text>
            <Text style={styles.totalValue}>{fmt(netAmount)}</Text>
          </View>
        </View>

        <View style={styles.note}>
          <Text>{t.note}</Text>
        </View>

        <View style={styles.footer}>
          <Text>{coopName} - {t.title} {year}</Text>
        </View>
      </Page>
    </Document>
  );
};
