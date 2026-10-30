import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif, JetBrains_Mono, Outfit } from 'next/font/google';
import type { ReactNode } from 'react';
import { themeScript } from '@receipts/react';
import { WEB_URL } from '@/lib/env';
import { splashScript } from '@/lib/visitor';
import './globals.css';
import { Providers } from './providers';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(WEB_URL),
  title: { default: 'Receipts · No receipt, no review.', template: '%s · Receipts' },
  description: 'Verified voice reviews of anything you bought, from verified unique humans, that anyone can re-check. AI agents pay to cite them; reviewers get paid.',
  applicationName: 'Receipts',
  appleWebApp: { capable: true, title: 'Receipts', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/apple-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3e7d7' },
    { media: '(prefers-color-scheme: dark)', color: '#030f24' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning className={`${outfit.variable} ${inter.variable} ${mono.variable} ${serif.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript() }} />
        <script dangerouslySetInnerHTML={{ __html: splashScript() }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
