// Deploy Receipts to Base Sepolia (default) or Base, register the EAS schemas and write deployments/index.json.
//   pnpm contracts:deploy                      # Base Sepolia, includes the testnet governance token
//   pnpm contracts:deploy -- --skip-governance # core contracts only (about half the gas)
//   pnpm contracts:deploy -- --governance-only # add the governance pair to an existing deployment
//   pnpm contracts:deploy -- --chain base --i-know-this-is-mainnet
// Env (root .env): DEPLOYER_PRIVATE_KEY, OPERATOR_PRIVATE_KEY (or OPERATOR_ADDRESS), BASE_SEPOLIA_RPC_URL, BASE_RPC_URL.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { CHAINS } from '@receipts/core';
import { deployGovernance, deployReceipts } from '../ts/deploy';
import type { Deployment } from '../ts/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['../../.env.local', '../../.env']) {
  const p = join(root, f);
  if (existsSync(p)) process.loadEnvFile(p);
}

const args = process.argv.slice(2);
const chainName = args[args.indexOf('--chain') + 1] && args.includes('--chain') ? args[args.indexOf('--chain') + 1] : 'base-sepolia';
const chain = chainName === 'base' ? base : baseSepolia;
if (chain.id === base.id && !args.includes('--i-know-this-is-mainnet')) {
  console.error('Refusing to deploy to Base mainnet without --i-know-this-is-mainnet (audit the contracts first).');
  process.exit(1);
}

const key = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
if (!key) {
  console.error('Set DEPLOYER_PRIVATE_KEY in .env (fund it with Base Sepolia ETH from a faucet).');
  process.exit(1);
}
const account = privateKeyToAccount(key);
const operator = (process.env.OPERATOR_ADDRESS as Address | undefined) ??
  (process.env.OPERATOR_PRIVATE_KEY ? privateKeyToAccount(process.env.OPERATOR_PRIVATE_KEY as Hex).address : account.address);
const rpc = chain.id === base.id ? process.env.BASE_RPC_URL : process.env.BASE_SEPOLIA_RPC_URL;
const info = CHAINS[chain.id]!;

const publicClient = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ account, chain, transport: http(rpc) });

console.log(`Deploying to ${chain.name} from ${account.address}; operator ${operator}`);
const balance = await publicClient.getBalance({ address: account.address });
console.log(`deployer balance: ${Number(balance) / 1e18} ETH`);

const file = join(root, 'deployments', 'index.json');
const all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Deployment>;
const save = (deployment: Deployment) => {
  all[String(chain.id)] = deployment;
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
  console.log(`wrote deployments/index.json for chain ${chain.id}`);
};

if (args.includes('--governance-only')) {
  const existing = all[String(chain.id)];
  if (!existing) {
    console.error(`No deployment for chain ${chain.id} yet: deploy the core contracts first.`);
    process.exit(1);
  }
  if (existing.governor) {
    console.error(`Governance is already deployed on chain ${chain.id} (${existing.governor}).`);
    process.exit(1);
  }
  save({ ...existing, ...(await deployGovernance(wallet, publicClient, existing.roles.admin)) });
  process.exit(0);
}

save(
  await deployReceipts(wallet, publicClient, {
    eas: info.eas,
    schemaRegistry: info.schemaRegistry,
    usdc: info.usdc!,
    verifier: operator,
    trustEngine: operator,
    rootPoster: operator,
    governance: chain.id === baseSepolia.id && !args.includes('--skip-governance'),
  }),
);
