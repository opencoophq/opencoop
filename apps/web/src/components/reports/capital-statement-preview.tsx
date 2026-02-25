'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { Card, CardContent } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ReportFilters } from './report-filters';
import { ExportButtons } from './export-buttons';
import { CopyTableButton } from './copy-table-button';
import { ChartActionBar } from '@/components/charts/chart-action-bar';

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

interface Movement {
  date: string;
  type: string;
  shareholderName: string;
  shareClass: string;
  quantity: number;
  amount: number;
}

interface CapitalTimelineBucket {
  date: string;
  projects: { projectId: string | null; projectName: string; capital: number }[];
  total: number;
}

interface CapitalStatement {
  openingBalance: number;
  closingBalance: number;
  movements: Movement[];
  capitalTimeline?: CapitalTimelineBucket[];
}

export function CapitalStatementPreview() {
  const t = useTranslations('reports');
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const now = new Date();
  const [from, setFrom] = useState(`${now.getFullYear()}-01-01`);
  const [to, setTo] = useState(now.toISOString().split('T')[0]);
  const [data, setData] = useState<CapitalStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  const areaChartRef = useRef<HTMLDivElement>(null);

  const generate = () => {
    if (!selectedCoop) return;
    setLoading(true);
    api<CapitalStatement>(`/admin/coops/${selectedCoop.id}/reports/capital-statement?from=${from}&to=${to}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  const typeLabel = (type: string) => {
    const map: Record<string, string> = {
      PURCHASE: t('types.purchase'),
      SALE: t('types.sale'),
      TRANSFER_IN: t('types.transferIn'),
      TRANSFER_OUT: t('types.transferOut'),
    };
    return map[type] || type;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ReportFilters type="dateRange" from={from} to={to} onFromChange={setFrom} onToChange={setTo} onGenerate={generate} loading={loading} />
        <div className="flex items-center gap-2">
          <CopyTableButton tableRef={tableRef} />
          <ExportButtons reportType="capital-statement" params={{ from, to }} disabled={!data} pdfSupported />
        </div>
      </div>

      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{t('capitalStatement.openingBalance')}</p>
                <p className="text-xl font-bold">{formatCurrency(data.openingBalance, locale)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-muted-foreground">{t('capitalStatement.closingBalance')}</p>
                <p className="text-xl font-bold">{formatCurrency(data.closingBalance, locale)}</p>
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
                  <h3 className="text-sm font-semibold">{t('capitalStatement.capitalGrowthByProject')}</h3>
                  <ChartActionBar chartRef={areaChartRef} filename={`capital-growth-${from}-${to}`} />
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

          {data.movements.length > 0 ? (
            <div className="border rounded-md overflow-auto">
              <table ref={tableRef} className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">{t('capitalStatement.date')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('capitalStatement.type')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('capitalStatement.shareholder')}</th>
                    <th className="text-left px-3 py-2 font-medium">{t('capitalStatement.shareClass')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('capitalStatement.qty')}</th>
                    <th className="text-right px-3 py-2 font-medium">{t('capitalStatement.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.movements.map((m, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">{new Date(m.date).toLocaleDateString(locale)}</td>
                      <td className="px-3 py-2">{typeLabel(m.type)}</td>
                      <td className="px-3 py-2">{m.shareholderName}</td>
                      <td className="px-3 py-2">{m.shareClass}</td>
                      <td className="px-3 py-2 text-right">{m.quantity}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(m.amount, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noMovements')}</p>
          )}
        </div>
      )}
    </div>
  );
}
