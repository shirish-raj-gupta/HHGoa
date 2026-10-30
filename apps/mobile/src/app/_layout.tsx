import '../lib/polyfills';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Splash } from '../components/splash';
import { SessionProvider } from '../lib/session';
import { ThemeProvider, useIsDark, useTheme } from '../lib/theme';
import { WalletProvider } from '../lib/wallet';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <WalletProvider>
        <SessionProvider>
          <Navigator />
        </SessionProvider>
      </WalletProvider>
    </ThemeProvider>
  );
}

function Navigator() {
  const t = useTheme();
  const dark = useIsDark();
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.ink,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboard" options={{ title: 'Wallet and identity' }} />
        <Stack.Screen name="prove" options={{ title: 'Prove a purchase' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan your bill' }} />
        <Stack.Screen name="draft/[draftId]" options={{ title: 'Your review' }} />
        <Stack.Screen name="r/[uid]" options={{ title: 'Receipt' }} />
      </Stack>
      <Splash />
    </>
  );
}
