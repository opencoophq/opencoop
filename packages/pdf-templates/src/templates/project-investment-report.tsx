import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { DonutChart } from '../charts/donut-chart';

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
  colName: { width: '30%' },
  colType: { width: '15%' },
  colCapital: { width: '20%', textAlign: 'right' },
  colShareholders: { width: '12%', textAlign: 'right' },
  colShares: { width: '12%', textAlign: 'right' },
  colPct: { width: '11%', textAlign: 'right' },
  totalRow: {
    flexDirection: 'row',
    marginTop: 10,
    paddingTop: 8,
    paddingHorizontal: 4,
    borderTop: '2 solid #333333',
    fontSize: 10,
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

export interface ProjectInvestmentReportProps {
  coopName: string;
  projects: {
    name: string;
    type: string;
    totalCapital: number;
    shareholderCount: number;
    shareCount: number;
    percentage: number;
  }[];
  totalCapital: number;
  locale?: string;
}

export const ProjectInvestmentReport: React.FC<ProjectInvestmentReportProps> = ({
  coopName,
  projects,
  totalCapital,
  locale = 'nl',
}) => {
  const t = locale === 'nl' ? {
    title: 'Projectinvesteringen',
    capitalDistribution: 'Kapitaalverdeling per project',
    details: 'Projectdetails',
    colName: 'Project',
    colType: 'Type',
    colCapital: 'Kapitaal',
    colShareholders: 'Leden',
    colShares: 'Aandelen',
    colPct: '%',
    total: 'Totaal',
    generated: 'Gegenereerd op',
  } : {
    title: 'Project Investments',
    capitalDistribution: 'Capital Distribution by Project',
    details: 'Project Details',
    colName: 'Project',
    colType: 'Type',
    colCapital: 'Capital',
    colShareholders: 'Members',
    colShares: 'Shares',
    colPct: '%',
    total: 'Total',
    generated: 'Generated on',
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
        </View>

        {/* Donut chart */}
        {projects.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t.capitalDistribution}</Text>
            <View style={{ marginTop: 8 }}>
              <DonutChart
                data={projects.map((p) => ({ label: p.name, value: p.totalCapital }))}
                size={170}
                innerRadius={45}
                outerRadius={75}
                formatValue={fmt}
              />
            </View>
          </View>
        )}

        {/* Table */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t.details}</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.colName}>{t.colName}</Text>
              <Text style={styles.colType}>{t.colType}</Text>
              <Text style={styles.colCapital}>{t.colCapital}</Text>
              <Text style={styles.colShareholders}>{t.colShareholders}</Text>
              <Text style={styles.colShares}>{t.colShares}</Text>
              <Text style={styles.colPct}>{t.colPct}</Text>
            </View>
            {projects.map((p, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.colName}>{p.name}</Text>
                <Text style={styles.colType}>{p.type}</Text>
                <Text style={styles.colCapital}>{fmt(p.totalCapital)}</Text>
                <Text style={styles.colShareholders}>{fmtNum(p.shareholderCount)}</Text>
                <Text style={styles.colShares}>{fmtNum(p.shareCount)}</Text>
                <Text style={styles.colPct}>{p.percentage.toFixed(1)}%</Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={[styles.colName, { fontFamily: 'Helvetica-Bold' }]}>{t.total}</Text>
              <Text style={styles.colType} />
              <Text style={[styles.colCapital, { fontFamily: 'Helvetica-Bold' }]}>{fmt(totalCapital)}</Text>
              <Text style={styles.colShareholders} />
              <Text style={styles.colShares} />
              <Text style={styles.colPct} />
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
