'use client';

import { useEffect, useState } from 'react';
import { notFound, useRouter } from 'next/navigation';
import { EmailFirstLogin } from '@/components/auth/email-first-login';

interface CoopPublicInfo {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}

export function CoopLoginContent({
  coopSlug,
  channelSlug,
}: {
  coopSlug: string;
  channelSlug: string;
}) {
  const router = useRouter();
  const [coop, setCoop] = useState<CoopPublicInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('accessToken')) {
      router.replace('/dashboard');
      return;
    }
  }, [router]);

  useEffect(() => {
    const fetchCoop = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/coops/${coopSlug}/channels/${channelSlug}/public-info`
        );

        if (response.status === 404) {
          setNotFoundError(true);
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to fetch coop');
        }

        const data = await response.json();
        setCoop(data);
      } catch {
        setNotFoundError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchCoop();
  }, [coopSlug, channelSlug]);

  if (notFoundError) {
    notFound();
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!coop) {
    notFound();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <EmailFirstLogin
          coop={{
            name: coop.name,
            logoUrl: coop.logoUrl,
            primaryColor: coop.primaryColor,
            secondaryColor: coop.secondaryColor,
            slug: coop.slug,
          }}
        />
      </div>
    </div>
  );
}
