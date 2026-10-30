'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Volume2 } from 'lucide-react';

/** Reads a published review or answer aloud (the API's /v1/speech endpoints). The audio loads on the first press, not
 *  with the page, and pressing again pauses. Shown only when the server has read-aloud on (config.speech). */
export function ListenButton({ src, label = 'Listen', className = '' }: { src: string; label?: string; className?: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'failed'>('idle');

  useEffect(() => () => audio.current?.pause(), []);

  const press = () => {
    if (state === 'playing') return audio.current?.pause();
    if (!audio.current) {
      const a = new Audio(src);
      a.addEventListener('playing', () => setState('playing'));
      a.addEventListener('pause', () => setState('idle'));
      a.addEventListener('ended', () => setState('idle'));
      a.addEventListener('error', () => setState('failed'));
      audio.current = a;
    }
    setState('loading');
    audio.current.play().catch(() => setState('failed'));
  };

  const Icon = state === 'loading' ? Loader2 : state === 'playing' ? Pause : Volume2;
  return (
    <button
      type="button"
      onClick={press}
      aria-pressed={state === 'playing'}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full bg-surface px-4 text-sm font-medium text-ink shadow-clay-sm ring-1 ring-line ring-inset transition-transform duration-200 ease-squish hover:-translate-y-px active:scale-[0.96] motion-reduce:transform-none ${className}`}
    >
      <Icon className={`size-4 ${state === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
      {state === 'playing' ? 'Pause' : state === 'failed' ? 'Could not play; try again' : label}
    </button>
  );
}
