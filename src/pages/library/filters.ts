/**
 * The "mixing desk": switch groups, how they map to a Jellyfin query, how they live in the URL, and the same
 * rules as a plain predicate (used where the list is already in memory: shelves, show lanes).
 * Pure module, unit-tested. Rules: within one group the switches add up (OR), groups narrow each other (AND).
 * Mood and Genre are two ways to pick genres and share one bucket, so they add together.
 */
import type { ItemsQuery, SortKey, Title } from '../../api/types';
import type { XIconName } from '../common/icons';

export type LibKind = 'movies' | 'shows';
export type ViewId = 'posters' | 'wall' | 'list' | 'shelves' | 'progress';
export type OrderId = 'added' | 'az' | 'short' | 'rating' | 'year' | 'left';
export type Lane = 'new' | 'watching' | 'not' | 'done';

export interface Key {
  k: string;
  t: string;
  ratings?: string[];
  genres?: string[];
  years?: number[];
  /** [min, max] minutes */
  runtime?: [number | undefined, number | undefined];
  played?: boolean;
  resumable?: boolean;
  is4k?: boolean;
  status?: 'Continuing' | 'Ended';
  lane?: Lane;
}

export interface Group {
  id: string;
  label: string;
  icon: XIconName;
  /** pick one only */
  one?: boolean;
  /** groups sharing a bucket add together instead of narrowing each other */
  bucket?: string;
  keys: Key[];
  /** wide groups get more room on the desk */
  wide?: boolean;
}

export type Selection = Record<string, Set<string>>;

const EVERYONE = ['G', 'PG', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TP'];
const TEENS = ['PG-13', 'TV-14'];
const GROWN = ['R', 'NC-17', 'TV-MA', 'NR', 'Unrated'];

const WHO: Group = {
  id: 'who', label: "Who it's for", icon: 'people', keys: [
    { k: 'all', t: 'Everyone', ratings: EVERYONE },
    { k: 'teen', t: 'Teens and up', ratings: TEENS },
    { k: 'adult', t: 'Grown-ups', ratings: GROWN },
  ],
};

const decade = (d: number): number[] => Array.from({ length: 10 }, (_, i) => d + i);

export const MOVIE_GROUPS: Group[] = [
  WHO,
  { id: 'len', label: "Time you've got", icon: 'clock', one: true, keys: [
    { k: '90', t: 'Under 90 min', runtime: [undefined, 90] },
    { k: '120', t: 'Under 2 hours', runtime: [undefined, 120] },
    { k: 'long', t: 'Long one, 2 h+', runtime: [121, undefined] },
  ] },
  { id: 'seen', label: 'Seen it?', icon: 'check', one: true, keys: [
    { k: 'not', t: 'Not seen yet', played: false },
    { k: 'part', t: 'Started', resumable: true },
    { k: 'seen', t: 'Seen it', played: true },
  ] },
  { id: 'mood', label: 'Mood', icon: 'spark', bucket: 'genres', wide: true, keys: [
    { k: 'laugh', t: 'Laughs', genres: ['Comedy'] }, { k: 'thrill', t: 'Thrills', genres: ['Thriller'] },
    { k: 'scary', t: 'Scary', genres: ['Horror'] }, { k: 'adv', t: 'Adventure', genres: ['Adventure', 'Action'] },
    { k: 'space', t: 'Space and sci-fi', genres: ['Science Fiction'] }, { k: 'who', t: 'Whodunit', genres: ['Mystery', 'Crime'] },
    { k: 'true', t: 'True stories', genres: ['History', 'War', 'Documentary'] }, { k: 'toon', t: 'Cartoons', genres: ['Animation'] },
  ] },
  { id: 'era', label: 'Era', icon: 'cal', keys: [
    { k: '70', t: '1970s', years: decade(1970) }, { k: '80', t: '1980s', years: decade(1980) }, { k: '90', t: '1990s', years: decade(1990) },
    { k: '00', t: '2000s', years: decade(2000) }, { k: '10', t: '2010s', years: decade(2010) }, { k: '20', t: '2020s', years: decade(2020) },
  ] },
  { id: 'xtra', label: 'Extras', icon: 'stack', keys: [{ k: '4k', t: 'In 4K', is4k: true }] },
];

export const SHOW_GROUPS: Group[] = [
  { id: 'where', label: 'Where you are', icon: 'flag', keys: [
    { k: 'new', t: 'New episodes', lane: 'new' }, { k: 'watching', t: 'Watching', lane: 'watching' },
    { k: 'not', t: 'Not started', lane: 'not' }, { k: 'done', t: 'Finished', lane: 'done' },
  ] },
  WHO,
  { id: 'mood', label: 'Mood', icon: 'spark', bucket: 'genres', wide: true, keys: [
    { k: 'myst', t: 'Mystery', genres: ['Mystery'] }, { k: 'space', t: 'Sci-fi', genres: ['Sci-Fi & Fantasy', 'Science Fiction'] },
    { k: 'laugh', t: 'Laughs', genres: ['Comedy'] }, { k: 'dino', t: 'Documentary', genres: ['Documentary'] },
    { k: 'adv', t: 'Action', genres: ['Action & Adventure', 'Action', 'Adventure'] }, { k: 'crime', t: 'Spies and crime', genres: ['Crime'] },
  ] },
  { id: 'xtra', label: 'Extras', icon: 'stack', keys: [
    { k: 'air', t: 'Still coming out', status: 'Continuing' }, { k: 'ended', t: 'Finished run', status: 'Ended' },
  ] },
];

/** The Genre group is built from what the server reports, so it only offers genres that exist. */
export function genreGroup(genres: readonly { name: string; count: number }[]): Group {
  return {
    id: 'genre', label: 'Genre', icon: 'film', bucket: 'genres', wide: true,
    keys: genres.filter(g => g.count > 0).map(g => ({ k: g.name, t: g.name, genres: [g.name] })),
  };
}

export const groupsFor = (kind: LibKind, genres: readonly { name: string; count: number }[] = []): Group[] => {
  const base = kind === 'movies' ? MOVIE_GROUPS : SHOW_GROUPS;
  if (!genres.length) return base;
  const at = base.findIndex(g => g.id === 'mood');
  return [...base.slice(0, at + 1), genreGroup(genres), ...base.slice(at + 1)];
};

/* ── order & view ── */
export const ORDERS: Record<LibKind, Array<[OrderId, string]>> = {
  movies: [['added', 'Just added'], ['az', 'A to Z'], ['short', 'Shortest'], ['rating', 'Best rated'], ['year', 'Newest year']],
  shows: [['added', 'Just added'], ['az', 'A to Z'], ['rating', 'Best rated'], ['left', 'Fewest left']],
};
export const VIEWS: Record<LibKind, Array<[ViewId, string, XIconName]>> = {
  movies: [['posters', 'Posters', 'vposter'], ['wall', 'Wall of pictures', 'vwall'], ['list', 'List with details', 'vlist'], ['shelves', 'Shelves by collection', 'vshelf']],
  shows: [['progress', 'Progress', 'vprog'], ['posters', 'Posters', 'vposter'], ['wall', 'Wall of pictures', 'vwall'], ['list', 'List with details', 'vlist']],
};
export const DEFAULT_VIEW: Record<LibKind, ViewId> = { movies: 'posters', shows: 'progress' };
export const DEFAULT_ORDER: Record<LibKind, OrderId> = { movies: 'added', shows: 'added' };

const SORT_OF: Record<OrderId, { sort: SortKey; descending: boolean }> = {
  added: { sort: 'added', descending: true },
  az: { sort: 'name', descending: false },
  short: { sort: 'runtime', descending: false },
  rating: { sort: 'rating', descending: true },
  year: { sort: 'year', descending: true },
  left: { sort: 'name', descending: false }, // "fewest left" is ordered in memory (the server does not know)
};

/* ── selection <-> URL ── */
export interface LibState {
  sel: Selection;
  order: OrderId;
  view: ViewId;
}

const bucketOf = (g: Group): string => g.bucket ?? g.id;

/** Unknown or stale keys in a pasted URL are dropped, so a bad link never breaks the page. Genre keys are not
 *  validated against the server list (it may not have loaded yet); an unknown genre just matches nothing. */
export function parseState(kind: LibKind, q: URLSearchParams, groups: readonly Group[]): LibState {
  const sel: Selection = {};
  for (const g of groups) {
    const raw = q.get(g.id);
    if (!raw) continue;
    const keys = raw.split(',').map(s => s.trim()).filter(Boolean);
    const valid = g.id === 'genre' ? keys : keys.filter(k => g.keys.some(x => x.k === k));
    if (valid.length) sel[g.id] = new Set(g.one ? valid.slice(0, 1) : valid);
  }
  // groups that are not on this desk yet (Genre before the list loads) are still kept
  const genre = q.get('genre');
  if (genre && !sel.genre) sel.genre = new Set(genre.split(',').map(s => s.trim()).filter(Boolean));
  const orders = ORDERS[kind].map(o => o[0]);
  const views = VIEWS[kind].map(v => v[0]);
  const o = q.get('order') as OrderId | null;
  const v = q.get('view') as ViewId | null;
  return {
    sel,
    order: o && orders.includes(o) ? o : DEFAULT_ORDER[kind],
    view: v && views.includes(v) ? v : DEFAULT_VIEW[kind],
  };
}

/** The query-string patch for router.replaceQuery: defaults are removed to keep URLs short. */
export function stateToQuery(kind: LibKind, st: LibState, groups: readonly Group[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const g of groups) out[g.id] = st.sel[g.id]?.size ? [...st.sel[g.id] as Set<string>].join(',') : null;
  if (!out.genre) out.genre = st.sel.genre?.size ? [...st.sel.genre].join(',') : null;
  out.order = st.order === DEFAULT_ORDER[kind] ? null : st.order;
  out.view = st.view === DEFAULT_VIEW[kind] ? null : st.view;
  return out;
}

/** A genre picked in a link may arrive before the server's genre list: it still filters, so give it a stand-in group. */
const withStandIn = (sel: Selection, groups: readonly Group[]): readonly Group[] =>
  sel.genre?.size && !groups.some(g => g.id === 'genre')
    ? [...groups, { id: 'genre', label: 'Genre', icon: 'film', bucket: 'genres', keys: [...sel.genre].map(k => ({ k, t: k, genres: [k] })) }]
    : groups;

export const activeKeys = (sel: Selection, groups: readonly Group[]): Array<{ g: Group; key: Key }> =>
  withStandIn(sel, groups).flatMap(g => [...(sel[g.id] ?? [])].map(k => ({ g, key: g.keys.find(x => x.k === k) ?? { k, t: k, genres: g.id === 'genre' ? [k] : undefined } })));

/* ── selection -> Jellyfin query ── */
export function toQuery(kind: LibKind, st: LibState, groups: readonly Group[]): ItemsQuery {
  const q: ItemsQuery = { kind: kind === 'movies' ? 'movie' : 'series', ...SORT_OF[st.order] };
  const ratings = new Set<string>();
  const genres = new Set<string>();
  const years = new Set<number>();
  for (const { key } of activeKeys(st.sel, groups)) {
    key.ratings?.forEach(r => ratings.add(r));
    key.genres?.forEach(x => genres.add(x));
    key.years?.forEach(y => years.add(y));
    if (key.runtime) { q.minRuntimeMin = key.runtime[0]; q.maxRuntimeMin = key.runtime[1]; }
    if (key.played !== undefined) q.played = key.played;
    if (key.resumable) q.resumable = true;
    if (key.is4k) q.is4k = true;
    if (key.status) q.seriesStatus = q.seriesStatus && q.seriesStatus !== key.status ? undefined : key.status;
  }
  if (ratings.size) q.ratings = [...ratings];
  if (genres.size) q.genres = [...genres];
  if (years.size) q.years = [...years].sort((a, b) => a - b);
  return q;
}

/* ── selection -> predicate ── */
export interface TestCtx {
  /** per-show watching lane (shows only) */
  lane?: (t: Title) => Lane;
}

const keyMatches = (t: Title, k: Key, ctx: TestCtx): boolean => {
  if (k.ratings && !(t.certification && k.ratings.includes(t.certification))) return false;
  if (k.genres && !k.genres.some(g => t.genres.includes(g))) return false;
  if (k.years && !(t.year != null && k.years.includes(t.year))) return false;
  if (k.runtime) {
    if (k.runtime[0] != null && t.runtimeMin < k.runtime[0]) return false;
    if (k.runtime[1] != null && t.runtimeMin > k.runtime[1]) return false;
  }
  if (k.played !== undefined && t.played !== k.played) return false;
  if (k.resumable && !t.progress) return false;
  if (k.is4k && !t.is4k) return false;
  if (k.status && t.status !== k.status) return false;
  if (k.lane && ctx.lane?.(t) !== k.lane) return false;
  return true;
};

/** `skip` leaves one group out (used to ask "what would the count be without this switch"). */
export function passes(t: Title, st: LibState, groups: readonly Group[], ctx: TestCtx = {}, skip?: string): boolean {
  const buckets = new Map<string, Key[]>();
  for (const g of withStandIn(st.sel, groups)) {
    if (g.id === skip) continue;
    for (const k of st.sel[g.id] ?? []) {
      const key = g.keys.find(x => x.k === k);
      if (!key) continue;
      const b = bucketOf(g);
      buckets.set(b, [...(buckets.get(b) ?? []), key]);
    }
  }
  for (const keys of buckets.values()) if (!keys.some(k => keyMatches(t, k, ctx))) return false;
  return true;
}

/* ── shows: lanes & season strip ── */
export function laneOf(t: Title, now = Date.now()): Lane {
  const total = t.episodeCount ?? 0;
  const unplayed = t.unplayedCount ?? total;
  const watched = Math.max(0, total - unplayed);
  if (total > 0 && unplayed === 0) return 'done';
  if (watched === 0) return 'not';
  const added = t.lastEpisodeAdded ? Date.parse(t.lastEpisodeAdded.replace(/(\.\d{3})\d+/, '$1')) : NaN;
  if (t.status === 'Continuing' && Number.isFinite(added) && now - added < 14 * 864e5) return 'new';
  return 'watching';
}

/** First letter for A to Z (leading "The / A / An" ignored, like the server's sort name). */
export function letterOf(name: string): string {
  const n = name.replace(/^(the|a|an)\s+/i, '');
  const c = (n[0] ?? '#').toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}
