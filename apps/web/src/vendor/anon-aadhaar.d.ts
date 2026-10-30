// @anon-aadhaar/core publishes its TypeScript sources as its types, and they do not pass a strict typecheck. This
// declaration covers the three exports the app uses, so the compiler never loads those sources; the bundler resolves
// the .js file next to it and uses the real package.
import type { JSX, ReactNode } from 'react';

export interface SerializedAnonAadhaarPCD {
  type: string;
  pcd: string;
}

export type AnonAadhaarState =
  | { status: 'logged-out' }
  | { status: 'logging-in'; anonAadhaarProofs?: Record<number, SerializedAnonAadhaarPCD> }
  | { status: 'logged-in'; anonAadhaarProofs: Record<number, SerializedAnonAadhaarPCD> };

export function AnonAadhaarProvider(props: { children: ReactNode; _appName?: string; _useTestAadhaar?: boolean }): JSX.Element;
export function LogInWithAnonAadhaar(props: { nullifierSeed: number | bigint; signal?: string; fieldsToReveal?: string[] }): JSX.Element;
export function useAnonAadhaar(): [AnonAadhaarState, (request: { type: 'logout' }) => void];
