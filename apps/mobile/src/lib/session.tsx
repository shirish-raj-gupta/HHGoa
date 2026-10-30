import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, ReceiptsClient, type Me, type ServerConfig } from '@receipts/client';
import { API_URL } from './env';
import { useWallet, type Wallet } from './wallet';

// Wallet sign-in with the API, one session token per wallet in the secure store. Same flow as the web app.

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

export function SessionProvider({ children }: { children: ReactNode }) {
  const { ready, wallet } = useWallet();
  const walletRef = useRef<Wallet | null>(null);
  walletRef.current = wallet;
  const client = useMemo(
    () =>
      new ReceiptsClient({
        baseUrl: API_URL,
        onToken: (t) => {
          const w = walletRef.current;
          if (!w) return;
          void (t ? SecureStore.setItemAsync(tokenKey(w.address), t) : SecureStore.deleteItemAsync(tokenKey(w.address)));
        },
      }),
    [],
  );
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const signing = useRef(false);

  useEffect(() => {
    client
      .config()
      .then(setConfig)
      .catch((e: unknown) => setConfigError(`Cannot reach ${API_URL}: ${e instanceof Error ? e.message : String(e)}`));
  }, [client]);

  const signIn = useCallback(async () => {
    const w = walletRef.current;
    if (!w || signing.current) return;
    signing.current = true;
    setStatus('signing-in');
    setError(null);
    try {
      await client.signIn(w.signer);
      await client.identity.status().catch(() => undefined);
      setMe(await client.me());
      setStatus('signed-in');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    } finally {
      signing.current = false;
    }
  }, [client]);

  const refresh = useCallback(async () => {
    try {
      setMe(await client.me());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        client.setToken(null);
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
    let cancelled = false;
    (async () => {
      const saved = await SecureStore.getItemAsync(tokenKey(wallet.address));
      if (cancelled) return;
      if (!saved) return signIn();
      client.setToken(saved);
      try {
        const m = await client.me();
        if (m.wallet.toLowerCase() !== wallet.address.toLowerCase()) throw new ApiError(401, 'session is for another wallet');
        setMe(m);
        setStatus('signed-in');
      } catch {
        client.setToken(null);
        await signIn();
      }
    })();
    return () => {
      cancelled = true;
    };
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
