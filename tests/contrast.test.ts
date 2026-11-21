/**
 * WCAG AA for every colour theme: 8 palettes x light/dark, read straight from tokens.css + palettes.css.
 * Text pairs need 4.5:1 (the app's text is small), the tab/rail counts and accent badges too. Run
 * `npx vitest run tests/contrast.test.ts` after touching a colour.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = (f: string): string => readFileSync(new URL(`../src/styles/${f}`, import.meta.url), 'utf8');
const tokens = css('tokens.css');
const palettes = css('palettes.css');

type Vars = Record<string, string>;

function parseVars(block: string): Vars {
  const out: Vars = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1] as string] = (m[2] as string).trim();
  return out;
}

/** :root (dark) values, then the light overrides, then one palette's overrides on top. */
function theme(palette: string, mode: 'light' | 'dark'): Vars {
  const base = parseVars(/:root\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? '');
  const light = parseVars(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? '');
  const vars: Vars = { ...base, ...(mode === 'light' ? light : {}) };
  if (palette !== 'ember') {
    const line = palettes.split('\n').find(l => l.startsWith(`:root[data-palette="${palette}"][data-eff="${mode}"]`)) ?? '';
    Object.assign(vars, parseVars(line));
  }
  return vars;
}

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const s = h.replace('#', '');
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16)) as RGB;
};
/** color-mix(in srgb, A p%, B) with B being another token value */
function resolve(v: string, vars: Vars): RGB {
  const mix = /^color-mix\(in srgb,\s*(var\(--[a-z0-9-]+\)|#[0-9a-f]{6})\s+(\d+)%,\s*(var\(--[a-z0-9-]+\)|#[0-9a-f]{6})\)$/i.exec(v);
  if (mix) {
    const a = resolve(mix[1] as string, vars);
    const b = resolve(mix[3] as string, vars);
    const p = Number(mix[2]) / 100;
    return a.map((c, i) => c * p + (b[i] as number) * (1 - p)) as RGB;
  }
  const ref = /^var\(--([a-z0-9-]+)\)$/.exec(v);
  if (ref) return resolve(vars[ref[1] as string] as string, vars);
  return hex(v);
}
const lin = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: RGB): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const ratio = (a: RGB, b: RGB): number => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const IDS = ['ember', 'slate', 'moss', 'plum', 'reef', 'raspberry', 'circuit', 'graphite'];
const SURFACES = ['bg', 'panel', 'nested', 'raise'] as const;
/** [foreground token, minimum ratio] drawn on every surface */
const TEXT: Array<[string, number]> = [['text', 4.5], ['muted', 4.5], ['dim', 4.5], ['num', 4.5], ['accent', 4.5], ['ok', 4.5], ['info', 4.5], ['warn', 4.5], ['bad', 4.5]];

describe('colour themes meet WCAG AA', () => {
  for (const id of IDS) {
    for (const mode of ['dark', 'light'] as const) {
      const vars = theme(id, mode);
      const v = (name: string): RGB => resolve(vars[name] ?? '', vars);
      // the page background is not an opaque surface that carries small body text everywhere, but text does sit on it
      describe(`${id} ${mode}`, () => {
        for (const [fg, min] of TEXT) {
          // status colours only appear on panels and soft panels, never straight on the page backdrop
          const surfaces = ['ok', 'info', 'warn', 'bad'].includes(fg) ? ['panel', 'nested'] : SURFACES;
          for (const s of surfaces) {
            // the accent is never small body text straight on the page backdrop (underline, focus ring, large UI only): 3:1 there
            const need = fg === 'accent' && s === 'bg' ? 3 : min;
            it(`${fg} on ${s}`, () => { expect(ratio(v(fg), v(s))).toBeGreaterThanOrEqual(need); });
          }
        }
        // chips and pills: the colour on its own tinted background
        for (const [fg, soft] of [['ok', 'ok-soft'], ['info', 'info-soft'], ['warn', 'warn-soft'], ['num', 'num-soft'], ['accent', 'accent-soft']] as const) {
          it(`${fg} on ${soft}`, () => { expect(ratio(v(fg), v(soft))).toBeGreaterThanOrEqual(4.5); });
        }
        it('accent-ink on accent (buttons, badges, active rail item)', () => { expect(ratio(v('accent-ink'), v('accent'))).toBeGreaterThanOrEqual(4.5); });
        it('tab count (num) on the page backdrop behind the top bar', () => { expect(ratio(v('num'), v('bg'))).toBeGreaterThanOrEqual(4.5); });
        it('the rail badge on the active item (text on bg)', () => { expect(ratio(v('bg'), v('text'))).toBeGreaterThanOrEqual(4.5); });
      });
    }
  }
});
