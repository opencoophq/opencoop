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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { formatCurrency, formatIban } from '@opencoop/shared';
import { EpcQrCode } from '@/components/epc-qr-code';
import { Textarea } from '@/components/ui/textarea';
import { Check, X, QrCode, CreditCard, Link2 } from 'lucide-react';

interface TransactionRow {
  id: string;
  type: string;
  status: string;
  quantity: number;
  pricePerShare: number;
  totalAmount: number;
  createdAt: string;
  ogmCode?: string;
  shareholder: {
    firstName?: string;
    lastName?: string;
    companyName?: string;
    type: string;
  };
  shareClass?: {
    name: string;
  };
}

interface PaymentDetails {
  direction: 'incoming' | 'outgoing';
  beneficiaryName: string;
  iban: string;
  bic: string;
  amount: number;
  ogmCode: string;
}

interface UnmatchedTransaction {
  id: string;
  date: string;
  amount: number;
  counterparty: string | null;
  ogmCode: string | null;
  referenceText: string | null;
}

export default function AdminTransactionsPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  // Payment details dialog
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails | null>(null);
  const [paymentTxId, setPaymentTxId] = useState('');
  const [paymentTxStatus, setPaymentTxStatus] = useState('');
  const [paymentBankDate, setPaymentBankDate] = useState('');
  const [completing, setCompleting] = useState(false);

  // Reject dialog state
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTxId, setRejectTxId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Unmatched payments state
  const [unmatchedTxs, setUnmatchedTxs] = useState<UnmatchedTransaction[]>([]);
  const [unmatchedLoading, setUnmatchedLoading] = useState(false);

  // Match dialog state
  const [matchOpen, setMatchOpen] = useState(false);
  const [matchBankTxId, setMatchBankTxId] = useState('');
  const [matchRegistrations, setMatchRegistrations] = useState<TransactionRow[]>([]);
  const [matchSearch, setMatchSearch] = useState('');
  const [matchLoading, setMatchLoading] = useState(false);
  const [matching, setMatching] = useState(false);

  const loadData = useCallback(async () => {
    if (!selectedCoop) return;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    try {
      const result = await api<{ items: TransactionRow[] }>(
        `/admin/coops/${selectedCoop.id}/registrations?${params}`,
      );
      setTransactions(result.items || []);
    } catch {
      setError(t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, statusFilter, t]);

  const loadUnmatched = useCallback(async () => {
    if (!selectedCoop) return;
    setUnmatchedLoading(true);
    try {
      const result = await api<UnmatchedTransaction[]>(
        `/admin/coops/${selectedCoop.id}/bank-transactions/unmatched`,
      );
      setUnmatchedTxs(result || []);
    } catch {
      setError(t('common.loadError'));
    } finally {
      setUnmatchedLoading(false);
    }
  }, [selectedCoop, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApprove = async (id: string) => {
    if (!selectedCoop) return;
    try {
      await api(`/admin/coops/${selectedCoop.id}/registrations/${id}/approve`, { method: 'PUT' });
      loadData();
    } catch {
      setError(t('common.actionError'));
    }
  };

  const openRejectDialog = (id: string) => {
    setRejectTxId(id);
    setRejectReason('');
    setRejectOpen(true);
  };

  const handleReject = async () => {
    if (!selectedCoop || !rejectTxId || !rejectReason.trim()) return;
    try {
      await api(`/admin/coops/${selectedCoop.id}/registrations/${rejectTxId}/reject`, {
        method: 'PUT',
        body: { reason: rejectReason.trim() },
      });
      setRejectOpen(false);
      loadData();
    } catch {
      setError(t('common.actionError'));
    }
  };

  const showPaymentDetails = async (txId: string, txStatus: string) => {
    if (!selectedCoop) return;
    try {
      const details = await api<PaymentDetails>(
        `/admin/coops/${selectedCoop.id}/registrations/${txId}/payment-details`,
      );
      setPaymentDetails(details);
      setPaymentTxId(txId);
      setPaymentTxStatus(txStatus);
      setPaymentBankDate(new Date().toISOString().split('T')[0]);
      setPaymentOpen(true);
    } catch {
      setError(t('common.actionError'));
    }
  };

  const handleComplete = async () => {
    if (!selectedCoop || !paymentTxId) return;
    setCompleting(true);
    try {
      await api(`/admin/coops/${selectedCoop.id}/registrations/${paymentTxId}/complete`, {
        method: 'PUT',
        body: { bankDate: paymentBankDate || undefined },
      });
      setPaymentOpen(false);
      loadData();
    } catch {
      setError(t('common.actionError'));
    } finally {
      setCompleting(false);
    }
  };

  const openMatchDialog = async (bankTxId: string) => {
    if (!selectedCoop) return;
    setMatchBankTxId(bankTxId);
    setMatchSearch('');
    setMatchOpen(true);
    setMatchLoading(true);
    try {
      // Load registrations that can be matched (PENDING_PAYMENT or ACTIVE)
      const [pending, active] = await Promise.all([
        api<{ items: TransactionRow[] }>(
          `/admin/coops/${selectedCoop.id}/registrations?status=PENDING_PAYMENT&type=BUY`,
        ),
        api<{ items: TransactionRow[] }>(
          `/admin/coops/${selectedCoop.id}/registrations?status=ACTIVE&type=BUY`,
        ),
      ]);
      setMatchRegistrations([...(pending.items || []), ...(active.items || [])]);
    } catch {
      setError(t('common.loadError'));
    } finally {
      setMatchLoading(false);
    }
  };

  const handleMatch = async (registrationId: string) => {
    if (!selectedCoop || !matchBankTxId) return;
    setMatching(true);
    try {
      await api(`/admin/coops/${selectedCoop.id}/bank-transactions/${matchBankTxId}/match`, {
        method: 'POST',
        body: { registrationId },
      });
      setMatchOpen(false);
      setSuccessMessage(t('admin.transactions.matched'));
      // Refresh unmatched list
      loadUnmatched();
    } catch {
      setError(t('common.actionError'));
    } finally {
      setMatching(false);
    }
  };

  const getName = (sh: TransactionRow['shareholder']) =>
    sh.type === 'COMPANY'
      ? sh.companyName || ''
      : `${sh.firstName || ''} ${sh.lastName || ''}`.trim();

  const canShowPayment = (tx: TransactionRow) => {
    if (tx.type === 'BUY' && ['PENDING', 'PENDING_PAYMENT'].includes(tx.status)) return true;
    if (tx.type === 'SELL' && tx.status === 'PENDING_PAYMENT') return true;
    return false;
  };

  const filteredMatchRegistrations = matchRegistrations.filter((reg) => {
    if (!matchSearch) return true;
    const search = matchSearch.toLowerCase();
    const name = getName(reg.shareholder).toLowerCase();
    const ogm = reg.ogmCode?.toLowerCase() || '';
    return name.includes(search) || ogm.includes(search);
  });

  if (!selectedCoop) return <p className="text-muted-foreground">{t('admin.selectCoop')}</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('transactions.title')}</h1>
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

      <Tabs defaultValue="registrations" onValueChange={(v) => {
        if (v === 'unmatched') loadUnmatched();
      }}>
        <TabsList className="mb-4">
          <TabsTrigger value="registrations">
            {t('admin.transactions.allTransactions')}
          </TabsTrigger>
          <TabsTrigger value="unmatched">
            {t('admin.transactions.unmatchedPayments')}
          </TabsTrigger>
        </TabsList>

        {/* ==================== REGISTRATIONS TAB ==================== */}
        <TabsContent value="registrations">
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
                    <SelectItem value="PENDING_PAYMENT">
                      {t('transactions.statuses.PENDING_PAYMENT')}
                    </SelectItem>
                    <SelectItem value="ACTIVE">{t('transactions.statuses.ACTIVE')}</SelectItem>
                    <SelectItem value="COMPLETED">
                      {t('transactions.statuses.COMPLETED')}
                    </SelectItem>
                    <SelectItem value="CANCELLED">
                      {t('transactions.statuses.CANCELLED')}
                    </SelectItem>
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
                        <TableCell>
                          {new Date(tx.createdAt).toLocaleDateString(locale)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              tx.status === 'COMPLETED' || tx.status === 'ACTIVE'
                                ? 'default'
                                : tx.status === 'PENDING'
                                  ? 'secondary'
                                  : tx.status === 'CANCELLED'
                                    ? 'destructive'
                                    : 'outline'
                            }
                          >
                            {t(`transactions.statuses.${tx.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {tx.status === 'PENDING' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleApprove(tx.id)}
                                >
                                  <Check className="h-4 w-4 text-green-600" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openRejectDialog(tx.id)}
                                >
                                  <X className="h-4 w-4 text-red-600" />
                                </Button>
                              </>
                            )}
                            {canShowPayment(tx) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => showPaymentDetails(tx.id, tx.status)}
                                title={
                                  tx.type === 'SELL'
                                    ? t('admin.transactions.payRefund')
                                    : t('admin.transactions.paymentInfo')
                                }
                              >
                                {tx.type === 'SELL' ? (
                                  <CreditCard className="h-4 w-4 text-blue-600" />
                                ) : (
                                  <QrCode className="h-4 w-4 text-blue-600" />
                                )}
                              </Button>
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
        </TabsContent>

        {/* ==================== UNMATCHED PAYMENTS TAB ==================== */}
        <TabsContent value="unmatched">
          <Card>
            <CardContent className="pt-6">
              {unmatchedLoading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : unmatchedTxs.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  {t('admin.transactions.noUnmatchedPayments')}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('common.date')}</TableHead>
                      <TableHead className="text-right">{t('common.amount')}</TableHead>
                      <TableHead>{t('admin.transactions.counterparty')}</TableHead>
                      <TableHead>{t('admin.transactions.reference')}</TableHead>
                      <TableHead>{t('common.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unmatchedTxs.map((utx) => (
                      <TableRow key={utx.id}>
                        <TableCell>
                          {new Date(utx.date).toLocaleDateString(locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(Number(utx.amount), locale)}
                        </TableCell>
                        <TableCell>{utx.counterparty || '-'}</TableCell>
                        <TableCell>
                          <span className="font-mono text-xs">
                            {utx.ogmCode || utx.referenceText || '-'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openMatchDialog(utx.id)}
                            title={t('admin.transactions.matchToRegistration')}
                          >
                            <Link2 className="h-4 w-4 text-blue-600" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Payment Details Dialog */}
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {paymentDetails?.direction === 'outgoing'
                ? t('admin.transactions.payRefund')
                : t('admin.transactions.paymentInfo')}
            </DialogTitle>
            <DialogDescription>
              {paymentDetails?.direction === 'outgoing'
                ? t('admin.transactions.scanToPayRefund')
                : t('admin.transactions.scanToPay')}
            </DialogDescription>
          </DialogHeader>
          {paymentDetails && (
            <div className="space-y-4">
              {paymentDetails.iban && paymentDetails.bic ? (
                <div className="flex justify-center">
                  <EpcQrCode
                    bic={paymentDetails.bic}
                    beneficiaryName={paymentDetails.beneficiaryName}
                    iban={paymentDetails.iban}
                    amount={paymentDetails.amount}
                    reference={paymentDetails.ogmCode}
                  />
                </div>
              ) : (
                <Alert variant="destructive">
                  <AlertDescription>
                    {t('admin.transactions.missingBankDetails')}
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('payments.beneficiary')}</span>
                  <span className="font-medium">{paymentDetails.beneficiaryName}</span>
                </div>
                {paymentDetails.iban && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('payments.iban')}</span>
                    <span className="font-mono text-xs">{formatIban(paymentDetails.iban)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('common.amount')}</span>
                  <span className="font-medium">
                    {formatCurrency(paymentDetails.amount, locale)}
                  </span>
                </div>
                {paymentDetails.ogmCode && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('payments.ogmCode')}</span>
                    <span className="font-mono text-xs">{paymentDetails.ogmCode}</span>
                  </div>
                )}
              </div>
              {paymentTxStatus === 'PENDING_PAYMENT' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('payments.paymentDate')}</label>
                  <Input
                    type="date"
                    value={paymentBankDate}
                    onChange={(e) => setPaymentBankDate(e.target.value)}
                  />
                </div>
              )}
              <DialogFooter>
                {paymentTxStatus === 'PENDING_PAYMENT' && (
                  <Button onClick={handleComplete} disabled={completing}>
                    {completing ? t('common.loading') : t('admin.transactions.markComplete')}
                  </Button>
                )}
                <Button variant="outline" onClick={() => setPaymentOpen(false)}>
                  {t('common.confirm')}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Transaction Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('transactions.rejectReason')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t('transactions.rejectReason')}
              rows={3}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={!rejectReason.trim()}
              >
                {t('transactions.reject')}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Match Bank Transaction Dialog */}
      <Dialog open={matchOpen} onOpenChange={setMatchOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('admin.transactions.matchToRegistration')}</DialogTitle>
            <DialogDescription>
              {t('admin.transactions.selectRegistration')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder={t('common.search')}
              value={matchSearch}
              onChange={(e) => setMatchSearch(e.target.value)}
            />
            {matchLoading ? (
              <div className="flex justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : filteredMatchRegistrations.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">{t('common.noResults')}</p>
            ) : (
              <div className="max-h-[300px] overflow-y-auto space-y-2">
                {filteredMatchRegistrations.map((reg) => (
                  <button
                    key={reg.id}
                    onClick={() => handleMatch(reg.id)}
                    disabled={matching}
                    className="w-full text-left p-3 rounded-md border hover:bg-accent transition-colors disabled:opacity-50"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-sm">{getName(reg.shareholder)}</p>
                        <p className="text-xs text-muted-foreground">
                          {reg.shareClass?.name && `${reg.shareClass.name} - `}
                          {reg.quantity} {t('shares.quantity').toLowerCase()}
                        </p>
                        {reg.ogmCode && (
                          <p className="text-xs font-mono text-muted-foreground mt-0.5">
                            {reg.ogmCode}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-sm">
                          {formatCurrency(Number(reg.totalAmount), locale)}
                        </p>
                        <Badge variant="outline" className="text-xs">
                          {t(`transactions.statuses.${reg.status}`)}
                        </Badge>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
