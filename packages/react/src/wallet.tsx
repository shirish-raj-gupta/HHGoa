'use client';

import dynamic from 'next/dynamic';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import type { WalletSigner } from '@receipts/client';

// The wallet is the user's only public identity. Two kinds: a Privy wallet (email or Google login, or an existing
// wallet), and a device wallet kept in this browser, which needs no
// account anywhere. Earnings can always be claimed to another wallet, so a device wallet loses nothing but must
// be backed up to survive clearing the browser. A Privy app ID turns on the first kind.

export type WalletKind = 'device' | 'privy';

export interface Wallet {
  address: string;
  kind: WalletKind;
  signer: WalletSigner;
}

export interface PrivyControls {
  login(): void;
  logout(): Promise<void> | void;
}

interface WalletContextValue {
  ready: boolean;
  wallet: Wallet | null;
  privyAvailable: boolean;
  /** Email sign-in is off because this page is inside another site's frame (an editor's preview, an embed). */
  privyFramed: boolean;
  /** "Sign in with email" was pressed before Privy finished loading; its window opens as soon as it has. */
  privyPending: boolean;
  connectDevice(): void;
  connectPrivy(): void;
  disconnect(): Promise<void>;
  exportDeviceKey(): string | null;
}

const DEVICE_KEY = 'receipts.deviceKey';
const KIND_KEY = 'receipts.walletKind';

const PrivyBridge = dynamic(() => import('./privy-bridge'), { ssr: false });

/** Inside another site's frame (an editor's preview pane, an embed), Privy's wallet SDKs read window.top.ethereum,
 *  which the browser forbids across origins (a SecurityError), and its popups cannot work there either. So email sign-in
 *  is only offered in a top-level tab; the device wallet works everywhere. */
function inForeignFrame(): boolean {
  try {
    return window.top !== window.self && !window.top?.location.href;
  } catch {
    return true;
  }
}

const WalletContext = createContext<WalletContextValue | null>(null);

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function deviceWallet(key: Hex): Wallet {
  const account = privateKeyToAccount(key);
  return {
    address: account.address,
    kind: 'device',
    signer: {
      address: account.address,
      signMessage: ({ message }) => account.signMessage({ message }),
      signTypedData: (td) => account.signTypedData(td as never),
    },
  };
}

export function WalletProvider({ children, privyAppId }: { children: ReactNode; privyAppId?: string }) {
  const [ready, setReady] = useState(false);
  const [device, setDevice] = useState<Wallet | null>(null);
  const [privy, setPrivy] = useState<Wallet | null>(null);
  const [kind, setKind] = useState<WalletKind | null>(null);
  const [framed, setFramed] = useState(false);
  const [privyPending, setPrivyPending] = useState(false);
  const controls = useRef<PrivyControls | null>(null);
  const pendingLogin = useRef(false);

  useEffect(() => {
    const s = storage();
    const key = s?.getItem(DEVICE_KEY) as Hex | null;
    const savedKind = s?.getItem(KIND_KEY) as WalletKind | null;
    if (savedKind === 'device' && key) setDevice(deviceWallet(key));
    setKind(savedKind);
    setFramed(inForeignFrame());
    setReady(true);
  }, []);

  const connectDevice = useCallback(() => {
    const s = storage();
    let key = s?.getItem(DEVICE_KEY) as Hex | null;
    if (!key) {
      key = generatePrivateKey();
      s?.setItem(DEVICE_KEY, key);
    }
    s?.setItem(KIND_KEY, 'device');
    setDevice(deviceWallet(key));
    setKind('device');
  }, []);

  // Privy loads after the page, so a quick click can come before it is ready: remember it and log in once it is.
  const connectPrivy = useCallback(() => {
    storage()?.setItem(KIND_KEY, 'privy');
    setKind('privy');
    if (controls.current) return controls.current.login();
    pendingLogin.current = true;
    setPrivyPending(true);
  }, []);

  const privyReady = useCallback(() => {
    if (!pendingLogin.current) return;
    pendingLogin.current = false;
    setPrivyPending(false);
    controls.current?.login();
  }, []);

  const disconnect = useCallback(async () => {
    storage()?.removeItem(KIND_KEY);
    if (kind === 'privy') await controls.current?.logout();
    setKind(null);
    setDevice(null);
  }, [kind]);

  const exportDeviceKey = useCallback(() => storage()?.getItem(DEVICE_KEY) ?? null, []);

  const wallet = kind === 'device' ? device : kind === 'privy' ? privy : null;
  const value = useMemo<WalletContextValue>(
    () => ({
      ready,
      wallet,
      privyAvailable: !!privyAppId && !framed,
      privyFramed: !!privyAppId && framed,
      privyPending,
      connectDevice,
      connectPrivy,
      disconnect,
      exportDeviceKey,
    }),
    [ready, wallet, privyAppId, framed, privyPending, connectDevice, connectPrivy, disconnect, exportDeviceKey],
  );

  return (
    <WalletContext.Provider value={value}>
      {privyAppId && ready && !framed ? <PrivyBridge appId={privyAppId} onChange={setPrivy} controls={controls} onReady={privyReady} /> : null}
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet outside WalletProvider');
  return ctx;
}
