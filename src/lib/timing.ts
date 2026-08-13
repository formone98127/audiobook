import type { TimingsJson } from './types';

export class TimingIndex {
  private sentStart: number[] = [];
  /** sorted-rank → original sentence index (only sentences with real spans) */
  private sentIndexByRank: number[] = [];
  private wordsBySentence = new Map<number, { start: number; end: number }[]>();
  /** Word starts in sentence-major flat order (matches RSVP token stream). */
  private flatStarts: number[] = [];

  constructor(json: TimingsJson) {
    for (const [si, wi, start, end] of json.words) {
      let arr = this.wordsBySentence.get(si);
      if (!arr) {
        arr = [];
        this.wordsBySentence.set(si, arr);
      }
      arr[wi] = { start, end };
    }

    const usable = [...json.sentences]
      .filter(([, start, end]) => end > start + 1e-6)
      .sort((a, b) => a[1] - b[1]);
    this.sentStart = usable.map(([, start]) => start);
    this.sentIndexByRank = usable.map(([si]) => si);

    const maxSi = Math.max(-1, ...[...this.wordsBySentence.keys()]);
    for (let si = 0; si <= maxSi; si++) {
      const arr = this.wordsBySentence.get(si);
      if (!arr) continue;
      for (let wi = 0; wi < arr.length; wi++) {
        if (arr[wi]) this.flatStarts.push(arr[wi].start);
      }
    }
  }

  get sentenceCount(): number {
    return this.sentStart.length;
  }

  /** Original sentence index whose start <= t, or -1. */
  sentenceAt(t: number): number {
    let lo = 0;
    let hi = this.sentStart.length - 1;
    let rank = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.sentStart[mid] <= t) {
        rank = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (rank < 0) return -1;
    return this.sentIndexByRank[rank] ?? -1;
  }

  sentenceStartOf(i: number): number {
    // i is original sentence index — find its start from words or sent table
    const arr = this.wordsBySentence.get(i);
    if (arr) {
      for (let wi = 0; wi < arr.length; wi++) {
        if (arr[wi]) return arr[wi].start;
      }
    }
    const rank = this.sentIndexByRank.indexOf(i);
    if (rank >= 0) return this.sentStart[rank];
    return 0;
  }

  /** Last word in the sentence whose start <= t, or -1. */
  wordAt(sentenceIndex: number, t: number): number {
    const arr = this.wordsBySentence.get(sentenceIndex);
    if (!arr) return -1;
    let ans = -1;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].start <= t) ans = i;
      else break;
    }
    return ans;
  }

  wordStart(sentenceIndex: number, wordIndex: number): number | null {
    return this.wordsBySentence.get(sentenceIndex)?.[wordIndex]?.start ?? null;
  }

  sentenceWordCount(si: number): number {
    const arr = this.wordsBySentence.get(si);
    if (!arr) return 0;
    let n = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i]) n++;
    return n;
  }

  get totalWords(): number {
    return this.flatStarts.length;
  }

  /**
   * Flat word index for time t (sentence-major order).
   * leadSec shifts lookup — negative delays flash behind audio.
   */
  flatWordAt(t: number, leadSec = -0.15): number {
    const tt = Math.max(0, t + leadSec);
    const starts = this.flatStarts;
    if (starts.length === 0) return 0;
    let lo = 0;
    let hi = starts.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= tt) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    // Before first word starts, stay on 0
    if (tt < starts[0]) return 0;
    return ans;
  }

  /** Start time of the flat-th timed word, or null. */
  timeAtFlatWord(flat: number): number | null {
    if (flat < 0 || flat >= this.flatStarts.length) return null;
    return this.flatStarts[flat] ?? null;
  }
}
