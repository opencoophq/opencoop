'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from '@/i18n/routing';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { DatePicker } from '@/components/ui/date-picker';
import { formatCurrency } from '@opencoop/shared';
import { Plus, Eye, Calculator, Check } from 'lucide-react';

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
  createdAt: string;
}

const dividendPeriodSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  year: z.coerce.number().min(2000).max(2100),
  exDividendDate: z.string().min(1, 'Ex-dividend date is required'),
  paymentDate: z.string().optional(),
  dividendRate: z.coerce.number().min(0).max(100),
});

type DividendPeriodForm = z.infer<typeof dividendPeriodSchema>;

export default function DividendsListPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [periods, setPeriods] = useState<DividendPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const form = useForm<DividendPeriodForm>({
    resolver: zodResolver(dividendPeriodSchema),
    defaultValues: {
      name: '',
      year: new Date().getFullYear(),
      exDividendDate: '',
      paymentDate: '',
      dividendRate: 0,
    },
  });

  const fetchPeriods = useCallback(async () => {
    if (!selectedCoop) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/coops/${selectedCoop.id}/dividends`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        // Handle both array and paginated response
        setPeriods(Array.isArray(data) ? data : data.data || []);
      }
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  }, [selectedCoop]);

  useEffect(() => {
    fetchPeriods();
  }, [fetchPeriods]);

  const openCreateDialog = () => {
    form.reset({
      name: '',
      year: new Date().getFullYear(),
      exDividendDate: '',
      paymentDate: '',
      dividendRate: 0,
    });
    setDialogOpen(true);
  };

  const onSubmit = async (data: DividendPeriodForm) => {
    if (!selectedCoop) return;

    setSaving(true);
    setError(null);

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/coops/${selectedCoop.id}/dividends`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            ...data,
            paymentDate: data.paymentDate || undefined,
          }),
        }
      );

      if (response.ok) {
        setSuccess(t('common.success'));
        setDialogOpen(false);
        fetchPeriods();
      } else {
        throw new Error('Failed to create');
      }
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleCalculate = async (period: DividendPeriod) => {
    if (!selectedCoop) return;

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/coops/${selectedCoop.id}/dividends/${period.id}/calculate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        setSuccess(t('common.success'));
        fetchPeriods();
      } else {
        throw new Error('Calculation failed');
      }
    } catch {
      setError(t('common.error'));
    }
  };

  const handleMarkPaid = async (period: DividendPeriod) => {
    if (!selectedCoop || !confirm(t('admin.dividendDetail.confirmMarkPaid'))) return;

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/coops/${selectedCoop.id}/dividends/${period.id}/mark-paid`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.ok) {
        setSuccess(t('common.success'));
        fetchPeriods();
      } else {
        throw new Error('Mark paid failed');
      }
    } catch {
      setError(t('common.error'));
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(locale);
  };

  const fmtCurrency = (amount: number) => formatCurrency(amount, locale);

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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse h-8 w-48 bg-muted rounded" />
        <div className="animate-pulse h-64 bg-muted rounded-lg" />
      </div>
    );
  }

  if (!selectedCoop) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t('admin.selectCoop')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('admin.dividends.title')}</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          {t('admin.dividends.addPeriod')}
        </Button>
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

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="animate-pulse space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded" />
              ))}
            </div>
          ) : periods.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('common.noResults')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.dividends.periodName')}</TableHead>
                  <TableHead>{t('admin.dividends.year')}</TableHead>
                  <TableHead>{t('admin.dividends.exDividendDate')}</TableHead>
                  <TableHead className="text-right">{t('admin.dividends.dividendRate')}</TableHead>
                  <TableHead className="text-right">{t('admin.dividends.totalGross')}</TableHead>
                  <TableHead className="text-right">{t('admin.dividends.totalNet')}</TableHead>
                  <TableHead>{t('admin.dividends.status')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period) => (
                  <TableRow key={period.id}>
                    <TableCell className="font-medium">{period.name}</TableCell>
                    <TableCell>{period.year}</TableCell>
                    <TableCell>{formatDate(period.exDividendDate)}</TableCell>
                    <TableCell className="text-right">{(period.dividendRate * 100).toFixed(2)}%</TableCell>
                    <TableCell className="text-right">
                      {period.totalGross > 0 ? formatCurrency(period.totalGross) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {period.totalNet > 0 ? formatCurrency(period.totalNet) : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(period.status)}>
                        {t(`admin.dividends.${period.status.toLowerCase()}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/dashboard/admin/dividends/${period.id}`}>
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        {period.status === 'DRAFT' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCalculate(period)}
                          >
                            <Calculator className="h-4 w-4" />
                          </Button>
                        )}
                        {period.status === 'CALCULATED' && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCalculate(period)}
                              title={t('admin.dividends.recalculate')}
                            >
                              <Calculator className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleMarkPaid(period)}
                            >
                              <Check className="h-4 w-4 text-green-600" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.dividends.addPeriod')}</DialogTitle>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label>{t('admin.dividends.periodName')}</Label>
              <Input {...form.register('name')} placeholder="e.g. Q4 2024" />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('admin.dividends.year')}</Label>
                <Input type="number" {...form.register('year')} />
              </div>
              <div className="space-y-2">
                <Label>{t('admin.dividends.dividendRate')} (%)</Label>
                <Input type="number" step="0.01" {...form.register('dividendRate')} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('admin.dividends.exDividendDate')}</Label>
                <Controller
                  name="exDividendDate"
                  control={form.control}
                  render={({ field }) => (
                    <DatePicker
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={t('common.selectDate')}
                    />
                  )}
                />
                {form.formState.errors.exDividendDate && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.exDividendDate.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>{t('admin.dividends.paymentDate')}</Label>
                <Controller
                  name="paymentDate"
                  control={form.control}
                  render={({ field }) => (
                    <DatePicker
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={t('common.selectDate')}
                    />
                  )}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t('common.loading') : t('common.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
