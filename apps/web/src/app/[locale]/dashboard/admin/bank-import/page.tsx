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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';
import { formatCurrency } from '@opencoop/shared';
import { Upload, Link2, RefreshCw, EyeOff, RotateCcw } from 'lucide-react';

const BANK_PRESETS = [
  { id: 'belfius', name: 'Belfius' },
  { id: 'kbc', name: 'KBC' },
  { id: 'bnp', name: 'BNP Paribas Fortis' },
  { id: 'ing', name: 'ING' },
  { id: 'generic', name: 'Generic CSV' },
] as const;

interface MatchedShareholder {
  firstName?: string;
  lastName?: string;
}

interface MatchedRegistration {
  shareholder?: MatchedShareholder;
}

interface MatchedPayment {
  registration?: MatchedRegistration;
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

interface Registration {
  id: string;
  ogmCode: string | null;
  totalAmount: number;
  status: string;
  type: string;
  shareholder: {
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
  };
}

interface UnlinkedPayment {
  id: string;
  amount: number;
  bankDate: string;
  registration: {
    ogmCode: string | null;
    totalAmount: number;
    status: string;
    shareholder: MatchedShareholder & { companyName?: string | null };
  };
}

export default function BankImportPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [transactions, setTransactions] = useState<BankTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState('belfius');
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [matchingTx, setMatchingTx] = useState<BankTx | null>(null);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [unlinkedPayments, setUnlinkedPayments] = useState<UnlinkedPayment[]>([]);
  const [paymentSearch, setPaymentSearch] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [loadingRegistrations, setLoadingRegistrations] = useState(false);
  const [matching, setMatching] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [statusFilter, setStatusFilter] = useState('UNMATCHED');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

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

  const loadUnlinkedPayments = useCallback(async () => {
    if (!selectedCoop || !matchDialogOpen || !matchingTx) return;
    setLoadingPayments(true);
    try {
      const query = new URLSearchParams({ amount: paymentAmount });
      if (paymentSearch.trim()) query.set('search', paymentSearch.trim());
      const data = await api<UnlinkedPayment[]>(
        `/admin/coops/${selectedCoop.id}/payments/unlinked?${query.toString()}`,
      );
      setUnlinkedPayments(data);
    } catch {
      setUnlinkedPayments([]);
    } finally {
      setLoadingPayments(false);
    }
  }, [matchDialogOpen, matchingTx, paymentAmount, paymentSearch, selectedCoop]);

  useEffect(() => {
    loadUnlinkedPayments();
  }, [loadUnlinkedPayments]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCoop) return;
    setUploading(true);
    setError('');
    setSuccessMessage('');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const result = await api<{ rowCount: number; matchedCount: number; unmatchedCount: number; skippedCount: number }>(
        `/admin/coops/${selectedCoop.id}/bank-import?preset=${selectedPreset}`,
        {
          method: 'POST',
          body: formData,
        },
      );
      setError('');
      setSuccessMessage(
        t('admin.bankImport.uploadSuccess', {
          total: result.rowCount,
          matched: result.matchedCount,
          unmatched: result.unmatchedCount,
          skipped: result.skippedCount,
        }),
      );
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.bankImport.uploadError'));
      setSuccessMessage('');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const openMatchDialog = async (tx: BankTx) => {
    setMatchingTx(tx);
    setMatchDialogOpen(true);
    setPaymentAmount(Number(tx.amount).toFixed(2));
    setPaymentSearch('');
    setUnlinkedPayments([]);
    setLoadingRegistrations(true);
    try {
      const data = await api<{ data: Registration[] }>(
        `/admin/coops/${selectedCoop!.id}/registrations?pageSize=100`,
      );
      setRegistrations(
        (data.data || []).filter((registration) =>
          ['PENDING_PAYMENT', 'ACTIVE'].includes(registration.status),
        ),
      );
    } catch {
      setRegistrations([]);
    } finally {
      setLoadingRegistrations(false);
    }
  };

  const handleMatch = async (target: { registrationId?: string; paymentId?: string }) => {
    if (!matchingTx || !selectedCoop) return;
    setMatching(true);
    try {
      await api(`/admin/coops/${selectedCoop.id}/bank-transactions/${matchingTx.id}/match`, {
        method: 'POST',
        body: target,
      });
      setError('');
      setMatchDialogOpen(false);
      setMatchingTx(null);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.bankImport.uploadError'));
    } finally {
      setMatching(false);
    }
  };

  const handleRematch = async () => {
    if (!selectedCoop) return;
    setRematching(true);
    setError('');
    try {
      const result = await api<{
        checked: number;
        linkedExisting: number;
        createdPayments: number;
        stillUnmatched: number;
        ignoredOutgoing: number;
      }>(`/admin/coops/${selectedCoop.id}/bank-transactions/rematch`, { method: 'POST' });
      setSuccessMessage(
        t('admin.bankImport.rematchSuccess', {
          checked: result.checked,
          linkedExisting: result.linkedExisting,
          createdPayments: result.createdPayments,
          stillUnmatched: result.stillUnmatched,
          ignoredOutgoing: result.ignoredOutgoing,
        }),
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.bankImport.uploadError'));
      setSuccessMessage('');
    } finally {
      setRematching(false);
    }
  };

  const handleIgnore = async (ids: string[]) => {
    if (!selectedCoop || ids.length === 0) return;
    try {
      const result = await api<{ ignored: number; skipped: number }>(
        `/admin/coops/${selectedCoop.id}/bank-transactions/ignore`,
        { method: 'POST', body: { ids } },
      );
      setSuccessMessage(
        t('admin.bankImport.ignoreSuccess', { ignored: result.ignored, skipped: result.skipped }),
      );
      setSelectedIds([]);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.bankImport.uploadError'));
    }
  };

  const handleUnignore = async (id: string) => {
    if (!selectedCoop) return;
    try {
      await api(`/admin/coops/${selectedCoop.id}/bank-transactions/unignore`, {
        method: 'POST',
        body: { ids: [id] },
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('admin.bankImport.uploadError'));
    }
  };

  const visibleTransactions = transactions.filter((tx) => {
    if (statusFilter === 'ALL') return true;
    if (statusFilter === 'MATCHED') return ['AUTO_MATCHED', 'MANUAL_MATCHED'].includes(tx.matchStatus);
    return tx.matchStatus === statusFilter;
  });

  const getShareholderName = (shareholder: MatchedShareholder & { companyName?: string | null }) =>
    shareholder.companyName || `${shareholder.firstName || ''} ${shareholder.lastName || ''}`.trim();

  if (!selectedCoop) return <p className="text-muted-foreground">{t('admin.selectCoop')}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('admin.bankImport.title')}</h1>
        <div className="flex items-center gap-3">
          <Select value={selectedPreset} onValueChange={setSelectedPreset}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder={t('admin.bankImport.selectBank')} />
            </SelectTrigger>
            <SelectContent>
              {BANK_PRESETS.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
          <Button variant="outline" onClick={handleRematch} disabled={rematching}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {rematching ? t('common.loading') : t('admin.bankImport.rematch')}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {successMessage && (
        <Alert className="mb-4">
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between mb-4 gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('admin.bankImport.statusAll')}</SelectItem>
            <SelectItem value="UNMATCHED">{t('admin.bankImport.statusUnmatched')}</SelectItem>
            <SelectItem value="MATCHED">{t('admin.bankImport.statusMatched')}</SelectItem>
            <SelectItem value="IGNORED">{t('admin.bankImport.statusIgnored')}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          disabled={selectedIds.length === 0}
          onClick={() => handleIgnore(selectedIds)}
        >
          <EyeOff className="h-4 w-4 mr-2" />
          {t('admin.bankImport.ignoreSelected', { count: selectedIds.length })}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : visibleTransactions.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('common.noResults')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={
                        visibleTransactions.filter((tx) => tx.matchStatus === 'UNMATCHED').length > 0 &&
                        visibleTransactions
                          .filter((tx) => tx.matchStatus === 'UNMATCHED')
                          .every((tx) => selectedIds.includes(tx.id))
                      }
                      onChange={(event) => {
                        const unmatchedIds = visibleTransactions
                          .filter((tx) => tx.matchStatus === 'UNMATCHED')
                          .map((tx) => tx.id);
                        setSelectedIds(event.target.checked ? unmatchedIds : []);
                      }}
                    />
                  </TableHead>
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead className="text-right">{t('common.amount')}</TableHead>
                  <TableHead>{t('admin.bankImport.counterparty')}</TableHead>
                  <TableHead>{t('payments.ogmCode')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('admin.bankImport.matchedTo')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTransactions.map((tx) => {
                  const shareholder = tx.matchedPayment?.registration?.shareholder;
                  const matchedName = shareholder
                    ? `${shareholder.firstName || ''} ${shareholder.lastName || ''}`.trim()
                    : null;

                  return (
                    <TableRow key={tx.id}>
                      <TableCell>
                        {tx.matchStatus === 'UNMATCHED' && (
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(tx.id)}
                            onChange={(event) =>
                              setSelectedIds((current) =>
                                event.target.checked
                                  ? [...current, tx.id]
                                  : current.filter((id) => id !== tx.id),
                              )
                            }
                          />
                        )}
                      </TableCell>
                      <TableCell>{new Date(tx.date).toLocaleDateString(locale)}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(tx.amount), locale)}
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
                          {tx.matchStatus === 'UNMATCHED'
                            ? t('admin.bankImport.statusUnmatched')
                            : tx.matchStatus === 'IGNORED'
                              ? t('admin.bankImport.statusIgnored')
                              : t('admin.bankImport.statusMatched')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {matchedName ? (
                          matchedName
                        ) : tx.matchStatus === 'UNMATCHED' ? (
                          <div className="flex items-center gap-1">
                            {Number(tx.amount) > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openMatchDialog(tx)}
                              >
                                <Link2 className="h-4 w-4 mr-1" />
                                {t('admin.bankImport.match')}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              title={t('admin.bankImport.notSharePayment')}
                              onClick={() => handleIgnore([tx.id])}
                            >
                              <EyeOff className="h-4 w-4 mr-1" />
                              {t('admin.bankImport.ignore')}
                            </Button>
                          </div>
                        ) : tx.matchStatus === 'IGNORED' ? (
                          <Button variant="ghost" size="sm" onClick={() => handleUnignore(tx.id)}>
                            <RotateCcw className="h-4 w-4 mr-1" />
                            {t('admin.bankImport.restore')}
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

      <Dialog open={matchDialogOpen} onOpenChange={setMatchDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('admin.bankImport.matchTransaction')}</DialogTitle>
          </DialogHeader>
          {matchingTx && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted p-3 text-sm space-y-1">
                <p>
                  <span className="font-medium">{t('common.amount')}:</span>{' '}
                  {formatCurrency(Number(matchingTx.amount), locale)}
                </p>
                <p>
                  <span className="font-medium">{t('common.date')}:</span>{' '}
                  {new Date(matchingTx.date).toLocaleDateString(locale)}
                </p>
                {matchingTx.counterparty && (
                  <p>
                    <span className="font-medium">{t('admin.bankImport.counterparty')}:</span>{' '}
                    {matchingTx.counterparty}
                  </p>
                )}
                {matchingTx.referenceText && (
                  <p>
                    <span className="font-medium">{t('admin.bankImport.reference')}:</span>{' '}
                    {matchingTx.referenceText}
                  </p>
                )}
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">
                  {t('admin.bankImport.existingPayment')}
                </h4>
                <Input
                  value={paymentSearch}
                  onChange={(event) => setPaymentSearch(event.target.value)}
                  placeholder={t('admin.bankImport.searchShareholder')}
                  className="mb-2"
                />
                {loadingPayments ? (
                  <div className="flex justify-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                  </div>
                ) : unlinkedPayments.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-2">
                    {t('admin.bankImport.noExistingPayments')}
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {unlinkedPayments.map((payment) => (
                      <button
                        key={payment.id}
                        className="w-full flex items-center justify-between rounded-md border p-3 text-sm hover:bg-accent transition-colors disabled:opacity-50"
                        onClick={() => handleMatch({ paymentId: payment.id })}
                        disabled={matching}
                      >
                        <div className="text-left">
                          <p className="font-medium">{getShareholderName(payment.registration.shareholder)}</p>
                          {payment.registration.ogmCode && (
                            <p className="text-muted-foreground font-mono text-xs">
                              {payment.registration.ogmCode}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p>{formatCurrency(Number(payment.amount), locale)}</p>
                          <p className="text-muted-foreground text-xs">
                            {new Date(payment.bankDate).toLocaleDateString(locale)}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-medium mb-2">
                  {t('admin.bankImport.openRegistration')}
                </h4>
                {loadingRegistrations ? (
                  <div className="flex justify-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                  </div>
                ) : registrations.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-4">
                    {t('admin.bankImport.noRegistrations')}
                  </p>
                ) : (
                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {registrations.map((reg) => {
                      const name = reg.shareholder.companyName
                        || `${reg.shareholder.firstName || ''} ${reg.shareholder.lastName || ''}`.trim();
                      return (
                        <button
                          key={reg.id}
                          className="w-full flex items-center justify-between rounded-md border p-3 text-sm hover:bg-accent transition-colors disabled:opacity-50"
                          onClick={() => handleMatch({ registrationId: reg.id })}
                          disabled={matching}
                        >
                          <div className="text-left">
                            <p className="font-medium">{name}</p>
                            {reg.ogmCode && (
                              <p className="text-muted-foreground font-mono text-xs">
                                {reg.ogmCode}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <p>{formatCurrency(Number(reg.totalAmount), locale)}</p>
                            <p className="text-muted-foreground text-xs">{reg.type}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
