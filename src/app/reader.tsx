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
import { audioUrlFor, loadBook, loadTimings } from '@/lib/api';
import { manifestUrlFor } from '@/lib/config';
import { lookupWord } from '@/lib/dictionary';
import { alignmentTokensFromChapter, tokensFromChapter } from '@/lib/rsvp';
import {
  loadFontSize,
  loadPosition,
  loadReaderMode,
  loadRsvpPosition,
  loadRsvpSettings,
  loadSpeed,
  saveFontSize,
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

  const player = useAudioPlayer(null, { updateInterval: 250 });

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
    const needTick =
      mode === 'audio' || (mode === 'rsvp' && !!rsvpSettings?.audioSync && syncAvailable);
    if (!needTick) return;
    const id = setInterval(() => setTick((v) => v + 1), 100);
    return () => clearInterval(id);
  }, [mode, rsvpSettings?.audioSync, syncAvailable]);

  const speedRef = useRef(SPEEDS[1]);
  const wasPlayingRef = useRef(false);
  const restoredRef = useRef(false);
  const lastSaveRef = useRef(0);
  const lastRsvpSaveRef = useRef(0);

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
    async (i: number, wordIndex = 0, withSync?: boolean): Promise<boolean> => {
      if (!book) return false;
      const wantSync = withSync ?? rsvpSettings?.audioSync ?? true;
      setLoadingChapter(true);
      setError(null);
      setTimings(null);
      setSyncAvailable(false);
      try {
        setChapterIdx(i);
        setRsvpWordIndex(wordIndex);
        setSyncIndex(wordIndex);
        if (!wantSync) {
          try { player.pause(); } catch {}
          setAudioReady(false);
          return false;
        }
        try {
          const tj = await loadTimings(manifestUrl, i, book.manifest);
          const idx = new TimingIndex(tj);
          setTimings(idx);
          player.replace({ uri: audioUrlFor(manifestUrl, i, book.manifest) });
          player.setPlaybackRate(speedRef.current);
          const seekTo = idx.timeAtFlatWord(wordIndex) ?? 0;
          setAudioReady(true);
          setSyncAvailable(true);
          setTimeout(() => {
            player.seekTo(seekTo);
            setBuffering(false);
          }, 600);
          return true;
        } catch {
          setSyncAvailable(false);
          setAudioReady(false);
          setTimings(null);
          return false;
        }
      } finally {
        setLoadingChapter(false);
      }
    },
    [book, rsvpSettings?.audioSync, player, manifestUrl],
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

  // Drive RSVP flash from audio word timings
  useEffect(() => {
    if (mode !== 'rsvp' || !rsvpSettings?.audioSync || !timings || !syncAvailable) return;
    const flat = timings.flatWordAt(t);
    setSyncIndex(flat);
    setRsvpWordIndex(flat);
  }, [t, mode, rsvpSettings?.audioSync, timings, syncAvailable]);

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
    if (mode === 'rsvp' && rsvpSettings?.audioSync && syncAvailable) {
      return alignmentTokensFromChapter(chapter, lang);
    }
    return tokensFromChapter(chapter, lang);
  }, [chapter, book?.manifest.language, mode, rsvpSettings?.audioSync, syncAvailable]);

  const onRsvpProgress = useCallback(
    (wordIndex: number) => {
      setRsvpWordIndex(wordIndex);
      if (!bookId) return;
      const now = Date.now();
      if (now - lastRsvpSaveRef.current < 2000) return;
      lastRsvpSaveRef.current = now;
      saveRsvpPosition(bookId, { chapterIdx, wordIndex });
      if (mode === 'rsvp' && rsvpSettings?.audioSync && syncAvailable) {
        savePosition(bookId, { chapterIdx, currentTime: player.currentTime });
      }
    },
    [bookId, chapterIdx, mode, rsvpSettings?.audioSync, syncAvailable, player],
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

  // RSVP + audio sync: advance chapter when audio ends
  useEffect(() => {
    if (mode !== 'rsvp' || !rsvpSettings?.audioSync || !syncAvailable) {
      if (mode === 'rsvp') wasPlayingRef.current = playing;
      return;
    }
    const finished = wasPlayingRef.current && !playing && duration > 0 && t >= duration - 0.3;
    wasPlayingRef.current = playing;
    if (finished) onRsvpChapterComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, t, duration, mode, rsvpSettings?.audioSync, syncAvailable, onRsvpChapterComplete]);

  const toggleRsvpAudioSync = useCallback(async () => {
    if (!rsvpSettings) return;
    const currentlyOn = rsvpSettings.audioSync && syncAvailable;
    if (currentlyOn) {
      const updated = { ...rsvpSettings, audioSync: false };
      setRsvpSettings(updated);
      saveRsvpSettings(updated);
      try { player.pause(); } catch {}
      return;
    }
    const ok = await openChapterRsvp(chapterIdx, rsvpWordIndex, true);
    const updated = { ...rsvpSettings, audioSync: ok };
    setRsvpSettings(updated);
    saveRsvpSettings(updated);
  }, [rsvpSettings, syncAvailable, openChapterRsvp, chapterIdx, rsvpWordIndex, player]);

  const rsvpPlayPause = useCallback(() => {
    if (playing) player.pause();
    else player.play();
  }, [playing, player]);

  const switchMode = async (next: ReaderMode) => {
    if (next === mode) return;
    setMode(next);
    saveReaderMode(next);

    if (next === 'rsvp') {
      try { player.pause(); } catch {}
      if (bookId) saveRsvpPosition(bookId, { chapterIdx, wordIndex: rsvpWordIndex });
      return;
    }

    // Entering audio: load current chapter audio
    const seek = undefined;
    await openChapterAudio(chapterIdx, false, seek);
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

  const adjustFont = (delta: number) => {
    const next = Math.max(13, Math.min(28, fontSize + delta));
    setFontSize(next);
    saveFontSize(next);
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
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorTitle}>Could not load book</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Pressable style={styles.btn} onPress={() => { setError(null); loadBook(manifestUrl).then(setBook).catch((e) => setError(String(e?.message ?? e))); }}>
          <Text style={styles.btnText}>Retry</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!book || !rsvpSettings) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color="#F5C518" size="large" />
        <Text style={styles.dim}>Loading...</Text>
      </SafeAreaView>
    );
  }

  const chapterMeta = book.manifest.chapters.find((c) => c.index === chapterIdx);
  const progress = duration > 0 ? t / duration : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable style={styles.homeBtn} onPress={goHome}>
            <Text style={styles.homeBtnText}>⌂</Text>
          </Pressable>
          <Text style={styles.bookTitle} numberOfLines={1}>{book.manifest.title}</Text>
          <Pressable style={styles.homeBtn} onPress={() => adjustFont(-1)}>
            <Text style={styles.homeBtnText}>A−</Text>
          </Pressable>
          <Pressable style={styles.homeBtn} onPress={() => adjustFont(1)}>
            <Text style={styles.homeBtnText}>A+</Text>
          </Pressable>
        </View>

        <View style={styles.modeRow}>
          <Pressable
            style={[styles.modeBtn, mode === 'rsvp' && styles.modeBtnActive]}
            onPress={() => switchMode('rsvp')}
          >
            <Text style={[styles.modeBtnText, mode === 'rsvp' && styles.modeBtnTextActive]}>RSVP</Text>
          </Pressable>
          <Pressable
            style={[styles.modeBtn, mode === 'audio' && styles.modeBtnActive]}
            onPress={() => switchMode('audio')}
          >
            <Text style={[styles.modeBtnText, mode === 'audio' && styles.modeBtnTextActive]}>Audio</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => setPickerOpen(true)}>
          <Text style={styles.chapterTitle} numberOfLines={1}>
            {chapterMeta?.title ?? chapter?.title ?? ''} ▾
          </Text>
        </Pressable>

        {mode === 'audio' && (
          <View style={styles.progressRow}>
            <Text style={styles.dim}>{fmtTime(t)}</Text>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
            <Text style={styles.dim}>{fmtTime(duration)}</Text>
          </View>
        )}
      </View>

      {mode === 'rsvp' ? (
        loadingChapter ? (
          <View style={styles.centerFlex}>
            <ActivityIndicator color="#F5C518" />
            <Text style={styles.dim}>Loading chapter...</Text>
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
            audioSync={{
              available: true,
              active: !!rsvpSettings.audioSync && syncAvailable,
              externalIndex: syncIndex,
              playing,
              speedLabel: `${SPEEDS[speedIdx]}×`,
              onToggle: () => { void toggleRsvpAudioSync(); },
              onPlayPause: rsvpPlayPause,
              onCycleSpeed: cycleSpeed,
            }}
          />
        )
      ) : (
        <>
          <View style={styles.body}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
            >
              {loadingChapter && !audioReady ? (
                <View style={{ alignItems: 'center', marginTop: 40, gap: 8 }}>
                  <ActivityIndicator color="#F5C518" />
                  <Text style={styles.dim}>Loading chapter...</Text>
                </View>
              ) : (
                paragraphs.map((sents, pi) => (
                  <Text key={pi} style={[styles.paragraph, { fontSize, lineHeight: fontSize * 1.65 }]}>
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
              <View style={styles.bufferOverlay}>
                <ActivityIndicator color="#F5C518" size="small" />
                <Text style={styles.dim}>Buffering...</Text>
              </View>
            )}
          </View>

          <View style={styles.controls}>
            <Pressable style={styles.btn} onPress={() => seekBy(-15)}>
              <Text style={styles.btnText}>-15s</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.playBtn]} onPress={() => (playing ? player.pause() : player.play())}>
              <Text style={[styles.btnText, styles.playText]}>{playing ? '❚❚' : '▶'}</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={() => seekBy(15)}>
              <Text style={styles.btnText}>+15s</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={cycleSpeed}>
              <Text style={styles.btnText}>{SPEEDS[speedIdx]}×</Text>
            </Pressable>
            <Pressable style={[styles.btn, sleepRemaining != null && styles.sleepBtnActive]} onPress={toggleSleep} onLongPress={cycleSleep}>
              <Text style={styles.btnText}>{sleepRemaining != null ? `${sleepRemaining}'` : '☾'}</Text>
            </Pressable>
          </View>
        </>
      )}

      {definition && (
        <View
          style={[styles.defBox, { top: definition.y + 20, left: Math.max(20, Math.min(definition.x - 100, 9999)) }]}
          pointerEvents="none"
        >
          <Text style={styles.defWord}>{definition.word}</Text>
          <Text style={styles.defText}>
            {defLoading ? 'Looking up...' : definition.text}
          </Text>
        </View>
      )}

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Chapters</Text>
            <ScrollView>
              {book.manifest.chapters.map((c) => (
                <Pressable
                  key={c.index}
                  style={[styles.chapterRow, c.index === chapterIdx && styles.chapterRowActive]}
                  onPress={() => pickChapter(c.index)}
                >
                  <Text style={styles.chapterRowText}>{c.title}</Text>
                  <Text style={styles.dim}>{fmtTime(c.duration)}</Text>
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
  container: { flex: 1, backgroundColor: '#0B0F14' },
  center: { flex: 1, backgroundColor: '#0B0F14', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  centerFlex: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  header: { paddingHorizontal: 16, paddingVertical: 10, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2A323D' },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  homeBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#1A2230', alignItems: 'center', justifyContent: 'center' },
  homeBtnText: { color: '#E8E6DF', fontSize: 16 },
  bookTitle: { color: '#F5C518', fontSize: 13, fontWeight: '600', letterSpacing: 0.4, flex: 1 },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeBtn: {
    flex: 1,
    backgroundColor: '#1A2230',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  modeBtnActive: { backgroundColor: '#F5C518' },
  modeBtnText: { color: '#7D8590', fontSize: 13, fontWeight: '700' },
  modeBtnTextActive: { color: '#111111' },
  chapterTitle: { color: '#E8E6DF', fontSize: 17, fontWeight: '700' },
  dim: { color: '#7D8590', fontSize: 12 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressBar: { flex: 1, height: 3, backgroundColor: '#2A323D', borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: '#F5C518', borderRadius: 2 },
  body: { flex: 1, backgroundColor: '#0B0F14' },
  scroll: { flex: 1, backgroundColor: '#0B0F14' },
  scrollContent: { backgroundColor: '#0B0F14', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 40 },
  paragraph: { color: '#D8D5CC', fontFamily: 'serif', marginBottom: 18 },
  bufferOverlay: { position: 'absolute', top: 10, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1A2230', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  controls: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#2A323D' },
  btn: { backgroundColor: '#1A2230', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, minWidth: 48, alignItems: 'center' },
  btnText: { color: '#E8E6DF', fontSize: 14, fontWeight: '600' },
  playBtn: { backgroundColor: '#F5C518', minWidth: 60 },
  playText: { color: '#111111', fontSize: 16 },
  sleepBtnActive: { backgroundColor: '#5B3A8C' },
  defBox: { position: 'absolute', right: 20, maxWidth: 280, backgroundColor: '#1A2230', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#F5C518', elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8 },
  defWord: { color: '#F5C518', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  defText: { color: '#E8E6DF', fontSize: 14, lineHeight: 20 },
  errorTitle: { color: '#FF7B72', fontSize: 17, fontWeight: '700' },
  errorBody: { color: '#FF7B72', fontSize: 12, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#131A24', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '70%' },
  modalTitle: { color: '#E8E6DF', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  chapterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8, gap: 12 },
  chapterRowActive: { backgroundColor: '#1A2230' },
  chapterRowText: { color: '#E8E6DF', fontSize: 14, flex: 1 },
});
