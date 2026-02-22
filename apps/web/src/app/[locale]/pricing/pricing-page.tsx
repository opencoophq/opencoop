'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MarketingNav } from '@/components/marketing/marketing-nav';
import { MarketingFooter } from '@/components/marketing/marketing-footer';
import { FadeIn } from '@/components/marketing/fade-in';
import { AnimatedGridBg } from '@/components/marketing/animated-grid-bg';
import {
  Check,
  ChevronDown,
  Github,
  ArrowRight,
  Sparkles,
  Server,
  Shield,
  Database,
  Loader2,
} from 'lucide-react';
import { useState } from 'react';

const GITHUB_URL = 'https://github.com/opencoophq/opencoop';

const STARTER_FEATURES = [
  'starterLimit',
  'shareholders',
  'shareClasses',
  'dividends',
  'banking',
  'documents',
  'branding',
  'multiTenant',
  'emailNotifications',
] as const;

const GROWTH_FEATURES = [
  'unlimitedShareholders',
  'shareholders',
  'shareClasses',
  'dividends',
  'banking',
  'documents',
  'branding',
  'multiTenant',
  'emailNotifications',
  'prioritySupport',
] as const;

const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4'] as const;

export function PricingPage({ isWaitlistMode }: { isWaitlistMode: boolean }) {
  const t = useTranslations('pricing');
  const locale = useLocale();
  const [yearly, setYearly] = useState(false);
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  // Waitlist state
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistPlan, setWaitlistPlan] = useState<string | null>(null);
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [waitlistSuccess, setWaitlistSuccess] = useState(false);
  const [waitlistError, setWaitlistError] = useState(false);

  function openWaitlistDialog(plan: string) {
    setWaitlistPlan(plan);
    setWaitlistEmail('');
    setWaitlistSuccess(false);
    setWaitlistError(false);
    setWaitlistOpen(true);
  }

  async function submitWaitlist(e: React.FormEvent) {
    e.preventDefault();
    setWaitlistSubmitting(true);
    setWaitlistError(false);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiUrl}/auth/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: waitlistEmail, plan: waitlistPlan, locale }),
      });

      if (!res.ok) throw new Error();
      setWaitlistSuccess(true);
    } catch {
      setWaitlistError(true);
    } finally {
      setWaitlistSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />

      {/* Hero */}
      <section className="relative pt-32 pb-16 md:pt-44 md:pb-24">
        <AnimatedGridBg />
        <div className="relative max-w-4xl mx-auto px-6 text-center">
          <FadeIn>
            <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm font-medium gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              {t('hero.badge')}
            </Badge>
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
        </div>
      </section>

      {/* Billing toggle */}
      <FadeIn className="flex justify-center mb-12">
        <div className="inline-flex items-center gap-3 rounded-full bg-muted p-1">
          <button
            onClick={() => setYearly(false)}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
              !yearly
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('billing.monthly')}
          </button>
          <button
            onClick={() => setYearly(true)}
            className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
              yearly
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('billing.yearly')}
          </button>
          {yearly && (
            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0 text-xs">
              {t('billing.save')}
            </Badge>
          )}
        </div>
      </FadeIn>

      {/* Pricing cards */}
      <section className="max-w-5xl mx-auto px-6 pb-24">
        <div className="grid md:grid-cols-2 gap-8">
          {/* Starter */}
          <FadeIn>
            <div className="rounded-2xl border bg-card p-8 flex flex-col h-full">
              <div className="mb-6">
                <h3 className="text-xl font-bold">{t('starter.name')}</h3>
                <p className="text-sm text-muted-foreground mt-1">{t('starter.description')}</p>
              </div>

              <div className="mb-8">
                <div className="flex items-baseline gap-1">
                  <span className="text-5xl font-extrabold tracking-tight">
                    &euro;{yearly ? t('starter.priceYearly') : t('starter.priceMonthly')}
                  </span>
                  <span className="text-muted-foreground text-lg">
                    {yearly ? t('billing.perYear') : t('billing.perMonth')}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {yearly ? t('billing.billedYearly') : t('billing.billedMonthly')}
                </p>
              </div>

              {isWaitlistMode ? (
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full text-base h-12 mb-8"
                  onClick={() => openWaitlistDialog('starter')}
                >
                  {t('starter.cta')}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Link href={`/onboarding?plan=starter&billing=${yearly ? 'yearly' : 'monthly'}`}>
                  <Button size="lg" variant="outline" className="w-full text-base h-12 mb-8">
                    {t('starter.cta')}
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              )}

              <ul className="space-y-3 flex-1">
                {STARTER_FEATURES.map((key) => (
                  <li key={key} className="flex items-start gap-3 text-sm">
                    <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <span>{t(`features.${key}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </FadeIn>

          {/* Growth */}
          <FadeIn delay={100}>
            <div className="rounded-2xl border-2 border-primary bg-card p-8 flex flex-col h-full relative">
              <Badge className="absolute -top-3 left-8 bg-primary text-primary-foreground">
                {t('growth.badge')}
              </Badge>

              <div className="mb-6">
                <h3 className="text-xl font-bold">{t('growth.name')}</h3>
                <p className="text-sm text-muted-foreground mt-1">{t('growth.description')}</p>
              </div>

              <div className="mb-8">
                <div className="flex items-baseline gap-1">
                  <span className="text-5xl font-extrabold tracking-tight">
                    &euro;{yearly ? t('growth.priceYearly') : t('growth.priceMonthly')}
                  </span>
                  <span className="text-muted-foreground text-lg">
                    {yearly ? t('billing.perYear') : t('billing.perMonth')}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {yearly ? t('billing.billedYearly') : t('billing.billedMonthly')}
                </p>
              </div>

              {isWaitlistMode ? (
                <Button
                  size="lg"
                  className="w-full text-base h-12 mb-8"
                  onClick={() => openWaitlistDialog('growth')}
                >
                  {t('growth.cta')}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Link href={`/onboarding?plan=growth&billing=${yearly ? 'yearly' : 'monthly'}`}>
                  <Button size="lg" className="w-full text-base h-12 mb-8">
                    {t('growth.cta')}
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              )}

              <ul className="space-y-3 flex-1">
                {GROWTH_FEATURES.map((key) => (
                  <li key={key} className="flex items-start gap-3 text-sm">
                    <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <span>{t(`features.${key}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Self-hosted banner */}
      <section className="bg-muted/40 py-16">
        <FadeIn className="max-w-4xl mx-auto px-6">
          <div className="rounded-2xl border bg-card p-8 md:p-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mb-6">
              <Server className="w-6 h-6" />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">
              {t('selfHosted.title')}
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto mb-8 leading-relaxed">
              {t('selfHosted.description')}
            </p>
            <div className="flex flex-wrap justify-center gap-6 mb-8 text-sm">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                <span>{t('selfHosted.free')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-primary" />
                <span>{t('selfHosted.dataOwnership')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Github className="w-4 h-4 text-primary" />
                <span>{t('selfHosted.community')}</span>
              </div>
            </div>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <Button size="lg" variant="outline" className="text-base px-8 h-12">
                <Github className="w-4 h-4" />
                {t('selfHosted.cta')}
              </Button>
            </a>
            <p className="text-xs text-muted-foreground mt-4">{t('selfHosted.paidSupport')}</p>
          </div>
        </FadeIn>
      </section>

      {/* FAQ */}
      <section className="py-24 md:py-32">
        <div className="max-w-3xl mx-auto px-6">
          <FadeIn className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{t('faq.title')}</h2>
          </FadeIn>

          <div className="space-y-4">
            {FAQ_KEYS.map((key, i) => (
              <FadeIn key={key} delay={i * 60}>
                <div className="rounded-xl border bg-card">
                  <button
                    onClick={() => setOpenFaq(openFaq === key ? null : key)}
                    className="w-full flex items-center justify-between p-5 text-left"
                  >
                    <span className="font-medium pr-4">{t(`faq.${key}`)}</span>
                    <ChevronDown
                      className={`w-5 h-5 text-muted-foreground shrink-0 transition-transform duration-200 ${
                        openFaq === key ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-200 ${
                      openFaq === key ? 'max-h-40' : 'max-h-0'
                    }`}
                  >
                    <p className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">
                      {t(
                        `faq.${key.replace('q', 'a')}` as
                          | 'faq.a1'
                          | 'faq.a2'
                          | 'faq.a3'
                          | 'faq.a4',
                      )}
                    </p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
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
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">{t('cta.title')}</h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
            {t('cta.subtitle')}
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            {isWaitlistMode ? (
              <Button
                size="lg"
                className="w-full sm:w-auto text-base px-8 h-12"
                onClick={() => openWaitlistDialog('starter')}
              >
                <ArrowRight className="w-4 h-4" />
                {t('cta.primary')}
              </Button>
            ) : (
              <Link href="/onboarding?plan=starter&billing=yearly">
                <Button size="lg" className="w-full sm:w-auto text-base px-8 h-12">
                  <ArrowRight className="w-4 h-4" />
                  {t('cta.primary')}
                </Button>
              </Link>
            )}
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto text-base px-8 h-12"
              >
                <Github className="w-4 h-4" />
                {t('cta.secondary')}
              </Button>
            </a>
          </div>
        </FadeIn>
      </section>

      <MarketingFooter />

      {/* Waitlist dialog */}
      <Dialog open={waitlistOpen} onOpenChange={setWaitlistOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('waitlist.title')}</DialogTitle>
            <DialogDescription>{t('waitlist.subtitle')}</DialogDescription>
          </DialogHeader>

          {waitlistSuccess ? (
            <div className="py-4">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <Check className="w-5 h-5" />
                <p className="font-medium">{t('waitlist.success')}</p>
              </div>
            </div>
          ) : (
            <form onSubmit={submitWaitlist} className="space-y-4">
              {waitlistPlan && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="capitalize">
                    {waitlistPlan}
                  </Badge>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="waitlist-email">{t('waitlist.email')}</Label>
                <Input
                  id="waitlist-email"
                  type="email"
                  required
                  value={waitlistEmail}
                  onChange={(e) => setWaitlistEmail(e.target.value)}
                  placeholder="your@email.com"
                />
              </div>

              {waitlistError && (
                <p className="text-sm text-destructive">{t('waitlist.error')}</p>
              )}

              <Button type="submit" className="w-full" disabled={waitlistSubmitting}>
                {waitlistSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t('waitlist.submit')}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
