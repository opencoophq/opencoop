'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';

interface Admin {
  id: string;
  user: {
    id: string;
    email: string;
  };
}

interface CoopDetail {
  id: string;
  name: string;
  slug: string;
}

export default function CoopAdminsPage() {
  const t = useTranslations();
  const params = useParams();
  const coopId = params.id as string;
  const [coop, setCoop] = useState<CoopDetail | null>(null);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadData = async () => {
    try {
      const [coopsData, adminsData] = await Promise.all([
        api<CoopDetail[]>('/system/coops'),
        api<Admin[]>(`/system/coops/${coopId}/admins`),
      ]);
      const found = coopsData.find((c) => c.id === coopId);
      if (found) setCoop(found);
      setAdmins(adminsData);
    } catch {
      setError(t('errors.generic'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [coopId]);

  const handleAddAdmin = async () => {
    setError('');
    setSuccess('');
    if (!email.trim()) return;

    try {
      await api(`/system/coops/${coopId}/admins`, {
        method: 'POST',
        body: { email: email.trim() },
      });
      setEmail('');
      setSuccess(t('common.savedSuccessfully'));
      await loadData();
    } catch {
      setError(t('errors.generic'));
    }
  };

  const handleRemoveAdmin = async (adminId: string) => {
    if (!confirm(t('system.coopAdmins.confirmRemove'))) return;
    setError('');
    setSuccess('');

    try {
      await api(`/system/coops/${coopId}/admins/${adminId}`, {
        method: 'DELETE',
      });
      await loadData();
    } catch {
      setError(t('errors.generic'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link href="/dashboard/system/coops">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t('system.coopAdmins.title')}</h1>
          {coop && <p className="text-muted-foreground">{coop.name}</p>}
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert className="mb-4">
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('system.coopAdmins.addAdmin')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder={t('system.coopAdmins.searchUsers')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddAdmin()}
            />
            <Button onClick={handleAddAdmin}>
              <Plus className="h-4 w-4 mr-2" />
              {t('common.create')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('system.coopAdmins.currentAdmins')}</CardTitle>
        </CardHeader>
        <CardContent>
          {admins.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              {t('system.coopAdmins.noAdmins')}
            </p>
          ) : (
            <div className="space-y-2">
              {admins.map((admin) => (
                <div
                  key={admin.id}
                  className="flex items-center justify-between py-2 px-3 rounded-md border"
                >
                  <span className="text-sm">{admin.user.email}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveAdmin(admin.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
