'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { startRegistration } from '@simplewebauthn/browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';
import { useLocale } from '@/contexts/locale-context';
import { Fingerprint, Trash2, Plus } from 'lucide-react';

interface Passkey {
  id: string;
  friendlyName: string | null;
  credentialDeviceType: string;
  credentialBackedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export function PasskeysManager() {
  const t = useTranslations();
  const { locale } = useLocale();
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addName, setAddName] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchPasskeys = useCallback(async () => {
    try {
      const result = await api<Passkey[]>('/auth/webauthn/credentials');
      setPasskeys(result);
    } catch {
      // Ignore - passkeys just won't show
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPasskeys();
  }, [fetchPasskeys]);

  const handleAdd = async () => {
    setAdding(true);
    setError(null);
    try {
      const options = await api<Record<string, unknown>>('/auth/webauthn/register-options', {
        method: 'POST',
      });

      const regResponse = await startRegistration({ optionsJSON: options as any });

      await api('/auth/webauthn/register-verify', {
        method: 'POST',
        body: { response: regResponse, friendlyName: addName || undefined },
      });

      setAddName('');
      await fetchPasskeys();
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setAdding(false);
        return;
      }
      setError(err instanceof Error ? err.message : t('passkeys.registerError'));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm(t('passkeys.removeConfirm'))) return;
    try {
      await api(`/auth/webauthn/credentials/${id}`, { method: 'DELETE' });
      setPasskeys(passkeys.filter((p) => p.id !== id));
    } catch {
      setError(t('passkeys.removeError'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="w-5 h-5" />
          {t('passkeys.title')}
        </CardTitle>
        <CardDescription>{t('passkeys.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Passkey list */}
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('passkeys.noPasskeys')}</p>
        ) : (
          <div className="space-y-2">
            {passkeys.map((passkey) => (
              <div key={passkey.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium text-sm">
                    {passkey.friendlyName || passkey.credentialDeviceType}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('passkeys.createdAt')}: {new Date(passkey.createdAt).toLocaleDateString(locale)}
                    {' · '}
                    {t('passkeys.lastUsed')}: {passkey.lastUsedAt
                      ? new Date(passkey.lastUsedAt).toLocaleDateString(locale)
                      : t('passkeys.never')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(passkey.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add passkey */}
        <div className="flex gap-2">
          <Input
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder={t('passkeys.friendlyNamePlaceholder')}
            className="flex-1"
          />
          <Button onClick={handleAdd} disabled={adding} size="sm">
            <Plus className="w-4 h-4 mr-1" />
            {t('passkeys.add')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
