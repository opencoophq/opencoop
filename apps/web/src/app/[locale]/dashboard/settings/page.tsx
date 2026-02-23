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
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api';
import { useRouter } from '@/i18n/routing';

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

  useEffect(() => {
    const userData = localStorage.getItem('user');
    if (userData) {
      const user = JSON.parse(userData);
      setName(user.name || '');
      setPreferredLanguage(user.preferredLanguage || 'nl');
    }
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
      </div>
    </div>
  );
}
