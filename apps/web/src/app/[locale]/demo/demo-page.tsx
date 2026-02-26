'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MarketingNav } from '@/components/marketing/marketing-nav';
import { MarketingFooter } from '@/components/marketing/marketing-footer';
import { FadeIn } from '@/components/marketing/fade-in';
import { AnimatedGridBg } from '@/components/marketing/animated-grid-bg';
import {
  ArrowRight,
  Play,
  Users,
  Layers,
  Coins,
  Copy,
  Check,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';

const DEMO_COOP_URL = '/demo/login';

function CopyableCredential({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="flex items-center gap-2 font-mono text-sm bg-muted/60 rounded-md px-3 py-1.5 hover:bg-muted transition-colors cursor-pointer"
      >
        <span className="truncate">{value}</span>
        {copied ? (
          <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
        ) : (
          <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </button>
    </div>
  );
}

const HIGHLIGHTS = ['shareholders', 'shares', 'dividends'] as const;
const HIGHLIGHT_ICONS = { shareholders: Users, shares: Layers, dividends: Coins } as const;

export default function DemoPage() {
  const t = useTranslations('demo');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />

      {/* Hero */}
      <section className="relative pt-32 pb-24 md:pt-44 md:pb-36">
        <AnimatedGridBg />

        <div className="relative max-w-4xl mx-auto px-6 text-center">
          <FadeIn>
            <Badge
              variant="secondary"
              className="mb-6 px-4 py-1.5 text-sm font-medium gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
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

          <FadeIn delay={240}>
            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <a href={DEMO_COOP_URL}>
                <Button size="lg" className="w-full sm:w-auto text-base px-8 h-12">
                  {t('hero.cta')}
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Credentials */}
      <section className="py-24 md:py-32 bg-muted/40">
        <div className="max-w-3xl mx-auto px-6">
          <FadeIn className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              {t('credentials.title')}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
              {t('credentials.subtitle')}
            </p>
          </FadeIn>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Admin card */}
            <FadeIn>
              <div className="rounded-2xl border-2 border-primary bg-card p-8 flex flex-col h-full relative">
                <Badge className="absolute -top-3 left-8 bg-primary text-primary-foreground">
                  {t('credentials.admin.badge')}
                </Badge>
                <div className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-primary/10 text-primary mb-4">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-bold mb-2">{t('credentials.admin.title')}</h3>
                <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                  {t('credentials.admin.description')}
                </p>
                <div className="space-y-3 mb-6 flex-1">
                  <CopyableCredential label={t('credentials.emailLabel')} value="admin@zonnecooperatie.be" />
                  <CopyableCredential label={t('credentials.passwordLabel')} value="demo1234" />
                </div>
                <a href={DEMO_COOP_URL}>
                  <Button size="lg" className="w-full text-base h-12">
                    {t('credentials.admin.cta')}
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </a>
              </div>
            </FadeIn>

            {/* Shareholder card */}
            <FadeIn delay={100}>
              <div className="rounded-2xl border bg-card p-8 flex flex-col h-full">
                <div className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-muted text-muted-foreground mb-4">
                  <Users className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-bold mb-2">{t('credentials.shareholder.title')}</h3>
                <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                  {t('credentials.shareholder.description')}
                </p>
                <div className="space-y-3 mb-6 flex-1">
                  <CopyableCredential label={t('credentials.emailLabel')} value="jan.peeters@email.be" />
                  <CopyableCredential label={t('credentials.passwordLabel')} value="demo1234" />
                </div>
                <a href={DEMO_COOP_URL}>
                  <Button size="lg" variant="outline" className="w-full text-base h-12">
                    {t('credentials.shareholder.cta')}
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </a>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* What's included */}
      <section className="py-24 md:py-32">
        <div className="max-w-4xl mx-auto px-6">
          <FadeIn className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              {t('included.title')}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              {t('included.subtitle')}
            </p>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-6">
            {HIGHLIGHTS.map((key, i) => {
              const Icon = HIGHLIGHT_ICONS[key];
              return (
                <FadeIn key={key} delay={i * 80}>
                  <div className="group relative rounded-xl border bg-card p-6 hover:shadow-lg hover:border-primary/20 transition-all duration-300 text-center">
                    <div className="mb-4 inline-flex items-center justify-center w-11 h-11 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
                      <Icon className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">
                      {t(`included.${key}.title`)}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t(`included.${key}.description`)}
                    </p>
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative py-24 md:py-32 overflow-hidden bg-muted/40">
        <FadeIn className="relative max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
            {t('cta.title')}
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
            {t('cta.subtitle')}
          </p>
          <div className="mt-10">
            <a href={DEMO_COOP_URL}>
              <Button size="lg" className="text-base px-8 h-12">
                {t('cta.primary')}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </a>
          </div>
        </FadeIn>
      </section>

      <MarketingFooter />
    </div>
  );
}
