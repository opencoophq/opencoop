'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAdmin } from '@/contexts/admin-context';
import { ArrowLeft } from 'lucide-react';
import type {
  AgendaItemDto,
  MajorityType,
  MeetingDto,
  VoteChoice,
} from '@opencoop/shared';

interface MeetingDetail extends MeetingDto {
  agendaItems?: AgendaItemDto[];
}

interface AttendanceRow {
  id: string;
  shareholderId: string;
  checkedInAt?: string | null;
  shareholder: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    memberNumber?: string | null;
  };
}

function majorityKey(m: MajorityType): 'simple' | 'twoThirds' | 'threeQuarters' {
  switch (m) {
    case 'SIMPLE':
      return 'simple';
    case 'TWO_THIRDS':
      return 'twoThirds';
    case 'THREE_QUARTERS':
      return 'threeQuarters';
  }
}

export default function VotingPage() {
  const t = useTranslations();
  const params = useParams();
  const meetingId = (params?.meetingId as string) || '';
  const { selectedCoop } = useAdmin();

  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

  const [dialogResolutionId, setDialogResolutionId] = useState<string | null>(null);
  const [ballot, setBallot] = useState<Record<string, VoteChoice>>({});
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!selectedCoop || !meetingId) return;
    setLoading(true);
    try {
      const [m, a] = await Promise.all([
        api<MeetingDetail>(`/admin/coops/${selectedCoop.id}/meetings/${meetingId}`),
        api<AttendanceRow[]>(
          `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/attendance`,
        ),
      ]);
      setMeeting(m);
      setAttendance(a);
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

  const resolutions = useMemo(() => {
    const items = (meeting?.agendaItems ?? []).slice().sort((a, b) => a.order - b.order);
    return items.filter((i) => i.type !== 'INFORMATIONAL' && i.resolution);
  }, [meeting]);

  const checkedIn = useMemo(
    () => attendance.filter((a) => !!a.checkedInAt),
    [attendance],
  );

  const shName = (sh: AttendanceRow['shareholder']) => {
    if (sh.companyName) return sh.companyName;
    return `${sh.firstName ?? ''} ${sh.lastName ?? ''}`.trim() || '—';
  };

  const openVoteDialog = (resolutionId: string) => {
    setDialogResolutionId(resolutionId);
    // Default all to ABSTAIN
    const initial: Record<string, VoteChoice> = {};
    for (const a of checkedIn) initial[a.shareholderId] = 'ABSTAIN';
    setBallot(initial);
  };

  const submitVotes = async () => {
    if (!selectedCoop || !meeting || !dialogResolutionId) return;
    setSubmitting(true);
    try {
      const votes = Object.entries(ballot).map(([shareholderId, choice]) => ({
        shareholderId,
        choice,
      }));
      await api(
        `/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/resolutions/${dialogResolutionId}/votes`,
        { method: 'POST', body: { votes } },
      );
      setDialogResolutionId(null);
      fetchAll();
    } catch {
      setError(t('meetings.voting.saveError'));
    } finally {
      setSubmitting(false);
    }
  };

  const closeResolution = async (resolutionId: string) => {
    if (!selectedCoop || !meeting) return;
    if (!confirm(t('meetings.voting.closeConfirm'))) return;
    setClosingId(resolutionId);
    try {
      await api(
        `/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/resolutions/${resolutionId}/close`,
        { method: 'POST' },
      );
      fetchAll();
    } catch {
      setError(t('meetings.voting.closeError'));
    } finally {
      setClosingId(null);
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

      <div>
        <h1 className="text-2xl font-bold">{t('meetings.voting.heading')}</h1>
        <p className="text-sm text-muted-foreground">{meeting.title}</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {resolutions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t('meetings.voting.noResolutions')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {resolutions.map((item) => {
            const r = item.resolution!;
            const isClosed = !!r.closedAt;
            const mKey = majorityKey(r.majorityType);
            return (
              <Card key={item.id}>
                <CardHeader>
                  <div className="flex items-start justify-between flex-wrap gap-2">
                    <div>
                      <CardTitle className="text-base">
                        {item.order}. {item.title}
                      </CardTitle>
                      <div className="flex gap-2 mt-2">
                        <Badge variant="outline">
                          {t(`meetings.voting.majority.${mKey}` as 'meetings.voting.majority.simple')}
                        </Badge>
                        {isClosed ? (
                          <Badge variant={r.passed ? 'default' : 'destructive'}>
                            {r.passed
                              ? t('meetings.voting.outcome.passed')
                              : t('meetings.voting.outcome.rejected')}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            {t('meetings.voting.outcome.notClosed')}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <blockquote className="border-l-2 pl-4 italic text-sm text-muted-foreground whitespace-pre-wrap">
                    {r.proposedText}
                  </blockquote>

                  <div className="flex gap-4 text-sm">
                    <span>
                      <strong>{r.votesFor}</strong> {t('meetings.voting.for')}
                    </span>
                    <span>
                      <strong>{r.votesAgainst}</strong> {t('meetings.voting.against')}
                    </span>
                    <span>
                      <strong>{r.votesAbstain}</strong> {t('meetings.voting.abstain')}
                    </span>
                  </div>

                  {!isClosed && (
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openVoteDialog(r.id)}
                        disabled={checkedIn.length === 0}
                      >
                        {t('meetings.voting.enterVotes')}
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => closeResolution(r.id)}
                        disabled={closingId === r.id}
                      >
                        {closingId === r.id
                          ? t('common.loading')
                          : t('meetings.voting.closeResolution')}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Bulk vote entry dialog */}
      <Dialog
        open={dialogResolutionId !== null}
        onOpenChange={(open) => !open && setDialogResolutionId(null)}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('meetings.voting.enterVotes')}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">
            {checkedIn.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {t('meetings.voting.noCheckedIn')}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b">
                    <th className="text-left py-2">
                      {t('meetings.voting.columns.shareholder')}
                    </th>
                    <th className="text-center py-2 w-20">
                      {t('meetings.voting.for')}
                    </th>
                    <th className="text-center py-2 w-20">
                      {t('meetings.voting.against')}
                    </th>
                    <th className="text-center py-2 w-20">
                      {t('meetings.voting.abstain')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {checkedIn.map((a) => (
                    <tr key={a.shareholderId} className="border-b last:border-0">
                      <td className="py-2">
                        <div className="font-medium">{shName(a.shareholder)}</div>
                        {a.shareholder.memberNumber && (
                          <div className="text-xs text-muted-foreground">
                            #{a.shareholder.memberNumber}
                          </div>
                        )}
                      </td>
                      {(['FOR', 'AGAINST', 'ABSTAIN'] as VoteChoice[]).map((choice) => (
                        <td key={choice} className="text-center py-2">
                          <input
                            type="radio"
                            name={`vote-${a.shareholderId}`}
                            checked={ballot[a.shareholderId] === choice}
                            onChange={() =>
                              setBallot((prev) => ({
                                ...prev,
                                [a.shareholderId]: choice,
                              }))
                            }
                            className="h-4 w-4"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogResolutionId(null)}>
              {t('meetings.voting.cancel')}
            </Button>
            <Button
              onClick={submitVotes}
              disabled={submitting || checkedIn.length === 0}
            >
              {submitting ? t('common.loading') : t('meetings.voting.submitVotes')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
