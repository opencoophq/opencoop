'use client';

import * as React from 'react';
import { format, parse } from 'date-fns';
import { nl, enGB, enUS, de, fr } from 'date-fns/locale';
import { DayPicker } from 'react-day-picker';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLocale, LocaleCode } from '@/contexts/locale-context';

// Map locale codes to date-fns locales
const localeMap: Record<LocaleCode, Locale> = {
  'nl-BE': nl,
  'nl-NL': nl,
  'en-GB': enGB,
  'en-US': enUS,
  'de-DE': de,
  'fr-FR': fr,
};

// Date format patterns per locale
const dateFormatMap: Record<LocaleCode, string> = {
  'nl-BE': 'dd/MM/yyyy',
  'nl-NL': 'dd-MM-yyyy',
  'en-GB': 'dd/MM/yyyy',
  'en-US': 'MM/dd/yyyy',
  'de-DE': 'dd.MM.yyyy',
  'fr-FR': 'dd/MM/yyyy',
};

interface DatePickerProps {
  value?: string; // ISO date string (YYYY-MM-DD)
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
  disabled = false,
  className,
}: DatePickerProps) {
  const { locale } = useLocale();
  const [open, setOpen] = React.useState(false);

  const dateLocale = localeMap[locale] || nl;
  const dateFormat = dateFormatMap[locale] || 'dd/MM/yyyy';

  // Parse ISO string to Date
  const selectedDate = React.useMemo(() => {
    if (!value) return undefined;
    try {
      return new Date(value);
    } catch {
      return undefined;
    }
  }, [value]);

  // Format date for display
  const displayValue = React.useMemo(() => {
    if (!selectedDate || isNaN(selectedDate.getTime())) return '';
    return format(selectedDate, dateFormat, { locale: dateLocale });
  }, [selectedDate, dateFormat, dateLocale]);

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      // Convert to ISO string (YYYY-MM-DD)
      const isoDate = format(date, 'yyyy-MM-dd');
      onChange?.(isoDate);
    } else {
      onChange?.(undefined);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-start text-left font-normal',
            !value && 'text-muted-foreground',
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {displayValue || placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <DayPicker
          mode="single"
          selected={selectedDate}
          onSelect={handleSelect}
          locale={dateLocale}
          showOutsideDays
          className="p-3"
          classNames={{
            months: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
            month: 'space-y-4',
            caption: 'flex justify-center pt-1 relative items-center',
            caption_label: 'text-sm font-medium',
            nav: 'space-x-1 flex items-center',
            nav_button: cn(
              'h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 inline-flex items-center justify-center rounded-md border border-input'
            ),
            nav_button_previous: 'absolute left-1',
            nav_button_next: 'absolute right-1',
            table: 'w-full border-collapse space-y-1',
            head_row: 'flex justify-between',
            head_cell: 'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem] text-center',
            row: 'flex w-full mt-2 justify-between',
            cell: 'h-9 w-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20',
            day: cn(
              'h-9 w-9 p-0 font-normal aria-selected:opacity-100 rounded-md hover:bg-accent hover:text-accent-foreground inline-flex items-center justify-center'
            ),
            day_range_end: 'day-range-end',
            day_selected:
              'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
            day_today: 'bg-accent text-accent-foreground',
            day_outside:
              'day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30',
            day_disabled: 'text-muted-foreground opacity-50',
            day_range_middle: 'aria-selected:bg-accent aria-selected:text-accent-foreground',
            day_hidden: 'invisible',
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
