'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

interface ShareData {
  id: string;
  quantity: number;
  purchasePricePerShare: number;
  purchaseDate: string;
  status: string;
  shareClass: { name: string; code: string };
  project?: { name: string } | null;
}

export default function SharesPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const [shares, setShares] = useState<ShareData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadShares() {
      try {
        const profile = await api<{ shareholders: Array<{ id: string; coopId: string }> }>('/auth/me');
        if (profile.shareholders?.[0]) {
          const sh = profile.shareholders[0];
          const data = await api<ShareData[]>(
            `/admin/coops/${sh.coopId}/shareholders/${sh.id}`,
          ).then((res: any) => res.shares || []);
          setShares(data);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadShares();
  }, []);

  const statusVariant = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'default';
      case 'PENDING': return 'secondary';
      case 'SOLD': return 'destructive';
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
      <h1 className="text-2xl font-bold mb-6">{t('shares.title')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('shares.myShares')}</CardTitle>
        </CardHeader>
        <CardContent>
          {shares.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('common.noResults')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('shares.shareClass')}</TableHead>
                  <TableHead>{t('shares.project')}</TableHead>
                  <TableHead className="text-right">{t('shares.quantity')}</TableHead>
                  <TableHead className="text-right">{t('shares.pricePerShare')}</TableHead>
                  <TableHead className="text-right">{t('shares.totalValue')}</TableHead>
                  <TableHead>{t('shares.purchaseDate')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shares.map((share) => (
                  <TableRow key={share.id}>
                    <TableCell className="font-medium">
                      {share.shareClass.name} ({share.shareClass.code})
                    </TableCell>
                    <TableCell>{share.project?.name || '-'}</TableCell>
                    <TableCell className="text-right">{share.quantity}</TableCell>
                    <TableCell className="text-right">
                      € {Number(share.purchasePricePerShare).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      € {(share.quantity * Number(share.purchasePricePerShare)).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      {new Date(share.purchaseDate).toLocaleDateString(locale)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(share.status)}>{share.status}</Badge>
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
