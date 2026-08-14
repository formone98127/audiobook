export type ManifestChapter = {
  index: number;
  title: string;
  duration: number;
  audio: { url: string; bytes: number };
  timings: { url: string; bytes: number };
};

export type Manifest = {
  id: string;
  title: string;
  language: string;
  text: { url: string; bytes: number };
  chapters: ManifestChapter[];
};

export type BookSentence = { text: string };
export type BookParagraph = { sentences: BookSentence[] };
export type BookChapter = { index: number; title: string; paragraphs: BookParagraph[] };
export type BookText = { id: string; title: string; chapters: BookChapter[] };

// [sentenceIndex, start, end]
export type SentenceTiming = [number, number, number];
// [sentenceIndex, wordIndexInSentence, start, end]
export type WordTiming = [number, number, number, number];

export type TimingsJson = {
  chapter: number;
  sentences: SentenceTiming[];
  words: WordTiming[];
  /** Canonical RSVP token stream (matches words 1:1). */
  tokens?: string[];
};
