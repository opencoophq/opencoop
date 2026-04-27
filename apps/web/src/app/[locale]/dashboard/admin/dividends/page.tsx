'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
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
import {
  applyColumnFiltersAndSort,
  toggleColumnSort,
  type ColumnSortState,
} from '@/lib/table-utils';
import {
  Plus,
  Eye,
  Calculator,
  Check,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

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

type DividendColumn = 'name' | 'year' | 'exDividendDate' | 'dividendRate' | 'totalGross' | 'totalNet' | 'status';

// Parse a number string that may use comma as decimal separator (NL/BE locale)
const parseLocaleNumber = (val: unknown): number => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return Number(val.replace(',', '.'));
  return Number(val);
};

const dividendPeriodSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  year: z.coerce.number().min(2000).max(2100),
  exDividendDate: z.string().min(1, 'Ex-dividend date is required'),
  paymentDate: z.string().optional(),
  dividendRate: z.preprocess(parseLocaleNumber, z.number().min(0).max(100)),
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
  const [columnFilters, setColumnFilters] = useState<Partial<Record<DividendColumn, string>>>({});
  const [columnSort, setColumnSort] = useState<ColumnSortState<DividendColumn>>({
    column: null,
    direction: 'asc',
  });

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
      const data = await api<DividendPeriod[] | { data: DividendPeriod[] }>(
        `/admin/coops/${selectedCoop.id}/dividends`,
      );
      setPeriods(Array.isArray(data) ? data : data.data || []);
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  }, [selectedCoop]);

  useEffect(() => {
    fetchPeriods();
  }, [fetchPeriods]);

  const yearValue = form.watch('year');

  // Default exDividendDate to Dec 31 of selected year
  useEffect(() => {
    const year = Number(yearValue);
    if (year >= 2000 && year <= 2100) {
      form.setValue('exDividendDate', `${year}-12-31`);
    }
  }, [yearValue, form]);

  const openCreateDialog = () => {
    const year = new Date().getFullYear();
    form.reset({
      name: '',
      year,
      exDividendDate: `${year}-12-31`,
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
      await api(`/admin/coops/${selectedCoop.id}/dividends`, {
        method: 'POST',
        body: { ...data, paymentDate: data.paymentDate || undefined },
      });
      setSuccess(t('common.success'));
      setDialogOpen(false);
      fetchPeriods();
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleCalculate = async (period: DividendPeriod) => {
    if (!selectedCoop) return;

    try {
      await api(`/admin/coops/${selectedCoop.id}/dividends/${period.id}/calculate`, {
        method: 'POST',
      });
      setSuccess(t('common.success'));
      fetchPeriods();
    } catch {
      setError(t('common.error'));
    }
  };

  const handleMarkPaid = async (period: DividendPeriod) => {
    if (!selectedCoop || !confirm(t('admin.dividendDetail.confirmMarkPaid'))) return;

    try {
      await api(`/admin/coops/${selectedCoop.id}/dividends/${period.id}/mark-paid`, {
        method: 'POST',
      });
      setSuccess(t('common.success'));
      fetchPeriods();
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

  const visiblePeriods = useMemo(
    () =>
      applyColumnFiltersAndSort(
        periods,
        {
          name: { accessor: (period) => period.name },
          year: { accessor: (period) => period.year },
          exDividendDate: { accessor: (period) => period.exDividendDate },
          dividendRate: { accessor: (period) => period.dividendRate },
          totalGross: { accessor: (period) => period.totalGross },
          totalNet: { accessor: (period) => period.totalNet },
          status: { accessor: (period) => period.status },
        },
        columnFilters,
        columnSort,
      ),
    [periods, columnFilters, columnSort],
  );

  const sortIcon = (column: DividendColumn) => {
    if (columnSort.column !== column) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return columnSort.direction === 'asc' ? (
      <ArrowUp className="h-4 w-4 ml-1" />
    ) : (
      <ArrowDown className="h-4 w-4 ml-1" />
    );
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
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'name'))}>
                      {t('admin.dividends.periodName')}
                      {sortIcon('name')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'year'))}>
                      {t('admin.dividends.year')}
                      {sortIcon('year')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'exDividendDate'))}>
                      {t('admin.dividends.exDividendDate')}
                      {sortIcon('exDividendDate')}
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'dividendRate'))}>
                      {t('admin.dividends.dividendRate')}
                      {sortIcon('dividendRate')}
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'totalGross'))}>
                      {t('admin.dividends.totalGross')}
                      {sortIcon('totalGross')}
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'totalNet'))}>
                      {t('admin.dividends.totalNet')}
                      {sortIcon('totalNet')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'status'))}>
                      {t('admin.dividends.status')}
                      {sortIcon('status')}
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead>
                    <Input
                      value={columnFilters.name || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.year || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, year: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.exDividendDate || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, exDividendDate: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.dividendRate || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, dividendRate: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.totalGross || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, totalGross: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.totalNet || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, totalNet: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.status || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, status: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiblePeriods.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                      {t('common.noResults')}
                    </TableCell>
                  </TableRow>
                ) : (
                  visiblePeriods.map((period) => (
                    <TableRow key={period.id}>
                      <TableCell className="font-medium">{period.name}</TableCell>
                      <TableCell>{period.year}</TableCell>
                      <TableCell>{formatDate(period.exDividendDate)}</TableCell>
                      <TableCell className="text-right">{(period.dividendRate * 100).toFixed(2)}%</TableCell>
                      <TableCell className="text-right">
                        {period.totalGross > 0 ? fmtCurrency(period.totalGross) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {period.totalNet > 0 ? fmtCurrency(period.totalNet) : '-'}
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
                  ))
                )}
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
                <Input type="text" inputMode="decimal" {...form.register('dividendRate')} />
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
                      defaultMonth={new Date(form.watch('year'), 11)}
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
                      defaultMonth={new Date(form.watch('year') + 1, 0)}
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
