import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

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
  type SavedReelPosition,
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

  const player = useAudioPlayer(null, { updateInterval: 25 });

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

        // Load audio and timings
        try {
          const tj = await loadTimings(manifestUrl, startChapter, bookData.manifest);
          setTimings(new TimingIndex(tj));
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

        // Load speed preference
        if (bookId) {
          loadSpeed(bookId).then((s) => {
            if (s != null) {
              const idx = SPEEDS.indexOf(s);
              if (idx >= 0) {
                setSpeedIdx(idx);
                player.setPlaybackRate(SPEEDS[idx]);
              }
            }
          });
        }
      })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, [bookId, chapterParam, player]);

  const t = player.currentTime;
  const playing = player.playing;
  const duration = player.duration || 0;
  const progress = duration > 0 ? t / duration : 0;

  // Auto-scroll effect for audio sync
  useEffect(() => {
    if (!timings || !playing) return;

    const targetIndex = timings.sentenceAt(t);
    if (targetIndex >= 0 && targetIndex !== sentenceIndex) {
      setSentenceIndex(targetIndex);
      if (bookId) {
        saveReelPosition(bookId, { chapterIdx, sentenceIndex: targetIndex });
      }
    }
  }, [t, timings, playing, sentenceIndex, chapterIdx, bookId]);

  // Auto-save position
  useEffect(() => {
    if (!bookId || !playing || !audioReady) return;
    const interval = setInterval(() => {
      saveReelPosition(bookId, { chapterIdx, sentenceIndex });
      savePosition(bookId, { chapterIdx, currentTime: player.currentTime });
    }, 5000);
    return () => clearInterval(interval);
  }, [bookId, chapterIdx, sentenceIndex, playing, audioReady, player]);

  const chapter: BookChapter | undefined = book?.text.chapters.find((c) => c.index === chapterIdx);

  const sentences = chapter?.paragraphs.flatMap((p) => p.sentences.map((s) => s.text)) ?? [];

  const handleProgress = (idx: number) => {
    setSentenceIndex(idx);
    if (bookId) {
      saveReelPosition(bookId, { chapterIdx, sentenceIndex: idx });
    }
  };

  const handleSeek = (idx: number) => {
    if (!timings) return;
    const seek = timings.timeAtSentence(idx);
    if (seek != null) {
      player.seekTo(seek);
    }
  };

  const handleChapterComplete = () => {
    if (!book || !bookId || chapterIdx >= book.manifest.chapters.length - 1) return;
    const next = chapterIdx + 1;
    loadTimings(manifestUrlFor(bookId), next, book.manifest)
      .then((tj) => {
        setTimings(new TimingIndex(tj));
        setChapterIdx(next);
        setSentenceIndex(0);
        const uri = audioUrlFor(manifestUrlFor(bookId), next, book.manifest);
        player.replace({ uri });
        saveReelPosition(bookId, { chapterIdx: next, sentenceIndex: 0 });
      })
      .catch(() => {});
  };

  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    player.setPlaybackRate(SPEEDS[next]);
    if (bookId) saveSpeed(bookId, SPEEDS[next]);
  };

  const goHome = () => {
    try { player.pause(); } catch {}
    if (bookId) {
      saveReelPosition(bookId, { chapterIdx, sentenceIndex });
    }
    router.replace('/bookshelf');
  };

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
        sentences={sentences}
        timings={timings}
        onProgress={handleProgress}
        onChapterComplete={handleChapterComplete}
        fontSize={fontSize}
        colors={colors}
        playing={playing}
        currentTime={t}
        onPlayPause={() => { playing ? player.pause() : player.play(); }}
        onSeek={handleSeek}
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