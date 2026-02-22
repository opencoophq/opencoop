'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/contexts/admin-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';

interface CoopPublicInfo {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  name?: string;
}

interface FormState {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
}

export default function BrandingPage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const [form, setForm] = useState<FormState>({
    logoUrl: '',
    primaryColor: '#1e40af',
    secondaryColor: '#3b82f6',
  });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedCoop) return;
    setLoading(true);
    api<CoopPublicInfo>(`/coops/${selectedCoop.slug}/public-info`)
      .then((coop) => {
        setForm({
          logoUrl: coop.logoUrl || '',
          primaryColor: coop.primaryColor || '#1e40af',
          secondaryColor: coop.secondaryColor || '#3b82f6',
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedCoop]);

  const handleSave = async () => {
    if (!selectedCoop) return;
    try {
      await api(`/admin/coops/${selectedCoop.id}/branding`, { method: 'PUT', body: form });
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
      <h1 className="text-2xl font-bold mb-6">{t('admin.branding.title')}</h1>
      {message && (
        <Alert className="mb-4">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.branding.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <Label>{t('admin.branding.logoUrl')}</Label>
            <Input
              value={form.logoUrl}
              onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
              placeholder="https://..."
              className="mt-1"
            />
            {form.logoUrl && (
              <div className="mt-2 p-4 border rounded-md bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.logoUrl} alt="Logo preview" className="max-h-16 object-contain" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t('admin.branding.primaryColor')}</Label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="color"
                  value={form.primaryColor}
                  onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                  className="h-10 w-10 rounded border cursor-pointer"
                />
                <Input
                  value={form.primaryColor}
                  onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                  className="flex-1"
                />
              </div>
            </div>
            <div>
              <Label>{t('admin.branding.secondaryColor')}</Label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="color"
                  value={form.secondaryColor}
                  onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                  className="h-10 w-10 rounded border cursor-pointer"
                />
                <Input
                  value={form.secondaryColor}
                  onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                  className="flex-1"
                />
              </div>
            </div>
          </div>

          <div
            className="p-4 rounded-lg"
            style={{
              background: `linear-gradient(135deg, ${form.primaryColor}, ${form.secondaryColor})`,
            }}
          >
            <p className="text-white font-bold text-lg">{selectedCoop.name}</p>
            <p className="text-white/80 text-sm">{t('admin.branding.preview')}</p>
          </div>

          <Button onClick={handleSave}>{t('common.save')}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
