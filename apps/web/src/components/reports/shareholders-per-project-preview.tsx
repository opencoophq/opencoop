'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ExportButtons } from './export-buttons';
import { CopyTableButton } from './copy-table-button';

interface Project {
  id: string;
  name: string;
  type: string;
}

interface ShareholderEntry {
  shareholderId: string;
  shareholderName: string;
  shareholderType: string;
  email: string | null;
  shareClass: string;
  shareClassCode: string;
  shareCount: number;
  totalCapital: number;
  registerDate: string;
}

interface ShareholdersPerProject {
  projectId: string;
  projectName: string;
  projectType: string;
  totalShareholders: number;
  totalShares: number;
  totalCapital: number;
  shareholders: ShareholderEntry[];
}

export function ShareholdersPerProjectPreview() {
  const t = useTranslations('reports');
  const tp = useTranslations('admin.projects');
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [data, setData] = useState<ShareholdersPerProject | null>(null);
  const [loading, setLoading] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);

  // Load project list on mount
  useEffect(() => {
    if (!selectedCoop) return;
    api<Project[] | { data: Project[] }>(`/admin/coops/${selectedCoop.id}/projects`)
      .then((res) => {
        const list = Array.isArray(res) ? res : res.data ?? [];
        setProjects(list);
        if (list.length > 0) setSelectedProjectId(list[0].id);
      })
      .catch(() => setProjects([]));
  }, [selectedCoop?.id]);

  // Fetch shareholders when project selection changes
  useEffect(() => {
    if (!selectedCoop || !selectedProjectId) return;
    setLoading(true);
    setData(null);
    api<ShareholdersPerProject>(
      `/admin/coops/${selectedCoop.id}/reports/shareholders-per-project?projectId=${selectedProjectId}`,
    )
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [selectedCoop?.id, selectedProjectId]);

  const typeLabel = (type: string) => {
    const map: Record<string, string> = {
      INDIVIDUAL: t('shareholderTypes.individual'),
      COMPANY: t('shareholderTypes.company'),
      MINOR: t('shareholderTypes.minor'),
    };
    return map[type] || type;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          {projects.length > 0 && (
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="min-w-[200px] max-w-xs">
                <SelectValue placeholder={t('shareholdersPerProject.selectProject')} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <ExportButtons
          reportType="shareholders-per-project"
          params={selectedProjectId ? { projectId: selectedProjectId } : {}}
          disabled={!data || !selectedProjectId}
        />
      </div>

      {projects.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('shareholdersPerProject.noProjects')}</p>
      )}

      {loading && (
        <p className="text-sm text-muted-foreground">{t('generating')}</p>
      )}

      {data && !loading && (
        data.shareholders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('shareholdersPerProject.noShareholders')}</p>
        ) : (
          <div className="space-y-3">
            {/* Summary row */}
            <div className="flex gap-6 text-sm text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{data.totalShareholders}</span>{' '}
                {t('shareholdersPerProject.shareholders').toLowerCase()}
              </span>
              <span>
                <span className="font-medium text-foreground">{data.totalShares}</span>{' '}
                {t('shareholdersPerProject.shares').toLowerCase()}
              </span>
              <span>
                <span className="font-medium text-foreground">
                  {formatCurrency(data.totalCapital, locale)}
                </span>{' '}
                {t('shareholdersPerProject.capital').toLowerCase()}
              </span>
            </div>

            {/* Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">
                  {t('shareholdersPerProject.details')}
                </h3>
                <CopyTableButton tableRef={tableRef} />
              </div>
              <div className="border rounded-md overflow-auto">
                <table ref={tableRef} className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">
                        {t('shareholdersPerProject.shareholder')}
                      </th>
                      <th className="text-left px-3 py-2 font-medium">
                        {t('shareholdersPerProject.type')}
                      </th>
                      <th className="text-left px-3 py-2 font-medium">
                        {t('shareholdersPerProject.shareClass')}
                      </th>
                      <th className="text-right px-3 py-2 font-medium">
                        {t('shareholdersPerProject.shares')}
                      </th>
                      <th className="text-right px-3 py-2 font-medium">
                        {t('shareholdersPerProject.capital')}
                      </th>
                      <th className="text-left px-3 py-2 font-medium">
                        {t('shareholdersPerProject.registerDate')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.shareholders.map((s, i) => (
                      <tr key={`${s.shareholderId}-${s.shareClassCode}-${i}`} className="border-t">
                        <td className="px-3 py-2 font-medium">{s.shareholderName}</td>
                        <td className="px-3 py-2 text-muted-foreground">{typeLabel(s.shareholderType)}</td>
                        <td className="px-3 py-2">{s.shareClass}</td>
                        <td className="px-3 py-2 text-right">{s.shareCount}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(s.totalCapital, locale)}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(s.registerDate).toLocaleDateString(locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/50 font-medium">
                    <tr className="border-t">
                      <td className="px-3 py-2" colSpan={3}>
                        {t('common.total')}
                      </td>
                      <td className="px-3 py-2 text-right">{data.totalShares}</td>
                      <td className="px-3 py-2 text-right">
                        {formatCurrency(data.totalCapital, locale)}
                      </td>
                      <td className="px-3 py-2" />
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
