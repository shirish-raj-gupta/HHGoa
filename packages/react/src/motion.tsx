'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, MotionConfig, motion, useInView, type Variants } from 'motion/react';

// Motion for the shared UI. One rule from the Motion guide: animate only to show a change of state, a relationship
// or feedback, never for decoration. MotionProvider turns transform and layout animation off for people who ask
// for reduced motion; opacity still fades.

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Fades and lifts content in the first time it scrolls into view. */
export function Reveal({ children, className, delay = 0, y = 14 }: { children: ReactNode; className?: string; delay?: number; y?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.45, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}

const list: Variants = {
  hidden: {},
  shown: (gap: number) => ({ transition: { staggerChildren: gap } }),
};

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
};

/** A list whose children (StaggerItem) arrive one after another, on mount or when scrolled into view. */
export function Stagger({ children, className, gap = 0.07, inView = false }: { children: ReactNode; className?: string; gap?: number; inView?: boolean }) {
  return (
    <motion.div
      className={className}
      variants={list}
      custom={gap}
      initial="hidden"
      {...(inView ? { whileInView: 'shown', viewport: { once: true, margin: '0px 0px -8% 0px' } } : { animate: 'shown' })}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  );
}

/** Counts up to a number the first time it is seen. Screen readers get the final value straight away. */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString('en-IN'), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true });
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!seen) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const controls = animate(0, value, { duration: 1.1, ease: EASE_OUT, onUpdate: setShown });
    return () => controls.stop();
  }, [seen, value]);
  return (
    <span ref={ref} className={className} aria-label={format(value)}>
      <span aria-hidden>{format(shown)}</span>
    </span>
  );
}
