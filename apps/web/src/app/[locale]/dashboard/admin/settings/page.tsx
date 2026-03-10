'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations, useLocale as useIntlLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useAdmin } from '@/contexts/admin-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
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
import { api } from '@/lib/api';
import {
  Info,
  AlertTriangle,
  Link2,
  Copy,
  Check,
  Layers,
  ChevronRight,
  Landmark,
} from 'lucide-react';
import { Link } from '@/i18n/routing';

type EmailProvider = 'platform' | 'smtp' | 'graph';

interface FormState {
  name: string;
  requiresApproval: boolean;
  minimumHoldingPeriod: string;
  bankName: string;
  bankIban: string;
  bankBic: string;
  termsUrl: string;
  emailEnabled: boolean;
  emailProvider: EmailProvider;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  graphClientId: string;
  graphClientSecret: string;
  graphTenantId: string;
  graphFromEmail: string;
  ecoPowerEnabled: boolean;
  ecoPowerMinThresholdType: string;
  ecoPowerMinThreshold: string;
}

interface SettingsResponse {
  name: string;
  requiresApproval: boolean;
  minimumHoldingPeriod: number;
  bankName: string | null;
  bankIban: string | null;
  bankBic: string | null;
  termsUrl: string | null;
  emailEnabled: boolean;
  emailProvider: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpFrom: string | null;
  graphClientId: string | null;
  graphTenantId: string | null;
  graphFromEmail: string | null;
  ecoPowerEnabled: boolean;
  ecoPowerMinThresholdType: string | null;
  ecoPowerMinThreshold: number | null;
  apiKeyPrefix: string | null;
}

interface PontoConnection {
  id: string;
  status: string;
  iban: string | null;
  bankName: string | null;
  lastSyncAt: string | null;
  authExpiresAt: string | null;
  createdAt: string;
}

interface PontoStatus {
  pontoEnabled: boolean;
  autoMatchPayments: boolean;
  connection: PontoConnection | null;
}

function toEmailProvider(value: string | null): EmailProvider {
  if (value === 'smtp') return 'smtp';
  if (value === 'graph') return 'graph';
  return 'platform';
}

function maskIban(iban: string): string {
  if (!iban || iban.length < 8) return iban || '';
  return `${iban.slice(0, 4)} **** **** ${iban.slice(-4)}`;
}

function formatRelativeTime(dateString: string, locale: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (diffDay > 0) return rtf.format(-diffDay, 'day');
  if (diffHr > 0) return rtf.format(-diffHr, 'hour');
  if (diffMin > 0) return rtf.format(-diffMin, 'minute');
  return rtf.format(-diffSec, 'second');
}

function getDaysUntilExpiry(dateString: string): number {
  const expiry = new Date(dateString);
  const now = new Date();
  return Math.ceil((expiry.getTime() - now.getTime()) / 86400000);
}

export default function AdminSettingsPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const intlLocale = useIntlLocale();
  const searchParams = useSearchParams();

  // Settings form state
  const [form, setForm] = useState<FormState>({
    name: '',
    requiresApproval: true,
    minimumHoldingPeriod: '0',
    bankName: '',
    bankIban: '',
    bankBic: '',
    termsUrl: '',
    emailEnabled: true,
    emailProvider: 'platform',
    smtpHost: '',
    smtpPort: '',
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    graphClientId: '',
    graphClientSecret: '',
    graphTenantId: '',
    graphFromEmail: '',
    ecoPowerEnabled: false,
    ecoPowerMinThresholdType: 'EURO',
    ecoPowerMinThreshold: '',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);

  // Shareholder links state
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  // Ponto state
  const [pontoStatus, setPontoStatus] = useState<PontoStatus | null>(null);
  const [pontoLoading, setPontoLoading] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);

  // Ecopower API key state
  const [apiKeyPrefix, setApiKeyPrefix] = useState<string | null>(null);
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      try {
        const parsed = JSON.parse(userData);
        setIsSystemAdmin(parsed.role === 'SYSTEM_ADMIN');
      } catch {
        // ignore
      }
    }
  }, []);

  const showMessage = useCallback((msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  }, []);

  // Handle ?ponto=connected or ?ponto=error query params
  useEffect(() => {
    const pontoParam = searchParams.get('ponto');
    if (pontoParam === 'connected') {
      showMessage(t('admin.settings.pontoConnected'));
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete('ponto');
      window.history.replaceState({}, '', url.toString());
    } else if (pontoParam === 'error') {
      setError(t('admin.settings.pontoError'));
      const url = new URL(window.location.href);
      url.searchParams.delete('ponto');
      url.searchParams.delete('reason');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams, showMessage, t]);

  useEffect(() => {
    if (!selectedCoop) return;
    setLoading(true);

    Promise.all([
      api<SettingsResponse>(`/admin/coops/${selectedCoop.id}/settings`),
      api<PontoStatus>(`/admin/coops/${selectedCoop.id}/ponto/status`).catch(() => null),
    ])
      .then(([settings, ponto]) => {
        setForm({
          name: settings.name || '',
          requiresApproval: settings.requiresApproval,
          minimumHoldingPeriod: (settings.minimumHoldingPeriod || 0).toString(),
          bankName: settings.bankName || '',
          bankIban: settings.bankIban || '',
          bankBic: settings.bankBic || '',
          termsUrl: settings.termsUrl || '',
          emailEnabled: settings.emailEnabled,
          emailProvider: toEmailProvider(settings.emailProvider),
          smtpHost: settings.smtpHost || '',
          smtpPort: settings.smtpPort?.toString() || '',
          smtpUser: settings.smtpUser || '',
          smtpPass: '',
          smtpFrom: settings.smtpFrom || '',
          graphClientId: settings.graphClientId || '',
          graphClientSecret: '',
          graphTenantId: settings.graphTenantId || '',
          graphFromEmail: settings.graphFromEmail || '',
          ecoPowerEnabled: settings.ecoPowerEnabled || false,
          ecoPowerMinThresholdType: settings.ecoPowerMinThresholdType || 'EURO',
          ecoPowerMinThreshold: settings.ecoPowerMinThreshold?.toString() || '',
        });
        setApiKeyPrefix(settings.apiKeyPrefix || null);
        if (ponto) {
          setPontoStatus(ponto);
        }
      })
      .catch(() => {
        setError(t('admin.settings.error'));
      })
      .finally(() => setLoading(false));
  }, [selectedCoop, t]);

  const handleSave = async () => {
    if (!selectedCoop) return;
    setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        requiresApproval: form.requiresApproval,
        minimumHoldingPeriod: parseInt(form.minimumHoldingPeriod, 10) || 0,
        bankName: form.bankName,
        bankIban: form.bankIban,
        bankBic: form.bankBic,
        termsUrl: form.termsUrl,
        emailProvider: form.emailProvider === 'platform' ? null : form.emailProvider,
        ecoPowerEnabled: form.ecoPowerEnabled,
        ecoPowerMinThresholdType: form.ecoPowerEnabled ? form.ecoPowerMinThresholdType : null,
        ecoPowerMinThreshold: form.ecoPowerEnabled ? (parseFloat(form.ecoPowerMinThreshold) || null) : null,
      };

      if (isSystemAdmin) {
        body.emailEnabled = form.emailEnabled;
      }

      if (form.emailProvider === 'smtp') {
        body.smtpHost = form.smtpHost;
        body.smtpPort = form.smtpPort ? parseInt(form.smtpPort, 10) : undefined;
        body.smtpUser = form.smtpUser;
        body.smtpFrom = form.smtpFrom;
        if (form.smtpPass) body.smtpPass = form.smtpPass;
      }

      if (form.emailProvider === 'graph') {
        body.graphClientId = form.graphClientId;
        body.graphTenantId = form.graphTenantId;
        body.graphFromEmail = form.graphFromEmail;
        if (form.graphClientSecret) body.graphClientSecret = form.graphClientSecret;
      }

      await api(`/admin/coops/${selectedCoop.id}/settings`, { method: 'PUT', body });
      showMessage(t('admin.settings.saved'));
    } catch {
      setError(t('admin.settings.error'));
    }
  };

  const handleCopyLink = async (key: string, url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedLink(key);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  // Ponto handlers
  const handlePontoConnect = async () => {
    if (!selectedCoop) return;
    setPontoLoading(true);
    try {
      const { authorizationUrl } = await api<{ authorizationUrl: string }>(
        `/admin/coops/${selectedCoop.id}/ponto/connect`,
      );
      window.location.href = authorizationUrl;
    } catch {
      setError(t('admin.settings.pontoError'));
      setPontoLoading(false);
    }
  };

  const handlePontoDisconnect = async () => {
    if (!selectedCoop) return;
    setPontoLoading(true);
    setShowDisconnectDialog(false);
    try {
      await api(`/admin/coops/${selectedCoop.id}/ponto/disconnect`, { method: 'POST' });
      setPontoStatus((prev) =>
        prev ? { ...prev, connection: null } : prev,
      );
      showMessage(t('admin.settings.disconnected'));
    } catch {
      setError(t('admin.settings.pontoError'));
    } finally {
      setPontoLoading(false);
    }
  };

  const handlePontoReauthorize = async () => {
    if (!selectedCoop) return;
    setPontoLoading(true);
    try {
      const { authorizationUrl } = await api<{ authorizationUrl: string }>(
        `/admin/coops/${selectedCoop.id}/ponto/reauthorize`,
        { method: 'POST' },
      );
      window.location.href = authorizationUrl;
    } catch {
      setError(t('admin.settings.pontoError'));
      setPontoLoading(false);
    }
  };

  const handleAutoMatchToggle = async (checked: boolean) => {
    if (!selectedCoop) return;
    try {
      await api(`/admin/coops/${selectedCoop.id}/ponto/settings`, {
        method: 'PUT',
        body: { autoMatchPayments: checked },
      });
      setPontoStatus((prev) =>
        prev ? { ...prev, autoMatchPayments: checked } : prev,
      );
    } catch {
      setError(t('admin.settings.error'));
    }
  };

  const handleRegenerateApiKey = async () => {
    if (!selectedCoop) return;
    setShowRegenerateConfirm(false);
    try {
      const { apiKey } = await api<{ apiKey: string }>(
        `/admin/coops/${selectedCoop.id}/api-key/regenerate`,
        { method: 'POST' },
      );
      setNewApiKey(apiKey);
      setShowApiKeyDialog(true);
      setApiKeyPrefix(apiKey.substring(0, 8));
    } catch {
      setError(t('admin.settings.error'));
    }
  };

  if (!selectedCoop) return <p className="text-muted-foreground">{t('admin.selectCoop')}</p>;

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const emailDisabled = !form.emailEnabled;

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const coopBasePath = `${baseUrl}/${intlLocale}/${selectedCoop.slug}`;
  const shareholderLinks = [
    { key: 'publicPage', url: coopBasePath },
    { key: 'registrationLink', url: `${coopBasePath}/default/register` },
    { key: 'loginLink', url: `${coopBasePath}/login` },
  ];

  // Ponto expiry calculations
  const connection = pontoStatus?.connection;
  const isExpired = connection?.status === 'EXPIRED';
  const daysUntilExpiry =
    connection?.authExpiresAt && !isExpired
      ? getDaysUntilExpiry(connection.authExpiresAt)
      : null;
  const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry <= 7 && daysUntilExpiry > 0;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">{t('common.settings')}</h1>
      {message && (
        <Alert className="mb-4">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Ponto expiry/expired banner */}
      {pontoStatus?.pontoEnabled && isExpired && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{t('admin.settings.connectionExpired')}</AlertDescription>
        </Alert>
      )}
      {pontoStatus?.pontoEnabled && isExpiringSoon && (
        <Alert className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {t('admin.settings.connectionExpiring', { days: daysUntilExpiry })}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-6">
        {/* Shareholder Links */}
        <Card>
          <CardHeader className="flex flex-row items-center space-y-0">
            <Link2 className="h-5 w-5 text-muted-foreground mr-2" />
            <CardTitle>{t('admin.shareholderLinks')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {shareholderLinks.map(({ key, url }) => (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t(`admin.${key}`)}</p>
                  <p className="text-xs text-muted-foreground truncate">{url}</p>
                </div>
                <button
                  onClick={() => handleCopyLink(key, url)}
                  className="shrink-0 rounded-md p-1.5 hover:bg-muted transition-colors"
                  title={copiedLink === key ? t('admin.copied') : 'Copy'}
                >
                  {copiedLink === key ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Channels (Branding & Registration) */}
        <Link href="/dashboard/admin/settings/channels" className="block">
          <Card className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <Layers className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1">
                  <p className="font-semibold">{t('admin.channels.title')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('admin.channels.settingsDescription')}
                  </p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* General Settings */}
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.settings.general')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>{t('common.name')}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={form.requiresApproval}
                onCheckedChange={(c) => setForm({ ...form, requiresApproval: !!c })}
              />
              <Label>{t('admin.settings.requiresApproval')}</Label>
            </div>
            <div>
              <Label>{t('admin.settings.termsUrl')}</Label>
              <Input
                value={form.termsUrl}
                onChange={(e) => setForm({ ...form, termsUrl: e.target.value })}
                placeholder="https://..."
              />
            </div>
            <div>
              <Label>{t('admin.settings.minHoldingPeriod')}</Label>
              <Input
                type="number"
                min={0}
                value={form.minimumHoldingPeriod}
                onChange={(e) => setForm({ ...form, minimumHoldingPeriod: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Bank Details */}
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.settings.bankDetails')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>{t('admin.settings.bankName')}</Label>
              <Input
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
              />
            </div>
            <div>
              <Label>IBAN</Label>
              <Input
                value={form.bankIban}
                onChange={(e) => setForm({ ...form, bankIban: e.target.value })}
              />
            </div>
            <div>
              <Label>BIC</Label>
              <Input
                value={form.bankBic}
                onChange={(e) => setForm({ ...form, bankBic: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Bank Connection (Ponto) */}
        {pontoStatus?.pontoEnabled && (
          <Card>
            <CardHeader className="flex flex-row items-center space-y-0">
              <Landmark className="h-5 w-5 text-muted-foreground mr-2" />
              <CardTitle>{t('admin.settings.bankConnection')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(!connection || connection.status === 'REVOKED' || connection.status === 'PENDING') && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t('admin.settings.bankConnectionDescription')}
                  </p>
                  <Button onClick={handlePontoConnect} disabled={pontoLoading}>
                    {pontoLoading
                      ? t('admin.settings.connecting')
                      : t('admin.settings.connectBankAccount')}
                  </Button>
                </>
              )}

              {connection && connection.status === 'ACTIVE' && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      {connection.iban && (
                        <p className="text-sm font-medium font-mono">
                          {maskIban(connection.iban)}
                        </p>
                      )}
                      {connection.bankName && (
                        <p className="text-sm text-muted-foreground">{connection.bankName}</p>
                      )}
                    </div>
                    <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-100">
                      {t('admin.settings.connected')}
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {t('admin.settings.lastSync')}:{' '}
                    {connection.lastSyncAt
                      ? formatRelativeTime(connection.lastSyncAt, intlLocale)
                      : t('admin.settings.never')}
                  </p>

                  <div className="flex items-start gap-3 rounded-md border p-3">
                    <Checkbox
                      id="autoMatch"
                      checked={pontoStatus.autoMatchPayments}
                      onCheckedChange={(checked) => handleAutoMatchToggle(!!checked)}
                    />
                    <div className="space-y-1">
                      <Label htmlFor="autoMatch" className="cursor-pointer">
                        {t('admin.settings.autoMatchPayments')}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t('admin.settings.autoMatchDescription')}
                      </p>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    onClick={() => setShowDisconnectDialog(true)}
                    disabled={pontoLoading}
                  >
                    {pontoLoading
                      ? t('admin.settings.disconnecting')
                      : t('admin.settings.disconnectBankAccount')}
                  </Button>
                </>
              )}

              {connection && connection.status === 'EXPIRED' && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      {connection.iban && (
                        <p className="text-sm font-medium font-mono">
                          {maskIban(connection.iban)}
                        </p>
                      )}
                      {connection.bankName && (
                        <p className="text-sm text-muted-foreground">{connection.bankName}</p>
                      )}
                    </div>
                    <Badge variant="destructive">{t('admin.settings.expired')}</Badge>
                  </div>

                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{t('admin.settings.connectionExpired')}</AlertDescription>
                  </Alert>

                  <Button onClick={handlePontoReauthorize} disabled={pontoLoading}>
                    {pontoLoading
                      ? t('admin.settings.connecting')
                      : t('admin.settings.reauthorize')}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Ecopower Integration */}
        <Card>
          <CardHeader>
            <CardTitle>{t('ecopower.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('ecopower.description')}</p>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={form.ecoPowerEnabled}
                onCheckedChange={(c) => setForm({ ...form, ecoPowerEnabled: !!c })}
              />
              <Label>{t('ecopower.enabled')}</Label>
            </div>

            {form.ecoPowerEnabled && (
              <div className="space-y-4 pl-6 border-l-2 border-muted">
                <div>
                  <Label>{t('ecopower.thresholdType')}</Label>
                  <Select
                    value={form.ecoPowerMinThresholdType}
                    onValueChange={(v) => setForm({ ...form, ecoPowerMinThresholdType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EURO">{t('ecopower.thresholdTypeEuro')}</SelectItem>
                      <SelectItem value="SHARES">{t('ecopower.thresholdTypeShares')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t('ecopower.thresholdValue')}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.ecoPowerMinThreshold}
                    onChange={(e) => setForm({ ...form, ecoPowerMinThreshold: e.target.value })}
                    placeholder={
                      form.ecoPowerMinThresholdType === 'EURO'
                        ? t('ecopower.thresholdValueHintEuro')
                        : t('ecopower.thresholdValueHintShares')
                    }
                  />
                </div>

                {/* API Key Section */}
                <div className="pt-4 border-t">
                  <Label className="text-base font-semibold">{t('ecopower.apiKey')}</Label>
                  <p className="text-sm text-muted-foreground mt-1">{t('ecopower.apiKeyDescription')}</p>
                  {apiKeyPrefix ? (
                    <p className="text-sm font-mono mt-2">{apiKeyPrefix}{'••••••••••••••••'}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-2">{t('ecopower.noApiKey')}</p>
                  )}
                  <Button
                    variant="outline"
                    className="mt-2"
                    onClick={() => apiKeyPrefix ? setShowRegenerateConfirm(true) : handleRegenerateApiKey()}
                  >
                    {t('ecopower.regenerateApiKey')}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Email Settings */}
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.settings.email')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isSystemAdmin && (
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={form.emailEnabled}
                  onCheckedChange={(c) => setForm({ ...form, emailEnabled: !!c })}
                />
                <Label>{t('admin.settings.emailEnabled')}</Label>
              </div>
            )}

            {emailDisabled && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{t('admin.settings.emailDisabledWarning')}</AlertDescription>
              </Alert>
            )}

            <div className={emailDisabled ? 'opacity-50 pointer-events-none' : ''}>
              <div className="space-y-4">
                <div>
                  <Label>{t('admin.settings.emailProvider')}</Label>
                  <Select
                    value={form.emailProvider}
                    onValueChange={(v) => setForm({ ...form, emailProvider: v as EmailProvider })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="platform">
                        {t('admin.settings.emailProviderPlatform')}
                      </SelectItem>
                      <SelectItem value="smtp">
                        {t('admin.settings.emailProviderSmtp')}
                      </SelectItem>
                      <SelectItem value="graph">
                        {t('admin.settings.emailProviderGraph')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.emailProvider === 'platform' && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>{t('admin.settings.platformDescription')}</AlertDescription>
                  </Alert>
                )}

                {form.emailProvider === 'smtp' && (
                  <div className="space-y-4">
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>{t('admin.settings.smtpDescription')}</AlertDescription>
                    </Alert>
                    <div>
                      <Label>{t('admin.settings.smtpHost')}</Label>
                      <Input
                        value={form.smtpHost}
                        onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
                        placeholder="smtp.example.com"
                      />
                    </div>
                    <div>
                      <Label>{t('admin.settings.smtpPort')}</Label>
                      <Input
                        type="number"
                        value={form.smtpPort}
                        onChange={(e) => setForm({ ...form, smtpPort: e.target.value })}
                        placeholder="587"
                      />
                    </div>
                    <div>
                      <Label>{t('admin.settings.smtpUser')}</Label>
                      <Input
                        value={form.smtpUser}
                        onChange={(e) => setForm({ ...form, smtpUser: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>{t('admin.settings.smtpPass')}</Label>
                      <Input
                        type="password"
                        value={form.smtpPass}
                        onChange={(e) => setForm({ ...form, smtpPass: e.target.value })}
                        placeholder={t('admin.settings.smtpPassPlaceholder')}
                      />
                    </div>
                    <div>
                      <Label>{t('admin.settings.smtpFrom')}</Label>
                      <Input
                        value={form.smtpFrom}
                        onChange={(e) => setForm({ ...form, smtpFrom: e.target.value })}
                        placeholder="noreply@example.com"
                      />
                    </div>
                  </div>
                )}

                {form.emailProvider === 'graph' && (
                  <div className="space-y-4">
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription>
                        <p>{t('admin.settings.graphDescription')}</p>
                        <p className="mt-2 text-xs">{t('admin.settings.graphSetupInstructions')}</p>
                      </AlertDescription>
                    </Alert>
                    <div>
                      <Label>{t('admin.settings.graphClientId')}</Label>
                      <Input
                        value={form.graphClientId}
                        onChange={(e) => setForm({ ...form, graphClientId: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>{t('admin.settings.graphClientSecret')}</Label>
                      <Input
                        type="password"
                        value={form.graphClientSecret}
                        onChange={(e) => setForm({ ...form, graphClientSecret: e.target.value })}
                        placeholder={t('admin.settings.graphClientSecretPlaceholder')}
                      />
                    </div>
                    <div>
                      <Label>{t('admin.settings.graphTenantId')}</Label>
                      <Input
                        value={form.graphTenantId}
                        onChange={(e) => setForm({ ...form, graphTenantId: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>{t('admin.settings.graphFromEmail')}</Label>
                      <Input
                        type="email"
                        value={form.graphFromEmail}
                        onChange={(e) => setForm({ ...form, graphFromEmail: e.target.value })}
                        placeholder="noreply@yourdomain.com"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleSave}>{t('common.save')}</Button>
      </div>

      {/* API Key Regenerate Confirmation */}
      <Dialog open={showRegenerateConfirm} onOpenChange={setShowRegenerateConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ecopower.regenerateApiKey')}</DialogTitle>
            <DialogDescription>{t('ecopower.regenerateConfirm')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRegenerateConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleRegenerateApiKey}>
              {t('ecopower.regenerateApiKey')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New API Key Display */}
      <Dialog
        open={showApiKeyDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowApiKeyDialog(false);
            setNewApiKey('');
            setApiKeyCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('ecopower.apiKey')}</DialogTitle>
            <DialogDescription>{t('ecopower.apiKeyCopied')}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
            <code className="text-sm flex-1 break-all">{newApiKey}</code>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(newApiKey);
                setApiKeyCopied(true);
              }}
              className="shrink-0 rounded-md p-1.5 hover:bg-background transition-colors"
            >
              {apiKeyCopied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setShowApiKeyDialog(false);
                setNewApiKey('');
                setApiKeyCopied(false);
              }}
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disconnect confirmation dialog */}
      <Dialog open={showDisconnectDialog} onOpenChange={setShowDisconnectDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.settings.disconnectBankAccount')}</DialogTitle>
            <DialogDescription>{t('admin.settings.confirmDisconnect')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisconnectDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handlePontoDisconnect}>
              {t('admin.settings.disconnectBankAccount')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
