import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { RAIL_TIER, type Rail } from '@receipts/core';
import type { Brand, PurchaseView } from '@receipts/client';
import { RequireHuman } from '../components/require-human';
import { Button, Card, errorText, Input, Notice, P, Row, Screen, Strong, Tag, Title } from '../components/ui';
import { useSession } from '../lib/session';

// Prove a purchase from the phone. Reclaim opens the brand's own logged-in order page and proves it there; an order
// email is easier to upload from the web app; a bill QR goes through the scanner.

const usable = (s: string) => s === 'live' || s === 'testing';

export default function Prove() {
  return (
    <Screen>
      <RequireHuman>
        <Inner />
      </RequireHuman>
    </Screen>
  );
}

function Inner() {
  const { client, config } = useSession();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [rail, setRail] = useState<Rail | 'simulated' | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    client
      .brands()
      .then((b) => setBrands(b.filter((x) => x.id !== 'demo')))
      .catch((e) => setError(errorText(e)));
    return () => abort.current?.abort();
  }, [client]);

  const groups = useMemo(() => {
    const m = new Map<string, Brand[]>();
    for (const b of brands) m.set(b.group, [...(m.get(b.group) ?? []), b]);
    return [...m.values()];
  }, [brands]);

  const done = async (p: PurchaseView) => {
    if (!p.reviewable.ok) {
      setError(p.reviewable.reason ?? 'This purchase cannot be reviewed yet.');
      return;
    }
    const card = await client.reviews.create(p.id);
    router.replace(`/draft/${card.draftId}`);
  };

  const run = async (fn: () => Promise<PurchaseView>) => {
    setBusy(true);
    setError(null);
    try {
      await done(await fn());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const reclaim = async (r: Rail) => {
    if (!brand) return;
    setBusy(true);
    setError(null);
    try {
      const started = await client.proofs.start(r, { brandId: brand.id });
      if (started.kind !== 'reclaim') throw new Error('This rail does not use Reclaim.');
      setWaiting(true);
      abort.current = new AbortController();
      const wait = client.proofs.waitFor(started.proofRequestId, { signal: abort.current.signal });
      await WebBrowser.openBrowserAsync(started.reclaim.requestUrl);
      const status = await wait;
      if (status.status === 'verified' && status.purchase) await done(status.purchase);
      else setError(status.error ?? 'The proof could not be verified.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWaiting(false);
      setBusy(false);
    }
  };

  if (rail === 'simulated') {
    return (
      <View style={{ gap: 12 }}>
        <Title sub="For rehearsals. Labelled as simulated everywhere it appears.">Simulated purchase</Title>
        <Button
          title="Create a simulated biryani order"
          busy={busy}
          onPress={() =>
            void run(() =>
              client.proofs.simulated({ merchantName: 'Rehearsal Kitchen (demo)', category: 'food', cityId: 'goa', items: [{ name: 'Veg Dum Biryani', priceMinor: 29000 }] }),
            )
          }
        />
        <Button title="Back" tone="ghost" onPress={() => setRail(null)} />
        {error ? <Notice tone="bad">{error}</Notice> : null}
      </View>
    );
  }

  if (brand) {
    return (
      <View style={{ gap: 12 }}>
        <Title>{brand.name}</Title>
        {brand.rails.map((r) => {
          const info = config?.rails[r.rail];
          const phone = r.rail === 'order_page' || r.rail === 'payment_proof' || r.rail === 'onchain_payment';
          return (
            <Pressable key={r.rail} disabled={!usable(r.status) || !phone} onPress={() => setRail(r.rail)} style={{ opacity: usable(r.status) && phone ? 1 : 0.5 }}>
              <Card style={rail === r.rail ? { borderWidth: 2 } : undefined}>
                <Row>
                  <Strong>{info?.label ?? r.rail}</Strong>
                  <Tag tone={RAIL_TIER[r.rail] === 'A' ? 'good' : 'neutral'}>{RAIL_TIER[r.rail] === 'A' ? 'proves the item' : 'proves the payment'}</Tag>
                  {r.status === 'testing' ? <Tag tone="warn">testing</Tag> : null}
                </Row>
                <P muted size={14}>
                  {r.rail === 'order_email'
                    ? 'Upload the order email from the web app.'
                    : r.rail === 'merchant_receipt'
                      ? 'Use “Scan a bill” on the Review tab.'
                      : r.rail === 'shop_through'
                        ? 'Buy through a Receipts link and the proof arrives by itself.'
                        : (info?.how ?? '')}
                </P>
              </Card>
            </Pressable>
          );
        })}
        {rail === 'order_page' || rail === 'payment_proof' ? (
          <Card>
            <P>Log in to {brand.name} as usual in the page that opens. The proof is made from what your phone sees; your password and other orders never reach Receipts.</P>
            <Button title={waiting ? 'Waiting for the proof…' : `Connect my ${brand.name} order`} busy={busy} onPress={() => void reclaim(rail)} />
          </Card>
        ) : null}
        {rail === 'onchain_payment' ? (
          <Card>
            <P>Paste the hash of a USDC payment you made from this wallet on Base.</P>
            <Input value={tx} onChangeText={setTx} placeholder="0x…" autoCapitalize="none" />
            <Button title="Verify payment" busy={busy} disabled={!/^0x[0-9a-fA-F]{64}$/.test(tx.trim())} onPress={() => void run(() => client.proofs.onchain({ txHash: tx.trim() as `0x${string}` }))} />
          </Card>
        ) : null}
        <Button title="All brands" tone="ghost" onPress={() => (setBrand(null), setRail(null))} />
        {error ? <Notice tone="bad">{error}</Notice> : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Title sub="Where did you buy it?">Prove a purchase</Title>
      {groups.map((list) => (
        <Row key={list[0]!.group} gap={8}>
          {list.map((b) => (
            <Pressable key={b.id} onPress={() => setBrand(b)}>
              <Tag>{b.name}</Tag>
            </Pressable>
          ))}
        </Row>
      ))}
      {config?.proofs.simulatedAllowed ? <Button title="Dev rail: a simulated purchase" tone="secondary" onPress={() => setRail('simulated')} /> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </View>
  );
}
