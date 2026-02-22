'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  Users,
  Layers,
  Coins,
  Landmark,
  FileText,
  Palette,
  Github,
  ArrowRight,
  Shield,
  Server,
  Database,
  Globe,
  ChevronDown,
} from 'lucide-react';
import { useEffect, useState, useRef } from 'react';

const GITHUB_URL = 'https://github.com/opencoophq/opencoop';

function useScrolled(threshold = 10) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

function AnimatedGridBg() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div className="absolute inset-0 opacity-[0.03]">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>
      <div
        className="absolute top-1/4 -left-32 w-[600px] h-[600px] rounded-full opacity-20 blur-[120px]"
        style={{ background: 'hsl(221.2, 83.2%, 53.3%)' }}
      />
      <div
        className="absolute bottom-1/4 -right-32 w-[500px] h-[500px] rounded-full opacity-10 blur-[100px]"
        style={{ background: 'hsl(221.2, 83.2%, 53.3%)' }}
      />
    </div>
  );
}

function FadeIn({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(20px)',
        transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

const FEATURES = [
  { key: 'shareholders', icon: Users },
  { key: 'shares', icon: Layers },
  { key: 'dividends', icon: Coins },
  { key: 'banking', icon: Landmark },
  { key: 'documents', icon: FileText },
  { key: 'multiTenant', icon: Palette },
] as const;

const STEPS = ['step1', 'step2', 'step3'] as const;

const OS_BADGES = [
  { key: 'license', icon: Shield },
  { key: 'selfHosted', icon: Server },
  { key: 'dataOwnership', icon: Database },
] as const;

export default function HomePage() {
  const t = useTranslations('landing');
  const scrolled = useScrolled();
  const pathname = usePathname();
  const router = useRouter();

  const switchLocale = (locale: 'nl' | 'en') => {
    router.replace(pathname, { locale });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ─── Sticky Nav ─── */}
      <nav
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-background/80 backdrop-blur-xl border-b shadow-sm'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 h-16">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-primary-foreground">
              <Building2 className="w-5 h-5" />
            </div>
            <span className="text-lg font-bold tracking-tight">OpenCoop</span>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                {t('nav.login')}
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm">{t('nav.register')}</Button>
            </Link>
          </div>
        </div>
      </nav>

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
              <Link href="/register">
                <Button size="lg" className="w-full sm:w-auto text-base px-8 h-12">
                  {t('hero.cta')}
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
                  {t('hero.secondaryCta')}
                </Button>
              </a>
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

      {/* ─── Open Source ─── */}
      <section className="py-24 md:py-32 bg-muted/40">
        <div className="max-w-4xl mx-auto px-6">
          <FadeIn className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              {t('openSource.title')}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">
              {t('openSource.subtitle')}
            </p>
          </FadeIn>

          <div className="grid sm:grid-cols-3 gap-6">
            {OS_BADGES.map(({ key, icon: Icon }, i) => (
              <FadeIn key={key} delay={i * 100}>
                <div className="text-center p-6 rounded-xl border bg-card">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mb-4">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-semibold mb-1">{t(`openSource.${key}`)}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t(`openSource.${key}Description`)}
                  </p>
                </div>
              </FadeIn>
            ))}
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
            <Link href="/register">
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

      {/* ─── Footer ─── */}
      <footer className="border-t py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              <span className="font-medium text-foreground">
                {t('footer.copyright')}
              </span>
            </div>
            <span className="hidden sm:inline">&middot;</span>
            <span>{t('footer.license')}</span>
          </div>

          <div className="flex items-center gap-2">
            <Globe className="w-3.5 h-3.5" />
            <span className="text-xs">{t('footer.language')}:</span>
            <button
              onClick={() => switchLocale('nl')}
              className="text-xs hover:text-foreground transition-colors underline-offset-2 hover:underline"
            >
              NL
            </button>
            <span className="text-xs">/</span>
            <button
              onClick={() => switchLocale('en')}
              className="text-xs hover:text-foreground transition-colors underline-offset-2 hover:underline"
            >
              EN
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
