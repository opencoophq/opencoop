'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MfaVerifyStep } from '@/components/auth/mfa-verify-step';

export default function OAuthCallbackPage() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const mfaTokenParam = searchParams.get('mfaToken');
    const dataParam = searchParams.get('data');

    if (mfaTokenParam) {
      setMfaToken(mfaTokenParam);
      return;
    }

    if (dataParam) {
      try {
        const result = JSON.parse(decodeURIComponent(dataParam));
        if (result.accessToken && result.user) {
          localStorage.setItem('accessToken', result.accessToken);
          localStorage.setItem('user', JSON.stringify(result.user));
          router.push('/dashboard');
          return;
        }
      } catch {
        setError(t('auth.loginError'));
      }
    } else {
      setError(t('auth.loginError'));
    }
  }, [searchParams, router, t]);

  if (mfaToken) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{t('mfa.verifyTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <MfaVerifyStep
            mfaToken={mfaToken}
            onSuccess={(result) => {
              localStorage.setItem('accessToken', result.accessToken);
              localStorage.setItem('user', JSON.stringify(result.user));
              router.push('/dashboard');
            }}
          />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="text-center py-8">
          <p className="text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardContent className="text-center py-8">
        <div className="w-12 h-12 border-4 border-t-transparent border-primary rounded-full animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground">{t('common.loading')}</p>
      </CardContent>
    </Card>
  );
}
