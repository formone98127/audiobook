import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/lumina';
import { useTheme } from '@/lib/theme';

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, colors, toggleTheme } = useTheme();
  const dark = theme === 'dark';

  return (
    <Pressable
      onPress={toggleTheme}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityLabel="Dark mode"
      accessibilityState={{ checked: dark }}
      style={styles.row}
    >
      <Text style={[styles.label, { color: colors.muted }]}>{dark ? 'Dark' : 'Light'}</Text>
      <View
        style={[
          styles.track,
          compact && styles.trackCompact,
          { backgroundColor: dark ? colors.fg : colors.border, borderColor: dark ? colors.fg : colors.muted },
        ]}
      >
        <View
          style={[
            styles.thumb,
            compact && styles.thumbCompact,
            { backgroundColor: colors.surface, alignSelf: dark ? 'flex-end' : 'flex-start' },
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  label: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  track: {
    width: 48,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    padding: 3,
    justifyContent: 'center',
  },
  trackCompact: { width: 44, height: 26, borderRadius: 13 },
  thumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  thumbCompact: { width: 18, height: 18, borderRadius: 9 },
});
