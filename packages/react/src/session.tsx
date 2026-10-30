'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, ReceiptsClient, type Me, type ServerConfig } from '@receipts/client';
import { useWallet, type Wallet } from './wallet';

// Signs the wallet in with the API (nonce, signature, session token) and keeps one token per wallet in this browser.
// One account: the reviewer site and the business app (served on the same origin, at /business) share the token, so
// signing in on either signs in on both.

type Status = 'loading' | 'no-wallet' | 'signing-in' | 'signed-in' | 'error';

interface SessionValue {
  client: ReceiptsClient;
  config: ServerConfig | null;
  configError: string | null;
  wallet: Wallet | null;
  status: Status;
  error: string | null;
  me: Me | null;
  human: boolean;
  refresh(): Promise<void>;
  signIn(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

const tokenKey = (address: string) => `receipts.session.${address.toLowerCase()}`;

function store(key: string, value: string | null) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // private mode: the session lasts for this tab only
  }
}

function load(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function SessionProvider({ children, apiUrl, adminToken }: { children: ReactNode; apiUrl: string; adminToken?: string }) {
  const { ready, wallet } = useWallet();
  const walletRef = useRef<Wallet | null>(null);
  walletRef.current = wallet;
  const client = useMemo(
    () =>
      new ReceiptsClient({
        baseUrl: apiUrl,
        adminToken: adminToken ?? null,
        onToken: (t) => {
          if (walletRef.current) store(tokenKey(walletRef.current.address), t);
        },
      }),
    [apiUrl, adminToken],
  );
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const signingFor = useRef<string | null>(null);

  useEffect(() => {
    client
      .config()
      .then(setConfig)
      .catch((e: unknown) => setConfigError(e instanceof Error ? e.message : String(e)));
  }, [client]);

  const signIn = useCallback(async () => {
    const w = walletRef.current;
    if (!w || signingFor.current === w.address) return;
    signingFor.current = w.address;
    setStatus('signing-in');
    setError(null);
    try {
      await client.signIn(w.signer);
      // Pick up a human session if this wallet is already verified.
      await client.identity.status().catch(() => undefined);
      setMe(await client.me());
      setStatus('signed-in');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    } finally {
      signingFor.current = null;
    }
  }, [client]);

  const refresh = useCallback(async () => {
    try {
      setMe(await client.me());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        client.setToken(null);
        setMe(null);
        await signIn();
      } else throw e;
    }
  }, [client, signIn]);

  useEffect(() => {
    if (!ready) return;
    if (!wallet) {
      client.setToken(null);
      setMe(null);
      setStatus('no-wallet');
      return;
    }
    const saved = load(tokenKey(wallet.address));
    if (!saved) {
      void signIn();
      return;
    }
    client.setToken(saved);
    client
      .me()
      .then((m) => {
        if (m.wallet.toLowerCase() !== wallet.address.toLowerCase()) throw new ApiError(401, 'session is for another wallet');
        setMe(m);
        setStatus('signed-in');
      })
      .catch(() => {
        client.setToken(null);
        void signIn();
      });
  }, [ready, wallet, client, signIn]);

  const value = useMemo<SessionValue>(
    () => ({ client, config, configError, wallet, status, error, me, human: !!me?.human, refresh, signIn }),
    [client, config, configError, wallet, status, error, me, refresh, signIn],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}
