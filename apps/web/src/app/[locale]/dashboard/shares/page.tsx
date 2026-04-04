'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useLocale } from '@/contexts/locale-context';
import { useAdmin } from '@/contexts/admin-context';
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
import { api, apiFetch } from '@/lib/api';
import { EpcQrCode } from '@/components/epc-qr-code';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, formatIban } from '@opencoop/shared';
import { TrendingDown, QrCode, Gift, Download, FileDown, Pencil } from 'lucide-react';

interface RegistrationData {
  id: string;
  quantity: number;
  sharesOwned: number;
  pricePerShare: number;
  registerDate: string;
  status: string;
  ogmCode?: string;
  isGift?: boolean;
  giftCode?: string;
  giftClaimedAt?: string;
  giftClaimedByShareholder?: { id: string; firstName: string; lastName: string } | null;
  shareClass: { name: string; code: string };
  project?: { name: string } | null;
}

interface ShareholderData {
  id: string;
  bankIban?: string;
  bankBic?: string;
  registrations: RegistrationData[];
  coop?: {
    minimumHoldingPeriod?: number;
    name?: string;
    slug?: string;
    bankIban?: string;
    bankBic?: string;
  };
}

interface MinorShareholderData extends ShareholderData {
  firstName: string;
  lastName: string;
  birthDate?: string;
  phone?: string;
  address?: {
    street?: string;
    number?: string;
    postalCode?: string;
    city?: string;
    country?: string;
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
  quantity?: number;
}

// TransactionData no longer needed — registrations contain all necessary info

export default function SharesPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const { selectedCoop } = useAdmin();
  const searchParams = useSearchParams();
  const previewShareholderId = searchParams.get('previewShareholderId');
  const isPreviewMode = !!previewShareholderId;
  const [registrations, setRegistrations] = useState<RegistrationData[]>([]);
  const [shareholder, setShareholder] = useState<ShareholderData | null>(null);
  const [loading, setLoading] = useState(true);

  // Sell dialog state
  const [sellOpen, setSellOpen] = useState(false);
  const [sellRegistrationId, setSellRegistrationId] = useState('');
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

  // Payment QR dialog for PENDING_PAYMENT registrations
  const [paymentQrOpen, setPaymentQrOpen] = useState(false);
  const [paymentQrDetails, setPaymentQrDetails] = useState<PaymentDetailsData | null>(null);

  // Bank details dialog for when IBAN is missing
  const [bankOpen, setBankOpen] = useState(false);
  const [bankIban, setBankIban] = useState('');
  const [bankBic, setBankBic] = useState('');
  const [bankLoading, setBankLoading] = useState(false);

  // Certificate generation state
  const [generatingCertFor, setGeneratingCertFor] = useState<string | null>(null);

  // Minor shareholders
  const [minorShareholders, setMinorShareholders] = useState<MinorShareholderData[]>([]);

  // Child profile edit dialog state
  const [editChildOpen, setEditChildOpen] = useState(false);
  const [editChild, setEditChild] = useState<MinorShareholderData | null>(null);
  const [editChildForm, setEditChildForm] = useState({ firstName: '', lastName: '', birthDate: '', phone: '' });
  const [editChildSaving, setEditChildSaving] = useState(false);

  // Track which minor's buy/sell dialog is open
  const [activeMinorId, setActiveMinorId] = useState<string | null>(null);

  useEffect(() => {
    async function loadShares() {
      setLoading(true);
      try {
        if (isPreviewMode && previewShareholderId && selectedCoop) {
          const [preview, settings] = await Promise.all([
            api<{
              id: string;
              userId?: string;
              bankIban?: string;
              bankBic?: string;
              registrations: RegistrationData[];
            }>(`/admin/coops/${selectedCoop.id}/shareholders/${previewShareholderId}`),
            api<{
              name?: string;
              slug?: string;
              minimumHoldingPeriod?: number;
              bankIban?: string;
              bankBic?: string;
            }>(`/admin/coops/${selectedCoop.id}/settings`).catch(() => null),
          ]);

          const sh: ShareholderData = {
            id: preview.id,
            bankIban: preview.bankIban,
            bankBic: preview.bankBic,
            registrations: preview.registrations || [],
            coop: {
              minimumHoldingPeriod: settings?.minimumHoldingPeriod || 0,
              name: settings?.name || selectedCoop.name,
              slug: settings?.slug || selectedCoop.slug,
              bankIban: settings?.bankIban,
              bankBic: settings?.bankBic,
            },
          };

          setShareholder(sh);
          const buyRegs = (sh.registrations || []).filter(
            (r) => r.status === 'ACTIVE' || r.status === 'PENDING_PAYMENT' || r.status === 'COMPLETED',
          );
          setRegistrations(buyRegs);
          setShareClasses([]);

          // In preview mode, also load minors if admin
          if (selectedCoop && preview.userId) {
            try {
              const minors = await api<MinorShareholderData[]>(
                `/admin/coops/${selectedCoop.id}/shareholders/${previewShareholderId}/minors`,
              );
              setMinorShareholders(minors || []);
            } catch {
              // ignore
            }
          }
          return;
        }

        const profile = await api<{
          shareholders: ShareholderData[];
          minorShareholders?: MinorShareholderData[];
        }>('/auth/me');
        if (profile.shareholders?.[0]) {
          const sh = profile.shareholders[0];
          setShareholder(sh);
          // Show BUY registrations that represent owned or in-progress shares
          const buyRegs = (sh.registrations || []).filter(
            (r) => r.status === 'ACTIVE' || r.status === 'PENDING_PAYMENT' || r.status === 'COMPLETED',
          );
          setRegistrations(buyRegs);

          // Load share classes for buy dialog
          try {
            const sc = await api<ShareClassData[]>(`/shareholders/${sh.id}/share-classes`);
            setShareClasses(sc || []);
          } catch {
            // ignore
          }

          // Load minor shareholders
          if (profile.minorShareholders?.length) {
            setMinorShareholders(profile.minorShareholders);
          }
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadShares();
  }, [isPreviewMode, previewShareholderId, selectedCoop]);

  const statusVariant = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'default' as const;
      case 'COMPLETED': return 'default' as const;
      case 'PENDING': return 'secondary' as const;
      case 'PENDING_PAYMENT': return 'outline' as const;
      case 'CANCELLED': return 'destructive' as const;
      default: return 'outline' as const;
    }
  };

  const handleGenerateCertificate = async (regId: string) => {
    if (!shareholder) return;
    setGeneratingCertFor(regId);
    try {
      const doc = await api<{ id: string; filePath: string }>(
        `/shareholders/${shareholder.id}/generate-certificate/${regId}`,
        { method: 'POST', body: { locale: locale.split('-')[0] } },
      );
      const response = await apiFetch(
        `/shareholders/${shareholder.id}/documents/${doc.id}/download`,
      );
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filePath.split('/').pop() || 'certificate.pdf';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch {
      // ignore — download may fail if file not ready
    } finally {
      setGeneratingCertFor(null);
    }
  };

  const openSellDialog = (registrationId: string) => {
    setActiveMinorId(null);
    if (!shareholder?.bankIban) {
      // Prompt to add bank details first
      setBankIban(shareholder?.bankIban || '');
      setBankBic(shareholder?.bankBic || '');
      setBankOpen(true);
      return;
    }
    setSellRegistrationId(registrationId);
    setSellQuantity(1);
    setSellSuccess(false);
    setSellError('');
    setSellOpen(true);
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
        registration: { id: string };
        paymentDetails?: PaymentDetailsData;
      }>(`/shareholders/${activeMinorId || shareholder.id}/buy`, {
        method: 'POST',
        body: { shareClassId: buyShareClassId, quantity: buyQuantity },
      });
      setBuySuccess(true);
      if (result.paymentDetails) {
        setBuyPaymentDetails(result.paymentDetails);
      }
      // Reload registrations (including minors)
      const profile = await api<{
        shareholders: ShareholderData[];
        minorShareholders?: MinorShareholderData[];
      }>('/auth/me');
      if (profile.shareholders?.[0]) {
        const sh = profile.shareholders[0];
        setShareholder(sh);
        const buyRegs = (sh.registrations || []).filter(
          (r) => r.status === 'ACTIVE' || r.status === 'PENDING_PAYMENT' || r.status === 'COMPLETED',
        );
        setRegistrations(buyRegs);
      }
      if (profile.minorShareholders?.length) {
        setMinorShareholders(profile.minorShareholders);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.error');
      setBuyError(message);
    } finally {
      setBuyLoading(false);
    }
  };

  const handleSell = async () => {
    if (!shareholder || !sellRegistrationId) return;
    setSellLoading(true);
    setSellError('');
    try {
      await api(`/shareholders/${activeMinorId || shareholder.id}/sell-request`, {
        method: 'POST',
        body: { registrationId: sellRegistrationId, quantity: sellQuantity },
      });
      setSellSuccess(true);
      // Reload registrations (including minors)
      const profile = await api<{
        shareholders: ShareholderData[];
        minorShareholders?: MinorShareholderData[];
      }>('/auth/me');
      if (profile.shareholders?.[0]) {
        const sh = profile.shareholders[0];
        setShareholder(sh);
        const buyRegs = (sh.registrations || []).filter(
          (r) => r.status === 'ACTIVE' || r.status === 'PENDING_PAYMENT' || r.status === 'COMPLETED',
        );
        setRegistrations(buyRegs);
      }
      if (profile.minorShareholders?.length) {
        setMinorShareholders(profile.minorShareholders);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.error');
      setSellError(message);
    } finally {
      setSellLoading(false);
    }
  };

  const showPaymentForRegistration = (reg: RegistrationData) => {
    if (!shareholder?.coop) return;
    setPaymentQrDetails({
      beneficiaryName: shareholder.coop.name || '',
      iban: shareholder.coop.bankIban || '',
      bic: shareholder.coop.bankBic || '',
      amount: reg.quantity * Number(reg.pricePerShare),
      ogmCode: reg.ogmCode || '',
      quantity: reg.quantity,
    });
    setPaymentQrOpen(true);
  };

  const handleMinorBuy = async (minorId: string) => {
    setActiveMinorId(minorId);
    setBuyOpen(true);
    setBuySuccess(false);
    setBuyError('');
    setBuyPaymentDetails(null);
    setBuyShareClassId('');
    setBuyQuantity(1);

    try {
      const sc = await api<ShareClassData[]>(`/shareholders/${minorId}/share-classes`);
      setShareClasses(sc || []);
    } catch {
      setShareClasses([]);
    }
  };

  const handleMinorSellDialog = (minorId: string, registrationId: string) => {
    const minor = minorShareholders.find((m) => m.id === minorId);
    if (!minor?.bankIban) {
      setBankIban('');
      setBankBic('');
      setBankOpen(true);
      return;
    }
    setActiveMinorId(minorId);
    setSellRegistrationId(registrationId);
    setSellQuantity(1);
    setSellOpen(true);
    setSellSuccess(false);
    setSellError('');
  };

  const openEditChildDialog = (minor: MinorShareholderData) => {
    setEditChild(minor);
    setEditChildForm({
      firstName: minor.firstName || '',
      lastName: minor.lastName || '',
      birthDate: minor.birthDate ? minor.birthDate.split('T')[0] : '',
      phone: minor.phone || '',
    });
    setEditChildOpen(true);
  };

  const handleSaveChildProfile = async () => {
    if (!editChild) return;
    setEditChildSaving(true);
    try {
      await api(`/shareholders/${editChild.id}/profile`, {
        method: 'PUT',
        body: {
          firstName: editChildForm.firstName,
          lastName: editChildForm.lastName,
          birthDate: editChildForm.birthDate || undefined,
          phone: editChildForm.phone || undefined,
        },
      });
      // Reload minor shareholders data
      const profile = await api<{
        shareholders: ShareholderData[];
        minorShareholders?: MinorShareholderData[];
      }>('/auth/me');
      if (profile.minorShareholders?.length) {
        setMinorShareholders(profile.minorShareholders);
      }
      setEditChildOpen(false);
    } catch {
      // ignore
    } finally {
      setEditChildSaving(false);
    }
  };

  const selectedSellReg = registrations.find((r) => r.id === sellRegistrationId);

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
      {isPreviewMode && (
        <Alert className="mb-6">
          <AlertDescription>{t('shares.previewMode')}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('shares.myShares')}</CardTitle>
          {!isPreviewMode && shareClasses.length > 0 && (
            <Button onClick={() => {
              setActiveMinorId(null);
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
          {registrations.length === 0 ? (
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
                {registrations.map((reg) => (
                  <TableRow key={reg.id}>
                    <TableCell className="font-medium">
                      {reg.shareClass.name} ({reg.shareClass.code})
                    </TableCell>
                    <TableCell>{reg.project?.name || '-'}</TableCell>
                    <TableCell className="text-right">{reg.sharesOwned ?? reg.quantity}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(Number(reg.pricePerShare), locale)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency((reg.sharesOwned ?? reg.quantity) * Number(reg.pricePerShare), locale)}
                    </TableCell>
                    <TableCell>
                      {new Date(reg.registerDate).toLocaleDateString(locale)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={statusVariant(reg.status)}>{t(`transactions.statuses.${reg.status}`)}</Badge>
                        {reg.isGift && (
                          <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300 bg-amber-50">
                            <Gift className="h-3 w-3" />
                            {reg.giftClaimedAt
                              ? t('gift.badge.claimed', { name: `${reg.giftClaimedByShareholder?.firstName || ''} ${reg.giftClaimedByShareholder?.lastName || ''}`.trim() })
                              : reg.giftCode
                                ? t('gift.badge.awaitingClaim')
                                : t('gift.badge.awaitingPayment')
                            }
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {!isPreviewMode && reg.isGift && reg.giftCode && !reg.giftClaimedAt && shareholder && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            const res = await fetch(
                              `${process.env.NEXT_PUBLIC_API_URL || ''}/shareholders/${shareholder.id}/gift-certificate/${reg.id}`,
                              {
                                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
                              },
                            );
                            if (res.ok) {
                              const blob = await res.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `gift-certificate-${reg.giftCode}.pdf`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }
                          }}
                        >
                          <Download className="h-4 w-4 mr-1" />
                          {t('gift.downloadCertificate')}
                        </Button>
                      )}
                      {!isPreviewMode && reg.status === 'COMPLETED' && !reg.isGift && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleGenerateCertificate(reg.id)}
                          disabled={generatingCertFor === reg.id}
                        >
                          <FileDown className="h-4 w-4 mr-1" />
                          {t('common.certificate')}
                        </Button>
                      )}
                      {!isPreviewMode && (reg.status === 'ACTIVE' || reg.status === 'COMPLETED') && !reg.isGift && (() => {
                        const holdingMonths = shareholder?.coop?.minimumHoldingPeriod || 0;
                        const minDate = new Date(reg.registerDate);
                        minDate.setMonth(minDate.getMonth() + holdingMonths);
                        const canSell = holdingMonths === 0 || new Date() >= minDate;
                        return canSell ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openSellDialog(reg.id)}
                          >
                            <TrendingDown className="h-4 w-4 mr-1" />
                            {t('shares.sellBack')}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t('shares.reasonMinHoldingPeriod', { months: holdingMonths })}
                          </span>
                        );
                      })()}
                      {reg.status === 'PENDING_PAYMENT' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => showPaymentForRegistration(reg)}
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

      {/* Minor shareholder sections */}
      {minorShareholders.map((minor) => {
        const minorRegs = (minor.registrations || []).filter(
          (r) => r.status === 'ACTIVE' || r.status === 'PENDING_PAYMENT' || r.status === 'COMPLETED',
        );
        return (
          <Card key={minor.id} className="mt-6">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                {t('shares.childSharesOf', { name: `${minor.firstName} ${minor.lastName}` })}
                {!isPreviewMode && (
                  <Button variant="ghost" size="sm" onClick={() => openEditChildDialog(minor)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </CardTitle>
              {!isPreviewMode && (
                <Button onClick={() => handleMinorBuy(minor.id)}>
                  {t('shares.buyShares')}
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {minorRegs.length === 0 ? (
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
                    {minorRegs.map((reg) => (
                      <TableRow key={reg.id}>
                        <TableCell className="font-medium">
                          {reg.shareClass.name} ({reg.shareClass.code})
                        </TableCell>
                        <TableCell>{reg.project?.name || '-'}</TableCell>
                        <TableCell className="text-right">{reg.sharesOwned ?? reg.quantity}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(Number(reg.pricePerShare), locale)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency((reg.sharesOwned ?? reg.quantity) * Number(reg.pricePerShare), locale)}
                        </TableCell>
                        <TableCell>
                          {new Date(reg.registerDate).toLocaleDateString(locale)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(reg.status)}>{t(`transactions.statuses.${reg.status}`)}</Badge>
                        </TableCell>
                        <TableCell>
                          {!isPreviewMode && (reg.status === 'ACTIVE' || reg.status === 'COMPLETED') && (() => {
                            const holdingMonths = minor?.coop?.minimumHoldingPeriod || 0;
                            const minDate = new Date(reg.registerDate);
                            minDate.setMonth(minDate.getMonth() + holdingMonths);
                            const canSell = holdingMonths === 0 || new Date() >= minDate;
                            return canSell ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleMinorSellDialog(minor.id, reg.id)}
                              >
                                <TrendingDown className="h-4 w-4 mr-1" />
                                {t('shares.sellBack')}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {t('shares.reasonMinHoldingPeriod', { months: holdingMonths })}
                              </span>
                            );
                          })()}
                          {reg.status === 'PENDING_PAYMENT' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => showPaymentForRegistration(reg)}
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
        );
      })}

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
              {buyPaymentDetails.iban && (
                <div className="flex justify-center">
                  <EpcQrCode
                    bic={buyPaymentDetails.bic}
                    beneficiaryName={buyPaymentDetails.beneficiaryName}
                    iban={buyPaymentDetails.iban}
                    amount={buyPaymentDetails.amount}
                    reference={buyPaymentDetails.ogmCode}
                    unstructured={t('payments.sharePurchase', { quantity: buyPaymentDetails.quantity ?? '' })}
                    label={t('payments.sharePurchase', { quantity: buyPaymentDetails.quantity ?? '' })}
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

      {/* Payment QR Dialog for PENDING_PAYMENT registrations */}
      <Dialog open={paymentQrOpen} onOpenChange={setPaymentQrOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('shares.awaitingPayment')}</DialogTitle>
            <DialogDescription>{t('shares.scanToPayMessage')}</DialogDescription>
          </DialogHeader>
          {paymentQrDetails && (
            <div className="space-y-4">
              {paymentQrDetails.iban && (
                <div className="flex justify-center">
                  <EpcQrCode
                    bic={paymentQrDetails.bic}
                    beneficiaryName={paymentQrDetails.beneficiaryName}
                    iban={paymentQrDetails.iban}
                    amount={paymentQrDetails.amount}
                    reference={paymentQrDetails.ogmCode}
                    unstructured={t('payments.sharePurchase', { quantity: paymentQrDetails.quantity ?? '' })}
                    label={t('payments.sharePurchase', { quantity: paymentQrDetails.quantity ?? '' })}
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
              {selectedSellReg && (
                <>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{selectedSellReg.shareClass.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('shares.sellPrice')}: {formatCurrency(Number(selectedSellReg.pricePerShare), locale)}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('shares.quantityToSell')}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={selectedSellReg.sharesOwned ?? selectedSellReg.quantity}
                      value={sellQuantity}
                      onChange={(e) => setSellQuantity(Math.max(1, Math.min(selectedSellReg.sharesOwned ?? selectedSellReg.quantity, parseInt(e.target.value) || 1)))}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('shares.maxQuantity', { max: selectedSellReg.sharesOwned ?? selectedSellReg.quantity })}
                    </p>
                  </div>
                  <div className="border-t pt-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('shares.totalRefund')}</span>
                      <span className="font-bold">
                        {formatCurrency(sellQuantity * Number(selectedSellReg.pricePerShare), locale)}
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
      {/* Edit Child Profile Dialog */}
      <Dialog open={editChildOpen} onOpenChange={setEditChildOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editChild ? t('shares.childProfileTitle', { name: `${editChild.firstName} ${editChild.lastName}` }) : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('profile.firstName')}</Label>
                <Input
                  value={editChildForm.firstName}
                  onChange={(e) => setEditChildForm((f) => ({ ...f, firstName: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('profile.lastName')}</Label>
                <Input
                  value={editChildForm.lastName}
                  onChange={(e) => setEditChildForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('shares.birthDateLabel')} *</Label>
              <Input
                type="date"
                value={editChildForm.birthDate}
                onChange={(e) => setEditChildForm((f) => ({ ...f, birthDate: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t('profile.phone')}</Label>
              <Input
                value={editChildForm.phone}
                onChange={(e) => setEditChildForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditChildOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleSaveChildProfile}
                disabled={editChildSaving || !editChildForm.firstName || !editChildForm.lastName || !editChildForm.birthDate}
              >
                {editChildSaving ? t('common.loading') : t('common.save')}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
