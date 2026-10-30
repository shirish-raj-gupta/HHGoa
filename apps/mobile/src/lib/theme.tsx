import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// The same two themes as the web apps (packages/react/src/theme.css), as values for React Native: skin (light) and
// dark. The app follows the system until the person picks one; the choice is kept on the device.
// Lime is never text on the skin palette; there lime marks use brandStrong.
// Clay is boxShadow (inset light and shade plus a soft drop; New Architecture). The colour blocks are the same in both
// themes and always carry navy ink.

const blocks = { lime: '#95f64b', tangerine: '#ff8a3d', pink: '#ff7ab0', sky: '#7cd4ff', violet: '#a48bff', sun: '#ffd23f' };
const clayBlock = 'inset 0px 1px 0px rgba(255,255,255,0.55), inset 8px 10px 20px rgba(255,255,255,0.4), inset -8px -12px 22px rgba(2,20,45,0.16), 0px 20px 36px -18px rgba(2,20,45,0.45)';

const light = {
  blocks,
  blockInk: '#02142d',
  bubble: 'rgba(255,255,255,0.45)',
  clay: 'inset 0px 1px 0px rgba(255,255,255,0.7), inset 6px 8px 16px rgba(255,255,255,0.45), inset -6px -10px 18px rgba(70,45,20,0.08), 0px 18px 34px -18px rgba(70,45,20,0.34)',
  claySm: 'inset 0px 1px 0px rgba(255,255,255,0.55), inset 3px 4px 8px rgba(255,255,255,0.35), inset -3px -5px 9px rgba(70,45,20,0.14), 0px 10px 18px -10px rgba(70,45,20,0.4)',
  clayPressed: 'inset 4px 6px 12px rgba(70,45,20,0.22), inset -2px -3px 6px rgba(255,255,255,0.35)',
  clayBlock,
  curtain: '#02142d',
  curtainInk: '#f5f1e6',
  curtainLine: 'rgba(245,241,230,0.25)',
  bg: '#f3e7d7',
  surface: '#fcf7f0',
  sunken: '#eadbc6',
  ink: '#02142d',
  muted: '#5a5246',
  line: '#e1cfb7',
  lineStrong: '#857965',
  accent: '#02142d',
  accentInk: '#fcf7f0',
  accentSoft: '#e6f1d2',
  brand: '#95f64b',
  brandInk: '#02142d',
  brandStrong: '#3a8f10',
  good: '#2a6e0b',
  warn: '#7f4c00',
  warnSoft: '#fbe9c8',
  bad: '#a52016',
  badSoft: '#f8e1dc',
};

const dark: typeof light = {
  blocks,
  blockInk: '#02142d',
  bubble: 'rgba(255,255,255,0.45)',
  clay: 'inset 0px 1px 0px rgba(255,255,255,0.08), inset 6px 8px 16px rgba(255,255,255,0.035), inset -6px -10px 18px rgba(0,0,0,0.32), 0px 18px 34px -18px rgba(0,0,0,0.75)',
  claySm: 'inset 0px 1px 0px rgba(255,255,255,0.12), inset 3px 4px 8px rgba(255,255,255,0.05), inset -3px -5px 9px rgba(0,0,0,0.35), 0px 10px 18px -10px rgba(0,0,0,0.75)',
  clayPressed: 'inset 4px 6px 12px rgba(0,0,0,0.45), inset -2px -3px 6px rgba(255,255,255,0.06)',
  clayBlock,
  curtain: '#10284d',
  curtainInk: '#f5f1e6',
  curtainLine: 'rgba(245,241,230,0.25)',
  bg: '#030f24',
  surface: '#0a1c38',
  sunken: '#061631',
  ink: '#f5f1e6',
  muted: '#a6b0c4',
  line: '#1b2d4e',
  lineStrong: '#5a6c90',
  accent: '#95f64b',
  accentInk: '#02142d',
  accentSoft: '#172f29',
  brand: '#95f64b',
  brandInk: '#02142d',
  brandStrong: '#95f64b',
  good: '#95f64b',
  warn: '#f5b83d',
  warnSoft: '#202327',
  bad: '#ff8a80',
  badSoft: '#211e2f',
};

export type Theme = typeof light;
type Choice = 'light' | 'dark';

const KEY = 'receipts.theme';
const ThemeContext = createContext<{ choice: Choice | null; setChoice(c: Choice): void }>({ choice: null, setChoice: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<Choice | null>(null);
  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((v) => (v === 'light' || v === 'dark' ? setChoiceState(v) : undefined))
      .catch(() => undefined);
  }, []);
  const setChoice = useCallback((c: Choice) => {
    setChoiceState(c);
    SecureStore.setItemAsync(KEY, c).catch(() => undefined);
  }, []);
  const value = useMemo(() => ({ choice, setChoice }), [choice, setChoice]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useIsDark(): boolean {
  const system = useColorScheme();
  const { choice } = useContext(ThemeContext);
  return (choice ?? (system === 'dark' ? 'dark' : 'light')) === 'dark';
}

export function useTheme(): Theme {
  return useIsDark() ? dark : light;
}

/** Flip between skin and dark; remembered on this device. */
export function useThemeToggle(): { dark: boolean; toggle(): void } {
  const dark = useIsDark();
  const { setChoice } = useContext(ThemeContext);
  return { dark, toggle: () => setChoice(dark ? 'light' : 'dark') };
}
