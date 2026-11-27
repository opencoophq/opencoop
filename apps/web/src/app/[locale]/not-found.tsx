import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { MarketingNav } from '@/components/marketing/marketing-nav';

// Renders for every notFound() under [locale], server- or client-side, inside the locale
// layout: <html lang>, theme and translations come from there. Next passes no params to
// not-found; next-intl resolves the locale from the request. Requests outside a locale
// segment use app/not-found.tsx instead.
export default function LocaleNotFound() {
  const t = useTranslations('errors');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MarketingNav />
      <main
        data-testid="locale-not-found"
        className="flex min-h-screen flex-col items-center justify-center px-6 pt-16 text-center"
      >
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground tabular-nums">
          404
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight md:text-4xl">{t('notFound')}</h1>
        <p className="mt-4 max-w-[46ch] text-base leading-normal text-muted-foreground">
          {t('notFoundDescription')}
        </p>
        <Button asChild size="lg" className="mt-8">
          <Link href="/">{t('backToHome')}</Link>
        </Button>
      </main>
    </div>
  );
}
