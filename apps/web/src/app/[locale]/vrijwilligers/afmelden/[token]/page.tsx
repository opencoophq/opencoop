'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function WithdrawVolunteerPage() {
  const t = useTranslations('volunteers');
  const params = useParams<{ token: string }>();
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');

  const withdraw = async () => {
    setState('loading');
    try {
      await api('/public/volunteers/withdraw', { method: 'POST', body: { token: params.token } });
      setState('ok');
    } catch {
      setState('error');
    }
  };

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-16">
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>{t('withdrawTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === 'ok' ? (
            <Alert>
              <AlertDescription>{t('withdrawDone')}</AlertDescription>
            </Alert>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t('withdrawBody')}</p>
              {state === 'error' && (
                <Alert variant="destructive">
                  <AlertDescription>{t('withdrawError')}</AlertDescription>
                </Alert>
              )}
              <Button onClick={withdraw} disabled={state === 'loading'}>
                {state === 'loading' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('withdrawButton')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
