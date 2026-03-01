'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { resolveLogoUrl } from '@/lib/api';
import { MfaVerifyStep } from '@/components/auth/mfa-verify-step';

type VerifyState = 'loading' | 'success' | 'error' | 'mfa';

interface CoopPublicInfo {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}

export default function MagicLinkPage() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const coopSlug = searchParams.get('coop');

  const [state, setState] = useState<VerifyState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [coop, setCoop] = useState<CoopPublicInfo | null>(null);
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  // Fetch coop branding if coopSlug is provided
  useEffect(() => {
    if (!coopSlug) return;

    const fetchCoop = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/coops/${coopSlug}/public-info`
        );

        if (response.ok) {
          const data = await response.json();
          setCoop(data);
        }
      } catch {
        // Ignore errors, just use default branding
      }
    };

    fetchCoop();
  }, [coopSlug]);

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

        // Check if MFA is required
        if (result.requiresMfa) {
          setMfaToken(result.mfaToken);
          setState('mfa');
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

  const loginUrl = coop ? `/${coop.slug}/login` : '/login';

  return (
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
            {state === 'mfa' && t('mfa.verifyTitle')}
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
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto bg-green-100 dark:bg-green-900/30"
                style={coop ? { backgroundColor: `${coop.primaryColor}20` } : undefined}
              >
                <svg
                  className="w-8 h-8 text-green-600 dark:text-green-400"
                  style={coop ? { color: coop.primaryColor } : undefined}
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

          {state === 'mfa' && mfaToken && (
            <MfaVerifyStep
              mfaToken={mfaToken}
              brandColor={coop?.primaryColor}
              onSuccess={(result) => {
                localStorage.setItem('accessToken', result.accessToken);
                localStorage.setItem('user', JSON.stringify(result.user));
                setState('success');
                setTimeout(() => {
                  router.push('/dashboard');
                }, 2000);
              }}
            />
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
  );
}
