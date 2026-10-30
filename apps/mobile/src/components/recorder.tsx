import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../lib/theme';

// The 15-second voice note, recorded as AAC (m4a) on both platforms. The API transcribes it and deletes the audio
// after seven days.

const MAX_MS = 15_000;

export function Recorder({ busy, onRecorded }: { busy?: boolean; onRecorded(uri: string): void }) {
  const t = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 200);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!recorder.isRecording) return;
    await recorder.stop();
    if (recorder.uri) onRecorded(recorder.uri);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const start = async () => {
    setError(null);
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError('Microphone permission is off. Allow it in Settings, or type instead.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    timer.current = setTimeout(() => void stop(), MAX_MS);
  };

  const recording = state.isRecording;
  const left = Math.max(0, Math.ceil((MAX_MS - (state.durationMillis ?? 0)) / 1000));
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <Pressable
        onPress={() => void (recording ? stop() : start())}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
        style={{ width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', backgroundColor: recording ? t.bad : t.accent, opacity: busy ? 0.5 : 1 }}
      >
        <Text style={{ color: recording ? '#fff' : t.accentInk, fontWeight: '800', fontSize: recording ? 32 : 16 }}>{recording ? left : busy ? 'Listening…' : 'Tap to talk'}</Text>
      </Pressable>
      <Text style={{ color: t.muted, fontSize: 13 }}>{recording ? 'Tap again when you are done' : 'Up to 15 seconds, any language'}</Text>
      {error ? <Text style={{ color: t.bad, textAlign: 'center' }}>{error}</Text> : null}
    </View>
  );
}
