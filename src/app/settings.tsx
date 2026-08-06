import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadFontSize, loadTheme, saveFontSize, saveTheme } from '../lib/storage';

export default function Settings() {
  const [fontSize, setFontSize] = useState(19);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    loadFontSize().then((s) => { if (s) setFontSize(s); });
    loadTheme().then((t) => { if (t) setTheme(t); });
  }, []);

  const changeFont = (delta: number) => {
    const next = Math.max(13, Math.min(28, fontSize + delta));
    setFontSize(next);
    saveFontSize(next);
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    saveTheme(next);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.heading}>Settings</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Font Size</Text>
        <View style={styles.row}>
          <Pressable style={styles.btn} onPress={() => changeFont(-1)}>
            <Text style={styles.btnText}>A−</Text>
          </Pressable>
          <Text style={styles.valueText}>{fontSize}px</Text>
          <Pressable style={styles.btn} onPress={() => changeFont(1)}>
            <Text style={styles.btnText}>A+</Text>
          </Pressable>
        </View>
        <Text style={[styles.preview, { fontSize }]}>
          The quick brown fox jumps over the lazy dog.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Theme</Text>
        <Pressable style={styles.btn} onPress={toggleTheme}>
          <Text style={styles.btnText}>{theme === 'dark' ? '🌙 Dark' : '☀ Light'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F14', padding: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  backBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#1A2230' },
  backText: { color: '#E8E6DF', fontSize: 14 },
  heading: { color: '#F5C518', fontSize: 24, fontWeight: '700' },
  section: { marginBottom: 28, gap: 12 },
  sectionTitle: { color: '#7D8590', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  btn: { backgroundColor: '#1A2230', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
  btnText: { color: '#E8E6DF', fontSize: 16, fontWeight: '600' },
  valueText: { color: '#E8E6DF', fontSize: 16, minWidth: 50, textAlign: 'center' },
  preview: { color: '#D8D5CC', fontFamily: 'serif', lineHeight: 32 },
});
