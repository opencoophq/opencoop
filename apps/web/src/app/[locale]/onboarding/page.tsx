'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Check, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const searchParams = useSearchParams();

  const plan = (searchParams.get('plan') as 'essentials' | 'professional') || 'essentials';
  const billing = (searchParams.get('billing') as 'monthly' | 'yearly') || 'yearly';

  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);

  const accountSchema = z
    .object({
      email: z.string().min(1, t('validation.emailRequired')).email(t('validation.emailInvalid')),
      password: z.string().min(8, t('validation.passwordMin')),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('validation.passwordMismatch'),
      path: ['confirmPassword'],
    });

  const coopSchema = z.object({
    coopName: z.string().min(2, t('validation.nameMin')),
    coopSlug: z
      .string()
      .min(3, t('validation.slugMin'))
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, t('validation.slugFormat')),
  });

  type AccountForm = z.infer<typeof accountSchema>;
  type CoopForm = z.infer<typeof coopSchema>;

  const accountForm = useForm<AccountForm>({
    resolver: zodResolver(accountSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  });

  const coopForm = useForm<CoopForm>({
    resolver: zodResolver(coopSchema),
    defaultValues: { coopName: '', coopSlug: '' },
  });

  const steps = [t('steps.account'), t('steps.cooperative'), t('steps.done')];

  const onAccountNext = (data: AccountForm) => {
    setError(null);
    setStep(1);
  };

  const onCoopSubmit = async (data: CoopForm) => {
    setError(null);
    setLoading(true);

    const accountValues = accountForm.getValues();

    try {
      const res = await fetch(`${API_URL}/auth/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: accountValues.email,
          password: accountValues.password,
          coopName: data.coopName,
          coopSlug: data.coopSlug,
          plan,
          billingPeriod: billing,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: '' }));
        if (res.status === 409) {
          const msg = (err.message || '').toLowerCase();
          if (msg.includes('email')) {
            setError(t('errors.emailTaken'));
          } else if (msg.includes('slug')) {
            setError(t('errors.slugTaken'));
          } else {
            setError(err.message || t('errors.generic'));
          }
        } else {
          setError(err.message || t('errors.generic'));
        }
        return;
      }

      const result = await res.json();

      localStorage.setItem('accessToken', result.accessToken);
      localStorage.setItem('user', JSON.stringify(result.user));

      setStep(2);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-8">{t('title')}</h1>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {steps.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  i < step
                    ? 'bg-primary text-primary-foreground'
                    : i === step
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span
                className={`text-sm hidden sm:inline ${
                  i === step ? 'font-medium' : 'text-muted-foreground'
                }`}
              >
                {label}
              </span>
              {i < steps.length - 1 && (
                <div className="w-8 h-px bg-border mx-1" />
              )}
            </div>
          ))}
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Step 1: Account */}
        {step === 0 && (
          <div className="bg-white rounded-xl border p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-1">{t('account.title')}</h2>
            <p className="text-sm text-muted-foreground mb-6">{t('account.subtitle')}</p>

            <form onSubmit={accountForm.handleSubmit(onAccountNext)} className="space-y-4">
              <div>
                <Label htmlFor="email">{t('account.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  {...accountForm.register('email')}
                  className="mt-1"
                />
                {accountForm.formState.errors.email && (
                  <p className="text-sm text-destructive mt-1">
                    {accountForm.formState.errors.email.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="password">{t('account.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  {...accountForm.register('password')}
                  className="mt-1"
                />
                {accountForm.formState.errors.password && (
                  <p className="text-sm text-destructive mt-1">
                    {accountForm.formState.errors.password.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="confirmPassword">{t('account.confirmPassword')}</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  {...accountForm.register('confirmPassword')}
                  className="mt-1"
                />
                {accountForm.formState.errors.confirmPassword && (
                  <p className="text-sm text-destructive mt-1">
                    {accountForm.formState.errors.confirmPassword.message}
                  </p>
                )}
              </div>

              <Button type="submit" className="w-full">
                {t('steps.cooperative')}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </form>
          </div>
        )}

        {/* Step 2: Cooperative */}
        {step === 1 && (
          <div className="bg-white rounded-xl border p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-1">{t('cooperative.title')}</h2>
            <p className="text-sm text-muted-foreground mb-6">{t('cooperative.subtitle')}</p>

            <form onSubmit={coopForm.handleSubmit(onCoopSubmit)} className="space-y-4">
              <div>
                <Label htmlFor="coopName">{t('cooperative.name')}</Label>
                <Input
                  id="coopName"
                  {...coopForm.register('coopName', {
                    onChange: (e) => {
                      if (!slugTouched) {
                        coopForm.setValue('coopSlug', slugify(e.target.value));
                      }
                    },
                  })}
                  className="mt-1"
                />
                {coopForm.formState.errors.coopName && (
                  <p className="text-sm text-destructive mt-1">
                    {coopForm.formState.errors.coopName.message}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="coopSlug">{t('cooperative.slug')}</Label>
                <div className="flex items-center mt-1">
                  <span className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded-l-md border border-r-0 h-10 flex items-center">
                    {t('cooperative.slugPrefix')}
                  </span>
                  <Input
                    id="coopSlug"
                    {...coopForm.register('coopSlug', {
                      onChange: () => setSlugTouched(true),
                    })}
                    className="rounded-l-none"
                  />
                </div>
                {coopForm.formState.errors.coopSlug && (
                  <p className="text-sm text-destructive mt-1">
                    {coopForm.formState.errors.coopSlug.message}
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <Badge variant="secondary" className="text-sm">
                  {t('cooperative.plan')}: {plan === 'essentials' ? 'Essentials' : 'Professional'}
                </Badge>
                <Badge variant="secondary" className="text-sm">
                  {t('cooperative.billing')}: {billing === 'yearly' ? t('billing.yearly') : t('billing.monthly')}
                </Badge>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setStep(0);
                  }}
                >
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  {t('steps.account')}
                </Button>
                <Button type="submit" className="flex-1" disabled={loading}>
                  {loading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  {t('steps.done')}
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 2 && (
          <div className="bg-white rounded-xl border p-6 shadow-sm text-center">
            <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-semibold mb-2">{t('done.title')}</h2>
            <p className="text-sm text-muted-foreground mb-6">{t('done.subtitle')}</p>
            <Button onClick={() => router.push('/dashboard')} className="w-full">
              {t('done.goToDashboard')}
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
