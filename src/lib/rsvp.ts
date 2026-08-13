import type { BookChapter } from '@/lib/types';

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
const WORD_RE = /[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?|[^\s]/g;

export type ChunkSize = 1 | 2 | 3;

/** Flatten chapter text into RSVP tokens (EN words or CJK characters). */
export function tokensFromChapter(chapter: BookChapter | undefined, language?: string): string[] {
  if (!chapter) return [];
  const parts: string[] = [];
  for (const p of chapter.paragraphs) {
    for (const s of p.sentences) {
      const t = s.text.trim();
      if (t) parts.push(t);
    }
  }
  const full = parts.join(' ');
  return tokenize(full, language);
}

export function tokenize(text: string, language?: string): string[] {
  const forceCjk =
    !!language && /^(zh|ja|ko|chinese|japanese|korean)/i.test(language.trim());
  if (forceCjk || CJK_RE.test(text)) {
    return tokenizeCjk(text);
  }
  return tokenizeLatin(text);
}

const PUNCT_ONLY = /^[.,!?;:'"“”‘’\-—–()[\]{}<>/\\@#$%^&*_+=|~`]+$/;

function tokenizeLatin(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    const tok = m[0].trim();
    if (!tok) continue;
    if (PUNCT_ONLY.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

function tokenizeCjk(text: string): string[] {
  const out: string[] = [];
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    if (PUNCT_ONLY.test(ch)) continue;
    out.push(ch);
  }
  return out;
}

export function chunkAt(tokens: string[], index: number, chunkSize: ChunkSize): string {
  if (index < 0 || index >= tokens.length) return '';
  return tokens.slice(index, index + chunkSize).join(isCjkToken(tokens[index]) ? '' : ' ');
}

function isCjkToken(tok: string): boolean {
  return CJK_RE.test(tok);
}

/** Interval in ms to display one chunk. WPM counts words/tokens; chunk of N lasts N word-slots. */
export function msPerChunk(wpm: number, chunkSize: ChunkSize): number {
  const safe = Math.max(50, Math.min(2000, wpm));
  return (chunkSize * 60000) / safe;
}

/** Linear ramp from startWpm → targetWpm over word progress [0, 1]. */
export function pushWpm(
  startWpm: number,
  targetWpm: number,
  progress01: number,
): number {
  const p = Math.max(0, Math.min(1, progress01));
  return startWpm + (targetWpm - startWpm) * p;
}

export function effectiveWpm(opts: {
  wpm: number;
  pushMode: boolean;
  startWpm: number;
  targetWpm: number;
  wordIndex: number;
  totalWords: number;
}): number {
  if (!opts.pushMode || opts.totalWords <= 0) return opts.wpm;
  const progress = opts.wordIndex / opts.totalWords;
  return pushWpm(opts.startWpm, opts.targetWpm, progress);
}

export function formatEta(remainingWords: number, wpm: number): string {
  if (wpm <= 0 || remainingWords <= 0) return '0 min';
  const mins = remainingWords / wpm;
  if (mins < 1) return '<1 min';
  return `${Math.ceil(mins)} min`;
}
