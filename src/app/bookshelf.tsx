import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemeToggle } from '@/components/ThemeToggle';
import { Fonts } from '@/constants/lumina';
import { useTheme } from '@/lib/theme';
import { loadBook } from '../lib/api';
import { CATEGORIES, manifestUrlFor } from '../lib/config';
import type { Manifest } from '../lib/types';

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Bookshelf() {
  const { colors } = useTheme();
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function tapBook(bookId: string) {
    setSelectedBook(bookId);
    setLoading(true);
    setError(null);
    setManifest(null);
    try {
      const { manifest: m } = await loadBook(manifestUrlFor(bookId));
      setManifest(m);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  function openChapter(chapterIdx: number) {
    if (!selectedBook) return;
    setSelectedBook(null);
    setManifest(null);
    router.replace({ pathname: '/reader', params: { bookId: selectedBook, chapter: String(chapterIdx) } });
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <Text style={[styles.heading, { color: colors.fg }]}>
          Lumina <Text style={{ color: colors.accent }}>RSVP</Text>
        </Text>
        <View style={styles.headerRight}>
          <ThemeToggle compact />
          <Pressable onPress={() => router.push('/settings')} hitSlop={8}>
            <Text style={[styles.editBtn, { color: colors.muted }]}>Settings</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView>
        {CATEGORIES.map((cat) => (
          <View key={cat.id} style={styles.categorySection}>
            <Text style={[styles.categoryLabel, { color: colors.muted }]}>{cat.label}</Text>
            <View style={styles.grid}>
              {cat.books.map((b) => (
                <Pressable key={b.id} style={styles.card} onPress={() => tapBook(b.id)}>
                  <View style={[styles.cover, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.coverText, { color: colors.accent }]}>{b.title[0]}</Text>
                  </View>
                  <Text style={[styles.title, { color: colors.fg }]} numberOfLines={2}>{b.title}</Text>
                  <Text style={[styles.author, { color: colors.muted }]}>{b.author}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal visible={selectedBook !== null} transparent animationType="slide" onRequestClose={() => setSelectedBook(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedBook(null)}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.fg }]}>{manifest?.title ?? 'Loading...'}</Text>
            {loading && <ActivityIndicator color={colors.accent} style={{ marginVertical: 20 }} />}
            {error && <Text style={[styles.errorText, { color: colors.accent }]}>{error}</Text>}
            {manifest && (
              <ScrollView>
                {manifest.chapters.map((c) => (
                  <Pressable
                    key={c.index}
                    style={styles.chapterRow}
                    onPress={() => openChapter(c.index)}
                  >
                    <Text style={[styles.chapterRowText, { color: colors.fg }]}>{c.title}</Text>
                    <Text style={[styles.dim, { color: colors.muted }]}>{fmtTime(c.duration)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heading: { fontFamily: Fonts.display, fontSize: 28, letterSpacing: -0.4 },
  editBtn: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  categorySection: { marginBottom: 28 },
  categoryLabel: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  card: { width: 160, gap: 8 },
  cover: { width: 160, height: 220, borderRadius: 4, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  coverText: { fontFamily: Fonts.display, fontSize: 64 },
  title: { fontFamily: Fonts.display, fontSize: 16 },
  author: { fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(42,34,24,0.35)', justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: 6, borderTopRightRadius: 6, padding: 24, maxHeight: '70%', borderWidth: 1 },
  modalTitle: { fontFamily: Fonts.display, fontSize: 24, marginBottom: 12 },
  chapterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 8, borderRadius: 4, gap: 12 },
  chapterRowText: { fontFamily: Fonts.display, fontSize: 16, flex: 1 },
  dim: { fontFamily: Fonts.mono, fontSize: 12, letterSpacing: 0.6 },
  errorText: { fontSize: 14, textAlign: 'center', marginVertical: 12 },
});
