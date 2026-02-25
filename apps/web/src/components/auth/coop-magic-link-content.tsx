'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { useSearchParams, notFound } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { resolveLogoUrl } from '@/lib/api';

type VerifyState = 'loading' | 'success' | 'error';

interface CoopPublicInfo {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}

export function CoopMagicLinkContent({ coopSlug }: { coopSlug: string }) {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [state, setState] = useState<VerifyState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [coop, setCoop] = useState<CoopPublicInfo | null>(null);
  const [coopLoading, setCoopLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState(false);

  // Fetch coop branding
  useEffect(() => {
    const fetchCoop = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/coops/${coopSlug}/public-info`
        );

        if (response.status === 404) {
          setNotFoundError(true);
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to fetch coop');
        }

        const data = await response.json();
        setCoop(data);
      } catch {
        setNotFoundError(true);
      } finally {
        setCoopLoading(false);
      }
    };

    fetchCoop();
  }, [coopSlug]);

  // Verify token
  useEffect(() => {
    if (coopLoading) return;

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
  }, [token, router, t, coopLoading]);

  if (notFoundError) {
    notFound();
  }

  if (coopLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const loginUrl = coop ? `/${coop.slug}/login` : '/login';

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {/* Logo */}
          {coop?.logoUrl ? (
            <img
              src={resolveLogoUrl(coop.logoUrl)!}
              alt={coop.name}
              className="h-12 mx-auto mb-4 object-contain"
            />
          ) : (
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: coop?.primaryColor || 'hsl(var(--primary))' }}
            >
              <span className="text-white font-bold text-2xl">
                {coop ? coop.name.charAt(0).toUpperCase() : 'O'}
              </span>
            </div>
          )}
          <CardTitle className="text-2xl">
            {state === 'loading' && t('auth.magicLinkVerifying')}
            {state === 'success' && t('auth.loginSuccess')}
            {state === 'error' && t('auth.loginError')}
          </CardTitle>
          <CardDescription>{coop?.name || 'OpenCoop'}</CardDescription>
        </CardHeader>
        <CardContent>
          {state === 'loading' && (
            <div className="text-center space-y-4">
              <div
                className="w-16 h-16 border-4 border-t-transparent rounded-full animate-spin mx-auto"
                style={{ borderColor: coop?.primaryColor || 'hsl(var(--primary))', borderTopColor: 'transparent' }}
              />
              <p className="text-muted-foreground">{t('auth.magicLinkVerifying')}</p>
            </div>
          )}

          {state === 'success' && (
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
                <Link href={loginUrl}>
                  <Button
                    variant="outline"
                    className="w-full"
                    style={coop ? { borderColor: coop.primaryColor, color: coop.primaryColor } : undefined}
                  >
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
