'use client';

import { useState, type FormEvent } from 'react';
import { Button, Card, errorText, Field, inputCls, Mono, Notice, PageTitle, Tag, useSession } from '@receipts/react';
import { API_URL } from '@/lib/env';

const TOOLS: [string, string, string][] = [
  ['search_receipts', '$0.005', 'Ranked options for a buying question, with trust score, verified buyers, price paid, durability and claims linked to receipts.'],
  ['get_item_reputation', '$0.002', 'Score breakdown, rating histogram, top claims and durability for one item.'],
  ['get_merchant_reputation', '$0.002', 'Merchant score across items, reply rate and durability.'],
  ['get_receipt', 'free', 'One review with its proof summary and attestation link.'],
  ['verify_receipt', 'free', 'Re-runs every check on a review and reports each result.'],
  ['get_shop_link', 'free', 'A shop-through link with the commission disclosed. Rankings never read commission data.'],
  ['coverage', 'free', 'Categories, brands and proof rails covered in an area or for a brand.'],
];

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-xl bg-sunken p-3 font-mono text-xs leading-relaxed">{children}</pre>;
}

export default function Developers() {
  const { config } = useSession();
  const x = config?.x402;
  return (
    <div className="space-y-5">
      <PageTitle eyebrow="For agents and developers" title="Receipts for AI agents" sub="Verified-buyer answers over MCP or plain HTTPS, paid per call in USDC over x402 on Base. No account needed." />
      <div className="flex flex-wrap gap-2">
        <Tag tone={x?.on ? 'good' : 'warn'}>{x?.on ? `x402 on · ${x.network}` : 'x402 off on this server: paid tools answer free, labelled "free"'}</Tag>
        {config ? <Tag>chain: {config.chain.mode}</Tag> : null}
      </div>

      <Card className="space-y-3">
        <h2 className="font-semibold">MCP</h2>
        <p className="text-sm text-muted">Streamable HTTP endpoint. Paid tools answer with x402 payment requirements; an x402-capable MCP client signs a USDC authorization and retries.</p>
        <Code>{`${API_URL}/mcp`}</Code>
        <p className="text-sm text-muted">Claude Code:</p>
        <Code>{`claude mcp add --transport http receipts ${API_URL}/mcp`}</Code>
        <p className="text-sm text-muted">MCP clients that cannot pay: run the local bridge, which pays from your agent wallet within a budget.</p>
        <Code>{`RECEIPTS_API_URL=${API_URL} AGENT_PRIVATE_KEY=0x... AGENT_BUDGET_USDC=0.10 \\\n  pnpm --dir apps/mcp bridge`}</Code>
      </Card>

      <Card className="p-0!">
        {TOOLS.map(([name, price, desc]) => (
          <div key={name} className="grid gap-1 border-b border-line px-4 py-3 last:border-0 sm:grid-cols-[13rem_4rem_1fr]">
            <Mono className="text-sm!">{name}</Mono>
            <span className={`text-sm ${price === 'free' ? 'text-good' : ''}`}>{price}</span>
            <span className="text-sm text-muted">{desc}</span>
          </div>
        ))}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">HTTPS with x402</h2>
        <p className="text-sm text-muted">The first request returns 402 with the price in the PAYMENT-REQUIRED header; the x402 fetch wrapper pays and retries.</p>
        <Code>{`import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
const pay = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: '${x?.network ?? 'eip155:84532'}', client: new ExactEvmScheme(account) }],
  spendControls: { maxAmountPerPayment: '$0.01' },
});
const res = await pay('${API_URL}/v1/answer?q=' + encodeURIComponent('best veg biryani under ₹400 near Calangute'));
console.log(await res.json());`}</Code>
        <p className="text-sm text-muted">Free for anyone: {`${API_URL}/v1/receipts/{uid}/verify`}</p>
      </Card>

      <ApiKeys />

      <p className="text-xs text-muted">
        70% of what agents pay goes to the reviewers whose reviews the answer cited. Every claim links to its receipts: cite them when you relay an answer.
      </p>
    </div>
  );
}

function ApiKeys() {
  const { client, config } = useSession();
  const billingOn = config?.billing?.credits === true;
  const [email, setEmail] = useState('');
  const [key, setKey] = useState<{ id: string; apiKey: string } | null>(null);
  const [dollars, setDollars] = useState('5');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('key');
    setError(null);
    try {
      setKey(await client.request<{ id: string; apiKey: string }>('POST', '/v1/billing/api-keys', { email, label: 'web' }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const buy = async () => {
    if (!key || !billingOn) return;
    setBusy('buy');
    setError(null);
    try {
      const r = await client.request<{ checkoutUrl: string | null }>('POST', '/v1/billing/credits/checkout', { apiKey: key.apiKey, email, dollars: Number(dollars) });
      if (r.checkoutUrl) window.location.href = r.checkoutUrl;
      else setError('Card payments are not configured on this server.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Pay by card instead</h2>
      <p className="text-sm text-muted">Prepaid credits with an API key, for teams without a wallet. Send it as a Bearer token to the same endpoints.</p>
      {config && !billingOn ? <Notice>Billing is not available yet.</Notice> : null}
      {config?.billing?.testMode ? <Notice tone="warn">Dodo test mode: payments are simulated; no real money moves.</Notice> : null}
      {key ? (
        <div className="space-y-3">
          <Notice tone="warn">
            Your API key, shown once:
            <div className="mt-1">
              <Mono>{key.apiKey}</Mono>
            </div>
          </Notice>
          <div className="flex items-end gap-2">
            <Field label="Credits (USD)">
              <input className={inputCls} inputMode="decimal" value={dollars} onChange={(e) => setDollars(e.target.value)} />
            </Field>
            <Button busy={busy === 'buy'} disabled={!billingOn} onClick={() => void buy()}>
              Buy credits
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row">
          <input className={inputCls} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          <Button type="submit" busy={busy === 'key'}>
            Create API key
          </Button>
        </form>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Card>
  );
}
