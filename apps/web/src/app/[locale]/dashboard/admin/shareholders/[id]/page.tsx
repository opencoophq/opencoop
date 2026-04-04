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
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronLeft, Save, Check, X, ShoppingCart, TrendingDown, FileDown, QrCode, CreditCard, ExternalLink, MessageSquare, Loader2 } from 'lucide-react';
import { api, apiFetch } from '@/lib/api';

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

interface Registration {
  id: string;
  type: string;
  quantity: number;
  sharesOwned: number;
  pricePerShare: number;
  registerDate: string;
  status: string;
  createdAt: string;
  totalAmount: number;
  shareClass: {
    name: string;
    pricePerShare: number;
  };
  project?: {
    name: string;
  };
  payments?: { bankDate: string; amount: number }[];
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
  isEcoPowerClient?: boolean;
  ecoPowerId?: string;
  registeredByUserId?: string;
  userId?: string;
  registrations: Registration[];
  createdAt: string;
}

interface ParentShareholder {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  userId?: string;
}

interface PaymentDetails {
  direction: 'incoming' | 'outgoing';
  beneficiaryName: string;
  iban: string;
  bic: string;
  amount: number;
  ogmCode: string;
  quantity?: number;
}

interface AuditLogChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

interface AuditLog {
  id: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  changes: AuditLogChange[];
  actorEmail?: string;
  createdAt: string;
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

  // Certificate generation state
  const [generatingCertFor, setGeneratingCertFor] = useState<string | null>(null);

  // Ecopower state
  const [ecoPowerEnabled, setEcoPowerEnabled] = useState(false);
  const [isEcoPowerClient, setIsEcoPowerClient] = useState(false);
  const [ecoPowerId, setEcoPowerId] = useState('');

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
  const [sellRegistrationId, setSellRegistrationId] = useState('');
  const [sellQuantity, setSellQuantity] = useState(1);
  const [sellLoading, setSellLoading] = useState(false);
  const [sellResult, setSellResult] = useState<PaymentDetails | null>(null);

  // Payment details dialog state
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

  // Type management state
  const [shareholderType, setShareholderType] = useState<'INDIVIDUAL' | 'COMPANY' | 'MINOR'>('INDIVIDUAL');
  const [parentSearch, setParentSearch] = useState('');
  const [parentResults, setParentResults] = useState<ParentShareholder[]>([]);
  const [selectedParent, setSelectedParent] = useState<ParentShareholder | null>(null);
  const [parentSearchLoading, setParentSearchLoading] = useState(false);

  // Audit log state
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Send message dialog state
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageSubject, setMessageSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [messageSending, setMessageSending] = useState(false);

  const form = useForm<ShareholderForm>({
    resolver: zodResolver(shareholderSchema),
    defaultValues: {
      status: 'ACTIVE',
    },
  });

  const fetchShareholder = useCallback(async () => {
    if (!selectedCoop || !shareholderId) return;
    try {
      // Fetch coop settings for Ecopower integration status
      const settings = await api<{ ecoPowerEnabled: boolean }>(
        `/admin/coops/${selectedCoop.id}/settings`,
      );
      setEcoPowerEnabled(settings.ecoPowerEnabled || false);
      const data = await api<ShareholderDetail>(
        `/admin/coops/${selectedCoop.id}/shareholders/${shareholderId}`,
      );
      setShareholder(data);
      setShareholderType(data.type);
      setIsEcoPowerClient(data.isEcoPowerClient || false);
      setEcoPowerId(data.ecoPowerId || '');
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

  useEffect(() => {
    if (!selectedCoop || !shareholderId) return;
    setAuditLoading(true);
    api<{ items: AuditLog[] }>(
      `/admin/coops/${selectedCoop.id}/audit-logs?entity=Shareholder&entityId=${shareholderId}&limit=50`,
    )
      .then((res) => setAuditLogs(Array.isArray(res) ? res : res.items ?? []))
      .catch(() => setAuditLogs([]))
      .finally(() => setAuditLoading(false));
  }, [selectedCoop, shareholderId]);

  // Search for parent/guardian shareholders when setting MINOR type
  useEffect(() => {
    if (!selectedCoop || shareholderType !== 'MINOR' || parentSearch.length < 2) {
      setParentResults([]);
      return;
    }

    const timeout = setTimeout(async () => {
      setParentSearchLoading(true);
      try {
        const res = await api<{ items: ParentShareholder[] }>(
          `/admin/coops/${selectedCoop.id}/shareholders?search=${encodeURIComponent(parentSearch)}&type=INDIVIDUAL&pageSize=10`,
        );
        // Exclude the current shareholder from results
        setParentResults((res.items || []).filter((s) => s.id !== shareholderId));
      } catch {
        setParentResults([]);
      } finally {
        setParentSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [selectedCoop, parentSearch, shareholderType, shareholderId]);

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

      // Include type if changed
      if (shareholderType !== shareholder?.type) {
        body.type = shareholderType;
      }

      // Include parent/guardian for MINOR type.
      // Backend resolves/creates parent user account when needed.
      if (shareholderType === 'MINOR' && selectedParent) {
        body.registeredByShareholderId = selectedParent.id;
      } else if (shareholderType !== 'MINOR' && shareholder?.type === 'MINOR') {
        body.registeredByUserId = null;
      }

      if (ecoPowerEnabled) {
        body.isEcoPowerClient = isEcoPowerClient;
        body.ecoPowerId = ecoPowerId || null;
      }

      const updated = await api<ShareholderDetail>(
        `/admin/coops/${selectedCoop.id}/shareholders/${shareholderId}`,
        { method: 'PUT', body },
      );
      setSuccess(t('common.savedSuccessfully'));
      setShareholder(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const reloadShareholder = async () => {
    await fetchShareholder();
  };

  const handleSendMessage = async () => {
    if (!selectedCoop || !messageSubject.trim() || !messageBody.trim()) return;
    setMessageSending(true);
    setError(null);
    try {
      await api(`/admin/coops/${selectedCoop.id}/conversations`, {
        method: 'POST',
        body: {
          type: 'DIRECT',
          subject: messageSubject.trim(),
          body: messageBody.trim(),
          shareholderId,
        },
      });
      setSuccess(t('messages.messageSent'));
      setMessageOpen(false);
      setMessageSubject('');
      setMessageBody('');
    } catch {
      setError(t('common.error'));
    } finally {
      setMessageSending(false);
    }
  };

  const handleApprove = async (txId: string) => {
    if (!selectedCoop) return;
    await api(`/admin/coops/${selectedCoop.id}/registrations/${txId}/approve`, { method: 'PUT' });
    reloadShareholder();
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
      reloadShareholder();
    } catch {
      setError(t('common.actionError'));
    } finally {
      setCompleting(false);
    }
  };

  const openRejectDialog = (txId: string) => {
    setRejectTxId(txId);
    setRejectReason('');
    setRejectOpen(true);
  };

  const handleReject = async () => {
    if (!selectedCoop || !rejectTxId || !rejectReason.trim()) return;
    await api(`/admin/coops/${selectedCoop.id}/registrations/${rejectTxId}/reject`, {
      method: 'PUT',
      body: { reason: rejectReason.trim() },
    });
    setRejectOpen(false);
    reloadShareholder();
  };

  const handleGenerateCertificate = async (regId: string) => {
    if (!selectedCoop) return;
    setGeneratingCertFor(regId);
    try {
      const doc = await api<{ id: string; filePath: string }>(
        `/admin/coops/${selectedCoop.id}/registrations/${regId}/certificate`,
        { method: 'POST' },
      );
      setSuccess(t('personalData.generateCertificate') + ' ✓');
      reloadShareholder();

      // Immediately download the generated certificate
      try {
        const response = await apiFetch(
          `/admin/coops/${selectedCoop.id}/documents/${doc.id}/download`,
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
        // Certificate was generated successfully, but download failed — not critical
      }
    } catch {
      setError(t('common.error'));
    } finally {
      setGeneratingCertFor(null);
    }
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
      const reg = await api<{ id: string }>(
        `/admin/coops/${selectedCoop.id}/shareholders/${shareholderId}/buy`,
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
        `/admin/coops/${selectedCoop.id}/registrations/${reg.id}/payment-details`,
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
    const activeRegs = shareholder?.registrations.filter((r) => r.type === 'BUY' && (r.status === 'ACTIVE' || r.status === 'COMPLETED') && (r.sharesOwned ?? r.quantity) > 0) || [];
    setSellRegistrationId(activeRegs[0]?.id || '');
    setSellQuantity(1);
    setSellResult(null);
    setSellOpen(true);
  };

  const handleSell = async () => {
    if (!selectedCoop || !sellRegistrationId) return;
    setSellLoading(true);
    try {
      const reg = await api<{ id: string }>(
        `/admin/coops/${selectedCoop.id}/shareholders/${shareholderId}/sell`,
        {
          method: 'POST',
          body: { registrationId: sellRegistrationId, quantity: sellQuantity },
        },
      );
      // Get payment details for QR code
      const details = await api<PaymentDetails>(
        `/admin/coops/${selectedCoop.id}/registrations/${reg.id}/payment-details`,
      );
      setSellResult(details);
      reloadShareholder();
    } catch {
      setError(t('common.error'));
      setSellOpen(false);
    } finally {
      setSellLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(locale);
  };

  const fmtCurrency = (amount: number) => formatCurrency(amount, locale);

  const getPaymentDate = (reg: Registration): string | null => {
    if (!reg.payments?.length) return null;
    return reg.payments[reg.payments.length - 1].bankDate;
  };

  const [editingDateId, setEditingDateId] = useState<string | null>(null);

  const handleInlineDateSave = async (regId: string, newDate: string) => {
    if (!selectedCoop || !newDate) return;
    try {
      await api(`/admin/coops/${selectedCoop.id}/registrations/${regId}/payment-date`, {
        method: 'PATCH',
        body: { bankDate: newDate },
      });
      setEditingDateId(null);
      reloadShareholder();
    } catch {
      setError(t('common.actionError'));
    }
  };

  const selectedShareClass = shareClasses.find((sc) => sc.id === buyShareClassId);
  const buyTotal = (selectedShareClass?.pricePerShare || 0) * buyQuantity;
  const activeRegs = shareholder?.registrations.filter((r) => r.type === 'BUY' && (r.status === 'ACTIVE' || r.status === 'COMPLETED') && (r.sharesOwned ?? r.quantity) > 0) || [];
  const selectedSellReg = shareholder?.registrations.find((r) => r.id === sellRegistrationId);

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
          <Button asChild variant="secondary">
            <Link href={`/dashboard/shares?previewShareholderId=${shareholder.id}`}>
              <ExternalLink className="h-4 w-4 mr-2" />
              {t('admin.shareholderDetail.viewAsShareholder')}
            </Link>
          </Button>
          <Button variant="outline" onClick={() => { setError(null); setMessageOpen(true); }}>
            <MessageSquare className="h-4 w-4 mr-2" />
            {t('messages.newConversation')}
          </Button>
          <Button variant="outline" onClick={openBuyDialog}>
            <ShoppingCart className="h-4 w-4 mr-2" />
            {t('shares.buyMore')}
          </Button>
          <Button variant="outline" onClick={openSellDialog} disabled={activeRegs.length === 0}>
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

      <form onSubmit={form.handleSubmit(onSubmit)}>
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
                {shareholder.type !== shareholderType && (
                  <Badge variant="outline">
                    {t(`shareholder.type.${shareholder.type.toLowerCase()}`)} → {t(`shareholder.type.${shareholderType.toLowerCase()}`)}
                  </Badge>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t('shareholder.type.label')}</Label>
                <Select
                  value={shareholderType}
                  onValueChange={(value) => {
                    setShareholderType(value as 'INDIVIDUAL' | 'COMPANY' | 'MINOR');
                    if (value !== 'MINOR') {
                      setSelectedParent(null);
                      setParentSearch('');
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INDIVIDUAL">{t('shareholder.type.individual')}</SelectItem>
                    <SelectItem value="COMPANY">{t('shareholder.type.company')}</SelectItem>
                    <SelectItem value="MINOR">{t('shareholder.type.minor')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {shareholderType === 'COMPANY' ? (
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
                      captionLayout="dropdown"
                      fromYear={1920}
                      toYear={new Date().getFullYear()}
                    />
                  </div>
                </>
              )}

              {shareholderType === 'MINOR' && (
                <div className="space-y-2">
                  <Label>{t('shareholder.fields.parentGuardian')}</Label>
                  {selectedParent ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 rounded-md border p-2">
                        <span className="flex-1 text-sm">
                          {selectedParent.firstName} {selectedParent.lastName}
                          {selectedParent.email && (
                            <span className="text-muted-foreground"> ({selectedParent.email})</span>
                          )}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedParent(null);
                            setParentSearch('');
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      {!selectedParent.email && (
                        <p className="text-destructive text-xs">
                          {t('shareholder.fields.parentNoAccount')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Input
                        placeholder={t('shareholder.fields.searchParent')}
                        value={parentSearch}
                        onChange={(e) => setParentSearch(e.target.value)}
                      />
                      {parentSearchLoading && (
                        <p className="text-muted-foreground text-xs">{t('common.loading')}</p>
                      )}
                      {parentResults.length > 0 && (
                        <div className="rounded-md border">
                          {parentResults.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              className="hover:bg-muted w-full px-3 py-2 text-left text-sm"
                              onClick={() => {
                                setSelectedParent(p);
                                setParentSearch('');
                                setParentResults([]);
                              }}
                            >
                              {p.firstName} {p.lastName}
                              {p.email && (
                                <span className="text-muted-foreground"> ({p.email})</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {shareholder?.registeredByUserId && !selectedParent && (
                    <p className="text-muted-foreground text-xs">
                      {t('shareholder.fields.currentParentLinked')}
                    </p>
                  )}
                </div>
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
            </CardContent>
          </Card>

          {/* Contact Info */}
          <Card>
            <CardHeader>
              <CardTitle>{t('admin.shareholderDetail.contactInfo')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('payments.iban')}</Label>
                    <Input {...form.register('bankIban')} placeholder="e.g. BE68 5390 0754 7034" />
                    <p className="text-xs text-muted-foreground">{t('payments.ibanExampleHint')}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('payments.bic')}</Label>
                    <Input {...form.register('bankBic')} placeholder="e.g. BBRUBEBB" />
                    <p className="text-xs text-muted-foreground">{t('payments.bicExampleHint')}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6">
          <Button type="submit" disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? t('common.loading') : t('admin.shareholderDetail.saveChanges')}
          </Button>
        </div>
      </form>

      {/* Ecopower Integration */}
      {ecoPowerEnabled && (
        <Card>
          <CardHeader>
            <CardTitle>{t('ecopower.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={isEcoPowerClient}
                onCheckedChange={(c) => setIsEcoPowerClient(!!c)}
              />
              <Label>{t('ecopower.client')}</Label>
            </div>
            <div className="space-y-2">
              <Label>{t('ecopower.ecoPowerId')}</Label>
              <Input
                value={ecoPowerId}
                onChange={(e) => setEcoPowerId(e.target.value)}
                placeholder={t('ecopower.ecoPowerIdPlaceholder')}
                disabled={!isEcoPowerClient}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Shareholdings */}
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.shareholderDetail.shareholdings')}</CardTitle>
        </CardHeader>
        <CardContent>
          {shareholder.registrations.filter((r) => r.type === 'BUY' && (r.status === 'ACTIVE' || r.status === 'COMPLETED') && (r.sharesOwned ?? r.quantity) > 0).length === 0 ? (
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
                  <TableHead>{t('transactions.registrationDate')}</TableHead>
                  <TableHead>{t('payments.paymentDate')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shareholder.registrations
                  .filter((reg) => reg.type === 'BUY' && (reg.status === 'ACTIVE' || reg.status === 'COMPLETED') && (reg.sharesOwned ?? reg.quantity) > 0)
                  .map((reg) => {
                    const payDate = getPaymentDate(reg);
                    return (
                      <TableRow key={reg.id}>
                        <TableCell>{reg.shareClass.name}</TableCell>
                        <TableCell>{reg.project?.name || '-'}</TableCell>
                        <TableCell className="text-right">{reg.sharesOwned ?? reg.quantity}</TableCell>
                        <TableCell className="text-right">
                          {fmtCurrency(reg.shareClass.pricePerShare)}
                        </TableCell>
                        <TableCell className="text-right">
                          {fmtCurrency((reg.sharesOwned ?? reg.quantity) * reg.shareClass.pricePerShare)}
                        </TableCell>
                        <TableCell>{formatDate(reg.registerDate)}</TableCell>
                        <TableCell>
                          {reg.status === 'COMPLETED' && editingDateId === reg.id ? (
                            <Input
                              type="date"
                              className="w-36 h-8"
                              defaultValue={payDate ? new Date(payDate).toISOString().split('T')[0] : ''}
                              autoFocus
                              onBlur={(e) => {
                                if (e.target.value) handleInlineDateSave(reg.id, e.target.value);
                                else setEditingDateId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                if (e.key === 'Escape') setEditingDateId(null);
                              }}
                            />
                          ) : (
                            <span
                              className={reg.status === 'COMPLETED' ? 'cursor-pointer hover:underline' : ''}
                              onClick={() => reg.status === 'COMPLETED' && setEditingDateId(reg.id)}
                            >
                              {payDate ? formatDate(payDate) : '-'}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={reg.status === 'ACTIVE' ? 'default' : 'secondary'}>
                            {t(`transactions.statuses.${reg.status}`)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {reg.status === 'COMPLETED' && reg.type === 'BUY' && (
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
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Registration History */}
      <Card>
        <CardHeader>
          <CardTitle>{t('admin.shareholderDetail.transactionHistory')}</CardTitle>
        </CardHeader>
        <CardContent>
          {shareholder.registrations.length === 0 ? (
            <p className="text-muted-foreground">{t('transactions.noTransactions')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('transactions.registrationDate')}</TableHead>
                  <TableHead>{t('payments.paymentDate')}</TableHead>
                  <TableHead>{t('transactions.title')}</TableHead>
                  <TableHead className="text-right">{t('shares.quantity')}</TableHead>
                  <TableHead className="text-right">{t('shares.pricePerShare')}</TableHead>
                  <TableHead className="text-right">{t('common.amount')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shareholder.registrations.map((reg) => {
                  const payDate = getPaymentDate(reg);
                  return (
                  <TableRow key={reg.id}>
                    <TableCell>{formatDate(reg.createdAt)}</TableCell>
                    <TableCell>
                      {reg.status === 'COMPLETED' && editingDateId === reg.id ? (
                        <Input
                          type="date"
                          className="w-36 h-8"
                          defaultValue={payDate ? new Date(payDate).toISOString().split('T')[0] : ''}
                          autoFocus
                          onBlur={(e) => {
                            if (e.target.value) handleInlineDateSave(reg.id, e.target.value);
                            else setEditingDateId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') setEditingDateId(null);
                          }}
                        />
                      ) : (
                        <span
                          className={reg.status === 'COMPLETED' ? 'cursor-pointer hover:underline' : ''}
                          onClick={() => reg.status === 'COMPLETED' && setEditingDateId(reg.id)}
                        >
                          {payDate ? formatDate(payDate) : '-'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {t(`transactions.types.${reg.type}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{reg.quantity}</TableCell>
                    <TableCell className="text-right">
                      {fmtCurrency(reg.pricePerShare)}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtCurrency(reg.quantity * reg.pricePerShare)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          reg.status === 'COMPLETED' || reg.status === 'ACTIVE'
                            ? 'default'
                            : reg.status === 'CANCELLED'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {t(`transactions.statuses.${reg.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {reg.status === 'PENDING' && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => handleApprove(reg.id)}>
                              <Check className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => openRejectDialog(reg.id)}>
                              <X className="h-4 w-4 text-red-600" />
                            </Button>
                          </>
                        )}
                        {((reg.type === 'BUY' && ['PENDING', 'PENDING_PAYMENT'].includes(reg.status)) ||
                          (reg.type === 'SELL' && reg.status === 'PENDING_PAYMENT')) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => showPaymentDetails(reg.id, reg.status)}
                            title={
                              reg.type === 'SELL'
                                ? t('admin.transactions.payRefund')
                                : t('admin.transactions.paymentInfo')
                            }
                          >
                            {reg.type === 'SELL' ? (
                              <CreditCard className="h-4 w-4 text-blue-600" />
                            ) : (
                              <QrCode className="h-4 w-4 text-blue-600" />
                            )}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Change History */}
      <Card>
        <CardHeader>
          <CardTitle>{t('audit.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {auditLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-4 w-full bg-muted rounded" />
              <div className="h-4 w-3/4 bg-muted rounded" />
            </div>
          ) : auditLogs.length === 0 ? (
            <p className="text-muted-foreground">{t('audit.noChanges')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('audit.date')}</TableHead>
                  <TableHead>{t('audit.action')}</TableHead>
                  <TableHead>{t('audit.field')}</TableHead>
                  <TableHead>{t('audit.changedBy')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(log.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {t(`audit.actions.${log.action}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {log.changes.length === 0
                        ? '-'
                        : log.changes.map((c, i) => (
                            <div key={i} className="text-sm">
                              <span className="font-medium">{c.field}</span>
                              {': '}
                              <span className="text-muted-foreground">
                                {c.oldValue === '***' ? t('audit.masked') : String(c.oldValue ?? '-')}
                              </span>
                              {' → '}
                              <span>
                                {c.newValue === '***' ? t('audit.masked') : String(c.newValue ?? '-')}
                              </span>
                            </div>
                          ))}
                    </TableCell>
                    <TableCell>
                      {log.actorEmail || t('audit.system')}
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
                  unstructured={t('payments.sharePurchase', { quantity: buyResult.quantity ?? '' })}
                  label={t('payments.sharePurchase', { quantity: buyResult.quantity ?? '' })}
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

          {sellResult ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>{t('shares.sellRequestSubmitted')}</AlertDescription>
              </Alert>
              <div className="flex justify-center">
                <EpcQrCode
                  bic={sellResult.bic}
                  beneficiaryName={sellResult.beneficiaryName}
                  iban={sellResult.iban}
                  amount={sellResult.amount}
                  reference={sellResult.ogmCode}
                  unstructured={t('payments.shareRefund', { quantity: sellResult.quantity ?? '' })}
                  label={t('payments.shareRefund', { quantity: sellResult.quantity ?? '' })}
                />
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('payments.beneficiary')}</span>
                  <span className="font-medium">{sellResult.beneficiaryName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('payments.iban')}</span>
                  <span className="font-mono text-xs">{formatIban(sellResult.iban)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('common.amount')}</span>
                  <span className="font-medium">{fmtCurrency(sellResult.amount)}</span>
                </div>
                {sellResult.ogmCode && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('payments.ogmCode')}</span>
                    <span className="font-mono text-xs">{sellResult.ogmCode}</span>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={() => setSellOpen(false)}>{t('common.confirm')}</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('shares.shareClass')}</Label>
                <Select value={sellRegistrationId} onValueChange={(v) => { setSellRegistrationId(v); setSellQuantity(1); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activeRegs.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.shareClass.name} - {r.sharesOwned ?? r.quantity} {t('shares.quantity').toLowerCase()} ({fmtCurrency(r.shareClass.pricePerShare)}/{t('shares.perUnit')})
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
                  max={selectedSellReg?.sharesOwned ?? selectedSellReg?.quantity ?? 1}
                  value={sellQuantity}
                  onChange={(e) => setSellQuantity(Math.max(1, Math.min(selectedSellReg?.sharesOwned ?? selectedSellReg?.quantity ?? 1, parseInt(e.target.value) || 1)))}
                />
                {selectedSellReg && (
                  <p className="text-xs text-muted-foreground">
                    {t('shares.maxQuantity', { max: selectedSellReg.sharesOwned ?? selectedSellReg.quantity })}
                  </p>
                )}
              </div>
              {selectedSellReg && (
                <div className="border-t pt-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('shares.totalRefund')}</span>
                    <span className="font-bold">
                      {fmtCurrency(sellQuantity * selectedSellReg.shareClass.pricePerShare)}
                    </span>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setSellOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleSell} disabled={sellLoading || !sellRegistrationId}>
                  {sellLoading ? t('common.loading') : t('shares.confirmSell')}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
              {paymentDetails.iban ? (
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
                  <span className="font-medium">{fmtCurrency(paymentDetails.amount)}</span>
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

      {/* Send Message Dialog */}
      <Dialog open={messageOpen} onOpenChange={(open) => {
        setMessageOpen(open);
        if (!open) { setMessageSubject(''); setMessageBody(''); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('messages.startConversation')}</DialogTitle>
            <DialogDescription>
              {shareholder.type === 'COMPANY'
                ? shareholder.companyName
                : `${shareholder.firstName || ''} ${shareholder.lastName || ''}`.trim()}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="msg-subject">{t('messages.subject')}</Label>
              <Input
                id="msg-subject"
                value={messageSubject}
                onChange={(e) => setMessageSubject(e.target.value)}
                placeholder={t('messages.subjectPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="msg-body">{t('messages.body')}</Label>
              <Textarea
                id="msg-body"
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder={t('messages.bodyPlaceholder')}
                rows={6}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMessageOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSendMessage}
              disabled={messageSending || !messageSubject.trim() || !messageBody.trim()}
            >
              {messageSending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('messages.send')}
            </Button>
          </DialogFooter>
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
