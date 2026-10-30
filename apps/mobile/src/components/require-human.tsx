import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator } from 'react-native';
import { useSession } from '../lib/session';
import { Button, Card, Notice, P } from './ui';

/** Screens that need a verified human show the way there instead of an error. */
export function RequireHuman({ children, what = 'review' }: { children: ReactNode; what?: string }) {
  const { status, human, configError } = useSession();
  if (configError) return <Notice tone="bad">{configError}</Notice>;
  if (status === 'loading' || status === 'signing-in') return <ActivityIndicator />;
  if (status !== 'signed-in' || !human) {
    return (
      <Card>
        <P>To {what}, set up a wallet on this phone and prove you are one human. It takes a minute and reveals nothing about you.</P>
        <Button title="Get started" onPress={() => router.push('/onboard')} />
      </Card>
    );
  }
  return <>{children}</>;
}
