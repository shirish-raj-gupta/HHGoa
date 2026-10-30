'use client';

import { SelfAppBuilder, SelfQRcodeWrapper } from '@selfxyz/qrcode';
import { useMemo, useState } from 'react';

// Self: the user scans with the Self app, which proves "a unique passport or Aadhaar holder" with a zero-knowledge
// proof and posts it to our API (SELF_ENDPOINT), bound to this wallet. Nothing about the person is disclosed.
// Self marks this open-source SDK as legacy (its paid hosted flow replaces it); Anon Aadhaar is the fallback.

export default function SelfQr({ scope, endpoint, staging, wallet, onSuccess }: { scope: string; endpoint: string; staging: boolean; wallet: string; onSuccess(): void }) {
  const [error, setError] = useState<string | null>(null);
  // The builder rejects bad configs (a localhost endpoint, a scope over 31 characters) by throwing.
  const built = useMemo(() => {
    try {
      const app = new SelfAppBuilder({
        appName: 'Receipts',
        scope,
        endpoint,
        endpointType: staging ? 'staging_https' : 'https',
        userId: wallet.toLowerCase(),
        userIdType: 'hex',
        devMode: staging,
        disclosures: {},
      }).build();
      return { app, problem: null };
    } catch (e) {
      return { app: null, problem: e instanceof Error ? e.message : String(e) };
    }
  }, [scope, endpoint, staging, wallet]);
  if (!built.app) return <p className="text-sm text-bad">Self is misconfigured on this server: {built.problem}</p>;
  return (
    <div className="flex flex-col items-center gap-2">
      <SelfQRcodeWrapper selfApp={built.app} onSuccess={onSuccess} onError={(e) => setError(e.reason ?? e.error_code ?? 'Self could not verify this proof.')} size={240} />
      {error ? <p className="text-sm text-bad">{error}</p> : null}
    </div>
  );
}
