'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Line,
  ComposedChart,
} from 'recharts';

interface DataPoint {
  date: string;
  individual: number;
  company: number;
  minor: number;
  exits: number;
  negExits?: number;
  cumulative: number;
}

type Period = 'month' | 'quarter' | 'year' | 'all';

interface Props {
  period: Period;
}

export function ShareholderGrowthChart({ period }: Props) {
  const t = useTranslations('analytics');
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedCoop) return;
    setLoading(true);
    api<DataPoint[]>(`/admin/coops/${selectedCoop.id}/analytics/shareholder-growth?period=${period}`)
      .then((points) => setData(points.map((p) => ({ ...p, negExits: p.exits > 0 ? -p.exits : 0 }))))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [selectedCoop, period]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    if (period === 'year') return d.getFullYear().toString();
    if (period === 'quarter') {
      const q = Math.ceil((d.getMonth() + 1) / 3);
      return `Q${q} ${d.getFullYear()}`;
    }
    return d.toLocaleDateString(locale, { month: 'short', year: '2-digit' });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">{t('shareholderGrowth')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : data.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
            {t('noData')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
              />
              <YAxis
                yAxisId="left"
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                allowDecimals={false}
              />
              <Tooltip
                labelFormatter={(label) => formatDate(String(label))}
                formatter={(value: number | undefined) => [Math.abs(Number(value) || 0)]}
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                }}
              />
              <Legend
                formatter={(value) => <span className="text-xs">{value}</span>}
              />
              <Bar yAxisId="left" dataKey="individual" name={t('types.individual')} stackId="a" fill="hsl(221, 83%, 53%)" radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="company" name={t('types.company')} stackId="a" fill="hsl(142, 71%, 45%)" radius={[0, 0, 0, 0]} />
              <Bar yAxisId="left" dataKey="minor" name={t('types.minor')} stackId="a" fill="hsl(262, 83%, 58%)" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="negExits" name={t('types.exits')} fill="hsl(0, 84%, 60%)" radius={[0, 0, 4, 4]} />
              <Line yAxisId="right" type="monotone" dataKey="cumulative" name={t('cumulative')} stroke="hsl(25, 95%, 53%)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
