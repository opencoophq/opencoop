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
import { formatCurrency, formatIban } from '@opencoop/shared';
import { TrendingDown } from 'lucide-react';

interface ShareData {
  id: string;
  quantity: number;
  purchasePricePerShare: number;
  purchaseDate: string;
  status: string;
  shareClass: { name: string; code: string };
  project?: { name: string } | null;
}

interface ShareholderData {
  id: string;
  bankIban?: string;
  bankBic?: string;
  shares: ShareData[];
  coop?: { minimumHoldingPeriod?: number };
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
                      {new Date(share.purchaseDate).toLocaleDateString(locale)}
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
