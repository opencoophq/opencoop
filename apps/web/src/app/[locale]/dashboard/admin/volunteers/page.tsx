'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { useAdmin } from '@/contexts/admin-context';
import { api, apiFetch } from '@/lib/api';
import { isKnownInterest } from '@/lib/volunteer-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Download, Loader2, Mail, Trash2, UserMinus } from 'lucide-react';

interface VolunteerRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  postalCode: string;
  municipality: string;
  interests: string[];
  status: string;
  consentAt: string | null;
  memberLinked: boolean;
}

interface VolunteerPage {
  items: VolunteerRow[];
  total: number;
  page: number;
  totalPages: number;
  interests: string[];
  municipalities: string[];
}

const STATUSES = ['ACTIVE', 'PENDING_CONFIRMATION', 'WITHDRAWN'] as const;

export default function AdminVolunteersPage() {
  const t = useTranslations('volunteers');
  const tc = useTranslations('common');
  const { locale } = useLocale();
  const { selectedCoop } = useAdmin();
  const [municipality, setMunicipality] = useState('all');
  const [postalCode, setPostalCode] = useState('');
  const [interest, setInterest] = useState('all');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('ACTIVE');
  const [page, setPage] = useState<VolunteerPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [messageOpen, setMessageOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');

  const labelFor = (tag: string) => (isKnownInterest(tag) ? t(`interestTags.${tag}`) : tag);

  const query = useCallback(() => {
    const params = new URLSearchParams();
    if (municipality !== 'all') params.set('municipality', municipality);
    if (postalCode.trim()) params.set('postalCode', postalCode.trim());
    if (interest !== 'all') params.set('interest', interest);
    params.set('status', status);
    return params.toString();
  }, [municipality, postalCode, interest, status]);

  const load = useCallback(async () => {
    if (!selectedCoop) return;
    setLoading(true);
    setError('');
    try {
      const data = await api<VolunteerPage>(
        `/admin/coops/${selectedCoop.id}/volunteers?${query()}`,
      );
      setPage(data);
    } catch {
      setError(t('error'));
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, query, t]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = async () => {
    if (!selectedCoop) return;
    const response = await apiFetch(`/admin/coops/${selectedCoop.id}/volunteers/export?${query()}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'volunteers.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const sendMessage = async () => {
    if (!selectedCoop || !subject.trim() || !body.trim()) return;
    setSending(true);
    setError('');
    try {
      await api(`/admin/coops/${selectedCoop.id}/volunteers/message`, {
        method: 'POST',
        body: {
          subject,
          body,
          municipality: municipality === 'all' ? undefined : municipality,
          postalCode: postalCode.trim() || undefined,
          interest: interest === 'all' ? undefined : interest,
        },
      });
      setMessageOpen(false);
      setSubject('');
      setBody('');
      setNotice(t('admin.sent'));
    } catch {
      setError(t('error'));
    } finally {
      setSending(false);
    }
  };

  const withdraw = async (id: string) => {
    if (!selectedCoop || !window.confirm(t('admin.withdrawConfirm'))) return;
    await api(`/admin/coops/${selectedCoop.id}/volunteers/${id}/withdraw`, { method: 'POST' });
    load();
  };

  const remove = async (id: string) => {
    if (!selectedCoop || !window.confirm(t('admin.deleteConfirm'))) return;
    await api(`/admin/coops/${selectedCoop.id}/volunteers/${id}`, { method: 'DELETE' });
    load();
  };

  if (!selectedCoop) {
    return <p className="text-muted-foreground">{t('unavailable')}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />
            {t('admin.export')}
          </Button>
          <Button onClick={() => setMessageOpen(true)} disabled={status !== 'ACTIVE'}>
            <Mail className="mr-2 h-4 w-4" />
            {t('admin.message')}
          </Button>
        </div>
      </div>

      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('admin.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label>{t('admin.municipality')}</Label>
              <Select value={municipality} onValueChange={setMunicipality}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('admin.allMunicipalities')}</SelectItem>
                  {(page?.municipalities ?? []).map((city) => (
                    <SelectItem key={city} value={city}>
                      {city}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-postcode">{t('admin.postalCode')}</Label>
              <Input
                id="filter-postcode"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="3600"
              />
            </div>
            <div className="space-y-1">
              <Label>{t('admin.interest')}</Label>
              <Select value={interest} onValueChange={setInterest}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('admin.allInterests')}</SelectItem>
                  {(page?.interests ?? []).map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      {labelFor(tag)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t('admin.status')}</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`status.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : page && page.items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('email')}</TableHead>
                  <TableHead>{t('municipality')}</TableHead>
                  <TableHead>{t('postalCode')}</TableHead>
                  <TableHead>{t('interests')}</TableHead>
                  <TableHead>{t('admin.member')}</TableHead>
                  <TableHead>{t('admin.consent')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{row.email}</TableCell>
                    <TableCell>{row.municipality}</TableCell>
                    <TableCell>{row.postalCode}</TableCell>
                    <TableCell>{row.interests.map(labelFor).join(', ')}</TableCell>
                    <TableCell>{row.memberLinked ? t('admin.member') : t('admin.guest')}</TableCell>
                    <TableCell>
                      {row.consentAt ? new Date(row.consentAt).toLocaleDateString(locale) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        {row.status !== 'WITHDRAWN' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => withdraw(row.id)}
                            aria-label={t('admin.withdraw')}
                          >
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => remove(row.id)}
                          aria-label={t('admin.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">{t('admin.empty')}</p>
          )}
          {page && <p className="text-xs text-muted-foreground">{page.total}</p>}
        </CardContent>
      </Card>

      <Dialog open={messageOpen} onOpenChange={setMessageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.messageTitle')}</DialogTitle>
            <DialogDescription>{t('admin.messageDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="volunteer-subject">{t('admin.subject')}</Label>
              <Input
                id="volunteer-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="volunteer-body">{t('admin.body')}</Label>
              <Textarea
                id="volunteer-body"
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMessageOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={sendMessage} disabled={sending || !subject.trim() || !body.trim()}>
              {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('admin.send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
