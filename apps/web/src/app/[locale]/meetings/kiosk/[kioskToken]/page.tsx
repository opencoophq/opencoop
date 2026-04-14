'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/contexts/locale-context';
import { resolveLogoUrl } from '@/lib/api';
import SignatureCanvas from 'react-signature-canvas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Search, Eraser, Check, ArrowLeft, PartyPopper } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type KioskState = 'LOADING' | 'INVALID' | 'SEARCH' | 'CONFIRM' | 'SIGN' | 'WELCOME';

interface KioskInfo {
  meetingId: string;
  meeting: { title: string; scheduledAt: string };
  coop: { name: string; logoUrl?: string | null };
}

interface ShareholderResult {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  memberNumber?: number | null;
  address?: string | null;
}

const WELCOME_TIMEOUT_MS = 3000;

export default function KioskPage() {
  const t = useTranslations();
  const params = useParams();
  const { locale } = useLocale();
  const token = (params?.kioskToken as string) || '';

  const [state, setState] = useState<KioskState>('LOADING');
  const [info, setInfo] = useState<KioskInfo | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ShareholderResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ShareholderResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signature pad ref. The library's typings differ across versions; cast to a
  // minimal shape that captures only the methods we use.
  const sigRef = useRef<{
    clear: () => void;
    isEmpty: () => boolean;
    toDataURL: (type?: string) => string;
  } | null>(null);

  // Validate kiosk token on mount
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/public/meetings/kiosk/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          setState('INVALID');
          return;
        }
        const data = (await r.json()) as KioskInfo;
        setInfo(data);
        setState('SEARCH');
      })
      .catch(() => setState('INVALID'));
  }, [token]);

  // Debounced search
  useEffect(() => {
    if (state !== 'SEARCH') return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_URL}/public/meetings/kiosk/${token}/search`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q }),
          },
        );
        if (res.ok) {
          const data = (await res.json()) as ShareholderResult[];
          setResults(data);
        } else {
          setResults([]);
        }
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, token, state]);

  // Auto-redirect from welcome
  useEffect(() => {
    if (state !== 'WELCOME') return;
    const handle = setTimeout(() => {
      setSelected(null);
      setQuery('');
      setResults([]);
      setError(null);
      setState('SEARCH');
    }, WELCOME_TIMEOUT_MS);
    return () => clearTimeout(handle);
  }, [state]);

  const handleSubmitCheckIn = async () => {
    if (!selected || !sigRef.current) return;
    if (sigRef.current.isEmpty()) {
      setError(t('meetings.kiosk.signatureRequired'));
      return;
    }
    const dataUrl = sigRef.current.toDataURL('image/png');
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/public/meetings/kiosk/${token}/check-in`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shareholderId: selected.id,
            signaturePngDataUrl: dataUrl,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message || t('meetings.kiosk.checkInError'));
        setSubmitting(false);
        return;
      }
      setState('WELCOME');
    } catch {
      setError(t('meetings.kiosk.checkInError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'LOADING') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (state === 'INVALID') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center space-y-3">
            <h2 className="text-xl font-semibold">
              {t('meetings.kiosk.invalidTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('meetings.kiosk.invalidBody')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const coopLogo = info ? resolveLogoUrl(info.coop.logoUrl) : null;
  const meetingDate = info
    ? new Date(info.meeting.scheduledAt).toLocaleDateString(locale, {
        dateStyle: 'long',
      })
    : '';

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-card border-b py-6 px-6 flex items-center justify-center gap-4">
        {coopLogo ? (
          <img
            src={coopLogo}
            alt={info?.coop.name || ''}
            className="h-12 max-w-[220px] object-contain"
          />
        ) : (
          <span className="text-2xl font-bold">{info?.coop.name}</span>
        )}
        <div className="text-center">
          <p className="text-lg font-semibold">{info?.meeting.title}</p>
          <p className="text-sm text-muted-foreground">{meetingDate}</p>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">
        {state === 'SEARCH' && (
          <div className="space-y-6">
            <h1 className="text-3xl font-bold text-center">
              {t('meetings.kiosk.searchHeading')}
            </h1>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground" />
              <Input
                autoFocus
                type="search"
                placeholder={t('meetings.kiosk.searchPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-16 text-lg pl-14"
              />
            </div>

            {searching && (
              <div className="text-center py-4">
                <Loader2 className="h-6 w-6 animate-spin inline" />
              </div>
            )}

            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <p className="text-center text-muted-foreground py-4">
                {t('meetings.kiosk.noResults')}
              </p>
            )}

            <div className="space-y-2">
              {results.map((r) => {
                const name = (`${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() ||
                  r.companyName ||
                  '—');
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setSelected(r);
                      setError(null);
                      setState('CONFIRM');
                    }}
                    className="w-full text-left p-5 bg-card border-2 rounded-xl hover:border-primary hover:bg-accent transition-all"
                  >
                    <p className="text-xl font-medium">{name}</p>
                    {r.memberNumber !== null && r.memberNumber !== undefined && (
                      <p className="text-sm text-muted-foreground">
                        #{r.memberNumber}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {state === 'CONFIRM' && selected && (
          <div className="space-y-8 text-center">
            <h1 className="text-3xl font-bold pt-8">
              {t('meetings.kiosk.confirmHeading')}
            </h1>
            <div className="py-6">
              <p className="text-4xl font-bold">
                {`${selected.firstName ?? ''} ${selected.lastName ?? ''}`.trim() ||
                  selected.companyName}
              </p>
              {selected.memberNumber !== null && selected.memberNumber !== undefined && (
                <p className="text-xl text-muted-foreground mt-2">
                  #{selected.memberNumber}
                </p>
              )}
              {selected.address && (
                <p className="text-sm text-muted-foreground mt-3">
                  {selected.address}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4 max-w-lg mx-auto">
              <Button
                size="lg"
                variant="outline"
                onClick={() => {
                  setSelected(null);
                  setState('SEARCH');
                }}
                className="h-16 text-base"
              >
                <ArrowLeft className="h-5 w-5 mr-2" />
                {t('meetings.kiosk.back')}
              </Button>
              <Button
                size="lg"
                onClick={() => setState('SIGN')}
                className="h-16 text-base bg-green-600 hover:bg-green-700 text-white"
              >
                <Check className="h-5 w-5 mr-2" />
                {t('meetings.kiosk.confirmYes')}
              </Button>
            </div>
          </div>
        )}

        {state === 'SIGN' && selected && (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-center">
              {t('meetings.kiosk.signHeading')}
            </h1>
            <p className="text-center text-muted-foreground">
              {t('meetings.kiosk.signSubheading')}
            </p>
            <div className="border-2 border-dashed rounded-xl bg-white">
              <SignatureCanvas
                ref={(ref) => {
                  sigRef.current = ref as unknown as typeof sigRef.current;
                }}
                penColor="black"
                canvasProps={{
                  className: 'w-full h-72 rounded-xl',
                }}
              />
            </div>
            {error && (
              <p className="text-center text-destructive text-sm">{error}</p>
            )}
            <div className="grid grid-cols-3 gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(null);
                  setError(null);
                  setState('SEARCH');
                }}
                className="h-14"
                disabled={submitting}
              >
                <ArrowLeft className="h-5 w-5 mr-2" />
                {t('meetings.kiosk.back')}
              </Button>
              <Button
                variant="outline"
                onClick={() => sigRef.current?.clear()}
                className="h-14"
                disabled={submitting}
              >
                <Eraser className="h-5 w-5 mr-2" />
                {t('meetings.kiosk.clear')}
              </Button>
              <Button
                onClick={handleSubmitCheckIn}
                disabled={submitting}
                className="h-14 bg-green-600 hover:bg-green-700 text-white"
              >
                {submitting ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                ) : (
                  <Check className="h-5 w-5 mr-2" />
                )}
                {t('meetings.kiosk.confirmSign')}
              </Button>
            </div>
          </div>
        )}

        {state === 'WELCOME' && selected && (
          <div className="text-center pt-16 space-y-6">
            <PartyPopper className="h-20 w-20 text-green-600 mx-auto" />
            <h1 className="text-4xl font-bold">
              {t('meetings.kiosk.welcomeHeading', {
                name: selected.firstName || selected.companyName || '',
              })}
            </h1>
            <p className="text-lg text-muted-foreground">
              {t('meetings.kiosk.welcomeBody')}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
