import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { luminaDark, luminaLight, type Palette } from '@/constants/lumina';
import { loadTheme, saveTheme } from '@/lib/storage';

export type AppTheme = 'light' | 'dark';

type ThemeCtx = {
  theme: AppTheme;
  colors: Palette;
  setTheme: (t: AppTheme) => void;
  toggleTheme: () => void;
};

const Ctx = createContext<ThemeCtx>({
  theme: 'light',
  colors: luminaLight,
  setTheme: () => {},
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>('light');

  useEffect(() => {
    loadTheme().then((t) => { if (t) setThemeState(t); });
  }, []);

  const setTheme = (t: AppTheme) => {
    setThemeState(t);
    saveTheme(t);
  };

  const value = useMemo<ThemeCtx>(() => ({
    theme,
    colors: theme === 'dark' ? luminaDark : luminaLight,
    setTheme,
    toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
  }), [theme]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
