'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale as useIntlLocale } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import {
  Users,
  FileText,
  TrendingUp,
  ArrowLeftRight,
  CreditCard,
  UserCheck,
  Link2,
  Copy,
  Check,
} from 'lucide-react';
import { CapitalTimelineChart } from '@/components/charts/capital-timeline-chart';
import { CapitalByProjectChart } from '@/components/charts/capital-by-project-chart';
import { ShareholderGrowthChart } from '@/components/charts/shareholder-growth-chart';
import { TransactionActivityChart } from '@/components/charts/transaction-activity-chart';

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
  const { locale } = useLocale();
  const intlLocale = useIntlLocale();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

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
          value: formatCurrency(stats.totalCapital, locale),
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

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const coopBasePath = `${baseUrl}/${intlLocale}/${selectedCoop.slug}`;

  const shareholderLinks = [
    { key: 'publicPage', url: coopBasePath },
    { key: 'registrationLink', url: `${coopBasePath}/register` },
    { key: 'loginLink', url: `${coopBasePath}/login` },
  ];

  const handleCopy = async (key: string, url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedLink(key);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">
        {selectedCoop.name} - {t('common.overview')}
      </h1>

      {/* Shareholder Links */}
      <Card>
        <CardHeader className="flex flex-row items-center space-y-0 pb-3">
          <Link2 className="h-5 w-5 text-muted-foreground mr-2" />
          <CardTitle className="text-base font-medium">
            {t('admin.shareholderLinks')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {shareholderLinks.map(({ key, url }) => (
            <div
              key={key}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{t(`admin.${key}`)}</p>
                <p className="text-xs text-muted-foreground truncate">{url}</p>
              </div>
              <button
                onClick={() => handleCopy(key, url)}
                className="shrink-0 rounded-md p-1.5 hover:bg-muted transition-colors"
                title={copiedLink === key ? t('admin.copied') : 'Copy'}
              >
                {copiedLink === key ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </div>
          ))}
        </CardContent>
      </Card>

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

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CapitalTimelineChart />
        <CapitalByProjectChart />
        <ShareholderGrowthChart />
        <TransactionActivityChart />
      </div>
    </div>
  );
}
