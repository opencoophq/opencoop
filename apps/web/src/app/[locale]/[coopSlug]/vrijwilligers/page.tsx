import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import VolunteerSignupForm from './signup-form';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'metadata' });
  return {
    title: t('volunteers.title'),
    description: t('volunteers.description'),
  };
}

export default async function VolunteerSignupPage({
  params,
}: {
  params: Promise<{ coopSlug: string }>;
}) {
  const { coopSlug } = await params;
  return <VolunteerSignupForm coopSlug={coopSlug} />;
}
