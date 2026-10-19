'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { useAdmin } from '@/contexts/admin-context';
import { usePermissions } from '@/contexts/permissions-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/routing';

interface ShareholderOption {
  id: string;
  firstName: string;
  lastName: string;
  companyName?: string;
  email: string;
  type: string;
}

export default function AdminComposeMessagePage() {
  const t = useTranslations();
  const { selectedCoop } = useAdmin();
  const { hasPermission } = usePermissions();
  const router = useRouter();

  const [audience, setAudience] = useState<'ALL' | 'DIRECT' | 'VOLUNTEERS'>('ALL');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [shareholderId, setShareholderId] = useState('');
  const [shareholders, setShareholders] = useState<ShareholderOption[]>([]);
  const [loadingShareholders, setLoadingShareholders] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCoop || audience !== 'DIRECT') return;
    setLoadingShareholders(true);
    api<{ data: ShareholderOption[] } | ShareholderOption[]>(
      `/admin/coops/${selectedCoop.id}/shareholders?limit=500`,
    )
      .then((result) => {
        const list = Array.isArray(result) ? result : result.data || [];
        setShareholders(list);
      })
      .catch(() => setError(t('common.error')))
      .finally(() => setLoadingShareholders(false));
  }, [selectedCoop, audience, t]);

  const canMessageVolunteers =
    selectedCoop?.volunteersEnabled === true && hasPermission('canViewVolunteers');

  const handleSend = async () => {
    if (!selectedCoop || !subject.trim() || !body.trim()) return;
    if (audience === 'DIRECT' && !shareholderId) return;
    if (audience === 'VOLUNTEERS' && !canMessageVolunteers) return;

    setSending(true);
    setError(null);
    try {
      const conversation = await api<{ id: string }>(
        `/admin/coops/${selectedCoop.id}/conversations`,
        {
          method: 'POST',
          body: {
            type: audience === 'DIRECT' ? 'DIRECT' : 'BROADCAST',
            subject,
            body,
            ...(audience === 'DIRECT' ? { shareholderId } : {}),
            ...(audience === 'VOLUNTEERS' ? { audience: { type: 'VOLUNTEERS' } } : {}),
          },
        },
      );
      router.push(`/dashboard/admin/messages/${conversation.id}`);
    } catch {
      setError(t('common.error'));
    } finally {
      setSending(false);
    }
  };

  if (!selectedCoop) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">{t('admin.selectCoop')}</p>
      </div>
    );
  }

  const shareholderLabel = (sh: ShareholderOption) => {
    if (sh.type === 'COMPANY' && sh.companyName) {
      return `${sh.companyName} (${sh.email})`;
    }
    return `${sh.firstName} ${sh.lastName} (${sh.email})`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/admin/messages">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t('messages.backToInbox')}
          </Link>
        </Button>
      </div>

      <h1 className="text-2xl font-bold">{t('messages.startConversation')}</h1>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6 space-y-6">
          <div className="space-y-3">
            <Label>{t('messages.recipient')}</Label>
            <RadioGroup
              value={audience}
              onValueChange={(v) => setAudience(v as 'ALL' | 'DIRECT' | 'VOLUNTEERS')}
              className="flex flex-wrap gap-6"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="ALL" id="broadcast" />
                <Label htmlFor="broadcast" className="font-normal cursor-pointer">
                  {t('messages.allShareholders')}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="DIRECT" id="direct" />
                <Label htmlFor="direct" className="font-normal cursor-pointer">
                  {t('messages.specificShareholder')}
                </Label>
              </div>
              {canMessageVolunteers && (
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="VOLUNTEERS" id="volunteers" />
                  <Label htmlFor="volunteers" className="font-normal cursor-pointer">
                    {t('messages.volunteers')}
                  </Label>
                </div>
              )}
            </RadioGroup>
          </div>

          {audience === 'DIRECT' && (
            <div className="space-y-2">
              <Label>{t('messages.selectShareholder')}</Label>
              {loadingShareholders ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('common.loading')}
                </div>
              ) : (
                <Select value={shareholderId} onValueChange={setShareholderId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('messages.selectShareholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {shareholders.map((sh) => (
                      <SelectItem key={sh.id} value={sh.id}>
                        {shareholderLabel(sh)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>{t('messages.subject')}</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t('messages.subjectPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('messages.body')}</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('messages.bodyPlaceholder')}
              rows={8}
            />
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" asChild>
              <Link href="/dashboard/admin/messages">{t('common.cancel')}</Link>
            </Button>
            <Button
              onClick={handleSend}
              disabled={
                sending ||
                !subject.trim() ||
                !body.trim() ||
                (audience === 'DIRECT' && !shareholderId)
              }
            >
              {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('messages.send')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
