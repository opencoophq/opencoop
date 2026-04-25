'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

interface DelegateOption {
  id: string;
  firstName: string | null;
  lastName: string | null;
  memberNumber?: number | null;
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
  const [delegates, setDelegates] = useState<DelegateOption[]>([]);
  const [delegatesLoading, setDelegatesLoading] = useState(false);
  const [delegateQuery, setDelegateQuery] = useState('');

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

  const openProxySection = async () => {
    if (!meeting?.myAttendance?.rsvpToken) return;
    setShowProxy(true);
    if (delegates.length > 0) return;
    setDelegatesLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/public/meetings/rsvp/${meeting.myAttendance.rsvpToken}/eligible-delegates`,
      );
      if (res.ok) {
        const data = (await res.json()) as DelegateOption[];
        setDelegates(data);
      }
    } catch {
      /* ignore */
    } finally {
      setDelegatesLoading(false);
    }
  };

  const filteredDelegates = useMemo(() => {
    const q = delegateQuery.trim().toLowerCase();
    if (!q) return delegates;
    return delegates.filter((d) => {
      const full = `${d.firstName ?? ''} ${d.lastName ?? ''}`.toLowerCase();
      return full.includes(q);
    });
  }, [delegates, delegateQuery]);

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
              <div className="border-t pt-4 space-y-2">
                <p className="text-sm font-medium">
                  {t('meetings.publicRsvp.proxyHeading')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('meetings.publicRsvp.proxyHelp')}
                </p>
                <input
                  type="text"
                  value={delegateQuery}
                  onChange={(e) => setDelegateQuery(e.target.value)}
                  placeholder={t('meetings.publicRsvp.proxySearchPlaceholder')}
                  className="w-full rounded border px-3 py-2 text-sm bg-background"
                />
                {delegatesLoading ? (
                  <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
                ) : filteredDelegates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('meetings.publicRsvp.proxyEmpty')}
                  </p>
                ) : (
                  <div className="max-h-64 overflow-y-auto border rounded">
                    {filteredDelegates.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => submitRsvp('PROXY', d.id)}
                        disabled={!!submitting}
                        className="w-full text-left px-3 py-2 hover:bg-muted disabled:opacity-50 border-b last:border-b-0 text-sm"
                      >
                        {d.firstName} {d.lastName}
                        {d.memberNumber ? (
                          <span className="text-xs text-muted-foreground ml-2">
                            #{d.memberNumber}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
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
