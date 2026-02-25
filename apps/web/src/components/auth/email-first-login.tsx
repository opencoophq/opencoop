'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Building2 } from 'lucide-react';
import { resolveLogoUrl } from '@/lib/api';

interface CoopBranding {
  name: string;
  logoUrl?: string | null;
  primaryColor: string;
  secondaryColor: string;
  slug: string;
}

interface EmailFirstLoginProps {
  coop?: CoopBranding;
}

type LoginStep = 'email' | 'method' | 'magic-link-sent' | 'password';

const emailSchema = z.object({
  email: z.string().email(),
});

const passwordSchema = z.object({
  password: z.string().min(1),
});

type EmailForm = z.infer<typeof emailSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

export function EmailFirstLogin({ coop }: EmailFirstLoginProps) {
  const t = useTranslations();
  const router = useRouter();
  const [step, setStep] = useState<LoginStep>('email');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const {
    register: registerEmail,
    handleSubmit: handleEmailSubmit,
    formState: { errors: emailErrors },
  } = useForm<EmailForm>({
    resolver: zodResolver(emailSchema),
  });

  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    formState: { errors: passwordErrors },
  } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  });

  const onEmailSubmit = (data: EmailForm) => {
    setEmail(data.email);
    setError(null);
    setStep('method');
  };

  const onMagicLinkRequest = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/magic-link/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          ...(coop && { coopSlug: coop.slug }),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || t('auth.loginError'));
      }

      setStep('magic-link-sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginError'));
    } finally {
      setLoading(false);
    }
  };

  const onPasswordSubmit = async (data: PasswordForm) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: data.password }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(t('auth.invalidCredentials'));
        }
        throw new Error(t('auth.loginError'));
      }

      localStorage.setItem('accessToken', result.accessToken);
      localStorage.setItem('user', JSON.stringify(result.user));
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginError'));
    } finally {
      setLoading(false);
    }
  };

  const changeEmail = () => {
    setStep('email');
    setError(null);
  };

  const registerUrl = coop ? `/${coop.slug}/register` : '/register';

  // Custom styles based on coop branding
  const brandStyles = coop
    ? {
        '--brand-primary': coop.primaryColor,
        '--brand-secondary': coop.secondaryColor,
      }
    : {};

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={brandStyles as React.CSSProperties}>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {/* Logo */}
          {coop?.logoUrl ? (
            <img
              src={resolveLogoUrl(coop.logoUrl)!}
              alt={coop.name}
              className="h-12 mx-auto mb-4 object-contain"
            />
          ) : coop ? (
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: coop.primaryColor }}
            >
              <span className="text-white font-bold text-2xl">
                {coop.name.charAt(0).toUpperCase()}
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary text-primary-foreground mx-auto mb-4">
              <Building2 className="w-7 h-7" />
            </div>
          )}
          <CardTitle className="text-2xl">{t('auth.welcomeBack')}</CardTitle>
          <CardDescription>{coop?.name || 'OpenCoop'}</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Step 1: Email Input */}
          {step === 'email' && (
            <form onSubmit={handleEmailSubmit(onEmailSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t('common.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t('auth.emailPlaceholder')}
                  autoFocus
                  {...registerEmail('email')}
                />
                {emailErrors.email && (
                  <p className="text-sm text-destructive">{emailErrors.email.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full" style={coop ? { backgroundColor: coop.primaryColor } : undefined}>
                {t('auth.continue')}
              </Button>
            </form>
          )}

          {/* Step 2: Choose Method */}
          {step === 'method' && (
            <div className="space-y-4">
              <div className="text-center mb-4">
                <p className="text-sm text-muted-foreground">{t('auth.howToLogin')}</p>
                <p className="font-medium">
                  {email}{' '}
                  <button
                    type="button"
                    onClick={changeEmail}
                    className="text-primary hover:underline text-sm font-normal"
                  >
                    [{t('auth.changeEmail')}]
                  </button>
                </p>
              </div>

              {/* Magic Link Option (Primary) */}
              <button
                type="button"
                onClick={onMagicLinkRequest}
                disabled={loading}
                className="w-full p-4 border-2 rounded-lg text-left hover:border-primary transition-colors"
                style={coop ? { borderColor: loading ? undefined : coop.primaryColor } : undefined}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: coop?.primaryColor || 'hsl(var(--primary))', color: 'white' }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{t('auth.sendLoginLink')}</p>
                    <p className="text-sm text-muted-foreground">{t('auth.sendLoginLinkDesc')}</p>
                  </div>
                </div>
              </button>

              {/* Password Option (Secondary) */}
              <button
                type="button"
                onClick={() => setStep('password')}
                className="w-full p-4 border rounded-lg text-left hover:border-muted-foreground/50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{t('auth.usePassword')}</p>
                    <p className="text-sm text-muted-foreground">{t('auth.usePasswordDesc')}</p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Step 3a: Magic Link Sent */}
          {step === 'magic-link-sent' && (
            <div className="text-center space-y-4">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
                style={{ backgroundColor: coop ? `${coop.primaryColor}20` : 'rgb(220 252 231)' }}
              >
                <svg
                  className="w-8 h-8"
                  style={{ color: coop?.primaryColor || 'rgb(22 163 74)' }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <p className="text-muted-foreground">{t('auth.magicLinkSent', { email })}</p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setStep('method');
                  setError(null);
                }}
              >
                {t('auth.sendAnotherLink')}
              </Button>
            </div>
          )}

          {/* Step 3b: Password Input */}
          {step === 'password' && (
            <form onSubmit={handlePasswordSubmit(onPasswordSubmit)} className="space-y-4">
              <div className="text-center mb-4">
                <p className="font-medium">
                  {email}{' '}
                  <button
                    type="button"
                    onClick={changeEmail}
                    className="text-primary hover:underline text-sm font-normal"
                  >
                    [{t('auth.changeEmail')}]
                  </button>
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label htmlFor="password">{t('auth.passwordPlaceholder')}</Label>
                  <Link href="/forgot-password" className="text-sm text-primary hover:underline">
                    {t('auth.forgotPassword')}
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  autoFocus
                  {...registerPassword('password')}
                />
                {passwordErrors.password && (
                  <p className="text-sm text-destructive">{passwordErrors.password.message}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loading}
                style={coop ? { backgroundColor: coop.primaryColor } : undefined}
              >
                {loading ? t('common.loading') : t('auth.login')}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setStep('method')}
              >
                {t('common.back')}
              </Button>
            </form>
          )}

          {/* Register Link */}
          {step !== 'magic-link-sent' && (
            <div className="mt-6 text-center text-sm">
              <span className="text-muted-foreground">{t('registration.createAccount')} </span>
              <Link href={registerUrl} className="text-primary hover:underline">
                {t('auth.register')}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
