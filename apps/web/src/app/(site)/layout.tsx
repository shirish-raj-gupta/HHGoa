import type { ReactNode } from 'react';
import { CurtainFooter } from '@receipts/react';
import { Nav } from '@/components/nav';
import { MERCHANT_URL } from '@/lib/env';

// The page is a sheet that lifts off the navy footer (CurtainFooter, shared with the business and admin apps). The
// column fills the window, so on a short page the footer still sits at the bottom.
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="relative z-10 flex-1 rounded-b-[40px] bg-bg shadow-sheet sm:rounded-b-[64px]">
        <Nav />
        <main className="mx-auto w-full max-w-5xl px-4 pt-8 pb-28 sm:px-6 sm:pt-10 sm:pb-28">{children}</main>
      </div>
      <CurtainFooter
        links={[
          { href: '/leaderboard', label: 'Leaderboard', icon: 'trophy' },
          { href: '/developers', label: 'For agents and developers', icon: 'bot' },
          { href: '/onboard', label: 'Wallet and identity', icon: 'wallet' },
          { href: MERCHANT_URL, label: 'Receipts for businesses', icon: 'store' },
        ]}
      >
        Reviewers are paid when AI agents cite their reviews. Pay never depends on the rating. Some links may earn Receipts a commission; rankings never read
        commission data.
      </CurtainFooter>
    </div>
  );
}
