'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Check,
  Circle,
  Copy,
  Printer,
  QrCode,
  Undo2,
} from 'lucide-react';
import type { MeetingDto, RSVPStatus } from '@opencoop/shared';
import {
  applyColumnFiltersAndSort,
  toggleColumnSort,
  type ColumnSortState,
} from '@/lib/table-utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type CheckInColumn = 'name' | 'memberNumber' | 'rsvpStatus' | 'ballots' | 'checkedInAt';

interface ProxyGrantor {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}

interface AttendanceRow {
  id: string;
  shareholderId: string;
  rsvpStatus: RSVPStatus;
  checkedInAt?: string | null;
  shareholder: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    memberNumber?: string | null;
    email?: string | null;
  };
  proxiesHeld: ProxyGrantor[];
}

interface LiveAttendance {
  rsvpCount: number;
  checkedInCount: number;
  proxyCount: number;
  totalEligible: number;
}

interface KioskSession {
  id: string;
  token: string;
  meetingId: string;
}

export default function CheckInPage() {
  const t = useTranslations();
  const params = useParams();
  const meetingId = (params?.meetingId as string) || '';
  const locale = (params?.locale as string) || 'en';
  const { selectedCoop } = useAdmin();
  const { locale: formatLocale } = useLocale();

  const [meeting, setMeeting] = useState<MeetingDto | null>(null);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [live, setLive] = useState<LiveAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<CheckInColumn, string>>>({});
  const [columnSort, setColumnSort] = useState<ColumnSortState<CheckInColumn>>({
    column: null,
    direction: 'asc',
  });
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [kioskSession, setKioskSession] = useState<KioskSession | null>(null);
  const [kioskModalOpen, setKioskModalOpen] = useState(false);
  const [kioskStarting, setKioskStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloadingSheet, setDownloadingSheet] = useState(false);

  const pollRef = useRef<number | null>(null);

  const fetchInitial = useCallback(async () => {
    if (!selectedCoop || !meetingId) return;
    try {
      const [m, a, l] = await Promise.all([
        api<MeetingDto>(`/admin/coops/${selectedCoop.id}/meetings/${meetingId}`),
        api<AttendanceRow[]>(
          `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/attendance`,
        ),
        api<LiveAttendance>(
          `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/live-attendance`,
        ),
      ]);
      setMeeting(m);
      setRows(a);
      setLive(l);
      setError(null);
    } catch {
      setError(t('meetings.detail.loadError'));
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, meetingId, t]);

  const fetchLive = useCallback(async () => {
    if (!selectedCoop || !meetingId) return;
    try {
      const l = await api<LiveAttendance>(
        `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/live-attendance`,
      );
      setLive(l);
    } catch {
      // silent, just polling
    }
  }, [selectedCoop, meetingId]);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  useEffect(() => {
    if (!selectedCoop || !meetingId) return;
    pollRef.current = window.setInterval(fetchLive, 5000);
    return () => {
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [selectedCoop, meetingId, fetchLive]);

  const shName = (sh: {
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
  }) => {
    if (sh.companyName) return sh.companyName;
    return `${sh.firstName ?? ''} ${sh.lastName ?? ''}`.trim() || '—';
  };

  const filtered = useMemo(
    () =>
      applyColumnFiltersAndSort<AttendanceRow, CheckInColumn>(
        rows,
        {
          name: { accessor: (r) => shName(r.shareholder) },
          memberNumber: { accessor: (r) => r.shareholder.memberNumber ?? '' },
          rsvpStatus: { accessor: (r) => r.rsvpStatus },
          ballots: { accessor: (r) => 1 + r.proxiesHeld.length },
          checkedInAt: {
            accessor: (r) => (r.checkedInAt ? new Date(r.checkedInAt) : null),
          },
        },
        columnFilters,
        columnSort,
      ),
    [rows, columnFilters, columnSort],
  );

  const sortIcon = (column: CheckInColumn) => {
    if (columnSort.column !== column) return <ArrowUpDown className="h-4 w-4 ml-1" />;
    return columnSort.direction === 'asc' ? (
      <ArrowUp className="h-4 w-4 ml-1" />
    ) : (
      <ArrowDown className="h-4 w-4 ml-1" />
    );
  };

  const formatTime = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(formatLocale, { timeStyle: 'short' }) : '';

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

  const toggleCheckIn = async (row: AttendanceRow) => {
    if (!selectedCoop || togglingId) return;
    const wasCheckedIn = !!row.checkedInAt;
    const optimistic = wasCheckedIn
      ? null
      : new Date().toISOString();
    setTogglingId(row.id);
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, checkedInAt: optimistic } : r,
      ),
    );
    try {
      const path = wasCheckedIn
        ? `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/attendance/${row.shareholderId}/undo`
        : `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/attendance/${row.shareholderId}/check-in`;
      await api(path, { method: 'POST' });
      fetchLive();
    } catch {
      // revert
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, checkedInAt: row.checkedInAt ?? null } : r,
        ),
      );
      setError(t('meetings.checkIn.toggleError'));
    } finally {
      setTogglingId(null);
    }
  };

  const downloadPrintableSheet = async () => {
    if (!selectedCoop || !meeting) return;
    setDownloadingSheet(true);
    setError(null);
    try {
      // The PDF endpoint requires JWT (JwtAuthGuard) — fetch with the bearer
      // token, then open the blob in a new tab so the operator can hit
      // print or download.
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
      const url = `${API_URL}/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/attendance-sheet`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setDownloadingSheet(false);
    }
  };

  const startKiosk = async () => {
    if (!selectedCoop) return;
    setKioskStarting(true);
    try {
      const session = await api<KioskSession>(
        `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/kiosk/start`,
        { method: 'POST' },
      );
      setKioskSession(session);
      setKioskModalOpen(true);
    } catch {
      setError(t('meetings.checkIn.kioskStartError'));
    } finally {
      setKioskStarting(false);
    }
  };

  const endKiosk = async () => {
    if (!selectedCoop || !kioskSession) return;
    try {
      await api(
        `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/kiosk/${kioskSession.id}/end`,
        { method: 'POST' },
      );
    } catch {
      // ignore
    } finally {
      setKioskSession(null);
      setKioskModalOpen(false);
    }
  };

  const kioskUrl = useMemo(() => {
    if (!kioskSession) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/${locale}/meetings/kiosk/${kioskSession.token}`;
  }, [kioskSession, locale]);

  const copyKioskUrl = async () => {
    if (!kioskUrl) return;
    try {
      await navigator.clipboard.writeText(kioskUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // no-op
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
          <h1 className="text-2xl font-bold">{t('meetings.checkIn.heading')}</h1>
          <p className="text-sm text-muted-foreground">{meeting.title}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={downloadPrintableSheet}
            disabled={downloadingSheet}
          >
            <Printer className="h-4 w-4 mr-2" />
            {t('meetings.checkIn.printableSheet')}
          </Button>
          <Button
            variant="outline"
            onClick={kioskSession ? () => setKioskModalOpen(true) : startKiosk}
            disabled={kioskStarting}
          >
            <QrCode className="h-4 w-4 mr-2" />
            {kioskSession
              ? t('meetings.checkIn.kioskRunning')
              : t('meetings.checkIn.startKiosk')}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">{t('meetings.checkIn.rsvpd')}</p>
            <p className="text-2xl font-bold">{live?.rsvpCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">
              {t('meetings.checkIn.checkedIn')}
            </p>
            <p className="text-2xl font-bold">{live?.checkedInCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">{t('meetings.checkIn.viaProxy')}</p>
            <p className="text-2xl font-bold">{live?.proxyCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-muted-foreground">{t('meetings.checkIn.quorum')}</p>
            <p className="text-lg font-semibold">N/A</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('meetings.checkIn.quorumNotRequired')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* List */}
      <Card>
        <CardContent className="pt-6">
          {rows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('meetings.checkIn.empty')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12" />
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'name'))}>
                      {t('meetings.checkIn.columns.name')}
                      {sortIcon('name')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'memberNumber'))}>
                      {t('meetings.checkIn.columns.memberNumber')}
                      {sortIcon('memberNumber')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'rsvpStatus'))}>
                      {t('meetings.checkIn.columns.rsvpStatus')}
                      {sortIcon('rsvpStatus')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'ballots'))}>
                      {t('meetings.checkIn.columns.ballots')}
                      {sortIcon('ballots')}
                    </Button>
                  </TableHead>
                  <TableHead>{t('meetings.checkIn.columns.proxyFor')}</TableHead>
                  <TableHead>
                    <Button variant="ghost" size="sm" onClick={() => setColumnSort((prev) => toggleColumnSort(prev, 'checkedInAt'))}>
                      {t('meetings.checkIn.columns.checkedInAt')}
                      {sortIcon('checkedInAt')}
                    </Button>
                  </TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead />
                  <TableHead>
                    <Input
                      value={columnFilters.name || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.memberNumber || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, memberNumber: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.rsvpStatus || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, rsvpStatus: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead>
                    <Input
                      value={columnFilters.ballots || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, ballots: e.target.value }))}
                      placeholder={t('common.filter')}
                      className="h-8"
                    />
                  </TableHead>
                  <TableHead />
                  <TableHead>
                    <Input
                      value={columnFilters.checkedInAt || ''}
                      onChange={(e) => setColumnFilters((prev) => ({ ...prev, checkedInAt: e.target.value }))}
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
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                      {t('common.noResults')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => {
                    const isCheckedIn = !!row.checkedInAt;
                    const busy = togglingId === row.id;
                    return (
                      <TableRow
                        key={row.id}
                        className={`cursor-pointer hover:bg-muted/50 transition ${busy ? 'opacity-70 pointer-events-none' : ''}`}
                        onClick={() => toggleCheckIn(row)}
                      >
                        <TableCell>
                          {isCheckedIn ? (
                            <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                              <Check className="h-5 w-5" />
                            </div>
                          ) : (
                            <div className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center">
                              <Circle className="h-4 w-4 text-transparent" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{shName(row.shareholder)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.shareholder.memberNumber ? `#${row.shareholder.memberNumber}` : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={rsvpVariant(row.rsvpStatus)}>
                            {t(
                              `meetings.rsvp.status.${row.rsvpStatus.toLowerCase()}` as 'meetings.rsvp.status.attending',
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {row.proxiesHeld.length > 0 ? (
                            <Badge variant="outline" className="bg-amber-50 text-amber-900 border-amber-300">
                              {t('meetings.checkIn.ballotCount', {
                                count: 1 + row.proxiesHeld.length,
                              })}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">1</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {row.proxiesHeld.length > 0
                            ? row.proxiesHeld.map((g) => shName(g)).join(', ')
                            : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {isCheckedIn ? formatTime(row.checkedInAt) : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          {isCheckedIn ? (
                            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                              <Undo2 className="h-3 w-3" />
                              {t('meetings.checkIn.undoButton')}
                            </span>
                          ) : (
                            <span className="text-xs text-primary font-medium">
                              {t('meetings.checkIn.checkInButton')}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Kiosk modal */}
      <Dialog open={kioskModalOpen} onOpenChange={setKioskModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('meetings.checkIn.kioskRunning')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('meetings.checkIn.kioskInstructions')}
            </p>
            {kioskUrl && (
              <div className="flex justify-center py-2">
                <div className="p-3 bg-white rounded-lg">
                  <QRCodeSVG value={kioskUrl} size={192} />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase">
                {t('meetings.checkIn.kioskUrl')}
              </p>
              <div className="flex items-center gap-2">
                <Input value={kioskUrl} readOnly className="text-xs" />
                <Button variant="outline" size="sm" onClick={copyKioskUrl}>
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 mr-1" />
                      {t('meetings.checkIn.copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-1" />
                      {t('meetings.checkIn.copyUrl')}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKioskModalOpen(false)}>
              {t('common.close')}
            </Button>
            <Button variant="destructive" onClick={endKiosk}>
              {t('meetings.checkIn.endKiosk')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
