'use client';

import { useEffect, useState } from 'react';
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
import { useAdmin } from '@/contexts/admin-context';
import { ChevronLeft, Save } from 'lucide-react';

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
  street?: string;
  houseNumber?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  shares: Share[];
  transactions: Transaction[];
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
  const { selectedAdminCoop, loading: adminLoading } = useAdmin();
  const [shareholder, setShareholder] = useState<ShareholderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<ShareholderForm>({
    resolver: zodResolver(shareholderSchema),
    defaultValues: {
      status: 'ACTIVE',
    },
  });

  useEffect(() => {
    if (!selectedAdminCoop || !shareholderId) {
      setLoading(false);
      return;
    }

    const fetchShareholder = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('accessToken');
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/admin/coops/${selectedAdminCoop.id}/shareholders/${shareholderId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (response.ok) {
          const data: ShareholderDetail = await response.json();
          setShareholder(data);
          form.reset({
            firstName: data.firstName || '',
            lastName: data.lastName || '',
            birthDate: data.birthDate ? data.birthDate.split('T')[0] : '',
            companyName: data.companyName || '',
            companyId: data.companyId || '',
            vatNumber: data.vatNumber || '',
            email: data.email || '',
            phone: data.phone || '',
            street: data.street || '',
            houseNumber: data.houseNumber || '',
            postalCode: data.postalCode || '',
            city: data.city || '',
            country: data.country || '',
            status: data.status,
          });
        }
      } catch {
        setError(t('common.error'));
      } finally {
        setLoading(false);
      }
    };

    fetchShareholder();
  }, [selectedAdminCoop, shareholderId, form, t]);

  const onSubmit = async (data: ShareholderForm) => {
    if (!selectedAdminCoop || !shareholderId) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/admin/coops/${selectedAdminCoop.id}/shareholders/${shareholderId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(data),
        }
      );

      if (response.ok) {
        setSuccess(t('common.success'));
        const updated = await response.json();
        setShareholder(updated);
      } else {
        throw new Error('Failed to update');
      }
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('nl-BE');
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(amount);
  };

  if (adminLoading || loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  if (!selectedAdminCoop) {
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
        <div>
          <h1 className="text-2xl font-bold">{t('admin.shareholderDetail.title')}</h1>
          <p className="text-muted-foreground">
            {shareholder.type === 'COMPANY'
              ? shareholder.companyName
              : `${shareholder.firstName || ''} ${shareholder.lastName || ''}`.trim()}
          </p>
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
                    <Input type="date" {...form.register('birthDate')} />
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
                      {formatCurrency(share.shareClass.pricePerShare)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(share.quantity * share.shareClass.pricePerShare)}
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {shareholder.transactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell>{formatDate(transaction.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {t(`transactions.type.${transaction.type.toLowerCase()}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{transaction.quantity}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(transaction.pricePerShare)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(transaction.quantity * transaction.pricePerShare)}
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
                        {t(`transactions.status.${transaction.status.toLowerCase()}`)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
