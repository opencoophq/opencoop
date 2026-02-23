'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { Info, AlertTriangle } from 'lucide-react';

type EmailProvider = 'platform' | 'smtp' | 'graph';

interface FormState {
  name: string;
  requiresApproval: boolean;
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
}

interface SettingsResponse {
  name: string;
  requiresApproval: boolean;
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
}

function toEmailProvider(value: string | null): EmailProvider {
  if (value === 'smtp') return 'smtp';
  if (value === 'graph') return 'graph';
  return 'platform';
}

export default function AdminSettingsPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const [form, setForm] = useState<FormState>({
    name: '',
    requiresApproval: true,
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
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);

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

  useEffect(() => {
    if (!selectedCoop) return;
    setLoading(true);
    api<SettingsResponse>(`/admin/coops/${selectedCoop.id}/settings`)
      .then((settings) => {
        setForm({
          name: settings.name || '',
          requiresApproval: settings.requiresApproval,
          bankName: settings.bankName || '',
          bankIban: settings.bankIban || '',
          bankBic: settings.bankBic || '',
          termsUrl: settings.termsUrl || '',
          emailEnabled: settings.emailEnabled,
          emailProvider: toEmailProvider(settings.emailProvider),
          smtpHost: settings.smtpHost || '',
          smtpPort: settings.smtpPort?.toString() || '',
          smtpUser: settings.smtpUser || '',
          smtpPass: '', // Never pre-populated
          smtpFrom: settings.smtpFrom || '',
          graphClientId: settings.graphClientId || '',
          graphClientSecret: '', // Never pre-populated
          graphTenantId: settings.graphTenantId || '',
          graphFromEmail: settings.graphFromEmail || '',
        });
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
        bankName: form.bankName,
        bankIban: form.bankIban,
        bankBic: form.bankBic,
        termsUrl: form.termsUrl,
        emailProvider: form.emailProvider === 'platform' ? null : form.emailProvider,
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
      setMessage(t('admin.settings.saved'));
      setTimeout(() => setMessage(''), 3000);
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

      <div className="space-y-6">
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
          </CardContent>
        </Card>

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
    </div>
  );
}
