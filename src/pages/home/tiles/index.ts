/**
 * Every Home tile, and the tab it lives in. A tile belongs to EXACTLY ONE tab (docs/DESIGN-RULES.md): `tabOf` and
 * `assertUniqueTiles` enforce it (tests/home-tiles.test.ts runs it, and the page refuses to start otherwise).
 */
import { becauseTile, genresTile, moodTile, recsTile, shortTile, tvTile } from './explore';
import { finishTile, leavingTile, onTheGoTile, setsTile } from './continue';
import { cwMiniTile } from './cwmini';
import { keepTile } from './keep';
import { nextTile } from './next';
import { comingTile, newFilmsTile, newHeroTile, newShowsTile } from './newly';
import { whatsNewTile } from './whatsnew';
import type { HomeTab, TileDef } from '../tile';

export const TABS: ReadonlyArray<{ id: HomeTab; label: string }> = [
  { id: 'home', label: 'Home' }, { id: 'continue', label: 'Continue Watching' }, { id: 'explore', label: 'Explore' },
  { id: 'new', label: 'Newly Added' },
];

export const TILES: readonly TileDef[] = [
  // Home
  keepTile, cwMiniTile, nextTile, whatsNewTile, // phone order: hero, then what you are partway through
  // Continue Watching
  onTheGoTile, finishTile, setsTile, leavingTile,
  // Explore
  recsTile, moodTile, shortTile, tvTile, becauseTile, genresTile,
  // Newly Added
  newHeroTile, newFilmsTile, newShowsTile, comingTile,
];

export const isTab = (v: string | undefined): v is HomeTab => TABS.some(t => t.id === v);

/** Tiles of one tab, in default order. */
export const tilesOf = (tab: HomeTab, all: readonly TileDef[] = TILES): TileDef[] => all.filter(t => t.tab === tab);

/** Throws if a tile id appears twice (which would put one tile in two tabs) or names an unknown tab. */
export function assertUniqueTiles(all: readonly TileDef[] = TILES): void {
  const seen = new Map<string, HomeTab>();
  for (const t of all) {
    if (!isTab(t.tab)) throw new Error(`Tile ${t.id} names an unknown tab "${String(t.tab)}"`);
    const was = seen.get(t.id);
    if (was) throw new Error(`Tile ${t.id} is in both ${was} and ${t.tab}: every tile belongs to exactly one tab`);
    seen.set(t.id, t.tab);
  }
}
