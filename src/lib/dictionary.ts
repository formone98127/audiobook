export type Definition = {
  word: string;
  partOfSpeech: string;
  definition: string;
  example?: string;
};

export async function lookupWord(word: string): Promise<Definition | null> {
  const clean = word.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
  if (!clean) return null;
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const entry = data[0];
    if (!entry?.meanings?.[0]) return null;
    const m = entry.meanings[0];
    const d = m.definitions?.[0];
    if (!d) return null;
    return {
      word: entry.word ?? clean,
      partOfSpeech: m.partOfSpeech ?? '',
      definition: d.definition ?? '',
      example: d.example,
    };
  } catch {
    return null;
  }
}
