'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { ArrowLeft, Copy, Download, Check } from 'lucide-react';
import type { MeetingDto, RSVPStatus, ProxyDto } from '@opencoop/shared';

type FilterValue = RSVPStatus | 'ALL';

interface AttendanceRow {
  id: string;
  shareholderId: string;
  rsvpStatus: RSVPStatus;
  rsvpAt?: string | null;
  rsvpToken?: string | null;
  shareholder: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  };
}

interface ProxyListItem extends ProxyDto {
  delegate?: { firstName?: string | null; lastName?: string | null } | null;
}

export default function RsvpTrackerPage() {
  const t = useTranslations();
  const params = useParams();
  const meetingId = (params?.meetingId as string) || '';
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();

  const [meeting, setMeeting] = useState<MeetingDto | null>(null);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [proxies, setProxies] = useState<ProxyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!selectedCoop || !meetingId) return;
    setLoading(true);
    try {
      const [m, a, p] = await Promise.all([
        api<MeetingDto>(`/admin/coops/${selectedCoop.id}/meetings/${meetingId}`),
        api<AttendanceRow[]>(
          `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/attendance`,
        ),
        api<ProxyListItem[]>(
          `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/proxies`,
        ).catch(() => [] as ProxyListItem[]),
      ]);
      setMeeting(m);
      setRows(a);
      setProxies(p);
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

  const delegateByGrantor = useMemo(() => {
    const map = new Map<string, ProxyListItem>();
    for (const p of proxies) map.set(p.grantorShareholderId, p);
    return map;
  }, [proxies]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return rows;
    return rows.filter((r) => r.rsvpStatus === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c: Record<RSVPStatus | 'TOTAL', number> = {
      TOTAL: rows.length,
      ATTENDING: 0,
      PROXY: 0,
      ABSENT: 0,
      UNKNOWN: 0,
    };
    for (const r of rows) c[r.rsvpStatus]++;
    return c;
  }, [rows]);

  const shName = (sh: AttendanceRow['shareholder']) =>
    `${sh.firstName ?? ''} ${sh.lastName ?? ''}`.trim() || '—';

  const formatDate = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
      : '—';

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

  const rsvpLink = (token?: string | null) => {
    if (!token) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/meetings/rsvp/${token}`;
  };

  const copyLink = async (row: AttendanceRow) => {
    const url = rsvpLink(row.rsvpToken);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(row.id);
      setTimeout(() => setCopiedId((id) => (id === row.id ? null : id)), 1500);
    } catch {
      // no-op
    }
  };

  const exportCsv = () => {
    const header = ['Name', 'Email', 'RSVP Status', 'RSVP At', 'Delegate'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const proxy = delegateByGrantor.get(r.shareholderId);
      const delegateName = proxy?.delegate
        ? `${proxy.delegate.firstName ?? ''} ${proxy.delegate.lastName ?? ''}`.trim()
        : '';
      const cells = [
        shName(r.shareholder),
        r.shareholder.email ?? '',
        r.rsvpStatus,
        r.rsvpAt ?? '',
        delegateName,
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
      lines.push(cells.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `rsvps-${meetingId}.csv`;
    a.click();
    URL.revokeObjectURL(href);
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

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('meetings.rsvp.heading')}</h1>
          <p className="text-sm text-muted-foreground">{meeting.title}</p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          {t('meetings.rsvp.exportCsv')}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">{t('meetings.rsvp.total')}</p>
            <p className="text-2xl font-bold">{counts.TOTAL}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">
              {t('meetings.rsvp.status.attending')}
            </p>
            <p className="text-2xl font-bold">{counts.ATTENDING}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">
              {t('meetings.rsvp.status.proxy')}
            </p>
            <p className="text-2xl font-bold">{counts.PROXY}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">
              {t('meetings.rsvp.status.absent')}
            </p>
            <p className="text-2xl font-bold">{counts.ABSENT}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">
              {t('meetings.rsvp.status.unknown')}
            </p>
            <p className="text-2xl font-bold">{counts.UNKNOWN}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {t('meetings.rsvp.filters.label')}:
        </span>
        <Select value={filter} onValueChange={(v) => setFilter(v as FilterValue)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('meetings.rsvp.filters.all')}</SelectItem>
            <SelectItem value="ATTENDING">{t('meetings.rsvp.status.attending')}</SelectItem>
            <SelectItem value="PROXY">{t('meetings.rsvp.status.proxy')}</SelectItem>
            <SelectItem value="ABSENT">{t('meetings.rsvp.status.absent')}</SelectItem>
            <SelectItem value="UNKNOWN">{t('meetings.rsvp.status.unknown')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="pt-6">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('meetings.rsvp.empty')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('meetings.rsvp.columns.shareholder')}</TableHead>
                  <TableHead>{t('meetings.rsvp.columns.email')}</TableHead>
                  <TableHead>{t('meetings.rsvp.columns.rsvpStatus')}</TableHead>
                  <TableHead>{t('meetings.rsvp.columns.delegate')}</TableHead>
                  <TableHead>{t('meetings.rsvp.columns.rsvpAt')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const proxy = delegateByGrantor.get(row.shareholderId);
                  const delegateName = proxy?.delegate
                    ? `${proxy.delegate.firstName ?? ''} ${proxy.delegate.lastName ?? ''}`.trim()
                    : null;
                  return (
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
                      <TableCell>
                        {row.rsvpStatus === 'PROXY' ? delegateName || '—' : '—'}
                      </TableCell>
                      <TableCell>{formatDate(row.rsvpAt ?? null)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!row.rsvpToken}
                          onClick={() => copyLink(row)}
                        >
                          {copiedId === row.id ? (
                            <>
                              <Check className="h-4 w-4 mr-1" />
                              {t('meetings.rsvp.copied')}
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4 mr-1" />
                              {t('meetings.rsvp.copyLink')}
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
