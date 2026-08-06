import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_POSITION = '@position';
const KEY_SPEED = '@speed';
const KEY_FONT = '@fontSize';
const KEY_THEME = '@theme';

export type SavedPosition = { chapterIdx: number; currentTime: number };

export async function savePosition(bookId: string, pos: SavedPosition): Promise<void> {
  await AsyncStorage.setItem(`${KEY_POSITION}:${bookId}`, JSON.stringify(pos));
}

export async function loadPosition(bookId: string): Promise<SavedPosition | null> {
  const raw = await AsyncStorage.getItem(`${KEY_POSITION}:${bookId}`);
  return raw ? (JSON.parse(raw) as SavedPosition) : null;
}

export async function clearPosition(bookId: string): Promise<void> {
  await AsyncStorage.removeItem(`${KEY_POSITION}:${bookId}`);
}

export async function saveSpeed(bookId: string, speed: number): Promise<void> {
  await AsyncStorage.setItem(`${KEY_SPEED}:${bookId}`, String(speed));
}

export async function loadSpeed(bookId: string): Promise<number | null> {
  const raw = await AsyncStorage.getItem(`${KEY_SPEED}:${bookId}`);
  return raw ? parseFloat(raw) : null;
}

export async function saveFontSize(size: number): Promise<void> {
  await AsyncStorage.setItem(KEY_FONT, String(size));
}

export async function loadFontSize(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(KEY_FONT);
  return raw ? parseFloat(raw) : null;
}

export async function saveTheme(theme: 'dark' | 'light'): Promise<void> {
  await AsyncStorage.setItem(KEY_THEME, theme);
}

export async function loadTheme(): Promise<'dark' | 'light' | null> {
  const raw = await AsyncStorage.getItem(KEY_THEME);
  return raw as 'dark' | 'light' | null;
}
