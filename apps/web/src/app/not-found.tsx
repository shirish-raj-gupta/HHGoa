import { LinkButton, LogoMark } from '@receipts/react';

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center px-4 text-center">
      <div className="space-y-5">
        <LogoMark className="mx-auto h-16 w-auto opacity-90" title={null} />
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">No receipt here.</h1>
          <p className="text-muted">There is no receipt, page or listing at this address.</p>
        </div>
        <LinkButton href="/">Back to Receipts</LinkButton>
      </div>
    </main>
  );
}
