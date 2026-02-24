'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Building2, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

function useScrolled(threshold = 10) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

export function MarketingNav() {
  const t = useTranslations('landing');
  const scrolled = useScrolled();
  const pathname = usePathname();
  const isPricing = pathname === '/pricing';
  const isDemo = pathname === '/demo';
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled || mobileOpen
          ? 'bg-background/80 backdrop-blur-xl border-b shadow-sm'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto flex items-center justify-between px-6 h-16">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary text-primary-foreground">
            <Building2 className="w-5 h-5" />
          </div>
          <span className="text-lg font-bold tracking-tight">OpenCoop</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-3">
          <Link href="/pricing">
            <Button
              variant="ghost"
              size="sm"
              className={isPricing ? 'text-primary' : ''}
            >
              {t('nav.pricing')}
            </Button>
          </Link>
          <Link href="/demo">
            <Button
              variant="ghost"
              size="sm"
              className={isDemo ? 'text-primary' : ''}
            >
              {t('nav.demo')}
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="ghost" size="sm">
              {t('nav.login')}
            </Button>
          </Link>
          <Link href="/pricing">
            <Button size="sm">{t('nav.register')}</Button>
          </Link>
          <LanguageSwitcher />
          <ThemeToggle />
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="md:hidden p-2 -mr-2"
          aria-label="Toggle menu"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu panel */}
      {mobileOpen && (
        <div className="md:hidden border-t bg-background/95 backdrop-blur-xl">
          <div className="flex flex-col gap-1 px-6 py-4">
            <Link href="/pricing" onClick={() => setMobileOpen(false)}>
              <Button
                variant="ghost"
                size="sm"
                className={`w-full justify-start ${isPricing ? 'text-primary' : ''}`}
              >
                {t('nav.pricing')}
              </Button>
            </Link>
            <Link href="/demo" onClick={() => setMobileOpen(false)}>
              <Button
                variant="ghost"
                size="sm"
                className={`w-full justify-start ${isDemo ? 'text-primary' : ''}`}
              >
                {t('nav.demo')}
              </Button>
            </Link>
            <Link href="/login" onClick={() => setMobileOpen(false)}>
              <Button variant="ghost" size="sm" className="w-full justify-start">
                {t('nav.login')}
              </Button>
            </Link>
            <Link href="/pricing" onClick={() => setMobileOpen(false)}>
              <Button size="sm" className="w-full mt-1">
                {t('nav.register')}
              </Button>
            </Link>
            <div className="flex items-center gap-3 pt-3 border-t mt-2">
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
