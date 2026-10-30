'use client';

import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import { Button, Card, errorText, LinkButton, Mono, Notice, PageTitle, Tag, useSession, useWallet } from '@receipts/react';

const SelfQr = dynamic(() => import('@/components/self-qr'), { ssr: false, loading: () => <p className="text-sm text-muted">Loading Self…</p> });
const AadhaarLogin = dynamic(() => import('@/components/aadhaar-login'), { ssr: false, loading: () => <p className="text-sm text-muted">Loading Anon Aadhaar…</p> });

export default function Onboard() {
  const { wallet, ready, privyAvailable, privyFramed, privyPending, connectDevice, connectPrivy, disconnect, exportDeviceKey } = useWallet();
  const { client, config, status, error, human, me, refresh, signIn } = useSession();
  const [method, setMethod] = useState<'self' | 'aadhaar' | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [showKey, setShowKey] = useState(false);

  const done = useCallback(
    async (text: string) => {
      await refresh();
      setMsg({ tone: 'good', text });
      setMethod(null);
    },
    [refresh],
  );

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      await done(await fn());
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  /** Self posts its proof to the API; we wait for the API to register the human. */
  const waitForSelf = useCallback(async () => {
    for (let i = 0; i < 30; i++) {
      const s = await client.identity.status();
      if (s.human) return done('Verified unique human with Self. Nothing about you was shared.');
      await new Promise((r) => setTimeout(r, 2000));
    }
    setMsg({ tone: 'bad', text: 'Self finished but the API has not confirmed yet. Refresh in a minute.' });
  }, [client, done]);

  const onAadhaarProof = (pcd: string) => void run(async () => (await client.identity.anonAadhaar(pcd)).message);

  const id = config?.identity;
  // Self's relayers post the proof to the API, so it must be reachable on public HTTPS.
  const selfUsable = !!id?.selfEndpoint && /^https:\/\//.test(id.selfEndpoint) && !/localhost|127\.0\.0\.1/.test(id.selfEndpoint);

  return (
    <div className="space-y-5">
      <PageTitle eyebrow="Wallet and identity" title="Your wallet and one-human check" sub="Your wallet address is your only public identity, and one account for reviewing and for Receipts for business. The one-human check stops one person from writing many reviews, and reveals nothing about you." />

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold">1 · Wallet</span>
          {wallet ? <Tag tone="good">{wallet.kind === 'device' ? 'device wallet' : 'Privy wallet'}</Tag> : null}
        </div>
        {!ready ? null : wallet ? (
          <div className="space-y-3">
            <Mono>{wallet.address}</Mono>
            <div className="flex flex-wrap gap-2">
              {wallet.kind === 'device' ? (
                <Button tone="secondary" onClick={() => setShowKey((v) => !v)}>
                  {showKey ? 'Hide backup key' : 'Back up this wallet'}
                </Button>
              ) : null}
              <Button tone="ghost" onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
            {showKey ? (
              <Notice tone="warn">
                Keep this private key somewhere safe; it is the only copy of this wallet. Anyone with it can claim your earnings.
                <div className="mt-2">
                  <Mono>{exportDeviceKey()}</Mono>
                </div>
              </Notice>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {privyAvailable ? (
              <Button onClick={connectPrivy} busy={privyPending}>
                Sign in with email
              </Button>
            ) : null}
            <Button tone={privyAvailable ? 'secondary' : 'primary'} onClick={connectDevice}>
              Use a wallet on this device
            </Button>
            <p className="w-full text-xs text-muted">The device wallet lives in this browser. You can claim earnings to any other wallet later.</p>
            {privyFramed ? <p className="w-full text-xs text-muted">Email sign-in needs a normal browser tab: this page is open inside another app's frame.</p> : null}
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <span className="font-semibold">2 · Sign in</span>
        {status === 'signing-in' ? <p className="text-sm text-muted">Signing in with your wallet…</p> : null}
        {status === 'signed-in' ? <p className="text-sm text-good">Signed in as {me?.wallet}</p> : null}
        {status === 'no-wallet' ? <p className="text-sm text-muted">Connect a wallet first.</p> : null}
        {status === 'error' ? (
          <div className="space-y-2">
            <Notice tone="bad">{error}</Notice>
            <Button tone="secondary" onClick={() => void signIn()}>
              Try again
            </Button>
          </div>
        ) : null}
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold">3 · Prove you are one human</span>
          {human ? <Tag tone="good">verified{me?.reviewer?.idType === 'mock' ? ' (mock)' : ''}</Tag> : null}
        </div>
        {human ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted">You are verified. Reviews you publish carry a unique-human proof.</p>
            <LinkButton href="/review">Write a review</LinkButton>
          </div>
        ) : status !== 'signed-in' ? (
          <p className="text-sm text-muted">Sign in first.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => setMethod('self')}
                disabled={!selfUsable}
                className={`rounded-xl border p-3 text-left text-sm disabled:opacity-50 ${method === 'self' ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
              >
                <div className="font-semibold">Self app</div>
                <div className="text-muted">Passport or Aadhaar NFC, zero-knowledge. {selfUsable ? '' : '(needs the API on a public HTTPS address)'}</div>
              </button>
              <button
                onClick={() => setMethod('aadhaar')}
                disabled={!id?.anonAadhaarSeed}
                className={`rounded-xl border p-3 text-left text-sm disabled:opacity-50 ${method === 'aadhaar' ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
              >
                <div className="font-semibold">Anon Aadhaar</div>
                <div className="text-muted">The secure QR from the mAadhaar app, proved in your browser. {id?.anonAadhaarSeed ? '' : '(not configured on this server)'}</div>
              </button>
            </div>
            {method === 'self' && selfUsable && id?.selfEndpoint && wallet ? (
              <SelfQr scope={id.selfScope} endpoint={id.selfEndpoint} staging={id.selfStaging} wallet={wallet.address} onSuccess={() => void waitForSelf()} />
            ) : null}
            {method === 'aadhaar' && id?.anonAadhaarSeed && wallet ? (
              <div className="space-y-2">
                <AadhaarLogin seed={id.anonAadhaarSeed} test={id.anonAadhaarTest} wallet={wallet.address} onProof={onAadhaarProof} />
                <p className="text-xs text-muted">Download a fresh secure QR in mAadhaar first: the QR must be less than an hour old.{id.anonAadhaarTest ? ' This server runs in Anon Aadhaar test mode.' : ''}</p>
              </div>
            ) : null}
            {id?.mockAllowed ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <Button tone="secondary" busy={busy} onClick={() => void run(async () => (await client.identity.mock()).message)}>
                  Use a mock human
                </Button>
                <span className="text-xs text-muted">Rehearsals only. Labelled “mock” on every review.</span>
              </div>
            ) : null}
          </div>
        )}
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      </Card>
    </div>
  );
}
