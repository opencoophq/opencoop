'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { FileText, ArrowLeftRight, Coins, TrendingUp } from 'lucide-react';
import { ReferralCard } from '@/components/referral-card';

export default function DashboardPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const router = useRouter();
  const [stats, setStats] = useState({
    totalShares: 0,
    totalValue: 0,
    pendingRegistrations: 0,
    totalDividends: 0,
  });
  const [loading, setLoading] = useState(true);
  const [shareholderId, setShareholderId] = useState<string | null>(null);
  const [coopName, setCoopName] = useState<string | undefined>(undefined);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      try {
        const parsed = JSON.parse(userData);
        if (parsed.role === 'SYSTEM_ADMIN') {
          router.replace('/dashboard/system');
          return;
        }
        if (parsed.role === 'COOP_ADMIN') {
          router.replace('/dashboard/admin');
          return;
        }
      } catch {
        // continue as shareholder
      }
    }
  }, [router]);

  useEffect(() => {
    async function loadData() {
      try {
        const profile = await api<{
          shareholderCoops: Array<{ id: string }>;
          shareholders: Array<{
            id: string;
            coop?: { name?: string };
            registrations: Array<{ sharesOwned: number; quantity: number; pricePerShare: number; status: string }>;
          }>;
          minorShareholders?: Array<{
            id: string;
            registrations: Array<{ sharesOwned: number; quantity: number; pricePerShare: number; status: string }>;
          }>;
        }>('/auth/me');

        let totalShares = 0;
        let totalValue = 0;

        if (profile.shareholders) {
          if (profile.shareholders[0]) {
            setShareholderId(profile.shareholders[0].id);
            setCoopName(profile.shareholders[0].coop?.name);
          }
          for (const sh of profile.shareholders) {
            if (sh.registrations) {
              for (const reg of sh.registrations) {
                if (reg.status === 'ACTIVE' || reg.status === 'COMPLETED') {
                  const qty = reg.sharesOwned ?? reg.quantity;
                  totalShares += qty;
                  totalValue += qty * Number(reg.pricePerShare);
                }
              }
            }
          }
        }

        // Include minor shareholders in totals
        if (profile.minorShareholders) {
          for (const sh of profile.minorShareholders) {
            if (sh.registrations) {
              for (const reg of sh.registrations) {
                if (reg.status === 'ACTIVE' || reg.status === 'COMPLETED') {
                  const qty = reg.sharesOwned ?? reg.quantity;
                  totalShares += qty;
                  totalValue += qty * Number(reg.pricePerShare);
                }
              }
            }
          }
        }

        setStats({
          totalShares,
          totalValue,
          pendingRegistrations: 0,
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
      value: stats.pendingRegistrations.toString(),
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

      {/* Referral Card */}
      {shareholderId && (
        <div className="mt-6">
          <ReferralCard shareholderId={shareholderId} coopName={coopName} />
        </div>
      )}
    </div>
  );
}
