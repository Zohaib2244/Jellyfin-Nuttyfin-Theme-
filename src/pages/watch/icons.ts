/** The player's own icon set (inline SVG, ported from design/mockups/player.html). Ids are prefixed `pl-` so nothing clashes with the app sprite. */
import { raw, type SafeHtml } from '../../lib/html';

const SYMBOLS = {
  play: `<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor" stroke="none"/>`,
  pause: `<rect x="6" y="4.5" width="3.6" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14.4" y="4.5" width="3.6" height="15" rx="1" fill="currentColor" stroke="none"/>`,
  back: `<path d="M15 5l-7 7 7 7"/>`,
  down: `<path d="M6 9l6 6 6-6"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  x: `<path d="M6 6l12 12M18 6L6 18"/>`,
  rw: `<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/><text x="12.4" y="15.4" font-size="7.2" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="700">10</text>`,
  ff: `<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/><text x="11.6" y="15.4" font-size="7.2" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="700">10</text>`,
  skipnext: `<path d="M5.5 5.5l9.5 6.5-9.5 6.5z" fill="currentColor" stroke="none"/><path d="M18.5 5.5v13"/>`,
  vol: `<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.5a8 8 0 0 1 0 11"/>`,
  vollow: `<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/>`,
  mute: `<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>`,
  cc: `<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 13.5h4M13.5 13.5H17M7 10h2M11.5 10H17"/>`,
  pip: `<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11.5" width="6.5" height="5" rx="1" fill="currentColor" stroke="none"/>`,
  full: `<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>`,
  unfull: `<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>`,
  restart: `<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>`,
  ext: `<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>`,
  warn: `<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/>`,
} as const;

export type PlIcon = keyof typeof SYMBOLS;

export const ic = (name: PlIcon): SafeHtml => raw(`<svg class="i" aria-hidden="true"><use href="#pl-${name}"/></svg>`);

export const spriteMarkup = (): string =>
  `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${(Object.keys(SYMBOLS) as PlIcon[]).map(n => `<symbol id="pl-${n}" viewBox="0 0 24 24">${SYMBOLS[n]}</symbol>`).join('')}</svg>`;
