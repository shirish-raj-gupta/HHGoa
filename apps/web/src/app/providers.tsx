'use client';

import type { ReactNode } from 'react';
import { MotionProvider, SessionProvider, WalletProvider } from '@receipts/react';
import { API_URL, PRIVY_APP_ID } from '@/lib/env';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MotionProvider>
      <WalletProvider privyAppId={PRIVY_APP_ID || undefined}>
        <SessionProvider apiUrl={API_URL}>{children}</SessionProvider>
      </WalletProvider>
    </MotionProvider>
  );
}
