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
import { Gift } from 'lucide-react';

interface ChannelPublicInfo {
  id: string;
  slug: string;
  name: string;
  coopName: string;
  primaryColor: string;
  logoUrl: string | null;
}

const claimSchema = z.object({
  giftCode: z.string().min(1),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  birthDate: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  street: z.string().optional(),
  number: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
});

type ClaimForm = z.infer<typeof claimSchema>;

export default function ChannelClaimGiftPage() {
  const t = useTranslations();
  const params = useParams<{ locale: string; coopSlug: string; channelSlug: string }>();
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get('code');

  const [channel, setChannel] = useState<ChannelPublicInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [codeValidated, setCodeValidated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [giftDetails, setGiftDetails] = useState<{
    coopName: string;
    shareClassName: string;
    quantity: number;
    totalValue: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<ClaimForm>({
    resolver: zodResolver(claimSchema),
    defaultValues: {
      giftCode: codeFromUrl || '',
      country: 'Belgium',
    },
  });

  useEffect(() => {
    async function fetchChannel() {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const response = await fetch(
          `${apiUrl}/coops/${params.coopSlug}/channels/${params.channelSlug}/public-info`
        );
        if (response.ok) {
          setChannel(await response.json());
        }
      } catch (error) {
        console.error('Failed to fetch channel:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchChannel();
  }, [params.coopSlug, params.channelSlug]);

  // Auto-validate code from URL once channel is loaded
  useEffect(() => {
    if (codeFromUrl && channel && !codeValidated) {
      handleValidateCode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, codeFromUrl]);

  const handleValidateCode = async () => {
    const result = await form.trigger('giftCode');
    if (!result) return;

    setError(null);
    const code = form.getValues('giftCode');
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    try {
      const res = await fetch(
        `${apiUrl}/coops/${params.coopSlug}/channels/${params.channelSlug}/gift/${encodeURIComponent(code)}/validate`
      );

      if (res.status === 429) {
        setError(t('gift.rateLimited'));
        return;
      }

      const data = await res.json();
      if (!data.valid) {
        setError(t('gift.invalidCode'));
        return;
      }

      setGiftDetails(data);
      setCodeValidated(true);
    } catch {
      setError(t('gift.invalidCode'));
    }
  };

  const onSubmit = async (values: ClaimForm) => {
    // Manual validation for required step-2 fields
    if (!values.firstName || !values.lastName || !values.email) {
      if (!values.firstName) form.setError('firstName', { message: t('common.required') });
      if (!values.lastName) form.setError('lastName', { message: t('common.required') });
      if (!values.email) form.setError('email', { message: t('common.required') });
      return;
    }
    setSubmitting(true);
    setError(null);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    try {
      const res = await fetch(
        `${apiUrl}/coops/${params.coopSlug}/channels/${params.channelSlug}/claim`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            giftCode: values.giftCode,
            firstName: values.firstName,
            lastName: values.lastName,
            birthDate: values.birthDate || undefined,
            email: values.email,
            phone: values.phone || undefined,
            address: values.street
              ? {
                  street: values.street,
                  number: values.number,
                  postalCode: values.postalCode,
                  city: values.city,
                  country: values.country || 'Belgium',
                }
              : undefined,
          }),
        }
      );

      if (res.status === 429) {
        setError(t('gift.rateLimited'));
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message || t('gift.invalidCode'));
        return;
      }

      setClaimed(true);
    } catch {
      setError(t('gift.invalidCode'));
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

  if (!channel) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>{t('errors.notFound')}</p>
      </div>
    );
  }

  if (claimed) {
    return (
      <div className="min-h-screen bg-muted/30">
        <header className="bg-white border-b shadow-sm">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center gap-3">
              {channel.primaryColor && (
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: channel.primaryColor }}
                >
                  <Gift className="h-5 w-5 text-white" />
                </div>
              )}
              <div>
                <h1 className="text-xl font-bold" style={{ color: channel.primaryColor }}>
                  {channel.coopName || ''}
                </h1>
                <p className="text-sm text-muted-foreground">{t('gift.claimTitle')}</p>
              </div>
            </div>
          </div>
        </header>
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <Card>
              <CardHeader className="text-center">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{ backgroundColor: channel.primaryColor }}
                >
                  <span className="text-white text-2xl">&#10003;</span>
                </div>
                <CardTitle>{t('gift.successTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-center text-muted-foreground">
                  {t('gift.successMessage')}
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
      <header className="bg-white border-b shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            {channel.primaryColor && (
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: channel.primaryColor }}
              >
                <Gift className="h-5 w-5 text-white" />
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold" style={{ color: channel.primaryColor }}>
                {channel.coopName || ''}
              </h1>
              <p className="text-sm text-muted-foreground">{t('gift.claimTitle')}</p>
            </div>
          </div>
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
                  style={{ color: channel.primaryColor }}
                />
                <CardTitle>{t('gift.claimTitle')}</CardTitle>
                <p className="text-sm text-muted-foreground mt-2">
                  {t('gift.enterCode')}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('gift.enterCode')} *</Label>
                  <Input
                    {...form.register('giftCode')}
                    placeholder={t('gift.codePlaceholder')}
                    className="text-center font-mono text-lg tracking-wider"
                  />
                </div>
                <Button
                  type="button"
                  className="w-full"
                  style={{ backgroundColor: channel.primaryColor }}
                  onClick={handleValidateCode}
                >
                  {t('gift.validate')}
                </Button>
                {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Gift details card */}
              {giftDetails && (
                <Card className="mb-6">
                  <CardHeader>
                    <CardTitle className="text-lg">{t('gift.giftDetails')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          {giftDetails.shareClassName}
                        </span>
                        <span className="font-medium">
                          {giftDetails.quantity} {t('gift.shares')}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('gift.value')}</span>
                        <span
                          className="font-bold text-lg"
                          style={{ color: channel.primaryColor }}
                        >
                          &euro; {giftDetails.totalValue.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Step 2: Fill in recipient details */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('gift.yourDetails')}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {t('gift.enterCode')}:{' '}
                    <span className="font-mono font-medium">
                      {form.getValues('giftCode')}
                    </span>
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
                    <input
                      type="date"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={form.watch('birthDate') || ''}
                      onChange={(e) => form.setValue('birthDate', e.target.value)}
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
                      <Label>{t('common.street')}</Label>
                      <Input {...form.register('street')} />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('common.houseNumber')}</Label>
                      <Input {...form.register('number')} />
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

                  <div className="flex gap-4 mt-6">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setCodeValidated(false);
                        setGiftDetails(null);
                        setError(null);
                      }}
                    >
                      {t('common.back')}
                    </Button>
                    <Button
                      type="button"
                      className="flex-1"
                      style={{ backgroundColor: channel.primaryColor }}
                      onClick={form.handleSubmit(onSubmit)}
                      disabled={submitting}
                    >
                      {submitting ? t('common.loading') : t('gift.claimShares')}
                    </Button>
                  </div>
                  {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
