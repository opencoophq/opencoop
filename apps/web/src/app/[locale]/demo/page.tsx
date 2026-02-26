import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import DemoPage from './demo-page';

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
    languages[loc] = `${BASE_URL}/${loc}/demo`;
  }

  return {
    title: t('demo.title'),
    description: t('demo.description'),
    alternates: {
      canonical: `${BASE_URL}/${locale}/demo`,
      languages,
    },
    openGraph: {
      title: t('demo.title'),
      description: t('demo.description'),
      url: `${BASE_URL}/${locale}/demo`,
    },
  };
}

export default function Page() {
  return <DemoPage />;
}
