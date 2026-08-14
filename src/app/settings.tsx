import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemeToggle } from '@/components/ThemeToggle';
import { Fonts } from '@/constants/lumina';
import type { ChunkSize } from '@/lib/rsvp';
import {
  DEFAULT_RSVP_SETTINGS,
  loadFontSize,
  loadRsvpSettings,
  saveFontSize,
  saveRsvpSettings,
  clampLead,
  fmtLead,
  type RsvpSettings,
} from '@/lib/storage';
import { useTheme } from '@/lib/theme';

const WPM_STEP = 25;

export default function Settings() {
  const { colors } = useTheme();
  const [fontSize, setFontSize] = useState(19);
  const [rsvp, setRsvp] = useState<RsvpSettings>(DEFAULT_RSVP_SETTINGS);

  useEffect(() => {
    loadFontSize().then((s) => { if (s) setFontSize(s); });
    loadRsvpSettings().then(setRsvp);
  }, []);

  const changeFont = (delta: number) => {
    const next = Math.max(13, Math.min(28, fontSize + delta));
    setFontSize(next);
    saveFontSize(next);
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={[styles.editBtn, { color: colors.muted }]}>Back</Text>
        </Pressable>
        <Text style={[styles.heading, { color: colors.fg }]}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>Font Size</Text>
          <View style={styles.row}>
            <Pressable style={[styles.btn, { borderColor: colors.border }]} onPress={() => changeFont(-1)}>
              <Text style={[styles.btnText, { color: colors.fg }]}>A−</Text>
            </Pressable>
            <Text style={[styles.valueText, { color: colors.fg }]}>{fontSize}px</Text>
            <Pressable style={[styles.btn, { borderColor: colors.border }]} onPress={() => changeFont(1)}>
              <Text style={[styles.btnText, { color: colors.fg }]}>A+</Text>
            </Pressable>
          </View>
          <Text style={[styles.preview, { color: colors.fg, fontSize }]}>
            The quick brown fox jumps over the lazy dog.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>Reading Speed (RSVP)</Text>
          <Pressable
            style={[styles.btn, { borderColor: rsvp.audioSync ? colors.fg : colors.border, backgroundColor: rsvp.audioSync ? colors.fg : 'transparent' }]}
            onPress={() => patchRsvp({ audioSync: !rsvp.audioSync })}
          >
            <Text style={[styles.btnText, { color: rsvp.audioSync ? colors.bg : colors.fg }]}>
              Audio Sync {rsvp.audioSync ? 'On' : 'Off'}
            </Text>
          </Pressable>
          <Text style={[styles.label, { color: colors.muted }]}>When on, RSVP follows narration word timings.</Text>

          <Text style={[styles.label, { color: colors.muted }]}>Text vs audio</Text>
          <View style={styles.row}>
            <Pressable
              style={[styles.btn, { borderColor: colors.border }]}
              onPress={() => patchRsvp({ syncLeadSec: clampLead((rsvp.syncLeadSec ?? 0.2) - 0.1) })}
            >
              <Text style={[styles.btnText, { color: colors.fg }]}>Later</Text>
            </Pressable>
            <Text style={[styles.valueText, { color: colors.fg }]}>{fmtLead(rsvp.syncLeadSec)}</Text>
            <Pressable
              style={[styles.btn, { borderColor: colors.border }]}
              onPress={() => patchRsvp({ syncLeadSec: clampLead((rsvp.syncLeadSec ?? 0.2) + 0.1) })}
            >
              <Text style={[styles.btnText, { color: colors.fg }]}>Earlier</Text>
            </Pressable>
          </View>

          <View style={styles.row}>
            <Pressable style={[styles.btn, { borderColor: colors.border }]} onPress={() => bumpWpm('wpm', -WPM_STEP)}>
              <Text style={[styles.btnText, { color: colors.fg }]}>−</Text>
            </Pressable>
            <Text style={[styles.valueText, { color: colors.fg }]}>{rsvp.wpm} WPM</Text>
            <Pressable style={[styles.btn, { borderColor: colors.border }]} onPress={() => bumpWpm('wpm', WPM_STEP)}>
              <Text style={[styles.btnText, { color: colors.fg }]}>+</Text>
            </Pressable>
          </View>

          <Text style={[styles.label, { color: colors.muted }]}>Words per chunk</Text>
          <View style={styles.row}>
            {([1, 2, 3] as ChunkSize[]).map((n) => (
              <Pressable
                key={n}
                style={[
                  styles.btn,
                  {
                    borderColor: rsvp.chunkSize === n ? colors.fg : colors.border,
                    backgroundColor: rsvp.chunkSize === n ? colors.fg : 'transparent',
                  },
                ]}
                onPress={() => patchRsvp({ chunkSize: n })}
              >
                <Text style={[styles.btnText, { color: rsvp.chunkSize === n ? colors.bg : colors.fg }]}>{n}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={[styles.btn, { borderColor: rsvp.pushMode ? colors.fg : colors.border, backgroundColor: rsvp.pushMode ? colors.fg : 'transparent' }]}
            onPress={() =>
              patchRsvp({
                pushMode: !rsvp.pushMode,
                ...(!rsvp.pushMode ? { startWpm: rsvp.wpm } : {}),
              })
            }
          >
            <Text style={[styles.btnText, { color: rsvp.pushMode ? colors.bg : colors.fg }]}>
              Push Mode {rsvp.pushMode ? 'On' : 'Off'}
            </Text>
          </Pressable>

          {rsvp.pushMode && (
            <>
              <Text style={[styles.label, { color: colors.muted }]}>Start speed</Text>
              <View style={styles.row}>
                <Pressable style={[styles.btn, { borderColor: colors.border }]} onPress={() => bumpWpm('startWpm', -WPM_STEP)}>
                  <Text style={[styles.btnText, { color: colors.fg }]}>−</Text>
                </Pressable>
                <Text style={[styles.valueText, { color: colors.fg }]}>{rsvp.startWpm} WPM</Text>
                <Pressable style={[styles.btn, { borderColor: colors.border }]} onPress={() => bumpWpm('startWpm', WPM_STEP)}>
                  <Text style={[styles.btnText, { color: colors.fg }]}>+</Text>
                </Pressable>
              </View>
              <Text style={[styles.label, { color: colors.muted }]}>Target speed</Text>
              <View style={styles.row}>
                <Pressable style={[styles.btn, { borderColor: colors.border }]} onPress={() => bumpWpm('targetWpm', -WPM_STEP)}>
                  <Text style={[styles.btnText, { color: colors.fg }]}>−</Text>
                </Pressable>
                <Text style={[styles.valueText, { color: colors.fg }]}>{rsvp.targetWpm} WPM</Text>
                <Pressable style={[styles.btn, { borderColor: colors.border }]} onPress={() => bumpWpm('targetWpm', WPM_STEP)}>
                  <Text style={[styles.btnText, { color: colors.fg }]}>+</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>Theme</Text>
          <ThemeToggle />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24 },
  editBtn: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  heading: { fontFamily: Fonts.display, fontSize: 24, letterSpacing: -0.4 },
  scroll: { paddingBottom: 40 },
  section: { marginBottom: 28, gap: 12 },
  sectionTitle: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase' },
  label: { fontSize: 12, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  btn: { borderWidth: 1, borderRadius: 4, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', backgroundColor: 'transparent' },
  btnText: { fontSize: 15 },
  valueText: { fontFamily: Fonts.mono, fontSize: 14, letterSpacing: 0.6, minWidth: 110, textAlign: 'center' },
  preview: { fontFamily: Fonts.display, lineHeight: 32 },
});
