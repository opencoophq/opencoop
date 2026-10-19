'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { formatCurrency } from '@opencoop/shared';
import { resolveLogoUrl } from '@/lib/api';
import {
  chargeCardEntryPath,
  chargeCardRequestPath,
  entryView,
  membershipForCoop,
  type EntryView,
  type Membership,
} from '@/lib/charge-card-entry';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, LogIn, UserPlus } from 'lucide-react';

interface PublicInfo {
  coopName: string;
  coopSlug: string;
  logoUrl: string | null;
  primaryColor: string;
  enabled: boolean;
  feeInclVat: string | null;
  replacementFeeInclVat: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const CURRENCY_LOCALE: Record<string, string> = {
  nl: 'nl-BE',
  fr: 'fr-BE',
  en: 'en-GB',
  de: 'de-DE',
};

/**
 * Raw fetch, not `api()`: this page is public. `api()` sends a stored token
 * and, on 401, redirects to /login, which would bounce a visitor with a stale
 * session off the "are you already a member?" step.
 */
async function loadPublicInfo(coopSlug: string): Promise<PublicInfo | 'missing'> {
  const response = await fetch(`${API_URL}/public/coops/${encodeURIComponent(coopSlug)}/charge-cards`);
  if (response.status === 404) return 'missing';
  if (!response.ok) throw new Error('charge card public info failed');
  return response.json();
}

async function loadMembership(coopSlug: string): Promise<{ loggedIn: boolean; membership: Membership }> {
  const token = localStorage.getItem('accessToken');
  if (!token) return { loggedIn: false, membership: 'NONE' };
  const response = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return { loggedIn: false, membership: 'NONE' };
  const profile = (await response.json()) as {
    shareholders?: Array<{ status?: string; coop?: { slug?: string } }>;
  };
  return {
    loggedIn: true,
    membership: membershipForCoop(profile.shareholders ?? [], coopSlug),
  };
}

export default function ChargeCardEntry({ coopSlug }: { coopSlug: string }) {
  const t = useTranslations('chargeCards.entry');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const afterRegistration = searchParams.get('after') === 'registration';
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [membership, setMembership] = useState<Membership>('NONE');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadPublicInfo(coopSlug);
        if (cancelled) return;
        if (loaded === 'missing') {
          setMissing(true);
          return;
        }
        setInfo(loaded);
        if (!loaded.enabled) return;
        const session = await loadMembership(coopSlug);
        if (cancelled) return;
        setLoggedIn(session.loggedIn);
        setMembership(session.membership);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coopSlug]);

  const view: EntryView | null =
    info?.enabled && !loading ? entryView({ loggedIn, membership, afterRegistration }) : null;
  const requestPath = chargeCardRequestPath(locale, coopSlug);

  useEffect(() => {
    if (view === 'redirect-request') router.replace(requestPath);
  }, [view, requestPath, router]);

  if (loading || view === 'redirect-request') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (missing) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Alert>
          <AlertDescription>{t('notFound')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (failed || !info) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Alert>
          <AlertDescription>{t('unavailable')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const logo = resolveLogoUrl(info.logoUrl);
  const money = (value: string | null) =>
    formatCurrency(Number(value ?? 0), CURRENCY_LOCALE[locale] ?? 'nl-BE');

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-10" data-testid="charge-card-entry">
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          {logo && (
            <img src={logo} alt={info.coopName} className="mb-3 h-10 max-w-[180px] object-contain" />
          )}
          <CardTitle>{t('title')}</CardTitle>
          {info.enabled ? (
            <p className="text-sm text-muted-foreground">
              {t('intro', {
                coop: info.coopName,
                fee: money(info.feeInclVat),
                replacementFee: money(info.replacementFeeInclVat),
              })}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
          )}
        </CardHeader>
        {info.enabled && (
          <CardContent>
            {view === 'ask' && <Ask t={t} coopSlug={coopSlug} locale={locale} color={info.primaryColor} />}
            {view === 'after-registration' && (
              <AfterRegistration
                t={t}
                coopSlug={coopSlug}
                locale={locale}
                color={info.primaryColor}
                fee={money(info.feeInclVat)}
              />
            )}
            {view === 'pending' && (
              <Status
                title={t('pendingTitle')}
                body={t('pendingBody', { coop: info.coopName, fee: money(info.feeInclVat) })}
                actionHref="/dashboard/shares"
                actionLabel={t('viewShares')}
                color={info.primaryColor}
              />
            )}
            {view === 'inactive' && (
              <Status
                title={t('inactiveTitle')}
                body={t('inactiveBody', { coop: info.coopName })}
                actionHref={registerHref(coopSlug, locale)}
                actionLabel={t('buyShares')}
                color={info.primaryColor}
              />
            )}
            {view === 'join' && (
              <Status
                title={t('joinTitle')}
                body={t('joinBody', { coop: info.coopName })}
                actionHref={registerHref(coopSlug, locale)}
                actionLabel={t('buyShares')}
                color={info.primaryColor}
              />
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function registerHref(coopSlug: string, locale: string): string {
  return `/${coopSlug}/register?returnTo=${encodeURIComponent(chargeCardEntryPath(locale, coopSlug, true))}`;
}

function loginHref(coopSlug: string, locale: string): string {
  return `/${coopSlug}/login?redirect=${encodeURIComponent(chargeCardRequestPath(locale, coopSlug))}`;
}

function Ask({
  t,
  coopSlug,
  locale,
  color,
}: {
  t: ReturnType<typeof useTranslations<'chargeCards.entry'>>;
  coopSlug: string;
  locale: string;
  color: string;
}) {
  return (
    <div className="space-y-4" data-testid="charge-card-question">
      <h2 className="text-lg font-semibold">{t('question')}</h2>
      <div className="grid gap-3">
        <Link href={loginHref(coopSlug, locale)} data-testid="charge-card-yes">
          <Button className="h-auto w-full justify-start whitespace-normal py-3 text-left" style={{ backgroundColor: color }}>
            <LogIn className="mr-2 h-4 w-4 shrink-0" />
            <span>
              <span className="block font-medium">{t('yes')}</span>
              <span className="block text-xs font-normal opacity-90">{t('yesHint')}</span>
            </span>
          </Button>
        </Link>
        <Link href={registerHref(coopSlug, locale)} data-testid="charge-card-no">
          <Button variant="outline" className="h-auto w-full justify-start whitespace-normal py-3 text-left">
            <UserPlus className="mr-2 h-4 w-4 shrink-0" />
            <span>
              <span className="block font-medium">{t('no')}</span>
              <span className="block text-xs font-normal text-muted-foreground">{t('noHint')}</span>
            </span>
          </Button>
        </Link>
      </div>
    </div>
  );
}

function AfterRegistration({
  t,
  coopSlug,
  locale,
  color,
  fee,
}: {
  t: ReturnType<typeof useTranslations<'chargeCards.entry'>>;
  coopSlug: string;
  locale: string;
  color: string;
  fee: string;
}) {
  return (
    <div className="space-y-4" data-testid="charge-card-after-registration">
      <h2 className="text-lg font-semibold">{t('afterTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('afterIntro')}</p>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>{t('afterStepPay')}</li>
        <li>{t('afterStepWait')}</li>
        <li>{t('afterStepReturn', { fee })}</li>
      </ol>
      <Link href={loginHref(coopSlug, locale)}>
        <Button className="w-full" style={{ backgroundColor: color }}>
          {t('loginWhenActive')}
        </Button>
      </Link>
    </div>
  );
}

function Status({
  title,
  body,
  actionHref,
  actionLabel,
  color,
}: {
  title: string;
  body: string;
  actionHref: string;
  actionLabel: string;
  color: string;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
      <Link href={actionHref}>
        <Button className="w-full" style={{ backgroundColor: color }}>
          {actionLabel}
        </Button>
      </Link>
    </div>
  );
}
