'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { Users, FileText, TrendingUp, ArrowLeftRight, CreditCard, UserCheck } from 'lucide-react';

interface Stats {
  totalShareholders: number;
  activeShareholders: number;
  totalShares: number;
  totalCapital: number;
  pendingTransactions: number;
  pendingPayments: number;
}

export default function AdminPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

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
          title: t('shares.totalShares'),
          value: stats.totalShares,
          icon: <FileText className="h-5 w-5 text-indigo-600" />,
        },
        {
          title: t('admin.totalCapital'),
          value: `€ ${stats.totalCapital.toFixed(2)}`,
          icon: <TrendingUp className="h-5 w-5 text-emerald-600" />,
        },
        {
          title: t('transactions.pending'),
          value: stats.pendingTransactions,
          icon: <ArrowLeftRight className="h-5 w-5 text-orange-600" />,
        },
        {
          title: t('payments.pending'),
          value: stats.pendingPayments,
          icon: <CreditCard className="h-5 w-5 text-red-600" />,
        },
      ]
    : [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">
        {selectedCoop.name} - {t('common.overview')}
      </h1>
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
    </div>
  );
}
