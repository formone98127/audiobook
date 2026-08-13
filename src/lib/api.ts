import { Platform } from 'react-native';

import type { BookText, Manifest, TimingsJson } from './types';

export function resolveUrl(manifestUrl: string, rel: string): string {
  return manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1) + rel;
}

/** expo-audio on web needs absolute http(s) URLs. */
export function toAbsoluteUrl(url: string): string {
  if (Platform.OS !== 'web') return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === 'undefined') return url;
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return url;
  }
}

async function fetchJson<T>(url: string, timeoutMs = 12000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(toAbsoluteUrl(url), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return (await res.json()) as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error(`Timed out after ${timeoutMs / 1000}s — is pipeline/serve.py running on ${url.split('/').slice(0, 3).join('/')}?`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadBook(manifestUrl: string): Promise<{ manifest: Manifest; text: BookText }> {
  const manifest = await fetchJson<Manifest>(manifestUrl);
  const text = await fetchJson<BookText>(resolveUrl(manifestUrl, manifest.text.url));
  return { manifest, text };
}

export function loadTimings(manifestUrl: string, chapterIndex: number, manifest: Manifest): Promise<TimingsJson> {
  const ch = manifest.chapters.find((c) => c.index === chapterIndex);
  if (!ch) throw new Error(`chapter ${chapterIndex} not in manifest (audio not rendered yet)`);
  return fetchJson<TimingsJson>(resolveUrl(manifestUrl, ch.timings.url));
}

export function audioUrlFor(manifestUrl: string, chapterIndex: number, manifest: Manifest): string {
  const ch = manifest.chapters.find((c) => c.index === chapterIndex);
  if (!ch) throw new Error(`chapter ${chapterIndex} not in manifest`);
  return toAbsoluteUrl(resolveUrl(manifestUrl, ch.audio.url));
}
