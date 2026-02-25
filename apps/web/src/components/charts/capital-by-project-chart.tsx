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
  'hsl(221, 83%, 53%)',  // blue-600
  'hsl(142, 71%, 45%)',  // green-600
  'hsl(262, 83%, 58%)',  // violet-500
  'hsl(25, 95%, 53%)',   // orange-500
  'hsl(350, 89%, 60%)',  // rose-500
  'hsl(174, 72%, 40%)',  // teal-600
  'hsl(47, 96%, 53%)',   // yellow-400
  'hsl(280, 67%, 51%)',  // purple-600
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
          <div className="relative">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
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
                <Legend
                  formatter={(value) => <span className="text-xs text-foreground">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center total */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ marginBottom: 40 }}>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">{t('total')}</p>
                <p className="text-sm font-bold">{formatCurrency(totalCapital, locale)}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
