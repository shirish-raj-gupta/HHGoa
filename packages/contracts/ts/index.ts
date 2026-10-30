import deployments from '../deployments/index.json';
import type { Deployment } from './types';

export * from './abis.generated';
export type { Deployment, SchemaUids } from './types';

/** Deployments written by scripts/deploy.ts, keyed by chain ID. */
export const DEPLOYMENTS = deployments as Record<string, Deployment>;

export function getDeployment(chainId: number): Deployment | null {
  return DEPLOYMENTS[String(chainId)] ?? null;
}
