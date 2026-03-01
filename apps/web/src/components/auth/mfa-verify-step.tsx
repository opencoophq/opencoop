'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface MfaVerifyStepProps {
  mfaToken: string;
  onSuccess: (result: { accessToken: string; user: Record<string, unknown> }) => void;
  onBack?: () => void;
  brandColor?: string;
}

export function MfaVerifyStep({ mfaToken, onSuccess, onBack, brandColor }: MfaVerifyStepProps) {
  const t = useTranslations();
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const body: Record<string, string> = { mfaToken };
      if (useRecovery) {
        body.recoveryCode = recoveryCode.trim();
      } else {
        body.code = code.trim();
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || t('mfa.verifyError'));
      }

      onSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mfa.verifyError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <h3 className="text-lg font-semibold">{t('mfa.verifyTitle')}</h3>
        <p className="text-sm text-muted-foreground">
          {useRecovery ? t('mfa.enterRecoveryCode') : t('mfa.enterCode')}
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {useRecovery ? (
          <div className="space-y-2">
            <Label htmlFor="recoveryCode">{t('mfa.recoveryCode')}</Label>
            <Input
              id="recoveryCode"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              placeholder="a1b2c3d4e5"
              autoFocus
              autoComplete="off"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="mfaCode">{t('mfa.code')}</Label>
            <Input
              id="mfaCode"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              autoComplete="one-time-code"
              className="text-center text-2xl tracking-[0.5em] font-mono"
            />
          </div>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={loading || (!useRecovery && code.length !== 6) || (useRecovery && !recoveryCode.trim())}
          style={brandColor ? { backgroundColor: brandColor } : undefined}
        >
          {loading ? t('common.loading') : t('mfa.verify')}
        </Button>
      </form>

      <div className="text-center">
        <button
          type="button"
          onClick={() => {
            setUseRecovery(!useRecovery);
            setError(null);
            setCode('');
            setRecoveryCode('');
          }}
          className="text-sm text-primary hover:underline"
        >
          {useRecovery ? t('mfa.useAuthenticator') : t('mfa.useRecoveryCode')}
        </button>
      </div>

      {onBack && (
        <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
          {t('common.back')}
        </Button>
      )}
    </div>
  );
}
