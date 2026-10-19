'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { notFound, useRouter } from 'next/navigation';
import { formatCurrency } from '@opencoop/shared';
import { resolveLogoUrl } from '@/lib/api';
import { updateActiveSessionToken } from '@/lib/sessions';
import {
  chargeCardLoginPath,
  chargeCardRegisterPath,
  chargeCardRequestPath,
  chargeCardEntryPath,
  isCoopSlug,
  pickCoopShareholderStatus,
  resolveChargeCardEntry,
  type ChargeCardEntryKind,
  type ShareholderStatus,
} from '@/lib/charge-card-entry';
import { consumePostLoginRedirect, peekPostLoginRedirect } from '@/lib/post-login-redirect';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const CURRENCY_LOCALE: Record<string, string> = {
  nl: 'nl-BE',
  fr: 'fr-BE',
  en: 'en-GB',
  de: 'de-BE',
};

interface PublicInfo {
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  chargeCards: { feeInclVat: string; replacementFeeInclVat: string } | null;
}

interface SessionState {
  loggedIn: boolean;
  shareholderStatus: ShareholderStatus | null;
}

async function loadSession(coopSlug: string): Promise<SessionState> {
  const readProfile = async (token: string) =>
    fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });

  let token = localStorage.getItem('accessToken');
  if (!token) return { loggedIn: false, shareholderStatus: null };

  let response = await readProfile(token);
  if (response.status === 401) {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return { loggedIn: false, shareholderStatus: null };
    const refreshed = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!refreshed.ok) return { loggedIn: false, shareholderStatus: null };
    const data = (await refreshed.json()) as { accessToken?: string };
    if (!data.accessToken) return { loggedIn: false, shareholderStatus: null };
    token = data.accessToken;
    updateActiveSessionToken(token);
    response = await readProfile(token);
  }

  if (!response.ok) return { loggedIn: false, shareholderStatus: null };
  const profile = (await response.json()) as {
    shareholders?: Array<{ status?: string | null; coop?: { slug?: string | null } | null }>;
  };
  return {
    loggedIn: true,
    shareholderStatus: pickCoopShareholderStatus(profile.shareholders ?? [], coopSlug),
  };
}

export default function ChargeCardEntry({ coopSlug }: { coopSlug: string }) {
  const t = useTranslations('chargeCardEntry');
  const locale = useLocale();
  const router = useRouter();
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<ChargeCardEntryKind | null>(null);
  const [explain, setExplain] = useState(false);

  const load = useCallback(async () => {
    if (!isCoopSlug(coopSlug)) {
      setMissing(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    setMissing(false);
    try {
      const response = await fetch(`${API_URL}/coops/${encodeURIComponent(coopSlug)}/public-info`);
      if (response.status === 404) {
        setMissing(true);
        return;
      }
      if (!response.ok) throw new Error(`public-info ${response.status}`);
      const data = (await response.json()) as PublicInfo;
      const session = await loadSession(coopSlug);
      const next = resolveChargeCardEntry({
        enabled: data.chargeCards != null,
        loggedIn: session.loggedIn,
        shareholderStatus: session.shareholderStatus,
      });
      setInfo(data);
      setDecision(next);
      // Arriving here was the point of the stored return target. Drop it so a
      // later visit to the dashboard is not sent back to this page.
      const entry = chargeCardEntryPath(locale, coopSlug);
      if (entry && peekPostLoginRedirect() === entry) consumePostLoginRedirect();
      if (next === 'request') {
        const requestPath = chargeCardRequestPath(locale);
        if (requestPath) router.replace(requestPath);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [coopSlug, locale, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) notFound();

  const loginHref = chargeCardLoginPath(locale, coopSlug);
  const registerHref = chargeCardRegisterPath(locale, coopSlug);
  const fee = info?.chargeCards
    ? formatCurrency(Number(info.chargeCards.feeInclVat), CURRENCY_LOCALE[locale] ?? locale)
    : '';
  const replacementFee = info?.chargeCards
    ? formatCurrency(Number(info.chargeCards.replacementFeeInclVat), CURRENCY_LOCALE[locale] ?? locale)
    : '';
  const logo = resolveLogoUrl(info?.logoUrl);

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-10">
      <div className="mx-auto mb-4 flex max-w-lg justify-end">
        <LanguageSwitcher />
      </div>
      <Card className="mx-auto max-w-lg" data-testid="charge-card-entry">
        <CardHeader className="space-y-3">
          {logo && info && (
            <img src={logo} alt={info.name} className="h-12 w-auto object-contain" />
          )}
          <CardTitle className="text-2xl">{t('title')}</CardTitle>
          {info && decision !== 'unavailable' && decision !== null && (
            <p className="text-sm text-muted-foreground">
              {t('intro', { coop: info.name, fee, replacementFee })}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {!loading && loadError && (
            <Alert>
              <AlertDescription className="space-y-3">
                <p>{t('loadError')}</p>
                <Button type="button" variant="outline" onClick={() => void load()}>
                  {t('retry')}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {!loading && decision === 'unavailable' && info && (
            <Alert>
              <AlertDescription>{t('unavailable', { coop: info.name })}</AlertDescription>
            </Alert>
          )}

          {!loading && decision === 'ask' && !explain && info && loginHref && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">{t('question', { coop: info.name })}</h2>
              <Button asChild className="w-full" style={{ backgroundColor: info.primaryColor }}>
                <a href={loginHref} data-testid="charge-card-entry-yes">
                  {t('yes')}
                </a>
              </Button>
              <p className="text-sm text-muted-foreground">{t('yesHelp')}</p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                data-testid="charge-card-entry-no"
                onClick={() => setExplain(true)}
              >
                {t('no')}
              </Button>
              <p className="text-sm text-muted-foreground">{t('noHelp')}</p>
            </div>
          )}

          {!loading && ((decision === 'ask' && explain) || decision === 'become-shareholder') && info && registerHref && loginHref && (
            <div className="space-y-3" data-testid="charge-card-entry-become">
              <h2 className="text-lg font-semibold">
                {decision === 'become-shareholder' ? t('loggedInBecomeTitle', { coop: info.name }) : t('becomeTitle')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {decision === 'become-shareholder'
                  ? t('loggedInBecomeBody', { coop: info.name })
                  : t('becomeBody', { coop: info.name })}
              </p>
              <Button asChild className="w-full" style={{ backgroundColor: info.primaryColor }}>
                <a href={registerHref} data-testid="charge-card-entry-register">
                  {t('becomeButton')}
                </a>
              </Button>
              {decision === 'ask' && (
                <a href={loginHref} className="block text-center text-sm underline underline-offset-2">
                  {t('alreadyMember')}
                </a>
              )}
            </div>
          )}

          {!loading && decision === 'pending-payment' && (
            <div className="space-y-3" data-testid="charge-card-entry-pending">
              <h2 className="text-lg font-semibold">{t('pendingTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('pendingBody')}</p>
              <Button asChild className="w-full" style={{ backgroundColor: info?.primaryColor }}>
                <a href={`/${locale}/dashboard/shares`}>{t('pendingButton')}</a>
              </Button>
            </div>
          )}

          {!loading && decision === 'inactive' && info && registerHref && (
            <div className="space-y-3" data-testid="charge-card-entry-inactive">
              <h2 className="text-lg font-semibold">{t('inactiveTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('inactiveBody', { coop: info.name })}</p>
              <Button asChild className="w-full" style={{ backgroundColor: info.primaryColor }}>
                <a href={registerHref}>{t('inactiveButton')}</a>
              </Button>
            </div>
          )}

          {!loading && decision === 'request' && (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
