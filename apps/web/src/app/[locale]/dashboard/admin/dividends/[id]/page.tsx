'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAdmin } from '@/contexts/admin-context';
import { ChevronLeft, Calculator, Check, Download } from 'lucide-react';

interface DividendPayout {
  id: string;
  shareholder: {
    id: string;
    firstName?: string;
    lastName?: string;
    companyName?: string;
    type: string;
  };
  shares: number;
  grossAmount: number;
  taxAmount: number;
  netAmount: number;
}

interface DividendPeriod {
  id: string;
  name: string;
  year: number;
  exDividendDate: string;
  paymentDate?: string;
  dividendRate: number;
  totalGross: number;
  totalTax: number;
  totalNet: number;
  status: 'DRAFT' | 'CALCULATED' | 'PAID';
  payouts: DividendPayout[];
}

export default function DividendDetailPage() {
  const t = useTranslations();
  const params = useParams();
  const dividendId = params.id as string;
  const { selectedAdminCoop, loading: adminLoading } = useAdmin();
  const [period, setPeriod] = useState<DividendPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedAdminCoop || !dividendId) {
      setLoading(false);
      return;
    }

    const fetchPeriod = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/admin/coops/${selectedAdminCoop.id}/dividends/${dividendId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          setPeriod(data);
        }
      } catch {
        setError(t('common.error'));
      } finally {
        setLoading(false);
      }
    };

    fetchPeriod();
  }, [selectedAdminCoop, dividendId, t]);

  const handleCalculate = async () => {
    if (!selectedAdminCoop || !period) return;

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/coops/${selectedAdminCoop.id}/dividends/${period.id}/calculate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setPeriod(data);
        setSuccess(t('common.success'));
      } else {
        throw new Error('Calculation failed');
      }
    } catch {
      setError(t('common.error'));
    }
  };

  const handleMarkPaid = async () => {
    if (!selectedAdminCoop || !period || !confirm(t('admin.dividendDetail.confirmMarkPaid')))
      return;

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/coops/${selectedAdminCoop.id}/dividends/${period.id}/mark-paid`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setPeriod(data);
        setSuccess(t('common.success'));
      } else {
        throw new Error('Mark paid failed');
      }
    } catch {
      setError(t('common.error'));
    }
  };

  const handleExport = async () => {
    if (!selectedAdminCoop || !period) return;

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/coops/${selectedAdminCoop.id}/dividends/${period.id}/export`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dividends-${period.name}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch {
      setError(t('common.error'));
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('nl-BE');
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(amount);
  };

  const getShareholderName = (shareholder: DividendPayout['shareholder']) => {
    if (shareholder.type === 'COMPANY') {
      return shareholder.companyName || '-';
    }
    return `${shareholder.firstName || ''} ${shareholder.lastName || ''}`.trim() || '-';
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'PAID':
        return 'default';
      case 'CALCULATED':
        return 'secondary';
      case 'DRAFT':
        return 'outline';
      default:
        return 'default';
    }
  };

  if (adminLoading || loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  if (!selectedAdminCoop) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t('admin.selectCoop')}</p>
      </div>
    );
  }

  if (!period) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{t('errors.notFound')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard/admin/dividends">
              <ChevronLeft className="h-4 w-4 mr-1" />
              {t('common.back')}
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{period.name}</h1>
            <p className="text-muted-foreground">
              {period.year} - {formatDate(period.exDividendDate)}
            </p>
          </div>
        </div>
        <Badge variant={getStatusBadgeVariant(period.status)}>
          {t(`admin.dividends.${period.status.toLowerCase()}`)}
        </Badge>
      </div>

      {success && (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.dividendDetail.summary')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm text-muted-foreground">{t('admin.dividends.dividendRate')}</p>
              <p className="text-2xl font-bold">{(period.dividendRate * 100).toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('admin.dividends.totalGross')}</p>
              <p className="text-2xl font-bold">{formatCurrency(period.totalGross)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('admin.dividends.totalTax')}</p>
              <p className="text-2xl font-bold">{formatCurrency(period.totalTax)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('admin.dividends.totalNet')}</p>
              <p className="text-2xl font-bold">{formatCurrency(period.totalNet)}</p>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            {period.status === 'DRAFT' && (
              <Button onClick={handleCalculate}>
                <Calculator className="h-4 w-4 mr-2" />
                {t('admin.dividends.calculate')}
              </Button>
            )}
            {period.status === 'CALCULATED' && (
              <>
                <Button variant="outline" onClick={handleCalculate}>
                  <Calculator className="h-4 w-4 mr-2" />
                  {t('admin.dividends.recalculate')}
                </Button>
                <Button onClick={handleMarkPaid}>
                  <Check className="h-4 w-4 mr-2" />
                  {t('admin.dividends.markAsPaid')}
                </Button>
              </>
            )}
            {period.payouts && period.payouts.length > 0 && (
              <Button variant="outline" onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                {t('admin.dividendDetail.exportPayouts')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Payouts Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.dividendDetail.payouts')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!period.payouts || period.payouts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {period.status === 'DRAFT'
                ? t('admin.dividends.calculate')
                : t('common.noResults')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.dividendDetail.shareholderName')}</TableHead>
                  <TableHead className="text-right">{t('admin.dividendDetail.shares')}</TableHead>
                  <TableHead className="text-right">{t('admin.dividendDetail.grossAmount')}</TableHead>
                  <TableHead className="text-right">{t('admin.dividendDetail.taxAmount')}</TableHead>
                  <TableHead className="text-right">{t('admin.dividendDetail.netAmount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {period.payouts.map((payout) => (
                  <TableRow key={payout.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/dashboard/admin/shareholders/${payout.shareholder.id}`}
                        className="hover:underline"
                      >
                        {getShareholderName(payout.shareholder)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">{payout.shares}</TableCell>
                    <TableCell className="text-right">{formatCurrency(payout.grossAmount)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(payout.taxAmount)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(payout.netAmount)}
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
