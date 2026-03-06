'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ExportButtons } from './export-buttons';
import { ChartActionBar } from '@/components/charts/chart-action-bar';
import { CopyTableButton } from './copy-table-button';
import { ChevronDown, Search } from 'lucide-react';

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
  const tp = useTranslations('admin.projects');
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [data, setData] = useState<ProjectInvestment | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState('');
  const chartRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    if (!selectedCoop) return;
    setLoading(true);
    setSelectedIds(null);
    api<ProjectInvestment>(`/admin/coops/${selectedCoop.id}/reports/project-investment`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [selectedCoop?.id]);

  // When search changes, auto-select matching projects
  useEffect(() => {
    if (!data || !search) return;
    const matching = new Set(
      data.projects
        .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
        .map((p) => p.id),
    );
    if (matching.size > 0) {
      setSelectedIds(matching);
    }
  }, [search]);

  const allProjects = data?.projects ?? [];
  const filteredProjects =
    selectedIds === null
      ? allProjects
      : allProjects.filter((p) => selectedIds.has(p.id));
  const totalCapital = filteredProjects.reduce((sum, p) => sum + p.totalCapital, 0);

  const toggleProject = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev ?? allProjects.map((p) => p.id));
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => setSelectedIds(null);

  const filterLabel = () => {
    if (selectedIds === null || selectedIds.size === allProjects.length) {
      return t('projectInvestment.allProjects');
    }
    if (selectedIds.size === 0) return t('projectInvestment.noSelection');
    if (selectedIds.size === 1) {
      return allProjects.find((p) => selectedIds.has(p.id))?.name ?? '';
    }
    return t('projectInvestment.nSelected', { count: selectedIds.size });
  };

  // Projects visible in the dropdown (filtered by search text)
  const dropdownProjects = allProjects.filter(
    (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {allProjects.length > 1 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="justify-between min-w-[200px] max-w-xs">
                <span className="truncate">{filterLabel()}</span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start">
              <div className="p-2 border-b">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t('projectInvestment.searchPlaceholder')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-9"
                  />
                </div>
              </div>
              <div className="p-1 border-b">
                <button
                  className="w-full text-left px-2 py-1 text-xs text-primary hover:underline"
                  onClick={() => { selectAll(); setSearch(''); }}
                >
                  {t('projectInvestment.selectAll')}
                </button>
              </div>
              <div className="max-h-[240px] overflow-auto p-1">
                {dropdownProjects.map((p) => {
                  const checked = selectedIds === null || selectedIds.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-accent cursor-pointer"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleProject(p.id)}
                      />
                      <span className="text-sm truncate">{p.name}</span>
                    </label>
                  );
                })}
                {dropdownProjects.length === 0 && (
                  <p className="text-sm text-muted-foreground px-2 py-4 text-center">
                    {t('projectInvestment.noProjects')}
                  </p>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
        <ExportButtons
          reportType="project-investment"
          params={selectedIds !== null ? { projectIds: [...selectedIds].join(',') } : {}}
          disabled={!data}
          pdfSupported
        />
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">{t('generating')}</p>
      )}

      {data && !loading && (
        filteredProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('projectInvestment.noProjects')}</p>
        ) : (
          <div className="space-y-4">
            {/* Donut chart */}
            {filteredProjects.length > 1 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold">{t('projectInvestment.distribution')}</h3>
                  <ChartActionBar chartRef={chartRef} filename="project-investment" />
                </div>
                <div ref={chartRef} className="flex items-center gap-6">
                  {/* Legend on the left */}
                  <div className="flex flex-col gap-1.5 min-w-[180px]">
                    {filteredProjects.map((p, i) => (
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
                          data={filteredProjects}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={95}
                          paddingAngle={1}
                          dataKey="totalCapital"
                          nameKey="name"
                        >
                          {filteredProjects.map((_, i) => (
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
                    {filteredProjects.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="px-3 py-2 font-medium">{p.name}</td>
                        <td className="px-3 py-2">{tp(p.type.toLowerCase())}</td>
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
