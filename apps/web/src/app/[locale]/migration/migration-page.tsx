'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { MarketingNav } from '@/components/marketing/marketing-nav';
import { MarketingFooter } from '@/components/marketing/marketing-footer';
import { FadeIn } from '@/components/marketing/fade-in';
import { AnimatedGridBg } from '@/components/marketing/animated-grid-bg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  MessageSquare,
  Search,
  Upload,
  Users,
  Layers,
  Coins,
  FileText,
  Landmark,
  Check,
} from 'lucide-react';

const STEPS = ['step1', 'step2', 'step3', 'step4'] as const;
const STEP_ICONS = [MessageSquare, Search, Upload, Check] as const;

const DATA_TYPES = [
  { key: 'shareholders', icon: Users },
  { key: 'shares', icon: Layers },
  { key: 'transactions', icon: ArrowRightLeft },
  { key: 'dividends', icon: Coins },
  { key: 'documents', icon: FileText },
  { key: 'bankData', icon: Landmark },
] as const;

export default function MigrationPage() {
  const t = useTranslations('migration');
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
      const res = await fetch(`${apiUrl}/migration-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          coopName: formData.get('coopName'),
          estimatedShareholders: formData.get('estimatedShareholders'),
          currentSystem: formData.get('currentSystem'),
          message: formData.get('message'),
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

      {/* Hero */}
      <section className="relative pt-32 pb-24 md:pt-44 md:pb-36">
        <AnimatedGridBg />

        <div className="relative max-w-4xl mx-auto px-6 text-center">
          <FadeIn>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary mb-6">
              <FileSpreadsheet className="w-7 h-7" />
            </div>
          </FadeIn>

          <FadeIn delay={80}>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.1] text-balance">
              {t('hero.title')}
            </h1>
          </FadeIn>

          <FadeIn delay={160}>
            <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed text-balance">
              {t('hero.subtitle')}
            </p>
          </FadeIn>

          <FadeIn delay={240}>
            <div className="mt-10">
              <a href="#contact">
                <Button size="lg" className="text-base px-8 h-12">
                  {t('hero.cta')}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 md:py-32 bg-muted/40">
        <div className="max-w-4xl mx-auto px-6">
          <FadeIn className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              {t('process.title')}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              {t('process.subtitle')}
            </p>
          </FadeIn>

          <div className="grid md:grid-cols-4 gap-10 md:gap-6">
            {STEPS.map((step, i) => {
              const Icon = STEP_ICONS[i];
              return (
                <FadeIn key={step} delay={i * 100} className="relative text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary mb-4">
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="text-xs font-bold text-primary/60 uppercase tracking-wider mb-2">
                    {t('process.stepLabel', { number: i + 1 })}
                  </div>
                  <h3 className="text-lg font-semibold mb-2">
                    {t(`process.${step}.title`)}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t(`process.${step}.description`)}
                  </p>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* What we migrate */}
      <section className="py-24 md:py-32">
        <div className="max-w-5xl mx-auto px-6">
          <FadeIn className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              {t('dataTypes.title')}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              {t('dataTypes.subtitle')}
            </p>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {DATA_TYPES.map(({ key, icon: Icon }, i) => (
              <FadeIn key={key} delay={i * 80}>
                <div className="group relative rounded-xl border bg-card p-6 hover:shadow-lg hover:border-primary/20 transition-all duration-300">
                  <div className="mb-4 inline-flex items-center justify-center w-11 h-11 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">
                    {t(`dataTypes.${key}.title`)}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t(`dataTypes.${key}.description`)}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Contact form */}
      <section id="contact" className="py-24 md:py-32 bg-muted/40 scroll-mt-16">
        <div className="max-w-2xl mx-auto px-6">
          <FadeIn className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              {t('form.title')}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-lg mx-auto">
              {t('form.subtitle')}
            </p>
          </FadeIn>

          <FadeIn delay={120}>
            <div className="rounded-xl border bg-card p-6 sm:p-8 shadow-sm">
              {success ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
                  <p className="text-lg font-medium">{t('form.success')}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{t('form.successDetail')}</p>
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

                  <div className="grid sm:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <Label htmlFor="coopName">{t('form.coopName')}</Label>
                      <Input
                        id="coopName"
                        name="coopName"
                        required
                        placeholder={t('form.coopNamePlaceholder')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="estimatedShareholders">{t('form.estimatedShareholders')}</Label>
                      <Input
                        id="estimatedShareholders"
                        name="estimatedShareholders"
                        placeholder={t('form.estimatedShareholdersPlaceholder')}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="currentSystem">{t('form.currentSystem')}</Label>
                    <Input
                      id="currentSystem"
                      name="currentSystem"
                      placeholder={t('form.currentSystemPlaceholder')}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="message">{t('form.message')}</Label>
                    <Textarea
                      id="message"
                      name="message"
                      required
                      rows={5}
                      placeholder={t('form.messagePlaceholder')}
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-destructive">{t('form.error')}</p>
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

      {/* CTA */}
      <section className="relative py-24 md:py-32 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] rounded-full opacity-10 blur-[120px]"
            style={{ background: 'hsl(221.2, 83.2%, 53.3%)' }}
          />
        </div>

        <FadeIn className="relative max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            {t('cta.title')}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
            {t('cta.subtitle')}
          </p>

          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/pricing">
              <Button size="lg" className="w-full sm:w-auto text-base px-8 h-12">
                {t('cta.primary')}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
            <Link href="/demo">
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto text-base px-8 h-12"
              >
                {t('cta.secondary')}
              </Button>
            </Link>
          </div>
        </FadeIn>
      </section>

      <MarketingFooter />
    </div>
  );
}
