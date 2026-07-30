'use client';

import { useEffect, useState } from 'react';
import { SunIcon, MoonIcon } from './icons';

/** Toggles data-theme on <html> and persists the choice. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const stored = (localStorage.getItem('theme') as 'light' | 'dark' | null) ?? null;
    const initial =
      stored ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(initial);
    document.documentElement.setAttribute('data-theme', initial);
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  }

  return (
    <button
      onClick={toggle}
      // Names the result, not the current state, so it reads correctly to a
      // screen reader in both themes.
      aria-label={theme === 'dark' ? 'Switch to light appearance' : 'Switch to dark appearance'}
      // Stable hook so tests don't pin user-facing copy, which is free to change.
      data-testid="theme-toggle"
      className="inline-flex h-9 w-9 items-center justify-center rounded-pill text-muted transition-colors duration-200 hover:bg-sunken hover:text-text"
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
