'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export type LocaleCode = 'nl-BE' | 'nl-NL' | 'en-US' | 'en-GB' | 'de-DE' | 'fr-FR';

interface LocaleContextValue {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'nl-BE',
  setLocale: () => {},
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>('nl-BE');

  useEffect(() => {
    const saved = localStorage.getItem('opencoop-locale') as LocaleCode | null;
    if (saved) {
      setLocaleState(saved);
    }
  }, []);

  const setLocale = (newLocale: LocaleCode) => {
    setLocaleState(newLocale);
    localStorage.setItem('opencoop-locale', newLocale);
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
