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
}
