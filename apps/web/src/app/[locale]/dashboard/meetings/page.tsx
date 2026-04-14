'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { useLocale } from '@/contexts/locale-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, MapPin, Eye, Loader2 } from 'lucide-react';
import type { MeetingDto } from '@opencoop/shared';

interface ShareholderMeeting extends MeetingDto {
  coop: { id: string; name: string; logoUrl?: string | null };
}

export default function ShareholderMeetingsPage() {
  const t = useTranslations();
  const { locale } = useLocale();
  const [meetings, setMeetings] = useState<ShareholderMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<ShareholderMeeting[]>('/meetings/upcoming')
      .then((data) => setMeetings(data))
      .catch(() => setMeetings([]))
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      dateStyle: 'long',
      timeStyle: 'short',
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('meetings.shareholder.heading')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('meetings.shareholder.subheading')}
        </p>
      </div>

      {meetings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t('meetings.shareholder.empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {meetings.map((m) => (
            <Card key={m.id}>
              <CardContent className="pt-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-lg font-semibold">{m.title}</h2>
                    <Badge variant="outline">
                      {t(`meetings.type.${m.type.toLowerCase()}` as 'meetings.type.annual')}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{m.coop.name}</p>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      {formatDate(m.scheduledAt)}
                    </span>
                    {m.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {m.location}
                      </span>
                    )}
                  </div>
                </div>
                <Button asChild variant="outline">
                  <Link href={`/dashboard/meetings/${m.id}`}>
                    <Eye className="h-4 w-4 mr-2" />
                    {t('meetings.shareholder.view')}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
