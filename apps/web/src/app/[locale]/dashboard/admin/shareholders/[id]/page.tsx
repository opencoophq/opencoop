'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from '@/i18n/routing';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { DatePicker } from '@/components/ui/date-picker';
import { formatCurrency, formatIban } from '@opencoop/shared';
import { EpcQrCode } from '@/components/epc-qr-code';
import { ChevronLeft, Save, Check, X, ShoppingCart, TrendingDown } from 'lucide-react';
import { api } from '@/lib/api';

interface ShareClass {
  id: string;
  name: string;
  code: string;
  pricePerShare: number;
}

interface Project {
  id: string;
  name: string;
}

interface Share {
  id: string;
  quantity: number;
  shareClass: {
    name: string;
    pricePerShare: number;
  };
  project?: {
    name: string;
  };
  purchaseDate: string;
  status: string;
}

interface Transaction {
  id: string;
  type: string;
  quantity: number;
  pricePerShare: number;
  status: string;
  createdAt: string;
}

interface ShareholderDetail {
  id: string;
  type: 'INDIVIDUAL' | 'COMPANY' | 'MINOR';
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE';
  firstName?: string;
  lastName?: string;
  companyName?: string;
  companyId?: string;
  vatNumber?: string;
  legalForm?: string;
  email?: string;
  phone?: string;
  nationalId?: string;
  birthDate?: string;
  bankIban?: string;
  bankBic?: string;
  address?: {
    street?: string;
    number?: string;
    box?: string;
    postalCode?: string;
    city?: string;
    country?: string;
  };
  shares: Share[];
  transactions: Transaction[];
  createdAt: string;
}

interface PaymentDetails {
  direction: 'incoming' | 'outgoing';
  beneficiaryName: string;
  iban: string;
  bic: string;
  amount: number;
  ogmCode: string;
}

const shareholderSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  birthDate: z.string().optional(),
  companyName: z.string().optional(),
  companyId: z.string().optional(),
  vatNumber: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  bankIban: z.string().optional(),
  bankBic: z.string().optional(),
  street: z.string().optional(),
  houseNumber: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE']),
});

type ShareholderForm = z.infer<typeof shareholderSchema>;

export default function ShareholderDetailPage() {
  const t = useTranslations();
  const params = useParams();
  const shareholderId = params.id as string;
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [shareholder, setShareholder] = useState<ShareholderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Buy dialog state
  const [buyOpen, setBuyOpen] = useState(false);
  const [shareClasses, setShareClasses] = useState<ShareClass[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [buyShareClassId, setBuyShareClassId] = useState('');
  const [buyQuantity, setBuyQuantity] = useState(1);
  const [buyProjectId, setBuyProjectId] = useState('');
  const [buyLoading, setBuyLoading] = useState(false);
  const [buyResult, setBuyResult] = useState<PaymentDetails | null>(null);

  // Sell dialog state
  const [sellOpen, setSellOpen] = useState(false);
  const [sellShareId, setSellShareId] = useState('');
  const [sellQuantity, setSellQuantity] = useState(1);
  const [sellLoading, setSellLoading] = useState(false);

  const form = useForm<ShareholderForm>({
    resolver: zodResolver(shareholderSchema),
    defaultValues: {
      status: 'ACTIVE',
    },
  });

  const fetchShareholder = useCallback(async () => {
    if (!selectedCoop || !shareholderId) return;
    try {
      const data = await api<ShareholderDetail>(
        `/admin/coops/${selectedCoop.id}/shareholders/${shareholderId}`,
      );
      setShareholder(data);
      const addr = data.address || {};
      form.reset({
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        birthDate: data.birthDate ? data.birthDate.split('T')[0] : '',
        companyName: data.companyName || '',
        companyId: data.companyId || '',
        vatNumber: data.vatNumber || '',
        email: data.email || '',
        phone: data.phone || '',
        bankIban: data.bankIban || '',
        bankBic: data.bankBic || '',
        street: addr.street || '',
        houseNumber: addr.number || '',
        postalCode: addr.postalCode || '',
        city: addr.city || '',
        country: addr.country || '',
        status: data.status,
      });
    } catch {
      setError(t('common.error'));
    }
  }, [selectedCoop, shareholderId, form, t]);

  useEffect(() => {
    if (!selectedCoop || !shareholderId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchShareholder().finally(() => setLoading(false));
  }, [selectedCoop, shareholderId, fetchShareholder]);

  const onSubmit = async (data: ShareholderForm) => {
    if (!selectedCoop || !shareholderId) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Transform flat form fields to match backend DTO structure
      const { street, houseNumber, postalCode, city, country, email, bankIban, bankBic, birthDate, ...rest } = data;

      const body: Record<string, unknown> = { ...rest };

      // Only send email if non-empty (backend rejects empty string with @IsEmail)
      if (email) body.email = email;

      // Only send bank fields if non-empty
      if (bankIban) body.bankIban = bankIban;
      if (bankBic) body.bankBic = bankBic;

      // Only send birthDate if non-empty
      if (birthDate) body.birthDate = birthDate;

      // Convert flat address fields to nested object
      if (street || houseNumber || postalCode || city || country) {
        body.address = {
          street: street || '',
          number: houseNumber || '',
          postalCode: postalCode || '',
          city: city || '',
          country: country || '',
        };
      }

      const updated = await api<ShareholderDetail>(
        `/admin/coops/${selectedCoop.id}/shareholders/${shareholderId}`,
        { method: 'PUT', body },
      );
      setSuccess(t('common.savedSuccessfully'));
      setShareholder(updated);
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const reloadShareholder = async () => {
    await fetchShareholder();
  };

  const handleApprove = async (txId: string) => {
    if (!selectedCoop) return;
    await api(`/admin/coops/${selectedCoop.id}/transactions/${txId}/approve`, { method: 'PUT' });
    reloadShareholder();
  };

  const handleReject = async (txId: string) => {
    if (!selectedCoop) return;
    const reason = prompt(t('transactions.rejectReason'));
    if (!reason) return;
    await api(`/admin/coops/${selectedCoop.id}/transactions/${txId}/reject`, {
      method: 'PUT',
      body: { reason },
    });
    reloadShareholder();
  };

  const openBuyDialog = async () => {
    if (!selectedCoop) return;
    try {
      const [scData, pData] = await Promise.all([
        api<ShareClass[]>(`/admin/coops/${selectedCoop.id}/share-classes`),
        api<Project[]>(`/admin/coops/${selectedCoop.id}/projects`),
      ]);
      setShareClasses(scData.filter((sc: ShareClass) => sc.pricePerShare));
      setProjects(pData);
      setBuyShareClassId(scData[0]?.id || '');
      setBuyQuantity(1);
      setBuyProjectId('');
      setBuyResult(null);
      setBuyOpen(true);
    } catch {
      setError(t('common.error'));
    }
  };

  const handleBuy = async () => {
    if (!selectedCoop || !buyShareClassId) return;
    setBuyLoading(true);
    try {
      const tx = await api<{ id: string }>(
        `/admin/coops/${selectedCoop.id}/shareholders/${shareholderId}/purchase`,
        {
          method: 'POST',
          body: {
            shareClassId: buyShareClassId,
            quantity: buyQuantity,
            ...(buyProjectId && buyProjectId !== 'none' && { projectId: buyProjectId }),
          },
        },
      );
      // Get payment details for QR code
      const details = await api<PaymentDetails>(
        `/admin/coops/${selectedCoop.id}/transactions/${tx.id}/payment-details`,
      );
      setBuyResult(details);
      reloadShareholder();
    } catch {
      setError(t('common.error'));
      setBuyOpen(false);
    } finally {
      setBuyLoading(false);
    }
  };

  const openSellDialog = () => {
    const activeShares = shareholder?.shares.filter((s) => s.status === 'ACTIVE') || [];
    setSellShareId(activeShares[0]?.id || '');
    setSellQuantity(1);
    setSellOpen(true);
  };

  const handleSell = async () => {
    if (!selectedCoop || !sellShareId) return;
    setSellLoading(true);
    try {
      await api(
        `/admin/coops/${selectedCoop.id}/shareholders/${shareholderId}/sell`,
        {
          method: 'POST',
          body: { shareId: sellShareId, quantity: sellQuantity },
        },
      );
      setSellOpen(false);
      setSuccess(t('shares.sellRequestSubmitted'));
      reloadShareholder();
    } catch {
      setError(t('common.error'));
    } finally {
      setSellLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(locale);
  };

  const fmtCurrency = (amount: number) => formatCurrency(amount, locale);

  const selectedShareClass = shareClasses.find((sc) => sc.id === buyShareClassId);
  const buyTotal = (selectedShareClass?.pricePerShare || 0) * buyQuantity;
  const activeShares = shareholder?.shares.filter((s) => s.status === 'ACTIVE') || [];
  const selectedSellShare = shareholder?.shares.find((s) => s.id === sellShareId);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="h-64 bg-muted rounded-lg" />
        </div>
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

  if (!shareholder) {
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
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/admin/shareholders">
            <ChevronLeft className="h-4 w-4 mr-1" />
            {t('common.back')}
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{t('admin.shareholderDetail.title')}</h1>
          <p className="text-muted-foreground">
            {shareholder.type === 'COMPANY'
              ? shareholder.companyName
              : `${shareholder.firstName || ''} ${shareholder.lastName || ''}`.trim()}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openBuyDialog}>
            <ShoppingCart className="h-4 w-4 mr-2" />
            {t('shares.buyMore')}
          </Button>
          <Button variant="outline" onClick={openSellDialog} disabled={activeShares.length === 0}>
            <TrendingDown className="h-4 w-4 mr-2" />
            {t('shares.sellShares')}
          </Button>
        </div>
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

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Personal/Company Info */}
        <Card>
          <CardHeader>
            <CardTitle>
              {shareholder.type === 'COMPANY'
                ? t('shareholder.fields.companyName')
                : t('admin.shareholderDetail.personalInfo')}
            </CardTitle>
            <CardDescription>
              <Badge>
                {t(`shareholder.type.${shareholder.type.toLowerCase()}`)}
              </Badge>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {shareholder.type === 'COMPANY' ? (
                <>
                  <div className="space-y-2">
                    <Label>{t('shareholder.fields.companyName')}</Label>
                    <Input {...form.register('companyName')} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('shareholder.fields.companyId')}</Label>
                    <Input {...form.register('companyId')} placeholder="0XXX.XXX.XXX" />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('shareholder.fields.vatNumber')}</Label>
                    <Input {...form.register('vatNumber')} placeholder="BE0XXX.XXX.XXX" />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>{t('shareholder.fields.firstName')}</Label>
                      <Input {...form.register('firstName')} />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('shareholder.fields.lastName')}</Label>
                      <Input {...form.register('lastName')} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('shareholder.fields.birthDate')}</Label>
                    <DatePicker
                      value={form.watch('birthDate')}
                      onChange={(value) => form.setValue('birthDate', value || '')}
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label>{t('common.status')}</Label>
                <Select
                  value={form.watch('status')}
                  onValueChange={(value) =>
                    form.setValue('status', value as 'PENDING' | 'ACTIVE' | 'INACTIVE')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">{t('shareholder.status.active')}</SelectItem>
                    <SelectItem value="PENDING">{t('shareholder.status.pending')}</SelectItem>
                    <SelectItem value="INACTIVE">{t('shareholder.status.inactive')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? t('common.loading') : t('admin.shareholderDetail.saveChanges')}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Contact Info */}
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.shareholderDetail.contactInfo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label>{t('common.email')}</Label>
                <Input type="email" {...form.register('email')} />
              </div>
              <div className="space-y-2">
                <Label>{t('common.phone')}</Label>
                <Input {...form.register('phone')} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-2">
                  <Label>{t('common.street')}</Label>
                  <Input {...form.register('street')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('common.houseNumber')}</Label>
                  <Input {...form.register('houseNumber')} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('common.postalCode')}</Label>
                  <Input {...form.register('postalCode')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('common.city')}</Label>
                  <Input {...form.register('city')} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('common.country')}</Label>
                <Input {...form.register('country')} />
              </div>

              <div className="border-t pt-4 mt-4">
                <h4 className="text-sm font-medium mb-3">{t('payments.bankDetails')}</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('payments.iban')}</Label>
                    <Input {...form.register('bankIban')} placeholder="BE68 5390 0754 7034" />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('payments.bic')}</Label>
                    <Input {...form.register('bankBic')} placeholder="BBRUBEBB" />
                  </div>
                </div>
              </div>

              <Button type="submit" disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? t('common.loading') : t('admin.shareholderDetail.saveChanges')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Shareholdings */}
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.shareholderDetail.shareholdings')}</CardTitle>
        </CardHeader>
        <CardContent>
          {shareholder.shares.length === 0 ? (
            <p className="text-muted-foreground">{t('common.noResults')}</p>
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
                {shareholder.shares.map((share) => (
                  <TableRow key={share.id}>
                    <TableCell>{share.shareClass.name}</TableCell>
                    <TableCell>{share.project?.name || '-'}</TableCell>
                    <TableCell className="text-right">{share.quantity}</TableCell>
                    <TableCell className="text-right">
                      {fmtCurrency(share.shareClass.pricePerShare)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtCurrency(share.quantity * share.shareClass.pricePerShare)}
                    </TableCell>
                    <TableCell>{formatDate(share.purchaseDate)}</TableCell>
                    <TableCell>
                      <Badge variant={share.status === 'ACTIVE' ? 'default' : 'secondary'}>
                        {t(`shares.status.${share.status.toLowerCase()}`)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.shareholderDetail.transactionHistory')}</CardTitle>
        </CardHeader>
        <CardContent>
          {shareholder.transactions.length === 0 ? (
            <p className="text-muted-foreground">{t('transactions.noTransactions')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.date')}</TableHead>
                  <TableHead>{t('transactions.title')}</TableHead>
                  <TableHead className="text-right">{t('shares.quantity')}</TableHead>
                  <TableHead className="text-right">{t('shares.pricePerShare')}</TableHead>
                  <TableHead className="text-right">{t('common.amount')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shareholder.transactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell>{formatDate(transaction.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {t(`transactions.types.${transaction.type}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{transaction.quantity}</TableCell>
                    <TableCell className="text-right">
                      {fmtCurrency(transaction.pricePerShare)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtCurrency(transaction.quantity * transaction.pricePerShare)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          transaction.status === 'COMPLETED'
                            ? 'default'
                            : transaction.status === 'REJECTED'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {t(`transactions.statuses.${transaction.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {transaction.status === 'PENDING' && (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleApprove(transaction.id)}>
                            <Check className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleReject(transaction.id)}>
                            <X className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Buy Shares Dialog */}
      <Dialog open={buyOpen} onOpenChange={setBuyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('shares.buyMore')}</DialogTitle>
            <DialogDescription>{t('shares.buyMoreDescription')}</DialogDescription>
          </DialogHeader>

          {buyResult ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>{t('common.success')}</AlertDescription>
              </Alert>
              <div className="flex justify-center">
                <EpcQrCode
                  bic={buyResult.bic}
                  beneficiaryName={buyResult.beneficiaryName}
                  iban={buyResult.iban}
                  amount={buyResult.amount}
                  reference={buyResult.ogmCode}
                />
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('payments.beneficiary')}</span>
                  <span className="font-medium">{buyResult.beneficiaryName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('payments.iban')}</span>
                  <span className="font-mono text-xs">{formatIban(buyResult.iban)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('common.amount')}</span>
                  <span className="font-medium">{fmtCurrency(buyResult.amount)}</span>
                </div>
                {buyResult.ogmCode && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('payments.ogmCode')}</span>
                    <span className="font-mono text-xs">{buyResult.ogmCode}</span>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={() => setBuyOpen(false)}>{t('common.confirm')}</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('shares.shareClass')}</Label>
                <Select value={buyShareClassId} onValueChange={setBuyShareClassId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {shareClasses.map((sc) => (
                      <SelectItem key={sc.id} value={sc.id}>
                        {sc.name} ({sc.code}) - {fmtCurrency(Number(sc.pricePerShare))}
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
              {projects.length > 0 && (
                <div className="space-y-2">
                  <Label>{t('shares.project')}</Label>
                  <Select value={buyProjectId} onValueChange={setBuyProjectId}>
                    <SelectTrigger>
                      <SelectValue placeholder="-" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-</SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="border-t pt-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('common.total')}</span>
                  <span className="font-bold">{fmtCurrency(buyTotal)}</span>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setBuyOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleBuy} disabled={buyLoading || !buyShareClassId}>
                  {buyLoading ? t('common.loading') : t('common.confirm')}
                </Button>
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
            <DialogDescription>{t('shares.selectSharesToSell')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('shares.shareClass')}</Label>
              <Select value={sellShareId} onValueChange={(v) => { setSellShareId(v); setSellQuantity(1); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activeShares.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.shareClass.name} - {s.quantity} {t('shares.quantity').toLowerCase()} ({fmtCurrency(s.shareClass.pricePerShare)}/ea)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('shares.quantityToSell')}</Label>
              <Input
                type="number"
                min={1}
                max={selectedSellShare?.quantity || 1}
                value={sellQuantity}
                onChange={(e) => setSellQuantity(Math.max(1, Math.min(selectedSellShare?.quantity || 1, parseInt(e.target.value) || 1)))}
              />
              {selectedSellShare && (
                <p className="text-xs text-muted-foreground">
                  {t('shares.maxQuantity', { max: selectedSellShare.quantity })}
                </p>
              )}
            </div>
            {selectedSellShare && (
              <div className="border-t pt-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('shares.totalRefund')}</span>
                  <span className="font-bold">
                    {fmtCurrency(sellQuantity * selectedSellShare.shareClass.pricePerShare)}
                  </span>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setSellOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSell} disabled={sellLoading || !sellShareId}>
                {sellLoading ? t('common.loading') : t('shares.confirmSell')}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
