// Chain failures that pass (the relayer or operator out of gas, Base not answering, a nonce race), as opposed to a
// revert: what can be published now and anchored later, or completed without its attestation.

/** A failure that passes: the relayer out of gas, Base not answering, a nonce race. Not a revert. */
export function anchorCanWait(err: unknown): boolean {
  for (let cur: unknown = err, i = 0; cur instanceof Error && i < 6; cur = cur.cause, i++) {
    if (/revert/i.test(cur.name) || /execution reverted/i.test(cur.message)) return false;
    if (/HttpRequestError|TimeoutError|InsufficientFundsError|NonceTooLowError/.test(cur.name)) return true;
    if (/insufficient funds|exceeds the balance|fetch failed|timed? ?out|nonce too low|underpriced|ECONNRESET|ETIMEDOUT/i.test(cur.message)) return true;
  }
  return false;
}
