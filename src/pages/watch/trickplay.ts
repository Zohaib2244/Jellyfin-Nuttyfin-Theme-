/**
 * Seek-bar previews from Jellyfin trickplay: the server cuts the video into thumbnails (one every `intervalMs`) and packs
 * `tileWidth` x `tileHeight` of them into each JPEG sheet, /Videos/{id}/Trickplay/{width}/{sheet}.jpg. Pure maths + a tiny preloader.
 */
import type { Chapter, TrickplayInfo } from '../../api/types';

export interface Tile {
  /** which JPEG sheet */
  sheet: number;
  /** column and row inside the sheet (0-based) */
  col: number;
  row: number;
}

export function tileAt(info: TrickplayInfo, seconds: number): Tile {
  const last = Math.max(0, info.thumbnailCount - 1);
  const index = Math.min(last, Math.max(0, Math.floor((seconds * 1000) / info.intervalMs)));
  const perSheet = info.tileWidth * info.tileHeight;
  const within = index % perSheet;
  return { sheet: Math.floor(index / perSheet), col: within % info.tileWidth, row: Math.floor(within / info.tileWidth) };
}

/** CSS for a `<div>` showing one tile as a background, scaled to `shownWidth` px wide. */
export function tileStyle(info: TrickplayInfo, t: Tile, url: string, shownWidth: number): { backgroundImage: string; backgroundSize: string; backgroundPosition: string; width: string; height: string } {
  const k = shownWidth / info.width;
  const h = Math.round(info.height * k);
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: `${info.width * info.tileWidth * k}px ${info.height * info.tileHeight * k}px`,
    backgroundPosition: `-${t.col * info.width * k}px -${t.row * info.height * k}px`,
    width: `${shownWidth}px`,
    height: `${h}px`,
  };
}

/** Index of the chapter playing at `t` (-1 if none). Chapters are sorted by start. */
export function chapterAt(chapters: readonly Chapter[], seconds: number): number {
  let at = -1;
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i] as Chapter;
    if (c.startTicks / 1e7 <= seconds) at = i; else break;
  }
  return at;
}

/** Chapter tick positions as fractions (0-1) of the duration; the first chapter (at 0) and any past the end are left out. */
export function chapterTicks(chapters: readonly Chapter[], duration: number): number[] {
  if (!(duration > 0)) return [];
  return chapters.map(c => c.startTicks / 1e7 / duration).filter(f => f > 0.005 && f < 0.995);
}

/** Warm the browser cache for the sheets a drag will need next. */
export function preloadSheets(urls: readonly string[]): void {
  for (const u of urls) { const img = new Image(); img.decoding = 'async'; img.src = u; }
}
