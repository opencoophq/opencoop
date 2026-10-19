'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function ConfirmVolunteerPage() {
  const t = useTranslations('volunteers');
  const params = useParams<{ token: string }>();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    const token = params.token;
    if (!token) return;
    api('/public/volunteers/confirm', { method: 'POST', body: { token } })
      .then(() => setState('ok'))
      .catch(() => setState('error'));
  }, [params.token]);

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-16">
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>{state === 'error' ? t('confirmError') : t('confirmTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {state === 'loading' && <Loader2 className="h-5 w-5 animate-spin" />}
          {state === 'ok' && (
            <Alert>
              <AlertDescription>{t('confirmBody')}</AlertDescription>
            </Alert>
          )}
          {state === 'error' && (
            <Alert variant="destructive">
              <AlertDescription>{t('confirmError')}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
