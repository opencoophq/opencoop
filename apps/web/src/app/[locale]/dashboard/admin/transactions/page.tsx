'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { Check, X } from 'lucide-react';

interface TransactionRow {
  id: string;
  type: string;
  status: string;
  quantity: number;
  pricePerShare: number;
  totalAmount: number;
  createdAt: string;
  shareholder: {
    firstName?: string;
    lastName?: string;
    companyName?: string;
    type: string;
  };
}

export default function AdminTransactionsPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  const loadData = useCallback(async () => {
    if (!selectedCoop) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    try {
      const result = await api<{ items: TransactionRow[] }>(
        `/admin/coops/${selectedCoop.id}/transactions?${params}`,
      );
      setTransactions(result.items || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApprove = async (id: string) => {
    if (!selectedCoop) return;
    await api(`/admin/coops/${selectedCoop.id}/transactions/${id}/approve`, { method: 'PUT' });
    loadData();
  };

  const handleReject = async (id: string) => {
    if (!selectedCoop) return;
    const reason = prompt(t('transactions.rejectReason'));
    if (!reason) return;
    await api(`/admin/coops/${selectedCoop.id}/transactions/${id}/reject`, {
      method: 'PUT',
      body: { reason },
    });
    loadData();
  };

  const getName = (sh: TransactionRow['shareholder']) =>
    sh.type === 'COMPANY'
      ? sh.companyName || ''
      : `${sh.firstName || ''} ${sh.lastName || ''}`.trim();

  if (!selectedCoop) return <p className="text-muted-foreground">{t('admin.selectCoop')}</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('transactions.title')}</h1>
      <Card>
        <CardContent className="pt-6">
          <div className="mb-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t('common.status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="PENDING">{t('transactions.statuses.PENDING')}</SelectItem>
                <SelectItem value="APPROVED">{t('transactions.statuses.APPROVED')}</SelectItem>
                <SelectItem value="COMPLETED">{t('transactions.statuses.COMPLETED')}</SelectItem>
                <SelectItem value="REJECTED">{t('transactions.statuses.REJECTED')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : transactions.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('common.noResults')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.shareholders.shareholder')}</TableHead>
                  <TableHead>{t('transactions.type')}</TableHead>
                  <TableHead className="text-right">{t('shares.quantity')}</TableHead>
                  <TableHead className="text-right">{t('common.amount')}</TableHead>
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="font-medium">{getName(tx.shareholder)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{t(`transactions.types.${tx.type}`)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{tx.quantity}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(Number(tx.totalAmount), locale)}
                    </TableCell>
                    <TableCell>{new Date(tx.createdAt).toLocaleDateString(locale)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          tx.status === 'COMPLETED'
                            ? 'default'
                            : tx.status === 'PENDING'
                              ? 'secondary'
                              : tx.status === 'REJECTED'
                                ? 'destructive'
                                : 'outline'
                        }
                      >
                        {t(`transactions.statuses.${tx.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {tx.status === 'PENDING' && (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleApprove(tx.id)}>
                            <Check className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleReject(tx.id)}>
                            <X className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
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
