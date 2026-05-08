'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ArrowLeft,
  Calendar,
  CalendarPlus,
  Check,
  MapPin,
  Loader2,
  X,
  Users,
} from 'lucide-react';
import type { MeetingDto, AgendaItemDto } from '@opencoop/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type RsvpStatus = 'ATTENDING' | 'ABSENT' | 'PROXY' | 'UNKNOWN';

interface MyAttendance {
  id: string;
  rsvpStatus: RsvpStatus;
  rsvpAt: string | null;
  rsvpToken: string;
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

interface ShareholderMeetingDetail extends MeetingDto {
  coop: { id: string; name: string; logoUrl?: string | null };
  agendaItems: AgendaItemDto[];
  myAttendance: MyAttendance | null;
}

export default function ShareholderMeetingDetailPage() {
  const t = useTranslations();
  const params = useParams();
  const { locale } = useLocale();
  const id = (params?.id as string) || '';

  const [meeting, setMeeting] = useState<ShareholderMeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<RsvpStatus | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showProxy, setShowProxy] = useState(false);
  const [proxyFirstName, setProxyFirstName] = useState('');
  const [proxyLastName, setProxyLastName] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<ResolvedDelegate | null>(null);
  const [proxyError, setProxyError] = useState<ProxyResolveError | null>(null);
  const proxySectionRef = useRef<HTMLDivElement | null>(null);

  const fetchMeeting = useCallback(() => {
    if (!id) return;
    setLoading(true);
    api<ShareholderMeetingDetail>(`/meetings/${id}`)
      .then((data) => setMeeting(data))
      .catch(() => setError(t('meetings.detail.loadError')))
      .finally(() => setLoading(false));
  }, [id, t]);

  useEffect(() => {
    fetchMeeting();
  }, [fetchMeeting]);

  const submitRsvp = async (status: RsvpStatus, delegateShareholderId?: string) => {
    if (!meeting?.myAttendance?.rsvpToken) return;
    setSubmitting(status);
    setSubmitError(null);
    try {
      const res = await fetch(
        `${API_URL}/public/meetings/rsvp/${meeting.myAttendance.rsvpToken}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, delegateShareholderId }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSubmitError(body?.message || t('meetings.publicRsvp.submitError'));
        return;
      }
      setShowProxy(false);
      fetchMeeting();
    } catch {
      setSubmitError(t('meetings.publicRsvp.submitError'));
    } finally {
      setSubmitting(null);
    }
  };

  const openProxySection = () => {
    if (!meeting?.myAttendance?.rsvpToken) return;
    setShowProxy(true);
    requestAnimationFrame(() => {
      proxySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const resetProxy = () => {
    setResolved(null);
    setProxyError(null);
  };

  const findDelegate = async () => {
    if (!meeting?.myAttendance?.rsvpToken) return;
    if (!proxyFirstName.trim() || !proxyLastName.trim()) return;
    setResolving(true);
    setProxyError(null);
    try {
      const res = await fetch(
        `${API_URL}/public/meetings/rsvp/${meeting.myAttendance.rsvpToken}/proxy/resolve`,
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

  const downloadIcs = () => {
    if (!meeting?.myAttendance?.rsvpToken) return;
    window.location.href = `${API_URL}/public/meetings/rsvp/${meeting.myAttendance.rsvpToken}/ics`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/meetings">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('meetings.shareholder.backToList')}
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>
            {error || t('meetings.detail.notFound')}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      dateStyle: 'full',
      timeStyle: 'short',
    });

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/dashboard/meetings">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('meetings.shareholder.backToList')}
        </Link>
      </Button>

      <div className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">{meeting.title}</h1>
          <Badge variant="outline">
            {t(`meetings.type.${meeting.type.toLowerCase()}` as 'meetings.type.annual')}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{meeting.coop.name}</p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3 text-sm">
          <div className="flex items-start gap-2">
            <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground" />
            <span>{formatDate(meeting.scheduledAt)}</span>
          </div>
          {meeting.location && (
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <span>{meeting.location}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {meeting.myAttendance ? (
        <Card>
          <CardContent className="pt-6 space-y-4">
            {/* Current RSVP status */}
            {meeting.myAttendance.rsvpStatus !== 'UNKNOWN' && (
              <div className="flex items-start gap-2 p-3 rounded border bg-muted/40">
                <Check className="h-5 w-5 mt-0.5 text-green-600" />
                <div className="text-sm">
                  <div className="font-medium">
                    {t(
                      `meetings.publicRsvp.statusLabel.${meeting.myAttendance.rsvpStatus.toLowerCase()}` as 'meetings.publicRsvp.statusLabel.attending',
                    )}
                  </div>
                  {meeting.myAttendance.rsvpAt && (
                    <div className="text-xs text-muted-foreground">
                      {new Date(meeting.myAttendance.rsvpAt).toLocaleString(locale, {
                        dateStyle: 'long',
                        timeStyle: 'short',
                      })}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">
                    {t('meetings.shareholder.changeAnytimeNote')}
                  </div>
                </div>
              </div>
            )}

            {submitError && (
              <Alert variant="destructive">
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}

            {/* RSVP buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button
                variant={meeting.myAttendance.rsvpStatus === 'ATTENDING' ? 'default' : 'outline'}
                onClick={() => submitRsvp('ATTENDING')}
                disabled={!!submitting}
              >
                {submitting === 'ATTENDING' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                {t('meetings.publicRsvp.ctaAttending')}
              </Button>
              <Button
                variant={meeting.myAttendance.rsvpStatus === 'ABSENT' ? 'default' : 'outline'}
                onClick={() => submitRsvp('ABSENT')}
                disabled={!!submitting}
              >
                {submitting === 'ABSENT' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <X className="h-4 w-4 mr-2" />
                )}
                {t('meetings.publicRsvp.ctaAbsent')}
              </Button>
              <Button
                variant={meeting.myAttendance.rsvpStatus === 'PROXY' ? 'default' : 'outline'}
                onClick={openProxySection}
                disabled={!!submitting}
              >
                <Users className="h-4 w-4 mr-2" />
                {t('meetings.publicRsvp.ctaProxy')}
              </Button>
            </div>

            {/* Proxy delegate picker */}
            {showProxy && (
              <div ref={proxySectionRef} className="border-t pt-4 space-y-4">
                <p className="text-sm font-medium">
                  {t('meetings.publicRsvp.proxyHeading')}
                </p>

                {!resolved ? (
                  <>
                    <p className="text-xs text-muted-foreground">
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
                                      : 'NotFound'
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
              </div>
            )}

            {/* Add to calendar */}
            <div className="border-t pt-4">
              <Button variant="outline" onClick={downloadIcs} className="w-full sm:w-auto">
                <CalendarPlus className="h-4 w-4 mr-2" />
                {t('meetings.shareholder.addToCalendar')}
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                {t('meetings.shareholder.addToCalendarHelp')}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Alert>
          <AlertDescription>{t('meetings.shareholder.invitedNote')}</AlertDescription>
        </Alert>
      )}

      {meeting.agendaItems && meeting.agendaItems.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold mb-4">
              {t('meetings.shareholder.agendaHeading')}
            </h2>
            <ol className="space-y-3">
              {meeting.agendaItems.map((item) => (
                <li key={item.id} className="border-l-2 border-muted pl-4 py-1">
                  <p className="font-medium">
                    {item.order}. {item.title}
                  </p>
                  {item.description && (
                    <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                      {item.description}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
