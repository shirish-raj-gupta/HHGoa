import { SelfAppBuilder, getUniversalLink } from '@selfxyz/sdk-common';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Button, Card, errorText, Input, Mono, Notice, P, Row, Screen, Strong, Tag, Title } from '../components/ui';
import { useSession } from '../lib/session';
import { useWallet } from '../lib/wallet';

// Wallet, sign-in and the one-human check. On a phone, Self opens directly (it lives on the same phone); Anon
// Aadhaar proves in a browser, so it is offered on the web app.

export default function Onboard() {
  const { wallet, ready, create, importKey } = useWallet();
  const { client, config, status, error, human, me, refresh, signIn } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [key, setKey] = useState('');
  const [importing, setImporting] = useState(false);
  const id = config?.identity;
  const selfUsable = !!id?.selfEndpoint && /^https:\/\//.test(id.selfEndpoint) && !/localhost|127\.0\.0\.1/.test(id.selfEndpoint);

  const run = async (name: string, fn: () => Promise<string>) => {
    setBusy(name);
    setMsg(null);
    try {
      setMsg({ tone: 'good', text: await fn() });
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  /** Open the Self app with this wallet as the user ID, then wait for the API to register the human. */
  const self = () =>
    run('self', async () => {
      if (!id?.selfEndpoint || !wallet) throw new Error('Self is not configured on this server.');
      const app = new SelfAppBuilder({
        appName: 'Receipts',
        scope: id.selfScope,
        endpoint: id.selfEndpoint,
        endpointType: id.selfStaging ? 'staging_https' : 'https',
        userId: wallet.address.toLowerCase(),
        userIdType: 'hex',
        devMode: id.selfStaging,
        disclosures: {},
        deeplinkCallback: Linking.createURL('/onboard'),
      }).build();
      await Linking.openURL(getUniversalLink(app));
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const s = await client.identity.status();
        if (s.human) {
          await refresh();
          return 'Verified unique human with Self. Nothing about you was shared.';
        }
      }
      throw new Error('Self has not confirmed yet. Come back to this screen in a minute.');
    });

  if (!ready) return <ActivityIndicator />;
  return (
    <Screen>
      <Title sub="Your wallet address is your only public identity. The one-human check reveals nothing about you.">Get started</Title>

      <Card>
        <Row>
          <Strong>1 · Wallet</Strong>
          {wallet ? <Tag tone="good">on this phone</Tag> : null}
        </Row>
        {wallet ? (
          <Mono>{wallet.address}</Mono>
        ) : importing ? (
          <View style={{ gap: 8 }}>
            <Input value={key} onChangeText={setKey} placeholder="Private key (0x…)" autoCapitalize="none" secureTextEntry />
            <Button title="Import" busy={busy === 'import'} onPress={() => void run('import', async () => (await importKey(key), 'Wallet imported.'))} />
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <Button title="Create a wallet on this phone" busy={busy === 'create'} onPress={() => void run('create', async () => (await create(), 'Wallet created. Back it up from the Earnings tab.'))} />
            <Button title="Import a backup key" tone="ghost" onPress={() => setImporting(true)} />
          </View>
        )}
      </Card>

      <Card>
        <Strong>2 · Sign in</Strong>
        {status === 'signing-in' ? <ActivityIndicator /> : null}
        {status === 'signed-in' ? <P muted>Signed in as {me?.wallet}</P> : null}
        {status === 'error' ? (
          <>
            <Notice tone="bad">{error}</Notice>
            <Button title="Try again" tone="secondary" onPress={() => void signIn()} />
          </>
        ) : null}
      </Card>

      <Card>
        <Row>
          <Strong>3 · Prove you are one human</Strong>
          {human ? <Tag tone="good">verified{me?.reviewer?.idType === 'mock' ? ' (mock)' : ''}</Tag> : null}
        </Row>
        {human ? (
          <Button title="Write a review" onPress={() => router.replace('/review')} />
        ) : status !== 'signed-in' ? (
          <P muted>Sign in first.</P>
        ) : (
          <View style={{ gap: 8 }}>
            <Button title="Verify with the Self app" busy={busy === 'self'} disabled={!selfUsable} onPress={() => void self()} />
            {!selfUsable ? (
              <P muted size={13}>
                Self needs the API on a public HTTPS address.
              </P>
            ) : null}
            <P muted size={13}>
              Anon Aadhaar (the mAadhaar secure QR) proves in a browser: use the web app for it.
            </P>
            {id?.mockAllowed ? (
              <Button title="Use a mock human (rehearsals only)" tone="secondary" busy={busy === 'mock'} onPress={() => void run('mock', async () => { const r = await client.identity.mock(); await refresh(); return r.message; })} />
            ) : null}
          </View>
        )}
      </Card>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </Screen>
  );
}
