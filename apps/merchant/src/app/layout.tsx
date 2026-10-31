import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif, JetBrains_Mono, Outfit } from 'next/font/google';
import type { ReactNode } from 'react';
import { CurtainFooter, themeScript } from '@receipts/react';
import { Nav } from '@/components/nav';
import { WEB_URL } from '@/lib/env';
import './globals.css';
import { Providers } from './providers';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument', display: 'swap' });

export const metadata: Metadata = {
  title: { default: '₹eceipt for business', template: '%s · ₹eceipt for business' },
  description: 'Claim your listing, reply in public, see what verified buyers and AI agents say about you, and issue signed receipts.',
  icons: { icon: { url: '/business/icon.svg?v=rupee-1', type: 'image/svg+xml', sizes: 'any' }, apple: '/business/apple-icon.png?v=rupee-1' },
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
        <Providers>
          {/* The page is a sheet that lifts off the navy footer, the same as the reviewer app; the column fills the window. */}
          <div className="flex min-h-dvh flex-col">
            <div className="relative z-10 flex-1 rounded-b-[40px] bg-bg shadow-sheet sm:rounded-b-[64px]">
              <Nav />
              <main className="mx-auto max-w-5xl px-4 pt-8 pb-24 sm:px-6 sm:pt-10">{children}</main>
            </div>
            <CurtainFooter
              sub="Business"
              links={[
                { href: '/', label: 'Your listings', icon: 'dashboard' },
                { href: '/claim', label: 'Claim a listing', icon: 'claim' },
                { href: '/billing', label: 'Plans', icon: 'plans' },
                { href: WEB_URL, label: 'Receipts for reviewers', icon: 'receipt' },
              ]}
            >
              Businesses can claim a listing, reply in public and issue signed receipts. No plan, on any tier, can delete, hide, edit or re-rank a review.
            </CurtainFooter>
          </div>
        </Providers>
      </body>
    </html>
  );
}
