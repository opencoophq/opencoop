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
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
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
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Copy,
  Download,
  Check,
} from 'lucide-react';
import type { MeetingDto, RSVPStatus, ProxyDto } from '@opencoop/shared';
import {
  applyColumnFiltersAndSort,
  toggleColumnSort,
  type ColumnSortState,
} from '@/lib/table-utils';

type RsvpColumn = 'shareholder' | 'email' | 'rsvpStatus' | 'delegate' | 'rsvpAt';

const RSVP_STATUSES: RSVPStatus[] = ['ATTENDING', 'PROXY', 'ABSENT', 'UNKNOWN'];

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
  const [columnFilters, setColumnFilters] = useState<Partial<Record<RsvpColumn, string>>>({});
  const [statusFilter, setStatusFilter] = useState<Set<RSVPStatus>>(new Set());
  const [columnSort, setColumnSort] = useState<ColumnSortState<RsvpColumn>>({
    column: null,
    direction: 'asc',
  });
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
    // Multi-select status filter is applied first; empty set = no filter (all
    // statuses shown). Free-text column filters then run on the remaining rows.
    const statusFiltered =
      statusFilter.size === 0
        ? rows
        : rows.filter((r) => statusFilter.has(r.rsvpStatus));
    return applyColumnFiltersAndSort<AttendanceRow, RsvpColumn>(
      statusFiltered,
      {
        shareholder: {
          accessor: (r) =>
            `${r.shareholder.firstName ?? ''} ${r.shareholder.lastName ?? ''}`.trim(),
        },
        email: { accessor: (r) => r.shareholder.email ?? '' },
        rsvpStatus: {
          // Filter compares against the accessor output, not the rendered
          // cell — return the translated label so the user can filter on
          // what they see (e.g. "aanwezig", "afwezig"), not the raw enum.
          accessor: (r) =>
            t(`meetings.rsvp.status.${r.rsvpStatus.toLowerCase()}` as 'meetings.rsvp.status.attending'),
        },
        delegate: {
          accessor: (r) => {
            if (r.rsvpStatus !== 'PROXY') return '';
            const proxy = delegateByGrantor.get(r.shareholderId);
            return proxy?.delegate
              ? `${proxy.delegate.firstName ?? ''} ${proxy.delegate.lastName ?? ''}`.trim()
              : '';
          },
        },
        rsvpAt: { accessor: (r) => (r.rsvpAt ? new Date(r.rsvpAt) : null) },
      },
      columnFilters,
      columnSort,
    );
  }, [rows, statusFilter, delegateByGrantor, columnFilters, columnSort, t]);

  const toggleStatusFilter = (status: RSVPStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const statusFilterLabel = () => {
    if (statusFilter.size === 0 || statusFilter.size === RSVP_STATUSES.length) {
      return t('common.filter');
    }
    return Array.from(statusFilter)
      .map((s) =>
        t(`meetings.rsvp.status.${s.toLowerCase()}` as 'meetings.rsvp.status.attending'),
      )
      .join(', ');
  };

  const sortIcon = (column: RsvpColumn) => {
    if (columnSort.column !== column) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return columnSort.direction === 'asc' ? (
      <ArrowUp className="h-4 w-4 ml-1" />
    ) : (
      <ArrowDown className="h-4 w-4 ml-1" />
    );
  };

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

      {/* Table */}
      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('meetings.rsvp.empty')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'shareholder'))}>
                      {t('meetings.rsvp.columns.shareholder')}
                      {sortIcon('shareholder')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'email'))}>
                      {t('meetings.rsvp.columns.email')}
                      {sortIcon('email')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'rsvpStatus'))}>
                      {t('meetings.rsvp.columns.rsvpStatus')}
                      {sortIcon('rsvpStatus')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'delegate'))}>
                      {t('meetings.rsvp.columns.delegate')}
                      {sortIcon('delegate')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'rsvpAt'))}>
                      {t('meetings.rsvp.columns.rsvpAt')}
                      {sortIcon('rsvpAt')}
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead>
                    <Input
                      value={columnFilters.shareholder || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, shareholder: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.email || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, email: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 w-full justify-between font-normal">
                          <span className="truncate">{statusFilterLabel()}</span>
                          <ChevronDown className="h-4 w-4 ml-1 flex-shrink-0" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {RSVP_STATUSES.map((status) => (
                          <DropdownMenuCheckboxItem
                            key={status}
                            checked={statusFilter.has(status)}
                            onCheckedChange={() => toggleStatusFilter(status)}
                          >
                            {t(`meetings.rsvp.status.${status.toLowerCase()}` as 'meetings.rsvp.status.attending')}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.delegate || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, delegate: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.rsvpAt || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, rsvpAt: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                      {t('common.noResults')}
                    </TableCell>
                  </TableRow>
                ) : filtered.map((row) => {
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
