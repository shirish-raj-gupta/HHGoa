'use client';

import { PrivyProvider, useCreateWallet, usePrivy, useWallets, type PrivyClientConfig } from '@privy-io/react-auth';
import { useEffect, useState, type RefObject } from 'react';
import { createWalletClient, custom, type Hex } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import type { PrivyControls, Wallet } from './wallet';

// Loaded only when a Privy app ID is configured. The provider sits beside the app (its modal renders in a
// portal), so pages still render on the server without it.

// One object for the app's lifetime, so Privy never sees a "new" config on a re-render. No loginMethods: the modal
// shows exactly the methods enabled in the Privy dashboard (listing one the dashboard has off makes Privy answer
// "Login with Google not allowed").
const CONFIG: PrivyClientConfig = {
  embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
  defaultChain: baseSepolia,
  supportedChains: [baseSepolia, base],
  appearance: { theme: '#fdfaf3', accentColor: '#02142d', logo: '/icon-192.png' },
};

function Inner({ onChange, controls, onReady }: { onChange(w: Wallet | null): void; controls: RefObject<PrivyControls | null>; onReady(): void }) {
  const { ready, login, logout, authenticated, isModalOpen } = usePrivy();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  // The app signs in with a new wallet straight away. A signature request while Privy's own modal is still on its
  // wallet-creation screen replaces that screen's state and crashes it ("Cannot destructure property 'onSuccess' of
  // 'createWallet'"), so the wallet is handed over only once the modal has closed after login.
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!authenticated) setSettled(false);
    else if (!isModalOpen) setSettled(true);
  }, [authenticated, isModalOpen]);

  // The controls appear once Privy is ready (a login before then is ignored); onReady runs a login that was waiting.
  useEffect(() => {
    if (!ready) return;
    controls.current = {
      // Signed in to Privy but without a wallet (an interrupted first login): create the wallet instead of
      // calling login(), which Privy ignores for a signed-in user.
      login: () => (authenticated ? (wallets.length ? undefined : void createWallet().catch(() => undefined)) : login()),
      logout,
    };
    onReady();
  }, [ready, controls, login, logout, authenticated, wallets.length, createWallet, onReady]);

  useEffect(() => {
    const w = authenticated && settled ? wallets[0] : undefined;
    if (!w) {
      onChange(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const provider = await w.getEthereumProvider();
      const client = createWalletClient({ account: w.address as Hex, transport: custom(provider) });
      if (cancelled) return;
      onChange({
        address: w.address,
        kind: 'privy',
        signer: {
          address: w.address,
          signMessage: ({ message }) => client.signMessage({ account: w.address as Hex, message }),
          signTypedData: async (td) => {
            // Typed data is bound to a chain; external wallets refuse to sign for a chain they are not on.
            const chainId = Number((td.domain as { chainId?: number | string }).chainId ?? 0);
            if (chainId && w.chainId !== `eip155:${chainId}`) await w.switchChain(chainId).catch(() => undefined);
            return client.signTypedData({ ...(td as object), account: w.address as Hex } as never);
          },
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, settled, wallets, onChange]);

  return null;
}

export default function PrivyBridge({ appId, onChange, controls, onReady }: { appId: string; onChange(w: Wallet | null): void; controls: RefObject<PrivyControls | null>; onReady(): void }) {
  return (
    <PrivyProvider appId={appId} config={CONFIG}>
      <Inner onChange={onChange} controls={controls} onReady={onReady} />
    </PrivyProvider>
  );
}
