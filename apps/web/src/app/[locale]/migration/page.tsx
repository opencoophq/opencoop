import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import MigrationPage from './migration-page';

const BASE_URL = 'https://opencoop.be';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'metadata' });

  const languages: Record<string, string> = {};
  for (const loc of routing.locales) {
    languages[loc] = `${BASE_URL}/${loc}/migration`;
  }

  return {
    title: t('migration.title'),
    description: t('migration.description'),
    alternates: {
      canonical: `${BASE_URL}/${locale}/migration`,
      languages,
    },
    openGraph: {
      title: t('migration.title'),
      description: t('migration.description'),
      url: `${BASE_URL}/${locale}/migration`,
    },
  };
}

export default function Page() {
  return <MigrationPage />;
}
