'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { FileText, Loader2 } from 'lucide-react';

interface PayoutData {
  id: string;
  grossAmount: number;
  withholdingTax: number;
  netAmount: number;
  paidAt: string | null;
  statementDocumentId: string | null;
  dividendPeriod: {
    id: string;
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
  const [shareholderId, setShareholderId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        const profile = await api<{ shareholders: Array<{ id: string; coopId: string; dividendPayouts: PayoutData[] }> }>('/auth/me');
        if (profile.shareholders?.[0]) {
          setShareholderId(profile.shareholders[0].id);
          setPayouts(profile.shareholders[0].dividendPayouts || []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleGenerateStatement = async (payout: PayoutData) => {
    if (!shareholderId) return;
    setGeneratingId(payout.id);
    try {
      await api(`/shareholders/${shareholderId}/generate-dividend-statement/${payout.id}`, {
        method: 'POST',
        body: { locale: locale.split('-')[0] },
      });
      // Update the payout to show it now has a statement
      setPayouts((prev) =>
        prev.map((p) =>
          p.id === payout.id ? { ...p, statementDocumentId: 'generated' } : p,
        ),
      );
    } catch {
      // ignore
    } finally {
      setGeneratingId(null);
    }
  };

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
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((payout) => (
                  <TableRow key={payout.id}>
                    <TableCell className="font-medium">
                      {payout.dividendPeriod.name || `${payout.dividendPeriod.year}`}
                    </TableCell>
                    <TableCell>{payout.dividendPeriod.year}</TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(payout.grossAmount), locale)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(payout.withholdingTax), locale)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(Number(payout.netAmount), locale)}</TableCell>
                    <TableCell>
                      <Badge variant={payout.paidAt ? 'default' : 'secondary'}>
                        {payout.paidAt ? t('dividends.paid') : t('dividends.pending')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {!payout.statementDocumentId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleGenerateStatement(payout)}
                          disabled={generatingId === payout.id}
                        >
                          {generatingId === payout.id ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <FileText className="h-4 w-4 mr-1" />
                          )}
                          {t('personalData.generateDividendStatement')}
                        </Button>
                      )}
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
