'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';
import { Shield, ShieldCheck, ShieldOff, Copy, Check } from 'lucide-react';

type MfaState = 'idle' | 'setup' | 'verify' | 'recovery-codes' | 'disable';

interface MfaSetupProps {
  mfaEnabled: boolean;
  onStatusChange: (enabled: boolean) => void;
}

export function MfaSetup({ mfaEnabled, onStatusChange }: MfaSetupProps) {
  const t = useTranslations();
  const [state, setState] = useState<MfaState>('idle');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disablePassword, setDisablePassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSetup = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ qrCodeDataUrl: string; secret: string }>('/auth/mfa/setup', {
        method: 'POST',
      });
      setQrCodeDataUrl(result.qrCodeDataUrl);
      setSecret(result.secret);
      setState('setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mfa.setupError'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ recoveryCodes: string[] }>('/auth/mfa/enable', {
        method: 'POST',
        body: { code: verifyCode },
      });
      setRecoveryCodes(result.recoveryCodes);
      setState('recovery-codes');
      onStatusChange(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mfa.invalidCode'));
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    setLoading(true);
    setError(null);
    try {
      await api('/auth/mfa/disable', {
        method: 'POST',
        body: { password: disablePassword },
      });
      setState('idle');
      setDisablePassword('');
      onStatusChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mfa.disableError'));
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateRecoveryCodes = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', {
        method: 'POST',
      });
      setRecoveryCodes(result.recoveryCodes);
      setState('recovery-codes');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mfa.regenerateError'));
    } finally {
      setLoading(false);
    }
  };

  const copyRecoveryCodes = () => {
    navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {mfaEnabled ? <ShieldCheck className="w-5 h-5 text-green-600" /> : <Shield className="w-5 h-5" />}
          {t('mfa.title')}
        </CardTitle>
        <CardDescription>{t('mfa.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Idle state - show enable/disable */}
        {state === 'idle' && (
          <div className="space-y-4">
            {mfaEnabled ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <ShieldCheck className="w-4 h-4" />
                  {t('mfa.enabled')}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleRegenerateRecoveryCodes} disabled={loading}>
                    {t('mfa.regenerateRecoveryCodes')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setState('disable'); setError(null); }}
                    className="text-destructive hover:text-destructive"
                  >
                    <ShieldOff className="w-4 h-4 mr-1" />
                    {t('mfa.disable')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button onClick={handleSetup} disabled={loading}>
                <Shield className="w-4 h-4 mr-2" />
                {t('mfa.enable')}
              </Button>
            )}
          </div>
        )}

        {/* Setup state - show QR code */}
        {state === 'setup' && qrCodeDataUrl && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('mfa.scanQrCode')}</p>
            <div className="flex justify-center">
              <img src={qrCodeDataUrl} alt="MFA QR Code" className="w-48 h-48" />
            </div>
            {secret && (
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-1">{t('mfa.manualEntry')}</p>
                <code className="text-sm bg-muted px-3 py-1 rounded select-all">{secret}</code>
              </div>
            )}
            <div className="space-y-2">
              <Label>{t('mfa.enterVerificationCode')}</Label>
              <Input
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                className="text-center text-xl tracking-[0.5em] font-mono"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setState('idle'); setError(null); }}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleVerify} disabled={loading || verifyCode.length !== 6} className="flex-1">
                {loading ? t('common.loading') : t('mfa.verify')}
              </Button>
            </div>
          </div>
        )}

        {/* Recovery codes display */}
        {state === 'recovery-codes' && recoveryCodes.length > 0 && (
          <div className="space-y-4">
            <Alert>
              <AlertDescription>{t('mfa.saveRecoveryCodes')}</AlertDescription>
            </Alert>
            <div className="bg-muted rounded-lg p-4 font-mono text-sm grid grid-cols-2 gap-2">
              {recoveryCodes.map((code, i) => (
                <span key={i}>{code}</span>
              ))}
            </div>
            <Button variant="outline" onClick={copyRecoveryCodes} className="w-full">
              {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
              {copied ? t('common.copied') : t('mfa.copyRecoveryCodes')}
            </Button>
            <Button onClick={() => { setState('idle'); setRecoveryCodes([]); }} className="w-full">
              {t('common.done')}
            </Button>
          </div>
        )}

        {/* Disable confirmation */}
        {state === 'disable' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('mfa.confirmDisable')}</p>
            <div className="space-y-2">
              <Label>{t('auth.passwordPlaceholder')}</Label>
              <Input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setState('idle'); setError(null); setDisablePassword(''); }}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDisable}
                disabled={loading || !disablePassword}
                className="flex-1"
              >
                {loading ? t('common.loading') : t('mfa.disable')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
