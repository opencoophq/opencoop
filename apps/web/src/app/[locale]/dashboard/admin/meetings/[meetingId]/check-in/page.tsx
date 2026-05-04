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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAdmin } from '@/contexts/admin-context';
import { useLocale } from '@/contexts/locale-context';
import {
  ArrowLeft,
  Check,
  Circle,
  Copy,
  QrCode,
  Search,
  Undo2,
} from 'lucide-react';
import type { MeetingDto, RSVPStatus } from '@opencoop/shared';

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
  const [search, setSearch] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [kioskSession, setKioskSession] = useState<KioskSession | null>(null);
  const [kioskModalOpen, setKioskModalOpen] = useState(false);
  const [kioskStarting, setKioskStarting] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = shName(r.shareholder).toLowerCase();
      const num = (r.shareholder.memberNumber ?? '').toLowerCase();
      return name.includes(q) || num.includes(q);
    });
  }, [rows, search]);

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

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder={t('meetings.checkIn.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      <Card>
        <CardContent className="pt-6">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('meetings.checkIn.empty')}
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((row) => {
                const isCheckedIn = !!row.checkedInAt;
                const busy = togglingId === row.id;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => toggleCheckIn(row)}
                      disabled={busy}
                      className="w-full flex items-center gap-4 py-3 px-2 hover:bg-muted/50 transition text-left disabled:opacity-70"
                    >
                      <div className="flex-shrink-0">
                        {isCheckedIn ? (
                          <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                            <Check className="h-5 w-5" />
                          </div>
                        ) : (
                          <div className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 flex items-center justify-center">
                            <Circle className="h-4 w-4 text-transparent" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{shName(row.shareholder)}</span>
                          {row.shareholder.memberNumber && (
                            <span className="text-xs text-muted-foreground">
                              #{row.shareholder.memberNumber}
                            </span>
                          )}
                          <Badge variant={rsvpVariant(row.rsvpStatus)}>
                            {t(
                              `meetings.rsvp.status.${row.rsvpStatus.toLowerCase()}` as 'meetings.rsvp.status.attending',
                            )}
                          </Badge>
                          {row.proxiesHeld.length > 0 && (
                            <Badge variant="outline" className="bg-amber-50 text-amber-900 border-amber-300">
                              {t('meetings.checkIn.ballotCount', {
                                count: 1 + row.proxiesHeld.length,
                              })}
                            </Badge>
                          )}
                        </div>
                        {row.proxiesHeld.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {t('meetings.checkIn.proxyFor')}{' '}
                            {row.proxiesHeld.map((g) => shName(g)).join(', ')}
                          </p>
                        )}
                        {isCheckedIn && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatTime(row.checkedInAt)}
                          </p>
                        )}
                      </div>
                      <div className="flex-shrink-0">
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
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
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
