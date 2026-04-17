'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { Loader2, Check } from 'lucide-react';

interface HouseholdCandidate {
  shareholderId: string;
  email: string;
  fullName: string;
  shareholderCount: number;
}

interface LinkShareholderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coopId: string;
  shareholderId: string;
  onLinked: () => void;
}

export function LinkShareholderDialog({
  open,
  onOpenChange,
  coopId,
  shareholderId,
  onLinked,
}: LinkShareholderDialogProps) {
  const t = useTranslations();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<HouseholdCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<HouseholdCandidate | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setResults([]);
      setSelected(null);
      setError(null);
      setSearching(false);
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (search.length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const data = await api<HouseholdCandidate[]>(
          `/admin/coops/${coopId}/shareholders/${shareholderId}/household/search-users?search=${encodeURIComponent(search)}`,
        );
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, coopId, shareholderId]);

  const handleLink = async () => {
    if (!selected) return;
    setLinking(true);
    setError(null);
    try {
      await api(
        `/admin/coops/${coopId}/shareholders/${shareholderId}/household/link`,
        { method: 'POST', body: { targetShareholderId: selected.shareholderId } },
      );
      onOpenChange(false);
      onLinked();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setLinking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('household.linkTitle')}</DialogTitle>
          <DialogDescription>{t('household.linkIntro')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Input
            placeholder={t('household.searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelected(null);
            }}
            autoFocus
          />

          {searching && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('common.loading')}
            </div>
          )}

          {!searching && search.length >= 2 && results.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('common.noResults')}</p>
          )}

          {results.length > 0 && (
            <div className="rounded-md border divide-y">
              {results.map((candidate) => (
                <button
                  key={candidate.shareholderId}
                  type="button"
                  onClick={() => setSelected(candidate)}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center justify-between ${
                    selected?.shareholderId === candidate.shareholderId ? 'bg-muted' : ''
                  }`}
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{candidate.fullName}</span>
                    <span className="text-xs text-muted-foreground">{candidate.email}</span>
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    {selected?.shareholderId === candidate.shareholderId && (
                      <Check className="h-3 w-3 text-green-600" />
                    )}
                    {t('household.resultMeta', { count: candidate.shareholderCount })}
                  </span>
                </button>
              ))}
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('household.cancel')}
          </Button>
          <Button onClick={handleLink} disabled={!selected || linking}>
            {linking && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('household.confirmLink')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
