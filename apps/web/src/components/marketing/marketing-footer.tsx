'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { Building2, Globe } from 'lucide-react';

const locales = [
  { code: 'nl', label: 'NL' },
  { code: 'en', label: 'EN' },
  { code: 'fr', label: 'FR' },
  { code: 'de', label: 'DE' },
] as const;

export function MarketingFooter() {
  const t = useTranslations('landing');
  const pathname = usePathname();
  const router = useRouter();

  const switchLocale = (locale: string) => {
    router.replace(pathname, { locale });
  };

  return (
    <footer className="border-t py-8">
      <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            <span className="font-medium text-foreground">{t('footer.copyright')}</span>
          </div>
          <span className="hidden sm:inline">&middot;</span>
          <span>{t('footer.license')}</span>
        </div>

        <div className="flex items-center gap-2">
          <Globe className="w-3.5 h-3.5" />
          <span className="text-xs">{t('footer.language')}:</span>
          {locales.map((l, i) => (
            <span key={l.code} className="flex items-center gap-2">
              {i > 0 && <span className="text-xs">/</span>}
              <button
                onClick={() => switchLocale(l.code)}
                className="text-xs hover:text-foreground transition-colors underline-offset-2 hover:underline"
              >
                {l.label}
              </button>
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
