'use client';

import { useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type DnsKey = 'brevo-code' | 'dkim' | 'spf' | 'dmarc';

interface DnsRecord {
  key: DnsKey;
  type: string;
  host: string;
  value: string;
  status: boolean | null;
  merge?: boolean;
  newRecordValue?: string;
  ifMissing?: boolean;
}

export interface SenderDomainState {
  senderDomain: string | null;
  senderFromAddress: string | null;
  senderFromName: string | null;
  senderDomainStatus: string | null;
  senderDomainCheckedAt: string | null;
  senderDomainRecords: unknown;
  senderDomainError: string | null;
}

const ERROR_CODES = [
  'SENDER_DOMAIN_INVALID',
  'SENDER_DOMAIN_FROM_INVALID',
  'SENDER_DOMAIN_FROM_MISMATCH',
  'SENDER_DOMAIN_NOT_SET',
  'SENDER_DOMAIN_UNAVAILABLE',
  'SENDER_DOMAIN_PROVIDER',
  'SENDER_DOMAIN_PLATFORM',
  'SENDER_DOMAIN_CLAIMED',
  'SENDER_DOMAIN_CHANGED',
] as const;

export function SenderDomainCard({
  coopId,
  coopEmail,
  initial,
}: {
  coopId: string;
  coopEmail: string;
  initial: SenderDomainState;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [view, setView] = useState<SenderDomainState>(initial);
  const [domain, setDomain] = useState(initial.senderDomain ?? '');
  const [fromAddress, setFromAddress] = useState(initial.senderFromAddress ?? '');
  const [fromName, setFromName] = useState(initial.senderFromName ?? '');
  const [busy, setBusy] = useState<'save' | 'check' | 'remove' | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const records = readRecords(view.senderDomainRecords);
  const code = records.find((record) => record.key === 'brevo-code');
  const dkim = records.filter((record) => record.key === 'dkim');
  const cnameDkim = dkim.filter((record) => record.type === 'CNAME');
  const otherDkim = dkim.filter((record) => record.type !== 'CNAME');
  const spf = records.find((record) => record.key === 'spf');
  const dmarc = records.find((record) => record.key === 'dmarc');
  const status = view.senderDomainStatus;
  const replyTo = coopEmail.trim();

  async function run(action: 'save' | 'check' | 'remove') {
    setBusy(action);
    setNotice(null);
    try {
      const next =
        action === 'save'
          ? await api<SenderDomainState>(`/admin/coops/${coopId}/sender-domain`, {
              method: 'POST',
              body: {
                domain: domain.trim(),
                fromAddress: fromAddress.trim(),
                fromName: fromName.trim() || undefined,
              },
            })
          : action === 'check'
            ? await api<SenderDomainState>(`/admin/coops/${coopId}/sender-domain/check`, {
                method: 'POST',
              })
            : await api<SenderDomainState>(`/admin/coops/${coopId}/sender-domain`, {
                method: 'DELETE',
              });
      apply(next);
      setNotice({
        text: t(
          action === 'save'
            ? 'admin.settings.senderDomain.saved'
            : action === 'check'
              ? 'admin.settings.senderDomain.checked'
              : 'admin.settings.senderDomain.removed',
        ),
        error: false,
      });
    } catch (error) {
      setNotice({ text: translateError(error, t), error: true });
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  }

  function apply(next: SenderDomainState) {
    setView(next);
    setDomain(next.senderDomain ?? '');
    setFromAddress(next.senderFromAddress ?? '');
    setFromName(next.senderFromName ?? '');
  }

  return (
    <div className="border-t pt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{t('admin.settings.senderDomain.title')}</h3>
        <StatusBadge status={status} label={statusLabel(status, t)} />
      </div>
      <p className="text-sm text-muted-foreground">{t('admin.settings.senderDomain.intro', {
          example: 'Bronsgroen <noreply@bronsgroen.be>',
        })}</p>
      <p className="text-sm text-muted-foreground">
        {t('admin.settings.senderDomain.sameAccount')}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="sender-domain">{t('admin.settings.senderDomain.domain')}</Label>
          <Input
            id="sender-domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="bronsgroen.be"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t('admin.settings.senderDomain.domainHint')}
          </p>
        </div>
        <div>
          <Label htmlFor="sender-from-address">
            {t('admin.settings.senderDomain.fromAddress')}
          </Label>
          <Input
            id="sender-from-address"
            value={fromAddress}
            onChange={(event) => setFromAddress(event.target.value)}
            placeholder="noreply@bronsgroen.be"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t('admin.settings.senderDomain.fromAddressHint')}
          </p>
        </div>
        <div>
          <Label htmlFor="sender-from-name">{t('admin.settings.senderDomain.fromName')}</Label>
          <Input
            id="sender-from-name"
            value={fromName}
            onChange={(event) => setFromName(event.target.value)}
            placeholder="Bronsgroen"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t('admin.settings.senderDomain.fromNameHint')}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => run('save')}
          disabled={busy !== null || !domain.trim() || !fromAddress.trim()}
        >
          {busy === 'save'
            ? t('admin.settings.senderDomain.saving')
            : t('admin.settings.senderDomain.save')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => run('check')}
          disabled={busy !== null || !view.senderDomain}
        >
          {busy === 'check'
            ? t('admin.settings.senderDomain.checking')
            : t('admin.settings.senderDomain.check')}
        </Button>
        {view.senderDomain && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirmRemove(true)}
            disabled={busy !== null}
          >
            {t('admin.settings.senderDomain.remove')}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {t('admin.settings.senderDomain.lastCheck')}:{' '}
        {view.senderDomainCheckedAt
          ? new Date(view.senderDomainCheckedAt).toLocaleString(locale)
          : t('admin.settings.senderDomain.never')}
      </p>

      {view.senderDomainError && (
        <Alert variant={view.senderDomainError === 'PROVIDER_ERROR' ? 'destructive' : 'default'}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{storedError(view.senderDomainError, t)}</AlertDescription>
        </Alert>
      )}

      {notice && (
        <Alert variant={notice.error ? 'destructive' : 'default'}>
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}

      {status === 'verified' && view.senderFromAddress ? (
        <Alert>
          <AlertDescription>
            {replyTo && replyTo.toLowerCase() !== view.senderFromAddress.toLowerCase()
              ? t('admin.settings.senderDomain.verifiedNote', {
                  address: view.senderFromAddress,
                  replyTo,
                })
              : t('admin.settings.senderDomain.verifiedNoteNoReply', {
                  address: view.senderFromAddress,
                })}
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t('admin.settings.senderDomain.fallbackNote')}
        </p>
      )}

      {view.senderDomain ? (
        <div className="space-y-4">
          <div>
            <h4 className="font-medium">{t('admin.settings.senderDomain.stepsTitle')}</h4>
            <p className="text-sm text-muted-foreground mt-1">
              {t('admin.settings.senderDomain.stepsIntro', { domain: view.senderDomain })}
            </p>
          </div>

          <Step
            title={t('admin.settings.senderDomain.stepCodeTitle')}
            body={t('admin.settings.senderDomain.stepCodeBody')}
          >
            {code ? (
              <RecordRow record={code} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('admin.settings.senderDomain.stepCodeWaiting')}
              </p>
            )}
          </Step>

          <Step
            title={t('admin.settings.senderDomain.stepDkimTitle')}
            body={
              cnameDkim.length > 0
                ? t('admin.settings.senderDomain.stepDkimBody')
                : otherDkim.length > 0
                  ? t('admin.settings.senderDomain.stepDkimLegacy')
                  : t('admin.settings.senderDomain.stepDkimWaiting')
            }
          >
            {(cnameDkim.length > 0 ? cnameDkim : otherDkim).map((record) => (
              <RecordRow key={`${record.host}-${record.value}`} record={record} />
            ))}
          </Step>

          <Step
            title={t('admin.settings.senderDomain.stepSpfTitle')}
            body={t('admin.settings.senderDomain.stepSpfBody')}
          >
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{t('admin.settings.senderDomain.spfWarning')}</AlertDescription>
            </Alert>
            {spf && (
              <>
                <RecordRow record={{ ...spf, value: spf.value }} />
                {spf.newRecordValue && (
                  <div className="space-y-1">
                    <p className="text-sm">{t('admin.settings.senderDomain.spfNew')}</p>
                    <RecordRow
                      record={{
                        key: 'spf',
                        type: 'TXT',
                        host: '@',
                        value: spf.newRecordValue,
                        status: null,
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </Step>

          <Step
            title={t('admin.settings.senderDomain.stepDmarcTitle')}
            body={t('admin.settings.senderDomain.stepDmarcBody')}
          >
            {dmarc?.status === true ? (
              <p className="text-sm text-muted-foreground">
                {t('admin.settings.senderDomain.dmarcPresent')}
              </p>
            ) : (
              dmarc && <RecordRow record={dmarc} />
            )}
          </Step>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t('admin.settings.senderDomain.beforeSave')}
        </p>
      )}

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.settings.senderDomain.remove')}</DialogTitle>
            <DialogDescription>{t('admin.settings.senderDomain.removeConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmRemove(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => run('remove')}
              disabled={busy !== null}
            >
              {t('admin.settings.senderDomain.remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Step({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border p-3">
      <h5 className="text-sm font-medium">{title}</h5>
      <p className="text-sm text-muted-foreground">{body}</p>
      {children}
    </section>
  );
}

function RecordRow({ record }: { record: DnsRecord }) {
  const t = useTranslations();
  return (
    <div className="rounded-md bg-muted/60 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{t('admin.settings.senderDomain.type')}</span>
        <code>{record.type}</code>
        {record.status === true && <Badge>{t('admin.settings.senderDomain.recordOk')}</Badge>}
        {record.status === false && (
          <Badge variant="secondary">{t('admin.settings.senderDomain.recordMissing')}</Badge>
        )}
      </div>
      <CopyLine label={t('admin.settings.senderDomain.host')} value={record.host} />
      <CopyLine label={t('admin.settings.senderDomain.value')} value={record.value} />
    </div>
  );
}

function CopyLine({ label, value }: { label: string; value: string }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <code className="block text-xs break-all">{value}</code>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? t('admin.settings.senderDomain.copied') : t('admin.settings.senderDomain.copy')}
      </Button>
    </div>
  );
}

function StatusBadge({ status, label }: { status: string | null; label: string }) {
  const variant =
    status === 'verified' ? 'default' : status === 'failed' ? 'destructive' : 'secondary';
  return <Badge variant={variant}>{label}</Badge>;
}

function statusLabel(status: string | null, t: ReturnType<typeof useTranslations>): string {
  if (status === 'verified') return t('admin.settings.senderDomain.statusVerified');
  if (status === 'pending') return t('admin.settings.senderDomain.statusPending');
  if (status === 'failed') return t('admin.settings.senderDomain.statusFailed');
  return t('admin.settings.senderDomain.statusNone');
}

function storedError(code: string, t: ReturnType<typeof useTranslations>): string {
  if (code === 'DNS_NOT_READY') return t('admin.settings.senderDomain.errors.DNS_NOT_READY');
  if (code === 'PROVIDER_ERROR') return t('admin.settings.senderDomain.errors.PROVIDER_ERROR');
  if (code === 'DOMAIN_MISSING') return t('admin.settings.senderDomain.errors.DOMAIN_MISSING');
  return t('admin.settings.senderDomain.error');
}

function translateError(error: unknown, t: ReturnType<typeof useTranslations>): string {
  const raw = error instanceof Error ? error.message : '';
  if ((ERROR_CODES as readonly string[]).includes(raw)) {
    return t(`admin.settings.senderDomain.errors.${raw}`);
  }
  return t('admin.settings.senderDomain.error');
}

function readRecords(value: unknown): DnsRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isDnsRecord);
}

function isDnsRecord(value: unknown): value is DnsRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    (record.key === 'brevo-code' ||
      record.key === 'dkim' ||
      record.key === 'spf' ||
      record.key === 'dmarc') &&
    typeof record.type === 'string' &&
    typeof record.host === 'string' &&
    typeof record.value === 'string'
  );
}
