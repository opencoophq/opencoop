import { RootProvider } from 'fumadocs-ui/provider';
import { I18nProvider, type Translations } from 'fumadocs-ui/i18n';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { i18n } from '@/lib/i18n';
import '../global.css';

const inter = Inter({ subsets: ['latin'] });

const localeNames: Record<string, string> = {
  en: 'English',
  nl: 'Nederlands',
  fr: 'Français',
  de: 'Deutsch',
};

const translations: Record<string, Partial<Translations>> = {
  nl: {
    search: 'Zoeken',
    searchNoResult: 'Geen resultaten gevonden',
    toc: 'Op deze pagina',
    tocNoHeadings: 'Geen koppen',
    lastUpdate: 'Laatst bijgewerkt',
    chooseLanguage: 'Kies taal',
    nextPage: 'Volgende',
    previousPage: 'Vorige',
  },
  fr: {
    search: 'Rechercher',
    searchNoResult: 'Aucun résultat trouvé',
    toc: 'Sur cette page',
    tocNoHeadings: 'Pas de titres',
    lastUpdate: 'Dernière mise à jour',
    chooseLanguage: 'Choisir la langue',
    nextPage: 'Suivant',
    previousPage: 'Précédent',
  },
  de: {
    search: 'Suchen',
    searchNoResult: 'Keine Ergebnisse gefunden',
    toc: 'Auf dieser Seite',
    tocNoHeadings: 'Keine Überschriften',
    lastUpdate: 'Zuletzt aktualisiert',
    chooseLanguage: 'Sprache wählen',
    nextPage: 'Weiter',
    previousPage: 'Zurück',
  },
};

export default function RootLayout({
  params,
  children,
}: {
  params: { lang: string };
  children: ReactNode;
}) {
  return (
    <html lang={params.lang} suppressHydrationWarning>
      <body className={inter.className}>
        <I18nProvider
          locale={params.lang}
          locales={i18n.languages.map((lang) => ({
            locale: lang,
            name: localeNames[lang] ?? lang,
          }))}
          translations={translations[params.lang]}
        >
          <RootProvider>
            {children}
          </RootProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
