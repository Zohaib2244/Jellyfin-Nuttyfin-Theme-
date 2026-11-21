/** Look preferences: theme (auto/light/dark) and page background. Persisted; applied to <html>/<body>. */
import { store } from '../lib/storage';
import { DEFAULT_BACKGROUND, type BackgroundId } from '../ui/shell/pagebg';

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

/** Two backgrounds (owner, 2026-11-21): the dot grid (default) or the scrolling poster wall. Stored under a new key so
 *  choices from the old six-way picker are ignored. */
export const BACKGROUND_CHOICES: readonly BackgroundId[] = ['dots', 'wall'];
export function getBackgroundPref(): BackgroundId {
  const v = store.get<string>('bg2', DEFAULT_BACKGROUND);
  return (BACKGROUND_CHOICES as readonly string[]).includes(v) ? (v as BackgroundId) : DEFAULT_BACKGROUND;
}

export function setBackgroundPref(id: BackgroundId): void {
  store.set('bg2', id);
  listeners.forEach(cb => cb());
}

/* ── Colour theme (AVN Hub's theme packs; 'ember' = no attribute) ── */
export type PaletteId = 'ember' | 'slate' | 'moss' | 'plum' | 'reef' | 'raspberry' | 'circuit' | 'graphite';
export const PALETTES: ReadonlyArray<{ id: PaletteId; label: string; swatch: readonly [string, string, string] }> = [
  { id: 'ember', label: 'Ember', swatch: ['#1e1a14', '#ff6b2b', '#00b4c8'] },
  { id: 'slate', label: 'Slate', swatch: ['#161b22', '#4da3ff', '#00c8a0'] },
  { id: 'moss', label: 'Moss', swatch: ['#141c14', '#8fc63c', '#d89a28'] },
  { id: 'plum', label: 'Plum', swatch: ['#1c141e', '#e84a8a', '#d8a830'] },
  { id: 'reef', label: 'Reef', swatch: ['#102321', '#ff7a59', '#5ad7b7'] },
  { id: 'raspberry', label: 'Berry', swatch: ['#21151a', '#ff4d6d', '#39c6d6'] },
  { id: 'circuit', label: 'Circuit', swatch: ['#151b19', '#f2c94c', '#2dd4bf'] },
  { id: 'graphite', label: 'Graphite', swatch: ['#1b1b1b', '#f0623d', '#b4d455'] },
];
export function getPalette(): PaletteId {
  const v = store.get<string>('palette', 'ember');
  return PALETTES.some(p => p.id === v) ? (v as PaletteId) : 'ember';
}
export function applyPalette(): void {
  const id = getPalette();
  if (id === 'ember') delete document.documentElement.dataset.palette; else document.documentElement.dataset.palette = id;
}
export function setPalette(id: PaletteId): void {
  store.set('palette', id);
  applyPalette();
  listeners.forEach(cb => cb());
}

export function onPrefsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Call once at startup, before first paint of the app. */
export function initPrefs(): void {
  applyTheme();
  applyPalette();
  darkMQ?.addEventListener?.('change', () => { if (getThemePref() === 'auto') { applyTheme(); listeners.forEach(cb => cb()); } });
}
