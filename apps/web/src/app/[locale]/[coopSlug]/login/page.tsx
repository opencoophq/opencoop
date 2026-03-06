import { redirect } from 'next/navigation';

export default async function CoopLoginPage({
  params,
}: {
  params: Promise<{ locale: string; coopSlug: string }>;
}) {
  const { locale, coopSlug } = await params;
  redirect(`/${locale}/${coopSlug}/default/login`);
}
