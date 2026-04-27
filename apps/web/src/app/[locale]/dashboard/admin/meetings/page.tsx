'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import {
  applyColumnFiltersAndSort,
  toggleColumnSort,
  type ColumnSortState,
} from '@/lib/table-utils';
import { Plus, Eye, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { MeetingDto, MeetingStatus, MeetingType } from '@opencoop/shared';

interface MeetingListItem extends MeetingDto {
  agendaItems?: { id: string }[];
  _count?: { attendances: number; proxies: number };
}

type MeetingColumn = 'title' | 'date' | 'type' | 'status' | 'rsvps';

export default function MeetingsListPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<MeetingColumn, string>>>({});
  const [columnSort, setColumnSort] = useState<ColumnSortState<MeetingColumn>>({
    column: null,
    direction: 'asc',
  });

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

  const visibleMeetings = useMemo(
    () =>
      applyColumnFiltersAndSort(
        meetings,
        {
          title: { accessor: (meeting) => meeting.title },
          date: { accessor: (meeting) => meeting.scheduledAt },
          type: { accessor: (meeting) => meeting.type },
          status: { accessor: (meeting) => meeting.status },
          rsvps: { accessor: (meeting) => meeting._count?.attendances ?? 0 },
        },
        columnFilters,
        columnSort,
      ),
    [meetings, columnFilters, columnSort],
  );

  const sortIcon = (column: MeetingColumn) => {
    if (columnSort.column !== column) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return columnSort.direction === 'asc' ? (
      <ArrowUp className="h-4 w-4 ml-1" />
    ) : (
      <ArrowDown className="h-4 w-4 ml-1" />
    );
  };

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
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'title'))}>
                      {t('meetings.columns.title')}
                      {sortIcon('title')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'date'))}>
                      {t('meetings.columns.date')}
                      {sortIcon('date')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'type'))}>
                      {t('meetings.columns.type')}
                      {sortIcon('type')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'status'))}>
                      {t('meetings.columns.status')}
                      {sortIcon('status')}
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'rsvps'))}>
                      {t('meetings.columns.rsvps')}
                      {sortIcon('rsvps')}
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">{t('meetings.columns.actions')}</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead>
                    <Input
                      value={columnFilters.title || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, title: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.date || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, date: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.type || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, type: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.status || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, status: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.rsvps || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, rsvps: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleMeetings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                      {t('common.noResults')}
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleMeetings.map((meeting) => (
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
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
