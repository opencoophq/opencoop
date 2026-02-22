'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

interface PayoutData {
  id: string;
  grossAmount: number;
  withholdingTax: number;
  netAmount: number;
  paidAt: string | null;
  dividendPeriod: {
    year: number;
    name: string | null;
    coop: { name: string };
  };
}

export default function DividendsPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const [payouts, setPayouts] = useState<PayoutData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const profile = await api<{ shareholders: Array<{ id: string; coopId: string; dividendPayouts: PayoutData[] }> }>('/auth/me');
        if (profile.shareholders?.[0]?.dividendPayouts) {
          setPayouts(profile.shareholders[0].dividendPayouts);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('dividends.title')}</h1>
      <Card>
        <CardContent className="pt-6">
          {payouts.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('common.noResults')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('dividends.period')}</TableHead>
                  <TableHead>{t('dividends.year')}</TableHead>
                  <TableHead className="text-right">{t('dividends.grossAmount')}</TableHead>
                  <TableHead className="text-right">{t('dividends.withholdingTax')}</TableHead>
                  <TableHead className="text-right">{t('dividends.netAmount')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((payout) => (
                  <TableRow key={payout.id}>
                    <TableCell className="font-medium">
                      {payout.dividendPeriod.name || `${payout.dividendPeriod.year}`}
                    </TableCell>
                    <TableCell>{payout.dividendPeriod.year}</TableCell>
                    <TableCell className="text-right">€ {Number(payout.grossAmount).toFixed(2)}</TableCell>
                    <TableCell className="text-right">€ {Number(payout.withholdingTax).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium">€ {Number(payout.netAmount).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={payout.paidAt ? 'default' : 'secondary'}>
                        {payout.paidAt ? t('dividends.paid') : t('dividends.pending')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
