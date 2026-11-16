/**
 * Demo backend: fixtures from design/catalog.json (real titles and ids from the owner's library, so real artwork
 * still loads from /jf/Items/<id>/Images/...). Progress, favourites and requests are fake and live in memory.
 * Enabled with ?demo=1 or localStorage nutfin.demo. Any username/password signs in.
 */
import catalog from '../../design/catalog.json';
import { store } from '../lib/storage';
import type { Backend, QuickConnectApi, SeerrApi } from './backend';
import type {
  AudioTrack, Episode, ImageTags, ItemsQuery, LibraryView, MediaItem, MediaVersion, Paged, Person, PlaybackInfo,
  Progress, QuickConnectSession, Season, SeerrQuota, SeerrRequest, SeerrResult, SubtitleTrack, Title, User,
} from './types';

interface CatItem {
  id: string; name: string; type: string; year?: number; genres: string[]; overview?: string; rating?: number;
  cert?: string; runtimeMin: number; added?: string; is4k: boolean;
}
interface CatEpisode { id: string; name: string; ep: number; season: number; overview?: string; runtimeMin: number; missing: boolean }

const ITEMS = catalog.items as CatItem[];
const SERIES_DETAIL = catalog.series_detail as { series: CatItem; episodes: CatEpisode[] };

const ART: ImageTags = { primary: 'demo', backdrop: 'demo', logo: 'demo', thumb: 'demo' };
const hash = (s: string): number => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const iso = (s?: string): string | undefined => (s ? `${s.replace(' ', 'T').slice(0, 23)}Z` : undefined);

const PEOPLE: Person[] = [
  ['Maya Okafor', 'Captain Reyes', 'Actor'], ['Theo Lindqvist', 'Dr. Hale', 'Actor'], ['Priya Nair', 'Sam', 'Actor'],
  ['Jonas Weber', 'Old Pete', 'Actor'], ['Lucia Ferrante', 'Mara', 'Actor'], ['Dev Malhotra', 'The Courier', 'Actor'],
  ['Ada Whitlock', '', 'Director'], ['Remy Castellan', '', 'Writer'],
].map(([name, role, type], i) => ({ id: `demo-person-${i}`, name: name as string, role: role || undefined, type: type as string }));

const AUDIO: AudioTrack[] = [
  { index: 1, language: 'eng', codec: 'eac3', channels: 6, label: 'English - Dolby Digital+ - 5.1 - Default', isDefault: true },
  { index: 2, language: 'spa', codec: 'ac3', channels: 6, label: 'Spanish - Dolby Digital - 5.1', isDefault: false },
];
const SUBS: SubtitleTrack[] = [
  { index: 3, language: 'eng', codec: 'subrip', label: 'English - SRT', isDefault: false, isForced: false, isExternal: false },
  { index: 4, language: 'spa', codec: 'subrip', label: 'Spanish - SRT', isDefault: false, isForced: false, isExternal: true },
];
const version = (is4k: boolean): MediaVersion => ({
  id: 'demo-version', name: is4k ? '4K' : '1080p', container: 'mkv', width: is4k ? 3840 : 1920, height: is4k ? 2160 : 1080, is4k,
  videoCodec: is4k ? 'hevc' : 'h264', bitrate: is4k ? 25_000_000 : 8_000_000, sizeBytes: is4k ? 18e9 : 6e9, audio: AUDIO, subtitles: SUBS,
});

function toTitle(c: CatItem, detail = false): Title {
  const kind = c.type === 'series' ? 'series' : 'movie';
  const t: Title = {
    kind, id: c.id, name: c.name, overview: c.overview, imageTags: ART, backdropCount: 1,
    played: kind === 'movie' && hash(c.id) % 5 === 0, favourite: favourites.has(c.id),
    runtimeMin: c.runtimeMin, added: iso(c.added), year: c.year, genres: c.genres, rating: c.rating,
    certification: c.cert, is4k: c.is4k, studios: [],
  };
  const p = progressOf(c.id, c.runtimeMin);
  if (p && kind === 'movie' && !t.played && RESUMING.has(c.id)) t.progress = p;
  if (kind === 'series') { t.status = 'Continuing'; t.seasonCount = 2; t.unplayedCount = 4 + (hash(c.id) % 9); }
  if (detail) { t.people = PEOPLE; t.versions = [version(c.is4k)]; t.tagline = 'Demo data'; }
  return t;
}

function progressOf(id: string, runtimeMin: number): Progress | undefined {
  if (!runtimeMin) return undefined;
  const percent = 15 + (hash(id) % 65);
  const posMin = (runtimeMin * percent) / 100;
  return { positionTicks: Math.round(posMin * 600_000_000), percent, remainingMin: Math.ceil(runtimeMin - posMin) };
}

function seriesEpisodes(seriesId: string): Episode[] {
  const series = ITEMS.find(i => i.id === seriesId);
  const name = series?.name ?? 'Series';
  if (seriesId === SERIES_DETAIL.series.id) {
    return SERIES_DETAIL.episodes.map(e => ({
      kind: 'episode', id: e.id, name: e.name, overview: e.overview, imageTags: { primary: 'demo' }, backdropCount: 0,
      played: e.ep < 5, favourite: false, runtimeMin: e.runtimeMin, seriesId, seriesName: name, seasonId: `${seriesId}-s${e.season}`,
      season: e.season, episode: e.ep, missing: e.missing, seriesImageTags: ART,
    }));
  }
  return Array.from({ length: 8 }, (_, i): Episode => ({
    kind: 'episode', id: `demo-${seriesId}-1-${i + 1}`, name: `Episode ${i + 1}`, overview: series?.overview, imageTags: {}, backdropCount: 0,
    played: i < 2, favourite: false, runtimeMin: 42, seriesId, seriesName: name, seasonId: `${seriesId}-s1`, season: 1, episode: i + 1,
    missing: false, seriesImageTags: ART,
  }));
}

/* ── in-memory state ── */
const favourites = new Set<string>();
const playedOverride = new Map<string, boolean>();
const RESUMING = new Set(ITEMS.filter(i => i.type === 'movie').slice(0, 6).map(i => i.id));

const NOW = Date.now();
const FAKE_REQUESTS: SeerrRequest[] = [
  { id: 1, tmdbId: 603, mediaType: 'movie', title: 'The Matrix', year: 1999, state: 'downloading', requestedBy: 'Demo', createdAt: new Date(NOW - 2 * 3600e3).toISOString() },
  { id: 2, tmdbId: 1396, mediaType: 'tv', title: 'Breaking Bad', year: 2008, state: 'approved', requestedBy: 'Demo', createdAt: new Date(NOW - 3 * 864e5).toISOString(), seasons: [1, 2] },
  { id: 3, tmdbId: 438631, mediaType: 'movie', title: 'Dune', year: 2021, state: 'requested', requestedBy: 'Demo', createdAt: new Date(NOW - 864e5).toISOString() },
  { id: 4, tmdbId: 27205, mediaType: 'movie', title: 'Inception', year: 2010, state: 'available', requestedBy: 'Demo', createdAt: new Date(NOW - 12 * 864e5).toISOString() },
];
const FAKE_SEARCH: SeerrResult[] = [
  ...FAKE_REQUESTS.map((r): SeerrResult => ({ tmdbId: r.tmdbId, mediaType: r.mediaType, title: r.title, year: r.year, state: r.state === 'available' ? 'available' : undefined })),
  { tmdbId: 157336, mediaType: 'movie', title: 'Interstellar', year: 2014 },
  { tmdbId: 66732, mediaType: 'tv', title: 'Stranger Things', year: 2016 },
];

const SORTERS: Record<NonNullable<ItemsQuery['sort']>, (a: Title, b: Title) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  added: (a, b) => (a.added ?? '').localeCompare(b.added ?? ''),
  rating: (a, b) => (a.rating ?? 0) - (b.rating ?? 0),
  year: (a, b) => (a.year ?? 0) - (b.year ?? 0),
  runtime: (a, b) => a.runtimeMin - b.runtimeMin,
  played: (a, b) => hash(a.id) - hash(b.id),
  random: (a, b) => hash(a.id + 'r') - hash(b.id + 'r'),
};

export class DemoBackend implements Backend {
  readonly mode = 'demo' as const;
  private user: User | null = store.get<User | null>('demoUser', null);
  private readonly listeners = new Set<(u: User | null) => void>();
  private qcPolls = 0;

  readonly quickConnect: QuickConnectApi = {
    enabled: async () => true,
    start: async (): Promise<QuickConnectSession> => { this.qcPolls = 0; return { secret: 'demo-secret', code: '123456' }; },
    poll: async () => (++this.qcPolls < 3 ? null : this.adopt('Demo')),
  };

  readonly seerr: SeerrApi = {
    available: async () => !!this.user,
    search: async (q: string): Promise<SeerrResult[]> => FAKE_SEARCH.filter(r => r.title.toLowerCase().includes(q.trim().toLowerCase())),
    request: async input => {
      const hit = FAKE_SEARCH.find(r => r.tmdbId === input.tmdbId);
      const req: SeerrRequest = { id: Date.now(), tmdbId: input.tmdbId, mediaType: input.mediaType, title: hit?.title ?? 'Requested title', year: hit?.year, state: 'requested', requestedBy: this.user?.name ?? 'Demo', createdAt: new Date().toISOString(), seasons: input.seasons };
      FAKE_REQUESTS.unshift(req);
      return req;
    },
    requests: async () => [...FAKE_REQUESTS],
    quota: async (): Promise<SeerrQuota> => ({
      movie: { limit: 5, used: 2, remaining: 3, days: 7 },
      tv: { limit: null, used: 1, remaining: null, days: null },
    }),
  };

  private adopt(name: string): User {
    const user: User = { id: 'demo-user', name: name.trim() || 'Demo', isAdmin: true };
    this.user = user;
    store.set('demoUser', user);
    this.emit();
    return user;
  }
  private emit(): void { for (const cb of [...this.listeners]) cb(this.user); }

  currentUser(): User | null { return this.user; }
  async signIn(username: string): Promise<User> { return this.adopt(username); }
  async signOut(): Promise<void> { this.user = null; store.remove('demoUser'); this.emit(); }
  onAuthChange(cb: (u: User | null) => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }

  async views(): Promise<LibraryView[]> {
    return [{ id: 'demo-movies', name: 'Movies', collection: 'movies' }, { id: 'demo-shows', name: 'TV Shows', collection: 'tvshows' }];
  }

  private all(): Title[] {
    return ITEMS.map(c => {
      const t = toTitle(c);
      const o = playedOverride.get(c.id);
      return o === undefined ? t : { ...t, played: o, ...(o ? { progress: undefined } : {}) };
    });
  }

  async resume(limit = 12): Promise<MediaItem[]> {
    const movies = this.all().filter(t => t.progress).slice(0, limit);
    const silo = seriesEpisodes(SERIES_DETAIL.series.id)[4];
    const ep: Episode | undefined = silo && { ...silo, progress: progressOf(silo.id, silo.runtimeMin) };
    const out: MediaItem[] = ep ? [movies[0], ep, ...movies.slice(1)].filter((x): x is MediaItem => !!x) : movies;
    return out.slice(0, limit);
  }

  async nextUp(limit = 12): Promise<Episode[]> {
    const silo = seriesEpisodes(SERIES_DETAIL.series.id)[4];
    const others = ITEMS.filter(i => i.type === 'series' && i.id !== SERIES_DETAIL.series.id).slice(0, limit)
      .map(s => seriesEpisodes(s.id)[2]).filter((e): e is Episode => !!e);
    return [...(silo ? [silo] : []), ...others].slice(0, limit);
  }

  async latest(opts: { kind?: 'movie' | 'series'; limit?: number } = {}): Promise<Title[]> {
    return this.all().filter(t => !opts.kind || t.kind === opts.kind).sort(SORTERS.added).reverse().slice(0, opts.limit ?? 20);
  }

  async items(q: ItemsQuery): Promise<Paged<Title>> {
    let list = this.all();
    if (q.kind === 'movie' || q.kind === 'series') list = list.filter(t => t.kind === q.kind);
    if (q.kind === 'episode') list = [];
    if (q.search) { const s = q.search.toLowerCase(); list = list.filter(t => t.name.toLowerCase().includes(s)); }
    if (q.genres?.length) list = list.filter(t => q.genres!.some(g => t.genres.includes(g)));
    if (q.years?.length) list = list.filter(t => t.year != null && q.years!.includes(t.year));
    if (q.played !== undefined) list = list.filter(t => t.played === q.played);
    if (q.favourite) list = list.filter(t => t.favourite);
    if (q.resumable) list = list.filter(t => t.progress);
    if (q.ids) list = list.filter(t => q.ids!.includes(t.id));
    const sorter = SORTERS[q.sort ?? 'name'];
    list.sort(q.descending ? (a, b) => sorter(b, a) : sorter);
    const start = q.start ?? 0;
    return { items: list.slice(start, start + (q.limit ?? 60)), total: list.length, start };
  }

  async item(id: string): Promise<MediaItem> {
    const c = ITEMS.find(i => i.id === id);
    if (c) { const t = toTitle(c, true); const o = playedOverride.get(id); return o === undefined ? t : { ...t, played: o }; }
    for (const s of ITEMS.filter(i => i.type === 'series')) {
      const ep = seriesEpisodes(s.id).find(e => e.id === id);
      if (ep) return ep;
    }
    throw new Error(`Demo: no item ${id}`);
  }

  async similar(id: string, limit = 12): Promise<Title[]> {
    const me = ITEMS.find(i => i.id === id);
    return this.all().filter(t => t.id !== id && t.kind === (me?.type === 'series' ? 'series' : 'movie'))
      .map(t => ({ t, score: t.genres.filter(g => me?.genres.includes(g)).length })).filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.t.rating ?? 0) - (a.t.rating ?? 0)).slice(0, limit).map(x => x.t);
  }

  async seasons(seriesId: string): Promise<Season[]> {
    const eps = seriesEpisodes(seriesId);
    const nums = [...new Set(eps.map(e => e.season))];
    return nums.map(n => ({ id: `${seriesId}-s${n}`, seriesId, name: `Season ${n}`, number: n, episodeCount: eps.filter(e => e.season === n).length, imageTags: {}, played: false }));
  }

  async episodes(seriesId: string, seasonId?: string): Promise<Episode[]> {
    return seriesEpisodes(seriesId).filter(e => !seasonId || e.seasonId === seasonId);
  }

  async search(query: string, limit = 8): Promise<Title[]> {
    const s = query.trim().toLowerCase();
    if (!s) return [];
    return this.all().filter(t => t.name.toLowerCase().includes(s))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(s)) - Number(a.name.toLowerCase().startsWith(s)) || a.name.localeCompare(b.name)).slice(0, limit);
  }

  async playbackInfo(id: string): Promise<PlaybackInfo> {
    const item = await this.item(id);
    const v = item.kind === 'episode' ? version(false) : (item.versions?.[0] ?? version(false));
    return { itemId: id, mediaSourceId: v.id, url: '', method: 'unavailable', badge: 'Demo mode: no video', isHls: false, version: v, startPositionTicks: 0 };
  }
  async reportStart(): Promise<void> {}
  async reportProgress(): Promise<void> {}
  async reportStopped(): Promise<void> {}

  async setPlayed(id: string, played: boolean): Promise<void> { playedOverride.set(id, played); }
  async setFavourite(id: string, favourite: boolean): Promise<void> { if (favourite) favourites.add(id); else favourites.delete(id); }
}
