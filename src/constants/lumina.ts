import { Platform } from 'react-native';

export type Palette = {
  bg: string;
  surface: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
};

export const luminaLight: Palette = {
  bg: '#F7F6F3',
  surface: '#FFFEFC',
  fg: '#2A2218',
  muted: '#7A7168',
  border: '#E4E0D8',
  accent: '#B54A32',
};

export const luminaDark: Palette = {
  bg: '#1C1814',
  surface: '#24201B',
  fg: '#F4F1EA',
  muted: '#A39A90',
  border: '#3D362E',
  accent: '#D46A52',
};

export const Fonts = {
  display: Platform.select({
    ios: 'Georgia',
    android: 'serif',
    default: 'Georgia, "Iowan Old Style", Charter, serif',
  }) as string,
  body: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  }) as string,
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'ui-monospace, "IBM Plex Mono", Menlo, monospace',
  }) as string,
};
