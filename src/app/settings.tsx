import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ChunkSize } from '@/lib/rsvp';
import {
  DEFAULT_RSVP_SETTINGS,
  loadFontSize,
  loadRsvpSettings,
  loadTheme,
  saveFontSize,
  saveRsvpSettings,
  saveTheme,
  type RsvpSettings,
} from '@/lib/storage';

const WPM_STEP = 25;

export default function Settings() {
  const [fontSize, setFontSize] = useState(19);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [rsvp, setRsvp] = useState<RsvpSettings>(DEFAULT_RSVP_SETTINGS);

  useEffect(() => {
    loadFontSize().then((s) => { if (s) setFontSize(s); });
    loadTheme().then((t) => { if (t) setTheme(t); });
    loadRsvpSettings().then(setRsvp);
  }, []);

  const changeFont = (delta: number) => {
    const next = Math.max(13, Math.min(28, fontSize + delta));
    setFontSize(next);
    saveFontSize(next);
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    saveTheme(next);
  };

  const patchRsvp = (partial: Partial<RsvpSettings>) => {
    setRsvp((prev) => {
      const next = { ...prev, ...partial };
      saveRsvpSettings(next);
      return next;
    });
  };

  const bumpWpm = (field: 'wpm' | 'startWpm' | 'targetWpm', delta: number) => {
    const next = Math.max(100, Math.min(1000, rsvp[field] + delta));
    patchRsvp({ [field]: next });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.heading}>Settings</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Font Size</Text>
        <View style={styles.row}>
          <Pressable style={styles.btn} onPress={() => changeFont(-1)}>
            <Text style={styles.btnText}>A−</Text>
          </Pressable>
          <Text style={styles.valueText}>{fontSize}px</Text>
          <Pressable style={styles.btn} onPress={() => changeFont(1)}>
            <Text style={styles.btnText}>A+</Text>
          </Pressable>
        </View>
        <Text style={[styles.preview, { fontSize }]}>
          The quick brown fox jumps over the lazy dog.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Reading Speed (RSVP)</Text>
        <Pressable
          style={[styles.btn, rsvp.audioSync && styles.btnPush]}
          onPress={() => patchRsvp({ audioSync: !rsvp.audioSync })}
        >
          <Text style={styles.btnText}>
            Audio Sync {rsvp.audioSync ? 'On' : 'Off'}
          </Text>
        </Pressable>
        <Text style={styles.label}>When on, RSVP follows narration word timings (LAN books).</Text>

        <View style={styles.row}>
          <Pressable style={styles.btn} onPress={() => bumpWpm('wpm', -WPM_STEP)}>
            <Text style={styles.btnText}>−</Text>
          </Pressable>
          <Text style={styles.valueText}>{rsvp.wpm} WPM</Text>
          <Pressable style={styles.btn} onPress={() => bumpWpm('wpm', WPM_STEP)}>
            <Text style={styles.btnText}>+</Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Words per chunk</Text>
        <View style={styles.row}>
          {([1, 2, 3] as ChunkSize[]).map((n) => (
            <Pressable
              key={n}
              style={[styles.btn, rsvp.chunkSize === n && styles.btnActive]}
              onPress={() => patchRsvp({ chunkSize: n })}
            >
              <Text style={styles.btnText}>{n}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={[styles.btn, rsvp.pushMode && styles.btnPush]}
          onPress={() =>
            patchRsvp({
              pushMode: !rsvp.pushMode,
              ...(!rsvp.pushMode ? { startWpm: rsvp.wpm } : {}),
            })
          }
        >
          <Text style={styles.btnText}>
            Push Mode {rsvp.pushMode ? 'On' : 'Off'}
          </Text>
        </Pressable>

        {rsvp.pushMode && (
          <>
            <Text style={styles.label}>Start speed</Text>
            <View style={styles.row}>
              <Pressable style={styles.btn} onPress={() => bumpWpm('startWpm', -WPM_STEP)}>
                <Text style={styles.btnText}>−</Text>
              </Pressable>
              <Text style={styles.valueText}>{rsvp.startWpm} WPM</Text>
              <Pressable style={styles.btn} onPress={() => bumpWpm('startWpm', WPM_STEP)}>
                <Text style={styles.btnText}>+</Text>
              </Pressable>
            </View>
            <Text style={styles.label}>Target speed</Text>
            <View style={styles.row}>
              <Pressable style={styles.btn} onPress={() => bumpWpm('targetWpm', -WPM_STEP)}>
                <Text style={styles.btnText}>−</Text>
              </Pressable>
              <Text style={styles.valueText}>{rsvp.targetWpm} WPM</Text>
              <Pressable style={styles.btn} onPress={() => bumpWpm('targetWpm', WPM_STEP)}>
                <Text style={styles.btnText}>+</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Theme</Text>
        <Pressable style={styles.btn} onPress={toggleTheme}>
          <Text style={styles.btnText}>{theme === 'dark' ? '🌙 Dark' : '☀ Light'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F14', padding: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  backBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#1A2230' },
  backText: { color: '#E8E6DF', fontSize: 14 },
  heading: { color: '#F5C518', fontSize: 24, fontWeight: '700' },
  section: { marginBottom: 28, gap: 12 },
  sectionTitle: { color: '#7D8590', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  label: { color: '#7D8590', fontSize: 12, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  btn: { backgroundColor: '#1A2230', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  btnActive: { backgroundColor: '#3A4555' },
  btnPush: { backgroundColor: '#5B3A8C' },
  btnText: { color: '#E8E6DF', fontSize: 16, fontWeight: '600' },
  valueText: { color: '#E8E6DF', fontSize: 16, minWidth: 50, textAlign: 'center' },
  preview: { color: '#D8D5CC', fontFamily: 'serif', lineHeight: 32 },
});
