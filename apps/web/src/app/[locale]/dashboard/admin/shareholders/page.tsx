'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { Link } from '@/i18n/routing';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { DatePicker } from '@/components/ui/date-picker';
import { api } from '@/lib/api';
import { Search, Plus, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';

interface ShareholderRow {
  id: string;
  type: string;
  status: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  createdAt: string;
  registrations: Array<{ quantity: number; sharesOwned: number; status: string; registerDate: string }>;
}

interface PaginatedResponse {
  items: ShareholderRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const beneficialOwnerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  nationalId: z.string().optional(),
  ownershipPercentage: z.coerce.number().min(0).max(100),
});

const createShareholderSchema = z
  .object({
    type: z.enum(['INDIVIDUAL', 'COMPANY', 'MINOR']),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    birthDate: z.string().optional(),
    phone: z.string().optional(),
    companyName: z.string().optional(),
    companyId: z.string().optional(),
    vatNumber: z.string().optional(),
    street: z.string().optional(),
    houseNumber: z.string().optional(),
    postalCode: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    bankIban: z.string().optional(),
    bankBic: z.string().optional(),
    beneficialOwners: z.array(beneficialOwnerSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'INDIVIDUAL') {
      if (!data.firstName?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['firstName'], message: 'Required' });
      }
      if (!data.lastName?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lastName'], message: 'Required' });
      }
      if (!data.email?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Required' });
      }
    } else if (data.type === 'COMPANY') {
      if (!data.companyName?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['companyName'], message: 'Required' });
      }
      if (!data.email?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Required' });
      }
    } else if (data.type === 'MINOR') {
      if (!data.firstName?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['firstName'], message: 'Required' });
      }
      if (!data.lastName?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lastName'], message: 'Required' });
      }
      if (!data.birthDate?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['birthDate'], message: 'Required' });
      }
    }
  });

type CreateShareholderForm = z.infer<typeof createShareholderSchema>;

export default function ShareholdersPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const form = useForm<CreateShareholderForm>({
    resolver: zodResolver(createShareholderSchema),
    defaultValues: {
      type: 'INDIVIDUAL',
      firstName: '',
      lastName: '',
      email: '',
      birthDate: '',
      phone: '',
      companyName: '',
      companyId: '',
      vatNumber: '',
      street: '',
      houseNumber: '',
      postalCode: '',
      city: '',
      country: '',
      bankIban: '',
      bankBic: '',
      beneficialOwners: [],
    },
  });

  const { fields: ownerFields, append: appendOwner, remove: removeOwner } = useFieldArray({
    control: form.control,
    name: 'beneficialOwners',
  });

  const watchType = form.watch('type');

  const loadData = useCallback(async () => {
    if (!selectedCoop) return;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (search) params.set('search', search);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (typeFilter !== 'all') params.set('type', typeFilter);

    try {
      const result = await api<PaginatedResponse>(
        `/admin/coops/${selectedCoop.id}/shareholders?${params}`,
      );
      setData(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, page, search, statusFilter, typeFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getName = (sh: ShareholderRow) =>
    sh.type === 'COMPANY'
      ? sh.companyName || ''
      : `${sh.firstName || ''} ${sh.lastName || ''}`.trim();

  const activeShares = (sh: ShareholderRow) =>
    sh.registrations?.filter((r) => r.status === 'ACTIVE' || r.status === 'COMPLETED').reduce((sum, r) => sum + (r.sharesOwned ?? r.quantity), 0) || 0;

  const memberSince = (sh: ShareholderRow) => {
    const dates = sh.registrations?.map((r) => r.registerDate).filter(Boolean) || [];
    if (dates.length === 0) return sh.createdAt;
    return dates.reduce((earliest, d) => (d < earliest ? d : earliest));
  };

  const openCreateDialog = () => {
    form.reset({
      type: 'INDIVIDUAL',
      firstName: '',
      lastName: '',
      email: '',
      birthDate: '',
      phone: '',
      companyName: '',
      companyId: '',
      vatNumber: '',
      street: '',
      houseNumber: '',
      postalCode: '',
      city: '',
      country: '',
      bankIban: '',
      bankBic: '',
      beneficialOwners: [],
    });
    setCreateError(null);
    setCreateSuccess(null);
    setCreateOpen(true);
  };

  const onCreateSubmit = async (formData: CreateShareholderForm) => {
    if (!selectedCoop) return;
    setCreateLoading(true);
    setCreateError(null);

    try {
      const { street, houseNumber, postalCode, city, country, email, bankIban, bankBic, birthDate, beneficialOwners, ...rest } = formData;

      const body: Record<string, unknown> = { ...rest };

      // Only send email if non-empty
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

      // Send beneficial owners for companies
      if (formData.type === 'COMPANY' && beneficialOwners && beneficialOwners.length > 0) {
        body.beneficialOwners = beneficialOwners;
      }

      await api(`/admin/coops/${selectedCoop.id}/shareholders`, {
        method: 'POST',
        body,
      });

      setCreateOpen(false);
      setCreateSuccess(t('admin.shareholders.create.success'));
      loadData();

      // Clear success after 5 seconds
      setTimeout(() => setCreateSuccess(null), 5000);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setCreateLoading(false);
    }
  };

  if (!selectedCoop) return <p className="text-muted-foreground">{t('admin.selectCoop')}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('admin.shareholders.title')}</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          {t('admin.shareholders.add')}
        </Button>
      </div>

      {createSuccess && (
        <Alert className="mb-4">
          <AlertDescription>{createSuccess}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('common.search')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-10"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder={t('common.status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="ACTIVE">{t('shareholder.statuses.ACTIVE')}</SelectItem>
                <SelectItem value="PENDING">{t('shareholder.statuses.PENDING')}</SelectItem>
                <SelectItem value="INACTIVE">{t('shareholder.statuses.INACTIVE')}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder={t('common.type')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="INDIVIDUAL">{t('shareholder.types.INDIVIDUAL')}</SelectItem>
                <SelectItem value="COMPANY">{t('shareholder.types.COMPANY')}</SelectItem>
                <SelectItem value="MINOR">{t('shareholder.types.MINOR')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : !data || data.items.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">{t('common.noResults')}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common.name')}</TableHead>
                    <TableHead>{t('common.type')}</TableHead>
                    <TableHead>{t('common.email')}</TableHead>
                    <TableHead className="text-right">{t('shares.title')}</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                    <TableHead>{t('shareholder.memberSince')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((sh) => (
                    <TableRow key={sh.id}>
                      <TableCell>
                        <Link
                          href={`/dashboard/admin/shareholders/${sh.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {getName(sh)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{t(`shareholder.types.${sh.type}`)}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{sh.email || '-'}</TableCell>
                      <TableCell className="text-right">{activeShares(sh)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            sh.status === 'ACTIVE'
                              ? 'default'
                              : sh.status === 'PENDING'
                                ? 'secondary'
                                : 'destructive'
                          }
                        >
                          {t(`shareholder.statuses.${sh.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>{new Date(memberSince(sh)).toLocaleDateString(locale)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {data.totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    {t('common.showing')} {(data.page - 1) * data.pageSize + 1}-
                    {Math.min(data.page * data.pageSize, data.total)} {t('common.of')} {data.total}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 1}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= data.totalPages}
                      onClick={() => setPage(page + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Create Shareholder Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('admin.shareholders.create.title')}</DialogTitle>
            <DialogDescription>{t('admin.shareholders.create.description')}</DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onCreateSubmit)} className="space-y-6">
            {/* Type selector */}
            <div className="space-y-2">
              <Label>{t('admin.shareholders.create.type')}</Label>
              <Select
                value={watchType}
                onValueChange={(v) => form.setValue('type', v as 'INDIVIDUAL' | 'COMPANY' | 'MINOR')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INDIVIDUAL">{t('shareholder.types.INDIVIDUAL')}</SelectItem>
                  <SelectItem value="COMPANY">{t('shareholder.types.COMPANY')}</SelectItem>
                  <SelectItem value="MINOR">{t('shareholder.types.MINOR')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Conditional fields by type */}
            {watchType === 'COMPANY' ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('shareholder.fields.companyName')} *</Label>
                  <Input
                    {...form.register('companyName')}
                    className={form.formState.errors.companyName ? 'border-destructive' : ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('common.email')} *</Label>
                  <Input
                    type="email"
                    {...form.register('email')}
                    className={form.formState.errors.email ? 'border-destructive' : ''}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('shareholder.fields.companyId')}</Label>
                    <Input {...form.register('companyId')} placeholder="0XXX.XXX.XXX" />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('shareholder.fields.vatNumber')}</Label>
                    <Input {...form.register('vatNumber')} placeholder="BE0XXX.XXX.XXX" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t('common.phone')}</Label>
                  <Input {...form.register('phone')} />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('shareholder.fields.firstName')} *</Label>
                    <Input
                      {...form.register('firstName')}
                      className={form.formState.errors.firstName ? 'border-destructive' : ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('shareholder.fields.lastName')} *</Label>
                    <Input
                      {...form.register('lastName')}
                      className={form.formState.errors.lastName ? 'border-destructive' : ''}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>
                    {t('common.email')} {watchType === 'INDIVIDUAL' ? '*' : ''}
                  </Label>
                  <Input
                    type="email"
                    {...form.register('email')}
                    className={form.formState.errors.email ? 'border-destructive' : ''}
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    {t('shareholder.fields.birthDate')} {watchType === 'MINOR' ? '*' : ''}
                  </Label>
                  <DatePicker
                    value={form.watch('birthDate')}
                    onChange={(value) => form.setValue('birthDate', value || '')}
                    captionLayout="dropdown"
                    fromYear={1920}
                    toYear={new Date().getFullYear()}
                  />
                  {form.formState.errors.birthDate && (
                    <p className="text-sm text-destructive">{form.formState.errors.birthDate.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>{t('common.phone')}</Label>
                  <Input {...form.register('phone')} />
                </div>
              </div>
            )}

            {/* Address fields */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium border-t pt-4">{t('admin.shareholderDetail.contactInfo')}</h4>
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
            </div>

            {/* Bank details */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium border-t pt-4">{t('payments.bankDetails')}</h4>
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

            {/* Beneficial owners (COMPANY only) */}
            {watchType === 'COMPANY' && (
              <div className="space-y-4">
                <h4 className="text-sm font-medium border-t pt-4">
                  {t('admin.shareholders.create.beneficialOwners')}
                </h4>
                {ownerFields.map((field, index) => (
                  <div key={field.id} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">#{index + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeOwner(index)}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        {t('admin.shareholders.create.removeOwner')}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t('shareholder.fields.firstName')}</Label>
                        <Input {...form.register(`beneficialOwners.${index}.firstName`)} />
                      </div>
                      <div className="space-y-2">
                        <Label>{t('shareholder.fields.lastName')}</Label>
                        <Input {...form.register(`beneficialOwners.${index}.lastName`)} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t('shareholder.fields.nationalId')}</Label>
                        <Input {...form.register(`beneficialOwners.${index}.nationalId`)} />
                      </div>
                      <div className="space-y-2">
                        <Label>{t('admin.shareholders.create.ownershipPercentage')}</Label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={0.01}
                          {...form.register(`beneficialOwners.${index}.ownershipPercentage`)}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    appendOwner({
                      firstName: '',
                      lastName: '',
                      nationalId: '',
                      ownershipPercentage: 0,
                    })
                  }
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('admin.shareholders.create.addOwner')}
                </Button>
              </div>
            )}

            {createError && (
              <Alert variant="destructive">
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={createLoading}>
                {createLoading ? t('common.loading') : t('admin.shareholders.create.submit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
