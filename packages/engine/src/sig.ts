import { verifyTypedData, type Address, type Hex } from 'viem';

/** Check an EIP-712 signature over typed data that was stored as JSON (bigints already restored). */
export function verifyTypedSignature(address: Address, typedData: unknown, signature: Hex): Promise<boolean> {
  return verifyTypedData({ ...(typedData as Record<string, unknown>), address, signature } as unknown as Parameters<typeof verifyTypedData>[0]);
}
