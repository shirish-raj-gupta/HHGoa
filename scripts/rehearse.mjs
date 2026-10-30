// Before the demo:  pnpm rehearse          (against a deployment: REHEARSE_API_URL=https://<domain> pnpm rehearse)
// Checks what the five-minute demo needs and warms the stage's answers (spec A21), then lists what to fix. Reads only:
// nothing is sent on chain and no money moves. Pre-generating a proof per rail and recording a backup run stay manual.
import { existsSync } from 'node:fs';
import { createPublicClient, erc20Abi, formatEther, formatUnits, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);
const env = process.env;
const API = (env.REHEARSE_API_URL ?? env.PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const QUESTIONS = ['Best veg biryani under ₹400 near Calangute?', 'Quietest hotel near Calangute for remote work', 'Best power bank under ₹1,500'];

let toFix = 0;
const line = (ok, what, detail = '') => {
  if (!ok) toFix++;
  console.log(`${ok ? 'ok ' : 'FIX'}  ${what}${detail ? `: ${detail}` : ''}`);
};
const getJson = async (path, init) => {
  const res = await fetch(`${API}${path}`, { ...init, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${path} answered ${res.status}`);
  return res.json();
};

console.log(`Rehearsal against ${API}\n`);

// 1. The API and what it has switched on
try {
  const h = await getJson('/health');
  line(true, 'API answers', `chain ${h.chain}${h.anchored ? ' (anchoring)' : ''}, model ${h.llm}, database ${h.db}`);
  const cfg = await getJson('/v1/config');
  line(cfg.llm?.provider !== 'offline', 'Model for review cards and answers', cfg.llm?.model ?? 'none: answers are extractive');
  line(!!cfg.speech?.on, 'Read-aloud (Smallest AI)', cfg.speech?.on ? 'on' : 'set SMALLEST_API_KEY');
  line(!!cfg.voice?.sarvam, 'Speech to text (Sarvam)', cfg.voice?.sarvam ? cfg.voice.model : 'set SARVAM_API_KEY');
  line(!!cfg.proofs?.reclaim, 'Reclaim order-page proofs', cfg.proofs?.reclaim ? 'on' : 'set RECLAIM_APP_ID and RECLAIM_APP_SECRET');
  line(!!cfg.places?.google, 'Places from Google Maps', cfg.places?.google ? 'on' : 'set GOOGLE_MAPS_API_KEY');
  console.log(`     x402 payments: ${cfg.x402?.on ? `on (${cfg.x402.network})` : 'off: paid tools answer for free, labelled'}`);
} catch (err) {
  line(false, 'API answers', `${err.message}. Start it (pnpm dev) or set REHEARSE_API_URL`);
}

// 2. Wallets on Base Sepolia: gas for the relayer and operator (an attestation costs about 0.000001 ETH there), USDC
// for the stage's agent (x402's facilitator pays the gas of its payments, so it needs no ETH)
const rpc = createPublicClient({ chain: baseSepolia, transport: http(env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org') });
const wallets = [
  ['relayer (submits attestations)', env.RELAYER_PRIVATE_KEY, 0.00003],
  ['operator (posts epochs and levels)', env.OPERATOR_PRIVATE_KEY, 0.00002],
  ['agent (pays for the stage answers)', env.AGENT_PRIVATE_KEY, 0],
];
for (const [name, key, minEth] of wallets) {
  if (!key) {
    line(false, `Wallet: ${name}`, 'no key in the environment');
    continue;
  }
  try {
    const address = privateKeyToAccount(key).address;
    const eth = Number(formatEther(await rpc.getBalance({ address })));
    line(eth >= minEth, `Wallet: ${name}`, `${eth.toFixed(6)} ETH at ${address.slice(0, 6)}…${address.slice(-4)}${eth >= minEth ? '' : `, top up to ${minEth}+ (faucet)`}`);
    if (name.startsWith('agent')) {
      const usdc = Number(formatUnits(await rpc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] }), 6));
      line(usdc >= 0.05, 'Agent USDC for paid answers', `${usdc.toFixed(4)} USDC${usdc >= 0.05 ? '' : ', send 0.05+ from faucet.circle.com'}`);
    }
  } catch (err) {
    line(false, `Wallet: ${name}`, err.message.split('\n')[0]);
  }
}

// 3. TigerGraph: Savanna pauses the workspace after an idle hour
if (env.TIGERGRAPH_API_KEY) {
  try {
    const res = await fetch('https://api.tgcloud.io/controller/v4/v2/workgroups', { headers: { 'x-api-key': env.TIGERGRAPH_API_KEY }, signal: AbortSignal.timeout(20_000) });
    const workspaces = ((await res.json()).Result ?? []).flatMap((g) => g.workspaces ?? []);
    const host = (env.TIGERGRAPH_HOST ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    const ws = workspaces.find((w) => w.nginx_host === host) ?? workspaces[0];
    const status = ws?.display_status || ws?.condition_type || 'unknown';
    line(/running|ready|active|healthy/i.test(status), 'TigerGraph workspace', `${status}${/running|ready|active|healthy/i.test(status) ? '' : ': run pnpm graph:wake'}`);
  } catch (err) {
    line(false, 'TigerGraph workspace', err.message);
  }
} else {
  console.log('     TigerGraph: not configured (ring checks run on Postgres)');
}

// 4. Warm the stage's answers (and see that each has receipts behind it)
for (const q of QUESTIONS) {
  try {
    const t0 = Date.now();
    const a = await getJson('/v1/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q }) });
    const n = a.options?.length ?? 0;
    line(n > 0, `Answer: ${q}`, `${n} option${n === 1 ? '' : 's'} in ${Date.now() - t0} ms (${a.generated_by ?? 'answer'})`);
  } catch (err) {
    line(false, `Answer: ${q}`, err.message);
  }
}

console.log(`\n${toFix ? `${toFix} to fix before the demo.` : 'Ready.'} Still by hand: one live proof per rail, and a recorded backup run.`);
process.exit(toFix ? 1 : 0);
