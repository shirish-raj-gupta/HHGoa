'use client';

import { AnonAadhaarProvider, LogInWithAnonAadhaar, useAnonAadhaar } from '@/vendor/anon-aadhaar';
import { useEffect, useRef } from 'react';

// Anon Aadhaar: the phone proves the signed mAadhaar secure QR in the browser. Only a nullifier (one per person for
// this app) and the wallet signal leave the device; the API checks the QR was signed within the last hour.

function Inner({ seed, wallet, onProof }: { seed: string; wallet: string; onProof(pcd: string): void }) {
  const [state] = useAnonAadhaar();
  const sent = useRef(false);
  useEffect(() => {
    if (state.status !== 'logged-in' || sent.current) return;
    const proofs = Object.values(state.anonAadhaarProofs);
    const last = proofs[proofs.length - 1];
    if (!last) return;
    sent.current = true;
    onProof(JSON.stringify(last));
  }, [state, onProof]);
  return <LogInWithAnonAadhaar nullifierSeed={BigInt(seed)} signal={wallet} />;
}

export default function AadhaarLogin({ seed, test, wallet, onProof }: { seed: string; test: boolean; wallet: string; onProof(pcd: string): void }) {
  return (
    <AnonAadhaarProvider _useTestAadhaar={test} _appName="Receipts">
      <Inner seed={seed} wallet={wallet} onProof={onProof} />
    </AnonAadhaarProvider>
  );
}
