import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { TERMS_VERSION } from '@opencoop/shared';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const revalidate = 3600;

const BASE_URL = 'https://opencoop.be';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal' });

  const languages: Record<string, string> = {};
  for (const loc of routing.locales) {
    languages[loc] = `${BASE_URL}/${loc}/terms`;
  }

  return {
    title: t('termsTitle'),
    alternates: {
      languages,
      canonical: `${BASE_URL}/${locale}/terms`,
    },
  };
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal' });

  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold mb-2">{t('termsTitle')}</h1>
      <p className="text-muted-foreground mb-8">
        {t('lastUpdated', { date: TERMS_VERSION })}
      </p>
      <div className="prose dark:prose-invert max-w-none whitespace-pre-line">
        {t('termsContent')}
      </div>
    </div>
  );
}
