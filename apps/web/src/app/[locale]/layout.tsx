import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { LocaleProvider } from '@/contexts/locale-context';

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
      locale: locale === 'nl' ? 'nl_BE' : locale === 'fr' ? 'fr_FR' : locale === 'de' ? 'de_DE' : 'en_US',
      url: `${BASE_URL}/${locale}`,
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as 'nl' | 'en' | 'fr' | 'de')) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <LocaleProvider>{children}</LocaleProvider>
    </NextIntlClientProvider>
  );
}
