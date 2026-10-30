import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Answer, AnswerOption } from '@receipts/client';
import { Block, Brand, Button, Card, errorText, Input, Notice, P, Row, Screen, Stars, Strong, Tag, Title } from '../../components/ui';
import { receiptIdFromUrl } from '../../lib/env';
import { useSession } from '../../lib/session';
import { useTheme } from '../../lib/theme';

const SUGGESTIONS = ['Best veg biryani under ₹400 near Calangute', 'Quietest hotel near Calangute for remote work', 'Best power bank under ₹1,500'];

function OptionCard({ option, rank }: { option: AnswerOption; rank: number }) {
  const t = useTheme();
  const price = option.price_paid_inr;
  return (
    <Card>
      <Row wrap={false}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: t.accent, fontWeight: '800' }}>{rank}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Strong>{option.item}</Strong>
          <P muted size={14}>
            {option.merchant}
          </P>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Strong size={20}>{option.score.toFixed(1)}</Strong>
          <Stars value={option.score} size={12} />
        </View>
      </Row>
      <Row gap={6}>
        <Tag tone="good">{option.verified_reviews} verified buyers</Tag>
        {price ? <Tag>{price.min === price.max ? `paid ₹${price.min}` : `paid ₹${price.min}–₹${price.max}`}</Tag> : null}
        {option.still_good_next_day !== null ? <Tag>{Math.round(option.still_good_next_day * 100)}% still good next day</Tag> : null}
        {option.few_receipts ? <Tag tone="warn">few receipts so far</Tag> : null}
      </Row>
      {option.claims.map((c, i) => {
        const id = c.receipts[0] ? receiptIdFromUrl(c.receipts[0]) : null;
        return (
          <Pressable key={`${i}:${c.text}`} onPress={id ? () => router.push(`/r/${id}`) : undefined}>
            <P size={14}>
              “{c.text}” {id ? <Text style={{ color: t.accent }}>receipt ›</Text> : null}
            </P>
          </Pressable>
        );
      })}
    </Card>
  );
}

export default function Ask() {
  const { client, configError } = useSession();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (question: string) => {
    if (!question.trim()) return;
    setQ(question);
    setBusy(true);
    setError(null);
    try {
      setAnswer(await client.ask(question));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Brand />
      <Title sub="Every answer comes from proven purchases by verified unique humans.">Reviews you can check</Title>
      <Input value={q} onChangeText={setQ} placeholder="What should I buy, or where should I go?" returnKeyType="search" onSubmitEditing={() => void ask(q)} />
      <Button title="Ask" busy={busy} onPress={() => void ask(q)} />
      <Row gap={6}>
        {SUGGESTIONS.map((s) => (
          <Pressable key={s} onPress={() => void ask(s)}>
            <Tag>{s}</Tag>
          </Pressable>
        ))}
      </Row>
      {configError ? <Notice tone="bad">{configError}</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {answer ? (
        <View style={{ gap: 12 }}>
          <P>{answer.summary}</P>
          {answer.options.map((o, i) => (
            <OptionCard key={o.item_id} option={o} rank={i + 1} />
          ))}
          <P muted size={12}>
            {answer.disclosure}
          </P>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
          <Block color="sky" title="Prove it">
            Order page, email, a bill QR or a payment.
          </Block>
          <Block color="pink" title="Say it">
            Fifteen seconds in any Indian language.
          </Block>
          <Block color="lime" title="Get paid" style={{ minWidth: 220 }}>
            70% of what agents pay goes to the reviews they cite.
          </Block>
        </View>
      )}
    </Screen>
  );
}
