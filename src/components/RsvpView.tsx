import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  chunkAt,
  effectiveWpm,
  formatEta,
  msPerChunk,
  type ChunkSize,
} from '@/lib/rsvp';
import type { RsvpSettings } from '@/lib/storage';

export type RsvpAudioSync = {
  available: boolean;
  active: boolean;
  externalIndex: number;
  playing: boolean;
  speedLabel: string;
  onToggle: () => void;
  onPlayPause: () => void;
  onCycleSpeed: () => void;
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
  audioSync?: RsvpAudioSync;
};

const WPM_STEP = 25;

export function RsvpView({
  tokens,
  settings,
  onSettingsChange,
  onChapterComplete,
  onProgress,
  initialIndex = 0,
  fontSize,
  chapterKey,
  audioSync,
}: Props) {
  const syncing = !!audioSync?.active;
  const [index, setIndex] = useState(() => clampIndex(initialIndex, tokens.length));
  const [playing, setPlaying] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  const indexRef = useRef(index);
  const playingRef = useRef(playing);
  const settingsRef = useRef(settings);
  const tokensRef = useRef(tokens);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);

  indexRef.current = index;
  playingRef.current = playing;
  settingsRef.current = settings;
  tokensRef.current = tokens;

  // Follow audio word index when syncing
  useEffect(() => {
    if (!syncing) return;
    setIndex(clampIndex(audioSync!.externalIndex, tokens.length));
  }, [syncing, audioSync?.externalIndex, tokens.length]);

  // Reset when chapter changes
  useEffect(() => {
    completedRef.current = false;
    const start = clampIndex(initialIndex, tokens.length);
    setIndex(start);
    setPlaying(false);
    setElapsedSec(0);
    clearTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterKey]);

  useEffect(() => {
    onProgress(index);
  }, [index, onProgress]);

  // Detect end in sync mode
  useEffect(() => {
    if (!syncing || !audioSync) return;
    if (
      audioSync.playing === false &&
      tokens.length > 0 &&
      audioSync.externalIndex >= tokens.length - 1 &&
      !completedRef.current
    ) {
      // parent fires chapter complete on audio end; no-op here
    }
  }, [syncing, audioSync, tokens.length]);

  useEffect(() => {
    if (syncing) {
      clearTimer();
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
      if (audioSync?.playing) {
        elapsedRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
      }
      return () => {
        if (elapsedRef.current) {
          clearInterval(elapsedRef.current);
          elapsedRef.current = null;
        }
      };
    }

    if (!playing) {
      clearTimer();
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
      return;
    }

    elapsedRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    scheduleNext();

    return () => {
      clearTimer();
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    syncing,
    playing,
    audioSync?.playing,
    settings.wpm,
    settings.chunkSize,
    settings.pushMode,
    settings.startWpm,
    settings.targetWpm,
    chapterKey,
  ]);

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
  const progress = total > 0 ? Math.min(1, index / total) : 0;
  const currentWpm = effectiveWpm({
    wpm: settings.wpm,
    pushMode: settings.pushMode,
    startWpm: settings.startWpm,
    targetWpm: settings.targetWpm,
    wordIndex: index,
    totalWords: total,
  });
  const remaining = Math.max(0, total - index);
  const eta = formatEta(remaining, currentWpm);
  const isPlaying = syncing ? !!audioSync?.playing : playing;

  const patch = (partial: Partial<RsvpSettings>) => {
    onSettingsChange({ ...settings, ...partial });
  };

  const bumpWpm = (delta: number) => {
    const next = Math.max(100, Math.min(1000, settings.wpm + delta));
    patch({ wpm: next });
  };

  const setChunk = (n: ChunkSize) => patch({ chunkSize: n });

  const togglePush = () => {
    const on = !settings.pushMode;
    patch({
      pushMode: on,
      ...(on ? { startWpm: settings.wpm } : {}),
    });
  };

  const bumpPush = (field: 'startWpm' | 'targetWpm', delta: number) => {
    const next = Math.max(100, Math.min(1000, settings[field] + delta));
    patch({ [field]: next });
  };

  const togglePlay = () => {
    if (syncing && audioSync) {
      audioSync.onPlayPause();
      return;
    }
    setPlaying((p) => !p);
  };

  return (
    <View style={styles.root}>
      <Pressable style={styles.stage} onPress={togglePlay}>
        <Text style={[styles.chunk, { fontSize: fontSize * 3.6, lineHeight: fontSize * 4.8 }]}>
          {total === 0 ? 'No text' : display || '✓'}
        </Text>
        <Text style={styles.hint}>
          {isPlaying ? 'Tap to pause' : 'Tap to play'}
          {syncing ? ' · audio on' : ' · text only (no audio loaded)'}
        </Text>
      </Pressable>

      <View style={styles.progressBlock}>
        <View style={styles.progressRow}>
          <Text style={styles.dim}>{Math.round(progress * 100)}%</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.dim}>{syncing ? '' : `${eta} left`}</Text>
        </View>
        <Text style={styles.meta}>
          {Math.min(index, total)} / {total}
          {syncing
            ? ` · ${audioSync?.speedLabel ?? '1×'} · Sync`
            : ` · ${Math.round(currentWpm)} WPM${settings.pushMode ? ' · Push' : ''}`}
          {' · '}
          {fmtElapsed(elapsedSec)}
        </Text>
      </View>

      <View style={styles.controls}>
        {audioSync && (
          <Pressable
            style={[styles.btn, audioSync.active && styles.btnSync]}
            onPress={audioSync.onToggle}
          >
            <Text style={styles.btnText}>🔊</Text>
          </Pressable>
        )}

        {syncing ? (
          <Pressable style={styles.btn} onPress={audioSync?.onCycleSpeed}>
            <Text style={styles.btnText}>{audioSync?.speedLabel ?? '1×'}</Text>
          </Pressable>
        ) : (
          <>
            <Pressable style={styles.btn} onPress={() => bumpWpm(-WPM_STEP)}>
              <Text style={styles.btnText}>−</Text>
            </Pressable>
            <Text style={styles.wpmLabel}>{settings.wpm}</Text>
            <Pressable style={styles.btn} onPress={() => bumpWpm(WPM_STEP)}>
              <Text style={styles.btnText}>+</Text>
            </Pressable>
          </>
        )}

        {([1, 2, 3] as ChunkSize[]).map((n) => (
          <Pressable
            key={n}
            style={[styles.btn, settings.chunkSize === n && styles.btnActive]}
            onPress={() => setChunk(n)}
          >
            <Text style={styles.btnText}>{n}</Text>
          </Pressable>
        ))}

        {!syncing && (
          <Pressable
            style={[styles.btn, settings.pushMode && styles.btnPush]}
            onPress={togglePush}
          >
            <Text style={styles.btnText}>Push</Text>
          </Pressable>
        )}

        <Pressable style={[styles.btn, styles.playBtn]} onPress={togglePlay}>
          <Text style={[styles.btnText, styles.playText]}>{isPlaying ? '❚❚' : '▶'}</Text>
        </Pressable>
      </View>

      {!syncing && settings.pushMode && (
        <View style={styles.pushRow}>
          <Pressable style={styles.btnSm} onPress={() => bumpPush('startWpm', -WPM_STEP)}>
            <Text style={styles.btnText}>−</Text>
          </Pressable>
          <Text style={styles.dim}>Start {settings.startWpm}</Text>
          <Pressable style={styles.btnSm} onPress={() => bumpPush('startWpm', WPM_STEP)}>
            <Text style={styles.btnText}>+</Text>
          </Pressable>
          <Pressable style={styles.btnSm} onPress={() => bumpPush('targetWpm', -WPM_STEP)}>
            <Text style={styles.btnText}>−</Text>
          </Pressable>
          <Text style={styles.dim}>Target {settings.targetWpm}</Text>
          <Pressable style={styles.btnSm} onPress={() => bumpPush('targetWpm', WPM_STEP)}>
            <Text style={styles.btnText}>+</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  return Math.max(0, Math.min(Math.floor(i), len - 1));
}

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  chunk: {
    color: '#E8E6DF',
    fontFamily: 'serif',
    fontWeight: '600',
    textAlign: 'center',
  },
  hint: { color: '#7D8590', fontSize: 12, marginTop: 16 },
  progressBlock: { paddingHorizontal: 16, paddingBottom: 8, gap: 4 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressBar: { flex: 1, height: 3, backgroundColor: '#2A323D', borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: '#F5C518', borderRadius: 2 },
  dim: { color: '#7D8590', fontSize: 12 },
  meta: { color: '#7D8590', fontSize: 12, textAlign: 'center' },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2A323D',
    flexWrap: 'wrap',
  },
  btn: {
    backgroundColor: '#1A2230',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 40,
    alignItems: 'center',
  },
  btnSm: {
    backgroundColor: '#1A2230',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    minWidth: 36,
    alignItems: 'center',
  },
  btnActive: { backgroundColor: '#3A4555' },
  btnPush: { backgroundColor: '#5B3A8C' },
  btnSync: { backgroundColor: '#2A5A3A' },
  btnText: { color: '#E8E6DF', fontSize: 14, fontWeight: '600' },
  playBtn: { backgroundColor: '#F5C518', minWidth: 56 },
  playText: { color: '#111111', fontSize: 16 },
  wpmLabel: { color: '#E8E6DF', fontSize: 14, fontWeight: '700', minWidth: 40, textAlign: 'center' },
  pushRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 10,
    paddingHorizontal: 8,
  },
});
