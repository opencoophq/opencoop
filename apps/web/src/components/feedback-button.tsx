'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { MessageSquarePlus, Loader2, CheckCircle2, Bug, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';

interface FeedbackButtonProps {
  user: { email: string; name?: string; role: string };
}

type FeedbackType = 'bug' | 'feature';

export function FeedbackButton({ user }: FeedbackButtonProps) {
  const t = useTranslations('feedback');
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>('bug');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(false);

  const isAdmin = user.role === 'COOP_ADMIN' || user.role === 'SYSTEM_ADMIN';

  function handleOpen() {
    setSuccess(false);
    setError(false);
    setType('bug');
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(false);

    const formData = new FormData(e.currentTarget);

    try {
      await api('/feature-requests', {
        method: 'POST',
        body: {
          name: user.name || user.email,
          email: user.email,
          title: formData.get('title'),
          description: formData.get('description'),
          type,
          locale,
        },
      });
      setSuccess(true);
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        onClick={handleOpen}
        size="icon"
        className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-lg hover:shadow-xl transition-shadow"
        aria-label={t('title')}
      >
        <MessageSquarePlus className="h-5 w-5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('subtitle')}</DialogDescription>
          </DialogHeader>

          {success ? (
            <div className="text-center py-6">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <p className="text-lg font-medium">{t('success')}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {isAdmin && (
                <div className="space-y-2">
                  <Label>{t('form.type')}</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setType('bug')}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                        type === 'bug'
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'border-input hover:bg-accent'
                      }`}
                    >
                      <Bug className="h-4 w-4" />
                      {t('form.typeBug')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setType('feature')}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                        type === 'feature'
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'border-input hover:bg-accent'
                      }`}
                    >
                      <Lightbulb className="h-4 w-4" />
                      {t('form.typeFeature')}
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="feedback-title">{t('form.title')}</Label>
                <Input
                  id="feedback-title"
                  name="title"
                  required
                  maxLength={200}
                  placeholder={type === 'bug' ? t('form.titlePlaceholderBug') : t('form.titlePlaceholderFeature')}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="feedback-description">{t('form.description')}</Label>
                <Textarea
                  id="feedback-description"
                  name="description"
                  required
                  rows={4}
                  maxLength={5000}
                  placeholder={type === 'bug' ? t('form.descriptionPlaceholderBug') : t('form.descriptionPlaceholderFeature')}
                />
              </div>

              {error && <p className="text-sm text-destructive">{t('error')}</p>}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : type === 'bug' ? (
                  t('form.submitBug')
                ) : (
                  t('form.submitFeature')
                )}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
