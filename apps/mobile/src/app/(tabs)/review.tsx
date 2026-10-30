import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { inr, type MyReview, type PurchaseView } from '@receipts/client';
import { RequireHuman } from '../../components/require-human';
import { Button, Card, errorText, Notice, P, Row, Screen, Stars, Strong, Tag, Title } from '../../components/ui';
import { useSession } from '../../lib/session';

export default function ReviewTab() {
  return (
    <Screen>
      <Title sub="Prove the purchase, then say what you thought in fifteen seconds.">Write a verified review</Title>
      <RequireHuman>
        <Inner />
      </RequireHuman>
    </Screen>
  );
}

function Inner() {
  const { client, config } = useSession();
  const [purchases, setPurchases] = useState<PurchaseView[] | null>(null);
  const [mine, setMine] = useState<MyReview[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reload whenever the tab comes back into view: a proof may have just landed.
  useFocusEffect(
    useCallback(() => {
      Promise.all([client.purchases.list(), client.reviews.mine()])
        .then(([p, m]) => {
          setPurchases(p);
          setMine(m);
        })
        .catch((e) => setError(errorText(e)));
    }, [client]),
  );

  const start = async (p: PurchaseView) => {
    setBusyId(p.id);
    setError(null);
    try {
      const card = await client.reviews.create(p.id);
      router.push(`/draft/${card.draftId}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusyId(null);
    }
  };

  const open = purchases?.filter((p) => !p.reviewed) ?? [];
  return (
    <View style={{ gap: 12 }}>
      <Row>
        <View style={{ flex: 1 }}>
          <Button title="Prove a purchase" onPress={() => router.push('/prove')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Scan a bill" tone="secondary" onPress={() => router.push('/scan')} />
        </View>
      </Row>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {purchases && open.length === 0 ? <Notice>No proven purchases waiting. Prove one to start.</Notice> : null}
      {open.map((p) => (
        <Card key={p.id}>
          <Strong>{p.merchant}</Strong>
          <P muted size={14}>
            {p.items.map((i) => i.name).join(', ')} · {inr(p.amountMinor)} · {p.purchasedOn}
          </P>
          <Row gap={6}>
            <Tag tone="good">{config?.rails[p.rail]?.label ?? p.rail}</Tag>
            {p.simulated ? <Tag tone="warn">simulated</Tag> : null}
            {!p.reviewable.ok ? <Tag tone="warn">{p.reviewable.reason ?? 'not reviewable yet'}</Tag> : null}
          </Row>
          <Button title="Review it" busy={busyId === p.id} disabled={!p.reviewable.ok} onPress={() => void start(p)} />
        </Card>
      ))}
      {mine.length ? <Strong>Your reviews</Strong> : null}
      {mine.map((r) => (
        <Pressable key={r.id} onPress={() => router.push(`/r/${r.eas_uid ?? r.id}`)}>
          <Card>
            <Row>
              <Stars value={r.rating} size={14} />
              <View style={{ flex: 1 }}>
                <P size={14}>
                  {r.item} · {r.merchant}
                </P>
              </View>
              {r.eas_uid ? <Tag tone="good">on-chain</Tag> : null}
            </Row>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}
