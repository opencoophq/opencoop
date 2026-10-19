'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { isKnownInterest } from '@/lib/volunteer-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { HeartHandshake, Loader2 } from 'lucide-react';

interface VolunteerView {
  id: string;
  interests: string[];
  status: string;
  phone: string | null;
  postalCode: string;
  municipality: string;
}

interface MemberVolunteer {
  coopName: string;
  interests: string[];
  prefill: {
    name: string;
    email: string;
    phone: string;
    postalCode: string;
    municipality: string;
  };
  volunteer: VolunteerView | null;
}

export function VolunteerOptIn({ shareholderId }: { shareholderId: string }) {
  const t = useTranslations('volunteers');
  const [data, setData] = useState<MemberVolunteer | null>(null);
  const [hidden, setHidden] = useState(false);
  const [interests, setInterests] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<MemberVolunteer>(`/shareholders/${shareholderId}/volunteer`)
      .then((result) => {
        setData(result);
        const current = result.volunteer?.status === 'ACTIVE' ? result.volunteer : null;
        setInterests(current?.interests ?? []);
        setPhone(current?.phone || result.prefill.phone || '');
        setPostalCode(current?.postalCode || result.prefill.postalCode || '');
        setMunicipality(current?.municipality || result.prefill.municipality || '');
        setConsent(current?.status === 'ACTIVE');
      })
      .catch(() => setHidden(true));
  }, [shareholderId]);

  if (hidden || !data) return null;

  const active = data.volunteer?.status === 'ACTIVE';
  const labelFor = (tag: string) => (isKnownInterest(tag) ? t(`interestTags.${tag}`) : tag);

  const toggle = (tag: string) => {
    setInterests((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = await api<VolunteerView>(`/shareholders/${shareholderId}/volunteer`, {
        method: 'PUT',
        body: { interests, consent: true, phone, postalCode, municipality },
      });
      setData({ ...data, volunteer: saved });
      setConsent(true);
    } catch {
      setError(t('error'));
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = await api<VolunteerView>(`/shareholders/${shareholderId}/volunteer/withdraw`, {
        method: 'POST',
      });
      setData({ ...data, volunteer: saved });
      setConsent(false);
    } catch {
      setError(t('error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <HeartHandshake className="h-5 w-5" />
          {t('helpTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('helpDescription')}</p>
        {active && (
          <Alert>
            <AlertDescription>{t('optedIn')}</AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">{t('prefilled')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="opt-in-postcode">{t('postalCode')}</Label>
            <Input
              id="opt-in-postcode"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="opt-in-municipality">{t('municipality')}</Label>
            <Input
              id="opt-in-municipality"
              value={municipality}
              onChange={(e) => setMunicipality(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="opt-in-phone">{t('phone')}</Label>
          <Input id="opt-in-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('interests')}</legend>
          {data.interests.map((tag) => (
            <div key={tag} className="flex items-center gap-2">
              <Checkbox
                id={`opt-in-${tag}`}
                checked={interests.includes(tag)}
                onCheckedChange={() => toggle(tag)}
              />
              <Label htmlFor={`opt-in-${tag}`} className="font-normal">
                {labelFor(tag)}
              </Label>
            </div>
          ))}
        </fieldset>
        {!active && (
          <div className="flex items-start gap-2">
            <Checkbox
              id="opt-in-consent"
              checked={consent}
              onCheckedChange={(checked) => setConsent(checked === true)}
            />
            <Label htmlFor="opt-in-consent" className="font-normal leading-snug">
              {t('consent', { coop: data.coopName })}
            </Label>
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex gap-2">
          <Button
            onClick={save}
            disabled={saving || interests.length === 0 || (!active && !consent)}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {active ? t('save') : t('optIn')}
          </Button>
          {active && (
            <Button variant="outline" onClick={withdraw} disabled={saving}>
              {t('withdraw')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
