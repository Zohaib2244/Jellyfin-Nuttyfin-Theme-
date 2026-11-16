/**
 * Demo backend: fixtures from design/catalog.json (real titles and ids from the owner's library, so real artwork
 * still loads from /jf/Items/<id>/Images/...). Progress, favourites and requests are fake and live in memory.
 * Enabled with ?demo=1 or localStorage nutfin.demo. Any username/password signs in.
 */
import catalog from '../../design/catalog.json';
import { store } from '../lib/storage';
import type { Backend, QuickConnectApi, SeerrApi } from './backend';
import type {
  AudioTrack, Chapter, Collection, Episode, GenreCount, IssueKind, ImageTags, ItemsQuery, LibraryView, MediaItem, MediaVersion, Paged, Person, PlaybackInfo,
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

// ── library/details: begin ──
const mkAudio = (index: number, lang: string, codec: string, ch: number, label: string, isDefault = false): AudioTrack =>
  ({ index, language: lang, codec, channels: ch, label, isDefault });
const mkSub = (index: number, lang: string, label: string, o: Partial<SubtitleTrack> = {}): SubtitleTrack =>
  ({ index, language: lang, codec: 'subrip', label, isDefault: false, isForced: false, isExternal: false, ...o });

const AUDIO: AudioTrack[] = [
  mkAudio(1, 'eng', 'eac3', 6, 'English - Dolby Digital+ - 5.1 - Default', true),
  mkAudio(2, 'spa', 'ac3', 6, 'Spanish - Dolby Digital - 5.1'),
  mkAudio(3, 'eng', 'aac', 2, 'English - AAC - Stereo (commentary)'),
];
const AUDIO_AAC: AudioTrack[] = [mkAudio(1, 'eng', 'aac', 2, 'English - AAC - Stereo - Default', true)];
const SUBS: SubtitleTrack[] = [
  mkSub(4, 'eng', 'English - SRT'),
  mkSub(5, 'spa', 'Spanish - SRT', { isExternal: true }),
  mkSub(6, 'eng', 'English - Forced', { isForced: true }),
  mkSub(7, 'eng', 'English - SDH', { isExternal: true }),
];

/** Versions vary by title so the badges and the version picker can all be seen: 4K HEVC, HD H.264, HD HEVC, 720p. */
function versionsOf(c: CatItem, episode = false): MediaVersion[] {
  const h = hash(c.id);
  const mk = (id: string, name: string, w: number, hgt: number, codec: string, container: string, br: number, size: number, audio: AudioTrack[]): MediaVersion =>
    ({ id, name, container, width: w, height: hgt, is4k: w >= 3000, videoCodec: codec, bitrate: br, sizeBytes: size, audio, subtitles: SUBS });
  if (episode) return [mk('v1', '1080p', 1920, 1080, h % 3 === 0 ? 'hevc' : 'h264', 'mkv', 6_000_000, 2.1e9, AUDIO_AAC)];
  if (c.is4k) return [mk('v-4k', '4K HDR', 3840, 2160, 'hevc', 'mkv', 25_000_000, 18e9, AUDIO), mk('v-hd', '1080p', 1920, 1080, 'h264', 'mp4', 8_000_000, 6e9, AUDIO_AAC)];
  if (h % 4 === 0) return [mk('v-hd', '1080p', 1920, 1080, 'h264', 'mp4', 8_000_000, 6e9, AUDIO_AAC), mk('v-sd', '720p', 1280, 720, 'h264', 'mp4', 3_500_000, 2.4e9, AUDIO_AAC)];
  if (h % 5 === 0) return [mk('v-hevc', '1080p HEVC', 1920, 1080, 'hevc', 'mkv', 4_500_000, 3.8e9, AUDIO)];
  if (h % 3 === 0) return [mk('v-mkv', '1080p', 1920, 1080, 'h264', 'mkv', 9_000_000, 7e9, AUDIO)];
  return [mk('v-hd', '1080p', 1920, 1080, 'h264', 'mp4', 8_000_000, 6e9, AUDIO_AAC)];
}

const FIRST = ['Maya', 'Theo', 'Priya', 'Jonas', 'Lucia', 'Dev', 'Ada', 'Remy', 'Noor', 'Felix', 'Sana', 'Oskar', 'Ines', 'Kofi', 'Mina', 'Tomas'];
const LAST = ['Okafor', 'Lindqvist', 'Nair', 'Weber', 'Ferrante', 'Malhotra', 'Whitlock', 'Castellan', 'Haddad', 'Brandt', 'Mori', 'Eriksen', 'Duarte', 'Mensah', 'Kim', 'Novak'];
const ROLES = ['Captain Reyes', 'Dr. Hale', 'Sam', 'Old Pete', 'Mara', 'The Courier', 'Inspector Vale', 'Nia', 'Grandpa Joe', 'Agent Cole', 'Ellis', 'The Mayor'];
const personName = (seed: string, i: number): string => `${FIRST[(hash(seed) + i * 5) % FIRST.length]} ${LAST[(hash(seed) / 7 + i * 3 | 0) % LAST.length]}`;
const peopleOf = (c: CatItem): Person[] => {
  const cast = Array.from({ length: 10 }, (_, i): Person => ({ id: `demo-p-${c.id}-${i}`, name: personName(c.id, i), role: ROLES[(hash(c.id) + i) % ROLES.length], type: 'Actor' }));
  const crew: Person[] = [
    { id: `demo-d-${c.id}`, name: personName(c.id + 'd', 1), type: 'Director' },
    { id: `demo-w-${c.id}`, name: personName(c.id + 'w', 2), type: 'Writer' },
    { id: `demo-w2-${c.id}`, name: personName(c.id + 'w2', 3), type: 'Writer' },
  ];
  return [...cast, ...crew];
};
const GUEST_ROLES = ['Deputy Marsh', 'The Archivist', 'Young Kit', 'Nurse Okoye', 'Warden Pike'];
const guestsOf = (epId: string): Person[] => Array.from({ length: 1 + hash(epId) % 3 }, (_, i): Person =>
  ({ id: `demo-g-${epId}-${i}`, name: personName(epId, i + 2), role: GUEST_ROLES[(hash(epId) + i) % GUEST_ROLES.length], type: 'GuestStar' }));

function chaptersOf(c: CatItem): Chapter[] {
  const n = c.runtimeMin >= 60 ? 8 : 5;
  const names = ['Opening', 'The call', 'Crossing over', 'First trouble', 'The plan', 'Turning point', 'Everything at stake', 'Showdown', 'Aftermath'];
  return Array.from({ length: n }, (_, i): Chapter => ({ index: i, name: names[i % names.length] ?? `Chapter ${i + 1}`, startTicks: Math.round((c.runtimeMin / n) * i * 600_000_000) }));
}
const TAGS = ['Edge of your seat', 'Great soundtrack', 'Family night', 'Rainy day', 'Big screen', 'Rewatchable'];
const detailExtras = (c: CatItem): Pick<Title, 'chapters' | 'providerIds' | 'tags' | 'remoteTrailers' | 'studios' | 'tagline'> => ({
  chapters: c.type === 'series' ? undefined : chaptersOf(c),
  providerIds: { Imdb: `tt${1000000 + (hash(c.id) % 8000000)}`, Tmdb: String(10000 + (hash(c.id) % 900000)) },
  tags: [TAGS[hash(c.id) % TAGS.length] as string, TAGS[(hash(c.id) + 2) % TAGS.length] as string],
  // two out of three have a trailer, so the Trailer button is seen both shown and hidden
  remoteTrailers: hash(c.id) % 3 === 0 ? [] : [{ url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', name: `${c.name} trailer` }],
  studios: ['Northlight Pictures', 'Ember Films'].slice(0, 1 + (hash(c.id) % 2)),
  tagline: ['Nothing is what it seems.', 'Some doors should stay closed.', 'The adventure starts tonight.'][hash(c.id) % 3],
});
// ── library/details: end ──

function toTitle(c: CatItem, detail = false): Title {
  const kind = c.type === 'series' ? 'series' : 'movie';
  const t: Title = {
    kind, id: c.id, name: c.name, overview: c.overview, imageTags: ART, backdropCount: 1,
    played: kind === 'movie' && hash(c.id) % 5 === 0, favourite: favourites.has(c.id),
    runtimeMin: c.runtimeMin, added: iso(c.added), year: c.year, genres: c.genres, rating: c.rating,
    certification: c.cert ?? undefined, is4k: c.is4k, studios: [],
  };
  const p = progressOf(c.id, c.runtimeMin);
  if (p && kind === 'movie' && !t.played && RESUMING.has(c.id)) t.progress = p;
  // ── library/details: begin ──
  if (kind === 'series') {
    const eps = allEpisodes(c.id);
    t.status = hash(c.id) % 2 === 0 ? 'Continuing' : 'Ended';
    t.seasonCount = new Set(eps.map(e => e.season)).size;
    t.episodeCount = eps.length;
    t.unplayedCount = eps.filter(e => !e.played).length;
    if (hash(c.id) % 4 === 0) t.lastEpisodeAdded = new Date(Date.now() - 3 * 864e5).toISOString();
    if (!t.runtimeMin) t.runtimeMin = 0;
  }
  if (detail) {
    t.people = peopleOf(c);
    t.versions = kind === 'series' ? [versionsOf(c, true)[0] as MediaVersion] : versionsOf(c);
    Object.assign(t, detailExtras(c));
  }
  // ── library/details: end ──
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

// ── library/details: begin ──
/** Every episode of a series. Silo: an invented watched season 1 + the real catalog season 2. Others: 1 to 3 seasons of 8. */
const S1_NAMES = ['Freedom Day', 'Holston\'s Story', 'Machines', 'Truth', 'The Relic', 'Hanna', 'The Janitor\'s Boy', 'Order', 'The Flare', 'Allen\'s Fate'];
function allEpisodes(seriesId: string): Episode[] {
  const series = ITEMS.find(i => i.id === seriesId);
  const name = series?.name ?? 'Series';
  const ov = (e: Episode): Episode => {
    const o = playedOverride.get(e.id);
    const withProg = seriesId === SERIES_DETAIL.series.id && e.season === 2 && e.episode === 5 && !e.played ? { ...e, progress: progressOf(e.id, e.runtimeMin) } : e;
    return o === undefined ? withProg : { ...withProg, played: o, progress: o ? undefined : withProg.progress };
  };
  const base = seriesEpisodes(seriesId);
  const mk = (season: number, n: number, ename: string, played: boolean): Episode => ({
    kind: 'episode', id: `demo-${seriesId}-${season}-${n}`, name: ename, overview: series?.overview, imageTags: {}, backdropCount: 0,
    played, favourite: false, runtimeMin: 40 + ((n * 7) % 15), seriesId, seriesName: name, seasonId: `${seriesId}-s${season}`, season, episode: n,
    missing: false, seriesImageTags: ART,
  });
  const extra: Episode[] = [];
  if (seriesId === SERIES_DETAIL.series.id) {
    extra.push(...S1_NAMES.map((n, i) => mk(1, i + 1, n, true)));
    return [...extra, ...base].map(ov);
  }
  const seasons = 1 + (hash(seriesId) % 3);
  for (let sn = 2; sn <= seasons; sn++) for (let n = 1; n <= 8; n++) extra.push(mk(sn, n, `Episode ${n}`, false));
  return [...base, ...extra].map(ov);
}
const DELETED = new Set<string>();
/** Jellyfin sorts "The Matrix" under M: leading articles are ignored. */
export const sortName = (n: string): string => n.replace(/^(the|a|an)\s+/i, '');
// ── library/details: end ──

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
    // ── library/details: begin ──
    reportIssue: async (_input: { mediaType: 'movie' | 'tv'; tmdbId: number; kind: IssueKind; message: string }) => true,
    // ── library/details: end ──
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
    return ITEMS.filter(c => !DELETED.has(c.id)).map(c => {
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

  // ── library/details: begin ──
  async items(q: ItemsQuery): Promise<Paged<Title>> {
    let list = this.all();
    if (q.kind === 'movie' || q.kind === 'series') list = list.filter(t => t.kind === q.kind);
    if (q.kind === 'episode') list = [];
    if (q.search) { const s = q.search.toLowerCase(); list = list.filter(t => t.name.toLowerCase().includes(s)); }
    if (q.genres?.length) list = list.filter(t => q.genres!.some(g => t.genres.includes(g)));
    if (q.years?.length) list = list.filter(t => t.year != null && q.years!.includes(t.year));
    if (q.ratings?.length) list = list.filter(t => t.certification != null && q.ratings!.includes(t.certification));
    if (q.minRuntimeMin != null) list = list.filter(t => t.runtimeMin >= q.minRuntimeMin!);
    if (q.maxRuntimeMin != null) list = list.filter(t => t.runtimeMin <= q.maxRuntimeMin!);
    if (q.is4k) list = list.filter(t => t.is4k);
    if (q.seriesStatus) list = list.filter(t => t.status === q.seriesStatus);
    if (q.played !== undefined) list = list.filter(t => t.played === q.played);
    if (q.favourite) list = list.filter(t => t.favourite);
    if (q.resumable) list = list.filter(t => t.progress);
    if (q.ids) list = list.filter(t => q.ids!.includes(t.id));
    const key = (t: Title): string => sortName(t.name);
    if (q.nameStartsWith) list = list.filter(t => key(t).toLowerCase().startsWith(q.nameStartsWith!.toLowerCase()));
    if (q.nameLessThan) list = list.filter(t => key(t).toLowerCase() < q.nameLessThan!.toLowerCase());
    const sorter = q.sort === 'name' || q.sort === undefined ? (a: Title, b: Title) => key(a).localeCompare(key(b), 'en', { sensitivity: 'base' }) : SORTERS[q.sort];
    list.sort(q.descending ? (a, b) => sorter(b, a) : sorter);
    const start = q.start ?? 0;
    await new Promise(r => setTimeout(r, 120)); // a little latency so loading states can be seen
    return { items: list.slice(start, start + (q.limit ?? 60)), total: list.length, start };
  }

  async genres(kind: 'movie' | 'series'): Promise<GenreCount[]> {
    const counts = new Map<string, number>();
    for (const t of this.all()) if (t.kind === kind) for (const g of t.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async allSeasons(): Promise<Season[]> {
    const out: Season[] = [];
    for (const c of ITEMS.filter(i => i.type === 'series' && !DELETED.has(i.id))) out.push(...(await this.seasons(c.id)));
    return out;
  }

  async collections(): Promise<Collection[]> {
    const SETS: Array<[string, RegExp]> = [
      ['Transformers', /^Transformers/], ['Scream', /^Scream/], ['Toy Story', /^Toy Story/], ['The Purge', /Purge/], ['Pacific Rim', /^Pacific Rim/],
      ['Night at the Museum', /^Night at the Museum/], ['The Hangover', /^The Hangover/], ['Now You See Me', /^Now You See Me/], ['Moana', /^Moana/],
      ['Diary of a Wimpy Kid', /^Diary of a Wimpy Kid/], ['Scary Movie', /^Scary Movie/], ['Ace Ventura', /^Ace Ventura/],
    ];
    const movies = this.all().filter(t => t.kind === 'movie');
    return SETS.map(([name, re]) => ({ id: `demo-set-${name}`, name, items: movies.filter(m => re.test(m.name)).sort((a, b) => (a.year ?? 0) - (b.year ?? 0)) }))
      .filter(c => c.items.length > 1).sort((a, b) => b.items.length - a.items.length);
  }

  /** The demo only pretends: the item disappears from this session's lists. Nothing real is touched. */
  async deleteFromJellyfin(id: string): Promise<void> {
    await new Promise(r => setTimeout(r, 400));
    DELETED.add(id);
  }

  async item(id: string): Promise<MediaItem> {
    const c = ITEMS.find(i => i.id === id);
    if (c && DELETED.has(id)) throw new Error(`Demo: ${id} was removed`);
    if (c) { const t = toTitle(c, true); const o = playedOverride.get(id); return o === undefined ? t : { ...t, played: o }; }
    for (const s of ITEMS.filter(i => i.type === 'series')) {
      const ep = allEpisodes(s.id).find(e => e.id === id);
      if (ep) {
        const meta = ITEMS.find(i => i.id === s.id) as CatItem;
        return { ...ep, people: guestsOf(ep.id), versions: versionsOf(meta, true), chapters: chaptersOf({ ...meta, runtimeMin: ep.runtimeMin }) };
      }
    }
    throw new Error(`Demo: no item ${id}`);
  }
  // ── library/details: end ──

  async similar(id: string, limit = 12): Promise<Title[]> {
    const me = ITEMS.find(i => i.id === id);
    return this.all().filter(t => t.id !== id && t.kind === (me?.type === 'series' ? 'series' : 'movie'))
      .map(t => ({ t, score: t.genres.filter(g => me?.genres.includes(g)).length })).filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.t.rating ?? 0) - (a.t.rating ?? 0)).slice(0, limit).map(x => x.t);
  }

  async seasons(seriesId: string): Promise<Season[]> {
    const eps = allEpisodes(seriesId); // library/details: all seasons, with watched counts
    const nums = [...new Set(eps.map(e => e.season))];
    return nums.map(n => {
      const mine = eps.filter(e => e.season === n);
      const unplayed = mine.filter(e => !e.played).length;
      return { id: `${seriesId}-s${n}`, seriesId, name: `Season ${n}`, number: n, episodeCount: mine.length, imageTags: {}, played: unplayed === 0, unplayedCount: unplayed };
    });
  }

  async episodes(seriesId: string, seasonId?: string): Promise<Episode[]> {
    return allEpisodes(seriesId).filter(e => !seasonId || e.seasonId === seasonId);
  }

  async search(query: string, limit = 8): Promise<Title[]> {
    const s = query.trim().toLowerCase();
    if (!s) return [];
    return this.all().filter(t => t.name.toLowerCase().includes(s))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(s)) - Number(a.name.toLowerCase().startsWith(s)) || a.name.localeCompare(b.name)).slice(0, limit);
  }

  async playbackInfo(id: string): Promise<PlaybackInfo> {
    const item = await this.item(id);
    const v = item.versions?.[0] as MediaVersion;
    return { itemId: id, mediaSourceId: v.id, url: '', method: 'unavailable', badge: 'Demo mode: no video', isHls: false, version: v, startPositionTicks: 0 };
  }
  async reportStart(): Promise<void> {}
  async reportProgress(): Promise<void> {}
  async reportStopped(): Promise<void> {}

  async setPlayed(id: string, played: boolean): Promise<void> {
    playedOverride.set(id, played);
    // ── library/details: begin ── marking a series watched marks every episode
    if (ITEMS.some(i => i.id === id && i.type === 'series')) for (const e of allEpisodes(id)) playedOverride.set(e.id, played);
    // ── library/details: end ──
  }
  async setFavourite(id: string, favourite: boolean): Promise<void> { if (favourite) favourites.add(id); else favourites.delete(id); }
}
