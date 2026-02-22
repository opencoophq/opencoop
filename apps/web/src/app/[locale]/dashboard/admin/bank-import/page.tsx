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
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { Upload, Link2 } from 'lucide-react';

interface MatchedShareholder {
  firstName?: string;
  lastName?: string;
}

interface MatchedTransaction {
  shareholder?: MatchedShareholder;
}

interface MatchedPayment {
  transaction?: MatchedTransaction;
}

interface BankTx {
  id: string;
  date: string;
  amount: number;
  counterparty: string | null;
  ogmCode: string | null;
  referenceText: string | null;
  matchStatus: string;
  matchedPayment?: MatchedPayment | null;
}

export default function BankImportPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [transactions, setTransactions] = useState<BankTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const loadData = useCallback(async () => {
    if (!selectedCoop) return;
    setLoading(true);
    try {
      const data = await api<BankTx[]>(`/admin/coops/${selectedCoop.id}/bank-transactions`);
      setTransactions(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedCoop]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCoop) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const token = localStorage.getItem('accessToken');
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/admin/coops/${selectedCoop.id}/bank-import`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        },
      );
      loadData();
    } catch {
      // ignore
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (!selectedCoop) return <p className="text-muted-foreground">{t('admin.selectCoop')}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('admin.bankImport.title')}</h1>
        <div>
          <Input
            type="file"
            accept=".csv"
            onChange={handleUpload}
            className="hidden"
            id="csv-upload"
          />
          <Button asChild disabled={uploading}>
            <label htmlFor="csv-upload" className="cursor-pointer">
              <Upload className="h-4 w-4 mr-2" />
              {uploading ? t('common.loading') : t('admin.bankImport.upload')}
            </label>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
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
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead className="text-right">{t('common.amount')}</TableHead>
                  <TableHead>{t('admin.bankImport.counterparty')}</TableHead>
                  <TableHead>{t('payments.ogmCode')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('admin.bankImport.matchedTo')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => {
                  const shareholder = tx.matchedPayment?.transaction?.shareholder;
                  const matchedName = shareholder
                    ? `${shareholder.firstName || ''} ${shareholder.lastName || ''}`.trim()
                    : null;

                  return (
                    <TableRow key={tx.id}>
                      <TableCell>{new Date(tx.date).toLocaleDateString(locale)}</TableCell>
                      <TableCell className="text-right">
                        &euro; {Number(tx.amount).toFixed(2)}
                      </TableCell>
                      <TableCell>{tx.counterparty || '-'}</TableCell>
                      <TableCell className="font-mono text-sm">{tx.ogmCode || '-'}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            tx.matchStatus === 'UNMATCHED'
                              ? 'destructive'
                              : tx.matchStatus === 'AUTO_MATCHED'
                                ? 'default'
                                : 'secondary'
                          }
                        >
                          {tx.matchStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {matchedName ? (
                          matchedName
                        ) : tx.matchStatus === 'UNMATCHED' ? (
                          <Button variant="ghost" size="sm">
                            <Link2 className="h-4 w-4 mr-1" />
                            {t('admin.bankImport.match')}
                          </Button>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
