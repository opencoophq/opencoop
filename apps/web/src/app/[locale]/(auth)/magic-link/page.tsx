'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type VerifyState = 'loading' | 'success' | 'error';

export default function MagicLinkPage() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [state, setState] = useState<VerifyState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setErrorMessage(t('auth.magicLinkInvalid'));
      return;
    }

    const verifyToken = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/magic-link/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const result = await response.json();

        if (!response.ok) {
          setState('error');
          if (result.message?.includes('expired')) {
            setErrorMessage(t('auth.magicLinkExpired'));
          } else if (result.message?.includes('already been used')) {
            setErrorMessage(t('auth.magicLinkUsed'));
          } else {
            setErrorMessage(t('auth.magicLinkInvalid'));
          }
          return;
        }

        // Store token and user data
        localStorage.setItem('accessToken', result.accessToken);
        localStorage.setItem('user', JSON.stringify(result.user));

        setState('success');

        // Redirect to dashboard after a short delay
        setTimeout(() => {
          router.push('/dashboard');
        }, 2000);
      } catch {
        setState('error');
        setErrorMessage(t('auth.loginError'));
      }
    };

    verifyToken();
  }, [token, router, t]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-2xl">O</span>
          </div>
          <CardTitle className="text-2xl">
            {state === 'loading' && t('auth.magicLinkVerifying')}
            {state === 'success' && t('auth.loginSuccess')}
            {state === 'error' && t('auth.loginError')}
          </CardTitle>
          <CardDescription>OpenCoop</CardDescription>
        </CardHeader>
        <CardContent>
          {state === 'loading' && (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-muted-foreground">{t('auth.magicLinkVerifying')}</p>
            </div>
          )}

          {state === 'success' && (
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
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <p className="text-muted-foreground">{t('auth.magicLinkSuccess')}</p>
            </div>
          )}

          {state === 'error' && (
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">{t('auth.magicLinkTryAgain')}</p>
                <Link href="/login">
                  <Button variant="outline" className="w-full">
                    {t('auth.backToLogin')}
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
