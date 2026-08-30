import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface NeurodeskThemeController {
  get: () => Theme;
  set: (theme: Theme) => void;
  toggle: () => Theme;
}

declare global {
  interface Window {
    NeurodeskTheme?: NeurodeskThemeController;
  }
}

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_STORAGE_KEY = 'dicompare-theme';

// On the composite site, the shared controller (site/theme.js) owns the theme:
// it sets `data-neurodesk-theme` on <html>, exposes `window.NeurodeskTheme`,
// and dispatches `neurodesk-theme-change`. When present it is the source of
// truth and we mirror its value onto the `.dark` class Tailwind reads.
const sharedControllerTheme = (): Theme | null => {
  if (window.NeurodeskTheme) {
    return window.NeurodeskTheme.get();
  }
  const attr = document.documentElement.dataset.neurodeskTheme;
  return attr === 'light' || attr === 'dark' ? attr : null;
};

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Decide once at mount; the shared controller runs before the app boots.
  const [useSharedController] = useState<boolean>(() => sharedControllerTheme() !== null);

  const [theme, setThemeState] = useState<Theme>(() => {
    // The shared controller wins when present (composite site)
    const shared = sharedControllerTheme();
    if (shared) {
      return shared;
    }
    // Check localStorage first
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
    // Fall back to system preference
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  });

  useEffect(() => {
    // Apply theme class to document
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    // Persist to localStorage (standalone only; the shared controller
    // persists its own key)
    if (!useSharedController) {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }, [theme, useSharedController]);

  // Follow the shared controller when it owns the theme
  useEffect(() => {
    if (!useSharedController) return;
    const handleChange = (event: Event) => {
      const next = (event as CustomEvent<{ theme?: string }>).detail?.theme;
      if (next === 'light' || next === 'dark') {
        setThemeState(next);
      }
    };
    window.addEventListener('neurodesk-theme-change', handleChange);
    return () => window.removeEventListener('neurodesk-theme-change', handleChange);
  }, [useSharedController]);

  // Listen for system theme changes (standalone only)
  useEffect(() => {
    if (useSharedController) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      // Only auto-switch if user hasn't manually set a preference
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (!stored) {
        setThemeState(e.matches ? 'dark' : 'light');
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [useSharedController]);

  const setTheme = (newTheme: Theme) => {
    if (useSharedController && window.NeurodeskTheme) {
      // The controller applies the theme and dispatches the change event,
      // which updates our state via the listener above
      window.NeurodeskTheme.set(newTheme);
      return;
    }
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
