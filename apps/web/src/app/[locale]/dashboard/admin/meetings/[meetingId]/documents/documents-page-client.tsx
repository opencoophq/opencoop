'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeft, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { api } from '@/lib/api';
import { useAdmin } from '@/contexts/admin-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { toggleColumnSort, type ColumnSortState } from '@/lib/table-utils';

type MeetingDoc = {
  id: string;
  fileName: string;
  fileSize: number;
  order: number;
};

type EmailDraft = {
  subject: string | null;
  intro: string | null;
  sentAt: string | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
};

type EmailPreview = {
  subject: string;
  html: string;
  recipientEmail: string | null;
  shareholderName: string;
};

type AttendanceStatus = {
  shareholderName: string;
  documentsEmailSentAt: string | null;
  documentsEmailError: string | null;
  documentsEmailOpenedAt: string | null;
  documentsDownloadedAt: string | null;
};

export function DocumentsPageClient() {
  const t = useTranslations('meetings.documents');
  const params = useParams();
  const meetingId = (params?.meetingId as string) || '';
  const { selectedCoop } = useAdmin();

  const [docs, setDocs] = useState<MeetingDoc[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDocs = useCallback(async () => {
    if (!selectedCoop || !meetingId) return;
    setLoading(true);
    try {
      const data = await api<MeetingDoc[]>(
        `/admin/coops/${selectedCoop.id}/meetings/${meetingId}/documents`,
      );
      setDocs(data);
    } finally {
      setLoading(false);
    }
  }, [selectedCoop, meetingId]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  if (!selectedCoop) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Select a coop first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/dashboard/admin/meetings/${meetingId}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('backToMeeting')}
          </Link>
        </Button>
      </div>
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </header>

      <DocumentList
        docs={docs}
        setDocs={setDocs}
        loading={loading}
        coopId={selectedCoop.id}
        meetingId={meetingId}
        onChange={fetchDocs}
      />
      <MailDraftSection
        coopId={selectedCoop.id}
        meetingId={meetingId}
        hasDocuments={docs.length > 0}
      />
      <StatusTable coopId={selectedCoop.id} meetingId={meetingId} />
    </div>
  );
}

function DocumentList({
  docs,
  setDocs,
  loading,
  coopId,
  meetingId,
  onChange,
}: {
  docs: MeetingDoc[];
  setDocs: React.Dispatch<React.SetStateAction<MeetingDoc[]>>;
  loading: boolean;
  coopId: string;
  meetingId: string;
  onChange: () => void;
}) {
  const t = useTranslations('meetings.documents');
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    const errors: string[] = [];
    for (const f of files) {
      try {
        const fd = new FormData();
        fd.append('file', f);
        await api(`/admin/coops/${coopId}/meetings/${meetingId}/documents`, {
          method: 'POST',
          body: fd,
        });
      } catch (err) {
        errors.push(`${f.name}: ${(err as Error).message ?? 'upload failed'}`);
      }
    }
    setUploading(false);
    e.target.value = '';
    if (errors.length > 0) {
      alert(`Sommige bestanden konden niet worden geüpload:\n\n${errors.join('\n')}`);
    }
    onChange();
  };

  const handleRename = async (id: string, displayName: string) => {
    try {
      await api(`/admin/coops/${coopId}/meetings/${meetingId}/documents/${id}`, {
        method: 'PATCH',
        body: { displayName },
      });
      onChange();
    } catch (err: unknown) {
      alert((err as Error)?.message || 'Er ging iets mis');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('confirmDelete'))) return;
    try {
      await api(`/admin/coops/${coopId}/meetings/${meetingId}/documents/${id}`, {
        method: 'DELETE',
      });
      onChange();
    } catch (err: unknown) {
      alert((err as Error)?.message || 'Er ging iets mis');
    }
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = docs.findIndex((d) => d.id === e.active.id);
    const newIdx = docs.findIndex((d) => d.id === e.over!.id);
    const reordered = arrayMove(docs, oldIdx, newIdx);
    // Optimistic update
    setDocs(reordered);
    // Persist changed orders
    await Promise.all(
      reordered
        .map((d, idx) => ({ ...d, newOrder: idx }))
        .filter((d) => d.order !== d.newOrder)
        .map((d) =>
          api(`/admin/coops/${coopId}/meetings/${meetingId}/documents/${d.id}`, {
            method: 'PATCH',
            body: { order: d.newOrder },
          }),
        ),
    );
    // Sync server state (updates `order` fields on docs)
    onChange();
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">{t('title')}</h2>
      {loading ? (
        <div className="animate-pulse h-20 rounded bg-muted" />
      ) : (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={docs.map((d) => d.id)} strategy={verticalListSortingStrategy}>
            <ul className="divide-y rounded border">
              {docs.map((d) => (
                <SortableRow
                  key={d.id}
                  doc={d}
                  onRename={handleRename}
                  onDelete={handleDelete}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <span>{uploading ? '...' : t('uploadCta')}</span>
        <input
          type="file"
          accept=".pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          multiple
          className="hidden"
          disabled={uploading}
          onChange={handleFileChange}
        />
      </label>
    </section>
  );
}

function SortableRow({
  doc,
  onRename,
  onDelete,
}: {
  doc: MeetingDoc;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations('meetings.documents');
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: doc.id,
  });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(doc.fileName);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex items-center gap-3 border-b p-3 last:border-b-0"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab text-muted-foreground"
        aria-label="reorder"
      >
        ⋮⋮
      </button>
      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (name.trim() && name !== doc.fileName) onRename(doc.id, name.trim());
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="flex-1 rounded border px-2 py-1 text-sm"
        />
      ) : (
        <button
          className="flex-1 text-left text-sm hover:underline"
          onClick={() => setEditing(true)}
          title={t('rename')}
        >
          {doc.fileName}
        </button>
      )}
      <span className="text-sm text-muted-foreground">{formatSize(doc.fileSize)}</span>
      <button
        onClick={() => onDelete(doc.id)}
        className="text-sm text-red-600 hover:text-red-800"
      >
        {t('delete')}
      </button>
    </li>
  );
}

function MailDraftSection({
  coopId,
  meetingId,
  hasDocuments,
}: {
  coopId: string;
  meetingId: string;
  hasDocuments: boolean;
}) {
  const t = useTranslations('meetings.documents');
  const [data, setData] = useState<EmailDraft | null>(null);
  const [subject, setSubject] = useState('');
  const [intro, setIntro] = useState('');
  const [sending, setSending] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [firstShareholderId, setFirstShareholderId] = useState<string | null>(null);

  const fetchDraft = useCallback(async () => {
    const d = await api<EmailDraft>(
      `/admin/coops/${coopId}/meetings/${meetingId}/documents-email`,
    );
    setData(d);
    setSubject(d.subject ?? '');
    setIntro(d.intro ?? '');
    // Fetch first shareholder to enable email preview
    try {
      const sh = await api<{ items: Array<{ id: string }> }>(
        `/admin/coops/${coopId}/shareholders?pageSize=1&page=1`,
      );
      setFirstShareholderId(sh.items?.[0]?.id ?? null);
    } catch {
      setFirstShareholderId(null);
    }
  }, [coopId, meetingId]);

  useEffect(() => {
    fetchDraft();
  }, [fetchDraft]);

  // Sync contentEditable when intro state changes from outside (initial load)
  useEffect(() => {
    if (!editorRef.current) return;
    if (document.activeElement === editorRef.current) return;
    if (editorRef.current.innerHTML === intro) return;
    const parsed = new DOMParser().parseFromString(intro, 'text/html');
    editorRef.current.replaceChildren(...Array.from(parsed.body.childNodes));
  }, [intro]);

  // Load initial preview once shareholder is known
  useEffect(() => {
    if (!firstShareholderId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const p = await api<EmailPreview>(
          `/admin/coops/${coopId}/meetings/${meetingId}/documents-email/preview?shareholderId=${firstShareholderId}`,
        );
        if (!cancelled) setPreview(p);
      } catch {
        // ignore — preview is best-effort
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [coopId, meetingId, firstShareholderId]);

  const saveDraft = async () => {
    setSaving(true);
    try {
      await api(`/admin/coops/${coopId}/meetings/${meetingId}/documents-email`, {
        method: 'PATCH',
        body: { subject, intro },
      });
      setSavedAt(new Date());
      // Reload preview so it reflects the saved state
      if (firstShareholderId) {
        try {
          const p = await api<EmailPreview>(
            `/admin/coops/${coopId}/meetings/${meetingId}/documents-email/preview?shareholderId=${firstShareholderId}`,
          );
          setPreview(p);
        } catch {
          // Non-fatal — preview is best-effort
        }
      }
    } catch (err: unknown) {
      alert((err as Error)?.message || 'Er ging iets mis');
    } finally {
      setSaving(false);
    }
  };

  const send = async () => {
    const count = data?.recipientCount ?? 0;
    if (!confirm(t('sendConfirm', { count }))) return;
    setSending(true);
    try {
      await api(`/admin/coops/${coopId}/meetings/${meetingId}/documents-email/send`, {
        method: 'POST',
      });
      await fetchDraft();
    } catch (err: unknown) {
      alert((err as Error)?.message || 'Er ging iets mis');
    } finally {
      setSending(false);
    }
  };

  if (!data) return null;

  const canSend = hasDocuments && data.recipientCount > 0;

  return (
    <section className="space-y-4 rounded border p-4">
      <h2 className="text-lg font-medium">{t('subjectLabel')}</h2>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">{t('subjectLabel')}</label>
          <input
            type="text"
            value={subject}
            placeholder={t('subjectPlaceholder')}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">{t('introLabel')}</label>
          {/* contentEditable HTML editor — admin-only, content from our own template renderer */}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => setIntro(e.currentTarget.innerHTML)}
            className="prose prose-sm dark:prose-invert max-w-none w-full rounded border px-3 py-2 text-sm bg-background min-h-[150px] focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {t('htmlEditorHelp')}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={saveDraft}
          disabled={saving}
          className="rounded border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
        >
          {saving ? t('savingIndicator') : t('saveDraftCta')}
        </button>
        {savedAt && !saving && (
          <span className="text-xs text-muted-foreground">
            {t('savedAt', { time: savedAt.toLocaleTimeString() })}
          </span>
        )}
      </div>

      {/* Email preview iframe — content from our own server-side template renderer,
          sandbox="" disables all JavaScript execution */}
      {preview && (
        <div className="space-y-2 rounded border p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {t('previewTitle')}
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Subject:</span>{' '}
            <span className="text-sm font-medium">{preview.subject}</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">To:</span>{' '}
            <span className="text-sm">
              {preview.recipientEmail ?? `(${preview.shareholderName})`}
            </span>
          </div>
          <iframe
            title={t('previewTitle')}
            srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,-apple-system,sans-serif;padding:16px;color:#111}</style></head><body>${preview.html}</body></html>`}
            className="w-full h-96 rounded border bg-white"
            sandbox=""
          />
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {t('recipientCount', { count: data.recipientCount })}
      </p>

      {!data.sentAt && (
        <button
          onClick={send}
          disabled={!canSend || sending}
          className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {sending ? '...' : t('sendCta')}
        </button>
      )}

      {data.sentAt && data.failedCount > 0 && (
        <button
          onClick={send}
          disabled={sending}
          className="rounded bg-destructive px-4 py-2 text-sm text-destructive-foreground disabled:opacity-50"
        >
          {sending ? '...' : t('resendFailed', { count: data.failedCount })}
        </button>
      )}

      {data.sentAt && (
        <p className="text-sm text-muted-foreground">
          {t('sentSummary', {
            date: new Date(data.sentAt).toLocaleDateString(),
            sent: data.sentCount,
            total: data.recipientCount,
          })}
        </p>
      )}
    </section>
  );
}

type StatusColumn = 'name' | 'sent' | 'opened' | 'downloaded';

function StatusTable({ coopId, meetingId }: { coopId: string; meetingId: string }) {
  const t = useTranslations('meetings.documents');
  const [rows, setRows] = useState<AttendanceStatus[]>([]);
  const [columnSort, setColumnSort] = useState<ColumnSortState<StatusColumn>>({ column: 'name', direction: 'asc' });
  const [columnFilters, setColumnFilters] = useState<Partial<Record<StatusColumn, string>>>({});

  useEffect(() => {
    const fetchStatuses = async () => {
      const r = await api<AttendanceStatus[]>(
        `/admin/coops/${coopId}/meetings/${meetingId}/rsvp/attendance-statuses`,
      ).catch(() => [] as AttendanceStatus[]);
      setRows(r);
    };
    fetchStatuses();
    const id = setInterval(fetchStatuses, 10_000);
    return () => clearInterval(id);
  }, [coopId, meetingId]);

  const visibleRows = useMemo(() => {
    let filtered = rows;
    if (columnFilters.name) {
      const q = columnFilters.name.toLowerCase();
      filtered = filtered.filter((r) => r.shareholderName.toLowerCase().includes(q));
    }
    if (columnFilters.sent) {
      const q = columnFilters.sent.toLowerCase();
      filtered = filtered.filter((r) => {
        if (r.documentsEmailError) return `error ${r.documentsEmailError}`.toLowerCase().includes(q);
        if (r.documentsEmailSentAt) return 'sent'.includes(q);
        return ''.includes(q);
      });
    }
    if (columnFilters.opened) {
      const q = columnFilters.opened.toLowerCase();
      filtered = filtered.filter((r) => (r.documentsEmailOpenedAt ? '✓' : '—').includes(q));
    }
    if (columnFilters.downloaded) {
      const q = columnFilters.downloaded.toLowerCase();
      filtered = filtered.filter((r) => (r.documentsDownloadedAt ? '✓' : '—').includes(q));
    }
    const sorted = [...filtered].sort((a, b) => {
      const dir = columnSort.direction === 'asc' ? 1 : -1;
      switch (columnSort.column) {
        case 'name':
          return dir * a.shareholderName.localeCompare(b.shareholderName);
        case 'sent': {
          const av = a.documentsEmailError ? -1 : a.documentsEmailSentAt ? new Date(a.documentsEmailSentAt).getTime() : 0;
          const bv = b.documentsEmailError ? -1 : b.documentsEmailSentAt ? new Date(b.documentsEmailSentAt).getTime() : 0;
          return dir * (av - bv);
        }
        case 'opened': {
          const av = a.documentsEmailOpenedAt ? new Date(a.documentsEmailOpenedAt).getTime() : 0;
          const bv = b.documentsEmailOpenedAt ? new Date(b.documentsEmailOpenedAt).getTime() : 0;
          return dir * (av - bv);
        }
        case 'downloaded': {
          const av = a.documentsDownloadedAt ? new Date(a.documentsDownloadedAt).getTime() : 0;
          const bv = b.documentsDownloadedAt ? new Date(b.documentsDownloadedAt).getTime() : 0;
          return dir * (av - bv);
        }
        default:
          return 0;
      }
    });
    return sorted;
  }, [rows, columnFilters, columnSort]);

  const renderSortIcon = (column: StatusColumn) => {
    if (columnSort.column !== column) return <ArrowUpDown className="h-3 w-3 ml-1 inline" />;
    return columnSort.direction === 'asc'
      ? <ArrowUp className="h-3 w-3 ml-1 inline" />
      : <ArrowDown className="h-3 w-3 ml-1 inline" />;
  };

  if (rows.length === 0) return null;

  const sentOk = rows.filter((r) => r.documentsEmailSentAt && !r.documentsEmailError).length;
  const failed = rows.filter((r) => !!r.documentsEmailError).length;
  const opened = rows.filter((r) => !!r.documentsEmailOpenedAt).length;
  const downloaded = rows.filter((r) => !!r.documentsDownloadedAt).length;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">{t('statusTitle')}</h2>
      <p className="text-sm text-muted-foreground">
        {t('statusSummary', { total: rows.length, sent: sentOk, failed, opened, downloaded })}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Button variant="ghost" size="sm" onClick={() => setColumnSort((p) => toggleColumnSort(p, 'name'))}>
                {t('status.shareholder')}{renderSortIcon('name')}
              </Button>
            </TableHead>
            <TableHead>
              <Button variant="ghost" size="sm" onClick={() => setColumnSort((p) => toggleColumnSort(p, 'sent'))}>
                {t('status.sent')}{renderSortIcon('sent')}
              </Button>
            </TableHead>
            <TableHead>
              <Button variant="ghost" size="sm" onClick={() => setColumnSort((p) => toggleColumnSort(p, 'opened'))}>
                {t('status.opened')}{renderSortIcon('opened')}
              </Button>
            </TableHead>
            <TableHead>
              <Button variant="ghost" size="sm" onClick={() => setColumnSort((p) => toggleColumnSort(p, 'downloaded'))}>
                {t('status.downloaded')}{renderSortIcon('downloaded')}
              </Button>
            </TableHead>
          </TableRow>
          <TableRow>
            <TableHead>
              <Input
                value={columnFilters.name || ''}
                onChange={(e) => setColumnFilters((p) => ({ ...p, name: e.target.value }))}
                placeholder={t('filterPlaceholder')}
                className="h-8"
              />
            </TableHead>
            <TableHead>
              <Input
                value={columnFilters.sent || ''}
                onChange={(e) => setColumnFilters((p) => ({ ...p, sent: e.target.value }))}
                placeholder={t('filterPlaceholder')}
                className="h-8"
              />
            </TableHead>
            <TableHead>
              <Input
                value={columnFilters.opened || ''}
                onChange={(e) => setColumnFilters((p) => ({ ...p, opened: e.target.value }))}
                placeholder={t('filterPlaceholder')}
                className="h-8"
              />
            </TableHead>
            <TableHead>
              <Input
                value={columnFilters.downloaded || ''}
                onChange={(e) => setColumnFilters((p) => ({ ...p, downloaded: e.target.value }))}
                placeholder={t('filterPlaceholder')}
                className="h-8"
              />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((row, idx) => (
            <TableRow key={idx}>
              <TableCell>{row.shareholderName}</TableCell>
              <TableCell>
                {row.documentsEmailError ? (
                  <span className="text-destructive" title={row.documentsEmailError}>
                    ✗ {row.documentsEmailError}
                  </span>
                ) : row.documentsEmailSentAt ? (
                  <span className="text-green-600">✓</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {row.documentsEmailOpenedAt ? (
                  <span className="text-green-600">✓</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {row.documentsDownloadedAt ? (
                  <span className="text-green-600">✓</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
