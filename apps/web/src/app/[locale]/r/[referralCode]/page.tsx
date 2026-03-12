import { notFound, redirect } from 'next/navigation';

type ResolveReferralResponse = {
  coopSlug: string;
  referralCode: string;
};

export default async function ReferralRedirectPage({
  params,
}: {
  params: Promise<{ locale: string; referralCode: string }>;
}) {
  const { locale, referralCode } = await params;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const res = await fetch(`${apiUrl}/coops/referral/${encodeURIComponent(referralCode)}`, {
    cache: 'no-store',
  });

  if (!res.ok) {
    notFound();
  }

  const target = await res.json() as ResolveReferralResponse;
  redirect(`/${locale}/${target.coopSlug}/register?ref=${encodeURIComponent(target.referralCode)}`);
}
