'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { FileText, ArrowLeftRight, Coins, TrendingUp } from 'lucide-react';

export default function DashboardPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const [stats, setStats] = useState({
    totalShares: 0,
    totalValue: 0,
    pendingTransactions: 0,
    totalDividends: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const profile = await api<{
          shareholderCoops: Array<{ id: string }>;
          shareholders: Array<{
            id: string;
            shares: Array<{ quantity: number; purchasePricePerShare: number; status: string }>;
          }>;
        }>('/auth/me');

        let totalShares = 0;
        let totalValue = 0;

        if (profile.shareholders) {
          for (const sh of profile.shareholders) {
            if (sh.shares) {
              for (const share of sh.shares) {
                if (share.status === 'ACTIVE') {
                  totalShares += share.quantity;
                  totalValue += share.quantity * Number(share.purchasePricePerShare);
                }
              }
            }
          }
        }

        setStats({
          totalShares,
          totalValue,
          pendingTransactions: 0,
          totalDividends: 0,
        });
      } catch {
        // Silently fail - user will see zeros
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const cards = [
    {
      title: t('shares.title'),
      value: stats.totalShares.toString(),
      icon: <FileText className="h-5 w-5 text-blue-600" />,
    },
    {
      title: t('shares.totalValue'),
      value: formatCurrency(stats.totalValue, locale),
      icon: <TrendingUp className="h-5 w-5 text-green-600" />,
    },
    {
      title: t('transactions.pending'),
      value: stats.pendingTransactions.toString(),
      icon: <ArrowLeftRight className="h-5 w-5 text-orange-600" />,
    },
    {
      title: t('dividends.title'),
      value: formatCurrency(stats.totalDividends, locale),
      icon: <Coins className="h-5 w-5 text-purple-600" />,
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('common.overview')}</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
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
