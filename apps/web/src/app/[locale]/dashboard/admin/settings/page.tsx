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
import { api } from '@/lib/api';

interface FormState {
  name: string;
  requiresApproval: boolean;
  bankName: string;
  bankIban: string;
  bankBic: string;
  termsUrl: string;
  emailProvider: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
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
    emailProvider: '',
    smtpHost: '',
    smtpPort: '',
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
  });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedCoop) return;
    setLoading(true);
    api<Record<string, unknown>>(`/coops/${selectedCoop.slug}/public-info`)
      .then((coop) => {
        setForm((prev) => ({
          ...prev,
          name: (coop.name as string) || '',
          bankName: (coop.bankName as string) || '',
          bankIban: (coop.bankIban as string) || '',
          bankBic: (coop.bankBic as string) || '',
        }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedCoop]);

  const handleSave = async () => {
    if (!selectedCoop) return;
    try {
      await api(`/admin/coops/${selectedCoop.id}/settings`, { method: 'PUT', body: form });
      setMessage(t('common.savedSuccessfully'));
      setTimeout(() => setMessage(''), 3000);
    } catch {
      // ignore
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

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">{t('common.settings')}</h1>
      {message && (
        <Alert className="mb-4">
          <AlertDescription>{message}</AlertDescription>
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
            <div>
              <Label>SMTP Host</Label>
              <Input
                value={form.smtpHost}
                onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
              />
            </div>
            <div>
              <Label>SMTP Port</Label>
              <Input
                type="number"
                value={form.smtpPort}
                onChange={(e) => setForm({ ...form, smtpPort: e.target.value })}
              />
            </div>
            <div>
              <Label>SMTP User</Label>
              <Input
                value={form.smtpUser}
                onChange={(e) => setForm({ ...form, smtpUser: e.target.value })}
              />
            </div>
            <div>
              <Label>SMTP Password</Label>
              <Input
                type="password"
                value={form.smtpPass}
                onChange={(e) => setForm({ ...form, smtpPass: e.target.value })}
              />
            </div>
            <div>
              <Label>From Address</Label>
              <Input
                value={form.smtpFrom}
                onChange={(e) => setForm({ ...form, smtpFrom: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleSave}>{t('common.save')}</Button>
      </div>
    </div>
  );
}
