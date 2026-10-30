'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound } from 'lucide-react';
import { ReceiptsClient } from '@receipts/client';
import { Button, Card, errorText, Field, inputCls, Notice, PageTitle } from '@receipts/react';

// The admin token (ADMIN_TOKEN on the API) is kept for this browser tab only (sessionStorage) and sent as
// x-admin-token. A local API without ADMIN_TOKEN is open, and the console says so.

import { API_URL } from './env';
const KEY = 'receipts.admin-token';

const AdminContext = createContext<{ client: ReceiptsClient; open: boolean; signOut(): void } | null>(null);

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin outside RequireAdmin');
  return ctx;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<'checking' | 'in' | 'out'>('checking');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const client = useMemo(() => new ReceiptsClient({ baseUrl: API_URL, adminToken: token }), [token]);

  useEffect(() => {
    try {
      setToken(sessionStorage.getItem(KEY));
    } catch {}
  }, []);

  useEffect(() => {
    let live = true;
    client.admin
      .whoami()
      .then((r) => {
        if (!live) return;
        setOpen(r.open);
        setState(r.signedIn ? 'in' : 'out');
        if (!r.signedIn && token) setError('That token was not accepted. Check ADMIN_TOKEN in the API’s .env.');
      })
      .catch((e) => live && (setState('out'), setError(errorText(e))));
    return () => {
      live = false;
    };
  }, [client, token]);

  const signIn = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      sessionStorage.setItem(KEY, draft.trim());
    } catch {}
    setToken(draft.trim());
  };
  const signOut = useCallback(() => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
    setToken(null);
  }, []);

  if (state === 'checking') return <p className="text-sm text-muted">Checking access…</p>;
  if (state === 'out') {
    return (
      <div className="mx-auto max-w-md">
        <PageTitle eyebrow="Operators only" title="Admin console" sub="Paste the ADMIN_TOKEN set on the API. It stays in this tab." />
        <Card>
          <form onSubmit={signIn} className="space-y-3">
            <Field label="Admin token">
              <input className={inputCls} type="password" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" />
            </Field>
            <Button type="submit" disabled={!draft.trim()}>
              <KeyRound className="size-4" aria-hidden />
              Open the console
            </Button>
            {error ? <Notice tone="bad">{error}</Notice> : null}
          </form>
        </Card>
      </div>
    );
  }
  return (
    <AdminContext.Provider value={{ client, open, signOut }}>
      {open ? (
        <div className="mb-6">
          <Notice tone="warn">This API has no ADMIN_TOKEN, so the console is open to anyone who can reach it. Fine on a laptop; set one before deploying.</Notice>
        </div>
      ) : null}
      {children}
    </AdminContext.Provider>
  );
}
