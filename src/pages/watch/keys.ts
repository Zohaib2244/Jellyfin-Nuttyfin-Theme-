/** Keyboard map for the player. Pure: key event facts in, an action name out. */

export type KeyAction =
  | 'toggle' | 'back10' | 'fwd10' | 'volUp' | 'volDown' | 'fullscreen' | 'mute' | 'subtitles' | 'skip' | 'next' | 'pip'
  | 'speedUp' | 'speedDown' | 'chapterPrev' | 'chapterNext' | 'escape' | `percent${number}`;

export interface KeyFacts {
  key: string;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
  /** a button, link, summary or other control has focus and wants Space / Enter for itself */
  onControl?: boolean;
  /** a slider (seek bar, volume) has focus and wants the arrow keys for itself */
  onSlider?: boolean;
  /** a dialog (the settings sheet) is open */
  sheetOpen?: boolean;
}

/** null = not ours, leave the key alone. */
export function keyAction(k: KeyFacts): KeyAction | null {
  if (k.ctrl || k.alt || k.meta) return null;
  if (k.key === 'Escape') return 'escape';
  if (k.sheetOpen) return null;
  if ((k.key === ' ' || k.key === 'Enter') && k.onControl) return null;
  if (k.onSlider && k.key.startsWith('Arrow')) return null;
  const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;
  switch (key) {
    case ' ': case 'k': return 'toggle';
    case 'j': case 'ArrowLeft': return 'back10';
    case 'l': case 'ArrowRight': return 'fwd10';
    case 'ArrowUp': return 'volUp';
    case 'ArrowDown': return 'volDown';
    case 'f': return 'fullscreen';
    case 'm': return 'mute';
    case 'c': return 'subtitles';
    case 'i': return 'skip';
    case 'p': return 'pip';
    case 'n': return k.shift ? 'next' : null;
    case '<': return 'speedDown';
    case '>': return 'speedUp';
    case 'PageUp': return 'chapterPrev';
    case 'PageDown': return 'chapterNext';
    default:
      if (/^[0-9]$/.test(key)) return `percent${Number(key) * 10}`;
      return null;
  }
}

/** 'percent40' -> 40 */
export const percentOf = (a: KeyAction): number | null => {
  const m = /^percent(\d+)$/.exec(a);
  return m ? Number(m[1]) : null;
};

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** One step up or down the speed list, staying inside it. */
export function stepSpeed(current: number, dir: 1 | -1): number {
  const i = SPEEDS.findIndex(s => s >= current - 1e-6);
  const at = i < 0 ? SPEEDS.length - 1 : i;
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, at + dir))] as number;
}
