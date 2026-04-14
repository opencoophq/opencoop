'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { ArrowLeft, Mail, Eye, AlertTriangle, Send, BellRing } from 'lucide-react';
import type { MeetingDto, RSVPStatus } from '@opencoop/shared';

interface ConvocationStatusItem {
  id: string;
  shareholderId: string;
  rsvpStatus: RSVPStatus;
  rsvpAt?: string | null;
  shareholder: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  };
}

interface ShareholderListItem {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

const REMINDER_DAY_OPTIONS = [14, 7, 3, 1];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function ConvocationPage() {
  const t = useTranslations();
  const params = useParams();
  const meetingId = (params?.meetingId as string) || '';
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();

  const [meeting, setMeeting] = useState<MeetingDto | null>(null);
  const [status, setStatus] = useState<ConvocationStatusItem[]>([]);
  const [firstShareholder, setFirstShareholder] = useState<ShareholderListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [reminderDays, setReminderDays] = useState<number[]>([]);
  const [savingReminders, setSavingReminders] = useState(false);

  const [sendOpen, setSendOpen] = useState(false);
  const [shortNoticeConfirmed, setShortNoticeConfirmed] = useState(false);
  const [sending, setSending] = useState(false);

  const [sendingReminderNow, setSendingReminderNow] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!selectedCoop || !meetingId) return;
    setLoading(true);
    try {
      const [m, s, sh] = await Promise.all([
        api<MeetingDto>(`/admin/coops/${selectedCoop.id}/meetings/${meetingId}`),
        api<ConvocationStatusItem[]>(
          `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/convocation/status`,
        ).catch(() => [] as ConvocationStatusItem[]),
        api<{ items: ShareholderListItem[] }>(
          `/admin/coops/${selectedCoop.id}/shareholders?pageSize=1&page=1`,
        ).catch(() => ({ items: [] as ShareholderListItem[] })),
      ]);
      setMeeting(m);
      setStatus(s);
      setReminderDays(m.reminderDaysBefore ?? []);
      setFirstShareholder(sh.items?.[0] ?? null);
      setError(null);
    } catch {
      setError(t('meetings.detail.loadError'));
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, meetingId, t]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const daysUntil = meeting
    ? Math.floor(
        (new Date(meeting.scheduledAt).getTime() - Date.now()) / (86400 * 1000),
      )
    : 0;
  const isShortNotice = !!meeting && daysUntil < 15;
  const alreadyConvoked = meeting?.status !== 'DRAFT';

  const toggleReminderDay = (day: number) => {
    setReminderDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => b - a),
    );
  };

  const saveReminders = async () => {
    if (!selectedCoop || !meeting) return;
    setSavingReminders(true);
    try {
      await api(`/admin/coops/${selectedCoop.id}/meetings/${meeting.id}`, {
        method: 'PATCH',
        body: { reminderDaysBefore: reminderDays },
      });
      setSuccess(t('common.success'));
      fetchAll();
    } catch {
      setError(t('common.error'));
    } finally {
      setSavingReminders(false);
    }
  };

  const handleSend = async () => {
    if (!selectedCoop || !meeting) return;
    if (isShortNotice && !shortNoticeConfirmed) return;
    setSending(true);
    try {
      await api(
        `/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/convocation/send`,
        {
          method: 'POST',
          body: { confirmShortNotice: isShortNotice ? true : undefined },
        },
      );
      setSuccess(t('meetings.convocation.sendSuccess'));
      setSendOpen(false);
      setShortNoticeConfirmed(false);
      fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('meetings.convocation.sendFailure'));
    } finally {
      setSending(false);
    }
  };

  const handleSendReminderNow = async () => {
    if (!selectedCoop || !meeting) return;
    if (!confirm(t('meetings.convocation.sendReminderConfirm'))) return;
    setSendingReminderNow(true);
    try {
      const res = await api<{ sent: number }>(
        `/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/convocation/reminder`,
        { method: 'POST' },
      );
      setSuccess(t('meetings.convocation.reminderSentCount', { count: res.sent }));
    } catch {
      setError(t('common.error'));
    } finally {
      setSendingReminderNow(false);
    }
  };

  const previewUrl =
    meeting && firstShareholder
      ? `${API_URL}/admin/coops/${selectedCoop?.id}/meetings/${meeting.id}/convocation/preview?shareholderId=${firstShareholder.id}`
      : null;

  const formatDateTime = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' })
      : '—';

  const formatDate = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '—';

  const shName = (sh: ConvocationStatusItem['shareholder']) =>
    `${sh.firstName ?? ''} ${sh.lastName ?? ''}`.trim() || '—';

  const rsvpVariant = (
    s: RSVPStatus,
  ): 'default' | 'secondary' | 'outline' | 'destructive' => {
    switch (s) {
      case 'ATTENDING':
        return 'default';
      case 'PROXY':
        return 'secondary';
      case 'ABSENT':
        return 'destructive';
      case 'UNKNOWN':
      default:
        return 'outline';
    }
  };

  if (!selectedCoop) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t('admin.selectCoop')}</p>
      </div>
    );
  }

  if (loading || !meeting) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse h-8 w-64 bg-muted rounded" />
        <div className="animate-pulse h-40 bg-muted rounded-lg" />
        <div className="animate-pulse h-40 bg-muted rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/dashboard/admin/meetings/${meeting.id}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('meetings.detail.backToList')}
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">{t('meetings.convocation.heading')}</h1>
        <p className="text-sm text-muted-foreground">{meeting.title}</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle>{t('meetings.detail.overview')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">{t('meetings.detail.scheduled')}</dt>
              <dd className="font-medium">{formatDateTime(meeting.scheduledAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('meetings.detail.status')}</dt>
              <dd>
                <Badge>
                  {t(
                    `meetings.status.${meeting.status.toLowerCase()}` as 'meetings.status.draft',
                  )}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {t('meetings.convocation.daysUntil')}
              </dt>
              <dd className={`font-medium ${isShortNotice ? 'text-amber-600' : ''}`}>
                {daysUntil}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {isShortNotice && !alreadyConvoked && (
        <Alert className="border-amber-600 text-amber-900 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{t('meetings.convocation.shortNoticeWarning')}</AlertDescription>
        </Alert>
      )}

      {/* Preview + Send */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {t('meetings.convocation.preview')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {previewUrl ? (
            <Button asChild variant="outline">
              <a href={previewUrl} target="_blank" rel="noreferrer">
                <Eye className="h-4 w-4 mr-2" />
                {t('meetings.convocation.preview')}
              </a>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('meetings.convocation.noShareholders')}
            </p>
          )}
          <div className="pt-3 border-t">
            {alreadyConvoked ? (
              <Badge className="bg-green-600 hover:bg-green-600">
                {t('meetings.convocation.alreadyConvoked')}{' '}
                {meeting.convocationSentAt &&
                  `— ${formatDateTime(meeting.convocationSentAt)}`}
              </Badge>
            ) : (
              <Button onClick={() => setSendOpen(true)}>
                <Send className="h-4 w-4 mr-2" />
                {t('meetings.convocation.send')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Reminders */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5" />
            {t('meetings.convocation.reminderConfig')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            {REMINDER_DAY_OPTIONS.map((day) => (
              <label key={day} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={reminderDays.includes(day)}
                  onCheckedChange={() => toggleReminderDay(day)}
                />
                <span className="text-sm">
                  {t('meetings.convocation.daysBefore', { days: day })}
                </span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={saveReminders} disabled={savingReminders}>
              {savingReminders ? t('common.loading') : t('meetings.convocation.reminderSave')}
            </Button>
            {alreadyConvoked && (
              <Button
                variant="outline"
                onClick={handleSendReminderNow}
                disabled={sendingReminderNow}
              >
                <BellRing className="h-4 w-4 mr-2" />
                {sendingReminderNow
                  ? t('common.loading')
                  : t('meetings.convocation.sendReminderNow')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Delivery status */}
      <Card>
        <CardHeader>
          <CardTitle>{t('meetings.convocation.deliveryStatus')}</CardTitle>
        </CardHeader>
        <CardContent>
          {status.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {t('meetings.convocation.noDeliveries')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('meetings.rsvp.columns.shareholder')}</TableHead>
                  <TableHead>{t('meetings.rsvp.columns.email')}</TableHead>
                  <TableHead>{t('meetings.rsvp.columns.rsvpStatus')}</TableHead>
                  <TableHead>{t('meetings.rsvp.columns.rsvpAt')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{shName(row.shareholder)}</TableCell>
                    <TableCell>{row.shareholder.email ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={rsvpVariant(row.rsvpStatus)}>
                        {t(
                          `meetings.rsvp.status.${row.rsvpStatus.toLowerCase()}` as 'meetings.rsvp.status.attending',
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(row.rsvpAt ?? null)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Send confirm dialog */}
      <Dialog
        open={sendOpen}
        onOpenChange={(v) => {
          setSendOpen(v);
          if (!v) setShortNoticeConfirmed(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('meetings.convocation.send')}</DialogTitle>
            <DialogDescription>
              {t('meetings.convocation.sendConfirm')}
            </DialogDescription>
          </DialogHeader>
          {isShortNotice && (
            <label className="flex items-start gap-2 p-3 border border-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded text-sm">
              <Checkbox
                checked={shortNoticeConfirmed}
                onCheckedChange={(v) => setShortNoticeConfirmed(!!v)}
              />
              <span>{t('meetings.convocation.shortNoticeConfirm')}</span>
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sending}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSend}
              disabled={sending || (isShortNotice && !shortNoticeConfirmed)}
            >
              <Send className="h-4 w-4 mr-2" />
              {sending ? t('common.loading') : t('meetings.convocation.send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

