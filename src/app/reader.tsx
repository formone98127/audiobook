import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { router, useLocalSearchParams } from 'expo-router';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Directions, Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { audioUrlFor, loadBook, loadTimings } from '@/lib/api';
import { manifestUrlFor } from '@/lib/config';
import { lookupWord } from '@/lib/dictionary';
import { loadFontSize, loadPosition, loadSpeed, saveFontSize, savePosition, saveSpeed } from '@/lib/storage';
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

const CLAUSE_SPLIT = /([:;,\.\!\?\-—"'()\[\]])/;

type SentenceProps = {
  si: number;
  text: string;
  activeSentence: number;
  activeWord: number;
  timings: TimingIndex;
  onSeek: (t: number) => void;
  fontSize: number;
  onLongPressWord: (word: string, x: number, y: number) => void;
};

/** Split sentence into clauses at punctuation, tracking word offset for each clause. */
function splitClauses(text: string): { text: string; wordCount: number }[] {
  const parts = text.split(CLAUSE_SPLIT);
  const clauses: { text: string; wordCount: number }[] = [];
  let cur = '';
  let curWords = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isPunct = /^[:;,\.\!\?\-—"'()\[\]]$/.test(part);
    if (isPunct) {
      cur += part;
      const wc = cur.trim().split(/\s+/).filter(Boolean).length;
      clauses.push({ text: cur, wordCount: wc });
      cur = '';
      curWords = 0;
    } else {
      cur += part;
      curWords = cur.trim().split(/\s+/).filter(Boolean).length;
    }
  }
  if (cur.trim()) {
    clauses.push({ text: cur, wordCount: curWords });
  }
  return clauses;
}

const Sentence = memo(function Sentence({ si, text, activeSentence, activeWord, onSeek, timings, fontSize, onLongPressWord }: SentenceProps) {
  const isActive = si === activeSentence;
  const clauses = useMemo(() => splitClauses(text), [text]);

  let activeClause = -1;
  if (isActive && activeWord >= 0) {
    let acc = 0;
    for (let ci = 0; ci < clauses.length; ci++) {
      acc += clauses[ci].wordCount;
      if (activeWord < acc) { activeClause = ci; break; }
    }
  }

  return (
    <Text
      style={[isActive ? styles.sentenceActive : undefined, { fontSize }]}
      onPress={() => {
        const start = timings.sentenceStartOf(si);
        if (start != null) onSeek(start + 0.001);
      }}
    >
      {clauses.map((c, ci) => {
        const words = c.text.split(/(\s+)/);
        return (
          <Text
            key={ci}
            style={isActive && ci === activeClause ? styles.clauseActive : undefined}
          >
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
              )
            )}
          </Text>
        );
      })}
    </Text>
  );
});

type ParagraphProps = {
  sentences: { si: number; text: string }[];
  activeSentence: number;
  activeWord: number;
  timings: TimingIndex;
  onSeek: (t: number) => void;
  fontSize: number;
  onLayoutY: (y: number, h: number) => void;
  onLongPressWord: (word: string, x: number, y: number) => void;
};

const Paragraph = memo(function Paragraph({ sentences, activeSentence, activeWord, timings, onSeek, fontSize, onLayoutY, onLongPressWord }: ParagraphProps) {
  return (
    <View onLayout={(e) => onLayoutY(e.nativeEvent.layout.y, e.nativeEvent.layout.height)}>
      <Text style={[styles.paragraph, { fontSize, lineHeight: fontSize * 1.65 }]}>
        {sentences.map((s) => (
          <React.Fragment key={s.si}>
            <Sentence
              si={s.si}
              text={s.text}
              activeSentence={activeSentence}
              activeWord={activeWord}
              timings={timings}
              onSeek={onSeek}
              fontSize={fontSize}
              onLongPressWord={onLongPressWord}
            />{' '}
          </React.Fragment>
        ))}
      </Text>
    </View>
  );
});

export default function ReaderScreen() {
  const { bookId, chapter: chapterParam } = useLocalSearchParams<{ bookId: string; chapter?: string }>();
  const manifestUrl = bookId ? manifestUrlFor(bookId) : '';
  const initialChapter = chapterParam ? parseInt(chapterParam, 10) : 0;

  const [book, setBook] = useState<{ manifest: Manifest; text: BookText } | null>(null);
  const [chapterIdx, setChapterIdx] = useState(0);
  const [timings, setTimings] = useState<TimingIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingChapter, setLoadingChapter] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [sleepRemaining, setSleepRemaining] = useState<number | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [definition, setDefinition] = useState<{ word: string; text: string; x: number; y: number } | null>(null);
  const [defLoading, setDefLoading] = useState(false);

  const player = useAudioPlayer(null, { updateInterval: 50 });

  useEffect(() => () => { try { player.pause(); } catch {} }, [player]);

  // Enable background playback
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    });
  }, []);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 50);
    return () => clearInterval(id);
  }, []);

  const scrollRef = useRef<ScrollView>(null);
  const paragraphY = useRef<Map<number, { y: number; h: number }>>(new Map());
  const speedRef = useRef(SPEEDS[1]);
  const wasPlayingRef = useRef(false);
  const restoredRef = useRef(false);
  const lastSaveRef = useRef(0);

  useEffect(() => { loadFontSize().then((s) => { if (s) setFontSize(s); }); }, []);

  useEffect(() => {
    if (!manifestUrl) return;
    loadBook(manifestUrl).then(setBook).catch((e) => setError(String(e?.message ?? e)));
  }, [manifestUrl]);

  const openChapter = useCallback(
    async (i: number, autoplay: boolean, seekTo?: number) => {
      if (!book) return;
      setLoadingChapter(true);
      setBuffering(true);
      setError(null);
      try {
        const tj = await loadTimings(manifestUrl, i, book.manifest);
        setTimings(new TimingIndex(tj));
        setChapterIdx(i);
        paragraphY.current.clear();
        scrollRef.current?.scrollTo({ y: 0, animated: false });
        player.replace({ uri: audioUrlFor(manifestUrl, i, book.manifest) });
        player.setPlaybackRate(speedRef.current);
        if (seekTo != null) {
          setTimeout(() => { player.seekTo(seekTo); setBuffering(false); if (autoplay) player.play(); }, 800);
        } else if (autoplay) {
          setTimeout(() => { player.play(); setBuffering(false); }, 1000);
        } else {
          setTimeout(() => setBuffering(false), 800);
        }
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoadingChapter(false);
      }
    },
    [book, player, manifestUrl],
  );

  useEffect(() => {
    if (!book || restoredRef.current) return;
    restoredRef.current = true;
    (async () => {
      if (bookId && initialChapter === 0) {
        const saved = await loadPosition(bookId);
        if (saved) {
          openChapter(saved.chapterIdx, true, Math.max(0, saved.currentTime - 15));
          return;
        }
      }
      openChapter(initialChapter, true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book]);

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
    if (!bookId || !playing || duration <= 0) return;
    const now = Date.now();
    if (now - lastSaveRef.current < 5000) return;
    lastSaveRef.current = now;
    savePosition(bookId, { chapterIdx, currentTime: t });
  }, [t, playing, duration, bookId, chapterIdx]);

  useEffect(() => {
    const finished = wasPlayingRef.current && !playing && duration > 0 && t >= duration - 0.3;
    wasPlayingRef.current = playing;
    if (finished && book && chapterIdx < book.manifest.chapters.length - 1) {
      openChapter(chapterIdx + 1, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, t, duration]);

  useEffect(() => {
    if (sleepRemaining == null) return;
    if (sleepRemaining <= 0) { player.pause(); setSleepRemaining(null); return; }
    const id = setTimeout(() => setSleepRemaining((s) => (s ?? 0) - 1), 1000);
    return () => clearTimeout(id);
  }, [sleepRemaining, player]);

  const chapter: BookChapter | undefined = book?.text.chapters.find((c) => c.index === chapterIdx);

  const { paragraphs, sentToPara } = useMemo(() => {
    const paragraphs: { si: number; text: string }[][] = [];
    const sentToPara: number[] = [];
    let si = 0;
    for (const p of chapter?.paragraphs ?? []) {
      const row: { si: number; text: string }[] = [];
      for (const s of p.sentences) {
        row.push({ si, text: s.text });
        sentToPara[si] = paragraphs.length;
        si++;
      }
      paragraphs.push(row);
    }
    return { paragraphs, sentToPara };
  }, [chapter]);

  const activeSentence = timings ? timings.sentenceAt(t) : -1;
  const activeWord = timings && activeSentence >= 0 ? timings.wordAt(activeSentence, t) : -1;

  const scrollYRef = useRef(0);
  const viewportHRef = useRef(1);
  useEffect(() => {
    if (!playing || activeSentence < 0) return;
    const pi = sentToPara[activeSentence];
    const meta = paragraphY.current.get(pi);
    if (meta == null) return;
    const row = paragraphs[pi];
    const idxInPara = Math.max(0, row.findIndex((s) => s.si === activeSentence));
    const approxY = meta.y + meta.h * (row.length > 1 ? idxInPara / row.length : 0);
    const vh = viewportHRef.current;
    const top = scrollYRef.current;
    if (approxY < top + vh * 0.35 || approxY > top + vh * 0.55) {
      scrollRef.current?.scrollTo({ y: Math.max(0, approxY - vh * 0.2), animated: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSentence, playing]);

  const onSeek = useCallback((sec: number) => void player.seekTo(sec), [player]);

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

  const stepSentence = useCallback(
    (delta: number) => {
      if (!timings) return;
      const cur = timings.sentenceAt(player.currentTime);
      const next = Math.max(0, Math.min(cur + delta, timings.sentenceCount - 1));
      void player.seekTo(timings.sentenceStartOf(next) + 0.001);
    },
    [timings, player],
  );

  const swipe = useMemo(
    () =>
      Gesture.Exclusive(
        Gesture.Fling().direction(Directions.LEFT).runOnJS(true).onEnd(() => stepSentence(1)),
        Gesture.Fling().direction(Directions.RIGHT).runOnJS(true).onEnd(() => stepSentence(-1)),
      ),
    [stepSentence],
  );

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
    player.pause();
    if (bookId) savePosition(bookId, { chapterIdx, currentTime: t });
    router.replace('/bookshelf');
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

  if (!book) {
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
        <Pressable onPress={() => setPickerOpen(true)}>
          <Text style={styles.chapterTitle} numberOfLines={1}>
            {chapterMeta?.title ?? chapter?.title ?? ''} ▾
          </Text>
        </Pressable>
        <View style={styles.progressRow}>
          <Text style={styles.dim}>{fmtTime(t)}</Text>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.dim}>{fmtTime(duration)}</Text>
        </View>
      </View>

      <GestureDetector gesture={swipe}>
        <View style={styles.body}>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            onScroll={(e) => (scrollYRef.current = e.nativeEvent.contentOffset.y)}
            scrollEventThrottle={100}
            onLayout={(e) => (viewportHRef.current = e.nativeEvent.layout.height)}
          >
            {loadingChapter || !timings ? (
              <View style={{ alignItems: 'center', marginTop: 40, gap: 8 }}>
                <ActivityIndicator color="#F5C518" />
                <Text style={styles.dim}>Loading chapter...</Text>
              </View>
            ) : (
              paragraphs.map((row, pi) => (
                <Paragraph
                  key={pi}
                  sentences={row}
                  activeSentence={activeSentence}
                  activeWord={activeWord}
                  timings={timings}
                  onSeek={onSeek}
                  fontSize={fontSize}
                  onLayoutY={(y, h) => paragraphY.current.set(pi, { y, h })}
                  onLongPressWord={onLongPressWord}
                />
              ))
            )}
          </ScrollView>
          {buffering && timings && (
            <View style={styles.bufferOverlay}>
              <ActivityIndicator color="#F5C518" size="small" />
              <Text style={styles.dim}>Buffering...</Text>
            </View>
          )}
        </View>
      </GestureDetector>

      <View style={styles.controls}>
        <Pressable style={styles.btn} onPress={() => stepSentence(-1)}>
          <Text style={styles.btnText}>|◀</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => seekBy(-15)}>
          <Text style={styles.btnText}>-15s</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.playBtn]} onPress={() => (playing ? player.pause() : player.play())}>
          <Text style={[styles.btnText, styles.playText]}>{playing ? '❚❚' : '▶'}</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => seekBy(15)}>
          <Text style={styles.btnText}>+15s</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => stepSentence(1)}>
          <Text style={styles.btnText}>▶|</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={cycleSpeed}>
          <Text style={styles.btnText}>{SPEEDS[speedIdx]}×</Text>
        </Pressable>
        <Pressable style={[styles.btn, sleepRemaining != null && styles.sleepBtnActive]} onPress={toggleSleep} onLongPress={cycleSleep}>
          <Text style={styles.btnText}>{sleepRemaining != null ? `${sleepRemaining}'` : '☾'}</Text>
        </Pressable>
      </View>

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
                  onPress={() => { setPickerOpen(false); openChapter(c.index, playing); }}
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
  header: { paddingHorizontal: 16, paddingVertical: 10, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2A323D' },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  homeBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#1A2230', alignItems: 'center', justifyContent: 'center' },
  homeBtnText: { color: '#E8E6DF', fontSize: 16 },
  bookTitle: { color: '#F5C518', fontSize: 13, fontWeight: '600', letterSpacing: 0.4, flex: 1 },
  chapterTitle: { color: '#E8E6DF', fontSize: 17, fontWeight: '700' },
  dim: { color: '#7D8590', fontSize: 12 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressBar: { flex: 1, height: 3, backgroundColor: '#2A323D', borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: '#F5C518', borderRadius: 2 },
  body: { flex: 1, backgroundColor: '#0B0F14' },
  scroll: { flex: 1, backgroundColor: '#0B0F14' },
  scrollContent: { backgroundColor: '#0B0F14', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 40 },
  paragraph: { color: '#D8D5CC', fontFamily: 'serif', marginBottom: 18 },
  sentenceActive: { backgroundColor: 'rgba(245,197,24,0.15)' },
  clauseActive: { backgroundColor: 'rgba(245,197,24,0.35)' },
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
