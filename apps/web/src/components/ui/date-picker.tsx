'use client';

import * as React from 'react';
import { format, parse, isValid, type Locale } from 'date-fns';
import { nl, enGB, enUS, de, fr } from 'date-fns/locale';
import { DayPicker, getDefaultClassNames } from 'react-day-picker';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLocale, LocaleCode } from '@/contexts/locale-context';

import 'react-day-picker/style.css';

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
  defaultMonth?: Date; // Month to show when calendar opens (defaults to current month)
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
  disabled = false,
  className,
  defaultMonth,
}: DatePickerProps) {
  const { locale } = useLocale();
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('');

  const dateLocale = localeMap[locale] || nl;
  const dateFormat = dateFormatMap[locale] || 'dd/MM/yyyy';
  const defaultClassNames = getDefaultClassNames();

  // Parse ISO string to Date
  const selectedDate = React.useMemo(() => {
    if (!value) return undefined;
    try {
      return new Date(value);
    } catch {
      return undefined;
    }
  }, [value]);

  // Sync input value when external value changes
  React.useEffect(() => {
    if (selectedDate && !isNaN(selectedDate.getTime())) {
      setInputValue(format(selectedDate, dateFormat, { locale: dateLocale }));
    } else {
      setInputValue('');
    }
  }, [selectedDate, dateFormat, dateLocale]);

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      const isoDate = format(date, 'yyyy-MM-dd');
      onChange?.(isoDate);
    } else {
      onChange?.(undefined);
    }
    setOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setInputValue(text);
    const parsed = parse(text, dateFormat, new Date());
    if (isValid(parsed) && parsed.getFullYear() >= 1920 && parsed.getFullYear() <= 2100) {
      onChange?.(format(parsed, 'yyyy-MM-dd'));
    }
  };

  const handleInputBlur = () => {
    // Reset input to last valid value on blur
    if (selectedDate && !isNaN(selectedDate.getTime())) {
      setInputValue(format(selectedDate, dateFormat, { locale: dateLocale }));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn('relative', className)}>
        <Input
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          placeholder={placeholder}
          disabled={disabled}
          className="pr-10"
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-auto p-0" align="start">
        <DayPicker
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate || defaultMonth}
          onSelect={handleSelect}
          locale={dateLocale}
          captionLayout="dropdown"
          startMonth={new Date(1920, 0)}
          endMonth={new Date(2100, 11)}
          showOutsideDays
          classNames={{
            root: `${defaultClassNames.root} p-3`,
            months: `${defaultClassNames.months}`,
            month: `${defaultClassNames.month}`,
            month_caption: `${defaultClassNames.month_caption} flex justify-center pt-1 relative items-center`,
            caption_label: `${defaultClassNames.caption_label} text-sm font-medium`,
            nav: `${defaultClassNames.nav} space-x-1 flex items-center`,
            button_previous: `${defaultClassNames.button_previous} h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 inline-flex items-center justify-center rounded-md border border-input absolute left-1`,
            button_next: `${defaultClassNames.button_next} h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 inline-flex items-center justify-center rounded-md border border-input absolute right-1`,
            month_grid: `${defaultClassNames.month_grid} w-full border-collapse`,
            weekdays: `${defaultClassNames.weekdays}`,
            weekday: `${defaultClassNames.weekday} text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]`,
            week: `${defaultClassNames.week}`,
            day: `${defaultClassNames.day} h-9 w-9 text-center text-sm p-0 relative`,
            day_button: `${defaultClassNames.day_button} h-9 w-9 p-0 font-normal rounded-md hover:bg-accent hover:text-accent-foreground inline-flex items-center justify-center`,
            selected: `${defaultClassNames.selected} bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground`,
            today: `${defaultClassNames.today} bg-accent text-accent-foreground`,
            outside: `${defaultClassNames.outside} text-muted-foreground opacity-50`,
            disabled: `${defaultClassNames.disabled} text-muted-foreground opacity-50`,
            hidden: `${defaultClassNames.hidden} invisible`,
            dropdowns: `${defaultClassNames.dropdowns} flex gap-2 justify-center`,
            dropdown: `${defaultClassNames.dropdown} text-sm`,
            months_dropdown: `${defaultClassNames.months_dropdown} rounded-md border border-input bg-background px-2 py-1`,
            years_dropdown: `${defaultClassNames.years_dropdown} rounded-md border border-input bg-background px-2 py-1`,
          }}
          components={{
            Chevron: ({ orientation }) => {
              if (orientation === 'left') {
                return <ChevronLeft className="h-4 w-4" />;
              }
              return <ChevronRight className="h-4 w-4" />;
            },
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
