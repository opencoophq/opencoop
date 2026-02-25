'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { ReportFilters } from './report-filters';
import { ExportButtons } from './export-buttons';

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
        <ExportButtons reportType="project-investment" params={{}} disabled={!data} />
      </div>

      {data && (
        data.projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('projectInvestment.noProjects')}</p>
        ) : (
          <div className="border rounded-md overflow-auto">
            <table className="w-full text-sm">
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
        )
      )}
    </div>
  );
}
