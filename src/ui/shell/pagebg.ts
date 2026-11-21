/**
 * Page background layer (the fixed `.pagebg` element behind everything).
 * CSS does the drawing (src/styles/backgrounds.css), keyed off `<body data-bg="...">`.
 * This module owns: the list of backgrounds, switching, the Time-of-day sky colours, and two hooks that
 * later pages can feed: setAmbientImage(url) ("Ambient colour") and setWallImages(urls) ("Poster wall").
 */

export type BackgroundId = 'beam' | 'plain' | 'dots' | 'grain' | 'sky' | 'pixel' | 'ambient' | 'wall';

export interface BackgroundDef {
  id: BackgroundId;
  label: string;
  hint: string;
  /** false = the CSS exists but nothing feeds it yet, so the picker hides it until a page wires the hook. */
  wired: boolean;
}

export const BACKGROUNDS: readonly BackgroundDef[] = [
  { id: 'beam', label: 'Projector', hint: 'A slow beam of light with drifting dust', wired: true },
  { id: 'plain', label: 'Plain', hint: 'Just the warm base colour', wired: true },
  { id: 'dots', label: 'Dot grid', hint: 'Quiet dots, fades down the page', wired: true },
  { id: 'grain', label: 'Film grain', hint: 'Warm vignette and soft grain', wired: true },
  { id: 'sky', label: 'Time of day', hint: 'Sky colours follow the clock', wired: true },
  { id: 'pixel', label: 'NutBot pixels', hint: 'Tiny NutBots, tiled', wired: true },
  { id: 'ambient', label: 'Ambient colour', hint: 'Glow from what you are watching', wired: false },
  { id: 'wall', label: 'Poster wall', hint: 'Your library, tilted and very faint', wired: true },
];

export const DEFAULT_BACKGROUND: BackgroundId = 'wall';

export function isBackgroundId(v: unknown): v is BackgroundId {
  return typeof v === 'string' && BACKGROUNDS.some(b => b.id === v);
}

/* ── Time of day (colours from the mockup) ── */
export type DaySlot = 'early' | 'breakfast' | 'morning' | 'weekend' | 'lunch' | 'afternoon' | 'school' | 'dinner' | 'evening' | 'friday' | 'late' | 'midnight';

/** [sky-a, sky-b, orb x, orb y] */
export const SKY: Record<DaySlot, readonly [string, string, string, string]> = {
  early: ['#c9a6e8', '#f4b860', '80%', '94%'], breakfast: ['#f4b860', '#ff8a4c', '84%', '80%'], morning: ['#f2d27a', '#7fb3e8', '70%', '18%'],
  weekend: ['#ffd27a', '#ff9a6a', '78%', '26%'], lunch: ['#f6e08a', '#6fa3e0', '58%', '4%'], afternoon: ['#e8d27a', '#6fa3e0', '66%', '10%'],
  school: ['#f0b860', '#6f9ad0', '76%', '40%'], dinner: ['#ff8a4c', '#c0506a', '88%', '62%'], evening: ['#ff6b2b', '#b0306a', '92%', '70%'],
  friday: ['#ff5aa0', '#6a2cb0', '50%', '16%'], late: ['#8a96ff', '#2c2678', '86%', '12%'], midnight: ['#6a76ff', '#141040', '18%', '10%'],
};

export function slotOf(d: Date): DaySlot {
  const h = d.getHours();
  const wd = d.getDay();
  const weekend = wd === 0 || wd === 6;
  if (h < 5) return 'midnight';
  if (h < 7) return 'early';
  if (weekend && h < 12) return 'weekend';
  if (h < 10) return 'breakfast';
  if (h < 12) return 'morning';
  if (h < 14) return 'lunch';
  if (h < 16) return 'afternoon';
  if (h < 18) return weekend ? 'afternoon' : 'school';
  if (wd === 5 && h < 23) return 'friday';
  if (h < 20) return 'dinner';
  if (h < 23) return 'evening';
  return 'late';
}

export function applySky(now: Date = new Date()): DaySlot {
  const slot = slotOf(now);
  const [a, b, x, y] = SKY[slot];
  const s = document.body.style;
  s.setProperty('--sky-a', a);
  s.setProperty('--sky-b', b);
  s.setProperty('--ox', x);
  s.setProperty('--oy', y);
  if (slot === 'late' || slot === 'midnight' || slot === 'friday') document.body.dataset.stars = '';
  else delete document.body.dataset.stars;
  return slot;
}

/* ── Controller ── */
export interface PageBg {
  set(id: BackgroundId): void;
  get(): BackgroundId;
  /** Hook for "Ambient colour": pass a backdrop image URL (or null to clear). Only shown while data-bg="ambient". */
  setAmbientImage(url: string | null): void;
  /** Hook for "Poster wall": pass poster image URLs (or [] to clear). Only shown while data-bg="wall". */
  setWallImages(urls: string[]): void;
}

export function createPageBg(el: HTMLElement, initial: BackgroundId = DEFAULT_BACKGROUND): PageBg {
  let current: BackgroundId = initial;
  let ambientUrl: string | null = null;
  let wallUrls: string[] = [];
  let skyTimer: number | undefined;

  const draw = () => {
    document.body.dataset.bg = current;
    window.clearInterval(skyTimer);
    el.replaceChildren();
    if (current === 'sky') {
      applySky();
      el.innerHTML = '<i class="orb"></i><i class="stars"></i>';
      skyTimer = window.setInterval(() => applySky(), 5 * 60_000);
    } else if (current === 'ambient' && ambientUrl) {
      const img = new Image();
      img.className = 'amb out';
      img.alt = '';
      img.src = ambientUrl;
      el.append(img);
      requestAnimationFrame(() => requestAnimationFrame(() => img.classList.remove('out')));
    } else if (current === 'wall' && wallUrls.length) {
      const wall = document.createElement('div');
      wall.className = 'wall';
      for (const u of wallUrls.slice(0, 60)) {
        const span = document.createElement('span');
        const img = new Image();
        img.alt = '';
        img.decoding = 'async';
        img.setAttribute('fetchpriority', 'low');
        img.onload = () => img.classList.add('in');
        img.src = u;
        span.append(img);
        wall.append(span);
      }
      el.append(wall);
    }
  };

  draw();
  return {
    set(id) { if (id !== current) { current = id; draw(); } },
    get: () => current,
    setAmbientImage(url) { ambientUrl = url; if (current === 'ambient') draw(); },
    setWallImages(urls) { wallUrls = urls; if (current === 'wall') draw(); },
  };
}
