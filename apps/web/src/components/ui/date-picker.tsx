'use client';

import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { format, parse } from 'date-fns';
import { nl, fr, de, enUS, type Locale } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLocale } from '@/contexts/locale-context';

const localeMap: Record<string, Locale> = {
  nl: nl,
  'nl-BE': nl,
  'nl-NL': nl,
  fr: fr,
  'fr-BE': fr,
  'fr-FR': fr,
  de: de,
  'de-DE': de,
  en: enUS,
  'en-US': enUS,
  'en-GB': enUS,
};

interface DatePickerProps {
  value?: string; // ISO date string (YYYY-MM-DD)
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  defaultMonth?: Date;
  /** Enable dropdown navigation for month/year (useful for birthdates). Requires fromYear+toYear. */
  captionLayout?: 'label' | 'dropdown' | 'dropdown-months' | 'dropdown-years';
  fromYear?: number;
  toYear?: number;
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
  defaultMonth,
  captionLayout,
  fromYear,
  toYear,
}: DatePickerProps) {
  const { locale } = useLocale();
  const [open, setOpen] = React.useState(false);

  const dateFnsLocale = localeMap[locale] || localeMap[locale.split('-')[0]] || enUS;

  const selected = value ? parse(value, 'yyyy-MM-dd', new Date()) : undefined;

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      onChange?.(format(date, 'yyyy-MM-dd'));
    } else {
      onChange?.(undefined);
    }
    setOpen(false);
  };

  const displayValue = selected
    ? selected.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
    : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-start text-left font-normal',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {displayValue || placeholder || 'Pick a date'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <DayPicker
          mode="single"
          selected={selected}
          onSelect={handleSelect}
          defaultMonth={selected || defaultMonth}
          locale={dateFnsLocale}
          captionLayout={captionLayout}
          fromYear={fromYear}
          toYear={toYear}
          className="p-3"
          classNames={{
            months: 'flex flex-col sm:flex-row gap-2',
            month: 'flex flex-col gap-4',
            month_caption: 'flex justify-center pt-1 relative items-center',
            caption_label: 'text-sm font-medium',
            nav: 'flex items-center gap-1',
            button_previous:
              'absolute left-1 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 inline-flex items-center justify-center',
            button_next:
              'absolute right-1 h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 inline-flex items-center justify-center',
            month_grid: 'w-full border-collapse',
            weekdays: 'flex',
            weekday: 'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]',
            week: 'flex w-full mt-2',
            day: 'h-9 w-9 text-center text-sm p-0 relative',
            day_button:
              'h-9 w-9 p-0 font-normal rounded-md hover:bg-accent hover:text-accent-foreground inline-flex items-center justify-center',
            selected: 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
            today: 'bg-accent text-accent-foreground',
            outside: 'text-muted-foreground opacity-50',
            disabled: 'text-muted-foreground opacity-50',
            dropdown_root: 'relative inline-flex items-center',
            dropdown:
              'appearance-none border border-input rounded-md bg-background px-2 py-1 text-sm font-medium cursor-pointer',
            dropdowns: 'flex gap-2 justify-center',
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
