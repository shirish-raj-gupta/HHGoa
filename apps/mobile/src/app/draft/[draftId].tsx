import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { inr, type PublishResult, type ReviewCard } from '@receipts/client';
import { Recorder } from '../../components/recorder';
import { RequireHuman } from '../../components/require-human';
import { Button, Card, errorText, Input, Mono, Notice, P, Row, Screen, Stars, Strong, Tag, Title } from '../../components/ui';
import { useSession } from '../../lib/session';

export default function DraftScreen() {
  const { draftId } = useLocalSearchParams<{ draftId: string }>();
  return (
    <Screen>
      <RequireHuman>
        <Draft draftId={String(draftId)} />
      </RequireHuman>
    </Screen>
  );
}

function Draft({ draftId }: { draftId: string }) {
  const { client, config, wallet } = useSession();
  const [card, setCard] = useState<ReviewCard | null>(null);
  const [mode, setMode] = useState<'voice' | 'text'>('voice');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'listen' | 'publish' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [claims, setClaims] = useState<string[]>([]);
  const [published, setPublished] = useState<PublishResult | null>(null);

  const apply = (c: ReviewCard) => {
    setCard(c);
    setRating(c.rating);
    setItemId(c.item?.itemId ?? c.itemChoices[0]?.itemId ?? null);
    setClaims(c.claims);
  };

  useEffect(() => {
    client.reviews
      .get(draftId)
      .then(apply)
      .catch((e) => setError(errorText(e)));
  }, [client, draftId]);

  useEffect(() => {
    if (config && !config.voice.sarvam) setMode('text');
  }, [config]);

  const listen = async (fn: () => Promise<ReviewCard>) => {
    setBusy('listen');
    setError(null);
    try {
      apply(await fn());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  /** React Native uploads a recorded file as multipart: { uri, name, type }. */
  const sendVoice = (uri: string) =>
    listen(() => {
      const form = new FormData();
      form.append('file', { uri, name: 'note.m4a', type: 'audio/mp4' } as unknown as Blob);
      return client.request<ReviewCard>('POST', `/v1/reviews/${draftId}/audio`, undefined, { raw: form });
    });

  const publish = async () => {
    if (!wallet || !rating) return;
    setBusy('publish');
    setError(null);
    try {
      setPublished(await client.reviews.signAndPublish(draftId, wallet.signer, { rating, itemId: (itemId ?? undefined) as `0x${string}` | undefined, claims }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (published) {
    return (
      <View style={{ gap: 12 }}>
        <Title sub={published.status === 'held' ? 'A moderator reads reviews that allege fake products before they go public.' : 'When an AI agent cites it, you earn.'}>Published</Title>
        {published.anchored ? (
          <Card>
            <P muted size={13}>
              Attestation on Base
            </P>
            <Mono>{published.uid}</Mono>
          </Card>
        ) : null}
        <Button title="Open the receipt" onPress={() => router.replace(`/r/${published.uid ?? published.reviewId}`)} />
        <Button title="Review something else" tone="secondary" onPress={() => router.replace('/review')} />
      </View>
    );
  }

  if (!card) return error ? <Notice tone="bad">{error}</Notice> : null;
  const p = card.purchase;
  return (
    <View style={{ gap: 12 }}>
      <Title sub={`${p.items.map((i) => i.name).join(', ')} · ${inr(p.amountMinor)} · ${p.purchasedOn}`}>{p.merchant}</Title>
      <Row gap={6}>
        <Tag tone="good">proven: {config?.rails[p.rail]?.label ?? p.rail}</Tag>
        {p.simulated ? <Tag tone="warn">simulated</Tag> : null}
      </Row>

      <Card>
        <Strong>{card.prompt.en}</Strong>
        <P muted size={14}>
          {card.prompt.hi}
        </P>
        <Row>
          <View style={{ flex: 1 }}>
            <Button title="Talk" tone={mode === 'voice' ? 'primary' : 'secondary'} onPress={() => setMode('voice')} disabled={config ? !config.voice.sarvam : false} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Type" tone={mode === 'text' ? 'primary' : 'secondary'} onPress={() => setMode('text')} />
          </View>
        </Row>
        {mode === 'voice' ? (
          <Recorder busy={busy === 'listen'} onRecorded={(uri) => void sendVoice(uri)} />
        ) : (
          <View style={{ gap: 8 }}>
            <Input value={text} onChangeText={setText} multiline style={{ minHeight: 110, textAlignVertical: 'top' }} placeholder="Not oily, fed two of us, arrived hot. 4 stars." />
            <Button title="Make my card" busy={busy === 'listen'} disabled={text.trim().length < 8} onPress={() => void listen(() => client.reviews.text(draftId, text))} />
            <P muted size={12}>
              Rather talk? Dictate with your keyboard’s mic or a voice keyboard like Wispr Flow.
            </P>
          </View>
        )}
      </Card>

      {card.transcript !== null ? (
        <Card>
          <Strong>Your review card</Strong>
          {card.transcript ? <P muted>“{card.transcript}”</P> : null}
          <Stars value={rating} size={34} onChange={setRating} />
          {card.itemChoices.length > 1 ? (
            <Row gap={6}>
              {card.itemChoices.map((i) => (
                <Pressable key={i.itemId} onPress={() => setItemId(i.itemId)}>
                  <Tag tone={itemId === i.itemId ? 'good' : 'neutral'}>{i.name}</Tag>
                </Pressable>
              ))}
            </Row>
          ) : null}
          {claims.map((c) => (
            <Row key={c} wrap={false}>
              <View style={{ flex: 1 }}>
                <P size={14}>{c}</P>
              </View>
              <Pressable onPress={() => setClaims(claims.filter((x) => x !== c))} accessibilityLabel={`Remove ${c}`}>
                <P muted size={13}>
                  remove
                </P>
              </Pressable>
            </Row>
          ))}
          {card.warnings.map((w) => (
            <Notice key={w} tone="warn">
              {w}
            </Notice>
          ))}
          <Button title="Sign and publish" busy={busy === 'publish'} disabled={!rating} onPress={() => void publish()} />
          <P muted size={12}>
            Your wallet signs the review. Only the text is published, never your voice.
          </P>
        </Card>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </View>
  );
}
