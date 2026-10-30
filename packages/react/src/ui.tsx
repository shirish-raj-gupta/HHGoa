import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';
import { ArrowUpRight, BadgeCheck, Check, CircleCheck, CircleX, FlaskConical, Info, TriangleAlert } from 'lucide-react';

// Small building blocks shared by every page. No hooks here, so server components can use them too; motion lives
// in ./motion. Press feedback is CSS, which the Motion guide prefers for simple states: clay buttons lift a pixel on
// hover and squish when pressed, springing back with a little overshoot.

type Tone = 'primary' | 'brand' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const tones: Record<Tone, string> = {
  primary: 'bg-accent text-accent-ink shadow-clay-sm hover:brightness-110 active:shadow-clay-pressed',
  brand: 'bg-brand text-brand-ink shadow-clay-sm hover:brightness-[1.04] active:shadow-clay-pressed',
  secondary: 'bg-surface text-ink shadow-clay-sm ring-1 ring-line ring-inset hover:ring-line-strong active:shadow-clay-pressed',
  ghost: 'text-ink hover:bg-sunken',
  danger: 'bg-bad-soft text-bad shadow-clay-sm ring-1 ring-bad/40 ring-inset hover:ring-bad/70 active:shadow-clay-pressed',
};

const sizes: Record<Size, string> = {
  sm: 'min-h-9 rounded-xl px-3 text-xs',
  md: 'min-h-11 rounded-2xl px-4 text-sm',
  lg: 'min-h-13 rounded-[20px] px-6 text-base',
};

const base =
  'inline-flex select-none items-center justify-center gap-2 font-semibold transition-[background-color,box-shadow,transform,filter] duration-200 ease-squish hover:-translate-y-px active:translate-y-0 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:scale-100';

export function Button({
  tone = 'primary',
  size = 'md',
  busy,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: Size; busy?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || busy} aria-busy={busy || undefined} className={`${base} ${sizes[size]} ${tones[tone]} ${className}`}>
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function LinkButton({ href, tone = 'primary', size = 'md', className = '', children }: { href: string; tone?: Tone; size?: Size; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={`${base} ${sizes[size]} ${tones[tone]} ${className}`}>
      {children}
    </Link>
  );
}

// Clay by default; glass over colour; the six blocks always carry navy ink (block-ink, 85% for body text).
const cardTones = {
  default: 'bg-surface shadow-card ring-1 ring-line/70 ring-inset',
  flat: 'border border-line bg-surface',
  sunken: 'border border-line bg-sunken',
  glass: 'glass',
  brand: 'bg-brand text-brand-ink shadow-clay-block',
  lime: 'bg-block-lime text-block-ink shadow-clay-block',
  tangerine: 'bg-block-tangerine text-block-ink shadow-clay-block',
  pink: 'bg-block-pink text-block-ink shadow-clay-block',
  sky: 'bg-block-sky text-block-ink shadow-clay-block',
  violet: 'bg-block-violet text-block-ink shadow-clay-block',
  sun: 'bg-block-sun text-block-ink shadow-clay-block',
};

export type CardTone = keyof typeof cardTones;

export function Card({ children, className = '', tone = 'default' }: { children: ReactNode; className?: string; tone?: CardTone }) {
  return <div className={`rounded-3xl p-4 sm:p-5 ${cardTones[tone]} ${className}`}>{children}</div>;
}

type TagTone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent' | 'brand';

export function Tag({ children, tone = 'neutral', className = '' }: { children: ReactNode; tone?: TagTone; className?: string }) {
  const cls = {
    neutral: 'bg-sunken text-muted ring-1 ring-line ring-inset',
    good: 'bg-accent-soft text-good',
    warn: 'bg-warn-soft text-warn',
    bad: 'bg-bad-soft text-bad',
    accent: 'bg-accent-soft text-ink',
    brand: 'bg-brand text-brand-ink',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${cls} ${className}`}>
      {tone === 'good' ? <Check className="size-3 shrink-0" strokeWidth={3} aria-hidden /> : null}
      {children}
    </span>
  );
}

/** Simulated demo data is always labelled where it shows. */
export function SimulatedTag({ show = true }: { show?: boolean }) {
  return show ? (
    <Tag tone="warn">
      <FlaskConical className="size-3 shrink-0" aria-hidden />
      Simulated demo data
    </Tag>
  ) : null;
}

/** How a review felt about one aspect. Scores are sentiment from -1 to 1, so they show as a word, not a number. */
export function AspectTag({ name, value }: { name: string; value: number }) {
  const [tone, word] = value >= 0.35 ? (['good', 'good'] as const) : value <= -0.35 ? (['bad', 'poor'] as const) : (['neutral', 'mixed'] as const);
  return (
    <Tag tone={tone}>
      {name.replace(/_/g, ' ')} · {word}
    </Tag>
  );
}

/** The lime stamp on a verified receipt. */
export function VerifiedStamp({ children = 'Verified purchase', className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-xs font-bold tracking-wide text-brand-ink uppercase ${className}`}>
      <BadgeCheck className="size-4 shrink-0" aria-hidden />
      {children}
    </span>
  );
}

const STAR = 'M12 2.6l2.84 5.98 6.56.79-4.83 4.52 1.25 6.49L12 17.2l-5.82 3.18 1.25-6.49L2.6 9.37l6.56-.79z';

function StarRow({ className }: { className: string }) {
  return (
    <span className={`flex w-max gap-[0.12em] ${className}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} viewBox="0 0 24 24" className="size-[1em] shrink-0" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
}

/** A rating out of 5, filled to the exact value. `size` is a text-size class (the stars are 1em). */
export function Stars({ value, size = 'text-base' }: { value: number | null; size?: string }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className={`relative inline-flex align-[-0.125em] ${size}`} role="img" aria-label={`${Number(value.toFixed(1))} out of 5`}>
      <StarRow className="text-line" />
      <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${pct}%` }}>
        <StarRow className="text-accent" />
      </span>
    </span>
  );
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden />;
}

const noticeTones: Record<'neutral' | 'warn' | 'bad' | 'good', { cls: string; icon: string; Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }> = {
  neutral: { cls: 'border-line bg-sunken text-ink', icon: 'text-muted', Icon: Info },
  warn: { cls: 'border-warn/30 bg-warn-soft text-ink', icon: 'text-warn', Icon: TriangleAlert },
  bad: { cls: 'border-bad/30 bg-bad-soft text-bad', icon: 'text-bad', Icon: CircleX },
  good: { cls: 'border-good/30 bg-accent-soft text-ink', icon: 'text-good', Icon: CircleCheck },
};

export function Notice({ tone = 'neutral', children }: { tone?: 'neutral' | 'warn' | 'bad' | 'good'; children: ReactNode }) {
  const t = noticeTones[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={`flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-relaxed ${t.cls}`}>
      <t.Icon className={`mt-0.5 size-4 shrink-0 ${t.icon}`} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputCls =
  'w-full rounded-xl border border-line-strong/70 bg-surface px-3.5 py-2.5 text-base text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted/80 hover:border-line-strong focus:border-accent focus:ring-4 focus:ring-brand/35';

/** A small monospace uppercase label with the logo's lime node in front of it. */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.18em] text-muted uppercase ${className}`}>
      <span className="size-1.5 rounded-full bg-brand-strong" aria-hidden />
      {children}
    </span>
  );
}

export function PageTitle({ title, sub, eyebrow, action }: { title: ReactNode; sub?: ReactNode; eyebrow?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end gap-4">
      <div className="min-w-0 flex-1 space-y-2">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className="text-3xl leading-[1.1] font-bold sm:text-4xl">{title}</h1>
        {sub ? <p className="max-w-2xl leading-relaxed text-muted">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Stat({ value, label, className = '' }: { value: ReactNode; label: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="font-display text-3xl font-bold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong/60 bg-surface/60 px-6 py-10 text-center">
      {icon ? <div className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-ink [&_svg]:size-6">{icon}</div> : null}
      <div className="font-display text-lg font-semibold">{title}</div>
      {children ? <div className="max-w-sm text-sm text-muted">{children}</div> : null}
      {action}
    </div>
  );
}

/** An endless row that drifts sideways (brands, rails); pauses on hover, stands still for reduced motion. */
export function Marquee({ children, duration = 40, className = '' }: { children: ReactNode; duration?: number; className?: string }) {
  return (
    <div className={`marquee overflow-hidden ${className}`} style={{ ['--marquee-duration' as string]: `${duration}s` }}>
      <div className="flex w-max">
        <div className="flex shrink-0 items-center gap-10 pr-10">{children}</div>
        <div className="flex shrink-0 items-center gap-10 pr-10" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}

/** QR codes stay black on white with a four-module quiet zone in both themes, because that is what camera apps read
 *  reliably: the one place raw colours belong. Spread these into qrcode.react's QRCodeSVG and wrap it in ScanFrame. */
export const QR_PROPS = { level: 'M', marginSize: 4, fgColor: '#000000', bgColor: '#ffffff' } as const;

/** A plain white frame for a QR code: no clay, glass, tint or shadow over the code. */
export function ScanFrame({ children, label, className = '' }: { children: ReactNode; label: string; className?: string }) {
  return (
    <figure role="img" aria-label={label} className={`inline-block shrink-0 rounded-xl bg-white p-1 ring-1 ring-line ${className}`}>
      {children}
    </figure>
  );
}

export function Skeleton({ className = 'h-24' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-xs break-all ${className}`}>{children}</span>;
}

export function ExternalLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="link inline font-medium">
      {children}
      <ArrowUpRight className="ml-0.5 inline size-3.5 align-[-0.15em]" aria-hidden />
    </a>
  );
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
