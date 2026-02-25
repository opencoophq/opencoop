'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { Card, CardContent } from '@/components/ui/card';
import { ReportFilters } from './report-filters';
import { ExportButtons } from './export-buttons';
import { CopyTableButton } from './copy-table-button';

interface DividendPayout {
  shareholderName: string;
  shareCount: number;
  grossAmount: number;
  withholdingTax: number;
  netAmount: number;
}

interface DividendSummary {
  period: {
    name: string | null;
    year: number;
    dividendRate: number;
    withholdingTaxRate: number;
    status: string;
  };
  totals: {
    gross: number;
    tax: number;
    net: number;
  };
  payouts: DividendPayout[];
}

export function DividendSummaryPreview() {
  const t = useTranslations('reports');
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [data, setData] = useState<DividendSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [noData, setNoData] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);

  const generate = () => {
    if (!selectedCoop) return;
    setLoading(true);
    setNoData(false);
    api<DividendSummary | null>(`/admin/coops/${selectedCoop.id}/reports/dividend-summary?year=${year}`)
      .then((result) => {
        if (result === null) {
          setNoData(true);
          setData(null);
        } else {
          setData(result);
        }
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ReportFilters type="year" year={year} onYearChange={setYear} onGenerate={generate} loading={loading} />
        <div className="flex items-center gap-2">
          <CopyTableButton tableRef={tableRef} />
          <ExportButtons reportType="dividend-summary" params={{ year }} disabled={!data} />
        </div>
      </div>

      {noData && (
        <p className="text-sm text-muted-foreground">{t('dividendSummary.noPeriod')}</p>
      )}

      {data && (
        <div className="space-y-4">
          {/* Period info */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{t('dividendSummary.totalGross')}</p>
                <p className="text-xl font-bold">{formatCurrency(data.totals.gross, locale)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{t('dividendSummary.totalTax')}</p>
                <p className="text-xl font-bold">{formatCurrency(data.totals.tax, locale)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{t('dividendSummary.totalNet')}</p>
                <p className="text-xl font-bold">{formatCurrency(data.totals.net, locale)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Payout table */}
          {data.payouts.length > 0 && (
            <div className="border rounded-md overflow-auto">
              <table ref={tableRef} className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">{t('dividendSummary.shareholder')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('dividendSummary.shares')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('dividendSummary.gross')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('dividendSummary.tax')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('dividendSummary.net')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payouts.map((p, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2 font-medium">{p.shareholderName}</td>
                      <td className="px-3 py-2 text-right">{p.shareCount}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(p.grossAmount, locale)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(p.withholdingTax, locale)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(p.netAmount, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
