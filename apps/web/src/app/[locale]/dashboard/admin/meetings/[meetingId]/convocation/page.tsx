'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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

type MeetingWithCoop = MeetingDto & {
  coop?: { minConvocationDays: number } | null;
  customSubject?: string | null;
  customBody?: string | null;
};

interface EmailPreview {
  subject: string;
  html: string;
  recipientEmail: string | null;
  shareholderName: string;
  isPostalOnly: boolean;
}

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

/**
 * Starter HTML the admin sees in the WYSIWYG editor when no customBody has been
 * saved yet. Mirrors the shape of the server-side default template so the editor
 * is a "live, editable preview" rather than a blank box. Variables stay as
 * {{...}} text — they get substituted at send time, per shareholder.
 */
function buildStarterEmailBody(uiLocale: string, coopName: string): string {
  const lang = uiLocale.slice(0, 2);
  const t: Record<
    string,
    {
      dear: string;
      intro: string;
      agenda: string;
      proxy: string;
      attachment: string;
      cta: string;
      closing: string;
      signoff: string;
    }
  > = {
    nl: {
      dear: 'Beste {{shareholderName}},',
      intro: `Namens <strong>${coopName}</strong> nodigen wij u uit voor <strong>{{meetingTitle}}</strong> op <strong>{{meetingDate}}</strong> te <strong>{{meetingLocation}}</strong>.`,
      agenda: 'Agenda',
      cta: 'Reageer op de oproeping: {{rsvpUrl}}',
      proxy: 'Klik op de link hierboven om aan te geven of u aanwezig zult zijn, niet aanwezig zult zijn, of om uw stem te delegeren aan een andere aandeelhouder (volmacht).',
      attachment: 'In bijlage vindt u de officiële oproeping als PDF.',
      closing: 'Met vriendelijke groet,',
      signoff: `Het bestuur van ${coopName}`,
    },
    en: {
      dear: 'Dear {{shareholderName}},',
      intro: `On behalf of <strong>${coopName}</strong>, you are invited to <strong>{{meetingTitle}}</strong> on <strong>{{meetingDate}}</strong> at <strong>{{meetingLocation}}</strong>.`,
      agenda: 'Agenda',
      cta: 'Respond to the notice: {{rsvpUrl}}',
      proxy: 'Click the link above to indicate whether you will attend, will not attend, or to delegate your vote to another shareholder (proxy).',
      attachment: 'The official notice is attached as a PDF.',
      closing: 'Kind regards,',
      signoff: `The board of ${coopName}`,
    },
    fr: {
      dear: 'Cher/Chère {{shareholderName}},',
      intro: `Au nom de <strong>${coopName}</strong>, vous êtes invité(e) à <strong>{{meetingTitle}}</strong> le <strong>{{meetingDate}}</strong> à <strong>{{meetingLocation}}</strong>.`,
      agenda: 'Ordre du jour',
      cta: 'Répondre à la convocation : {{rsvpUrl}}',
      proxy: "Cliquez sur le lien ci-dessus pour indiquer si vous serez présent(e), absent(e), ou pour déléguer votre voix à un autre actionnaire (procuration).",
      attachment: "La convocation officielle est jointe en PDF.",
      closing: 'Cordialement,',
      signoff: `Le conseil d'administration de ${coopName}`,
    },
    de: {
      dear: 'Liebe/r {{shareholderName}},',
      intro: `Im Namen von <strong>${coopName}</strong> laden wir Sie zur <strong>{{meetingTitle}}</strong> am <strong>{{meetingDate}}</strong> in <strong>{{meetingLocation}}</strong> ein.`,
      agenda: 'Tagesordnung',
      cta: 'Auf die Einladung antworten: {{rsvpUrl}}',
      proxy: 'Klicken Sie oben auf den Link, um anzugeben, ob Sie teilnehmen werden, nicht teilnehmen werden, oder Ihre Stimme an einen anderen Anteilseigner zu delegieren (Vollmacht).',
      attachment: 'Die offizielle Einladung ist als PDF beigefügt.',
      closing: 'Mit freundlichen Grüßen,',
      signoff: `Der Vorstand von ${coopName}`,
    },
  };
  const s = t[lang] ?? t.nl;
  return `<p>${s.dear}</p>
<p>${s.intro}</p>
<h2>${s.agenda}</h2>
{{agendaList}}
<p>${s.cta}</p>
<p>${s.proxy}</p>
<p style="color: #666; font-size: 12px;">${s.attachment}</p>
<p>${s.closing}<br><strong>${s.signoff}</strong></p>`;
}

const REMINDER_DAY_OPTIONS = [14, 7, 3, 1];

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function ConvocationPage() {
  const t = useTranslations();
  const params = useParams();
  const meetingId = (params?.meetingId as string) || '';
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();

  const [meeting, setMeeting] = useState<MeetingWithCoop | null>(null);
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
  const [openingPreview, setOpeningPreview] = useState(false);

  const [customSubject, setCustomSubject] = useState('');
  const [customBody, setCustomBody] = useState('');
  const [savingCustom, setSavingCustom] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const [emailPreview, setEmailPreview] = useState<EmailPreview | null>(null);
  const [loadingEmailPreview, setLoadingEmailPreview] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

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
      const meetingWithCoop = m as MeetingWithCoop;
      setMeeting(meetingWithCoop);
      setStatus(s);
      setReminderDays(m.reminderDaysBefore ?? []);
      setCustomSubject(meetingWithCoop.customSubject ?? '');
      // If no customBody has been saved yet, pre-fill the editor with a
      // localized starter so the admin sees what an email looks like and can
      // edit inline. Saving as-is captures the starter into customBody, which
      // is fine — the starter mirrors the server-default template. Admin can
      // click "Reset" to revert to empty (= "use server template").
      const savedBody = meetingWithCoop.customBody ?? '';
      const coopNameForStarter = selectedCoop?.name ?? 'Onze coöperatie';
      const bodyToShow = savedBody || buildStarterEmailBody(locale, coopNameForStarter);
      setCustomBody(bodyToShow);
      // The contentEditable DOM is synced separately by an effect that depends
      // on `customBody` — at this point the div may not yet be mounted (it's
      // gated on `meeting` being non-null, which we're setting in this same
      // commit), so writing to editorRef.current here would silently no-op.
      setFirstShareholder(sh.items?.[0] ?? null);
      setError(null);
    } catch {
      setError(t('meetings.detail.loadError'));
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, meetingId, locale, t]);

  const resetEmailToDefault = () => {
    if (alreadyConvoked || !selectedCoop) return;
    const fresh = buildStarterEmailBody(locale, selectedCoop.name ?? 'Onze coöperatie');
    setCustomBody(fresh);
    if (editorRef.current) {
      const parsed = new DOMParser().parseFromString(fresh, 'text/html');
      editorRef.current.replaceChildren(...Array.from(parsed.body.childNodes));
    }
  };

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Sync the contentEditable DOM whenever `customBody` changes AND the editor
  // is mounted. Critical because fetchAll sets customBody in the same commit
  // that first mounts the editor (gated on `meeting`); writing to the ref
  // synchronously inside fetchAll silently no-ops since the div hasn't
  // rendered yet. This effect fires after the render, when the ref is live.
  // Skipped while the editor is focused so a stray refetch doesn't blow away
  // mid-edit work.
  useEffect(() => {
    if (!editorRef.current) return;
    if (document.activeElement === editorRef.current) return;
    if (editorRef.current.innerHTML === customBody) return;
    const parsed = new DOMParser().parseFromString(customBody, 'text/html');
    editorRef.current.replaceChildren(...Array.from(parsed.body.childNodes));
  }, [customBody]);

  const daysUntil = meeting
    ? Math.floor(
        (new Date(meeting.scheduledAt).getTime() - Date.now()) / (86400 * 1000),
      )
    : 0;
  const minNoticeDays = meeting?.coop?.minConvocationDays ?? 15;
  const isShortNotice = !!meeting && daysUntil < minNoticeDays;
  const alreadyConvoked = meeting?.status !== 'DRAFT';

  const toggleReminderDay = (day: number) => {
    setReminderDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => b - a),
    );
  };

  // Load the rendered email-preview whenever the meeting + a shareholder are
  // available. Re-runs after saving custom subject/body so the preview reflects
  // the latest persisted values without an extra round-trip.
  const loadEmailPreview = useCallback(async () => {
    if (!selectedCoop || !meeting || !firstShareholder) {
      setEmailPreview(null);
      return;
    }
    setLoadingEmailPreview(true);
    try {
      const preview = await api<EmailPreview>(
        `/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/convocation/email-preview?shareholderId=${firstShareholder.id}`,
      );
      setEmailPreview(preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
      setEmailPreview(null);
    } finally {
      setLoadingEmailPreview(false);
    }
  }, [selectedCoop, meeting, firstShareholder, t]);

  useEffect(() => {
    loadEmailPreview();
  }, [loadEmailPreview]);

  const saveCustomEmail = async () => {
    if (!selectedCoop || !meeting) return;
    setSavingCustom(true);
    try {
      await api(`/admin/coops/${selectedCoop.id}/meetings/${meeting.id}`, {
        method: 'PATCH',
        body: {
          customSubject: customSubject.trim() ? customSubject : null,
          customBody: customBody.trim() ? customBody : null,
        },
      });
      setSuccess(t('common.success'));
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSavingCustom(false);
    }
  };

  const sendTest = async () => {
    if (!selectedCoop || !meeting) return;
    setSendingTest(true);
    try {
      await api(
        `/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/convocation/send-test`,
        { method: 'POST', body: {} },
      );
      setSuccess(t('meetings.convocation.sendTestSuccess'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('meetings.convocation.sendTestFailure'));
    } finally {
      setSendingTest(false);
    }
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

  const canPreview = !!meeting && !!firstShareholder && !!selectedCoop;

  const openPreview = async () => {
    if (!canPreview || !meeting || !firstShareholder || !selectedCoop) return;
    setOpeningPreview(true);
    setError(null);
    try {
      // The PDF endpoint requires JWT (JwtAuthGuard). A bare <a href> opens a new
      // tab without the Authorization header, so we fetch the PDF with auth here
      // and open it as a blob URL. The api() helper assumes JSON, so we hit fetch
      // directly and attach the bearer token ourselves.
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const url = `${API_URL}/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/convocation/preview?shareholderId=${firstShareholder.id}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error(`Preview failed (${res.status})`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      // Revoke after a delay so the new tab has time to load it.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setOpeningPreview(false);
    }
  };

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
          <AlertDescription>{t('meetings.convocation.shortNoticeWarning', { days: minNoticeDays })}</AlertDescription>
        </Alert>
      )}

      {/* Editable email content */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {t('meetings.convocation.bodyLabel')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">
              {t('meetings.convocation.subjectLabel')}
            </label>
            <input
              type="text"
              value={customSubject}
              onChange={(e) => setCustomSubject(e.target.value)}
              placeholder={`Oproeping - ${meeting.title}`}
              className="w-full rounded border px-3 py-2 text-sm bg-background"
              disabled={alreadyConvoked}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">
              {t('meetings.convocation.bodyLabel')}
            </label>
            <div
              ref={editorRef}
              contentEditable={!alreadyConvoked}
              suppressContentEditableWarning
              onBlur={(e) => setCustomBody(e.currentTarget.innerHTML)}
              className="prose prose-sm dark:prose-invert max-w-none w-full rounded border px-4 py-3 text-sm bg-background min-h-[200px] focus:outline-none focus:ring-2 focus:ring-ring"
              data-placeholder={t('meetings.convocation.editorPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">
              {t('meetings.convocation.bodyHelp')}{' '}
              <code>{'{{rsvpUrl}}'}</code>, <code>{'{{shareholderName}}'}</code>,{' '}
              <code>{'{{meetingTitle}}'}</code>, <code>{'{{meetingDate}}'}</code>,{' '}
              <code>{'{{meetingLocation}}'}</code>, <code>{'{{agendaList}}'}</code>,{' '}
              <code>{'{{coopName}}'}</code>.
            </p>
          </div>
          {!alreadyConvoked && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveCustomEmail} disabled={savingCustom} variant="outline">
                {savingCustom ? t('common.loading') : t('common.save')}
              </Button>
              <Button onClick={resetEmailToDefault} variant="ghost">
                {t('meetings.convocation.resetToDefault')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live preview: email body + PDF + send-test */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            {t('meetings.convocation.preview')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!canPreview ? (
            <p className="text-sm text-muted-foreground">
              {t('meetings.convocation.noShareholderForPreview')}
            </p>
          ) : (
            <>
              {emailPreview ? (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      {t('meetings.convocation.previewSubject')}
                    </div>
                    <div className="font-medium">{emailPreview.subject}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      To
                    </div>
                    <div className="font-medium text-sm">
                      {emailPreview.recipientEmail ?? `(postal — ${emailPreview.shareholderName})`}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                      {t('meetings.convocation.previewBody')}
                    </div>
                    <iframe
                      title="email-preview"
                      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,-apple-system,sans-serif;padding:16px;color:#111}</style></head><body>${emailPreview.html}</body></html>`}
                      className="w-full h-96 rounded border bg-white"
                      sandbox=""
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('meetings.convocation.previewHelp')}
                  </p>
                </div>
              ) : loadingEmailPreview ? (
                <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <Button variant="outline" onClick={openPreview} disabled={openingPreview}>
                  <Eye className="h-4 w-4 mr-2" />
                  {openingPreview ? t('common.loading') : `PDF ${t('meetings.convocation.preview').toLowerCase()}`}
                </Button>
                <Button variant="outline" onClick={sendTest} disabled={sendingTest}>
                  <Send className="h-4 w-4 mr-2" />
                  {sendingTest ? t('common.loading') : t('meetings.convocation.sendTest')}
                </Button>
              </div>
            </>
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
              <span>{t('meetings.convocation.shortNoticeConfirm', { days: minNoticeDays })}</span>
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

