'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { resolveLogoUrl } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { CheckCircle2, XCircle, UserCheck, MapPin, Calendar, Loader2 } from 'lucide-react';

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

interface DelegateOption {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  memberNumber?: number | null;
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
  const [delegates, setDelegates] = useState<DelegateOption[]>([]);
  const [delegatesLoading, setDelegatesLoading] = useState(false);
  const [delegateQuery, setDelegateQuery] = useState('');
  const [selectedDelegate, setSelectedDelegate] = useState<string>('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [expandedAgenda, setExpandedAgenda] = useState<Set<string>>(new Set());

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

  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      dateStyle: 'full',
      timeStyle: 'short',
    });

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

  const openProxySection = async () => {
    setShowProxy(true);
    if (delegates.length > 0) return;
    setDelegatesLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/public/meetings/rsvp/${token}/eligible-delegates`,
      );
      if (res.ok) {
        const data = (await res.json()) as DelegateOption[];
        setDelegates(data);
      }
    } catch {
      // ignore
    } finally {
      setDelegatesLoading(false);
    }
  };

  const filteredDelegates = useMemo(() => {
    const q = delegateQuery.trim().toLowerCase();
    if (!q) return delegates;
    return delegates.filter((d) => {
      const name = `${d.firstName ?? ''} ${d.lastName ?? ''} ${d.companyName ?? ''}`
        .toLowerCase()
        .trim();
      return (
        name.includes(q) ||
        (d.memberNumber !== null && d.memberNumber !== undefined && String(d.memberNumber).includes(q))
      );
    });
  }, [delegates, delegateQuery]);

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
                <span>{formatDateTime(details.meeting.scheduledAt)}</span>
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
          <Card>
            <CardContent className="pt-6 space-y-4">
              <h2 className="text-lg font-semibold">
                {t('meetings.publicRsvp.proxyHeading')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('meetings.publicRsvp.proxyHelp')}
              </p>
              <Input
                type="search"
                placeholder={t('meetings.publicRsvp.proxySearchPlaceholder')}
                value={delegateQuery}
                onChange={(e) => setDelegateQuery(e.target.value)}
              />

              {delegatesLoading ? (
                <div className="py-4 text-center">
                  <Loader2 className="h-5 w-5 animate-spin inline" />
                </div>
              ) : filteredDelegates.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  {t('meetings.publicRsvp.proxyEmpty')}
                </p>
              ) : (
                <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
                  {filteredDelegates.map((d) => {
                    const name = (`${d.firstName ?? ''} ${d.lastName ?? ''}`.trim() ||
                      d.companyName ||
                      '—');
                    const isSelected = selectedDelegate === d.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setSelectedDelegate(d.id)}
                        className={`w-full text-left px-3 py-3 hover:bg-accent transition-colors ${
                          isSelected ? 'bg-primary/10' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{name}</p>
                            {d.memberNumber !== null && d.memberNumber !== undefined && (
                              <p className="text-xs text-muted-foreground">
                                #{d.memberNumber}
                              </p>
                            )}
                          </div>
                          {isSelected && (
                            <CheckCircle2 className="h-5 w-5 text-primary" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <Button
                size="lg"
                disabled={!selectedDelegate || !!submitting}
                onClick={() => submitRsvp('PROXY', selectedDelegate)}
                className="w-full h-12"
              >
                {submitting === 'PROXY' && (
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                )}
                {t('meetings.publicRsvp.confirmProxy')}
              </Button>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-center text-muted-foreground py-4">
          {t('meetings.publicRsvp.poweredBy')}
        </p>
      </main>
    </div>
  );
}
