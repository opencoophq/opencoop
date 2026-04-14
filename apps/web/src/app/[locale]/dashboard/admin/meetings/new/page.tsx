'use client';

import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useAdmin } from '@/contexts/admin-context';
import { ArrowLeft } from 'lucide-react';
import type { MeetingDto } from '@opencoop/shared';
import {
  MeetingForm,
  type MeetingSubmitPayload,
} from '../_components/meeting-form';

export default function NewMeetingPage() {
  const t = useTranslations();
  const router = useRouter();
  const { selectedCoop } = useAdmin();

  const submit = async (payload: MeetingSubmitPayload) => {
    if (!selectedCoop) return;
    const meeting = await api<MeetingDto>(
      `/admin/coops/${selectedCoop.id}/meetings`,
      { method: 'POST', body: payload },
    );
    router.push(`/dashboard/admin/meetings/${meeting.id}`);
  };

  if (!selectedCoop) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t('admin.selectCoop')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/admin/meetings">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('meetings.new.back')}
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-bold">{t('meetings.new.heading')}</h1>
      </div>
      <MeetingForm
        heading={t('meetings.new.heading')}
        submitLabel={t('meetings.new.create')}
        submittingLabel={t('meetings.new.creating')}
        cancelHref="/dashboard/admin/meetings"
        onSubmit={submit}
      />
    </div>
  );
}
