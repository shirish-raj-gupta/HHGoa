'use client';

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { EASE_OUT } from './motion';

// Expressive pieces for the marketing surfaces, each kept to a job: numbers that roll like an odometer when they
// change, a word that rotates, a marker that highlights, a card that follows (and leans toward) the pointer, a
// signature that draws itself, a moving gradient and clay orbs behind a hero, and cards that stack as the page
// scrolls. All of them stand still for people who ask for reduced motion.

const ROW = 1.1; // em: one digit row, a little taller than the glyphs so nothing clips

function Digit({ d, delay }: { d: number; delay: number }) {
  return (
    <span className="relative inline-block overflow-hidden" style={{ height: `${ROW}em` }}>
      <motion.span
        className="flex flex-col"
        initial={false}
        animate={{ y: `${-d * 10}%` }}
        transition={{ type: 'spring', bounce: 0.12, duration: 1.1, delay }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <span key={n} className="block text-center" style={{ height: `${ROW}em`, lineHeight: `${ROW}em` }}>
            {n}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

/** A number whose digits roll into place the first time it is seen, and again whenever it changes. */
export function RollingNumber({ value, format = (n) => Math.round(n).toLocaleString('en-IN'), className = '' }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, margin: '0px 0px -5% 0px' });
  const text = format(value);
  const chars = [...text];
  return (
    <span ref={ref} className={`inline-flex items-start tabular-nums ${className}`} style={{ lineHeight: `${ROW}em` }}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex">
        {chars.map((c, i) => {
          // Keyed from the right, so a number that grows keeps its units column in place.
          const key = chars.length - i;
          return /\d/.test(c) ? <Digit key={key} d={seen ? Number(c) : 0} delay={(chars.length - i) * 0.04} /> : <span key={`s${key}`}>{c}</span>;
        })}
      </span>
    </span>
  );
}

/** Rotates through words in place. Screen readers get the whole list once. */
export function TextRotate({ words, interval = 2600, className = '' }: { words: string[]; interval?: number; className?: string }) {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce || words.length < 2) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % words.length), interval);
    return () => window.clearInterval(t);
  }, [reduce, words.length, interval]);
  return (
    <span className={`relative inline-flex ${className}`}>
      <span className="sr-only">{words.join(', ')}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={words[i]}
          aria-hidden
          initial={{ y: '55%', opacity: 0, filter: 'blur(6px)' }}
          animate={{ y: '0%', opacity: 1, filter: 'blur(0px)' }}
          exit={{ y: '-55%', opacity: 0, filter: 'blur(6px)' }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
          className="inline-block whitespace-nowrap"
        >
          {words[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** A marker stroke that sweeps under a phrase the first time it scrolls into view; wraps across lines. */
export function Highlight({ children, delay = 0.2 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.mark
      className="rounded-[0.2em] bg-no-repeat px-[0.08em] text-inherit [box-decoration-break:clone] [-webkit-box-decoration-break:clone]"
      style={{ backgroundColor: 'transparent', backgroundImage: 'linear-gradient(var(--highlight), var(--highlight))', backgroundPosition: '0 88%' }}
      initial={{ backgroundSize: '0% 42%' }}
      whileInView={{ backgroundSize: '100% 42%' }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.7, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.mark>
  );
}

/** A card with a soft light that follows the pointer (mouse and pen; touch screens skip it). With `tilt` it also
 *  leans a few degrees toward the pointer, like a thumb pressing clay. */
export function SpotlightCard({ children, className = '', tilt = false }: { children: ReactNode; className?: string; tilt?: boolean }) {
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    el.style.setProperty('--mx', `${x}px`);
    el.style.setProperty('--my', `${y}px`);
    if (tilt) {
      el.style.setProperty('--rx', `${((0.5 - y / r.height) * 5).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${((x / r.width - 0.5) * 7).toFixed(2)}deg`);
    }
  };
  const onLeave = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.style.setProperty('--rx', '0deg');
    e.currentTarget.style.setProperty('--ry', '0deg');
  };
  return (
    <div onPointerMove={onMove} onPointerLeave={tilt ? onLeave : undefined} className={`spotlight ${tilt ? 'tilt' : ''} ${className}`}>
      {children}
    </div>
  );
}

export type OrbColor = 'lime' | 'tangerine' | 'pink' | 'sky' | 'violet' | 'sun';
export interface OrbSpec {
  color: OrbColor;
  /** Diameter in px. */
  size: number;
  /** Position inside the parent, as CSS lengths (left and top). */
  x: string;
  y: string;
  /** Parallax: how far it rises as the page scrolls (1 = 140px over the first 900px). Deeper orbs move less. */
  depth?: number;
  /** Extra classes, e.g. to show an orb only at some widths. */
  className?: string;
}

/** Clay spheres behind a hero: each drifts slowly and rises at its own speed as the page scrolls, so the glass in
 *  front has colour to frost. Decoration only: hidden from assistive tech, and still for reduced motion. */
export function Orbs({ orbs, className = '' }: { orbs: OrbSpec[]; className?: string }) {
  const still = !!useReducedMotion();
  const { scrollY } = useScroll();
  return (
    <div aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {orbs.map((o, i) => (
        <Orb key={i} orb={o} index={i} scrollY={scrollY} still={still} />
      ))}
    </div>
  );
}

function Orb({ orb, index, scrollY, still }: { orb: OrbSpec; index: number; scrollY: MotionValue<number>; still: boolean }) {
  const y = useTransform(scrollY, [0, 900], [0, still ? 0 : -(orb.depth ?? 1) * 140]);
  return (
    <motion.div className={`absolute ${orb.className ?? ''}`} style={{ left: orb.x, top: orb.y, width: orb.size, height: orb.size, y }}>
      <div
        className={`orb size-full ${still ? '' : 'animate-drift'}`}
        style={{ ['--orb' as string]: `var(--block-${orb.color})`, animationDelay: `${-index * 3.7}s` }}
      />
    </motion.div>
  );
}

/** Cards that stack as the page scrolls: each tilts up into place, sticks under the header, and sinks back a little
 *  as the next one slides over it. Reduced motion keeps the stack and drops the movement. */
export function StackCards({ children, top = 96, step = 16 }: { children: ReactNode[]; top?: number; step?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const still = !!useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  return (
    <div ref={ref} className="relative">
      {children.map((child, i) => (
        <StackCard key={i} index={i} count={children.length} progress={scrollYProgress} top={top + i * step} still={still}>
          {child}
        </StackCard>
      ))}
    </div>
  );
}

function StackCard({ children, index, count, progress, top, still }: { children: ReactNode; index: number; count: number; progress: MotionValue<number>; top: number; still: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: entering } = useScroll({ target: ref, offset: ['start end', 'start 35%'] });
  const rotateX = useTransform(entering, [0, 1], [still ? 0 : 14, 0]);
  const scale = useTransform(progress, [index / count, 1], [1, still ? 1 : 1 - (count - 1 - index) * 0.05]);
  return (
    <div ref={ref} className="sticky" style={{ top, marginBottom: index < count - 1 ? '22vh' : 0 }}>
      <motion.div style={{ rotateX, scale, transformPerspective: 1200, transformOrigin: 'center top' }}>{children}</motion.div>
    </div>
  );
}

/** A signature that writes itself: what "signed by your wallet" looks like. */
export function Signature({ className = 'h-12 w-auto' }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 60" className={className} fill="none" aria-hidden>
      <motion.path
        d="M6 42C18 14 32 10 30 34S40 54 54 30 70 8 74 31s12 21 26-3c6-10 16-8 12 6-2 8 8 12 20-2 8-10 18-8 16 4-1 8 12 8 24-4l42-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.5, ease: 'easeInOut', delay: 0.35 }}
      />
    </svg>
  );
}

// The backdrop: domain-warped noise blending three theme colours (--shader-a/b/c), with grain. Rendered at half
// resolution (it is soft anyway), paused when off screen or in a hidden tab, one still frame for reduced motion.
const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FRAG = `precision mediump float;
uniform vec2 uRes;uniform float uTime;uniform vec3 uA;uniform vec3 uB;uniform vec3 uC;uniform float uGrain;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),u.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p*=2.02;a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;vec2 p=uv*vec2(uRes.x/uRes.y,1.)*1.5;float t=uTime*.05;
  vec2 q=vec2(fbm(p+t),fbm(p+vec2(5.2,1.3)-t));
  vec2 r=vec2(fbm(p+3.*q+vec2(1.7,9.2)+t*.7),fbm(p+3.*q+vec2(8.3,2.8)-t*.6));
  float f=fbm(p+2.4*r);
  vec3 col=mix(uA,uB,smoothstep(.42,.95,f)*smoothstep(.15,.9,uv.x));
  col=mix(col,uC,smoothstep(.3,.9,r.y)*.6);
  col+=(h(gl_FragCoord.xy+fract(uTime))-.5)*uGrain;
  gl_FragColor=vec4(col,1.);
}`;

function readColor(name: string): [number, number, number] {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().replace('#', '');
  const hex = v.length === 3 ? v.replace(/./g, (c) => c + c) : v.padEnd(6, '0');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

export function ShaderBackdrop({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Each mount draws on its own canvas and removes it on cleanup: a canvas hands back the same (lost) context
    // after loseContext(), which would leave it blank when React mounts effects twice in development.
    const host = ref.current;
    if (!host) return;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    host.appendChild(canvas);
    const gl = canvas.getContext('webgl', { antialias: false, powerPreference: 'low-power' });
    if (!gl) {
      canvas.remove();
      return;
    }
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      canvas.remove();
      return;
    }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    const [uRes, uTime, uA, uB, uC, uGrain] = ['uRes', 'uTime', 'uA', 'uB', 'uC', 'uGrain'].map(u);

    const colors = () => {
      gl.uniform3fv(uA!, readColor('--shader-a'));
      gl.uniform3fv(uB!, readColor('--shader-b'));
      gl.uniform3fv(uC!, readColor('--shader-c'));
      gl.uniform1f(uGrain!, Number(getComputedStyle(document.documentElement).getPropertyValue('--grain')) || 0.05);
    };
    const resize = () => {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * 0.5));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * 0.5));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes!, canvas.width, canvas.height);
    };
    const t0 = performance.now();
    const draw = (now: number) => {
      gl.uniform1f(uTime!, (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let onScreen = true;
    const loop = (now: number) => {
      draw(now);
      raf = !still && onScreen && !document.hidden ? requestAnimationFrame(loop) : 0;
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };

    colors();
    resize();
    draw(t0 + 4000);
    if (!still) start();

    const io = new IntersectionObserver(([e]) => {
      onScreen = !!e?.isIntersecting;
      if (onScreen && !still) start();
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    ro.observe(canvas);
    const recolor = () => {
      colors();
      draw(performance.now());
    };
    const mo = new MutationObserver(recolor);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', recolor);
    const vis = () => !document.hidden && !still && start();
    document.addEventListener('visibilitychange', vis);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
      scheme.removeEventListener('change', recolor);
      document.removeEventListener('visibilitychange', vis);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    };
  }, []);
  return <div ref={ref} aria-hidden className={`pointer-events-none ${className}`} />;
}
