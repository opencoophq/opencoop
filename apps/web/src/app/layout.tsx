import type { Metadata } from 'next';
import './globals.css';

const BASE_URL = 'https://opencoop.be';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'OpenCoop — Shareholder Management for Cooperatives',
    template: '%s | OpenCoop',
  },
  description: 'The open-source platform that helps cooperatives manage shareholders, shares, dividends, and documents — all in one place.',
  openGraph: {
    type: 'website',
    siteName: 'OpenCoop',
    locale: 'nl_BE',
    alternateLocale: ['en_US', 'fr_FR', 'de_DE'],
  },
  twitter: {
    card: 'summary_large_image',
  },
  robots: {
    index: true,
    follow: true,
  },
};

// <html> and <body> live in app/[locale]/layout.tsx, so <html lang> matches the locale
// (needed for correct `hyphens: auto` and screen readers). This layout only passes through.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
