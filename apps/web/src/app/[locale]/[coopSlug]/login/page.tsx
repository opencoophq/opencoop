'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { notFound } from 'next/navigation';
import { EmailFirstLogin } from '@/components/auth/email-first-login';

interface CoopPublicInfo {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}

export default function CoopLoginPage() {
  const params = useParams();
  const coopSlug = params.coopSlug as string;
  const [coop, setCoop] = useState<CoopPublicInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFoundError, setNotFoundError] = useState(false);

  useEffect(() => {
    const fetchCoop = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/coops/${coopSlug}/public-info`
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
  }, [coopSlug]);

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
    <EmailFirstLogin
      coop={{
        name: coop.name,
        logoUrl: coop.logoUrl,
        primaryColor: coop.primaryColor,
        secondaryColor: coop.secondaryColor,
        slug: coop.slug,
      }}
    />
  );
}
