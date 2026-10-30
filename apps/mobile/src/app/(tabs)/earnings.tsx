import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { isAddress } from 'viem';
import type { Earnings } from '@receipts/client';
import { RequireHuman } from '../../components/require-human';
import { Button, Card, errorText, Input, Mono, Notice, P, Row, Screen, Strong, Tag, Title } from '../../components/ui';
import { useSession } from '../../lib/session';
import { useWallet } from '../../lib/wallet';

export default function EarningsTab() {
  return (
    <Screen>
      <Title sub="You are paid when AI agents cite your reviews. Pay never depends on your rating.">Earnings</Title>
      <RequireHuman what="see your earnings">
        <Inner />
      </RequireHuman>
    </Screen>
  );
}

function Inner() {
  const { client, wallet, config } = useSession();
  const { exportKey } = useWallet();
  const [data, setData] = useState<Earnings | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [upi, setUpi] = useState('');
  const [key, setKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await client.money.earnings();
    setData(d);
    if (d.payoutMethod?.kind === 'upi') setUpi(d.payoutMethod.address);
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      load().catch((e) => setMsg({ tone: 'bad', text: errorText(e) }));
    }, [load]),
  );

  const act = async (name: string, fn: () => Promise<string>) => {
    setBusy(name);
    setMsg(null);
    try {
      setMsg({ tone: 'good', text: await fn() });
      await load();
    } catch (e) {
      setMsg({ tone: 'bad', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  /** Check-in reminders by push. Needs an EAS project ID; Expo Go on Android cannot receive remote pushes. */
  const remind = () =>
    act('push', async () => {
      const perm = await Notifications.requestPermissionsAsync();
      if (!perm.granted) throw new Error('Notifications are off for Receipts.');
      const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
      const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
      await client.pushTargets.add('expo', { token });
      return 'Check-in reminders are on.';
    });

  if (!data) return msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null;
  const claimable = Number(data.claim.claimable);

  return (
    <View style={{ gap: 12 }}>
      <Row>
        {[
          ['Earned', data.totals.accrued],
          ['Ready to claim', data.claim.claimable],
          ['Claimed', data.claim.claimed],
        ].map(([label, v]) => (
          <Card key={label} style={{ flexGrow: 1, minWidth: 100, padding: 12 }}>
            <Strong size={20}>${Number(v).toFixed(4)}</Strong>
            <P muted size={12}>
              {label}
            </P>
          </Card>
        ))}
      </Row>
      <P muted size={12}>
        Today ${Number(data.today).toFixed(4)} of your ${Number(data.dailyCap).toFixed(2)} daily cap (level {data.level}).
      </P>

      <Card>
        <Strong>Claim USDC</Strong>
        <P muted size={14}>
          Gasless: Receipts pays the gas.
        </P>
        <Button
          title={`Claim $${claimable.toFixed(4)} to this wallet`}
          busy={busy === 'claim'}
          disabled={claimable <= 0}
          onPress={() => void act('claim', async () => `Claimed $${(await client.money.claim()).amount} USDC.`)}
        />
        <Input value={to} onChangeText={setTo} placeholder="Or another wallet, e.g. Cake Wallet: 0x…" autoCapitalize="none" />
        <Button
          title="Sign and send there"
          tone="secondary"
          busy={busy === 'claim-to'}
          disabled={claimable <= 0 || !isAddress(to.trim()) || !wallet}
          onPress={() => void act('claim-to', async () => `Claimed $${(await client.money.claimTo(to.trim(), wallet!.signer)).amount} USDC to ${to.trim()}.`)}
        />
        <P muted size={12}>
          For Cake Wallet: open its Base wallet, tap Receive, paste the address. USDC is paid on Base only.
          {config && config.chain.mode !== 'base' ? ' This server pays on Base Sepolia (testnet), which Cake Wallet does not display.' : ''}
        </P>
      </Card>

      <Card>
        <Strong>Rupees to UPI</Strong>
        <Input value={upi} onChangeText={setUpi} placeholder="name@okbank" autoCapitalize="none" />
        <Row>
          <View style={{ flex: 1 }}>
            <Button title="Save UPI ID" tone="secondary" busy={busy === 'upi'} disabled={!upi.trim()} onPress={() => void act('upi', async () => (await client.money.setPayoutMethod('upi', upi.trim()), 'UPI ID saved.'))} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Withdraw"
              busy={busy === 'inr'}
              disabled={data.payoutMethod?.kind !== 'upi'}
              onPress={() =>
                void act('inr', async () => {
                  const r = await client.money.withdrawInr();
                  return `₹${r.rupees.toFixed(2)} sent (${r.status}${r.testMode ? ', test mode' : ''}).`;
                })
              }
            />
          </View>
        </Row>
      </Card>

      <Card>
        <Strong>This phone’s wallet</Strong>
        {wallet ? <Mono>{wallet.address}</Mono> : null}
        <Button title={key ? 'Hide backup key' : 'Back up this wallet'} tone="secondary" onPress={() => void (key ? setKey(null) : exportKey().then(setKey))} />
        {key ? (
          <Notice tone="warn">
            Keep this private key somewhere safe. Anyone with it can claim your earnings.{'\n'}
            {key}
          </Notice>
        ) : null}
        <Button title="Turn on check-in reminders" tone="ghost" busy={busy === 'push'} onPress={() => void remind()} />
      </Card>

      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <Strong>Recent citations</Strong>
      {data.recent.length === 0 ? <P muted>No citations yet. Agents cite reviews with clear, specific claims.</P> : null}
      {data.recent.slice(0, 15).map((r, i) => (
        <Row key={i} wrap={false}>
          <Mono>${Number(r.amount).toFixed(5)}</Mono>
          <View style={{ flex: 1 }}>
            <P size={13} muted>
              {r.query ? `“${r.query}”` : r.source}
            </P>
          </View>
          <Tag tone={r.status === 'capped' ? 'warn' : 'neutral'}>{r.status}</Tag>
        </Row>
      ))}
    </View>
  );
}
