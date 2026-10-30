'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Mic, Square } from 'lucide-react';
import { Spinner } from '@receipts/react';

// The 15-second voice note. Records in whatever the browser supports (webm/opus on Chrome and Android, mp4 on
// Safari); the API sends it to speech-to-text and deletes the audio after seven days. The level bars follow the
// real microphone input, so the reviewer can see they are being heard.

const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const BARS = 5;
const RING = 2 * Math.PI * 46;

export function Recorder({ maxSeconds = 15, busy, onRecorded }: { maxSeconds?: number; busy?: boolean; onRecorded(blob: Blob): void }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const meter = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);

  const stopMeter = useCallback(() => {
    if (!meter.current) return;
    cancelAnimationFrame(meter.current.raf);
    void meter.current.ctx.close().catch(() => undefined);
    meter.current = null;
    for (const b of bars.current) if (b) b.style.transform = 'scaleY(0.15)';
  }, []);

  const stop = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    if (rec.current?.state === 'recording') rec.current.stop();
    stopMeter();
    setRecording(false);
  }, [stopMeter]);

  useEffect(() => stop, [stop]);

  const startMeter = (stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const per = Math.floor(data.length / BARS);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        for (let i = 0; i < BARS; i++) {
          let sum = 0;
          for (let j = i * per; j < (i + 1) * per; j++) sum += data[j]!;
          const level = Math.min(1, sum / per / 160);
          const bar = bars.current[i];
          if (bar) bar.style.transform = `scaleY(${0.15 + level * 0.85})`;
        }
        if (meter.current) meter.current.raf = requestAnimationFrame(tick);
      };
      meter.current = { ctx, raf: requestAnimationFrame(tick) };
    } catch {
      // No Web Audio: the recording still works, only the meter is missing.
    }
  };

  const start = async () => {
    setError(null);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot record audio. Type your review instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: r.mimeType || mimeType || 'audio/webm' });
        if (blob.size > 0) onRecorded(blob);
      };
      r.start(250);
      rec.current = r;
      startMeter(stream);
      setRecording(true);
      setElapsed(0);
      const t0 = Date.now();
      timer.current = window.setInterval(() => {
        const s = (Date.now() - t0) / 1000;
        setElapsed(s);
        if (s >= maxSeconds) stop();
      }, 100);
    } catch {
      setError('Microphone permission was refused. Allow it in the browser, or type instead.');
    }
  };

  const left = Math.max(0, maxSeconds - elapsed);
  const progress = Math.min(1, elapsed / maxSeconds);
  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div className="relative grid size-44 place-items-center">
        {recording ? (
          <>
            <span className="absolute inset-4 animate-ring rounded-full bg-brand/40" aria-hidden />
            <span className="absolute inset-4 animate-ring rounded-full bg-brand/30 [animation-delay:0.9s]" aria-hidden />
          </>
        ) : null}
        <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r="46" fill="none" strokeWidth="3" className="stroke-line" />
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            className="stroke-brand-strong transition-[stroke-dashoffset] duration-100 ease-linear"
            strokeDasharray={RING}
            strokeDashoffset={RING * (1 - progress)}
          />
        </svg>
        <motion.button
          type="button"
          onClick={recording ? stop : () => void start()}
          disabled={busy}
          whileTap={{ scale: 0.94 }}
          animate={{ scale: recording ? 1.04 : 1 }}
          transition={{ type: 'spring', bounce: 0.35, duration: 0.4 }}
          className={`relative grid size-32 place-items-center rounded-full shadow-lift transition-colors disabled:opacity-60 ${recording ? 'bg-accent text-accent-ink' : 'bg-brand text-brand-ink'}`}
          aria-label={recording ? `Stop recording, ${left.toFixed(0)} seconds left` : 'Start recording'}
        >
          {busy ? (
            <Spinner className="size-8" />
          ) : recording ? (
            <span className="flex flex-col items-center">
              <span className="font-display text-4xl leading-none font-bold tabular-nums">{left.toFixed(0)}</span>
              <Square className="mt-1.5 size-4 fill-current" aria-hidden />
            </span>
          ) : (
            <Mic className="size-11" strokeWidth={2.2} aria-hidden />
          )}
        </motion.button>
      </div>
      <div className="flex h-8 items-center gap-1.5" aria-hidden>
        {Array.from({ length: BARS }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              bars.current[i] = el;
            }}
            className={`block h-8 w-1.5 origin-center rounded-full transition-transform duration-75 ${recording ? 'bg-brand-strong' : 'bg-line'}`}
            style={{ transform: 'scaleY(0.15)' }}
          />
        ))}
      </div>
      <p className="text-sm font-medium text-muted" aria-live="polite">
        {busy ? 'Turning it into your card…' : recording ? 'Listening. Tap to finish.' : `Tap to talk · up to ${maxSeconds} seconds`}
      </p>
      {error ? <p className="text-center text-sm text-bad">{error}</p> : null}
    </div>
  );
}
