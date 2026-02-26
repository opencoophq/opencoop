import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
