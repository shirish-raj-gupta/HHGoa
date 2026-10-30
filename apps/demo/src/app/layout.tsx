import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif, JetBrains_Mono, Outfit } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo, MotionProvider, ThemeToggle, themeScript } from '@receipts/react';
import { StageNav } from '@/components/stage-nav';
import { Ticker } from '@/components/ticker';
import './globals.css';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument', display: 'swap' });

export const metadata: Metadata = {
  title: 'Receipts · stage',
  description: 'The poisoned web against verified receipts, the attack, and the week in numbers.',
  icons: { icon: '/stage/icon.svg', apple: '/stage/apple-icon.png' },
  robots: { index: false },
};

export const viewport: Viewport = { themeColor: '#030f24' };

// The stage is projected, so it starts dark (navy and lime carry across a room); the toggle switches to skin.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" data-scroll-behavior="smooth" suppressHydrationWarning className={`${outfit.variable} ${inter.variable} ${mono.variable} ${serif.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript('dark') }} />
      </head>
      <body className="min-h-dvh antialiased">
        <MotionProvider>
          <header className="sticky top-0 z-30 px-3 pt-3 sm:px-4">
            <div className="glass mx-auto flex h-15 max-w-7xl items-center gap-5 rounded-full pr-2 pl-4 sm:pl-5">
              <Link href="/" className="rounded-lg" aria-label="Receipts stage, home">
                <Logo sub="Stage" />
              </Link>
              <StageNav />
              <ThemeToggle className="ml-auto" />
            </div>
          </header>
          <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
            {children}
            <Ticker />
          </main>
        </MotionProvider>
      </body>
    </html>
  );
}
