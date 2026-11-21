/**
 * The Discover "Browse" view as pure data (unit-tested in tests/requests-browse.test.ts): what is in the URL, how it is
 * read back, which networks and studios get a logo tile, and the plain words for the heading and filter chips.
 *
 *   #/requests/discover?type=movie&genre=28,12&sort=vote_average.desc&from=1990&to=1999&hide=1
 *   #/requests/discover?type=tv&network=213
 *
 * `type` is what turns the Browse view on. Films and shows are never mixed: Seerr's discover endpoints are one type each,
 * so a mixed list could not be sorted honestly. A network means shows, a studio means films.
 */
import type { BrowseQuery, BrowseSort, GenreName } from '../../api/desk-types';

export interface BrowseState extends BrowseQuery {
  /** hide titles that are already in the library (filtered here, Seerr has no such parameter) */
  hide: boolean;
}

export const SORTS: ReadonlyArray<{ id: BrowseSort; label: string }> = [
  { id: 'popularity.desc', label: 'Popular' },
  { id: 'vote_average.desc', label: 'Top rated' },
  { id: 'release.desc', label: 'Newest release' },
  { id: 'release.asc', label: 'Oldest' },
];
export const DEFAULT_SORT: BrowseSort = 'popularity.desc';

/** Logo tiles, the same fixed TMDB ids Seerr's own Discover page uses (ids and logos checked against Seerr 3.5.1). */
export interface Brand { id: number; name: string; logo: string }
export const NETWORKS: readonly Brand[] = [
  { id: 213, name: 'Netflix', logo: '/wwemzKWzjKYJFfCeiB57q3r4Bcm.png' },
  { id: 2739, name: 'Disney+', logo: '/1edZOYAfoyZyZ3rklNSiUpXX30Q.png' },
  { id: 1024, name: 'Prime Video', logo: '/w7HfLNm9CWwRmAMU58udl2L7We7.png' },
  { id: 2552, name: 'Apple TV+', logo: '/bngHRFi794mnMq34gfVcm9nDxN1.png' },
  { id: 49, name: 'HBO', logo: '/tuomPhY2UtuPTqqFnKMVHvSb724.png' },
  { id: 3186, name: 'HBO Max', logo: '/nmU0UMDJB3dRRQSTUqawzF2Od1a.png' },
  { id: 453, name: 'Hulu', logo: '/pqUTCleNUiTLAVlelGxUgWn1ELh.png' },
  { id: 4330, name: 'Paramount+', logo: '/fi83B1oztoS47xxcemFdPMhIzK.png' },
  { id: 3353, name: 'Peacock', logo: '/gIAcGTjKKr0KOHL5s4O36roJ8p7.png' },
  { id: 4353, name: 'discovery+', logo: '/1D1bS3Dyw4ScYnFWTlBOvJXC3nb.png' },
  { id: 4, name: 'BBC One', logo: '/uJjcCg3O4DMEjM0xtno9OWFciRP.png' },
  { id: 67, name: 'Showtime', logo: '/257LvQnSLHJAWf6rtJjJbxRkJhL.png' },
  { id: 318, name: 'Starz', logo: '/qx3Y9LCaK4mq1ykFuDIfjshlo3U.png' },
  { id: 174, name: 'AMC', logo: '/pmvRmATOCaDykE6JrVoeYxlFHw3.png' },
  { id: 6, name: 'NBC', logo: '/cm111bsDVlYaC1foL0itvEI4yLG.png' },
  { id: 16, name: 'CBS', logo: '/wju8KhOUsR5y4bH9p3Jc50hhaLO.png' },
  { id: 2, name: 'ABC', logo: '/2uy2ZWcplrSObIyt4x0Y9rkG6qO.png' },
  { id: 19, name: 'FOX', logo: '/1DSpHrWyOORkL9N2QHX7Adt31mQ.png' },
  { id: 56, name: 'Cartoon Network', logo: '/c5OC6oVCg6QP4eqzW6XIq17CQjI.png' },
  { id: 13, name: 'Nickelodeon', logo: '/aYkLXz4dxHgOrFNH7Jv7Cpy56Ms.png' },
];
export const STUDIOS: readonly Brand[] = [
  { id: 2, name: 'Walt Disney Pictures', logo: '/wdrCwmRnLFJhEoH8GSfymY85KHT.png' },
  { id: 127928, name: '20th Century Studios', logo: '/h0rjX5vjW5r8yEnUBStFarjcLT4.png' },
  { id: 34, name: 'Sony Pictures', logo: '/xAb1o9HrSvKBo9mnXC8fJKDNu00.png' },
  { id: 174, name: 'Warner Bros. Pictures', logo: '/zhD3hhtKB5qyv7ZeL4uLpNxgMVU.png' },
  { id: 33, name: 'Universal Pictures', logo: '/8lvHyhjr8oUKOOy2dKXoALWKdp0.png' },
  { id: 4, name: 'Paramount Pictures', logo: '/jay6WcMgagAklUt7i9Euwj1pzTF.png' },
  { id: 1632, name: 'Lionsgate', logo: '/cisLn1YAUuptXVBa0xjq7ST9cH0.png' },
  { id: 41077, name: 'A24', logo: '/1ZXsGaFPgrgS6ZZGS37AqD5uU12.png' },
  { id: 3, name: 'Pixar', logo: '/1TjvGVDMYsj6JBxOAkUHpPEwLf7.png' },
  { id: 521, name: 'DreamWorks Animation', logo: '/3BPX5VGBov8SDqTV7wC1L1xShAS.png' },
  { id: 420, name: 'Marvel Studios', logo: '/mIkZDuulwMPzESbzF9lg3rD8CcO.png' },
  { id: 9993, name: 'DC', logo: '/2Tc1P3Ac8M479naPp1kYT3izLS5.png' },
];

/** A logo turned white (TMDB's duotone filter), the same trick Seerr uses, so every brand sits well on a dark tile. */
export const logoUrl = (path: string): string => `https://image.tmdb.org/t/p/w780_filter(duotone,ffffff,bababa)${path}`;

export const networkName = (id: number | undefined): string | undefined => (id ? NETWORKS.find(n => n.id === id)?.name ?? `Network ${id}` : undefined);
export const studioName = (id: number | undefined): string | undefined => (id ? STUDIOS.find(n => n.id === id)?.name ?? `Studio ${id}` : undefined);

const YEAR_MIN = 1900;
const intIn = (v: string | null, lo: number, hi: number): number | undefined => {
  if (!v || !/^\d{1,7}$/.test(v)) return undefined;
  const n = Number(v);
  return n >= lo && n <= hi ? n : undefined;
};
const isSort = (v: string | null): v is BrowseSort => SORTS.some(s => s.id === v);

/**
 * Read the Browse state from the URL. null = not browsing (Discover's front page).
 * Old genre links (?genre=28&gtype=movie&gname=Action) open the Browse view on that genre.
 */
export function parseBrowse(q: URLSearchParams, thisYear = new Date().getFullYear()): BrowseState | null {
  let type = q.get('type');
  if (!type && q.get('gtype') && q.get('genre')) type = q.get('gtype');
  if (type !== 'movie' && type !== 'tv') return null;
  const genres = [...new Set((q.get('genre') ?? '').split(',').map(g => intIn(g.trim(), 1, 9_999_999)).filter((g): g is number => g != null))].slice(0, 8);
  const maxYear = thisYear + 5;
  let fromYear = intIn(q.get('from'), YEAR_MIN, maxYear);
  let toYear = intIn(q.get('to'), YEAR_MIN, maxYear);
  if (fromYear && toYear && fromYear > toYear) [fromYear, toYear] = [toYear, fromYear];
  const network = type === 'tv' ? intIn(q.get('network'), 1, 9_999_999) : undefined;
  const studio = type === 'movie' ? intIn(q.get('studio'), 1, 9_999_999) : undefined;
  const sort = q.get('sort');
  return {
    mediaType: type, genres, sort: isSort(sort) ? sort : DEFAULT_SORT,
    ...(fromYear ? { fromYear } : {}), ...(toYear ? { toYear } : {}), ...(network ? { network } : {}), ...(studio ? { studio } : {}),
    hide: q.get('hide') === '1',
  };
}

/** The URL query for a Browse state (short: defaults are left out, `type` is always there). */
export function serialiseBrowse(s: BrowseState): string {
  const q = new URLSearchParams();
  q.set('type', s.mediaType);
  if (s.genres.length) q.set('genre', s.genres.join(','));
  if (s.sort !== DEFAULT_SORT) q.set('sort', s.sort);
  if (s.fromYear) q.set('from', String(s.fromYear));
  if (s.toYear) q.set('to', String(s.toYear));
  if (s.mediaType === 'tv' && s.network) q.set('network', String(s.network));
  if (s.mediaType === 'movie' && s.studio) q.set('studio', String(s.studio));
  if (s.hide) q.set('hide', '1');
  // keep the commas readable: #/requests/discover?type=movie&genre=28,12
  return q.toString().replace(/%2C/g, ',');
}

export const emptyBrowse = (mediaType: 'movie' | 'tv'): BrowseState => ({ mediaType, genres: [], sort: DEFAULT_SORT, hide: false });

/** Film and show genre ids differ for a few genres; these are the close matches when switching type. */
const TO_TV: Record<number, number> = { 28: 10759, 12: 10759, 878: 10765, 14: 10765, 10752: 10768 };
const TO_MOVIE: Record<number, number[]> = { 10759: [28], 10765: [878], 10768: [10752] };

/**
 * Switch between films and shows, keeping what still makes sense: genres that exist for the other type (or their close
 * match), years, sort and "hide". A network only applies to shows and a studio only to films, so those are dropped.
 */
export function switchType(s: BrowseState, to: 'movie' | 'tv', available?: readonly GenreName[]): BrowseState {
  if (s.mediaType === to) return s;
  const mapped = s.genres.flatMap(g => (to === 'tv' ? [TO_TV[g] ?? g] : TO_MOVIE[g] ?? [g]));
  const ok = available ? new Set(available.map(g => g.id)) : null;
  const genres = [...new Set(mapped)].filter(g => !ok || ok.has(g));
  const { network: _n, studio: _s, ...rest } = s;
  return { ...rest, mediaType: to, genres };
}

const noun = (t: 'movie' | 'tv'): string => (t === 'tv' ? 'shows' : 'films');

/** "Films", "Action and Adventure films", "Netflix shows", "Comedy shows on Netflix". */
export function browseTitle(s: BrowseState, names: ReadonlyMap<number, string>): string {
  const gs = s.genres.map(g => names.get(g)).filter((x): x is string => !!x);
  const g = gs.length <= 2 ? gs.join(' and ') : `${gs.slice(0, -1).join(', ')} and ${gs[gs.length - 1]}`;
  const brand = s.mediaType === 'tv' ? networkName(s.network) : studioName(s.studio);
  if (brand) return g ? `${g} ${noun(s.mediaType)} ${s.mediaType === 'tv' ? 'on' : 'from'} ${brand}` : `${brand} ${noun(s.mediaType)}`;
  if (g) return `${g} ${noun(s.mediaType)}`;
  return s.mediaType === 'tv' ? 'Shows' : 'Films';
}

/** The removable chips for what is switched on (type and sort are always visible controls, so they are not chips). */
export interface ActiveFilter { key: string; label: string; next: BrowseState }
export function activeFilters(s: BrowseState, names: ReadonlyMap<number, string>): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  if (s.mediaType === 'tv' && s.network) out.push({ key: 'network', label: networkName(s.network) as string, next: { ...s, network: undefined } });
  if (s.mediaType === 'movie' && s.studio) out.push({ key: 'studio', label: studioName(s.studio) as string, next: { ...s, studio: undefined } });
  for (const g of s.genres) out.push({ key: `genre-${g}`, label: names.get(g) ?? `Genre ${g}`, next: { ...s, genres: s.genres.filter(x => x !== g) } });
  if (s.fromYear || s.toYear) {
    const label = s.fromYear && s.toYear ? (s.fromYear === s.toYear ? `${s.fromYear}` : `${s.fromYear} to ${s.toYear}`) : s.fromYear ? `From ${s.fromYear}` : `Up to ${s.toYear}`;
    out.push({ key: 'years', label, next: { ...s, fromYear: undefined, toYear: undefined } });
  }
  if (s.hide) out.push({ key: 'hide', label: 'Not in the library', next: { ...s, hide: false } });
  return out;
}

/** Everything off except the type (and sort, which is a choice rather than a filter). */
export const clearFilters = (s: BrowseState): BrowseState => ({ ...emptyBrowse(s.mediaType), sort: s.sort });
