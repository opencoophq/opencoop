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
import { Label } from '@/components/ui/label';
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
import { ArrowLeft, Plus, Trash2, ExternalLink } from 'lucide-react';
import type { MeetingDto, ProxyDto } from '@opencoop/shared';

interface ProxyListItem extends ProxyDto {
  grantor?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  } | null;
  delegate?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  } | null;
}

interface ShareholderOption {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email?: string | null;
}

export default function ProxiesPage() {
  const t = useTranslations();
  const params = useParams();
  const meetingId = (params?.meetingId as string) || '';
  const { selectedCoop } = useAdmin();
  const { locale } = useLocale();

  const [meeting, setMeeting] = useState<MeetingDto | null>(null);
  const [proxies, setProxies] = useState<ProxyListItem[]>([]);
  const [shareholders, setShareholders] = useState<ShareholderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [grantorId, setGrantorId] = useState('');
  const [delegateId, setDelegateId] = useState('');
  const [grantorSearch, setGrantorSearch] = useState('');
  const [delegateSearch, setDelegateSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!selectedCoop || !meetingId) return;
    setLoading(true);
    try {
      const [m, p, sh] = await Promise.all([
        api<MeetingDto>(`/admin/coops/${selectedCoop.id}/meetings/${meetingId}`),
        api<ProxyListItem[]>(
          `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/proxies`,
        ),
        api<{ items: ShareholderOption[] }>(
          `/admin/coops/${selectedCoop.id}/shareholders?pageSize=1000&page=1&status=ACTIVE`,
        ),
      ]);
      setMeeting(m);
      setProxies(p);
      setShareholders(sh.items ?? []);
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

  const displayName = (
    sh?: Partial<ShareholderOption> | null,
  ) => {
    if (!sh) return '—';
    if (sh.companyName) return sh.companyName;
    return `${sh.firstName ?? ''} ${sh.lastName ?? ''}`.trim() || sh.email || '—';
  };

  const grantorOptions = useMemo(() => {
    const q = grantorSearch.trim().toLowerCase();
    if (!q) return shareholders.slice(0, 50);
    return shareholders
      .filter((s) => {
        const name = displayName(s).toLowerCase();
        return name.includes(q) || (s.email ?? '').toLowerCase().includes(q);
      })
      .slice(0, 50);
  }, [shareholders, grantorSearch]);

  const delegateOptions = useMemo(() => {
    const q = delegateSearch.trim().toLowerCase();
    const list = shareholders.filter((s) => s.id !== grantorId);
    if (!q) return list.slice(0, 50);
    return list
      .filter((s) => {
        const name = displayName(s).toLowerCase();
        return name.includes(q) || (s.email ?? '').toLowerCase().includes(q);
      })
      .slice(0, 50);
  }, [shareholders, delegateSearch, grantorId]);

  const openCreate = () => {
    setGrantorId('');
    setDelegateId('');
    setGrantorSearch('');
    setDelegateSearch('');
    setError(null);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!selectedCoop || !meeting) return;
    if (!grantorId || !delegateId) return;
    if (grantorId === delegateId) {
      setError(t('meetings.proxies.cannotDelegateToSelf'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/proxies`, {
        method: 'POST',
        body: {
          grantorShareholderId: grantorId,
          delegateShareholderId: delegateId,
        },
      });
      setDialogOpen(false);
      fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (proxyId: string) => {
    if (!selectedCoop || !meeting) return;
    if (!confirm(t('meetings.proxies.revokeConfirm'))) return;
    try {
      await api(
        `/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/proxies/${proxyId}`,
        { method: 'DELETE' },
      );
      fetchAll();
    } catch {
      setError(t('common.error'));
    }
  };

  const formatDate = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
      : '—';

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
          <h1 className="text-2xl font-bold">{t('meetings.proxies.heading')}</h1>
          <p className="text-sm text-muted-foreground">{meeting.title}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t('meetings.proxies.addProxy')}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          {proxies.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('meetings.proxies.empty')}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('meetings.proxies.columns.grantor')}</TableHead>
                  <TableHead>{t('meetings.proxies.columns.delegate')}</TableHead>
                  <TableHead>{t('meetings.proxies.columns.signedForm')}</TableHead>
                  <TableHead>{t('meetings.proxies.columns.grantedAt')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proxies.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{displayName(p.grantor)}</TableCell>
                    <TableCell>{displayName(p.delegate)}</TableCell>
                    <TableCell>
                      {p.signedFormUrl ? (
                        <a
                          href={p.signedFormUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t('meetings.proxies.signed')}
                        </a>
                      ) : (
                        <Badge variant="outline">{t('meetings.proxies.notSigned')}</Badge>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(p.grantedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(p.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('meetings.proxies.addProxy')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>{t('meetings.proxies.grantorLabel')}</Label>
              <Input
                placeholder={t('common.search')}
                value={grantorSearch}
                onChange={(e) => setGrantorSearch(e.target.value)}
              />
              <div className="max-h-40 overflow-y-auto border rounded">
                {grantorOptions.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={`w-full text-left p-2 text-sm hover:bg-muted ${
                      grantorId === s.id ? 'bg-muted' : ''
                    }`}
                    onClick={() => setGrantorId(s.id)}
                  >
                    <div className="font-medium">{displayName(s)}</div>
                    {s.email && (
                      <div className="text-xs text-muted-foreground">{s.email}</div>
                    )}
                  </button>
                ))}
                {grantorOptions.length === 0 && (
                  <p className="p-2 text-sm text-muted-foreground">
                    {t('common.noResults')}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('meetings.proxies.delegateLabel')}</Label>
              <Input
                placeholder={t('common.search')}
                value={delegateSearch}
                onChange={(e) => setDelegateSearch(e.target.value)}
                disabled={!grantorId}
              />
              <div className="max-h-40 overflow-y-auto border rounded">
                {delegateOptions.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={`w-full text-left p-2 text-sm hover:bg-muted ${
                      delegateId === s.id ? 'bg-muted' : ''
                    }`}
                    onClick={() => setDelegateId(s.id)}
                  >
                    <div className="font-medium">{displayName(s)}</div>
                    {s.email && (
                      <div className="text-xs text-muted-foreground">{s.email}</div>
                    )}
                  </button>
                ))}
                {delegateOptions.length === 0 && (
                  <p className="p-2 text-sm text-muted-foreground">
                    {t('common.noResults')}
                  </p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saving || !grantorId || !delegateId}
            >
              {saving ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
