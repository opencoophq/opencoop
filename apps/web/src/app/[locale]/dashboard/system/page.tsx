'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { Building2, Users, UserCheck, TrendingUp } from 'lucide-react';

interface SystemStats {
  totalCoops: number;
  activeCoops: number;
  totalUsers: number;
  totalShareholders: number;
  totalCapital: number;
}

export default function SystemPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<SystemStats>('/system/stats')
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const cards = stats ? [
    { title: t('system.coops.total'), value: stats.totalCoops, icon: <Building2 className="h-5 w-5 text-blue-600" /> },
    { title: t('system.users.total'), value: stats.totalUsers, icon: <Users className="h-5 w-5 text-indigo-600" /> },
    { title: t('system.shareholders.total'), value: stats.totalShareholders, icon: <UserCheck className="h-5 w-5 text-green-600" /> },
    { title: t('admin.totalCapital'), value: formatCurrency(stats.totalCapital, locale), icon: <TrendingUp className="h-5 w-5 text-emerald-600" /> },
  ] : [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('system.title')}</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
    </div>
  );
}
