import { erc20Abi, parseEventLogs, verifyMessage, type Address, type Hex, type PublicClient } from 'viem';
import type { PurchaseClaim } from '@receipts/core';
import { RailError, makeClaim, sameWallet } from './claim';

// Rail 6: a payment to an agent, an API or a crypto merchant. The transaction itself is the receipt: a USDC
// transfer on Base (x402 settles as transferWithAuthorization, which emits the same Transfer event).

export function linkMessage(txHash: Hex, sessionId: string): string {
  return `Receipts: I made payment ${txHash} and want to review it in session ${sessionId}.`;
}

export async function verifyOnchainPayment(input: {
  client: Pick<PublicClient, 'getTransactionReceipt' | 'getBlock'>;
  chainId: number;
  txHash: Hex;
  usdc: Address;
  /** Reviewer's session wallet. */
  wallet: Address;
  sessionId: string;
  /** When the payment came from another wallet (an agent's), that wallet signs linkMessage(txHash, sessionId). */
  payerSignature?: Hex;
  /** Optional: the payee must be this address (e.g. the API being reviewed). */
  expectedPayee?: Address;
  merchantName?: string;
  itemName?: string;
}): Promise<PurchaseClaim> {
  const receipt = await input.client.getTransactionReceipt({ hash: input.txHash });
  if (receipt.status !== 'success') throw new RailError('not_verified', 'transaction failed');
  const transfers = parseEventLogs({ abi: erc20Abi, logs: receipt.logs, eventName: 'Transfer' }).filter(
    (l) => l.address.toLowerCase() === input.usdc.toLowerCase(),
  );
  const transfer = transfers.find((t) => !input.expectedPayee || sameWallet(t.args.to, input.expectedPayee)) ?? transfers[0];
  if (!transfer) throw new RailError('unparseable', 'no USDC transfer in this transaction');

  const payer = transfer.args.from;
  if (!sameWallet(payer, input.wallet)) {
    if (!input.payerSignature) throw new RailError('wallet_mismatch', 'the payment came from another wallet; sign the link message with it');
    const ok = await verifyMessage({ address: payer, message: linkMessage(input.txHash, input.sessionId), signature: input.payerSignature });
    if (!ok) throw new RailError('bad_signature', 'the payer signature does not match');
  }
  const block = await input.client.getBlock({ blockNumber: receipt.blockNumber });
  const day = new Date(Number(block.timestamp) * 1000).toISOString().slice(0, 10);
  // USDC has 6 decimals; amountMinor is in cents for USD so it compares with INR paise only through FX.
  const cents = Number(transfer.args.value / 10_000n);
  return makeClaim({
    rail: 'onchain_payment',
    brandId: 'x402',
    category: 'agents_apis',
    merchant: { name: input.merchantName ?? `API ${transfer.args.to.slice(0, 10)}…`, wallet: transfer.args.to.toLowerCase() as Address },
    items: input.itemName ? [{ name: input.itemName, quantity: 1 }] : [],
    amountMinor: cents,
    currency: 'USDC',
    purchasedOn: day,
    orderRef: `${input.txHash}:${transfer.logIndex}`,
    nullifierSource: `tx:${input.chainId}`,
    boundWallet: input.wallet,
    proof: { kind: 'onchain', chainId: input.chainId, txHash: input.txHash, logIndex: transfer.logIndex, payer, payee: transfer.args.to, value: transfer.args.value.toString() },
    meta: { payer, payee: transfer.args.to, valueBaseUnits: transfer.args.value.toString(), chainId: input.chainId },
  });
}
