'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface YearFilterProps {
  type: 'year';
  year: string;
  onYearChange: (year: string) => void;
  onGenerate: () => void;
  loading?: boolean;
}

interface DateRangeFilterProps {
  type: 'dateRange';
  from: string;
  to: string;
  onFromChange: (from: string) => void;
  onToChange: (to: string) => void;
  onGenerate: () => void;
  loading?: boolean;
}

interface NoFilterProps {
  type: 'none';
  onGenerate: () => void;
  loading?: boolean;
}

type ReportFiltersProps = YearFilterProps | DateRangeFilterProps | NoFilterProps;

export function ReportFilters(props: ReportFiltersProps) {
  const t = useTranslations('reports');
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => String(currentYear - i));

  return (
    <div className="flex flex-wrap items-end gap-3">
      {props.type === 'year' && (
        <div>
          <label className="text-sm text-muted-foreground mb-1 block">{t('year')}</label>
          <Select value={props.year} onValueChange={props.onYearChange}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {props.type === 'dateRange' && (
        <>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t('from')}</label>
            <input
              type="date"
              value={props.from}
              onChange={(e) => props.onFromChange(e.target.value)}
              className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t('to')}</label>
            <input
              type="date"
              value={props.to}
              onChange={(e) => props.onToChange(e.target.value)}
              className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </>
      )}
      <Button onClick={props.onGenerate} disabled={props.loading}>
        {props.loading ? t('generating') : t('generate')}
      </Button>
    </div>
  );
}
