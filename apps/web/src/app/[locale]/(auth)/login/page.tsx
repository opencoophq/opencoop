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

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const magicLinkSchema = z.object({
  email: z.string().email(),
});

type LoginForm = z.infer<typeof loginSchema>;
type MagicLinkForm = z.infer<typeof magicLinkSchema>;

export default function LoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginMode, setLoginMode] = useState<'password' | 'magic-link'>('password');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkEmail, setMagicLinkEmail] = useState('');

  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    formState: { errors: passwordErrors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const {
    register: registerMagicLink,
    handleSubmit: handleMagicLinkSubmit,
    formState: { errors: magicLinkErrors },
  } = useForm<MagicLinkForm>({
    resolver: zodResolver(magicLinkSchema),
  });

  const onPasswordSubmit = async (data: LoginForm) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || t('auth.loginError'));
      }

      // Store token and redirect
      localStorage.setItem('accessToken', result.accessToken);
      localStorage.setItem('user', JSON.stringify(result.user));
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginError'));
    } finally {
      setLoading(false);
    }
  };

  const onMagicLinkSubmit = async (data: MagicLinkForm) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/magic-link/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || t('auth.loginError'));
      }

      setMagicLinkEmail(data.email);
      setMagicLinkSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginError'));
    } finally {
      setLoading(false);
    }
  };

  const switchToPassword = () => {
    setLoginMode('password');
    setMagicLinkSent(false);
    setError(null);
  };

  const switchToMagicLink = () => {
    setLoginMode('magic-link');
    setError(null);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-2xl">O</span>
          </div>
          <CardTitle className="text-2xl">{t('auth.login')}</CardTitle>
          <CardDescription>OpenCoop</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Mode toggle buttons */}
          <div className="flex gap-2 mb-6">
            <Button
              type="button"
              variant={loginMode === 'password' ? 'default' : 'outline'}
              className="flex-1"
              onClick={switchToPassword}
            >
              {t('auth.passwordLogin')}
            </Button>
            <Button
              type="button"
              variant={loginMode === 'magic-link' ? 'default' : 'outline'}
              className="flex-1"
              onClick={switchToMagicLink}
            >
              {t('auth.magicLinkLogin')}
            </Button>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loginMode === 'password' ? (
            <form onSubmit={handlePasswordSubmit(onPasswordSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t('common.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t('auth.emailPlaceholder')}
                  {...registerPassword('email')}
                />
                {passwordErrors.email && (
                  <p className="text-sm text-destructive">{passwordErrors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label htmlFor="password">{t('auth.passwordPlaceholder')}</Label>
                  <Link
                    href="/forgot-password"
                    className="text-sm text-primary hover:underline"
                  >
                    {t('auth.forgotPassword')}
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  {...registerPassword('password')}
                />
                {passwordErrors.password && (
                  <p className="text-sm text-destructive">{passwordErrors.password.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t('common.loading') : t('auth.login')}
              </Button>
            </form>
          ) : magicLinkSent ? (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg
                  className="w-8 h-8 text-green-600"
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
              <p className="text-muted-foreground">
                {t('auth.magicLinkSent', { email: magicLinkEmail })}
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setMagicLinkSent(false)}
              >
                {t('auth.sendAnotherLink')}
              </Button>
            </div>
          ) : (
            <form onSubmit={handleMagicLinkSubmit(onMagicLinkSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="magic-email">{t('common.email')}</Label>
                <Input
                  id="magic-email"
                  type="email"
                  placeholder={t('auth.emailPlaceholder')}
                  {...registerMagicLink('email')}
                />
                {magicLinkErrors.email && (
                  <p className="text-sm text-destructive">{magicLinkErrors.email.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t('common.loading') : t('auth.sendMagicLink')}
              </Button>
            </form>
          )}

          <div className="mt-6 text-center text-sm">
            <span className="text-muted-foreground">
              {t('registration.createAccount')}{' '}
            </span>
            <Link href="/register" className="text-primary hover:underline">
              {t('auth.register')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
