import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import type { WalletSigner } from '@receipts/client';

// The phone's wallet: a key kept in the OS secure store (Keychain / Keystore). It is the reviewer's only public
// identity. Earnings can be claimed to any other wallet, and the key can be backed up or imported.

const KEY = 'receipts.deviceKey';

export interface Wallet {
  address: string;
  signer: WalletSigner;
}

interface WalletContextValue {
  ready: boolean;
  wallet: Wallet | null;
  create(): Promise<void>;
  importKey(key: string): Promise<void>;
  exportKey(): Promise<string | null>;
  forget(): Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

function toWallet(key: Hex): Wallet {
  const account = privateKeyToAccount(key);
  return {
    address: account.address,
    signer: {
      address: account.address,
      signMessage: ({ message }) => account.signMessage({ message }),
      signTypedData: (td) => account.signTypedData(td as never),
    },
  };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((k) => {
        if (k) setWallet(toWallet(k as Hex));
      })
      .finally(() => setReady(true));
  }, []);

  const create = useCallback(async () => {
    const key = generatePrivateKey();
    await SecureStore.setItemAsync(KEY, key);
    setWallet(toWallet(key));
  }, []);

  const importKey = useCallback(async (raw: string) => {
    const key = (raw.trim().startsWith('0x') ? raw.trim() : `0x${raw.trim()}`) as Hex;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('That is not a private key (64 hex characters).');
    await SecureStore.setItemAsync(KEY, key);
    setWallet(toWallet(key));
  }, []);

  const exportKey = useCallback(() => SecureStore.getItemAsync(KEY), []);

  const forget = useCallback(async () => {
    await SecureStore.deleteItemAsync(KEY);
    setWallet(null);
  }, []);

  const value = useMemo(() => ({ ready, wallet, create, importKey, exportKey, forget }), [ready, wallet, create, importKey, exportKey, forget]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet outside WalletProvider');
  return ctx;
}
