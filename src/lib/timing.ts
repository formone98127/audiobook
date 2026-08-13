import type { TimingsJson } from './types';

export class TimingIndex {
  private sentStart: number[] = [];
  private wordsBySentence = new Map<number, { start: number; end: number }[]>();

  constructor(json: TimingsJson) {
    const sorted = [...json.sentences].sort((a, b) => a[1] - b[1]);
    for (const [, start] of sorted) this.sentStart.push(start);
    for (const [si, wi, start, end] of json.words) {
      let arr = this.wordsBySentence.get(si);
      if (!arr) {
        arr = [];
        this.wordsBySentence.set(si, arr);
      }
      arr[wi] = { start, end };
    }
  }

  get sentenceCount(): number {
    return this.sentStart.length;
  }

  /** Last sentence whose start <= t, or -1 before the first sentence. */
  sentenceAt(t: number): number {
    let lo = 0;
    let hi = this.sentStart.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.sentStart[mid] <= t) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  sentenceStartOf(i: number): number {
    const clamped = Math.max(0, Math.min(i, this.sentStart.length - 1));
    return this.sentStart[clamped];
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
    let n = 0;
    for (let si = 0; si < this.sentenceCount; si++) n += this.sentenceWordCount(si);
    return n;
  }

  /** Global word index (sentence-major) for time t. */
  flatWordAt(t: number): number {
    const si = this.sentenceAt(t);
    if (si < 0) return 0;
    let base = 0;
    for (let i = 0; i < si; i++) base += this.sentenceWordCount(i);
    const wi = this.wordAt(si, t);
    return base + Math.max(0, wi);
  }

  /** Start time of the flat-th timed word, or null. */
  timeAtFlatWord(flat: number): number | null {
    let remaining = Math.max(0, Math.floor(flat));
    for (let si = 0; si < this.sentenceCount; si++) {
      const arr = this.wordsBySentence.get(si);
      const count = this.sentenceWordCount(si);
      if (remaining < count && arr) {
        let seen = 0;
        for (let wi = 0; wi < arr.length; wi++) {
          if (!arr[wi]) continue;
          if (seen === remaining) return arr[wi].start;
          seen++;
        }
        return this.sentenceStartOf(si);
      }
      remaining -= count;
    }
    return null;
  }
}
