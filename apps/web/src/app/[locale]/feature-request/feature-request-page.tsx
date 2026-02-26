'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { MarketingNav } from '@/components/marketing/marketing-nav';
import { MarketingFooter } from '@/components/marketing/marketing-footer';
import { FadeIn } from '@/components/marketing/fade-in';
import { AnimatedGridBg } from '@/components/marketing/animated-grid-bg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Lightbulb, Loader2, CheckCircle2 } from 'lucide-react';

export default function FeatureRequestPage() {
  const t = useTranslations('featureRequest');
  const locale = useLocale();

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(false);

    const formData = new FormData(e.currentTarget);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiUrl}/feature-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          title: formData.get('title'),
          description: formData.get('description'),
          locale,
        }),
      });

      if (!res.ok) throw new Error('Failed to submit');
      setSuccess(true);
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />

      <section className="relative pt-32 pb-24 md:pt-44 md:pb-36">
        <AnimatedGridBg />

        <div className="relative max-w-2xl mx-auto px-6">
          <FadeIn className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary mb-6">
              <Lightbulb className="w-7 h-7" />
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1]">
              {t('title')}
            </h1>
            <p className="mt-4 text-lg text-muted-foreground max-w-lg mx-auto">
              {t('subtitle')}
            </p>
          </FadeIn>

          <FadeIn delay={120}>
            <div className="rounded-xl border bg-card p-6 sm:p-8 shadow-sm">
              {success ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
                  <p className="text-lg font-medium">{t('success')}</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid sm:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <Label htmlFor="name">{t('form.name')}</Label>
                      <Input
                        id="name"
                        name="name"
                        required
                        placeholder={t('form.namePlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">{t('form.email')}</Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        required
                        placeholder={t('form.emailPlaceholder')}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="title">{t('form.title')}</Label>
                    <Input
                      id="title"
                      name="title"
                      required
                      placeholder={t('form.titlePlaceholder')}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">{t('form.description')}</Label>
                    <Textarea
                      id="description"
                      name="description"
                      required
                      rows={5}
                      placeholder={t('form.descriptionPlaceholder')}
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-destructive">{t('error')}</p>
                  )}

                  <Button type="submit" className="w-full h-11" disabled={submitting}>
                    {submitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      t('form.submit')
                    )}
                  </Button>
                </form>
              )}
            </div>
          </FadeIn>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
