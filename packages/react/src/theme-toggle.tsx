'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Moon, Sun } from 'lucide-react';

import { THEME_COLOR, THEME_KEY, type ThemeName } from './theme-script';

// Two themes, skin (light) and dark, chosen per device and remembered. Until someone picks one, the page follows
// the system setting (the stage starts dark: it is projected).

function currentTheme(): ThemeName {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(t: ThemeName) {
  document.documentElement.dataset.theme = t;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', THEME_COLOR[t]);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeName | null>(null);
  useEffect(() => setTheme(currentTheme()), []);

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    const next: ThemeName = currentTheme() === 'dark' ? 'light' : 'dark';
    const change = () => {
      applyTheme(next);
      setTheme(next);
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      change();
      return;
    }
    // The new theme grows out of the button as a circle.
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = doc.startViewTransition(() => flushSync(change));
    void transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    });
  };

  const dark = theme === 'dark';
  const label = dark ? 'Switch to the skin (light) theme' : 'Switch to the dark theme';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      data-theme-toggle={theme ?? ''}
      className={`relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-surface text-ink transition-colors hover:border-line-strong active:scale-95 ${className}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme ?? 'unknown'}
          initial={{ y: 14, rotate: -90, opacity: 0 }}
          animate={{ y: 0, rotate: 0, opacity: 1 }}
          exit={{ y: -14, rotate: 90, opacity: 0 }}
          transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }}
          className="grid place-items-center"
        >
          {theme === null ? <span className="size-4" /> : dark ? <Moon className="size-[18px]" aria-hidden /> : <Sun className="size-[18px]" aria-hidden />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
