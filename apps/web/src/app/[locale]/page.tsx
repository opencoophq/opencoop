'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MarketingNav } from '@/components/marketing/marketing-nav';
import { MarketingFooter } from '@/components/marketing/marketing-footer';
import { FadeIn } from '@/components/marketing/fade-in';
import { AnimatedGridBg } from '@/components/marketing/animated-grid-bg';
import {
  Users,
  Layers,
  Coins,
  Landmark,
  FileText,
  Palette,
  Github,
  ArrowRight,
  Shield,
  ChevronDown,
  Cloud,
  Server,
  Check,
  Lightbulb,
  Play,
} from 'lucide-react';

const GITHUB_URL = 'https://github.com/opencoophq/opencoop';

const FEATURES = [
  { key: 'shareholders', icon: Users },
  { key: 'shares', icon: Layers },
  { key: 'dividends', icon: Coins },
  { key: 'banking', icon: Landmark },
  { key: 'documents', icon: FileText },
  { key: 'multiTenant', icon: Palette },
] as const;

const STEPS = ['step1', 'step2', 'step3'] as const;

export default function HomePage() {
  const t = useTranslations('landing');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />

      {/* ─── Hero ─── */}
      <section className="relative pt-32 pb-24 md:pt-44 md:pb-36">
        <AnimatedGridBg />

        <div className="relative max-w-4xl mx-auto px-6 text-center">
          <FadeIn>
            <Badge
              variant="secondary"
              className="mb-6 px-4 py-1.5 text-sm font-medium gap-1.5"
            >
              <Shield className="w-3.5 h-3.5" />
              {t('hero.openSourceBadge')}
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

          <FadeIn delay={240}>
            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/pricing">
                <Button size="lg" className="w-full sm:w-auto text-base px-8 h-12">
                  {t('hero.cta')}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
              <Link href="/demo">
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full sm:w-auto text-base px-8 h-12"
                >
                  <Play className="w-4 h-4" />
                  {t('hero.demoCta')}
                </Button>
              </Link>
            </div>
          </FadeIn>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce text-muted-foreground/40">
          <ChevronDown className="w-5 h-5" />
        </div>
      </section>

      {/* ─── Features ─── */}
      <section className="py-24 md:py-32 bg-muted/40">
        <div className="max-w-6xl mx-auto px-6">
          <FadeIn className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              {t('features.title')}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              {t('features.subtitle')}
            </p>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(({ key, icon: Icon }, i) => (
              <FadeIn key={key} delay={i * 80}>
                <div className="group relative rounded-xl border bg-card p-6 hover:shadow-lg hover:border-primary/20 transition-all duration-300">
                  <div className="mb-4 inline-flex items-center justify-center w-11 h-11 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">
                    {t(`features.${key}.title`)}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {t(`features.${key}.description`)}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section className="py-24 md:py-32">
        <div className="max-w-4xl mx-auto px-6">
          <FadeIn className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              {t('howItWorks.title')}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              {t('howItWorks.subtitle')}
            </p>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-10 md:gap-8">
            {STEPS.map((step, i) => (
              <FadeIn key={step} delay={i * 120} className="relative text-center">
                <div className="text-[5.5rem] font-black leading-none text-primary/[0.07] select-none">
                  {String(i + 1).padStart(2, '0')}
                </div>
                <div className="-mt-10 relative">
                  <h3 className="text-xl font-semibold mb-3">
                    {t(`howItWorks.${step}.title`)}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {t(`howItWorks.${step}.description`)}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Try the Demo ─── */}
      <section className="py-24 md:py-32 bg-muted/40">
        <FadeIn className="max-w-3xl mx-auto px-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary mb-5">
            <Play className="w-6 h-6" />
          </div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            {t('demoCta.title')}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
            {t('demoCta.subtitle')}
          </p>
          <div className="mt-8">
            <Link href="/demo">
              <Button size="lg" className="text-base px-8 h-12">
                <Play className="w-4 h-4" />
                {t('demoCta.cta')}
              </Button>
            </Link>
          </div>
        </FadeIn>
      </section>

      {/* ─── SaaS vs Self-hosted ─── */}
      <section className="py-24 md:py-32 bg-muted/40">
        <div className="max-w-5xl mx-auto px-6">
          <FadeIn className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              {t('openSource.title')}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
              {t('openSource.subtitle')}
            </p>
          </FadeIn>

          <div className="grid md:grid-cols-2 gap-6">
            {/* SaaS / Cloud — primary */}
            <FadeIn>
              <div className="rounded-2xl border-2 border-primary bg-card p-8 flex flex-col h-full relative">
                <Badge className="absolute -top-3 left-8 bg-primary text-primary-foreground">
                  {t('openSource.saas.label')}
                </Badge>
                <div className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-primary/10 text-primary mb-4">
                  <Cloud className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-bold mb-2">{t('openSource.saas.title')}</h3>
                <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                  {t('openSource.saas.description')}
                </p>
                <ul className="space-y-3 mb-8 flex-1">
                  <li className="flex items-center gap-2.5 text-sm">
                    <Check className="w-4 h-4 text-primary shrink-0" />
                    {t('openSource.saas.feature1')}
                  </li>
                  <li className="flex items-center gap-2.5 text-sm">
                    <Check className="w-4 h-4 text-primary shrink-0" />
                    {t('openSource.saas.feature2')}
                  </li>
                  <li className="flex items-center gap-2.5 text-sm">
                    <Check className="w-4 h-4 text-primary shrink-0" />
                    {t('openSource.saas.feature3')}
                  </li>
                </ul>
                <Link href="/pricing">
                  <Button size="lg" className="w-full text-base h-12">
                    {t('openSource.saas.cta')}
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>
              </div>
            </FadeIn>

            {/* Self-hosted — secondary */}
            <FadeIn delay={100}>
              <div className="rounded-2xl border bg-card p-8 flex flex-col h-full">
                <div className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-muted text-muted-foreground mb-4">
                  <Server className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-bold mb-2">{t('openSource.selfHostedCard.title')}</h3>
                <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                  {t('openSource.selfHostedCard.description')}
                </p>
                <ul className="space-y-3 mb-8 flex-1">
                  <li className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 shrink-0" />
                    {t('openSource.selfHostedCard.feature1')}
                  </li>
                  <li className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 shrink-0" />
                    {t('openSource.selfHostedCard.feature2')}
                  </li>
                  <li className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <Check className="w-4 h-4 shrink-0" />
                    {t('openSource.selfHostedCard.feature3')}
                  </li>
                </ul>
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                  <Button size="lg" variant="outline" className="w-full text-base h-12">
                    <Github className="w-4 h-4" />
                    {t('openSource.selfHostedCard.cta')}
                  </Button>
                </a>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
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

      {/* ─── Feature Request CTA ─── */}
      <section className="py-16 md:py-20 bg-muted/40">
        <FadeIn className="max-w-3xl mx-auto px-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary mb-5">
            <Lightbulb className="w-6 h-6" />
          </div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
            {t('featureRequestCta.title')}
          </h2>
          <p className="mt-3 text-muted-foreground max-w-lg mx-auto">
            {t('featureRequestCta.subtitle')}
          </p>
          <div className="mt-8">
            <Link href="/feature-request">
              <Button size="lg" variant="outline" className="text-base px-8 h-12">
                <Lightbulb className="w-4 h-4" />
                {t('featureRequestCta.cta')}
              </Button>
            </Link>
          </div>
        </FadeIn>
      </section>

      <MarketingFooter />
    </div>
  );
}
