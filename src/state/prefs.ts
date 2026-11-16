/** Look preferences: theme (auto/light/dark) and page background. Persisted; applied to <html>/<body>. */
import { store } from '../lib/storage';
import { DEFAULT_BACKGROUND, isBackgroundId, type BackgroundId } from '../ui/shell/pagebg';

export type ThemePref = 'auto' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

const listeners = new Set<() => void>();
const darkMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function getThemePref(): ThemePref {
  const v = store.get<string>('theme', 'auto');
  return v === 'light' || v === 'dark' ? v : 'auto';
}

export function effectiveTheme(pref: ThemePref = getThemePref()): EffectiveTheme {
  return pref === 'auto' ? (darkMQ?.matches === false ? 'light' : 'dark') : pref;
}

/** Writes data-theme (absent = Auto) and data-eff (the theme actually showing) on <html>. */
export function applyTheme(): void {
  const pref = getThemePref();
  const root = document.documentElement;
  if (pref === 'auto') delete root.dataset.theme; else root.dataset.theme = pref;
  root.dataset.eff = effectiveTheme(pref);
}

export function setThemePref(pref: ThemePref): void {
  store.set('theme', pref);
  applyTheme();
  listeners.forEach(cb => cb());
}

/** The top-bar switch: flip whatever is showing now (this leaves Auto). */
export function toggleTheme(): void {
  setThemePref(effectiveTheme() === 'dark' ? 'light' : 'dark');
}

export function getBackgroundPref(): BackgroundId {
  const v = store.get<unknown>('bg', DEFAULT_BACKGROUND);
  return isBackgroundId(v) ? v : DEFAULT_BACKGROUND;
}

export function setBackgroundPref(id: BackgroundId): void {
  store.set('bg', id);
  listeners.forEach(cb => cb());
}

export function onPrefsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Call once at startup, before first paint of the app. */
export function initPrefs(): void {
  applyTheme();
  darkMQ?.addEventListener?.('change', () => { if (getThemePref() === 'auto') { applyTheme(); listeners.forEach(cb => cb()); } });
}
