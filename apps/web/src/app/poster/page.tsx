import type { Metadata } from 'next';
import { QRCodeSVG } from 'qrcode.react';
import { Mic, ReceiptText, Wallet } from 'lucide-react';
import { PAID_REVIEW_DISCLOSURE } from '@receipts/core';
import { QR_PROPS, ScanFrame, Wordmark } from '@receipts/react';
import { WEB_URL } from '@/lib/env';

// The seeding poster (spec A21): print it, stick it by a counter or a hostel desk. One short link in the QR, as every
// QR here carries; it opens the review flow. Outside the site layout, so the page is just the poster.

export const metadata: Metadata = { title: 'Poster', robots: { index: false } };

const STEPS = [
  { Icon: ReceiptText, title: 'Prove it', body: 'Your order page, order email, UPI payment or the QR on your bill.' },
  { Icon: Mic, title: 'Say it', body: 'Fifteen seconds, in any Indian language.' },
  { Icon: Wallet, title: 'Get paid', body: 'Whenever an AI agent uses your review, whatever the rating.' },
];

export default function Poster() {
  const link = `${WEB_URL}/review`;
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-10 px-6 py-12 text-center print:min-h-0 print:py-0">
      <Wordmark title="Receipts" className="h-14 w-auto" />
      <h1 className="text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl">
        Get paid when AI agents use your <span className="font-serif font-normal italic">15-second review</span> of anything you paid for.
      </h1>
      <ScanFrame label={`Scan to review: ${link}`}>
        <QRCodeSVG value={link} size={280} {...QR_PROPS} />
      </ScanFrame>
      <p className="font-mono text-sm text-muted">{link.replace(/^https?:\/\//, '')}</p>
      <ol className="grid w-full gap-4 text-left sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-[28px] bg-surface p-5 shadow-card ring-1 ring-line/70 ring-inset">
            <span className="flex items-center gap-2 font-display text-lg font-extrabold">
              <s.Icon className="size-5 text-good" aria-hidden />
              {i + 1}. {s.title}
            </span>
            <span className="mt-1 block text-sm text-muted">{s.body}</span>
          </li>
        ))}
      </ol>
      <p className="max-w-xl text-xs text-muted">{PAID_REVIEW_DISCLOSURE}</p>
    </main>
  );
}
