import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { Loader2 } from 'lucide-react';
import ChargeCardEntry from './entry';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'metadata' });
  return {
    title: t('chargeCards.title'),
    description: t('chargeCards.description'),
  };
}

export default async function ChargeCardEntryPage({
  params,
}: {
  params: Promise<{ coopSlug: string }>;
}) {
  const { coopSlug } = await params;
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <ChargeCardEntry coopSlug={coopSlug} />
    </Suspense>
  );
}
