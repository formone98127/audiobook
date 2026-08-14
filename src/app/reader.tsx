import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RsvpView } from '@/components/RsvpView';
import { Fonts } from '@/constants/lumina';
import { audioUrlFor, loadBook, loadTimings } from '@/lib/api';
import { manifestUrlFor } from '@/lib/config';
import { lookupWord } from '@/lib/dictionary';
import { alignmentTokensFromChapter, tokensFromChapter } from '@/lib/rsvp';
import { useTheme } from '@/lib/theme';
import {
  loadFontSize,
  loadPosition,
  loadReaderMode,
  loadRsvpPosition,
  loadRsvpSettings,
  loadSpeed,
  savePosition,
  saveReaderMode,
  saveRsvpPosition,
  saveRsvpSettings,
  saveSpeed,
  type ReaderMode,
  type RsvpSettings,
} from '@/lib/storage';
import { TimingIndex } from '@/lib/timing';
import type { BookChapter, BookText, Manifest } from '@/lib/types';

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_OPTIONS = [15, 30, 45, 60];
const DEFAULT_FONT_SIZE = 19;

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function ReaderScreen() {
  const { colors } = useTheme();
  const [chromeFocus, setChromeFocus] = useState(false);
  const { bookId, chapter: chapterParam } = useLocalSearchParams<{ bookId: string; chapter?: string }>();
  const manifestUrl = bookId ? manifestUrlFor(bookId) : '';
  const initialChapter = chapterParam ? parseInt(chapterParam, 10) : 0;

  const [book, setBook] = useState<{ manifest: Manifest; text: BookText } | null>(null);
  const [chapterIdx, setChapterIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingChapter, setLoadingChapter] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [sleepRemaining, setSleepRemaining] = useState<number | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [definition, setDefinition] = useState<{ word: string; text: string; x: number; y: number } | null>(null);
  const [defLoading, setDefLoading] = useState(false);
  const [mode, setMode] = useState<ReaderMode>('rsvp');
  const [rsvpSettings, setRsvpSettings] = useState<RsvpSettings | null>(null);
  const [prefsReady, setPrefsReady] = useState(false);
  const [rsvpWordIndex, setRsvpWordIndex] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [timings, setTimings] = useState<TimingIndex | null>(null);
  const [syncAvailable, setSyncAvailable] = useState(false);
  const [syncIndex, setSyncIndex] = useState(0);

  const player = useAudioPlayer(null, { updateInterval: 50 });

  useEffect(() => () => { try { player.pause(); } catch {} }, [player]);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    });
  }, []);

  const [, setTick] = useState(0);
  useEffect(() => {
    const needTick = mode === 'audio' || (mode === 'rsvp' && syncAvailable);
    if (!needTick) return;
    const id = setInterval(() => setTick((v) => v + 1), 50);
    return () => clearInterval(id);
  }, [mode, syncAvailable]);

  const speedRef = useRef(SPEEDS[1]);
  const wasPlayingRef = useRef(false);
  const restoredRef = useRef(false);
  const lastSaveRef = useRef(0);
  const lastRsvpSaveRef = useRef(0);

  useEffect(() => {
    if (mode !== 'rsvp' || loadingChapter) setChromeFocus(false);
  }, [mode, loadingChapter]);

  useEffect(() => {
    loadFontSize().then((s) => { if (s) setFontSize(s); });
    Promise.all([loadReaderMode(), loadRsvpSettings()]).then(([m, s]) => {
      setMode(m);
      setRsvpSettings(s);
      setPrefsReady(true);
    });
  }, []);

  useEffect(() => {
    if (!manifestUrl) return;
    loadBook(manifestUrl).then(setBook).catch((e) => setError(String(e?.message ?? e)));
  }, [manifestUrl]);

  const openChapterRsvp = useCallback(
    async (i: number, wordIndex = 0): Promise<boolean> => {
      if (!book) return false;
      setLoadingChapter(true);
      setError(null);
      setTimings(null);
      setSyncAvailable(false);
      try {
        setChapterIdx(i);
        setRsvpWordIndex(wordIndex);
        setSyncIndex(wordIndex);
        // Always try to attach audio+timings for RSVP (Pages demo + LAN).
        try {
          const tj = await loadTimings(manifestUrl, i, book.manifest);
          const idx = new TimingIndex(tj);
          setTimings(idx);
          const uri = audioUrlFor(manifestUrl, i, book.manifest);
          player.replace({ uri });
          player.setPlaybackRate(speedRef.current);
          const seekTo = idx.timeAtFlatWord(wordIndex) ?? 0;
          setAudioReady(true);
          setSyncAvailable(true);
          // Ensure setting stays on once media works (clears stale false from earlier demos).
          if (rsvpSettings && !rsvpSettings.audioSync) {
            const fixed = { ...rsvpSettings, audioSync: true };
            setRsvpSettings(fixed);
            saveRsvpSettings(fixed);
          }
          setTimeout(() => {
            try { player.seekTo(seekTo); } catch {}
            setBuffering(false);
          }, 600);
          return true;
        } catch {
          try { player.pause(); } catch {}
          setSyncAvailable(false);
          setAudioReady(false);
          setTimings(null);
          return false;
        }
      } finally {
        setLoadingChapter(false);
      }
    },
    [book, rsvpSettings, player, manifestUrl],
  );

  const openChapterAudio = useCallback(
    async (i: number, autoplay: boolean, seekTo?: number) => {
      if (!book) return;
      setLoadingChapter(true);
      setBuffering(true);
      setError(null);
      try {
        setChapterIdx(i);
        player.replace({ uri: audioUrlFor(manifestUrl, i, book.manifest) });
        player.setPlaybackRate(speedRef.current);
        setAudioReady(true);
        if (seekTo != null) {
          setTimeout(() => { player.seekTo(seekTo); setBuffering(false); if (autoplay) player.play(); }, 800);
        } else if (autoplay) {
          setTimeout(() => { player.play(); setBuffering(false); }, 1000);
        } else {
          setTimeout(() => setBuffering(false), 800);
        }
      } catch (e: any) {
        setError(String(e?.message ?? e));
        setBuffering(false);
      } finally {
        setLoadingChapter(false);
      }
    },
    [book, player, manifestUrl],
  );

  useEffect(() => {
    if (!book || restoredRef.current || !prefsReady || !rsvpSettings) return;
    restoredRef.current = true;
    (async () => {
      if (mode === 'rsvp') {
        if (bookId && initialChapter === 0) {
          const saved = await loadRsvpPosition(bookId);
          if (saved) {
            await openChapterRsvp(saved.chapterIdx, saved.wordIndex);
            return;
          }
        }
        await openChapterRsvp(initialChapter, 0);
        return;
      }

      if (bookId && initialChapter === 0) {
        const saved = await loadPosition(bookId);
        if (saved) {
          await openChapterAudio(saved.chapterIdx, true, Math.max(0, saved.currentTime - 15));
          return;
        }
      }
      await openChapterAudio(initialChapter, true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, prefsReady, rsvpSettings, mode]);

  useEffect(() => {
    if (!bookId) return;
    loadSpeed(bookId).then((s) => {
      if (s != null) {
        const idx = SPEEDS.indexOf(s);
        if (idx >= 0) { setSpeedIdx(idx); speedRef.current = s; }
      }
    });
  }, [bookId]);

  const t = player.currentTime;
  const duration = player.duration || 0;
  const playing = player.playing;

  useEffect(() => {
    if (mode !== 'audio' || !bookId || !playing || duration <= 0) return;
    const now = Date.now();
    if (now - lastSaveRef.current < 5000) return;
    lastSaveRef.current = now;
    savePosition(bookId, { chapterIdx, currentTime: t });
  }, [t, playing, duration, bookId, chapterIdx, mode]);

  // Drive RSVP flash from audio word timings whenever media is loaded
  useEffect(() => {
    if (mode !== 'rsvp' || !timings || !syncAvailable) return;
    const flat = timings.flatWordAt(t);
    setSyncIndex(flat);
    setRsvpWordIndex(flat);
  }, [t, mode, timings, syncAvailable]);

  useEffect(() => {
    if (mode !== 'audio') return;
    const finished = wasPlayingRef.current && !playing && duration > 0 && t >= duration - 0.3;
    wasPlayingRef.current = playing;
    if (finished && book && chapterIdx < book.manifest.chapters.length - 1) {
      openChapterAudio(chapterIdx + 1, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, t, duration, mode]);

  useEffect(() => {
    if (sleepRemaining == null) return;
    if (sleepRemaining <= 0) { player.pause(); setSleepRemaining(null); return; }
    const id = setTimeout(() => setSleepRemaining((s) => (s ?? 0) - 1), 1000);
    return () => clearTimeout(id);
  }, [sleepRemaining, player]);

  const chapter: BookChapter | undefined = book?.text.chapters.find((c) => c.index === chapterIdx);

  const paragraphs = useMemo(() => {
    const rows: string[][] = [];
    for (const p of chapter?.paragraphs ?? []) {
      rows.push(p.sentences.map((s) => s.text));
    }
    return rows;
  }, [chapter]);

  const tokens = useMemo(() => {
    const lang = book?.manifest.language;
    if (mode === 'rsvp' && syncAvailable) {
      return alignmentTokensFromChapter(chapter, lang);
    }
    return tokensFromChapter(chapter, lang);
  }, [chapter, book?.manifest.language, mode, syncAvailable]);

  const onRsvpProgress = useCallback(
    (wordIndex: number) => {
      setRsvpWordIndex(wordIndex);
      if (!bookId) return;
      const now = Date.now();
      if (now - lastRsvpSaveRef.current < 2000) return;
      lastRsvpSaveRef.current = now;
      saveRsvpPosition(bookId, { chapterIdx, wordIndex });
      if (mode === 'rsvp' && syncAvailable) {
        savePosition(bookId, { chapterIdx, currentTime: player.currentTime });
      }
    },
    [bookId, chapterIdx, mode, syncAvailable, player],
  );

  const onRsvpSettingsChange = useCallback((next: RsvpSettings) => {
    setRsvpSettings(next);
    saveRsvpSettings(next);
  }, []);

  const onRsvpChapterComplete = useCallback(() => {
    if (!book) return;
    if (chapterIdx < book.manifest.chapters.length - 1) {
      const next = chapterIdx + 1;
      openChapterRsvp(next, 0);
      if (bookId) saveRsvpPosition(bookId, { chapterIdx: next, wordIndex: 0 });
    }
  }, [book, chapterIdx, openChapterRsvp, bookId]);

  // RSVP + audio: advance chapter when audio ends
  useEffect(() => {
    if (mode !== 'rsvp' || !syncAvailable) {
      if (mode === 'rsvp') wasPlayingRef.current = playing;
      return;
    }
    const finished = wasPlayingRef.current && !playing && duration > 0 && t >= duration - 0.3;
    wasPlayingRef.current = playing;
    if (finished) onRsvpChapterComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, t, duration, mode, syncAvailable, onRsvpChapterComplete]);

  const toggleRsvpAudioSync = useCallback(async () => {
    // Reload / re-attach media (also recovers from stale audioSync:false)
    const ok = await openChapterRsvp(chapterIdx, rsvpWordIndex);
    if (rsvpSettings) {
      const updated = { ...rsvpSettings, audioSync: ok };
      setRsvpSettings(updated);
      saveRsvpSettings(updated);
    }
  }, [rsvpSettings, openChapterRsvp, chapterIdx, rsvpWordIndex]);

  const rsvpPlayPause = useCallback(() => {
    if (!syncAvailable) return;
    if (playing) player.pause();
    else {
      try {
        player.play();
      } catch {
        setTimeout(() => { try { player.play(); } catch {} }, 300);
      }
    }
  }, [playing, player, syncAvailable]);

  const rsvpStep = useCallback((deltaChunks: number) => {
    if (!timings) return;
    const size = rsvpSettings?.chunkSize ?? 1;
    const next = Math.max(0, Math.min((timings.totalWords || 1) - 1, syncIndex + deltaChunks * size));
    const seek = timings.timeAtFlatWord(next);
    if (seek != null) player.seekTo(seek);
  }, [timings, rsvpSettings?.chunkSize, syncIndex, player]);

  const switchMode = async (next: ReaderMode) => {
    if (next === mode) return;
    setMode(next);
    saveReaderMode(next);

    if (next === 'rsvp') {
      await openChapterRsvp(chapterIdx, rsvpWordIndex);
      return;
    }

    await openChapterAudio(chapterIdx, false);
  };

  const onLongPressWord = useCallback(async (word: string, x: number, y: number) => {
    setDefinition({ word, text: '...', x, y });
    setDefLoading(true);
    const def = await lookupWord(word);
    setDefLoading(false);
    if (def) {
      const text = `${def.partOfSpeech ? `(${def.partOfSpeech}) ` : ''}${def.definition}`;
      setDefinition({ word: def.word, text, x, y });
    } else {
      setDefinition({ word, text: 'No definition found', x, y });
    }
    setTimeout(() => setDefinition(null), 3000);
  }, []);

  const seekBy = (delta: number) => {
    void player.seekTo(Math.max(0, Math.min(player.currentTime + delta, player.duration || 0)));
  };

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    speedRef.current = SPEEDS[next];
    player.setPlaybackRate(SPEEDS[next]);
    if (bookId) saveSpeed(bookId, SPEEDS[next]);
  };

  const toggleSleep = () => {
    if (sleepRemaining != null) { setSleepRemaining(null); return; }
    setSleepRemaining(SLEEP_OPTIONS[0]);
  };

  const cycleSleep = () => {
    if (sleepRemaining == null) return;
    const idx = SLEEP_OPTIONS.indexOf(sleepRemaining);
    setSleepRemaining(SLEEP_OPTIONS[(idx + 1) % SLEEP_OPTIONS.length]);
  };

  const goHome = () => {
    try { player.pause(); } catch {}
    if (bookId) {
      if (mode === 'audio') {
        savePosition(bookId, { chapterIdx, currentTime: t });
      } else {
        saveRsvpPosition(bookId, { chapterIdx, wordIndex: rsvpWordIndex });
      }
    }
    router.replace('/bookshelf');
  };

  const pickChapter = (i: number) => {
    setPickerOpen(false);
    if (mode === 'rsvp') {
      openChapterRsvp(i, 0);
      if (bookId) saveRsvpPosition(bookId, { chapterIdx: i, wordIndex: 0 });
    } else {
      openChapterAudio(i, playing);
    }
  };

  if (error && !book) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
        <Text style={[styles.errorTitle, { color: colors.accent }]}>Could not load book</Text>
        <Text style={[styles.errorBody, { color: colors.muted }]}>{error}</Text>
        <Pressable style={[styles.btn, { borderColor: colors.fg }]} onPress={() => { setError(null); loadBook(manifestUrl).then(setBook).catch((e) => setError(String(e?.message ?? e))); }}>
          <Text style={[styles.btnText, { color: colors.fg }]}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!book || !rsvpSettings) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={[styles.dim, { color: colors.muted }]}>Loading...</Text>
      </SafeAreaView>
    );
  }

  const chapterMeta = book.manifest.chapters.find((c) => c.index === chapterIdx);
  const progress = duration > 0 ? t / duration : 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <View style={[styles.topbar, chromeFocus && styles.topbarFocus]} pointerEvents={chromeFocus ? 'none' : 'auto'}>
        <Pressable onPress={goHome} hitSlop={8}>
          <Text style={[styles.brand, { color: colors.fg }]}>
            Lumina <Text style={{ color: colors.accent }}>RSVP</Text>
          </Text>
        </Pressable>
        <View style={styles.topbarRight}>
          <Pressable onPress={() => switchMode(mode === 'rsvp' ? 'audio' : 'rsvp')} hitSlop={8}>
            <Text style={[styles.editBtn, { color: colors.muted }]}>
              {mode === 'rsvp' ? 'Audio' : 'RSVP'}
            </Text>
          </Pressable>
          <Pressable onPress={() => setPickerOpen(true)} hitSlop={8}>
            <Text style={[styles.editBtn, { color: colors.muted }]} numberOfLines={1}>
              {(chapterMeta?.title ?? chapter?.title ?? 'Chapter').replace(/^CHAPTER\s+/i, '')}
            </Text>
          </Pressable>
        </View>
      </View>

      {mode === 'rsvp' ? (
        loadingChapter ? (
          <View style={styles.centerFlex}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.dim, { color: colors.muted }]}>Loading chapter...</Text>
          </View>
        ) : (
          <RsvpView
            tokens={tokens}
            settings={rsvpSettings}
            onSettingsChange={onRsvpSettingsChange}
            onChapterComplete={onRsvpChapterComplete}
            onProgress={onRsvpProgress}
            initialIndex={rsvpWordIndex}
            fontSize={fontSize}
            chapterKey={`${bookId}:${chapterIdx}`}
            onFocusChange={setChromeFocus}
            audioSync={{
              available: true,
              active: syncAvailable,
              externalIndex: syncIndex,
              playing,
              speedLabel: `${SPEEDS[speedIdx]}×`,
              onToggle: () => { void toggleRsvpAudioSync(); },
              onPlayPause: rsvpPlayPause,
              onCycleSpeed: cycleSpeed,
              onStep: rsvpStep,
            }}
          />
        )
      ) : (
        <>
          <View style={styles.progressRow}>
            <Text style={[styles.dim, { color: colors.muted }]}>{fmtTime(t)}</Text>
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
              <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: colors.fg }]} />
            </View>
            <Text style={[styles.dim, { color: colors.muted }]}>{fmtTime(duration)}</Text>
          </View>
          <View style={[styles.body, { backgroundColor: colors.bg }]}>
            <ScrollView
              style={{ flex: 1, backgroundColor: colors.bg }}
              contentContainerStyle={styles.scrollContent}
            >
              {loadingChapter && !audioReady ? (
                <View style={{ alignItems: 'center', marginTop: 40, gap: 8 }}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={[styles.dim, { color: colors.muted }]}>Loading chapter...</Text>
                </View>
              ) : (
                paragraphs.map((sents, pi) => (
                  <Text key={pi} style={[styles.paragraph, { color: colors.fg, fontSize, lineHeight: fontSize * 1.65 }]}>
                    {sents.map((text, si) => {
                      const words = text.split(/(\s+)/);
                      return (
                        <React.Fragment key={si}>
                          {words.map((w, wi) =>
                            /^\s+$/.test(w) ? (
                              <Text key={wi}>{w}</Text>
                            ) : (
                              <Text
                                key={wi}
                                onLongPress={(e) => onLongPressWord(w, e.nativeEvent.pageX, e.nativeEvent.pageY)}
                                suppressHighlighting
                              >
                                {w}
                              </Text>
                            ),
                          )}
                          {si < sents.length - 1 ? ' ' : ''}
                        </React.Fragment>
                      );
                    })}
                  </Text>
                ))
              )}
            </ScrollView>
            {buffering && audioReady && (
              <View style={[styles.bufferOverlay, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <ActivityIndicator color={colors.accent} size="small" />
                <Text style={[styles.dim, { color: colors.muted }]}>Buffering...</Text>
              </View>
            )}
          </View>

          <View style={[styles.controls, { borderTopColor: colors.border }]}>
            <Pressable style={[styles.iconBtn, { borderColor: colors.border }]} onPress={() => seekBy(-15)}>
              <Text style={[styles.btnText, { color: colors.fg }]}>-15s</Text>
            </Pressable>
            <Pressable style={[styles.iconBtn, styles.playBtn, { borderColor: colors.fg }]} onPress={() => (playing ? player.pause() : player.play())}>
              <Text style={[styles.btnText, { color: colors.fg }]}>{playing ? '❚❚' : '▶'}</Text>
            </Pressable>
            <Pressable style={[styles.iconBtn, { borderColor: colors.border }]} onPress={() => seekBy(15)}>
              <Text style={[styles.btnText, { color: colors.fg }]}>+15s</Text>
            </Pressable>
            <Pressable style={[styles.iconBtn, { borderColor: colors.border }]} onPress={cycleSpeed}>
              <Text style={[styles.btnText, { color: colors.fg }]}>{SPEEDS[speedIdx]}×</Text>
            </Pressable>
            <Pressable style={[styles.iconBtn, { borderColor: sleepRemaining != null ? colors.accent : colors.border }]} onPress={toggleSleep} onLongPress={cycleSleep}>
              <Text style={[styles.btnText, { color: colors.fg }]}>{sleepRemaining != null ? `${sleepRemaining}'` : '☾'}</Text>
            </Pressable>
          </View>
        </>
      )}

      {definition && (
        <View
          style={[styles.defBox, { backgroundColor: colors.surface, borderColor: colors.accent, top: definition.y + 20, left: Math.max(20, Math.min(definition.x - 100, 9999)) }]}
          pointerEvents="none"
        >
          <Text style={[styles.defWord, { color: colors.accent }]}>{definition.word}</Text>
          <Text style={[styles.defText, { color: colors.fg }]}>
            {defLoading ? 'Looking up...' : definition.text}
          </Text>
        </View>
      )}

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.fg }]}>Chapters</Text>
            <ScrollView>
              {book.manifest.chapters.map((c) => (
                <Pressable
                  key={c.index}
                  style={[styles.chapterRow, c.index === chapterIdx && { backgroundColor: colors.bg }]}
                  onPress={() => pickChapter(c.index)}
                >
                  <Text style={[styles.chapterRowText, { color: colors.fg }]}>{c.title}</Text>
                  <Text style={[styles.dim, { color: colors.muted }]}>{fmtTime(c.duration)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  centerFlex: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 8, gap: 12 },
  topbarFocus: { opacity: 0.12 },
  brand: { fontFamily: Fonts.display, fontSize: 18, letterSpacing: -0.3 },
  topbarRight: { flexDirection: 'row', alignItems: 'center', gap: 16, flexShrink: 1 },
  editBtn: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', maxWidth: 180 },
  dim: { fontSize: 12 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  progressBar: { flex: 1, height: 2, borderRadius: 1, overflow: 'hidden' },
  progressFill: { height: 2, borderRadius: 1 },
  body: { flex: 1 },
  scrollContent: { paddingTop: 14, paddingBottom: 40 },
  paragraph: { fontFamily: Fonts.display, marginBottom: 18 },
  bufferOverlay: { position: 'absolute', top: 10, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4, borderWidth: 1 },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 12, borderTopWidth: 1, flexWrap: 'wrap' },
  iconBtn: { minWidth: 44, minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 4, backgroundColor: 'transparent' },
  playBtn: { width: 56, height: 56, minWidth: 56 },
  btn: { borderWidth: 1, borderRadius: 4, paddingVertical: 10, paddingHorizontal: 16, minWidth: 48, alignItems: 'center' },
  btnText: { fontSize: 14 },
  defBox: { position: 'absolute', right: 20, maxWidth: 280, borderRadius: 6, padding: 14, borderWidth: 1 },
  defWord: { fontFamily: Fonts.display, fontSize: 16, marginBottom: 4 },
  defText: { fontSize: 14, lineHeight: 20 },
  errorTitle: { fontFamily: Fonts.display, fontSize: 17 },
  errorBody: { fontSize: 12, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(42,34,24,0.35)', justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: 6, borderTopRightRadius: 6, padding: 24, maxHeight: '70%', borderWidth: 1 },
  modalTitle: { fontFamily: Fonts.display, fontSize: 24, marginBottom: 12 },
  chapterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 8, borderRadius: 4, gap: 12 },
  chapterRowText: { fontSize: 15, flex: 1, fontFamily: Fonts.display },
});
