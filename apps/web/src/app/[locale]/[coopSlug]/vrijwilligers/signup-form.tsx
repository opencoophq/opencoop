'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { api, resolveLogoUrl } from '@/lib/api';
import { isKnownInterest, isVolunteerSignupValid } from '@/lib/volunteer-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';

interface PublicInfo {
  coopName: string;
  logoUrl: string | null;
  primaryColor: string;
  interests: string[];
  consentTextVersion: string;
}

export default function VolunteerSignupForm({ coopSlug }: { coopSlug: string }) {
  const t = useTranslations('volunteers');
  const locale = useLocale();
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<PublicInfo>(`/public/coops/${coopSlug}/volunteers`)
      .then(setInfo)
      .catch(() => setUnavailable(true))
      .finally(() => setLoading(false));
  }, [coopSlug]);

  const labelFor = (tag: string) => (isKnownInterest(tag) ? t(`interestTags.${tag}`) : tag);

  const toggleInterest = (tag: string) => {
    setInterests((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  };

  const valid = isVolunteerSignupValid({
    name,
    email,
    postalCode,
    municipality,
    interests,
    consent,
  });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError('');
    try {
      await api(`/public/coops/${coopSlug}/volunteers`, {
        method: 'POST',
        body: {
          name,
          email,
          phone: phone || undefined,
          postalCode,
          municipality,
          interests,
          consent,
          locale,
          website,
        },
      });
      setDone(true);
    } catch {
      setError(t('error'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (unavailable || !info) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Alert>
          <AlertDescription>{t('unavailable')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const logo = resolveLogoUrl(info.logoUrl);

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-10">
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          {logo && (
            <img
              src={logo}
              alt={info.coopName}
              className="mb-3 h-10 max-w-[180px] object-contain"
            />
          )}
          <CardTitle>{t('signupTitle')}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('signupIntro', { coop: info.coopName })}
          </p>
        </CardHeader>
        <CardContent>
          {done ? (
            <Alert>
              <AlertDescription>{t('checkEmail')}</AlertDescription>
            </Alert>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
                <label htmlFor="website">Website</label>
                <input
                  id="website"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="volunteer-name">{t('name')}</Label>
                <Input
                  id="volunteer-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="volunteer-email">{t('email')}</Label>
                <Input
                  id="volunteer-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="volunteer-phone">{t('phone')}</Label>
                <Input
                  id="volunteer-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="volunteer-postcode">{t('postalCode')}</Label>
                  <Input
                    id="volunteer-postcode"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="volunteer-municipality">{t('municipality')}</Label>
                  <Input
                    id="volunteer-municipality"
                    value={municipality}
                    onChange={(e) => setMunicipality(e.target.value)}
                    required
                  />
                </div>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t('interests')}</legend>
                {info.interests.map((tag) => (
                  <div key={tag} className="flex items-center gap-2">
                    <Checkbox
                      id={`interest-${tag}`}
                      checked={interests.includes(tag)}
                      onCheckedChange={() => toggleInterest(tag)}
                    />
                    <Label htmlFor={`interest-${tag}`} className="font-normal">
                      {labelFor(tag)}
                    </Label>
                  </div>
                ))}
              </fieldset>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="volunteer-consent"
                  checked={consent}
                  onCheckedChange={(checked) => setConsent(checked === true)}
                />
                <Label htmlFor="volunteer-consent" className="font-normal leading-snug">
                  {t('consent', { coop: info.coopName })}
                </Label>
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={!valid || submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('submit')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
