import { useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { ReceiptView, VerifyResult } from '@receipts/client';
import { Button, Card, errorText, Mono, Notice, P, Row, Screen, Stars, Strong, Tag, Title } from '../../components/ui';
import { useSession } from '../../lib/session';
import { useTheme } from '../../lib/theme';

export default function ReceiptScreen() {
  const { uid } = useLocalSearchParams<{ uid: string }>();
  const { client } = useSession();
  const t = useTheme();
  const [r, setR] = useState<ReceiptView | null>(null);
  const [v, setV] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .receipt(String(uid))
      .then(setR)
      .catch((e) => setError(errorText(e)));
  }, [client, uid]);

  const verify = async () => {
    setBusy(true);
    try {
      setV(await client.verify(String(uid)));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!r) return <Screen>{error ? <Notice tone="bad">{error}</Notice> : null}</Screen>;
  return (
    <Screen>
      <Row gap={6}>
        {r.simulated ? <Tag tone="warn">simulated demo data</Tag> : <Tag tone="good">verified purchase</Tag>}
        {!r.simulated ? <Tag tone={r.reviewer.verifiedWith === 'mock' ? 'warn' : 'good'}>{r.reviewer.verifiedWith === 'mock' ? 'mock identity' : 'unique human'}</Tag> : null}
        {r.anchored ? <Tag>on Base</Tag> : null}
      </Row>
      <Title sub={r.merchant.name}>{r.item.name}</Title>
      <Stars value={r.rating} size={26} />
      {r.claims.map((c) => (
        <P key={c} size={17}>
          “{c}”
        </P>
      ))}
      {r.summary_en ? <P muted>{r.summary_en}</P> : null}
      <Card style={{ backgroundColor: t.sunken }}>
        <P size={13}>
          {r.purchase.railLabel} · tier {r.purchase.tier} · proves {r.purchase.proves.toLowerCase()}
        </P>
        <P muted size={13}>
          {r.purchase.how}
        </P>
        <P muted size={13}>
          Bought {r.purchase.purchased} · reviewer level {r.reviewer.level}
        </P>
        {r.uid ? <Mono>{r.uid}</Mono> : null}
        {r.easUrl ? <Button title="Open the attestation" tone="ghost" onPress={() => void WebBrowser.openBrowserAsync(r.easUrl!)} /> : null}
      </Card>
      {r.replies.map((x, i) => (
        <Card key={i}>
          <Strong size={14}>Reply from {r.merchant.name}</Strong>
          <P size={14}>{x.text}</P>
        </Card>
      ))}
      <Button title={v ? 'Check again' : 'Re-check this receipt'} tone="secondary" busy={busy} onPress={() => void verify()} />
      {v ? (
        <View style={{ gap: 6 }}>
          {v.checks.map((c) => (
            <P key={c.check} size={13}>
              {c.pass === null ? '–' : c.pass ? '✓' : '✗'} {c.check}: <P muted size={13}>{c.detail}</P>
            </P>
          ))}
          <Notice tone={v.allPass ? 'good' : 'bad'}>{v.allPass ? 'Every check that applies passed.' : 'A check failed. Treat this review with care.'}</Notice>
        </View>
      ) : null}
      <P muted size={12}>
        {r.disclosure}
      </P>
    </Screen>
  );
}
