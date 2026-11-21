/**
 * The Library's section tabs (top bar): Movies, Shows, 4K Movies, Collections.
 * They are not separate routes: Movies and Shows are #/movies and #/shows, 4K Movies is "#/movies?xtra=4k"
 * and Collections is "#/movies?view=shelves". So the tab is always worked out FROM the URL state (never stored
 * on its own), which keeps deep links, Back/forward and the in-page switches in agreement.
 */
import type { Tab } from '../types';
import { activeKeys, type Group, type LibKind, type LibState } from './filters';

export type LibTab = 'movies' | 'shows' | '4k' | 'sets';
export interface LibCounts { movies?: number; shows?: number; fourK?: number; unseen?: number }

export const LIB_TABS: Record<LibTab, { title: string; path: string }> = {
  movies: { title: 'Movies', path: '/movies' },
  shows: { title: 'Shows', path: '/shows' },
  '4k': { title: '4K Movies', path: '/movies?xtra=4k' },
  sets: { title: 'Collections', path: '/movies?view=shelves' },
};

/** Which tab the current state belongs to: 4K Movies only when "In 4K" is the one and only switch. */
export function libTabOf(kind: LibKind, st: LibState, groups: readonly Group[]): LibTab {
  if (kind === 'shows') return 'shows';
  if (st.view === 'shelves') return 'sets';
  const only4k = st.sel.xtra?.size === 1 && st.sel.xtra.has('4k') && activeKeys(st.sel, groups).length === 1;
  return only4k ? '4k' : 'movies';
}

/** The tabs to show. 4K Movies appears only when the server has any 4K films (or while you are on that tab). */
export function libTabList(counts: LibCounts, current: LibTab): Tab[] {
  const tab = (id: LibTab, count?: number): Tab => ({ id, label: LIB_TABS[id].title, ...(count != null ? { count } : {}) });
  return [
    tab('movies', counts.movies),
    tab('shows', counts.shows),
    ...((counts.fourK ?? 0) > 0 || current === '4k' ? [tab('4k', counts.fourK)] : []),
    tab('sets'),
  ];
}
