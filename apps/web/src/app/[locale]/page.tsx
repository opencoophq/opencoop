import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import HomePage from './home-page';

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
  const t = await getTranslations({ locale, namespace: 'metadata' });

  const languages: Record<string, string> = {};
  for (const loc of routing.locales) {
    languages[loc] = `${BASE_URL}/${loc}`;
  }

  return {
    title: t('home.title'),
    description: t('home.description'),
    alternates: {
      canonical: `${BASE_URL}/${locale}`,
      languages,
    },
    openGraph: {
      title: t('home.title'),
      description: t('home.description'),
      url: `${BASE_URL}/${locale}`,
    },
  };
}

export default function Page() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'OpenCoop',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: 'Open-source cooperative shareholder management platform',
    url: BASE_URL,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
    },
    creator: {
      '@type': 'Organization',
      name: 'OpenCoop',
      url: BASE_URL,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <HomePage />
    </>
  );
}
