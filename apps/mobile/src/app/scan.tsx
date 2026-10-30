import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { decodeReceiptQr, type MerchantReceipt } from '@receipts/core';
import { inr } from '@receipts/client';
import { RequireHuman } from '../components/require-human';
import { Button, Card, errorText, Notice, P, Row, Screen, Strong } from '../components/ui';
import { useSession } from '../lib/session';

// Scan the signed QR on a bill (rail 5): the business signed the receipt, claiming it binds it to this wallet once.

export default function Scan() {
  return (
    <Screen>
      <RequireHuman what="claim a receipt">
        <Scanner />
      </RequireHuman>
    </Screen>
  );
}

function Scanner() {
  const { client } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [payload, setPayload] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<MerchantReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onScan = (data: string) => {
    if (payload) return;
    try {
      setReceipt(decodeReceiptQr(data));
      setPayload(data);
      setError(null);
    } catch {
      setError('That QR is not a Receipts bill. Try again.');
    }
  };

  const claim = async () => {
    if (!payload) return;
    setBusy(true);
    setError(null);
    try {
      const purchase = await client.proofs.merchantReceipt(payload);
      const card = await client.reviews.create(purchase.id);
      router.replace(`/draft/${card.draftId}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <Card>
        <P>Receipts needs the camera to read the QR on your bill.</P>
        <Button title="Allow camera" onPress={() => void requestPermission()} />
      </Card>
    );
  }

  if (receipt) {
    return (
      <View style={{ gap: 12 }}>
        <Card>
          {receipt.items.map((i) => (
            <Row key={i.name}>
              <View style={{ flex: 1 }}>
                <P>
                  {i.qty} × {i.name}
                </P>
              </View>
              <P>{inr(i.priceMinor * i.qty)}</P>
            </Row>
          ))}
          <Row>
            <View style={{ flex: 1 }}>
              <Strong>Total</Strong>
            </View>
            <Strong>{inr(receipt.amountMinor)}</Strong>
          </Row>
        </Card>
        <Button title="Claim and review" busy={busy} onPress={() => void claim()} />
        <Button title="Scan another" tone="ghost" onPress={() => (setReceipt(null), setPayload(null))} />
        {error ? <Notice tone="bad">{error}</Notice> : null}
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={{ height: 360, borderRadius: 16, overflow: 'hidden' }}>
        <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => onScan(data)} />
      </View>
      <P muted>Point the camera at the Receipts QR printed on your bill.</P>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </View>
  );
}
