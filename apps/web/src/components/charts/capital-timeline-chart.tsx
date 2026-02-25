'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface DataPoint {
  date: string;
  totalCapital: number;
  netChange: number;
}

type Period = 'month' | 'quarter' | 'year' | 'all';

export function CapitalTimelineChart() {
  const t = useTranslations('analytics');
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('month');

  useEffect(() => {
    if (!selectedCoop) return;
    setLoading(true);
    api<DataPoint[]>(`/admin/coops/${selectedCoop.id}/analytics/capital-timeline?period=${period}`)
      .then(setData)
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
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-semibold">{t('capitalTimeline')}</CardTitle>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList className="h-8">
            <TabsTrigger value="month" className="text-xs px-2 py-1">{t('periods.month')}</TabsTrigger>
            <TabsTrigger value="quarter" className="text-xs px-2 py-1">{t('periods.quarter')}</TabsTrigger>
            <TabsTrigger value="year" className="text-xs px-2 py-1">{t('periods.year')}</TabsTrigger>
            <TabsTrigger value="all" className="text-xs px-2 py-1">{t('periods.all')}</TabsTrigger>
          </TabsList>
        </Tabs>
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
            <AreaChart data={data}>
              <defs>
                <linearGradient id="capitalGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
              />
              <YAxis
                tickFormatter={(v) => formatCurrency(v, locale).replace(/,00$/, '')}
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                width={80}
              />
              <Tooltip
                formatter={(value: number | undefined) => [formatCurrency(value ?? 0, locale), t('totalCapital')]}
                labelFormatter={(label) => formatDate(String(label))}
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                }}
              />
              <Area
                type="monotone"
                dataKey="totalCapital"
                stroke="hsl(var(--primary))"
                fill="url(#capitalGradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
