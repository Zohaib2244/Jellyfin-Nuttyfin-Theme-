/**
 * Inline SVG icons (unicode glyphs render as boxes on this setup, so icons are always inline SVG).
 * Symbols are lifted from design/mockups/home.html. Usage:
 *   html`<button>${icon('play')} Play</button>`       // <svg class="i"><use href="#i-play"/></svg>
 * The sprite is injected once by mountIconSprite() (called from main.ts).
 */
import { raw, type SafeHtml } from '../lib/html';

const SYMBOLS = {
  home: `<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>`,
  house: `<path d="M3 11.5l9-7.5 9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5h4v5"/>`,
  film: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>`,
  tv: `<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 21h8M8 2l4 4 4-4"/>`,
  inbox: `<path d="M12 3v10M8 9l4 4 4-4"/><path d="M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>`,
  play: `<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor" stroke="none"/>`,
  back: `<path d="M15 5l-7 7 7 7"/>`,
  next: `<path d="M9 5l7 7-7 7"/>`,
  down: `<path d="M6 9l6 6 6-6"/>`,
  heart: `<path d="M12 20s-7.5-4.6-9.2-9.3C1.6 7.3 3.8 4 7.2 4c2 0 3.6 1.1 4.8 2.8C13.2 5.1 14.8 4 16.8 4c3.4 0 5.6 3.3 4.4 6.7C19.5 15.4 12 20 12 20z"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  bell: `<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>`,
  x: `<path d="M6 6l12 12M18 6L6 18"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
  dl: `<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>`,
  ask: `<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>`,
  user: `<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`,
  cc: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 13h4M13 13h4M7 16h7"/>`,
  gear: `<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>`,
  ext: `<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>`,
  lock: `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`,
  eyeoff: `<path d="M3 3l18 18"/><path d="M10.6 5.1A9.9 9.9 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.6 6.6C4.5 8 3 10 2 12c1 2.5 5 7 10 7 1.6 0 3.1-.4 4.4-1.1"/><path d="M9.9 10a3 3 0 0 0 4.2 4.2"/>`,
  plane: `<path d="M21 15.5v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0v5l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>`,
  grid: `<rect x="3" y="3" width="10" height="10" rx="2"/><rect x="15" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="11" width="6" height="10" rx="1.5"/><rect x="3" y="15" width="10" height="6" rx="1.5"/>`,
  grip: `<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>`,
  resize: `<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>`,
  undo: `<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>`,
  spark: `<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>`,
  cal: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>`,
  chart: `<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`,
  stack: `<rect x="3" y="8" width="13" height="13" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v12"/>`,
  shuffle: `<path d="M3 6h3.5a5 5 0 0 1 4 2l3 4a5 5 0 0 0 4 2H21M3 18h3.5a5 5 0 0 0 4-2M14.5 8a5 5 0 0 1 3-2H21"/><path d="M18 3l3 3-3 3M18 11l3 3-3 3"/>`,
  k4: `<rect x="2.5" y="5" width="19" height="14" rx="3"/><text x="12" y="15.6" font-size="8.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="700">4K</text>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>`,
  bot: `<rect x="3.5" y="5" width="17" height="14" rx="4"/><path d="M8 10.5v3M16 10.5v3"/>`,
  flag: `<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>`,
  hourglass: `<path d="M6 3h12M6 21h12"/><path d="M7 3v3l5 6 5-6V3M7 21v-3l5-6 5 6v3"/>`,
  layers: `<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>`,
  timer: `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>`,
  gem: `<path d="M6 3h12l3 6-9 12L3 9z"/><path d="M3 9h18M9 3l3 6 3-6M12 21L9 9M12 21l3-12"/>`,
  server: `<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6M11 16.5h6"/>`,
  popcorn: `<path d="M5 9l2 12h10l2-12z"/><path d="M9.5 9l.5 12M14.5 9L14 21"/><path d="M5 9a3 3 0 0 1 3-4 3 3 0 0 1 4-2 3 3 0 0 1 4 2 3 3 0 0 1 3 4"/>`,
  sofa: `<path d="M4 11V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3"/><path d="M2 13a2 2 0 0 1 4 0v2h12v-2a2 2 0 0 1 4 0v5H2z"/><path d="M5 18v2M19 18v2"/>`,
  users: `<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>`,
  cloud: `<path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.5A3.75 3.75 0 0 1 17.5 18z"/>`,
  chat: `<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>`,
  palette: `<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2s-1-1.6-1-2.6S14 15 15 15h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="11" cy="7" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.2" fill="currentColor" stroke="none"/>`,
  swap: `<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>`,
  logout: `<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>`,
  userplus: `<circle cx="10" cy="8" r="4"/><path d="M3 20a7 7 0 0 1 14 0M19 8v6M16 11h6"/>`,
  shield: `<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>`,
  bksp: `<path d="M9 5h11v14H9l-6-7z"/><path d="M12 9l5 6M17 9l-5 6"/>`,
  eye: `<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`,
  auto: `<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>`,
  sunsm: `<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>`,
  moonsm: `<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>`,
  send: `<path d="M4 12l16-8-6 17-3-7z"/><path d="M11 14l9-10"/>`,
  mug: `<path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3c-.8 1 .8 2 0 3M12 3c-.8 1 .8 2 0 3"/>`,
  smile: `<circle cx="12" cy="12" r="9"/><path d="M8 14.5c1 1.5 2.4 2.2 4 2.2s3-.7 4-2.2"/><path d="M9 9.5h.01M15 9.5h.01"/>`,
  ghost: `<path d="M5 20V11a7 7 0 0 1 14 0v9l-2.3-1.6L14.3 20 12 18.4 9.7 20l-2.4-1.6z"/><path d="M9.5 10.5h.01M14.5 10.5h.01"/>`,
  bolt: `<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>`,
  spiral: `<path d="M12 12a1.5 1.5 0 0 1 1.5 1.5 3 3 0 0 1-3 3A4.5 4.5 0 0 1 6 12a6 6 0 0 1 6-6 7.5 7.5 0 0 1 7.5 7.5A9 9 0 0 1 10.5 22"/>`,
  music: `<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>`,
  paw: `<ellipse cx="12" cy="16" rx="4.5" ry="3.8"/><circle cx="6" cy="10.5" r="1.8"/><circle cx="9.5" cy="6.5" r="1.8"/><circle cx="14.5" cy="6.5" r="1.8"/><circle cx="18" cy="10.5" r="1.8"/>`,
  rocket: `<path d="M12 3c3 2 5 5.5 5 9.5V17H7v-4.5C7 8.5 9 5 12 3z"/><path d="M7 14l-3 3v3l3-1.5M17 14l3 3v3l-3-1.5M10 21h4"/><circle cx="12" cy="10" r="1.6"/>`,
} as const;

export type IconName = keyof typeof SYMBOLS;
export const ICON_NAMES = Object.keys(SYMBOLS) as IconName[];

/** An icon reference. `cls` adds extra classes next to the base `i` class (e.g. 'spin'). Decorative: aria-hidden. */
export function icon(name: IconName, cls = ''): SafeHtml {
  return raw(`<svg class="i${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`);
}

export function iconSpriteMarkup(): string {
  const symbols = ICON_NAMES.map(n => `<symbol id="i-${n}" viewBox="0 0 24 24">${SYMBOLS[n]}</symbol>`).join('');
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${symbols}</svg>`;
}

/** Injects the sprite once. Safe to call repeatedly. */
export function mountIconSprite(root: HTMLElement = document.body): void {
  if (root.querySelector('#nf-icon-sprite')) return;
  const holder = document.createElement('div');
  holder.id = 'nf-icon-sprite';
  holder.hidden = true;
  holder.innerHTML = iconSpriteMarkup();
  root.prepend(holder);
}

/** 16x16 pixel-art glyphs (same family as the mockup's weather icons). Used by the theme switch. */
const PIXEL = {
  sun: '<g fill="#ffcf5a"><rect x="6" y="6" width="4" height="4"/><rect x="5" y="7" width="6" height="2"/><rect x="7" y="5" width="2" height="6"/><rect x="7" y="1" width="2" height="2"/><rect x="7" y="13" width="2" height="2"/><rect x="1" y="7" width="2" height="2"/><rect x="13" y="7" width="2" height="2"/><rect x="3" y="3" width="2" height="2"/><rect x="11" y="3" width="2" height="2"/><rect x="3" y="11" width="2" height="2"/><rect x="11" y="11" width="2" height="2"/></g>',
  moon: '<g fill="#e8e0ff"><rect x="6" y="2" width="3" height="1"/><rect x="5" y="3" width="2" height="1"/><rect x="4" y="4" width="3" height="2"/><rect x="3" y="6" width="4" height="3"/><rect x="4" y="9" width="5" height="1"/><rect x="4" y="10" width="8" height="1"/><rect x="5" y="11" width="6" height="1"/><rect x="7" y="12" width="3" height="1"/></g><g fill="#ffcf5a"><rect x="12" y="3" width="1" height="1"/><rect x="11" y="6" width="1" height="1"/><rect x="14" y="8" width="1" height="1"/></g>',
} as const;

export function pixelIcon(name: keyof typeof PIXEL, cls = ''): SafeHtml {
  return raw(`<svg class="px ${name}${cls ? ` ${cls}` : ''}" viewBox="0 0 16 16" aria-hidden="true">${PIXEL[name]}</svg>`);
}
