import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Fonts, type Palette } from '@/constants/lumina';
import {
  chunkAt,
  effectiveWpm,
  msPerChunk,
  type ChunkSize,
} from '@/lib/rsvp';
import type { RsvpSettings } from '@/lib/storage';
import { clampLead, fmtLead } from '@/lib/storage';
import { useTheme } from '@/lib/theme';

export type RsvpAudioSync = {
  available: boolean;
  active: boolean;
  externalIndex: number;
  playing: boolean;
  speedLabel: string;
  onToggle: () => void;
  onPlayPause: () => void;
  onCycleSpeed: () => void;
  onStep?: (deltaChunks: number) => void;
};

type Props = {
  tokens: string[];
  settings: RsvpSettings;
  onSettingsChange: (next: RsvpSettings) => void;
  onChapterComplete: () => void;
  onProgress: (wordIndex: number) => void;
  initialIndex?: number;
  fontSize: number;
  chapterKey: string;
  onFocusChange?: (focusing: boolean) => void;
  audioSync?: RsvpAudioSync;
};

export function RsvpView({
  tokens,
  settings,
  onSettingsChange,
  onChapterComplete,
  onProgress,
  initialIndex = 0,
  chapterKey,
  onFocusChange,
  audioSync,
}: Props) {
  const { colors } = useTheme();
  const { width: winW } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const syncing = !!audioSync?.active;
  const [index, setIndex] = useState(() => clampIndex(initialIndex, tokens.length));
  const [playing, setPlaying] = useState(false);
  const [focusing, setFocusing] = useState(false);

  const indexRef = useRef(index);
  const playingRef = useRef(playing);
  const settingsRef = useRef(settings);
  const tokensRef = useRef(tokens);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedRef = useRef(false);

  indexRef.current = index;
  playingRef.current = playing;
  settingsRef.current = settings;
  tokensRef.current = tokens;

  useEffect(() => {
    if (!syncing) return;
    setIndex(clampIndex(audioSync!.externalIndex, tokens.length));
  }, [syncing, audioSync?.externalIndex, tokens.length]);

  useEffect(() => {
    completedRef.current = false;
    const start = clampIndex(initialIndex, tokens.length);
    setIndex(start);
    setPlaying(false);
    setFocusing(false);
    clearTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterKey]);

  useEffect(() => {
    onProgress(index);
  }, [index, onProgress]);

  const isPlaying = syncing ? !!audioSync?.playing : playing;

  useEffect(() => {
    if (syncing) {
      clearTimer();
      return;
    }
    if (!playing) {
      clearTimer();
      return;
    }
    scheduleNext();
    return () => clearTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    syncing,
    playing,
    settings.wpm,
    settings.chunkSize,
    settings.pushMode,
    settings.startWpm,
    settings.targetWpm,
    chapterKey,
  ]);

  useEffect(() => {
    onFocusChange?.(focusing);
  }, [focusing, onFocusChange]);

  useEffect(() => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    if (isPlaying) {
      focusTimerRef.current = setTimeout(() => setFocusing(true), 1400);
    } else {
      setFocusing(false);
    }
    return () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    };
  }, [isPlaying, index]);

  function wakeFocus() {
    setFocusing(false);
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    if (isPlaying) {
      focusTimerRef.current = setTimeout(() => setFocusing(true), 1400);
    }
  }

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function scheduleNext() {
    clearTimer();
    const toks = tokensRef.current;
    const s = settingsRef.current;
    const i = indexRef.current;

    if (i >= toks.length) {
      if (!completedRef.current) {
        completedRef.current = true;
        setPlaying(false);
        onChapterComplete();
      }
      return;
    }

    const wpm = effectiveWpm({
      wpm: s.wpm,
      pushMode: s.pushMode,
      startWpm: s.startWpm,
      targetWpm: s.targetWpm,
      wordIndex: i,
      totalWords: toks.length,
    });
    const delay = msPerChunk(wpm, s.chunkSize);

    timerRef.current = setTimeout(() => {
      if (!playingRef.current) return;
      const next = indexRef.current + s.chunkSize;
      if (next >= toks.length) {
        setIndex(toks.length);
        completedRef.current = true;
        setPlaying(false);
        onChapterComplete();
        return;
      }
      setIndex(next);
      scheduleNext();
    }, delay);
  }

  const total = tokens.length;
  const display = chunkAt(tokens, index, settings.chunkSize);
  const chunkCount = total > 0 ? Math.ceil(total / settings.chunkSize) : 0;
  const chunkIdx = total > 0 ? Math.floor(Math.min(index, total - 1) / settings.chunkSize) : 0;
  const progress = chunkCount > 0 ? (chunkIdx + 1) / chunkCount : 0;
  const currentWpm = effectiveWpm({
    wpm: settings.wpm,
    pushMode: settings.pushMode,
    startWpm: settings.startWpm,
    targetWpm: settings.targetWpm,
    wordIndex: index,
    totalWords: total,
  });

  const remainingText = remainingLabel(chunkCount, chunkIdx, currentWpm, settings.chunkSize);
  const canPrev = chunkIdx > 0;
  const canNext = chunkCount > 0 && chunkIdx < chunkCount - 1;

  const patch = (partial: Partial<RsvpSettings>) => {
    onSettingsChange({ ...settings, ...partial });
  };

  const setWpm = (val: number) => {
    patch({ wpm: Math.max(60, Math.min(1000, Math.round(val / 10) * 10)) });
    wakeFocus();
  };

  const setChunk = (n: ChunkSize) => {
    patch({ chunkSize: n });
    wakeFocus();
  };

  const bumpLead = (delta: number) => {
    patch({ syncLeadSec: clampLead((settings.syncLeadSec ?? 0.2) + delta) });
    wakeFocus();
  };

  const togglePlay = () => {
    wakeFocus();
    if (syncing && audioSync) {
      audioSync.onPlayPause();
      return;
    }
    setPlaying((p) => !p);
  };

  const step = (delta: number) => {
    wakeFocus();
    if (syncing && audioSync?.onStep) {
      audioSync.onStep(delta);
      return;
    }
    const next = indexRef.current + delta * settings.chunkSize;
    setIndex(clampIndex(next, tokens.length));
    if (playingRef.current) {
      clearTimer();
      scheduleNext();
    }
  };

  return (
    <View style={styles.root}>
      <Pressable style={styles.stage} onPress={togglePlay}>
        {total === 0 ? (
          <Text style={styles.emptyTitle}>Nothing to read yet</Text>
        ) : (
          <Animated.Text
            key={`${chapterKey}:${index}:${settings.chunkSize}`}
            entering={FadeInDown.duration(90)}
            style={[styles.word, rsvpType((display || '✓').length, winW)]}
          >
            <OrpText text={display || '✓'} accent={colors.accent} />
          </Animated.Text>
        )}
      </Pressable>

      <View style={[styles.deck, focusing && styles.deckFocus]} pointerEvents={focusing ? 'none' : 'auto'}>
        <View style={styles.progress}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <View style={styles.progressMeta}>
            <Text style={styles.meta}>{chunkCount ? `${chunkIdx + 1} / ${chunkCount}` : '0 / 0'}</Text>
            <Text style={styles.meta}>{remainingText}</Text>
          </View>
        </View>

        <View style={styles.controlsRow}>
          <View style={styles.transport}>
            <Pressable
              style={[styles.iconBtn, !canPrev && styles.iconBtnDisabled]}
              onPress={() => canPrev && step(-1)}
              disabled={!canPrev}
            >
              <Text style={styles.iconGlyph}>‹</Text>
            </Pressable>
            <Pressable style={[styles.iconBtn, styles.playBtn]} onPress={togglePlay}>
              <Text style={styles.playGlyph}>{isPlaying ? '❚❚' : '▶'}</Text>
            </Pressable>
            <Pressable
              style={[styles.iconBtn, !canNext && styles.iconBtnDisabled]}
              onPress={() => canNext && step(1)}
              disabled={!canNext}
            >
              <Text style={styles.iconGlyph}>›</Text>
            </Pressable>
          </View>

          {syncing ? (
            <View style={styles.syncExtras}>
              <Pressable style={styles.speedChip} onPress={audioSync?.onCycleSpeed}>
                <Text style={styles.speedLabel}>Audio</Text>
                <Text style={styles.speedVal}>{audioSync?.speedLabel ?? '1×'}</Text>
              </Pressable>
              <View style={styles.leadRow}>
                <Pressable style={styles.leadBtn} onPress={() => bumpLead(-0.1)}>
                  <Text style={styles.leadBtnText}>−0.1s</Text>
                </Pressable>
                <Text style={styles.leadVal}>{fmtLead(settings.syncLeadSec)}</Text>
                <Pressable style={styles.leadBtn} onPress={() => bumpLead(0.1)}>
                  <Text style={styles.leadBtnText}>+0.1s</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <WpmSlider wpm={settings.wpm} onChange={setWpm} colors={colors} />
          )}

          <View style={styles.chunk}>
            {([1, 2, 3] as ChunkSize[]).map((n) => (
              <Pressable
                key={n}
                style={[styles.chunkBtn, settings.chunkSize === n && styles.chunkBtnActive]}
                onPress={() => setChunk(n)}
              >
                <Text style={[styles.chunkBtnText, settings.chunkSize === n && styles.chunkBtnTextActive]}>
                  {n}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={styles.hint}>
          {syncing ? 'tap · ‹ › · text ±0.1s' : 'tap · ‹ › · speed · 1 2 3 chunk'}
        </Text>
      </View>
    </View>
  );
}

function OrpText({ text, accent }: { text: string; accent: string }) {
  if (!text) return null;
  const orpIdx = Math.max(0, Math.floor(text.length * 0.4));
  return (
    <>
      {text.slice(0, orpIdx)}
      <Text style={{ color: accent }}>{text.charAt(orpIdx)}</Text>
      {text.slice(orpIdx + 1)}
    </>
  );
}

/** HTML: clamp(3.5rem, 14vw, 8rem); long >16; xlong >28. Mobile uses tighter clamps. */
function rsvpType(len: number, width: number) {
  const mobile = width <= 560;
  let min: number;
  let vw: number;
  let max: number;
  if (len > 28) {
    min = mobile ? 22.4 : 27.2;
    vw = width * (mobile ? 0.05 : 0.06);
    max = mobile ? 35.2 : 51.2;
  } else if (len > 16) {
    min = mobile ? 30.4 : 38.4;
    vw = width * (mobile ? 0.07 : 0.09);
    max = mobile ? 48 : 72;
  } else {
    min = mobile ? 41.6 : 56;
    vw = width * (mobile ? 0.12 : 0.14);
    max = mobile ? 80 : 128;
  }
  const fontSize = Math.min(max, Math.max(min, vw));
  return {
    fontSize,
    lineHeight: fontSize * 1.1,
    letterSpacing: fontSize * -0.02,
  };
}

function WpmSlider({
  wpm,
  onChange,
  colors,
}: {
  wpm: number;
  onChange: (n: number) => void;
  colors: Palette;
}) {
  const trackW = useRef(1);
  const min = 60;
  const max = 1000;
  const pct = (wpm - min) / (max - min);

  return (
    <View style={sliderStyles.wrap}>
      <Text style={[sliderStyles.label, { color: colors.muted }]}>Speed</Text>
      <Pressable
        style={[sliderStyles.track, { backgroundColor: colors.border }]}
        onLayout={(e) => { trackW.current = e.nativeEvent.layout.width; }}
        onPress={(e) => {
          const x = e.nativeEvent.locationX;
          const p = Math.max(0, Math.min(1, x / trackW.current));
          onChange(min + p * (max - min));
        }}
      >
        <View style={[sliderStyles.fill, { width: `${pct * 100}%`, backgroundColor: colors.fg }]} />
        <View style={[sliderStyles.thumb, { left: `${pct * 100}%`, backgroundColor: colors.fg, borderColor: colors.bg }]} />
      </Pressable>
      <Text style={[sliderStyles.val, { color: colors.fg }]}>{wpm} wpm</Text>
    </View>
  );
}

function remainingLabel(chunkCount: number, chunkIdx: number, wpm: number, chunkSize: number): string {
  if (!chunkCount) return '— remaining';
  const left = Math.max(0, chunkCount - chunkIdx - 1);
  const rate = wpm / chunkSize;
  const seconds = rate > 0 ? Math.ceil((left / rate) * 60) : 0;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s remaining` : `${s}s remaining`;
}

function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  return Math.max(0, Math.min(Math.floor(i), len - 1));
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    root: { flex: 1 },
    stage: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 20,
    },
    word: {
      fontFamily: Fonts.display,
      fontWeight: '400',
      textAlign: 'center',
      color: c.fg,
      maxWidth: '92%',
    },
    emptyTitle: {
      fontFamily: Fonts.display,
      fontSize: 28,
      color: c.fg,
      textAlign: 'center',
    },
    deck: {
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingTop: 18,
      paddingHorizontal: 4,
      gap: 16,
      paddingBottom: 4,
    },
    deckFocus: { opacity: 0.12 },
    progress: { gap: 8 },
    progressTrack: {
      height: 2,
      backgroundColor: c.border,
      borderRadius: 1,
      overflow: 'hidden',
    },
    progressFill: {
      height: 2,
      backgroundColor: c.fg,
      borderRadius: 1,
    },
    progressMeta: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
    },
    meta: {
      fontFamily: Fonts.mono,
      fontSize: 11,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: c.muted,
    },
    controlsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      flexWrap: 'wrap',
    },
    transport: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    iconBtn: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 4,
    },
    iconBtnDisabled: { opacity: 0.3 },
    playBtn: { width: 56, height: 56, minWidth: 56, minHeight: 56, borderColor: c.fg },
    iconGlyph: { color: c.fg, fontSize: 22, lineHeight: 24 },
    playGlyph: { color: c.fg, fontSize: 16 },
    speedChip: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    speedLabel: {
      fontFamily: Fonts.mono,
      fontSize: 11,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: c.muted,
    },
    speedVal: {
      fontFamily: Fonts.mono,
      fontSize: 13,
      letterSpacing: 0.6,
      color: c.fg,
    },
    syncExtras: { flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
    leadRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    leadBtn: {
      minWidth: 52,
      minHeight: 36,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 4,
    },
    leadBtnText: {
      fontFamily: Fonts.mono,
      fontSize: 11,
      letterSpacing: 0.6,
      color: c.fg,
    },
    leadVal: {
      fontFamily: Fonts.mono,
      fontSize: 11,
      letterSpacing: 0.6,
      color: c.fg,
      minWidth: 110,
      textAlign: 'center',
    },
    chunk: { flexDirection: 'row', gap: 4 },
    chunkBtn: {
      minWidth: 36,
      minHeight: 36,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 4,
    },
    chunkBtnActive: { backgroundColor: c.fg, borderColor: c.fg },
    chunkBtnText: {
      fontFamily: Fonts.mono,
      fontSize: 12,
      letterSpacing: 0.6,
      color: c.muted,
    },
    chunkBtnTextActive: { color: c.bg },
    hint: {
      fontFamily: Fonts.mono,
      fontSize: 10,
      letterSpacing: 1.6,
      textTransform: 'uppercase',
      color: c.muted,
      textAlign: 'center',
      paddingTop: 2,
    },
  });
}

const sliderStyles = StyleSheet.create({
  wrap: { flex: 1, minWidth: 160, maxWidth: 340, flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  track: { flex: 1, height: 14, justifyContent: 'center', borderRadius: 1 },
  fill: { height: 2, borderRadius: 1 },
  thumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    borderWidth: 2,
  },
  val: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    letterSpacing: 0.6,
    minWidth: 64,
    textAlign: 'right',
  },
});
