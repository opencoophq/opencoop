'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { Gift } from 'lucide-react';

interface CoopPublicInfo {
  id: string;
  slug: string;
  name: string;
  primaryColor: string;
}

const claimSchema = z.object({
  giftCode: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  birthDate: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  street: z.string().min(1),
  number: z.string().min(1),
  postalCode: z.string().min(1),
  city: z.string().min(1),
  country: z.string().min(1),
});

type ClaimForm = z.infer<typeof claimSchema>;

export default function ClaimGiftPage() {
  const t = useTranslations();
  const params = useParams<{ locale: string; coopSlug: string }>();
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get('code');

  const [coop, setCoop] = useState<CoopPublicInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [codeValidated, setCodeValidated] = useState(!!codeFromUrl);
  const [submitting, setSubmitting] = useState(false);
  const [claimed, setClaimed] = useState(false);

  const form = useForm<ClaimForm>({
    resolver: zodResolver(claimSchema),
    defaultValues: {
      giftCode: codeFromUrl || '',
      country: 'Belgium',
    },
  });

  useEffect(() => {
    async function fetchCoop() {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/coops/${params.coopSlug}/public-info`
        );
        if (response.ok) {
          setCoop(await response.json());
        }
      } catch (error) {
        console.error('Failed to fetch coop:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchCoop();
  }, [params.coopSlug]);

  const handleValidateCode = async () => {
    const result = await form.trigger('giftCode');
    if (result) {
      // This would normally validate the code against the API
      // For now, accept any non-empty code
      setCodeValidated(true);
    }
  };

  const onSubmit = async () => {
    const result = await form.trigger();
    if (!result) return;

    setSubmitting(true);
    try {
      // This would normally call the API to claim the gift certificate
      // For now, simulate success
      setClaimed(true);
    } catch (error) {
      console.error('Claim failed:', error);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (!coop) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>{t('errors.notFound')}</p>
      </div>
    );
  }

  if (claimed) {
    return (
      <div className="min-h-screen bg-muted/30">
        <header className="py-6" style={{ backgroundColor: coop.primaryColor }}>
          <div className="container mx-auto px-4">
            <h1 className="text-2xl font-bold text-white">{coop.name}</h1>
            <p className="text-white/80">{t('registration.claimGift')}</p>
          </div>
        </header>
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <Card>
              <CardHeader className="text-center">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{ backgroundColor: coop.primaryColor }}
                >
                  <span className="text-white text-2xl">✓</span>
                </div>
                <CardTitle>{t('registration.registrationComplete')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-center text-muted-foreground">
                  {t('registration.claimDescription')}
                </p>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="py-6" style={{ backgroundColor: coop.primaryColor }}>
        <div className="container mx-auto px-4">
          <h1 className="text-2xl font-bold text-white">{coop.name}</h1>
          <p className="text-white/80">{t('registration.claimGift')}</p>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {!codeValidated ? (
            /* Step 1: Enter gift code */
            <Card>
              <CardHeader className="text-center">
                <Gift
                  className="h-12 w-12 mx-auto mb-2"
                  style={{ color: coop.primaryColor }}
                />
                <CardTitle>{t('registration.claimGift')}</CardTitle>
                <p className="text-sm text-muted-foreground mt-2">
                  {t('registration.claimDescription')}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('registration.giftCode')} *</Label>
                  <Input
                    {...form.register('giftCode')}
                    placeholder="GIFT-XXXXXX"
                    className="text-center font-mono text-lg tracking-wider"
                  />
                </div>
                <Button
                  type="button"
                  className="w-full"
                  style={{ backgroundColor: coop.primaryColor }}
                  onClick={handleValidateCode}
                >
                  {t('common.next')}
                </Button>
              </CardContent>
            </Card>
          ) : (
            /* Step 2: Fill in recipient details */
            <Card>
              <CardHeader>
                <CardTitle>{t('registration.yourDetails')}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t('registration.giftCode')}: <span className="font-mono font-medium">{form.getValues('giftCode')}</span>
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('shareholder.fields.firstName')} *</Label>
                    <Input {...form.register('firstName')} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('shareholder.fields.lastName')} *</Label>
                    <Input {...form.register('lastName')} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('shareholder.fields.birthDate')}</Label>
                  <DatePicker
                    value={form.watch('birthDate')}
                    onChange={(value) => form.setValue('birthDate', value || '')}
                    placeholder={t('shareholder.fields.birthDate')}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t('common.email')} *</Label>
                  <Input type="email" {...form.register('email')} />
                </div>

                <div className="space-y-2">
                  <Label>{t('common.phone')}</Label>
                  <Input type="tel" {...form.register('phone')} />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2 space-y-2">
                    <Label>{t('common.street')} *</Label>
                    <Input {...form.register('street')} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('common.houseNumber')} *</Label>
                    <Input {...form.register('number')} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('common.postalCode')} *</Label>
                    <Input {...form.register('postalCode')} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('common.city')} *</Label>
                    <Input {...form.register('city')} />
                  </div>
                </div>

                <div className="flex gap-4 mt-6">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCodeValidated(false)}
                  >
                    {t('common.back')}
                  </Button>
                  <Button
                    type="button"
                    className="flex-1"
                    style={{ backgroundColor: coop.primaryColor }}
                    onClick={onSubmit}
                    disabled={submitting}
                  >
                    {submitting ? t('common.loading') : t('registration.claimGift')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
