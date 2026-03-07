'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { Users, TrendingUp, ArrowLeftRight, UserCheck } from 'lucide-react';
import { CapitalTimelineChart } from '@/components/charts/capital-timeline-chart';
import { CapitalByProjectChart } from '@/components/charts/capital-by-project-chart';
import { ShareholderGrowthChart } from '@/components/charts/shareholder-growth-chart';
import { TransactionActivityChart } from '@/components/charts/transaction-activity-chart';

export type Period = 'month' | 'quarter' | 'year' | 'all';

interface Stats {
  totalShareholders: number;
  activeShareholders: number;
  totalCapital: number;
  pendingRegistrations: number;
}

export default function AdminPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('month');

  useEffect(() => {
    if (!selectedCoop) return;
    setLoading(true);
    api<Stats>(`/admin/coops/${selectedCoop.id}/stats`)
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedCoop]);

  if (!selectedCoop) {
    return <p className="text-muted-foreground">{t('admin.selectCoop')}</p>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const cards = stats
    ? [
        {
          title: t('admin.shareholders.total'),
          value: stats.totalShareholders,
          icon: <Users className="h-5 w-5 text-blue-600" />,
        },
        {
          title: t('admin.shareholders.active'),
          value: stats.activeShareholders,
          icon: <UserCheck className="h-5 w-5 text-green-600" />,
        },
        {
          title: t('admin.totalCapital'),
          value: formatCurrency(stats.totalCapital, locale),
          icon: <TrendingUp className="h-5 w-5 text-emerald-600" />,
        },
        {
          title: t('transactions.pending'),
          value: stats.pendingRegistrations,
          icon: <ArrowLeftRight className="h-5 w-5 text-orange-600" />,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">
        {selectedCoop.name} - {t('common.overview')}
      </h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              {card.icon}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('analytics.charts')}</h2>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList className="h-8">
            <TabsTrigger value="month" className="text-xs px-2 py-1">{t('analytics.periods.month')}</TabsTrigger>
            <TabsTrigger value="quarter" className="text-xs px-2 py-1">{t('analytics.periods.quarter')}</TabsTrigger>
            <TabsTrigger value="year" className="text-xs px-2 py-1">{t('analytics.periods.year')}</TabsTrigger>
            <TabsTrigger value="all" className="text-xs px-2 py-1">{t('analytics.periods.all')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CapitalTimelineChart period={period} />
        <CapitalByProjectChart />
        <ShareholderGrowthChart period={period} />
        <TransactionActivityChart period={period} />
      </div>
    </div>
  );
}
