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
import { api } from '@/lib/api';
import { formatCurrency, formatIban } from '@opencoop/shared';
import { EpcQrCode } from '@/components/epc-qr-code';
import { Textarea } from '@/components/ui/textarea';
import { Check, X, QrCode, CreditCard } from 'lucide-react';

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

interface PaymentDetails {
  direction: 'incoming' | 'outgoing';
  beneficiaryName: string;
  iban: string;
  bic: string;
  amount: number;
  ogmCode: string;
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
  const [completing, setCompleting] = useState(false);

  // Reject dialog state
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTxId, setRejectTxId] = useState('');
  const [rejectReason, setRejectReason] = useState('');

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

  const openRejectDialog = (id: string) => {
    setRejectTxId(id);
    setRejectReason('');
    setRejectOpen(true);
  };

  const handleReject = async () => {
    if (!selectedCoop || !rejectTxId || !rejectReason.trim()) return;
    await api(`/admin/coops/${selectedCoop.id}/transactions/${rejectTxId}/reject`, {
      method: 'PUT',
      body: { reason: rejectReason.trim() },
    });
    setRejectOpen(false);
    loadData();
  };

  const showPaymentDetails = async (txId: string, txStatus: string) => {
    if (!selectedCoop) return;
    try {
      const details = await api<PaymentDetails>(
        `/admin/coops/${selectedCoop.id}/transactions/${txId}/payment-details`,
      );
      setPaymentDetails(details);
      setPaymentTxId(txId);
      setPaymentTxStatus(txStatus);
      setPaymentOpen(true);
    } catch {
      // ignore
    }
  };

  const handleComplete = async () => {
    if (!selectedCoop || !paymentTxId) return;
    setCompleting(true);
    try {
      await api(`/admin/coops/${selectedCoop.id}/transactions/${paymentTxId}/complete`, {
        method: 'PUT',
      });
      setPaymentOpen(false);
      loadData();
    } catch {
      // ignore
    } finally {
      setCompleting(false);
    }
  };

  const getName = (sh: TransactionRow['shareholder']) =>
    sh.type === 'COMPANY'
      ? sh.companyName || ''
      : `${sh.firstName || ''} ${sh.lastName || ''}`.trim();

  const canShowPayment = (tx: TransactionRow) => {
    if (tx.type === 'PURCHASE' && ['PENDING', 'AWAITING_PAYMENT', 'APPROVED'].includes(tx.status)) return true;
    if (tx.type === 'SALE' && tx.status === 'APPROVED') return true;
    return false;
  };

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
                <SelectItem value="AWAITING_PAYMENT">{t('transactions.statuses.AWAITING_PAYMENT')}</SelectItem>
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
                      <div className="flex gap-1">
                        {tx.status === 'PENDING' && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => handleApprove(tx.id)}>
                              <Check className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => openRejectDialog(tx.id)}>
                              <X className="h-4 w-4 text-red-600" />
                            </Button>
                          </>
                        )}
                        {canShowPayment(tx) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => showPaymentDetails(tx.id, tx.status)}
                            title={tx.type === 'SALE' ? t('admin.transactions.payRefund') : t('admin.transactions.paymentInfo')}
                          >
                            {tx.type === 'SALE' ? (
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
                  <AlertDescription>{t('admin.transactions.missingBankDetails')}</AlertDescription>
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
                  <span className="font-medium">{formatCurrency(paymentDetails.amount, locale)}</span>
                </div>
                {paymentDetails.ogmCode && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('payments.ogmCode')}</span>
                    <span className="font-mono text-xs">{paymentDetails.ogmCode}</span>
                  </div>
                )}
              </div>
              <DialogFooter>
                {(paymentTxStatus === 'APPROVED' || paymentTxStatus === 'AWAITING_PAYMENT') && (
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
              <Button variant="destructive" onClick={handleReject} disabled={!rejectReason.trim()}>
                {t('transactions.reject')}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
