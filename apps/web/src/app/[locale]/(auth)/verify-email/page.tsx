'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function VerifyEmailPage() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }

    fetch(`${API_URL}/auth/verify-email?token=${token}`)
      .then((res) => {
        if (res.ok) {
          setStatus('success');
        } else {
          setStatus('error');
        }
      })
      .catch(() => {
        setStatus('error');
      });
  }, [token]);

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{t('auth.verifyEmail')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
              <p className="font-medium text-green-600">{t('auth.verifyEmailSuccess')}</p>
            </div>
            <Link href="/dashboard">
              <Button className="w-full">{t('auth.goToDashboard')}</Button>
            </Link>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertDescription>{t('auth.verifyEmailError')}</AlertDescription>
            </Alert>
            <Link href="/login">
              <Button variant="outline" className="w-full">
                {t('auth.backToLogin')}
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
