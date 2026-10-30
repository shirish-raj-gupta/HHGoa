'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { isAddress } from 'viem';
import { motion } from 'motion/react';
import type { Earnings } from '@receipts/client';
import { RequireHuman } from '@/components/require-human';
import { Button, Card, EASE_OUT, RollingNumber, errorText, ExternalLink, Field, inputCls, Mono, Notice, PageTitle, Skeleton, Tag, useSession } from '@receipts/react';

export default function EarningsPage() {
  return (
    <div>
      <PageTitle eyebrow="Paid by agents" title="Earnings" sub="You are paid when AI agents cite your reviews: 70% of what agents pay for an answer, split by how much each review was used. Pay never depends on your rating." />
      <RequireHuman what="see your earnings">
        <EarningsInner />
      </RequireHuman>
    </div>
  );
}

function EarningsInner() {
  const { client, wallet, config } = useSession();
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string; link?: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<'upi' | 'usdc'>('upi');
  const [address, setAddress] = useState('');

  const load = useCallback(async () => {
    const d = await client.money.earnings();
    setData(d);
    if (d.payoutMethod) {
      setKind(d.payoutMethod.kind);
      setAddress(d.payoutMethod.address);
    }
  }, [client]);

  useEffect(() => {
    load().catch((e) => setError(errorText(e)));
  }, [load]);

  const act = async (name: string, fn: () => Promise<{ text: string; link?: string | null }>) => {
    setBusy(name);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tone: 'good', ...r });
      await load();
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data)
    return (
      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]" aria-busy>
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );

  const claimable = Number(data.claim.claimable);
  const savePayout = (e: FormEvent) => {
    e.preventDefault();
    void act('payout', async () => {
      await client.money.setPayoutMethod(kind, address.trim());
      return { text: kind === 'upi' ? 'UPI ID saved.' : 'Wallet saved.' };
    });
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <div className="relative overflow-hidden rounded-3xl bg-accent p-6 text-accent-ink shadow-lift">
          <div className="bg-dots absolute inset-0 opacity-25" aria-hidden />
          <div className="relative space-y-1">
            <span className="text-xs font-semibold tracking-[0.14em] uppercase opacity-80">Ready to claim</span>
            <div className="font-display text-5xl font-bold tracking-tight tabular-nums">
              <RollingNumber value={claimable} format={(n) => `$${n.toFixed(4)}`} />
            </div>
            <span className="text-sm opacity-80">USDC on Base · claims are gasless</span>
          </div>
          <div className="relative mt-6 space-y-1.5">
            <div className="flex justify-between text-xs opacity-80">
              <span>Today, level {data.level}</span>
              <span className="font-mono">
                ${Number(data.today).toFixed(4)} of ${Number(data.dailyCap).toFixed(2)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-accent-ink/20">
              <motion.div
                className="h-full origin-left rounded-full bg-accent-mark"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: Math.min(1, Number(data.today) / Math.max(Number(data.dailyCap), 1e-9)) }}
                transition={{ duration: 0.8, ease: EASE_OUT }}
              />
            </div>
          </div>
        </div>
        <div className="grid gap-3">
          {[
            ['Earned, not yet in an epoch', data.totals.accrued],
            ['Claimed', data.claim.claimed],
            ['Paid out in ₹ (as USDC)', data.totals.paidInr],
          ].map(([label, v]) => (
            <Card key={label} className="flex items-center justify-between gap-3 p-4!">
              <span className="text-sm text-muted">{label}</span>
              <span className="font-display text-xl font-bold tabular-nums">${Number(v).toFixed(4)}</span>
            </Card>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted">
        The daily cap rises with your level as your reviews prove accurate. Earnings move into a claimable epoch once a day.
      </p>

      <Card className="space-y-3">
        <h2 className="font-semibold">Claim USDC</h2>
        <p className="text-sm text-muted">Claims are gasless: Receipts submits the transaction and pays the gas.</p>
        <div className="flex flex-wrap gap-2">
          <Button
            busy={busy === 'claim'}
            disabled={claimable <= 0}
            onClick={() =>
              void act('claim', async () => {
                const r = await client.money.claim();
                return { text: `Claimed $${r.amount} USDC to ${r.to}.`, link: r.explorerTx };
              })
            }
          >
            Claim ${claimable.toFixed(4)} to this wallet
          </Button>
        </div>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!wallet) return;
            void act('claim-to', async () => {
              const r = await client.money.claimTo(to.trim(), wallet.signer);
              return { text: `Claimed $${r.amount} USDC to ${r.to}.`, link: r.explorerTx };
            });
          }}
        >
          <input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} placeholder="Or send to another wallet, e.g. Cake Wallet: 0x…" />
          <Button type="submit" tone="secondary" busy={busy === 'claim-to'} disabled={claimable <= 0 || !isAddress(to.trim())}>
            Sign and send
          </Button>
        </form>
        <p className="text-xs text-muted">
          To keep earnings in Cake Wallet: open its Base wallet, tap Receive and paste that address here. USDC is paid on Base only; the same address on another
          network will not receive it.{config && config.chain.mode !== 'base' ? ' This server pays on Base Sepolia (testnet), which Cake Wallet does not display.' : ''}
        </p>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Rupees to UPI</h2>
        <form onSubmit={savePayout} className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
          <Field label="Pay me in">
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as 'upi' | 'usdc')}>
              <option value="upi">₹ via UPI</option>
              <option value="usdc">USDC</option>
            </select>
          </Field>
          <Field label={kind === 'upi' ? 'UPI ID' : 'Wallet address'}>
            <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={kind === 'upi' ? 'name@okbank' : '0x…'} />
          </Field>
          <Button type="submit" tone="secondary" busy={busy === 'payout'} disabled={!address.trim()}>
            Save
          </Button>
        </form>
        {!data.inr.on ? (
          <Notice>
            Rupee payouts are not enabled on this server. Your earnings are safe; claim them in USDC above meanwhile.
          </Notice>
        ) : data.payoutMethod?.kind === 'upi' ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              busy={busy === 'inr'}
              disabled={data.inr.paise < data.inr.minimumPaise}
              onClick={() =>
                void act('inr', async () => {
                  const r = await client.money.withdrawInr();
                  return { text: `₹${r.rupees.toFixed(2)} sent to your UPI ID (${r.status}${r.testMode ? ', test mode' : ''}).` };
                })
              }
            >
              Withdraw ₹{(data.inr.paise / 100).toFixed(2)} to UPI
            </Button>
            {data.inr.paise < data.inr.minimumPaise ? <span className="text-sm text-muted">UPI withdrawals start at ₹{(data.inr.minimumPaise / 100).toFixed(0)}.</span> : null}
          </div>
        ) : null}
      </Card>

      {msg ? (
        <Notice tone={msg.tone}>
          {msg.text} {msg.link ? <ExternalLink href={msg.link}>View transaction</ExternalLink> : null}
        </Notice>
      ) : null}

      <Card className="space-y-2">
        <h2 className="font-semibold">Recent citations</h2>
        {data.recent.length === 0 ? <p className="text-sm text-muted">No citations yet. Agents cite reviews with clear, specific claims.</p> : null}
        {data.recent.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 border-b border-line py-2 text-sm last:border-0">
            <span className="font-mono">${Number(r.amount).toFixed(5)}</span>
            <span className="min-w-0 flex-1 truncate text-muted">
              {r.query ? `“${r.query}”` : r.source}
              {r.item ? ` · ${r.item}` : ''}
            </span>
            <Tag tone={r.status === 'capped' ? 'warn' : r.status === 'simulated' ? 'warn' : 'neutral'}>{r.status}</Tag>
          </div>
        ))}
      </Card>

      {data.payouts.length ? (
        <Card className="space-y-2">
          <h2 className="font-semibold">Payouts</h2>
          {data.payouts.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <Tag>{p.kind}</Tag>
              <span>{p.amount_usdc ? `$${p.amount_usdc}` : p.amount_paise ? `₹${(Number(p.amount_paise) / 100).toFixed(2)}` : ''}</span>
              <Mono className="text-muted">{p.tx_hash ?? p.destination}</Mono>
              {p.test_mode ? <Tag tone="warn">test mode</Tag> : null}
            </div>
          ))}
        </Card>
      ) : null}
      <p className="text-xs text-muted">{data.disclosure}</p>
    </div>
  );
}
