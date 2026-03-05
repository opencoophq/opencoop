'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface DataPoint {
  projectId: string | null;
  projectName: string;
  totalCapital: number;
  shareCount: number;
  percentage: number;
}

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

export function CapitalByProjectChart() {
  const t = useTranslations('analytics');
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedCoop) return;
    setLoading(true);
    api<DataPoint[]>(`/admin/coops/${selectedCoop.id}/analytics/capital-by-project`)
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [selectedCoop]);

  const totalCapital = data.reduce((sum, d) => sum + d.totalCapital, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">{t('capitalByProject')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : data.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
            {t('noData')}
          </div>
        ) : (
          <div>
            <div className="relative">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={1}
                    dataKey="totalCapital"
                    nameKey="projectName"
                  >
                    {data.map((_, index) => (
                      <Cell key={index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number | undefined) => formatCurrency(value ?? 0, locale)}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '6px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Center total */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ height: 220 }}>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">{t('total')}</p>
                  <p className="text-sm font-bold">{formatCurrency(totalCapital, locale)}</p>
                </div>
              </div>
            </div>
            {/* Legend below chart */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-2 px-2">
              {data.map((d, i) => (
                <div key={d.projectName} className="flex items-center gap-1">
                  <div
                    className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  />
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">{d.projectName}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
