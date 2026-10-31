import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif, JetBrains_Mono, Outfit } from 'next/font/google';
import type { ReactNode } from 'react';
import { CurtainFooter, MotionProvider, themeScript } from '@receipts/react';
import { Nav } from '@/components/nav';
import { RequireAdmin } from '@/lib/admin';
import { DEMO_URL, MERCHANT_URL, WEB_URL } from '@/lib/env';
import './globals.css';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument', display: 'swap' });

export const metadata: Metadata = {
  title: { default: '₹eceipt · admin', template: '%s · ₹eceipt admin' },
  description: 'Operator console: business claims, held reviews and trust flags, attestations waiting to anchor, Reclaim providers.',
  icons: { icon: { url: '/admin/icon.svg?v=rupee-1', type: 'image/svg+xml', sizes: 'any' }, apple: '/admin/apple-icon.png?v=rupee-1' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
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
      </head>
      <body className="min-h-dvh antialiased">
        <MotionProvider>
          <div className="flex min-h-dvh flex-col">
            <div className="relative z-10 flex-1 rounded-b-[40px] bg-bg shadow-sheet sm:rounded-b-[64px]">
              <Nav />
              <main className="mx-auto max-w-6xl px-4 pt-8 pb-24 sm:px-6 sm:pt-10">
                <RequireAdmin>{children}</RequireAdmin>
              </main>
            </div>
            <CurtainFooter
              sub="Admin"
              links={[
                { href: '/claims', label: 'Business claims', icon: 'claim' },
                { href: '/moderation', label: 'Moderation', icon: 'shield' },
                { href: WEB_URL, label: 'Reviewer site', icon: 'receipt' },
                { href: MERCHANT_URL, label: 'Business app', icon: 'store' },
                { href: DEMO_URL, label: 'Stage', icon: 'list' },
              ]}
            >
              Operators decide claims and held reviews here. Nothing in this console can edit, re-rank or hide a review.
            </CurtainFooter>
          </div>
        </MotionProvider>
      </body>
    </html>
  );
}
