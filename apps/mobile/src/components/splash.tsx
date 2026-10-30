import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { AccessibilityInfo, Animated, BackHandler, Easing, LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MERCHANT_URL, WEB_URL } from '../lib/env';
import { useTheme, type Theme } from '../lib/theme';

// The opening screen. Every cold start: the "₹eceipt" wordmark on navy. The first one also asks "What brings you to
// Receipts?" and sends people where they meant to go; the choice is kept on this phone. Tap to hurry it along.
// Opened from a link (a receipt, a scan), it gets out of the way instead of asking.

const KEY = 'receipts.role';
const WORDMARK = require('../../assets/splash-wordmark.png') as number;

type IconName = ComponentProps<typeof Ionicons>['name'];
type Visitor = 'shopper' | 'reviewer' | 'business' | 'developer';
type Door = { visitor: Visitor; title: string; sub: string; icon: IconName; color: keyof Theme['blocks'] };

const DOORS: Door[] = [
  { visitor: 'shopper', title: 'Find what is actually good', sub: 'Answers from people who can prove they bought it.', icon: 'search', color: 'sky' },
  { visitor: 'reviewer', title: 'Review what I bought', sub: 'Prove it, talk for fifteen seconds, get paid when agents cite it.', icon: 'receipt-outline', color: 'lime' },
  { visitor: 'business', title: 'I run a business', sub: 'Claim your listing and reply in public. Opens in the browser.', icon: 'storefront-outline', color: 'pink' },
  { visitor: 'developer', title: 'I build AI agents', sub: 'Cite verified reviews over MCP. Opens in the browser.', icon: 'code-slash', color: 'violet' },
];

function remember(v: Visitor | 'skip') {
  SecureStore.setItemAsync(KEY, v).catch(() => undefined);
}

export function Splash() {
  const t = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<'intro' | 'doors' | 'gone'>('intro');
  const [stored, setStored] = useState<string | null | undefined>(undefined);
  const [still, setStill] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const fromLink = useRef(pathname !== '/').current;

  const mark = useRef(new Animated.Value(0)).current;
  const line = useRef(new Animated.Value(0)).current;
  const tag = useRef(new Animated.Value(0)).current;
  const doors = useRef(DOORS.map(() => new Animated.Value(0))).current;
  const sheet = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((v) => setStored(v))
      .catch(() => setStored('unknown'));
    AccessibilityInfo.isReduceMotionEnabled()
      .then((r) => setStill(r))
      .catch(() => undefined);
  }, []);

  // The intro: the wordmark settles in, the lime rule draws, the tagline follows.
  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    const run = Animated.sequence([
      Animated.parallel([
        Animated.timing(mark, { toValue: 1, duration: 650, easing: ease, useNativeDriver: true }),
        Animated.timing(line, { toValue: 1, duration: 550, delay: 350, easing: ease, useNativeDriver: true }),
        Animated.timing(tag, { toValue: 1, duration: 500, delay: 500, easing: ease, useNativeDriver: true }),
      ]),
      Animated.delay(350),
    ]);
    run.start(() => setIntroDone(true));
    return () => run.stop();
  }, [mark, line, tag]);

  const close = useCallback(() => {
    Animated.timing(sheet, { toValue: 0, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => setPhase('gone'));
  }, [sheet]);

  const skip = useCallback(() => {
    remember('skip');
    close();
  }, [close]);

  // After the intro (or a tap), either ask or get out of the way.
  const next = useCallback(() => {
    if (stored === undefined) return;
    if (stored === null && !fromLink) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setPhase('doors');
    } else close();
  }, [stored, fromLink, close]);

  useEffect(() => {
    if (phase === 'intro' && (introDone || still) && stored !== undefined) next();
  }, [phase, introDone, still, stored, next]);

  useEffect(() => {
    if (phase !== 'doors') return;
    Animated.stagger(80, doors.map((v) => Animated.spring(v, { toValue: 1, damping: 14, stiffness: 140, mass: 0.9, useNativeDriver: true }))).start();
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      skip();
      return true;
    });
    return () => back.remove();
  }, [phase, doors, skip]);

  function choose(d: Door) {
    remember(d.visitor);
    close();
    if (d.visitor === 'reviewer') router.navigate('/review');
    if (d.visitor === 'business') void WebBrowser.openBrowserAsync(MERCHANT_URL);
    if (d.visitor === 'developer') void WebBrowser.openBrowserAsync(`${WEB_URL}/developers`);
  }

  if (phase === 'gone') return null;

  const k = (v: Animated.Value, from: number) => (still ? 0 : v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }));
  const show = (v: Animated.Value) => (still ? 1 : v);
  const asking = phase === 'doors';

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.curtain, opacity: sheet, zIndex: 10 }]} accessibilityViewIsModal>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingTop: insets.top + 64, paddingBottom: insets.bottom + 32 }}
        scrollEnabled={asking}
      >
        <View style={{ alignItems: 'center', gap: 14 }}>
          <Animated.Image
            source={WORDMARK}
            accessibilityLabel="Receipts"
            resizeMode="contain"
            style={{
              width: asking ? 180 : 260,
              height: asking ? 58 : 85,
              opacity: show(mark),
              transform: [{ scale: still ? 1 : mark.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }],
            }}
          />
          <Animated.View style={{ width: 96, height: 4, borderRadius: 2, backgroundColor: t.brand, transform: [{ scaleX: show(line) }] }} />
          <Animated.Text
            style={{
              color: t.curtainInk,
              opacity: still ? 0.8 : tag.interpolate({ inputRange: [0, 1], outputRange: [0, 0.8] }),
              fontSize: 13,
              fontWeight: '600',
              letterSpacing: 3,
              transform: [{ translateY: k(tag, 8) }],
            }}
          >
            NO RECEIPT, NO REVIEW
          </Animated.Text>
        </View>

        {asking ? (
          <View style={{ marginTop: 36, gap: 12 }}>
            <Text accessibilityRole="header" style={{ color: t.curtainInk, fontSize: 30, fontWeight: '800', letterSpacing: -0.6, textAlign: 'center', marginBottom: 8 }}>
              What brings you to <Text style={{ fontStyle: 'italic', fontWeight: '400' }}>Receipts?</Text>
            </Text>
            {DOORS.map((d, i) => (
              <Animated.View key={d.visitor} style={{ opacity: show(doors[i]!), transform: [{ translateY: k(doors[i]!, 28) }] }}>
                <Pressable
                  onPress={() => choose(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`${d.title}. ${d.sub}`}
                  style={({ pressed }) => [styles.door, { backgroundColor: t.blocks[d.color], boxShadow: t.clayBlock, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
                >
                  <View style={[styles.bubble, { backgroundColor: t.bubble, boxShadow: t.claySm }]}>
                    <Ionicons name={d.icon} size={22} color={t.blockInk} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ color: t.blockInk, fontSize: 17, fontWeight: '800', letterSpacing: -0.2 }}>{d.title}</Text>
                    <Text style={{ color: t.blockInk, opacity: 0.85, fontSize: 13, lineHeight: 18 }}>{d.sub}</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={20} color={t.blockInk} />
                </Pressable>
              </Animated.View>
            ))}
            <Text style={{ color: t.curtainInk, opacity: 0.75, fontSize: 13, textAlign: 'center', marginTop: 6 }}>Kept on this phone only.</Text>
          </View>
        ) : null}
      </ScrollView>

      {phase === 'intro' ? <Pressable style={StyleSheet.absoluteFill} onPress={next} accessibilityRole="button" accessibilityLabel="Continue" /> : null}
      {asking ? (
        <Pressable
          onPress={skip}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => [styles.skip, { top: insets.top + 10, borderColor: t.curtainLine, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={{ color: t.curtainInk, fontSize: 14, fontWeight: '600' }}>Skip</Text>
          <Ionicons name="close" size={16} color={t.curtainInk} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  door: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 96, borderRadius: 26, padding: 16 },
  bubble: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  skip: { position: 'absolute', right: 16, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1 },
});
