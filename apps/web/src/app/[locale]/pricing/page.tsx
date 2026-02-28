import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { PricingPage } from './pricing-page';

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
    languages[loc] = `${BASE_URL}/${loc}/pricing`;
  }

  return {
    title: t('pricing.title'),
    description: t('pricing.description'),
    alternates: {
      canonical: `${BASE_URL}/${locale}/pricing`,
      languages,
    },
    openGraph: {
      title: t('pricing.title'),
      description: t('pricing.description'),
      url: `${BASE_URL}/${locale}/pricing`,
    },
  };
}

export default function Page() {
  const isWaitlistMode = process.env.LAUNCH_MODE === 'waitlist';
  return <PricingPage isWaitlistMode={isWaitlistMode} />;
}
