'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { resolveLogoUrl } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { CheckCircle2, XCircle, UserCheck, MapPin, Calendar, Loader2 } from 'lucide-react';
import { formatDateTime } from '@opencoop/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type RsvpStatus = 'ATTENDING' | 'ABSENT' | 'PROXY' | 'UNKNOWN';

interface RsvpDetails {
  meeting: {
    id: string;
    title: string;
    scheduledAt: string;
    location?: string | null;
    durationMinutes: number;
    format: string;
    type: string;
    agenda: Array<{
      id: string;
      order: number;
      title: string;
      description?: string | null;
    }>;
  };
  coop: {
    id: string;
    name: string;
    logoUrl?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    coopEmail?: string | null;
  };
  shareholder: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
  };
  rsvpStatus: RsvpStatus;
  rsvpAt?: string | null;
}

type ProxyResolveError =
  | 'not_found'
  | 'ambiguous'
  | 'cap_reached'
  | 'rate_limited'
  | 'generic';

interface ResolvedDelegate {
  delegateShareholderId: string;
  displayName: string;
}

export default function PublicRsvpPage() {
  const t = useTranslations();
  const params = useParams();
  const router = useRouter();
  const { locale } = useLocale();

  const token = (params?.token as string) || '';

  const [details, setDetails] = useState<RsvpDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'expired' | 'generic' | null>(null);
  const [submitting, setSubmitting] = useState<RsvpStatus | null>(null);
  const [showProxy, setShowProxy] = useState(false);
  const [proxyFirstName, setProxyFirstName] = useState('');
  const [proxyLastName, setProxyLastName] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolvedDelegate | null>(null);
  const [proxyError, setProxyError] = useState<ProxyResolveError | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [expandedAgenda, setExpandedAgenda] = useState<Set<string>>(new Set());
  const proxySectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch(`${API_URL}/public/meetings/rsvp/${token}`)
      .then(async (r) => {
        if (r.status === 404 || r.status === 410) {
          setLoadError('expired');
          return null;
        }
        if (!r.ok) {
          setLoadError('generic');
          return null;
        }
        return (await r.json()) as RsvpDetails;
      })
      .then((data) => {
        if (data) setDetails(data);
      })
      .catch(() => setLoadError('generic'))
      .finally(() => setLoading(false));
  }, [token]);

  const submitRsvp = async (
    status: RsvpStatus,
    delegateShareholderId?: string,
  ) => {
    setSubmitting(status);
    setSubmitError(null);
    try {
      const res = await fetch(`${API_URL}/public/meetings/rsvp/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, delegateShareholderId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSubmitError(body?.message || t('meetings.publicRsvp.submitError'));
        setSubmitting(null);
        return;
      }
      // Use an absolute path including the token. A relative `./thanks`
      // resolves wrong: from `/<locale>/meetings/rsvp/<token>` the URL spec
      // treats `<token>` as a file (no trailing slash) and replaces it with
      // `thanks`, giving `/<locale>/meetings/rsvp/thanks` — the route then
      // catches `thanks` as the dynamic [token] param, the API GET 404s, and
      // the page renders the "Link verlopen" expired card even though the
      // PATCH above already succeeded.
      const localeSegment = (params?.locale as string) || locale || 'nl';
      router.push(
        `/${localeSegment}/meetings/rsvp/${token}/thanks?status=${status.toLowerCase()}`,
      );
    } catch {
      setSubmitError(t('meetings.publicRsvp.submitError'));
      setSubmitting(null);
    }
  };

  const openProxySection = () => {
    setShowProxy(true);
    // Defer the scroll so the section has mounted.
    requestAnimationFrame(() => {
      proxySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const resetProxy = () => {
    setResolved(null);
    setProxyError(null);
  };

  const findDelegate = async () => {
    if (!proxyFirstName.trim() || !proxyLastName.trim()) return;
    setResolving(true);
    setProxyError(null);
    try {
      const res = await fetch(
        `${API_URL}/public/meetings/rsvp/${token}/proxy/resolve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: proxyFirstName.trim(),
            lastName: proxyLastName.trim(),
          }),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as ResolvedDelegate;
        setResolved(data);
        return;
      }
      const body = await res.json().catch(() => ({}));
      const code = body?.code as ProxyResolveError | undefined;
      setProxyError(
        code === 'not_found' ||
          code === 'ambiguous' ||
          code === 'cap_reached' ||
          code === 'rate_limited'
          ? code
          : 'generic',
      );
    } catch {
      setProxyError('generic');
    } finally {
      setResolving(false);
    }
  };

  const toggleAgenda = (id: string) => {
    setExpandedAgenda((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (loadError === 'expired' || !details) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <XCircle className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-xl font-semibold">
              {t('meetings.publicRsvp.expiredTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('meetings.publicRsvp.expiredBody')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loadError === 'generic') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <XCircle className="h-12 w-12 text-destructive mx-auto" />
            <p className="text-sm text-muted-foreground">
              {t('meetings.publicRsvp.loadError')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const coopLogo = resolveLogoUrl(details.coop.logoUrl);
  const shareholderName = `${details.shareholder.firstName ?? ''} ${details.shareholder.lastName ?? ''}`.trim();
  const hasResponded = details.rsvpStatus !== 'UNKNOWN';

  return (
    <div className="min-h-screen">
      {/* Coop branded header */}
      <header className="bg-card border-b">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          {coopLogo ? (
            <img
              src={coopLogo}
              alt={details.coop.name}
              className="h-10 max-w-[180px] object-contain"
            />
          ) : (
            <span className="text-lg font-semibold">{details.coop.name}</span>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Greeting */}
        {shareholderName && (
          <p className="text-sm text-muted-foreground">
            {t('meetings.publicRsvp.greeting', { name: shareholderName })}
          </p>
        )}

        {/* Meeting info */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <h1 className="text-2xl font-bold">{details.meeting.title}</h1>
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <Calendar className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{formatDateTime(details.meeting.scheduledAt, locale, { dateStyle: 'full', timeStyle: 'short' })}</span>
              </div>
              {details.meeting.location && (
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{details.meeting.location}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Already responded banner */}
        {hasResponded && (
          <Alert>
            <AlertDescription>
              {t('meetings.publicRsvp.alreadyResponded', {
                status: t(
                  `meetings.publicRsvp.statusLabel.${details.rsvpStatus.toLowerCase()}` as 'meetings.publicRsvp.statusLabel.attending',
                ),
              })}
            </AlertDescription>
          </Alert>
        )}

        {/* Agenda */}
        {details.meeting.agenda.length > 0 && (
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-lg font-semibold mb-4">
                {t('meetings.publicRsvp.agendaHeading')}
              </h2>
              <ol className="space-y-3">
                {details.meeting.agenda.map((item) => {
                  const isOpen = expandedAgenda.has(item.id);
                  const hasDescription = !!item.description;
                  return (
                    <li
                      key={item.id}
                      className="border-l-2 border-muted pl-4 py-1"
                    >
                      <button
                        type="button"
                        disabled={!hasDescription}
                        onClick={() => hasDescription && toggleAgenda(item.id)}
                        className={`text-left w-full ${
                          hasDescription ? 'cursor-pointer hover:text-primary' : ''
                        }`}
                      >
                        <span className="font-medium">
                          {item.order}. {item.title}
                        </span>
                      </button>
                      {hasDescription && isOpen && (
                        <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
                          {item.description}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {submitError && (
          <Alert variant="destructive">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        {/* CTAs */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">
            {t('meetings.publicRsvp.ctaHeading')}
          </h2>
          <Button
            size="lg"
            disabled={!!submitting}
            onClick={() => submitRsvp('ATTENDING')}
            className="w-full h-14 text-base bg-green-600 hover:bg-green-700 text-white"
          >
            {submitting === 'ATTENDING' ? (
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
            ) : (
              <CheckCircle2 className="h-5 w-5 mr-2" />
            )}
            {t('meetings.publicRsvp.ctaAttending')}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            disabled={!!submitting}
            onClick={() => submitRsvp('ABSENT')}
            className="w-full h-14 text-base"
          >
            {submitting === 'ABSENT' ? (
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
            ) : (
              <XCircle className="h-5 w-5 mr-2" />
            )}
            {t('meetings.publicRsvp.ctaAbsent')}
          </Button>
          <Button
            size="lg"
            disabled={!!submitting}
            onClick={openProxySection}
            className="w-full h-14 text-base bg-amber-500 hover:bg-amber-600 text-white"
          >
            <UserCheck className="h-5 w-5 mr-2" />
            {t('meetings.publicRsvp.ctaProxy')}
          </Button>
        </div>

        {/* Proxy section */}
        {showProxy && (
          <div ref={proxySectionRef}>
            <Card>
              <CardContent className="pt-6 space-y-4">
                <h2 className="text-lg font-semibold">
                  {t('meetings.publicRsvp.proxyHeading')}
                </h2>

                {!resolved ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {t('meetings.publicRsvp.proxyHelp')}
                    </p>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium mb-1">
                          {t('meetings.publicRsvp.proxyFirstNameLabel')}
                        </label>
                        <Input
                          autoComplete="off"
                          autoCapitalize="words"
                          value={proxyFirstName}
                          onChange={(e) => {
                            setProxyFirstName(e.target.value);
                            if (proxyError) setProxyError(null);
                          }}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">
                          {t('meetings.publicRsvp.proxyLastNameLabel')}
                        </label>
                        <Input
                          autoComplete="off"
                          autoCapitalize="words"
                          value={proxyLastName}
                          onChange={(e) => {
                            setProxyLastName(e.target.value);
                            if (proxyError) setProxyError(null);
                          }}
                        />
                      </div>
                    </div>

                    {proxyError && (
                      <Alert variant="destructive">
                        <AlertDescription>
                          {t(
                            `meetings.publicRsvp.proxyError${
                              proxyError === 'not_found'
                                ? 'NotFound'
                                : proxyError === 'ambiguous'
                                  ? 'Ambiguous'
                                  : proxyError === 'cap_reached'
                                    ? 'CapReached'
                                    : proxyError === 'rate_limited'
                                      ? 'RateLimit'
                                      : 'Generic'
                            }` as 'meetings.publicRsvp.proxyErrorNotFound',
                          )}
                        </AlertDescription>
                      </Alert>
                    )}

                    <Button
                      size="lg"
                      disabled={
                        resolving || !proxyFirstName.trim() || !proxyLastName.trim()
                      }
                      onClick={findDelegate}
                      className="w-full h-12"
                    >
                      {resolving && (
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      )}
                      {t('meetings.publicRsvp.proxyFindButton')}
                    </Button>
                  </>
                ) : (
                  <>
                    <h3 className="text-base font-semibold">
                      {t('meetings.publicRsvp.proxyConfirmHeading')}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {t('meetings.publicRsvp.proxyConfirmPrompt', {
                        name: resolved.displayName,
                      })}
                    </p>
                    <div className="rounded-md border bg-muted/30 px-4 py-3 text-center font-medium">
                      {resolved.displayName}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        className="flex-1 h-12"
                        onClick={resetProxy}
                        disabled={!!submitting}
                      >
                        {t('meetings.publicRsvp.proxyConfirmCancel')}
                      </Button>
                      <Button
                        className="flex-1 h-12"
                        onClick={() =>
                          submitRsvp('PROXY', resolved.delegateShareholderId)
                        }
                        disabled={!!submitting}
                      >
                        {submitting === 'PROXY' && (
                          <Loader2 className="h-5 w-5 animate-spin mr-2" />
                        )}
                        {t('meetings.publicRsvp.confirmProxy')}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <p className="text-xs text-center text-muted-foreground py-4">
          {t('meetings.publicRsvp.poweredBy')}
        </p>
      </main>
    </div>
  );
}
