'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, LogIn, UserPlus } from 'lucide-react';

interface CoopInfo {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  shareClasses: Array<{
    id: string;
    name: string;
    code: string;
    pricePerShare: number;
  }>;
}

export default function CoopPage() {
  const t = useTranslations();
  const params = useParams();
  const coopSlug = params.coopSlug as string;
  const [coop, setCoop] = useState<CoopInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function loadCoop() {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const res = await fetch(`${apiUrl}/coops/${coopSlug}/public-info`);
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        setCoop(data);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    loadCoop();
  }, [coopSlug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !coop) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">{t('errors.notFound')}</h1>
          <Link href="/">
            <Button variant="outline">{t('common.back')}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          {coop.logoUrl ? (
            <img src={coop.logoUrl} alt={coop.name} className="h-16 mx-auto mb-4" />
          ) : (
            <Building2 className="h-16 w-16 text-primary mx-auto mb-4" />
          )}
          <h1 className="text-3xl font-bold">{coop.name}</h1>
          {coop.description && (
            <p className="text-muted-foreground mt-2">{coop.description}</p>
          )}
        </div>

        {coop.shareClasses.length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>{t('admin.shareClasses.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {coop.shareClasses.map((sc) => (
                  <div key={sc.id} className="flex justify-between items-center py-2 border-b last:border-0">
                    <div>
                      <p className="font-medium">{sc.name}</p>
                      <p className="text-sm text-muted-foreground">{sc.code}</p>
                    </div>
                    <p className="font-medium">
                      &euro; {Number(sc.pricePerShare).toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href={`/${coopSlug}/login`}>
            <Button size="lg" className="w-full sm:w-auto">
              <LogIn className="h-4 w-4 mr-2" />
              {t('auth.login')}
            </Button>
          </Link>
          <Link href={`/${coopSlug}/register`}>
            <Button size="lg" variant="outline" className="w-full sm:w-auto">
              <UserPlus className="h-4 w-4 mr-2" />
              {t('auth.register')}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
