'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { Card, CardContent } from '@/components/ui/card';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ReportFilters } from './report-filters';
import { ExportButtons } from './export-buttons';
import { ChartActionBar } from '@/components/charts/chart-action-bar';
import { CopyTableButton } from './copy-table-button';

const COLORS = [
  'hsl(221, 83%, 53%)',
  'hsl(142, 71%, 45%)',
  'hsl(262, 83%, 58%)',
  'hsl(25, 95%, 53%)',
  'hsl(350, 89%, 60%)',
  'hsl(174, 72%, 40%)',
  'hsl(47, 96%, 53%)',
  'hsl(280, 67%, 51%)',
];

interface CapitalTimelineBucket {
  date: string;
  projects: { projectId: string | null; projectName: string; capital: number }[];
  total: number;
}

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
  capitalTimeline?: CapitalTimelineBucket[];
}

export function AnnualOverviewPreview() {
  const t = useTranslations('reports');
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [data, setData] = useState<AnnualOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const areaChartRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

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
        <ExportButtons reportType="annual-overview" params={{ year }} disabled={!data} pdfSupported />
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

          {/* Capital Growth by Project — stacked area chart */}
          {data.capitalTimeline && data.capitalTimeline.length > 0 && (() => {
            const projectKeys = data.capitalTimeline[0].projects.map((p) => p.projectId ?? 'unassigned');
            const projectLabels = new Map(data.capitalTimeline[0].projects.map((p) => [p.projectId ?? 'unassigned', p.projectName]));
            const chartData = data.capitalTimeline.map((b) => {
              const point: Record<string, unknown> = { date: b.date };
              for (const p of b.projects) {
                point[p.projectId ?? 'unassigned'] = p.capital;
              }
              return point;
            });
            return (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold">{t('annualOverview.capitalGrowthByProject')}</h3>
                  <ChartActionBar chartRef={areaChartRef} filename={`capital-growth-${year}`} />
                </div>
                <div ref={areaChartRef}>
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d: string) => {
                          const dt = new Date(d);
                          return `${dt.getUTCMonth() + 1}/${String(dt.getUTCFullYear()).slice(2)}`;
                        }}
                        fontSize={11}
                      />
                      <YAxis
                        tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                        fontSize={11}
                      />
                      <Tooltip
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        formatter={(value: any, name: any) => [
                          formatCurrency(Number(value) || 0, locale),
                          projectLabels.get(String(name)) ?? name,
                        ]}
                        labelFormatter={(d) => new Date(String(d)).toLocaleDateString(locale)}
                      />
                      <Legend formatter={(value) => <span className="text-xs">{projectLabels.get(value) ?? value}</span>} />
                      {projectKeys.map((key, i) => (
                        <Area
                          key={key}
                          type="monotone"
                          dataKey={key}
                          stackId="1"
                          stroke={COLORS[i % COLORS.length]}
                          fill={COLORS[i % COLORS.length]}
                          fillOpacity={0.6}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}

          {/* Share Class Breakdown — chart + table */}
          {data.shareClassBreakdown.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">{t('annualOverview.shareClassBreakdown')}</h3>
                <div className="flex items-center gap-1">
                  {data.shareClassBreakdown.length > 1 && (
                    <ChartActionBar chartRef={chartRef} filename={`share-class-breakdown-${year}`} />
                  )}
                  <CopyTableButton tableRef={tableRef} />
                </div>
              </div>

              {data.shareClassBreakdown.length > 1 && (
                <div ref={chartRef} className="mb-4">
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={data.shareClassBreakdown}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="capital"
                        nameKey="name"
                      >
                        {data.shareClassBreakdown.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number | undefined) => formatCurrency(value ?? 0, locale)} />
                      <Legend formatter={(value) => <span className="text-xs">{value}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="border rounded-md overflow-hidden">
                <table ref={tableRef} className="w-full text-sm">
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
