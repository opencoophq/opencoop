'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { api, apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAdmin } from '@/contexts/admin-context';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Pencil,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Paperclip,
  Upload,
} from 'lucide-react';
import type {
  AgendaItemDto,
  AgendaType,
  MajorityType,
  MeetingDto,
} from '@opencoop/shared';

interface MeetingDetail extends MeetingDto {
  agendaItems?: AgendaItemDto[];
}

interface FormState {
  id?: string;
  order: number;
  title: string;
  description: string;
  type: AgendaType;
  proposedText: string;
  majorityType: MajorityType;
}

const EMPTY_FORM: FormState = {
  order: 1,
  title: '',
  description: '',
  type: 'INFORMATIONAL',
  proposedText: '',
  majorityType: 'SIMPLE',
};

export default function MeetingAgendaPage() {
  const t = useTranslations();
  const params = useParams();
  const meetingId = (params?.meetingId as string) || '';
  const { selectedCoop } = useAdmin();

  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const fetchMeeting = useCallback(async () => {
    if (!selectedCoop || !meetingId) return;
    setLoading(true);
    try {
      const data = await api<MeetingDetail>(
        `/admin/coops/${selectedCoop.id}/meetings/${meetingId}`,
      );
      setMeeting(data);
      setError(null);
    } catch {
      setError(t('meetings.detail.loadError'));
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, meetingId, t]);

  useEffect(() => {
    fetchMeeting();
  }, [fetchMeeting]);

  const openCreate = () => {
    const maxOrder =
      meeting?.agendaItems?.reduce((m, it) => (it.order > m ? it.order : m), 0) ?? 0;
    setForm({ ...EMPTY_FORM, order: maxOrder + 1 });
    setDialogOpen(true);
  };

  const openEdit = (item: AgendaItemDto) => {
    setForm({
      id: item.id,
      order: item.order,
      title: item.title,
      description: item.description ?? '',
      type: item.type,
      proposedText: item.resolution?.proposedText ?? '',
      majorityType: item.resolution?.majorityType ?? 'SIMPLE',
    });
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!selectedCoop || !meeting) return;
    if (!form.title.trim()) {
      setError(t('meetings.agenda.titleRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body: {
        order: number;
        title: string;
        description?: string;
        type: AgendaType;
        resolution?: { proposedText: string; majorityType: MajorityType };
      } = {
        order: form.order,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        type: form.type,
      };
      if (form.type !== 'INFORMATIONAL') {
        body.resolution = {
          proposedText: form.proposedText.trim(),
          majorityType: form.majorityType,
        };
      }
      if (form.id) {
        await api(
          `/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/agenda-items/${form.id}`,
          { method: 'PATCH', body },
        );
      } else {
        await api(`/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/agenda-items`, {
          method: 'POST',
          body,
        });
      }
      setDialogOpen(false);
      fetchMeeting();
    } catch {
      setError(t('meetings.agenda.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (itemId: string) => {
    if (!selectedCoop || !meeting) return;
    if (!confirm(t('meetings.agenda.deleteConfirm'))) return;
    setDeletingId(itemId);
    try {
      await api(
        `/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/agenda-items/${itemId}`,
        { method: 'DELETE' },
      );
      fetchMeeting();
    } catch {
      setError(t('meetings.agenda.deleteError'));
    } finally {
      setDeletingId(null);
    }
  };

  const swapOrder = async (idx: number, direction: 'up' | 'down') => {
    if (!selectedCoop || !meeting?.agendaItems) return;
    const items = [...meeting.agendaItems].sort((a, b) => a.order - b.order);
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= items.length) return;
    const a = items[idx];
    const b = items[targetIdx];
    try {
      await Promise.all([
        api(
          `/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/agenda-items/${a.id}`,
          { method: 'PATCH', body: { order: b.order } },
        ),
        api(
          `/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/agenda-items/${b.id}`,
          { method: 'PATCH', body: { order: a.order } },
        ),
      ]);
      fetchMeeting();
    } catch {
      setError(t('meetings.agenda.saveError'));
    }
  };

  const handleUpload = async (itemId: string, file: File) => {
    if (!selectedCoop || !meeting) return;
    setUploadingFor(itemId);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await apiFetch(
        `/admin/coops/${selectedCoop.id}/meetings/${meeting.id}/agenda-items/${itemId}/attachments`,
        { method: 'POST', body: fd },
      );
      fetchMeeting();
    } catch {
      setError(t('meetings.agenda.uploadError'));
    } finally {
      setUploadingFor(null);
    }
  };

  if (!selectedCoop) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t('admin.selectCoop')}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse h-8 w-64 bg-muted rounded" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="animate-pulse h-24 bg-muted rounded-lg" />
        ))}
      </div>
    );
  }

  if (!meeting) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error || t('meetings.detail.notFound')}</AlertDescription>
      </Alert>
    );
  }

  const items = (meeting.agendaItems ?? []).slice().sort((a, b) => a.order - b.order);

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

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('meetings.agenda.heading')}</h1>
          <p className="text-sm text-muted-foreground">{meeting.title}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t('meetings.agenda.addItem')}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t('meetings.agenda.empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item, idx) => {
            const isExpanded = !!expanded[item.id];
            return (
              <Card key={item.id}>
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        disabled={idx === 0}
                        onClick={() => swapOrder(idx, 'up')}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <span className="text-sm font-semibold text-muted-foreground">
                        {item.order}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        disabled={idx === items.length - 1}
                        onClick={() => swapOrder(idx, 'down')}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div>
                          <CardTitle className="text-base">{item.title}</CardTitle>
                          <Badge variant="outline" className="mt-1">
                            {t(`meetings.agenda.${item.type.toLowerCase()}` as 'meetings.agenda.informational')}
                          </Badge>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setExpanded((e) => ({ ...e, [item.id]: !e[item.id] }))
                            }
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(item)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={deletingId === item.id}
                            onClick={() => handleDelete(item.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                {(isExpanded || item.description) && (
                  <CardContent className="space-y-3 text-sm">
                    {item.description && (
                      <p className="text-muted-foreground whitespace-pre-wrap">
                        {item.description}
                      </p>
                    )}
                    {isExpanded && item.resolution && (
                      <div className="space-y-2 pt-2 border-t">
                        <div>
                          <Label className="text-xs">
                            {t('meetings.agenda.resolutionTextLabel')}
                          </Label>
                          <p className="whitespace-pre-wrap">
                            {item.resolution.proposedText}
                          </p>
                        </div>
                        <div>
                          <Label className="text-xs">
                            {t('meetings.agenda.majorityLabel')}
                          </Label>
                          <p>
                            {t(
                              `meetings.agenda.${camelCaseMajority(item.resolution.majorityType)}` as 'meetings.agenda.simple',
                            )}
                          </p>
                        </div>
                      </div>
                    )}
                    {isExpanded && (
                      <div className="space-y-2 pt-2 border-t">
                        <Label className="text-xs flex items-center gap-2">
                          <Paperclip className="h-3 w-3" />
                          {t('meetings.agenda.attachments')}{' '}
                          ({item.attachments?.length ?? 0})
                        </Label>
                        <ul className="space-y-1">
                          {item.attachments?.map((a) => (
                            <li key={a.id} className="text-xs">
                              <a
                                href={a.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:underline"
                              >
                                {a.fileName}
                              </a>
                            </li>
                          ))}
                        </ul>
                        <div>
                          <input
                            ref={(el) => {
                              fileInputs.current[item.id] = el;
                            }}
                            type="file"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleUpload(item.id, f);
                              e.target.value = '';
                            }}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={uploadingFor === item.id}
                            onClick={() => fileInputs.current[item.id]?.click()}
                          >
                            <Upload className="h-3 w-3 mr-2" />
                            {uploadingFor === item.id
                              ? t('common.loading')
                              : t('meetings.agenda.uploadAttachment')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form.id ? t('meetings.agenda.editItem') : t('meetings.agenda.addItem')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-[100px_1fr] gap-4">
              <div className="space-y-2">
                <Label>{t('meetings.agenda.orderLabel')}</Label>
                <Input
                  type="number"
                  value={form.order}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, order: Number(e.target.value) || 1 }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t('meetings.agenda.typeLabel')}</Label>
                <Select
                  value={form.type}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, type: v as AgendaType }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INFORMATIONAL">
                      {t('meetings.agenda.informational')}
                    </SelectItem>
                    <SelectItem value="RESOLUTION">
                      {t('meetings.agenda.resolution')}
                    </SelectItem>
                    <SelectItem value="ELECTION">
                      {t('meetings.agenda.election')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('meetings.agenda.titleLabel')}</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('meetings.agenda.descriptionLabel')}</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>

            {form.type !== 'INFORMATIONAL' && (
              <>
                <div className="space-y-2">
                  <Label>{t('meetings.agenda.resolutionTextLabel')}</Label>
                  <Textarea
                    rows={3}
                    value={form.proposedText}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, proposedText: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('meetings.agenda.majorityLabel')}</Label>
                  <Select
                    value={form.majorityType}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, majorityType: v as MajorityType }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SIMPLE">
                        {t('meetings.agenda.simple')}
                      </SelectItem>
                      <SelectItem value="TWO_THIRDS">
                        {t('meetings.agenda.twoThirds')}
                      </SelectItem>
                      <SelectItem value="THREE_QUARTERS">
                        {t('meetings.agenda.threeQuarters')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function camelCaseMajority(m: MajorityType): string {
  switch (m) {
    case 'SIMPLE':
      return 'simple';
    case 'TWO_THIRDS':
      return 'twoThirds';
    case 'THREE_QUARTERS':
      return 'threeQuarters';
  }
}
