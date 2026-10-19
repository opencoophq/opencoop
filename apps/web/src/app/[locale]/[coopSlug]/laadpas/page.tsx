import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import ChargeCardEntry from './entry-page';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'metadata' });
  return {
    title: t('chargeCardEntry.title'),
    description: t('chargeCardEntry.description'),
  };
}

export default async function ChargeCardEntryPage({
  params,
}: {
  params: Promise<{ coopSlug: string }>;
}) {
  const { coopSlug } = await params;
  return <ChargeCardEntry coopSlug={coopSlug} />;
}
