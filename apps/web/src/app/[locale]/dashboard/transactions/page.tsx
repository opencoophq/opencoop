'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

interface TransactionData {
  id: string;
  type: string;
  status: string;
  quantity: number;
  pricePerShare: number;
  totalAmount: number;
  createdAt: string;
}

export default function TransactionsPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const profile = await api<{ shareholders: Array<{ id: string; coopId: string }> }>('/auth/me');
        if (profile.shareholders?.[0]) {
          const sh = profile.shareholders[0];
          const data = await api<{ transactions: TransactionData[] }>(
            `/admin/coops/${sh.coopId}/shareholders/${sh.id}`,
          );
          setTransactions(data.transactions || []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const typeColor = (type: string) => {
    switch (type) {
      case 'PURCHASE': return 'default';
      case 'SALE': return 'destructive';
      case 'TRANSFER_IN': return 'secondary';
      case 'TRANSFER_OUT': return 'outline';
      default: return 'secondary';
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'default';
      case 'APPROVED': return 'default';
      case 'PENDING': return 'secondary';
      case 'REJECTED': return 'destructive';
      default: return 'outline';
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
      <h1 className="text-2xl font-bold mb-6">{t('transactions.title')}</h1>
      <Card>
        <CardContent className="pt-6">
          {transactions.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('common.noResults')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('transactions.type')}</TableHead>
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead className="text-right">{t('shares.quantity')}</TableHead>
                  <TableHead className="text-right">{t('common.amount')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      <Badge variant={typeColor(tx.type)}>{t(`transactions.types.${tx.type}`)}</Badge>
                    </TableCell>
                    <TableCell>{new Date(tx.createdAt).toLocaleDateString(locale)}</TableCell>
                    <TableCell className="text-right">{tx.quantity}</TableCell>
                    <TableCell className="text-right">€ {Number(tx.totalAmount).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={statusColor(tx.status)}>{tx.status}</Badge>
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
