import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import type { FollowupItem } from '@receipts/client';
import { RequireHuman } from '../../components/require-human';
import { Button, Card, errorText, Notice, P, Row, Screen, Stars, Strong, Tag, Title } from '../../components/ui';
import { useSession } from '../../lib/session';

function label(kind: string): string {
  const days = /^(\d+)d$/.exec(kind)?.[1];
  if (days) return Number(days) === 1 ? 'The next day' : `${days} days on`;
  return { trip_end: 'After the trip', move_out: 'At move-out', return_window: 'After the return window' }[kind] ?? kind.replace(/_/g, ' ');
}

export default function Followups() {
  return (
    <Screen>
      <Title sub="One tap: is it still good? Later answers are what make a review trustworthy.">Check-ins</Title>
      <RequireHuman what="answer check-ins">
        <Inbox />
      </RequireHuman>
    </Screen>
  );
}

function Inbox() {
  const { client } = useSession();
  const [items, setItems] = useState<FollowupItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      client.followups
        .inbox()
        .then(setItems)
        .catch((e) => setError(errorText(e)));
    }, [client]),
  );
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (items && items.length === 0) return <Notice>Nothing to answer right now.</Notice>;
  return (
    <View style={{ gap: 12 }}>
      {items?.map((f) => (
        <Followup key={f.id} item={f} />
      ))}
    </View>
  );
}

function Followup({ item }: { item: FollowupItem }) {
  const { client, wallet } = useSession();
  const [stillGood, setStillGood] = useState<boolean | null>(null);
  const [newRating, setNewRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (stillGood === null || !wallet) return;
    setBusy(true);
    setError(null);
    try {
      await client.followups.signAndAnswer(item.id, wallet.signer, { stillGood, newRating: newRating ?? undefined });
      setDone(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Row gap={6}>
        <Tag>{label(item.kind)}</Tag>
        <Strong size={15}>{item.item}</Strong>
      </Row>
      <P muted size={14}>
        {item.merchant} · you gave {item.rating}★
      </P>
      {done ? (
        <Notice tone="good">Thanks, answered.</Notice>
      ) : (
        <>
          <Row>
            <View style={{ flex: 1 }}>
              <Button title="Still good" tone={stillGood === true ? 'primary' : 'secondary'} onPress={() => setStillGood(true)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Not anymore" tone={stillGood === false ? 'danger' : 'secondary'} onPress={() => setStillGood(false)} />
            </View>
          </Row>
          {stillGood !== null ? (
            <View style={{ gap: 4 }}>
              <P muted size={13}>
                Change your stars? (optional)
              </P>
              <Stars value={newRating} size={28} onChange={(n) => setNewRating(newRating === n ? null : n)} />
            </View>
          ) : null}
          <Button title="Sign and send" busy={busy} disabled={stillGood === null} onPress={() => void send()} />
        </>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Card>
  );
}
