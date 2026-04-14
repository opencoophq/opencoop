'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  ListChecks,
  Mail,
  Users,
  ClipboardCheck,
  Vote,
  FileSignature,
  UserCheck,
  XCircle,
  Trash2,
} from 'lucide-react';
import type {
  MeetingDto,
  MeetingStatus,
  AgendaItemDto,
  MeetingAttendanceDto,
} from '@opencoop/shared';

interface MeetingDetail extends MeetingDto {
  agendaItems?: AgendaItemDto[];
  attendances?: MeetingAttendanceDto[];
}

export default function MeetingDetailPage() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams();
  const meetingId = (params?.meetingId as string) || '';
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();

  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchMeeting = useCallback(async () => {
    if (!selectedCoop || !meetingId) return;
    setLoading(true);
    try {
      const data = await api<MeetingDetail>(
        `/admin/coops/${selectedCoop.id}/meetings/${meetingId}`,
      );
      setMeeting(data);
      setError(null);
    } catch {
      setError(t('meetings.detail.loadError'));
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, meetingId, t]);

  useEffect(() => {
    fetchMeeting();
  }, [fetchMeeting]);

  const handleCancel = async () => {
    if (!selectedCoop || !meeting) return;
    setCancelling(true);
    try {
      await api(`/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/cancel`, {
        method: 'POST',
        body: { reason: cancelReason },
      });
      setCancelOpen(false);
      setCancelReason('');
      fetchMeeting();
    } catch {
      setError(t('meetings.detail.cancelError'));
    } finally {
      setCancelling(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedCoop || !meeting) return;
    setDeleting(true);
    try {
      await api(`/admin/coops/${selectedCoop.id}/meetings/${meeting.id}`, {
        method: 'DELETE',
      });
      router.push('/dashboard/admin/meetings');
    } catch {
      setError(t('meetings.detail.deleteError'));
      setDeleting(false);
    }
  };

  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      dateStyle: 'long',
      timeStyle: 'short',
    });

  const statusBadgeVariant = (
    status: MeetingStatus,
  ): 'default' | 'secondary' | 'outline' | 'destructive' => {
    switch (status) {
      case 'HELD':
      case 'CLOSED':
        return 'default';
      case 'CONVOKED':
        return 'secondary';
      case 'CANCELLED':
        return 'destructive';
      case 'DRAFT':
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse h-8 w-64 bg-muted rounded" />
        <div className="animate-pulse h-32 bg-muted rounded-lg" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="animate-pulse h-32 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/admin/meetings">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('meetings.detail.backToList')}
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error || t('meetings.detail.notFound')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const agendaCount = meeting.agendaItems?.length ?? 0;
  const agendaDone = agendaCount > 0;
  const convocationDone = !!meeting.convocationSentAt;
  const rsvpsAvailable = convocationDone;
  const meetingHeld =
    meeting.status === 'HELD' ||
    meeting.status === 'CLOSED' ||
    new Date(meeting.scheduledAt).getTime() <= Date.now();
  const votesDone = meeting.status === 'CLOSED';
  const minutesSigned = meeting.status === 'CLOSED';
  const isDraft = meeting.status === 'DRAFT';
  const isCancelled = meeting.status === 'CANCELLED';

  type ChecklistCard = {
    key: string;
    icon: React.ReactNode;
    title: string;
    status: string;
    done: boolean;
    cta: string;
    href: string;
    disabled?: boolean;
  };

  const cards: ChecklistCard[] = [
    {
      key: 'agenda',
      icon: <ListChecks className="h-5 w-5" />,
      title: t('meetings.detail.agenda'),
      status: agendaDone
        ? t('meetings.detail.agendaDefined', { count: agendaCount })
        : t('meetings.detail.agendaEmpty'),
      done: agendaDone,
      cta: t('meetings.detail.goToAgenda'),
      href: `/dashboard/admin/meetings/${meeting.id}/agenda`,
    },
    {
      key: 'convocation',
      icon: <Mail className="h-5 w-5" />,
      title: t('meetings.detail.convocation'),
      status: convocationDone
        ? t('meetings.detail.convocationSent', {
            date: formatDateTime(meeting.convocationSentAt as string),
          })
        : t('meetings.detail.convocationPending'),
      done: convocationDone,
      cta: t('meetings.detail.goToConvocation'),
      href: `/dashboard/admin/meetings/${meeting.id}/convocation`,
    },
    {
      key: 'rsvps',
      icon: <Users className="h-5 w-5" />,
      title: t('meetings.detail.rsvps'),
      status: rsvpsAvailable
        ? `${meeting.attendances?.length ?? 0}`
        : t('meetings.detail.rsvpsPending'),
      done: rsvpsAvailable && (meeting.attendances?.length ?? 0) > 0,
      cta: t('meetings.detail.goToRsvp'),
      href: `/dashboard/admin/meetings/${meeting.id}/rsvp`,
      disabled: !rsvpsAvailable,
    },
    {
      key: 'check-in',
      icon: <ClipboardCheck className="h-5 w-5" />,
      title: t('meetings.detail.meetingHeld'),
      status: meetingHeld
        ? t('meetings.detail.meetingHeld')
        : t('meetings.detail.meetingUpcoming'),
      done: meetingHeld,
      cta: t('meetings.detail.goToCheckIn'),
      href: `/dashboard/admin/meetings/${meeting.id}/check-in`,
    },
    {
      key: 'voting',
      icon: <Vote className="h-5 w-5" />,
      title: t('meetings.detail.votes'),
      status: votesDone
        ? t('meetings.detail.votesRecorded')
        : t('meetings.detail.votesPending'),
      done: votesDone,
      cta: t('meetings.detail.goToVoting'),
      href: `/dashboard/admin/meetings/${meeting.id}/voting`,
    },
    {
      key: 'minutes',
      icon: <FileSignature className="h-5 w-5" />,
      title: t('meetings.detail.minutes'),
      status: minutesSigned
        ? t('meetings.detail.minutesSigned')
        : t('meetings.detail.minutesUnsigned'),
      done: minutesSigned,
      cta: t('meetings.detail.goToMinutes'),
      href: `/dashboard/admin/meetings/${meeting.id}/minutes`,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/admin/meetings">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('meetings.detail.backToList')}
          </Link>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1">
              <CardTitle className="text-2xl">{meeting.title}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {formatDateTime(meeting.scheduledAt)}
              </p>
            </div>
            <Badge variant={statusBadgeVariant(meeting.status)}>
              {t(`meetings.status.${meeting.status.toLowerCase()}` as 'meetings.status.draft')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">{t('meetings.detail.location')}</dt>
              <dd className="font-medium">{meeting.location || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('meetings.detail.format')}</dt>
              <dd className="font-medium">
                {t(`meetings.format.${meeting.format.toLowerCase()}` as 'meetings.format.physical')}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('meetings.detail.duration')}</dt>
              <dd className="font-medium">
                {t('meetings.detail.durationMinutes', { minutes: meeting.durationMinutes })}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold mb-3">{t('meetings.detail.checklist')}</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <Card key={card.key} className={card.disabled ? 'opacity-60' : ''}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 text-foreground">
                    {card.icon}
                    <span className="font-semibold">{card.title}</span>
                  </div>
                  {card.done ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-4 min-h-[2.5em]">
                  {card.status}
                </p>
                <Button
                  asChild={!card.disabled}
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={card.disabled}
                >
                  {card.disabled ? (
                    <span>{card.cta}</span>
                  ) : (
                    <Link href={card.href}>
                      <UserCheck className="h-4 w-4 mr-2" />
                      {card.cta}
                    </Link>
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {!isCancelled && (
        <div className="flex justify-end gap-2 pt-4 border-t">
          {isDraft && (
            <Button variant="outline" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4 mr-2" />
              {t('meetings.detail.deleteMeeting')}
            </Button>
          )}
          <Button variant="destructive" onClick={() => setCancelOpen(true)}>
            <XCircle className="h-4 w-4 mr-2" />
            {t('meetings.detail.cancelMeeting')}
          </Button>
        </div>
      )}

      {/* Cancel Dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('meetings.detail.cancelMeeting')}</DialogTitle>
            <DialogDescription>
              {t('meetings.detail.cancelMeetingConfirm')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{t('meetings.detail.cancelReasonLabel')}</Label>
            <Input
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={t('meetings.detail.cancelReasonPlaceholder')}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelOpen(false)}
              disabled={cancelling}
            >
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? t('common.loading') : t('meetings.detail.cancelMeeting')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('meetings.detail.deleteMeeting')}</DialogTitle>
            <DialogDescription>
              {t('meetings.detail.deleteMeetingConfirm')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? t('common.loading') : t('meetings.detail.deleteMeeting')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
