import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadBook } from '../lib/api';
import { BOOKS, manifestUrlFor } from '../lib/config';
import type { Manifest } from '../lib/types';

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Bookshelf() {
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
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Bookshelf</Text>
        <Pressable style={styles.settingsBtn} onPress={() => router.push('/settings')}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </Pressable>
      </View>
      <View style={styles.grid}>
        {BOOKS.map((b) => (
          <Pressable key={b.id} style={styles.card} onPress={() => tapBook(b.id)}>
            <View style={styles.cover}>
              <Text style={styles.coverText}>{b.title[0]}</Text>
            </View>
            <Text style={styles.title} numberOfLines={2}>{b.title}</Text>
            <Text style={styles.author}>{b.author}</Text>
          </Pressable>
        ))}
      </View>

      <Modal visible={selectedBook !== null} transparent animationType="slide" onRequestClose={() => setSelectedBook(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedBook(null)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{manifest?.title ?? 'Loading...'}</Text>
            {loading && <ActivityIndicator color="#F5C518" style={{ marginVertical: 20 }} />}
            {error && <Text style={styles.errorText}>{error}</Text>}
            {manifest && (
              <ScrollView>
                {manifest.chapters.map((c) => (
                  <Pressable
                    key={c.index}
                    style={styles.chapterRow}
                    onPress={() => openChapter(c.index)}
                  >
                    <Text style={styles.chapterRowText}>{c.title}</Text>
                    <Text style={styles.dim}>{fmtTime(c.duration)}</Text>
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
  container: { flex: 1, backgroundColor: '#0B0F14', padding: 24 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 },
  heading: { color: '#F5C518', fontSize: 32, fontWeight: '700' },
  settingsBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#1A2230', alignItems: 'center', justifyContent: 'center' },
  settingsIcon: { color: '#E8E6DF', fontSize: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 24 },
  card: { width: 200, gap: 10 },
  cover: { width: 200, height: 280, borderRadius: 14, backgroundColor: '#1A3A5C', alignItems: 'center', justifyContent: 'center' },
  coverText: { color: '#F5C518', fontSize: 88, fontWeight: '700', fontFamily: 'serif' },
  title: { color: '#E8E6DF', fontSize: 18, fontWeight: '600' },
  author: { color: '#7D8590', fontSize: 15 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#131A24', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '70%' },
  modalTitle: { color: '#E8E6DF', fontSize: 20, fontWeight: '700', marginBottom: 12 },
  chapterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12, borderRadius: 8, gap: 12 },
  chapterRowText: { color: '#E8E6DF', fontSize: 17, flex: 1 },
  dim: { color: '#7D8590', fontSize: 14 },
  errorText: { color: '#FF7B72', fontSize: 14, textAlign: 'center', marginVertical: 12 },
});
