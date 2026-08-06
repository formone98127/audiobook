export const SERVER = 'http://192.168.31.218:8080';

export const BOOKS = [
  { id: 'alice', title: "Alice's Adventures in Wonderland", author: 'Lewis Carroll' },
] as const;

export type BookEntry = (typeof BOOKS)[number];

export function manifestUrlFor(bookId: string): string {
  return `${SERVER}/${bookId}/manifest.json`;
}
