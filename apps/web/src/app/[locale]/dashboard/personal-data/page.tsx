'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DatePicker } from '@/components/ui/date-picker';
import { Save } from 'lucide-react';
import { api } from '@/lib/api';

interface ShareholderProfile {
  id: string;
  type: 'INDIVIDUAL' | 'COMPANY' | 'MINOR';
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE';
  firstName?: string;
  lastName?: string;
  companyName?: string;
  companyId?: string;
  vatNumber?: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  bankIban?: string;
  bankBic?: string;
  address?: {
    street?: string;
    number?: string;
    postalCode?: string;
    city?: string;
    country?: string;
  };
}

const profileSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  birthDate: z.string().optional(),
  companyName: z.string().optional(),
  companyId: z.string().optional(),
  vatNumber: z.string().optional(),
  phone: z.string().optional(),
  bankIban: z.string().optional(),
  bankBic: z.string().optional(),
  street: z.string().optional(),
  houseNumber: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

export default function PersonalDataPage() {
  const t = useTranslations();
  const [shareholder, setShareholder] = useState<ShareholderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
  });

  useEffect(() => {
    async function loadProfile() {
      try {
        const profile = await api<{ shareholders: ShareholderProfile[] }>('/auth/me');
        if (profile.shareholders?.[0]) {
          const sh = profile.shareholders[0];
          setShareholder(sh);
          const addr = sh.address || {};
          form.reset({
            firstName: sh.firstName || '',
            lastName: sh.lastName || '',
            birthDate: sh.birthDate ? sh.birthDate.split('T')[0] : '',
            companyName: sh.companyName || '',
            companyId: sh.companyId || '',
            vatNumber: sh.vatNumber || '',
            phone: sh.phone || '',
            bankIban: sh.bankIban || '',
            bankBic: sh.bankBic || '',
            street: addr.street || '',
            houseNumber: addr.number || '',
            postalCode: addr.postalCode || '',
            city: addr.city || '',
            country: addr.country || '',
          });
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [form]);

  const onSubmit = async (data: ProfileForm) => {
    if (!shareholder) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const { street, houseNumber, postalCode, city, country, bankIban, bankBic, birthDate, ...rest } = data;

      const body: Record<string, unknown> = { ...rest };

      if (bankIban) body.bankIban = bankIban;
      if (bankBic) body.bankBic = bankBic;
      if (birthDate) body.birthDate = birthDate;

      if (street || houseNumber || postalCode || city || country) {
        body.address = {
          street: street || '',
          number: houseNumber || '',
          postalCode: postalCode || '',
          city: city || '',
          country: country || '',
        };
      }

      await api(`/shareholders/${shareholder.id}/profile`, {
        method: 'PUT',
        body,
      });
      setSuccess(t('common.savedSuccessfully'));
    } catch {
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!shareholder) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">{t('personalData.title')}</h1>
        <p className="text-muted-foreground">{t('common.noResults')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">{t('personalData.title')}</h1>

      {success && (
        <Alert className="mb-6">
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="mb-6">
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
                  ? t('personalData.companyInfo')
                  : t('personalData.personalInfo')}
              </CardTitle>
              <div className="flex gap-2">
                <Badge>
                  {t(`shareholder.type.${shareholder.type.toLowerCase()}`)}
                </Badge>
                <Badge variant={shareholder.status === 'ACTIVE' ? 'default' : 'secondary'}>
                  {t(`shareholder.status.${shareholder.status.toLowerCase()}`)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
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
            </CardContent>
          </Card>

          {/* Contact & Bank */}
          <Card>
            <CardHeader>
              <CardTitle>{t('personalData.contactInfo')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t('common.email')}</Label>
                <Input value={shareholder.email || ''} disabled className="bg-muted" />
                <p className="text-xs text-muted-foreground">{t('personalData.readOnlyEmail')}</p>
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
            </CardContent>
          </Card>
        </div>

        <div className="mt-6">
          <Button type="submit" disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? t('common.loading') : t('personalData.saveChanges')}
          </Button>
        </div>
      </form>
    </div>
  );
}
