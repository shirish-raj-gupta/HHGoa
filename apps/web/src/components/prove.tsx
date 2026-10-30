'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, FlaskConical, IndianRupee, Link2, Mail, Network, QrCode, ShoppingBag, Smartphone, Upload, type LucideIcon } from 'lucide-react';
import { RAIL_TIER, type Rail } from '@receipts/core';
import type { Brand, PurchaseView, StartedProof } from '@receipts/client';
import { Button, Card, errorText, Field, inputCls, Notice, QR_PROPS, ScanFrame, Tag, useSession } from '@receipts/react';

// "Prove a purchase": pick where you bought it, then the rail that brand supports. Every rail ends in the same
// verified purchase, which the review is then tied to.

const GROUP_LABEL: Record<string, string> = {
  food_delivery: 'Food delivery',
  quick_commerce: 'Groceries in minutes',
  marketplace: 'Shopping',
  d2c: 'Brand stores',
  travel: 'Travel and stays',
  local: 'Local shops and services',
  landlord: 'Rent',
  subscription: 'Subscriptions',
  agents: 'AI agents and APIs',
  ondc: 'ONDC',
};

const usable = (status: string) => status === 'live' || status === 'testing';

const RAIL_ICON: Record<string, LucideIcon> = {
  order_page: Smartphone,
  order_email: Mail,
  payment_proof: IndianRupee,
  shop_through: ShoppingBag,
  merchant_receipt: QrCode,
  onchain_payment: Link2,
  network_order: Network,
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function ProvePurchase({ onPurchase }: { onPurchase(p: PurchaseView): void }) {
  const { client, config } = useSession();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [rail, setRail] = useState<Rail | 'simulated' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .brands()
      .then((b) => setBrands(b.filter((x) => x.id !== 'demo')))
      .catch((e) => setError(errorText(e)));
  }, [client]);

  const groups = useMemo(() => {
    const m = new Map<string, Brand[]>();
    for (const b of brands) m.set(b.group, [...(m.get(b.group) ?? []), b]);
    return [...m.entries()];
  }, [brands]);
  const brand = brands.find((b) => b.id === brandId) ?? null;

  const finish = (p: PurchaseView) => {
    setRail(null);
    setBrandId(null);
    onPurchase(p);
  };

  return (
    <div className="space-y-3">
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {!brand && rail !== 'simulated' ? (
        <div className="space-y-5 rounded-3xl border border-line bg-surface p-5 shadow-card">
          <p className="font-display text-lg font-bold">Where did you buy it?</p>
          {/* The dev rail comes first: on a rehearsal server it is the quickest way to a purchase. */}
          {config?.proofs.simulatedAllowed ? (
            <button onClick={() => setRail('simulated')} className="flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-dashed border-warn/50 bg-warn-soft px-3.5 py-2.5 text-left text-sm">
              <FlaskConical className="size-4 shrink-0 text-warn" aria-hidden />
              <span>
                <span className="font-semibold">Dev rail:</span> a simulated purchase for rehearsals (labelled as simulated everywhere)
              </span>
            </button>
          ) : null}
          {groups.map(([group, list]) => (
            <div key={group} className="space-y-2">
              <div className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">{GROUP_LABEL[group] ?? group}</div>
              <div className="flex flex-wrap gap-2">
                {list.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      setBrandId(b.id);
                      setRail(null);
                    }}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface py-1.5 pr-3.5 pl-1.5 text-sm font-medium transition-colors hover:border-accent active:scale-[0.98]"
                  >
                    <span className="grid size-8 place-items-center rounded-lg bg-sunken font-display text-sm font-bold" aria-hidden>
                      {b.name.slice(0, 1)}
                    </span>
                    {b.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {brand ? (
        <Card className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setBrandId(null)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-muted transition-colors hover:bg-sunken hover:text-ink">
              <ArrowLeft className="size-4" aria-hidden />
              All
            </button>
            <span className="font-display text-lg font-bold">{brand.name}</span>
          </div>
          <div className="grid gap-2">
            {brand.rails.map((r) => {
              const info = config?.rails[r.rail];
              const enabled = usable(r.status) && r.rail !== 'shop_through';
              const Icon = RAIL_ICON[r.rail] ?? Smartphone;
              // An order page provider that leaves out the items proves the order, not the item (tier B).
              const tier = r.provider?.tier ?? RAIL_TIER[r.rail];
              return (
                <button
                  key={r.rail}
                  disabled={!enabled}
                  onClick={() => setRail(r.rail)}
                  className={`flex gap-3 rounded-2xl border p-3.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${rail === r.rail ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong'}`}
                >
                  <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${rail === r.rail ? 'bg-accent text-accent-ink' : 'bg-sunken text-ink'}`}>
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {info?.label ?? r.rail}
                      <Tag tone={tier === 'A' ? 'good' : 'neutral'}>{tier === 'A' ? 'proves the item' : r.rail === 'order_page' ? 'proves the order' : 'proves the payment'}</Tag>
                      {r.status === 'testing' ? <Tag tone="warn">testing</Tag> : null}
                      {r.status === 'planned' ? <Tag>coming</Tag> : null}
                      {r.provider?.community ? <Tag>community provider</Tag> : null}
                    </span>
                    <span className="block text-muted">
                      {r.rail === 'shop_through'
                        ? 'Buy through a Receipts link and the proof arrives by itself.'
                        : r.provider?.proves
                          ? `Proves ${r.provider.proves}. ${info?.how ?? ''}`
                          : `${info?.proves ?? ''} · ${info?.how ?? ''}`}
                    </span>
                    {r.provider?.alsoShares ? (
                      <span className="mt-1 block text-xs text-warn">
                        It also shares {r.provider.alsoShares} with Receipts. The proof stays encrypted and these are never shown.
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          {rail && rail !== 'simulated' ? <RailFlow brand={brand} rail={rail} onPurchase={finish} /> : null}
        </Card>
      ) : null}

      {rail === 'simulated' ? <SimulatedForm onPurchase={finish} onCancel={() => setRail(null)} /> : null}
    </div>
  );
}

function RailFlow({ brand, rail, onPurchase }: { brand: Brand; rail: Rail; onPurchase(p: PurchaseView): void }) {
  const { client } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<StartedProof | null>(null);
  const [text, setText] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const run = async (fn: () => Promise<PurchaseView>) => {
    setBusy(true);
    setError(null);
    try {
      onPurchase(await fn());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const startReclaim = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await client.proofs.start(rail, { brandId: brand.id });
      setStarted(s);
      abort.current = new AbortController();
      const done = await client.proofs.waitFor(s.proofRequestId, { signal: abort.current.signal });
      if (done.status === 'verified' && done.purchase) onPurchase(done.purchase);
      else setError(done.error ?? 'The proof could not be verified.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const onEmail = async (e: FormEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    await run(async () => client.proofs.email({ emlBase64: await fileToBase64(file), brandId: brand.id }));
  };

  return (
    <div className="space-y-3 border-t border-line pt-3">
      {rail === 'order_page' || rail === 'payment_proof' ? (
        started && started.kind === 'reclaim' ? (
          <div className="space-y-4 text-sm">
            <p>
              Log in to {brand.name} in Reclaim&apos;s secure browser and open the order. The proof is made from that page; your password and your other orders never
              reach us.
            </p>
            <a
              href={started.reclaim.requestUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl bg-accent px-4 text-sm font-semibold text-accent-ink shadow-clay-sm transition-[transform,filter] duration-200 ease-squish hover:-translate-y-px hover:brightness-110 active:scale-[0.96]"
            >
              Log in to {brand.name} with Reclaim
              <ArrowUpRight className="size-4" aria-hidden />
            </a>
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-line p-4 sm:flex-row">
              <ScanFrame label={`QR code: continue proving your ${brand.name} order on your phone`}>
                <QRCodeSVG value={started.reclaim.qrUrl} size={208} {...QR_PROPS} />
              </ScanFrame>
              <div className="space-y-1.5">
                <p className="font-semibold">Or use your phone</p>
                <p className="text-muted">
                  {started.reclaim.qrOpens === 'portal'
                    ? "Scan this with the phone camera. Reclaim's secure browser opens there."
                    : "Scan this with the phone camera. It opens Reclaim's verifier, which may ask you to install the Reclaim app."}{' '}
                  This page moves on by itself when the proof arrives.
                </p>
              </div>
            </div>
            <p className="flex items-center gap-2 text-muted" aria-live="polite">
              <span className="relative flex size-2.5" aria-hidden>
                <span className="absolute inset-0 animate-ping rounded-full bg-brand-strong/60" />
                <span className="relative size-2.5 rounded-full bg-brand-strong" />
              </span>
              Waiting for the proof…
            </p>
          </div>
        ) : (
          <Button busy={busy} onClick={() => void startReclaim()}>
            Connect my {brand.name} order
          </Button>
        )
      ) : null}

      {rail === 'order_email' ? (
        <div className="space-y-2 text-sm">
          <p>
            Save the order confirmation email from {brand.name} as a file (in Gmail: ⋮ → Download message) and upload it. Its DKIM signature proves {brand.name} sent it. The
            file is stored encrypted as your proof; only the order fields are ever published.
          </p>
          <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-line-strong/60 bg-sunken px-4 py-5 text-center transition-colors hover:border-accent">
            <Upload className="size-5 text-muted" aria-hidden />
            <span className="font-semibold">{busy ? 'Checking the signature…' : 'Choose the .eml file'}</span>
            <span className="text-xs text-muted">Stored encrypted; only the order fields are published.</span>
            <input type="file" accept=".eml,message/rfc822" onInput={onEmail} disabled={busy} className="sr-only" />
          </label>
        </div>
      ) : null}

      {rail === 'merchant_receipt' ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => client.proofs.merchantReceipt(text.trim()));
          }}
        >
          <p className="text-sm">Scan the Receipts QR on your bill with your camera, or paste its link here.</p>
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="https://…/scan?r=…" />
          <Button type="submit" busy={busy} disabled={!text.trim()}>
            Use this receipt
          </Button>
        </form>
      ) : null}

      {rail === 'onchain_payment' ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => client.proofs.onchain({ txHash: text.trim() as `0x${string}` }));
          }}
        >
          <p className="text-sm">Paste the transaction hash of a USDC payment from this wallet on Base.</p>
          <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="0x…" />
          <Button type="submit" busy={busy} disabled={!/^0x[0-9a-fA-F]{64}$/.test(text.trim())}>
            Verify payment
          </Button>
        </form>
      ) : null}

      {rail === 'network_order' ? <p className="text-sm text-muted">ONDC orders arrive signed from your buyer app. Ask it to share the order with Receipts.</p> : null}

      {error ? <Notice tone="bad">{error}</Notice> : null}
    </div>
  );
}

function SimulatedForm({ onPurchase, onCancel }: { onPurchase(p: PurchaseView): void; onCancel(): void }) {
  const { client, config } = useSession();
  // An order names its items; a UPI payment only names who was paid (then the reviewer pins the shop on Google Maps).
  const [kind, setKind] = useState<'order' | 'upi'>('order');
  const [merchantName, setMerchant] = useState('Rehearsal Kitchen (demo)');
  const [item, setItem] = useState('Veg Dum Biryani');
  const [price, setPrice] = useState('290');
  const [category, setCategory] = useState('food');
  const [locality, setLocality] = useState('Calangute');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const city = config?.cities.find((c) => c.localities.includes(locality)) ?? config?.cities[0];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onPurchase(
        await client.proofs.simulated({
          merchantName: merchantName.includes('(demo)') ? merchantName : `${merchantName} (demo)`,
          category,
          cityId: city?.id,
          ...(kind === 'upi'
            ? { rail: 'payment_proof' as const, items: [], amountMinor: Math.round(Number(price) * 100) }
            : { items: [{ name: item, priceMinor: Math.round(Number(price) * 100) }] }),
        }),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-muted transition-colors hover:bg-sunken hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </button>
        <span className="font-display text-lg font-bold">Simulated purchase</span>
        <Tag tone="warn">labelled simulated</Tag>
      </div>
      <div role="radiogroup" aria-label="What to simulate" className="grid grid-cols-2 gap-1 rounded-2xl bg-sunken p-1">
        {(
          [
            ['order', 'An order with items'],
            ['upi', 'A UPI payment'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => {
              setKind(k);
              setMerchant(k === 'upi' ? 'Infantaria (demo)' : 'Rehearsal Kitchen (demo)');
            }}
            className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors ${kind === k ? 'bg-surface text-ink shadow-clay-sm' : 'text-muted hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label={kind === 'upi' ? 'Paid to (as your UPI app shows it)' : 'Merchant'}>
          <input className={inputCls} value={merchantName} onChange={(e) => setMerchant(e.target.value)} />
        </Field>
        {kind === 'order' ? (
          <Field label="Item">
            <input className={inputCls} value={item} onChange={(e) => setItem(e.target.value)} />
          </Field>
        ) : null}
        <Field label={kind === 'upi' ? 'Amount paid (₹)' : 'Price (₹)'}>
          <input className={inputCls} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Category">
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
            {config?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Area">
          <select className={inputCls} value={locality} onChange={(e) => setLocality(e.target.value)}>
            {config?.cities.flatMap((c) =>
              c.localities.map((l) => (
                <option key={`${c.id}-${l}`} value={l}>
                  {l}, {c.name}
                </option>
              )),
            )}
          </select>
        </Field>
        <div className="flex items-end">
          <Button type="submit" busy={busy}>
            Create simulated purchase
          </Button>
        </div>
      </form>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Card>
  );
}
