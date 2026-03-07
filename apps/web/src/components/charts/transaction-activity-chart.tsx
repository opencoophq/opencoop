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
} from 'recharts';

interface DataPoint {
  date: string;
  buys: number;
  sells: number;
  volume: number;
}

interface SummaryResult {
  timeline: DataPoint[];
  totals: {
    buys: number;
    sells: number;
    volume: number;
  };
}

type Period = 'month' | 'quarter' | 'year' | 'all';

interface Props {
  period: Period;
}

export function TransactionActivityChart({ period }: Props) {
  const t = useTranslations('analytics');
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [data, setData] = useState<SummaryResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedCoop) return;
    setLoading(true);
    api<SummaryResult>(`/admin/coops/${selectedCoop.id}/analytics/transaction-summary?period=${period}`)
      .then(setData)
      .catch(() => setData(null))
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

  const timeline = data?.timeline ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">{t('transactionActivity')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : timeline.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
            {t('noData')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
              />
              <YAxis
                className="text-xs"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                allowDecimals={false}
              />
              <Tooltip
                labelFormatter={(label) => formatDate(String(label))}
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                }}
              />
              <Legend
                formatter={(value) => <span className="text-xs">{value}</span>}
              />
              <Bar dataKey="buys" name={t('transactionTypes.buys')} fill="hsl(142, 71%, 45%)" radius={[0, 0, 0, 0]} />
              <Bar dataKey="sells" name={t('transactionTypes.sells')} fill="hsl(350, 89%, 60%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
