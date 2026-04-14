'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import { Plus, Eye } from 'lucide-react';
import type { MeetingDto, MeetingStatus, MeetingType } from '@opencoop/shared';

interface MeetingListItem extends MeetingDto {
  agendaItems?: { id: string }[];
  _count?: { attendances: number; proxies: number };
}

export default function MeetingsListPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMeetings = useCallback(async () => {
    if (!selectedCoop) return;
    setLoading(true);
    try {
      const data = await api<MeetingListItem[] | { data: MeetingListItem[] }>(
        `/admin/coops/${selectedCoop.id}/meetings`,
      );
      setMeetings(Array.isArray(data) ? data : data.data || []);
      setError(null);
    } catch {
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, t]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

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

  const statusLabel = (status: MeetingStatus) =>
    t(`meetings.status.${status.toLowerCase()}` as 'meetings.status.draft');

  const typeLabel = (type: MeetingType) =>
    t(`meetings.type.${type.toLowerCase()}` as 'meetings.type.annual');

  if (!selectedCoop) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t('admin.selectCoop')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('meetings.title')}</h1>
        <Button asChild>
          <Link href="/dashboard/admin/meetings/new">
            <Plus className="h-4 w-4 mr-2" />
            {t('meetings.newMeeting')}
          </Link>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="animate-pulse space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 bg-muted rounded" />
              ))}
            </div>
          ) : meetings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {t('meetings.empty')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('meetings.columns.title')}</TableHead>
                  <TableHead>{t('meetings.columns.date')}</TableHead>
                  <TableHead>{t('meetings.columns.type')}</TableHead>
                  <TableHead>{t('meetings.columns.status')}</TableHead>
                  <TableHead className="text-right">{t('meetings.columns.rsvps')}</TableHead>
                  <TableHead className="text-right">{t('meetings.columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meetings.map((meeting) => (
                  <TableRow key={meeting.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/dashboard/admin/meetings/${meeting.id}`}
                        className="hover:underline"
                      >
                        {meeting.title}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDate(meeting.scheduledAt)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{typeLabel(meeting.type)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(meeting.status)}>
                        {statusLabel(meeting.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {meeting._count?.attendances ?? 0}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/dashboard/admin/meetings/${meeting.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
