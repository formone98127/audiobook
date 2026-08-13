import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** Local pipeline (native / LAN). Override anytime with EXPO_PUBLIC_SERVER. */
const LAN_SERVER = 'http://192.168.31.218:8080';

export type BookEntry = {
  id: string;
  title: string;
  author: string;
};

export type Category = {
  id: string;
  label: string;
  books: BookEntry[];
};

const FULL_CATEGORIES: Category[] = [
  {
    id: 'audiobooks',
    label: 'Audiobooks',
    books: [
      { id: 'alice', title: "Alice's Adventures in Wonderland", author: 'Lewis Carroll' },
      { id: 'pride', title: 'Pride and Prejudice', author: 'Jane Austen' },
      { id: 'frankenstein', title: 'Frankenstein', author: 'Mary Shelley' },
      { id: 'dracula', title: 'Dracula', author: 'Bram Stoker' },
      { id: 'jane-eyre', title: 'Jane Eyre', author: 'Charlotte Brontë' },
      { id: 'sherlock', title: 'The Adventures of Sherlock Holmes', author: 'Arthur Conan Doyle' },
      { id: 'moby-dick', title: 'Moby-Dick', author: 'Herman Melville' },
      { id: 'dorian-gray', title: 'The Picture of Dorian Gray', author: 'Oscar Wilde' },
      { id: 'tale-two-cities', title: 'A Tale of Two Cities', author: 'Charles Dickens' },
      { id: 'wuthering', title: 'Wuthering Heights', author: 'Emily Brontë' },
      { id: 'monte-cristo', title: 'The Count of Monte Cristo', author: 'Alexandre Dumas' },
    ],
  },
  {
    id: 'poetry',
    label: '詩詞練習',
    books: [
      { id: 'tang300', title: '唐詩三百首', author: '蘅塘退士' },
      { id: 'songci', title: '宋詞三百首', author: '朱孝臧' },
      { id: 'shijing', title: '詩經', author: '佚名' },
      { id: 'chuci', title: '楚辭', author: '屈原' },
      { id: 'taoteching', title: '道德經', author: '老子' },
      { id: 'analects', title: '論語', author: '孔子' },
      { id: 'mengzi', title: '孟子', author: '孟子' },
      { id: 'daxue', title: '大學', author: '曾子' },
      { id: 'zhongyong', title: '中庸', author: '子思' },
      { id: 'diwang', title: '帝王之路', author: '司馬遷' },
      { id: 'guwenguanzhi', title: '古文觀止', author: '吳楚材' },
      { id: 'youxue', title: '幼學瓊林', author: '程允升' },
      { id: 'qianziwen', title: '千字文', author: '周興嗣' },
      { id: 'sanzijing', title: '三字經', author: '王應麟' },
      { id: 'baijiaxing', title: '百家姓', author: '佚名' },
    ],
  },
];

/** Bundled under public/books for GitHub Pages / static web. */
const WEB_DEMO_CATEGORIES: Category[] = [
  {
    id: 'audiobooks',
    label: 'Audiobooks',
    books: [
      { id: 'alice', title: "Alice's Adventures in Wonderland", author: 'Lewis Carroll' },
    ],
  },
  {
    id: 'poetry',
    label: '詩詞練習',
    books: [
      { id: 'tang300', title: '唐詩三百首（選）', author: '蘅塘退士' },
    ],
  },
];

function webBooksBase(): string {
  const base = (Constants.expoConfig?.experiments as { baseUrl?: string } | undefined)?.baseUrl ?? '';
  const trimmed = base.replace(/\/$/, '');
  const path = `${trimmed}/books` || '/books';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${normalized}`;
  }
  return normalized;
}

const envServer = process.env.EXPO_PUBLIC_SERVER?.replace(/\/$/, '');

/** Book host: env override → same-origin /books on web → LAN on native. */
export const SERVER = envServer || (Platform.OS === 'web' ? webBooksBase() : LAN_SERVER);

export const CATEGORIES: Category[] =
  Platform.OS === 'web' && !envServer ? WEB_DEMO_CATEGORIES : FULL_CATEGORIES;

export const ALL_BOOKS: BookEntry[] = CATEGORIES.flatMap((c) => c.books);

export function manifestUrlFor(bookId: string): string {
  return `${SERVER}/${bookId}/manifest.json`;
}
