import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ChunkSize } from '@/lib/rsvp';

const KEY_POSITION = '@position';
const KEY_SPEED = '@speed';
const KEY_FONT = '@fontSize';
const KEY_THEME = '@theme';
const KEY_RSVP = '@rsvpSettings';
const KEY_RSVP_POS = '@rsvpPosition';
const KEY_READER_MODE = '@readerMode';
const KEY_REEL_POS = '@reelPosition';

export type SavedPosition = { chapterIdx: number; currentTime: number };

export type RsvpSettings = {
  wpm: number;
  chunkSize: ChunkSize;
  pushMode: boolean;
  startWpm: number;
  targetWpm: number;
  /** RSVP flash follows audio word timings when available. */
  audioSync: boolean;
  /** Seconds the RSVP flash leads audio. Positive = text ahead. */
  syncLeadSec: number;
};

export type SavedRsvpPosition = { chapterIdx: number; wordIndex: number };

export type SavedReelPosition = { chapterIdx: number; sentenceIndex: number };

export type ReaderMode = 'audio' | 'rsvp' | 'reel';

export const DEFAULT_RSVP_SETTINGS: RsvpSettings = {
  wpm: 300,
  chunkSize: 1,
  pushMode: false,
  startWpm: 300,
  targetWpm: 500,
  audioSync: true,
  syncLeadSec: 0.2,
};

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

export async function saveRsvpSettings(settings: RsvpSettings): Promise<void> {
  await AsyncStorage.setItem(KEY_RSVP, JSON.stringify(settings));
}

export async function loadRsvpSettings(): Promise<RsvpSettings> {
  const raw = await AsyncStorage.getItem(KEY_RSVP);
  if (!raw) return { ...DEFAULT_RSVP_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<RsvpSettings>;
    const chunk = parsed.chunkSize === 2 || parsed.chunkSize === 3 ? parsed.chunkSize : 1;
    return {
      wpm: clampWpm(parsed.wpm ?? DEFAULT_RSVP_SETTINGS.wpm),
      chunkSize: chunk,
      pushMode: !!parsed.pushMode,
      startWpm: clampWpm(parsed.startWpm ?? DEFAULT_RSVP_SETTINGS.startWpm),
      targetWpm: clampWpm(parsed.targetWpm ?? DEFAULT_RSVP_SETTINGS.targetWpm),
      audioSync: parsed.audioSync !== false,
      syncLeadSec: clampLead(parsed.syncLeadSec ?? DEFAULT_RSVP_SETTINGS.syncLeadSec),
    };
  } catch {
    return { ...DEFAULT_RSVP_SETTINGS };
  }
}

function clampWpm(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RSVP_SETTINGS.wpm;
  return Math.max(100, Math.min(1000, Math.round(n)));
}

export function clampLead(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RSVP_SETTINGS.syncLeadSec;
  return Math.max(-2, Math.min(2, Math.round(n * 10) / 10));
}

export function fmtLead(sec: number | undefined): string {
  const n = clampLead(sec ?? 0);
  if (n === 0) return 'on time';
  if (n > 0) return `${n.toFixed(1)}s earlier`;
  return `${Math.abs(n).toFixed(1)}s later`;
}

export async function saveRsvpPosition(bookId: string, pos: SavedRsvpPosition): Promise<void> {
  await AsyncStorage.setItem(`${KEY_RSVP_POS}:${bookId}`, JSON.stringify(pos));
}

export async function loadRsvpPosition(bookId: string): Promise<SavedRsvpPosition | null> {
  const raw = await AsyncStorage.getItem(`${KEY_RSVP_POS}:${bookId}`);
  return raw ? (JSON.parse(raw) as SavedRsvpPosition) : null;
}

export async function saveReelPosition(bookId: string, pos: SavedReelPosition): Promise<void> {
  await AsyncStorage.setItem(`${KEY_REEL_POS}:${bookId}`, JSON.stringify(pos));
}

export async function loadReelPosition(bookId: string): Promise<SavedReelPosition | null> {
  const raw = await AsyncStorage.getItem(`${KEY_REEL_POS}:${bookId}`);
  return raw ? (JSON.parse(raw) as SavedReelPosition) : null;
}

export async function saveReaderMode(mode: ReaderMode): Promise<void> {
  await AsyncStorage.setItem(KEY_READER_MODE, mode);
}

export async function loadReaderMode(): Promise<ReaderMode> {
  const raw = await AsyncStorage.getItem(KEY_READER_MODE);
  if (raw === 'audio') return 'audio';
  if (raw === 'reel') return 'reel';
  return 'rsvp';
}
