'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
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
  'hsl(199, 89%, 48%)',
  'hsl(160, 84%, 39%)',
  'hsl(330, 81%, 60%)',
  'hsl(38, 92%, 50%)',
  'hsl(210, 40%, 60%)',
  'hsl(120, 40%, 55%)',
  'hsl(290, 50%, 55%)',
  'hsl(15, 75%, 55%)',
  'hsl(190, 60%, 50%)',
  'hsl(60, 70%, 50%)',
];

interface ProjectEntry {
  id: string;
  name: string;
  type: string;
  totalCapital: number;
  shareholderCount: number;
  shareCount: number;
  percentage: number;
}

interface ProjectInvestment {
  projects: ProjectEntry[];
}

export function ProjectInvestmentPreview() {
  const t = useTranslations('reports');
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [data, setData] = useState<ProjectInvestment | null>(null);
  const [loading, setLoading] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const generate = () => {
    if (!selectedCoop) return;
    setLoading(true);
    api<ProjectInvestment>(`/admin/coops/${selectedCoop.id}/reports/project-investment`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  const totalCapital = data?.projects.reduce((sum, p) => sum + p.totalCapital, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ReportFilters type="none" onGenerate={generate} loading={loading} />
        <ExportButtons reportType="project-investment" params={{}} disabled={!data} pdfSupported />
      </div>

      {data && (
        data.projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('projectInvestment.noProjects')}</p>
        ) : (
          <div className="space-y-4">
            {/* Donut chart */}
            {data.projects.length > 1 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold">{t('projectInvestment.distribution')}</h3>
                  <ChartActionBar chartRef={chartRef} filename="project-investment" />
                </div>
                <div ref={chartRef} className="flex items-center gap-6">
                  {/* Legend on the left */}
                  <div className="flex flex-col gap-1.5 min-w-[180px]">
                    {data.projects.map((p, i) => (
                      <div key={p.id} className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: COLORS[i % COLORS.length] }}
                        />
                        <span className="text-xs text-muted-foreground truncate">{p.name}</span>
                        <span className="text-xs font-medium ml-auto">{p.percentage.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                  {/* Donut on the right */}
                  <div className="flex-1 min-w-[200px]">
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie
                          data={data.projects}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={95}
                          paddingAngle={1}
                          dataKey="totalCapital"
                          nameKey="name"
                        >
                          {data.projects.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number | undefined) => formatCurrency(value ?? 0, locale)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">{t('projectInvestment.details')}</h3>
                <CopyTableButton tableRef={tableRef} />
              </div>
              <div className="border rounded-md overflow-auto">
                <table ref={tableRef} className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">{t('projectInvestment.project')}</th>
                      <th className="text-left px-3 py-2 font-medium">{t('projectInvestment.type')}</th>
                      <th className="text-right px-3 py-2 font-medium">{t('projectInvestment.capital')}</th>
                      <th className="text-right px-3 py-2 font-medium">{t('projectInvestment.shareholders')}</th>
                      <th className="text-right px-3 py-2 font-medium">{t('projectInvestment.shares')}</th>
                      <th className="text-right px-3 py-2 font-medium">{t('projectInvestment.percentage')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.projects.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="px-3 py-2 font-medium">{p.name}</td>
                        <td className="px-3 py-2">{p.type}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(p.totalCapital, locale)}</td>
                        <td className="px-3 py-2 text-right">{p.shareholderCount}</td>
                        <td className="px-3 py-2 text-right">{p.shareCount}</td>
                        <td className="px-3 py-2 text-right">{p.percentage.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/50 font-medium">
                    <tr className="border-t">
                      <td className="px-3 py-2" colSpan={2}>{t('common.total')}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(totalCapital, locale)}</td>
                      <td className="px-3 py-2" colSpan={3}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}
