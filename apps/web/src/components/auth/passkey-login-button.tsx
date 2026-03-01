'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { startAuthentication } from '@simplewebauthn/browser';
import { Button } from '@/components/ui/button';
import { Fingerprint } from 'lucide-react';

interface PasskeyLoginButtonProps {
  onSuccess: (result: { accessToken: string; user: Record<string, unknown> }) => void;
  onMfaRequired?: (mfaToken: string) => void;
  onError?: (error: string) => void;
  brandColor?: string;
}

export function PasskeyLoginButton({ onSuccess, onMfaRequired, onError, brandColor }: PasskeyLoginButtonProps) {
  const t = useTranslations();
  const [loading, setLoading] = useState(false);

  const handlePasskeyLogin = async () => {
    setLoading(true);
    try {
      // Get authentication options from server
      const optionsRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/webauthn/authenticate-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const options = await optionsRes.json();

      // Start browser WebAuthn flow
      const authResponse = await startAuthentication({ optionsJSON: options });

      // Verify with server
      const verifyRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/webauthn/authenticate-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: authResponse }),
      });

      const result = await verifyRes.json();

      if (!verifyRes.ok) {
        throw new Error(result.message || t('passkeys.loginError'));
      }

      if (result.requiresMfa) {
        onMfaRequired?.(result.mfaToken);
        return;
      }

      onSuccess(result);
    } catch (err) {
      // User cancelled or WebAuthn not available
      if (err instanceof Error && err.name === 'NotAllowedError') {
        return; // User cancelled, no error message
      }
      const message = err instanceof Error ? err.message : t('passkeys.loginError');
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={handlePasskeyLogin}
      disabled={loading}
      style={brandColor ? { borderColor: brandColor, color: brandColor } : undefined}
    >
      <Fingerprint className="w-5 h-5 mr-2" />
      {loading ? t('common.loading') : t('passkeys.loginButton')}
    </Button>
  );
}
