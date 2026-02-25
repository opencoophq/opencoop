'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { Card, CardContent } from '@/components/ui/card';
import { ReportFilters } from './report-filters';
import { ExportButtons } from './export-buttons';

interface AnnualOverview {
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
}

export function AnnualOverviewPreview() {
  const t = useTranslations('reports');
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [data, setData] = useState<AnnualOverview | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = () => {
    if (!selectedCoop) return;
    setLoading(true);
    api<AnnualOverview>(`/admin/coops/${selectedCoop.id}/reports/annual-overview?year=${year}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  const pctChange = (start: number, end: number) => {
    if (start === 0) return end > 0 ? '+100%' : '0%';
    const pct = ((end - start) / start) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ReportFilters type="year" year={year} onYearChange={setYear} onGenerate={generate} loading={loading} />
        <ExportButtons reportType="annual-overview" params={{ year }} disabled={!data} />
      </div>

      {data && (
        <div className="space-y-6">
          {/* Key Figures */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{t('annualOverview.capitalStart')}</p>
                <p className="text-xl font-bold">{formatCurrency(data.capitalStart, locale)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{t('annualOverview.capitalEnd')}</p>
                <p className="text-xl font-bold">{formatCurrency(data.capitalEnd, locale)}</p>
                <p className="text-xs text-muted-foreground">{pctChange(data.capitalStart, data.capitalEnd)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{t('annualOverview.shareholdersStart')}</p>
                <p className="text-xl font-bold">{data.shareholdersStart}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{t('annualOverview.shareholdersEnd')}</p>
                <p className="text-xl font-bold">{data.shareholdersEnd}</p>
                <p className="text-xs text-muted-foreground">{pctChange(data.shareholdersStart, data.shareholdersEnd)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Transaction & Dividend Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-4">
                <h3 className="text-sm font-semibold mb-2">{t('annualOverview.transactionSummary')}</h3>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('annualOverview.purchases')}</span>
                    <span className="font-medium">{formatCurrency(data.totalPurchases, locale)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('annualOverview.sales')}</span>
                    <span className="font-medium">{formatCurrency(data.totalSales, locale)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <h3 className="text-sm font-semibold mb-2">{t('annualOverview.dividendSummary')}</h3>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('annualOverview.gross')}</span>
                    <span className="font-medium">{formatCurrency(data.totalDividendsGross, locale)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('annualOverview.net')}</span>
                    <span className="font-medium">{formatCurrency(data.totalDividendsNet, locale)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Share Class Breakdown */}
          {data.shareClassBreakdown.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2">{t('annualOverview.shareClassBreakdown')}</h3>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">{t('annualOverview.className')}</th>
                      <th className="text-left px-3 py-2 font-medium">{t('annualOverview.code')}</th>
                      <th className="text-right px-3 py-2 font-medium">{t('annualOverview.shares')}</th>
                      <th className="text-right px-3 py-2 font-medium">{t('annualOverview.capital')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.shareClassBreakdown.map((sc) => (
                      <tr key={sc.code} className="border-t">
                        <td className="px-3 py-2">{sc.name}</td>
                        <td className="px-3 py-2">{sc.code}</td>
                        <td className="px-3 py-2 text-right">{sc.shares}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(sc.capital, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
