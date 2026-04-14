'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, Calendar, MapPin, Loader2 } from 'lucide-react';
import type { MeetingDto, AgendaItemDto } from '@opencoop/shared';

interface ShareholderMeetingDetail extends MeetingDto {
  coop: { id: string; name: string; logoUrl?: string | null };
  agendaItems: AgendaItemDto[];
}

export default function ShareholderMeetingDetailPage() {
  const t = useTranslations();
  const params = useParams();
  const { locale } = useLocale();
  const id = (params?.id as string) || '';

  const [meeting, setMeeting] = useState<ShareholderMeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<ShareholderMeetingDetail>(`/meetings/${id}`)
      .then((data) => setMeeting(data))
      .catch(() => setError(t('meetings.detail.loadError')))
      .finally(() => setLoading(false));
  }, [id, t]);

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

      <Alert>
        <AlertDescription>{t('meetings.shareholder.invitedNote')}</AlertDescription>
      </Alert>

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
