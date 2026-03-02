'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { EpcQrCode } from '@/components/epc-qr-code';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, formatIban } from '@opencoop/shared';
import { TrendingDown, QrCode } from 'lucide-react';

interface ShareData {
  id: string;
  quantity: number;
  purchasePricePerShare: number;
  purchaseDate: string;
  paymentDate?: string;
  status: string;
  shareClass: { name: string; code: string };
  project?: { name: string } | null;
}

interface ShareholderData {
  id: string;
  bankIban?: string;
  bankBic?: string;
  shares: ShareData[];
  coop?: {
    minimumHoldingPeriod?: number;
    name?: string;
    slug?: string;
    bankIban?: string;
    bankBic?: string;
  };
}

interface ShareClassData {
  id: string;
  name: string;
  code: string;
  pricePerShare: number;
  minShares: number;
  maxShares?: number;
}

interface PaymentDetailsData {
  beneficiaryName: string;
  iban: string;
  bic: string;
  amount: number;
  ogmCode: string;
}

interface TransactionData {
  id: string;
  type: string;
  status: string;
  totalAmount: number;
  shareId?: string;
  payment?: { ogmCode?: string };
}

export default function SharesPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const [shares, setShares] = useState<ShareData[]>([]);
  const [shareholder, setShareholder] = useState<ShareholderData | null>(null);
  const [loading, setLoading] = useState(true);

  // Sell dialog state
  const [sellOpen, setSellOpen] = useState(false);
  const [sellShareId, setSellShareId] = useState('');
  const [sellQuantity, setSellQuantity] = useState(1);
  const [sellLoading, setSellLoading] = useState(false);
  const [sellSuccess, setSellSuccess] = useState(false);
  const [sellError, setSellError] = useState('');

  // Buy dialog state
  const [buyOpen, setBuyOpen] = useState(false);
  const [shareClasses, setShareClasses] = useState<ShareClassData[]>([]);
  const [buyShareClassId, setBuyShareClassId] = useState('');
  const [buyQuantity, setBuyQuantity] = useState(1);
  const [buyLoading, setBuyLoading] = useState(false);
  const [buySuccess, setBuySuccess] = useState(false);
  const [buyError, setBuyError] = useState('');
  const [buyPaymentDetails, setBuyPaymentDetails] = useState<PaymentDetailsData | null>(null);

  // Payment QR dialog for AWAITING_PAYMENT shares
  const [paymentQrOpen, setPaymentQrOpen] = useState(false);
  const [paymentQrDetails, setPaymentQrDetails] = useState<PaymentDetailsData | null>(null);

  // Transactions (for AWAITING_PAYMENT lookup)
  const [transactions, setTransactions] = useState<TransactionData[]>([]);

  // Bank details dialog for when IBAN is missing
  const [bankOpen, setBankOpen] = useState(false);
  const [bankIban, setBankIban] = useState('');
  const [bankBic, setBankBic] = useState('');
  const [bankLoading, setBankLoading] = useState(false);

  useEffect(() => {
    async function loadShares() {
      try {
        const profile = await api<{ shareholders: ShareholderData[] }>('/auth/me');
        if (profile.shareholders?.[0]) {
          const sh = profile.shareholders[0];
          setShareholder(sh);
          setShares(sh.shares || []);

          // Load share classes for buy dialog
          try {
            const sc = await api<ShareClassData[]>(`/shareholders/${sh.id}/share-classes`);
            setShareClasses(sc || []);
          } catch {
            // ignore
          }

          // Load transactions for AWAITING_PAYMENT QR display
          try {
            const txs = await api<TransactionData[]>(`/shareholders/${sh.id}/transactions`);
            setTransactions(txs || []);
          } catch {
            // ignore
          }
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
      case 'ACTIVE': return 'default' as const;
      case 'PENDING': return 'secondary' as const;
      case 'AWAITING_PAYMENT': return 'outline' as const;
      case 'SOLD': return 'destructive' as const;
      default: return 'outline' as const;
    }
  };

  const openSellDialog = (shareId: string) => {
    if (!shareholder?.bankIban) {
      // Prompt to add bank details first
      setBankIban(shareholder?.bankIban || '');
      setBankBic(shareholder?.bankBic || '');
      setBankOpen(true);
      return;
    }
    const share = shares.find((s) => s.id === shareId);
    setSellShareId(shareId);
    setSellQuantity(1);
    setSellSuccess(false);
    setSellError('');
    setSellOpen(true);
    if (share) setSellQuantity(1);
  };

  const handleSaveBankDetails = async () => {
    if (!shareholder || !bankIban) return;
    setBankLoading(true);
    try {
      await api(`/shareholders/${shareholder.id}/bank-details`, {
        method: 'PUT',
        body: { bankIban, bankBic: bankBic || undefined },
      });
      setShareholder({ ...shareholder, bankIban, bankBic });
      setBankOpen(false);
    } catch {
      // ignore
    } finally {
      setBankLoading(false);
    }
  };

  const handleBuy = async () => {
    if (!shareholder || !buyShareClassId) return;
    setBuyLoading(true);
    setBuyError('');
    try {
      const result = await api<{
        transaction: TransactionData;
        paymentDetails?: PaymentDetailsData;
      }>(`/shareholders/${shareholder.id}/purchase`, {
        method: 'POST',
        body: { shareClassId: buyShareClassId, quantity: buyQuantity },
      });
      setBuySuccess(true);
      if (result.paymentDetails) {
        setBuyPaymentDetails(result.paymentDetails);
      }
      // Reload shares
      const profile = await api<{ shareholders: ShareholderData[] }>('/auth/me');
      if (profile.shareholders?.[0]) {
        const sh = profile.shareholders[0];
        setShareholder(sh);
        setShares(sh.shares || []);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.error');
      setBuyError(message);
    } finally {
      setBuyLoading(false);
    }
  };

  const handleSell = async () => {
    if (!shareholder || !sellShareId) return;
    setSellLoading(true);
    setSellError('');
    try {
      await api(`/shareholders/${shareholder.id}/sell-request`, {
        method: 'POST',
        body: { shareId: sellShareId, quantity: sellQuantity },
      });
      setSellSuccess(true);
      // Reload shares
      const profile = await api<{ shareholders: ShareholderData[] }>('/auth/me');
      if (profile.shareholders?.[0]) {
        const sh = profile.shareholders[0];
        setShareholder(sh);
        setShares(sh.shares || []);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.error');
      setSellError(message);
    } finally {
      setSellLoading(false);
    }
  };

  const showPaymentForShare = (shareId: string) => {
    const tx = transactions.find(
      (tx) => tx.shareId === shareId && tx.status === 'AWAITING_PAYMENT' && tx.type === 'PURCHASE'
    );
    if (!tx || !shareholder?.coop) return;
    setPaymentQrDetails({
      beneficiaryName: shareholder.coop.name || '',
      iban: shareholder.coop.bankIban || '',
      bic: shareholder.coop.bankBic || '',
      amount: Number(tx.totalAmount),
      ogmCode: tx.payment?.ogmCode || '',
    });
    setPaymentQrOpen(true);
  };

  const selectedSellShare = shares.find((s) => s.id === sellShareId);

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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('shares.myShares')}</CardTitle>
          {shareClasses.length > 0 && (
            <Button onClick={() => {
              setBuyOpen(true);
              setBuySuccess(false);
              setBuyError('');
              setBuyPaymentDetails(null);
              setBuyShareClassId('');
              setBuyQuantity(1);
            }}>
              {t('shares.buyShares')}
            </Button>
          )}
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
                  <TableHead>{t('common.actions')}</TableHead>
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
                      {formatCurrency(Number(share.purchasePricePerShare), locale)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(share.quantity * Number(share.purchasePricePerShare), locale)}
                    </TableCell>
                    <TableCell>
                      {new Date(share.paymentDate || share.purchaseDate).toLocaleDateString(locale)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(share.status)}>{share.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {share.status === 'ACTIVE' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openSellDialog(share.id)}
                        >
                          <TrendingDown className="h-4 w-4 mr-1" />
                          {t('shares.sellBack')}
                        </Button>
                      )}
                      {share.status === 'AWAITING_PAYMENT' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => showPaymentForShare(share.id)}
                        >
                          <QrCode className="h-4 w-4 mr-1" />
                          {t('shares.awaitingPayment')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Bank Details Dialog */}
      <Dialog open={bankOpen} onOpenChange={setBankOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('payments.bankDetails')}</DialogTitle>
            <DialogDescription>{t('admin.transactions.bankDetailsRequired')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('payments.iban')}</Label>
              <Input
                value={bankIban}
                onChange={(e) => setBankIban(e.target.value)}
                placeholder="BE68 5390 0754 7034"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('payments.bic')}</Label>
              <Input
                value={bankBic}
                onChange={(e) => setBankBic(e.target.value)}
                placeholder="BBRUBEBB"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBankOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSaveBankDetails} disabled={bankLoading || !bankIban}>
                {bankLoading ? t('common.loading') : t('common.save')}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Buy Shares Dialog */}
      <Dialog open={buyOpen} onOpenChange={setBuyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('shares.buySharesTitle')}</DialogTitle>
            {!buySuccess && (
              <DialogDescription>{t('shares.scanToPayMessage')}</DialogDescription>
            )}
          </DialogHeader>
          {buySuccess && buyPaymentDetails ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>{t('shares.purchaseSubmitted')}</AlertDescription>
              </Alert>
              {buyPaymentDetails.iban && buyPaymentDetails.bic && (
                <div className="flex justify-center">
                  <EpcQrCode
                    bic={buyPaymentDetails.bic}
                    beneficiaryName={buyPaymentDetails.beneficiaryName}
                    iban={buyPaymentDetails.iban}
                    amount={buyPaymentDetails.amount}
                    reference={buyPaymentDetails.ogmCode}
                  />
                </div>
              )}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('payments.beneficiary')}</span>
                  <span className="font-medium">{buyPaymentDetails.beneficiaryName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('payments.iban')}</span>
                  <span className="font-mono text-xs">{formatIban(buyPaymentDetails.iban)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('common.amount')}</span>
                  <span className="font-medium">{formatCurrency(buyPaymentDetails.amount, locale)}</span>
                </div>
                {buyPaymentDetails.ogmCode && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('payments.ogmCode')}</span>
                    <span className="font-mono text-xs">{buyPaymentDetails.ogmCode}</span>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={() => setBuyOpen(false)}>{t('common.confirm')}</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              {buyError && (
                <Alert variant="destructive">
                  <AlertDescription>{buyError}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label>{t('shares.selectShareClass')}</Label>
                <Select value={buyShareClassId} onValueChange={setBuyShareClassId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {shareClasses.map((sc) => (
                      <SelectItem key={sc.id} value={sc.id}>
                        {sc.name} — {formatCurrency(Number(sc.pricePerShare), locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('shares.quantity')}</Label>
                <Input
                  type="number"
                  min={1}
                  value={buyQuantity}
                  onChange={(e) => setBuyQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </div>
              {buyShareClassId && (
                <div className="border-t pt-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('shares.totalCost')}</span>
                    <span className="font-bold">
                      {formatCurrency(
                        buyQuantity * Number(shareClasses.find((sc) => sc.id === buyShareClassId)?.pricePerShare || 0),
                        locale,
                      )}
                    </span>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setBuyOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleBuy} disabled={buyLoading || !buyShareClassId}>
                  {buyLoading ? t('common.loading') : t('shares.buyShares')}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Payment QR Dialog for AWAITING_PAYMENT shares */}
      <Dialog open={paymentQrOpen} onOpenChange={setPaymentQrOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('shares.awaitingPayment')}</DialogTitle>
            <DialogDescription>{t('shares.scanToPayMessage')}</DialogDescription>
          </DialogHeader>
          {paymentQrDetails && (
            <div className="space-y-4">
              {paymentQrDetails.iban && paymentQrDetails.bic && (
                <div className="flex justify-center">
                  <EpcQrCode
                    bic={paymentQrDetails.bic}
                    beneficiaryName={paymentQrDetails.beneficiaryName}
                    iban={paymentQrDetails.iban}
                    amount={paymentQrDetails.amount}
                    reference={paymentQrDetails.ogmCode}
                  />
                </div>
              )}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('payments.beneficiary')}</span>
                  <span className="font-medium">{paymentQrDetails.beneficiaryName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('payments.iban')}</span>
                  <span className="font-mono text-xs">{formatIban(paymentQrDetails.iban)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('common.amount')}</span>
                  <span className="font-medium">{formatCurrency(paymentQrDetails.amount, locale)}</span>
                </div>
                {paymentQrDetails.ogmCode && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('payments.ogmCode')}</span>
                    <span className="font-mono text-xs">{paymentQrDetails.ogmCode}</span>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={() => setPaymentQrOpen(false)}>{t('common.confirm')}</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Sell Shares Dialog */}
      <Dialog open={sellOpen} onOpenChange={setSellOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('shares.sellSharesTitle')}</DialogTitle>
            <DialogDescription>{t('shares.sellPriceNote')}</DialogDescription>
          </DialogHeader>
          {sellSuccess ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  {t('shares.sellRequestSubmitted')}. {t('shares.sellRequestPending')}
                </AlertDescription>
              </Alert>
              {shareholder?.bankIban && (
                <p className="text-sm text-muted-foreground">
                  {t('admin.transactions.refundToIban')}: <span className="font-mono">{formatIban(shareholder.bankIban)}</span>
                </p>
              )}
              <DialogFooter>
                <Button onClick={() => setSellOpen(false)}>{t('common.confirm')}</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              {sellError && (
                <Alert variant="destructive">
                  <AlertDescription>{sellError}</AlertDescription>
                </Alert>
              )}
              {selectedSellShare && (
                <>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{selectedSellShare.shareClass.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('shares.sellPrice')}: {formatCurrency(Number(selectedSellShare.purchasePricePerShare), locale)}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('shares.quantityToSell')}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={selectedSellShare.quantity}
                      value={sellQuantity}
                      onChange={(e) => setSellQuantity(Math.max(1, Math.min(selectedSellShare.quantity, parseInt(e.target.value) || 1)))}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('shares.maxQuantity', { max: selectedSellShare.quantity })}
                    </p>
                  </div>
                  <div className="border-t pt-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('shares.totalRefund')}</span>
                      <span className="font-bold">
                        {formatCurrency(sellQuantity * Number(selectedSellShare.purchasePricePerShare), locale)}
                      </span>
                    </div>
                    {shareholder?.bankIban && (
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-muted-foreground">{t('payments.iban')}</span>
                        <span className="font-mono text-xs">{formatIban(shareholder.bankIban)}</span>
                      </div>
                    )}
                  </div>
                </>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setSellOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleSell} disabled={sellLoading}>
                  {sellLoading ? t('common.loading') : t('shares.confirmSell')}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
