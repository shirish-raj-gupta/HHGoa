import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { useTheme } from '../../lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const icon = (name: IconName) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  };

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.ink,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line },
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Ask', tabBarIcon: icon('search') }} />
      <Tabs.Screen name="review" options={{ title: 'Review', tabBarIcon: icon('mic') }} />
      <Tabs.Screen name="followups" options={{ title: 'Check-ins', tabBarIcon: icon('time') }} />
      <Tabs.Screen name="earnings" options={{ title: 'Earnings', tabBarIcon: icon('wallet') }} />
    </Tabs>
  );
}
