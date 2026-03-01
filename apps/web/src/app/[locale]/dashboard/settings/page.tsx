'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale, LocaleCode } from '@/contexts/locale-context';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';
import { useRouter } from '@/i18n/routing';
import { MfaSetup } from '@/components/settings/mfa-setup';
import { PasskeysManager } from '@/components/settings/passkeys-manager';

const LOCALE_OPTIONS: { value: LocaleCode; label: string }[] = [
  { value: 'nl-BE', label: 'Nederlands (België)' },
  { value: 'nl-NL', label: 'Nederlands (Nederland)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'de-DE', label: 'Deutsch' },
];

const LANGUAGE_OPTIONS = [
  { value: 'nl', label: 'Nederlands' },
  { value: 'en', label: 'English' },
];

export default function SettingsPage() {
  const t = useTranslations();
  const router = useRouter();
  const { locale: formattingLocale, setLocale: setFormattingLocale } = useLocale();
  const [name, setName] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('nl');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [googleLinked, setGoogleLinked] = useState(false);
  const [appleLinked, setAppleLinked] = useState(false);

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      const user = JSON.parse(userData);
      setName(user.name || '');
      setPreferredLanguage(user.preferredLanguage || 'nl');
    }
    api<{ mfaEnabled: boolean }>('/auth/mfa/status').then((res) => {
      setMfaEnabled(res.mfaEnabled);
    }).catch(() => {});
    api<{ googleLinked: boolean; appleLinked: boolean }>('/auth/me').then((res) => {
      setGoogleLinked(res.googleLinked);
      setAppleLinked(res.appleLinked);
    }).catch(() => {});
  }, []);

  const handleNameSave = async () => {
    try {
      await api('/auth/me', { method: 'PUT', body: { name: name || null } });
      const userData = localStorage.getItem('user');
      if (userData) {
        const user = JSON.parse(userData);
        user.name = name || null;
        localStorage.setItem('user', JSON.stringify(user));
      }
      setMessage(t('common.savedSuccessfully'));
    } catch {
      setError(t('errors.generic'));
    }
  };

  const handleLanguageChange = async (language: string) => {
    setPreferredLanguage(language);
    try {
      await api('/auth/me', { method: 'PUT', body: { preferredLanguage: language } });
      const userData = localStorage.getItem('user');
      if (userData) {
        const user = JSON.parse(userData);
        user.preferredLanguage = language;
        localStorage.setItem('user', JSON.stringify(user));
      }
      router.replace('/dashboard/settings', { locale: language as 'nl' | 'en' });
    } catch {
      // ignore - preference still saved locally
    }
  };

  const handlePasswordChange = async () => {
    setError('');
    setMessage('');

    if (newPassword.length < 8) {
      setError(t('auth.passwordMinLength'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setMessage(t('common.savedSuccessfully'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setError(t('errors.generic'));
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">{t('common.settings')}</h1>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.displayName')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>{t('settings.displayName')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('settings.displayNamePlaceholder')}
                maxLength={100}
                className="mt-1"
              />
            </div>
            <Button onClick={handleNameSave}>{t('common.save')}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('common.language')}</CardTitle>
            <CardDescription>{t('admin.settings.languageDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>{t('admin.settings.uiLanguage')}</Label>
              <Select value={preferredLanguage} onValueChange={handleLanguageChange}>
                <SelectTrigger className="w-full mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{t('admin.settings.formattingLocale')}</Label>
              <Select value={formattingLocale} onValueChange={(v) => setFormattingLocale(v as LocaleCode)}>
                <SelectTrigger className="w-full mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('auth.changePassword')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {message && (
              <Alert>
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label>{t('auth.currentPassword')}</Label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t('auth.newPassword')}</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>{t('auth.confirmPassword')}</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1"
              />
            </div>
            <Button onClick={handlePasswordChange}>{t('common.save')}</Button>
          </CardContent>
        </Card>

        <MfaSetup mfaEnabled={mfaEnabled} onStatusChange={setMfaEnabled} />

        <PasskeysManager />

        <Card>
          <CardHeader>
            <CardTitle>{t('oauth.connectedAccounts')}</CardTitle>
            <CardDescription>{t('oauth.connectedAccountsDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                <span className="font-medium">{t('oauth.google')}</span>
              </div>
              <span className={`text-sm ${googleLinked ? 'text-green-600' : 'text-muted-foreground'}`}>
                {googleLinked ? t('oauth.linked') : t('oauth.notLinked')}
              </span>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                </svg>
                <span className="font-medium">{t('oauth.apple')}</span>
              </div>
              <span className={`text-sm ${appleLinked ? 'text-green-600' : 'text-muted-foreground'}`}>
                {appleLinked ? t('oauth.linked') : t('oauth.notLinked')}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
