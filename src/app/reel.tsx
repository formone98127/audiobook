import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { ReelReader } from '@/components/ReelReader';
import { ThemeToggle } from '@/components/ThemeToggle';
import { audioUrlFor, loadBook, loadTimings } from '@/lib/api';
import { manifestUrlFor } from '@/lib/config';
import {
  loadFontSize,
  loadReelPosition,
  loadSpeed,
  savePosition,
  saveReelPosition,
  saveSpeed,
} from '@/lib/storage';
import { TimingIndex } from '@/lib/timing';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Fonts } from '@/constants/lumina';
import { useTheme } from '@/lib/theme';
import type { BookChapter, BookText, Manifest } from '@/lib/types';

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const DEFAULT_FONT_SIZE = 19;

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function ReelScreen() {
  const { colors } = useTheme();
  const { bookId, chapter: chapterParam } = useLocalSearchParams<{ bookId?: string; chapter?: string }>();
  const router = useRouter();

  const [book, setBook] = useState<{ manifest: Manifest; text: BookText } | null>(null);
  const [chapterIdx, setChapterIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [timings, setTimings] = useState<TimingIndex | null>(null);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [audioReady, setAudioReady] = useState(false);

  const player = useAudioPlayer(null, { updateInterval: 50 }); // Slower updates = less flicker
  const lastSyncedParaRef = useRef<number>(-1); // Track last synced paragraph to avoid loops

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    });
  }, []);

  useEffect(() => {
    loadFontSize().then((s) => { if (s) setFontSize(s); });
  }, []);

  useEffect(() => {
    if (!bookId) {
      setError('No book specified. Please provide a book ID in the URL.');
      return;
    }

    const manifestUrl = manifestUrlFor(bookId);
    const initialChapter = chapterParam ? parseInt(chapterParam, 10) : 0;

    setLoading(true);
    loadBook(manifestUrl)
      .then(async (bookData) => {
        setBook(bookData);

        // Try to restore saved position
        const saved = await loadReelPosition(bookId);
        const startChapter = saved ? saved.chapterIdx : initialChapter;
        const startSentence = saved ? saved.sentenceIndex : 0;

        setChapterIdx(startChapter);
        setSentenceIndex(startSentence);
        lastSyncedParaRef.current = startSentence;

        // Load audio and timings
        try {
          const tj = await loadTimings(manifestUrl, startChapter, bookData.manifest);
          console.log('=== TIMINGS LOADED ===', JSON.stringify(tj).substring(0, 500));
          const timingIndex = new TimingIndex(tj);
          console.log('=== TimingIndex created === sentenceCount:', timingIndex.sentenceCount, 'totalWords:', timingIndex.totalWords);
          setTimings(timingIndex);
          const uri = audioUrlFor(manifestUrl, startChapter, bookData.manifest);
          player.replace({ uri });
          setAudioReady(true);
          setTimeout(() => {
            try { player.play(); } catch {}
          }, 600);
        } catch {
          setAudioReady(false);
        }

        // Load speed preference
        loadSpeed(bookId).then((s) => {
          if (s != null) {
            const idx = SPEEDS.indexOf(s);
            if (idx >= 0) {
              setSpeedIdx(idx);
              player.setPlaybackRate(SPEEDS[idx]);
            }
          }
        });
      })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [bookId, chapterParam, player]);

  const t = player.currentTime;
  const playing = player.playing;
  const duration = player.duration || 0;
  const progress = duration > 0 ? t / duration : 0;

  const chapter: BookChapter | undefined = book?.text.chapters.find((c) => c.index === chapterIdx);

  const paragraphs = useMemo(() => {
    const paras: string[] = [];
    for (const p of chapter?.paragraphs ?? []) {
      const text = p.sentences.map(s => s.text).join(' ');
      if (text) paras.push(text);
    }
    return paras;
  }, [chapter]);

  // Build sentence-to-paragraph index mapping - stable reference
  const sentenceToParaIndex = useMemo(() => {
    if (!chapter) return new Map<number, number>();
    const map = new Map<number, number>();
    let sentenceIdx = 0;
    chapter.paragraphs.forEach((para, paraIdx) => {
      para.sentences.forEach(() => {
        map.set(sentenceIdx++, paraIdx);
      });
    });
    return map;
  }, [chapter]);

  // Audio sync effect - simplified to avoid circular dependencies
  useEffect(() => {
    if (!timings || !playing || paragraphs.length === 0) return;

    const targetSentenceIndex = timings.sentenceAt(t);
    console.log('>>> SYNC DEBUG: t=', t.toFixed(2), 'sentenceCount=', timings.sentenceCount, 'targetSentenceIndex=', targetSentenceIndex);

    if (targetSentenceIndex < 0) return;

    const targetParaIndex = sentenceToParaIndex.get(targetSentenceIndex) ?? 0;

    // Only update if different from last synced AND different from current
    if (targetParaIndex !== lastSyncedParaRef.current && targetParaIndex !== sentenceIndex) {
      console.log('Audio sync: t=', t.toFixed(2), 'sentenceIdx=', targetSentenceIndex, '-> paraIdx=', targetParaIndex);
      lastSyncedParaRef.current = targetParaIndex;
      setSentenceIndex(targetParaIndex);
      if (bookId) {
        saveReelPosition(bookId, { chapterIdx, sentenceIndex: targetParaIndex });
      }
    }
  }, [t, timings, playing, paragraphs.length, sentenceToParaIndex, chapterIdx, bookId]);

  // Auto-save position
  useEffect(() => {
    if (!bookId || !playing || !audioReady) return;
    const interval = setInterval(() => {
      saveReelPosition(bookId, { chapterIdx, sentenceIndex });
      savePosition(bookId, { chapterIdx, currentTime: player.currentTime });
    }, 5000);
    return () => clearInterval(interval);
  }, [bookId, chapterIdx, sentenceIndex, playing, audioReady, player]);

  const handleProgress = useCallback((idx: number) => {
    setSentenceIndex(idx);
    lastSyncedParaRef.current = idx; // Mark as user-initiated
    if (bookId) {
      saveReelPosition(bookId, { chapterIdx, sentenceIndex: idx });
    }
  }, [bookId, chapterIdx]);

  const handleSeek = useCallback((idx: number) => {
    if (!timings || !chapter) return;
    console.log('Seeking audio to paragraph:', idx);

    // Find the first sentence in the target paragraph
    let targetSentenceIdx = 0;
    let sentenceCount = 0;
    for (let i = 0; i < chapter.paragraphs.length; i++) {
      if (i === idx) {
        targetSentenceIdx = sentenceCount;
        break;
      }
      sentenceCount += chapter.paragraphs[i].sentences.length;
    }

    const seek = timings.timeAtFlatWord(targetSentenceIdx);
    if (seek != null) {
      console.log('Seeking audio to time:', seek, 'for paragraph', idx, '(sentence', targetSentenceIdx, ')');
      player.seekTo(seek);
      lastSyncedParaRef.current = idx; // Mark as user-initiated
      setTimeout(() => {
        if (playing) {
          player.play();
        }
      }, 200);
    } else {
      console.log('Could not find seek time for paragraph:', idx);
    }
  }, [timings, chapter, playing]);

  const handleChapterComplete = useCallback(() => {
    if (!book || !bookId || chapterIdx >= book.manifest.chapters.length - 1) return;
    const next = chapterIdx + 1;
    loadTimings(manifestUrlFor(bookId), next, book.manifest)
      .then((tj) => {
        setTimings(new TimingIndex(tj));
        setChapterIdx(next);
        setSentenceIndex(0);
        lastSyncedParaRef.current = 0;
        const uri = audioUrlFor(manifestUrlFor(bookId), next, book.manifest);
        player.replace({ uri });
        saveReelPosition(bookId, { chapterIdx: next, sentenceIndex: 0 });
      })
      .catch(() => {});
  }, [book, bookId, chapterIdx, player]);

  const cycleSpeed = useCallback(() => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    player.setPlaybackRate(SPEEDS[next]);
    if (bookId) saveSpeed(bookId, SPEEDS[next]);
  }, [bookId, speedIdx, player]);

  const handleQuickSettings = useCallback(() => {
    setFontSize(18);
    const optimalSpeedIdx = SPEEDS.indexOf(1.0);
    if (optimalSpeedIdx >= 0) {
      setSpeedIdx(optimalSpeedIdx);
      player.setPlaybackRate(1.0);
      if (bookId) saveSpeed(bookId, 1.0);
    }

    Alert.alert(
      'Quick Settings Applied',
      '✅ Optimal reading parameters configured:\n\n• Font Size: 18px (compact)\n• Reading Speed: 1.0×\n• Display: One-line spacing\n• Paragraphs: Compact layout\n\nYour reading experience is now optimized!',
      [{ text: 'OK', style: 'default' }]
    );
  }, [bookId, player]);

  const goHome = useCallback(() => {
    try { player.pause(); } catch {}
    if (bookId) {
      saveReelPosition(bookId, { chapterIdx, sentenceIndex });
    }
    router.replace('/bookshelf');
  }, [bookId, chapterIdx, sentenceIndex, player, router]);

  if (error) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
        <Text style={[styles.errorTitle, { color: colors.accent }]}>ReelReader Error</Text>
        <Text style={[styles.errorBody, { color: colors.muted }]}>{error}</Text>
        <Pressable style={[styles.btn, { borderColor: colors.fg }]} onPress={goHome}>
          <Text style={[styles.btnText, { color: colors.fg }]}>Back to Bookshelf</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (loading || !book || !chapter) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={[styles.dim, { color: colors.muted }]}>Loading ReelReader...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      {/* Top Bar */}
      <View style={styles.topbar}>
        <Pressable onPress={goHome} hitSlop={8}>
          <Text style={[styles.brand, { color: colors.fg }]}>
            Reel<span style={{ color: colors.accent }}>Reader</span>
          </Text>
        </Pressable>
        <View style={styles.topbarRight}>
          <ThemeToggle compact />
          <Pressable onPress={cycleSpeed} hitSlop={8}>
            <Text style={[styles.speedBtn, { color: colors.muted }]}>
              {SPEEDS[speedIdx]}×
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Progress Row */}
      <View style={styles.progressRow}>
        <Text style={[styles.dim, { color: colors.muted }]}>{fmtTime(t)}</Text>
        <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: colors.fg }]} />
        </View>
        <Text style={[styles.dim, { color: colors.muted }]}>{fmtTime(duration)}</Text>
      </View>

      {/* ReelReader Component */}
      <ReelReader
        sentences={paragraphs}
        onProgress={handleProgress}
        onChapterComplete={handleChapterComplete}
        fontSize={fontSize}
        colors={colors}
        playing={playing}
        onPlayPause={() => { playing ? player.pause() : player.play(); }}
        onSeek={handleSeek}
        onQuickSettings={handleQuickSettings}
        currentParagraph={sentenceIndex}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  brand: { fontFamily: Fonts.display, fontSize: 18, letterSpacing: -0.3 },
  topbarRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  speedBtn: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  dim: { fontSize: 12 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  progressBar: { flex: 1, height: 2, borderRadius: 1, overflow: 'hidden' },
  progressFill: { height: 2, borderRadius: 1 },
  errorTitle: { fontFamily: Fonts.display, fontSize: 17 },
  errorBody: { fontSize: 12, textAlign: 'center' },
  btn: { borderWidth: 1, borderRadius: 4, paddingVertical: 10, paddingHorizontal: 16, minWidth: 48, alignItems: 'center' },
  btnText: { fontSize: 14 },
});
