'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useAdmin } from '@/contexts/admin-context';
import { ArrowLeft } from 'lucide-react';
import type { MeetingDto } from '@opencoop/shared';
import {
  MeetingForm,
  type MeetingSubmitPayload,
} from '../../_components/meeting-form';

export default function EditMeetingPage() {
  const params = useParams();
  const meetingId = (params?.meetingId as string) || '';
  const t = useTranslations();
  const router = useRouter();
  const { selectedCoop } = useAdmin();
  const [meeting, setMeeting] = useState<MeetingDto | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMeeting = useCallback(async () => {
    if (!selectedCoop) return;
    try {
      const data = await api<MeetingDto>(
        `/admin/coops/${selectedCoop.id}/meetings/${meetingId}`,
      );
      setMeeting(data);
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, meetingId]);

  useEffect(() => {
    fetchMeeting();
  }, [fetchMeeting]);

  const submit = async (payload: MeetingSubmitPayload) => {
    if (!selectedCoop) return;
    await api<MeetingDto>(
      `/admin/coops/${selectedCoop.id}/meetings/${meetingId}`,
      { method: 'PATCH', body: payload },
    );
    router.push(`/dashboard/admin/meetings/${meetingId}`);
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
      <div className="p-6">
        <p className="text-muted-foreground">{t('common.loading')}</p>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t('meetings.edit.notFound')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/dashboard/admin/meetings/${meetingId}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('meetings.edit.back')}
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-bold">{t('meetings.edit.heading')}</h1>
      </div>
      <MeetingForm
        heading={t('meetings.edit.heading')}
        submitLabel={t('meetings.edit.save')}
        submittingLabel={t('meetings.edit.saving')}
        cancelHref={`/dashboard/admin/meetings/${meetingId}`}
        initialValues={{
          type: meeting.type,
          title: meeting.title,
          scheduledAt: meeting.scheduledAt,
          durationMinutes: meeting.durationMinutes,
          location: meeting.location,
          format: meeting.format,
          votingWeight: meeting.votingWeight,
          maxProxiesPerPerson: meeting.maxProxiesPerPerson,
          reminderDaysBefore: meeting.reminderDaysBefore,
        }}
        onSubmit={submit}
      />
    </div>
  );
}
