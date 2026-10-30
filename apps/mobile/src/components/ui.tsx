import type { ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsDark, useTheme, useThemeToggle, type Theme } from '../lib/theme';

// The "₹eceipt" wordmark (traced from docs/brand/receipt-wordmark.jpg): green rupee on skin, lime on dark.
const WORDMARK = require('../../assets/wordmark.png') as number;
const WORDMARK_DARK = require('../../assets/wordmark-dark.png') as number;

/** Skin or dark, remembered on this device. */
export function ThemeSwitch() {
  const t = useTheme();
  const { dark, toggle } = useThemeToggle();
  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={dark ? 'Switch to the skin (light) theme' : 'Switch to the dark theme'}
      hitSlop={8}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, opacity: pressed ? 0.7 : 1 })}
    >
      <Ionicons name={dark ? 'moon' : 'sunny'} size={20} color={t.ink} />
    </Pressable>
  );
}

/** The header: the "₹eceipt" wordmark with the tagline. */
export function Brand() {
  const t = useTheme();
  const dark = useIsDark();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      <View style={{ flex: 1, gap: 4 }} accessible accessibilityRole="header" accessibilityLabel="Receipts. No receipt, no review.">
        <Image source={dark ? WORDMARK_DARK : WORDMARK} style={{ width: 120, height: 39 }} resizeMode="contain" />
        <Text style={{ color: t.muted, fontSize: 13 }}>No Receipt, No Review</Text>
      </View>
      <ThemeSwitch />
    </View>
  );
}

// Small building blocks for every screen, in the same tokens as the web apps.

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const t = useTheme();
  if (!scroll) return <View style={[styles.screen, { backgroundColor: t.bg }]}>{children}</View>;
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 4, marginBottom: 4 }}>
      <Text style={[styles.title, { color: t.ink }]}>{children}</Text>
      {sub ? <Text style={{ color: t.muted, fontSize: 15, lineHeight: 21 }}>{sub}</Text> : null}
    </View>
  );
}

export function P({ children, muted, size = 15, style }: { children: ReactNode; muted?: boolean; size?: number; style?: object }) {
  const t = useTheme();
  return <Text style={[{ color: muted ? t.muted : t.ink, fontSize: size, lineHeight: size * 1.4 }, style]}>{children}</Text>;
}

export function Strong({ children, size = 16 }: { children: ReactNode; size?: number }) {
  const t = useTheme();
  return <Text style={{ color: t.ink, fontSize: size, fontWeight: '700' }}>{children}</Text>;
}

/** A clay card: inner light, inner shade and a soft drop. */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.line, boxShadow: t.clay }, style]}>{children}</View>;
}

export type BlockColor = keyof Theme['blocks'];

/** A vibrant clay block: the same colours in both themes, always with navy ink. */
export function Block({ color, title, children, style }: { color: BlockColor; title: string; children?: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <View style={[styles.block, { backgroundColor: t.blocks[color], boxShadow: t.clayBlock }, style]}>
      <Text style={{ color: t.blockInk, fontSize: 20, fontWeight: '800', letterSpacing: -0.4 }}>{title}</Text>
      {children ? <Text style={{ color: t.blockInk, opacity: 0.85, fontSize: 14, lineHeight: 19 }}>{children}</Text> : null}
    </View>
  );
}

type Tone = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({ title, onPress, tone = 'primary', busy, disabled }: { title: string; onPress(): void; tone?: Tone; busy?: boolean; disabled?: boolean }) {
  const t = useTheme();
  const bg = { primary: t.accent, secondary: t.surface, ghost: 'transparent', danger: t.badSoft }[tone];
  const fg = { primary: t.accentInk, secondary: t.ink, ghost: t.accent, danger: t.bad }[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: tone === 'secondary' ? t.line : 'transparent',
          opacity: disabled ? 0.45 : 1,
          // Clay squish: pressed in, a little smaller.
          boxShadow: tone === 'ghost' ? undefined : pressed ? t.clayPressed : t.claySm,
          transform: [{ scale: pressed && !disabled ? 0.96 : 1 }],
        },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: 15 }}>{title}</Text>
    </Pressable>
  );
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const t = useTheme();
  const [bg, fg] = { neutral: [t.sunken, t.muted], good: [t.accentSoft, t.good], warn: [t.warnSoft, t.warn], bad: [t.badSoft, t.bad] }[tone];
  return (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{children}</Text>
    </View>
  );
}

export function Row({ children, gap = 8, wrap = true }: { children: ReactNode; gap?: number; wrap?: boolean }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: wrap ? 'wrap' : 'nowrap', gap }}>{children}</View>;
}

export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'bad' | 'good' }) {
  const t = useTheme();
  const [bg, fg] = { neutral: [t.sunken, t.ink], warn: [t.warnSoft, t.ink], bad: [t.badSoft, t.bad], good: [t.accentSoft, t.ink] }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function Input(props: TextInputProps) {
  const t = useTheme();
  return <TextInput placeholderTextColor={t.muted} {...props} style={[styles.input, { borderColor: t.line, color: t.ink, backgroundColor: t.surface, boxShadow: t.clayPressed }, props.style]} />;
}

export function Stars({ value, size = 16, onChange }: { value: number | null; size?: number; onChange?(n: number): void }) {
  const t = useTheme();
  return (
    <Row gap={2} wrap={false}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Text
          key={n}
          onPress={onChange ? () => onChange(n) : undefined}
          accessibilityRole={onChange ? 'button' : undefined}
          accessibilityLabel={onChange ? `${n} stars` : undefined}
          style={{ fontSize: size, color: value !== null && n <= Math.round(value) ? t.accent : t.line }}
        >
          ★
        </Text>
      ))}
    </Row>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ fontFamily: 'monospace', fontSize: 12, color: t.muted }}>{children}</Text>;
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 14, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  card: { borderWidth: 1, borderRadius: 24, padding: 16, gap: 10 },
  block: { flex: 1, minWidth: 140, borderRadius: 24, padding: 16, gap: 6 },
  button: { minHeight: 48, borderRadius: 18, borderWidth: 1, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  notice: { borderRadius: 12, padding: 12 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
});
