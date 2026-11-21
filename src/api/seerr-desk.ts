/**
 * Seerr "desk": everything the full Requests page needs beyond search/request/list: permissions, 4K and quality
 * options, season states, paged lists with server-side filters, approve/decline/cancel, problem reports (issues).
 * Raw Seerr JSON is converted here once; the page only sees the normalised shapes in desk-types.ts.
 * Shapes verified against Seerr 3.5.1 (tests/fixtures/seerr/*.json).
 */
import type {
  BrowseQuery, CastMember, GenreName, DeskRequest, DeskRequestInput, DiscoverItem, DiscoverPage, DiscoverRail, DownloadInfo, GenreTile, QualityProfile, RequestFailureInfo, RequestFilter,
  RequestScope, RequestsPage, SeasonInfo, SeerrCapabilities, SeerrDeskApi, SeerrDetail, SeerrIssue, SeerrPerms, TitleFacts,
} from './desk-types';
import { ApiError, type Http } from './http';
import { downloadPercent, mediaState } from './seerr';
import { limitConcurrency } from '../lib/concurrency';
import type { IssueKind, RequestState, SeerrRequest, SeerrResult } from './types';

const FACTS_TTL_MS = 60 * 60 * 1000;
const FACTS_KEY = 'nutfin.seerrFacts.v2:';
const RAIL_PATH: Record<DiscoverRail, string> = {
  trending: '/discover/trending', movies: '/discover/movies', 'movies-upcoming': '/discover/movies/upcoming', tv: '/discover/tv', 'tv-upcoming': '/discover/tv/upcoming',
};
const RAIL_TYPE: Partial<Record<DiscoverRail, 'movie' | 'tv'>> = { movies: 'movie', 'movies-upcoming': 'movie', tv: 'tv', 'tv-upcoming': 'tv' };

/**
 * Seerr query parameters for one Browse page (verified against Seerr 3.5.1, read-only):
 *  - genre: comma list = all of them (TMDB with_genres); studio (films) / network (shows) work together with genre and sortBy
 *  - sortBy: popularity.desc, vote_average.desc, primary_release_date.* (films) / first_air_date.* (shows).
 *    title.asc is ignored by TMDB and original_title.asc sorts by the original-language title, so A-Z is not offered.
 *  - voteAverage sorting alone surfaces one-vote oddities, so "Top rated" asks for a vote-count floor; "Newest" stops at
 *    today (otherwise announced titles dated 2099 come first) and "Oldest" needs a floor too (1870s test reels).
 *  - years: primaryReleaseDateGte/Lte (films) / firstAirDateGte/Lte (shows). Unknown parameters are rejected with 400.
 */
export function browseParams(q: BrowseQuery, page: number, today: string): Record<string, string | number> {
  const film = q.mediaType === 'movie';
  const out: Record<string, string | number> = { page };
  const field = film ? 'primary_release_date' : 'first_air_date';
  out.sortBy = q.sort === 'release.desc' ? `${field}.desc` : q.sort === 'release.asc' ? `${field}.asc` : q.sort;
  if (q.genres.length) out.genre = q.genres.join(',');
  if (film && q.studio) out.studio = q.studio;
  if (!film && q.network) out.network = q.network;
  const gte = film ? 'primaryReleaseDateGte' : 'firstAirDateGte';
  const lte = film ? 'primaryReleaseDateLte' : 'firstAirDateLte';
  if (q.fromYear) out[gte] = `${q.fromYear}-01-01`;
  let upTo = q.toYear ? `${q.toYear}-12-31` : '';
  if (q.sort === 'release.desc' && (!upTo || upTo > today)) upTo = today;
  if (upTo) out[lte] = upTo;
  const floor = q.sort === 'vote_average.desc' ? (film ? 1000 : 500) : q.sort === 'release.asc' ? (film ? 300 : 100) : q.sort === 'release.desc' ? 20 : 0;
  // a network or studio is a small list already: a high floor would empty it
  if (floor) out.voteCountGte = q.network || q.studio ? Math.min(floor, 50) : floor;
  return out;
}

/** sessionStorage, or null where it is missing or blocked (tests, private windows). */
function session(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

/** Seerr's permission bit flags (server/lib/permissions.ts). */
export const PERM = {
  ADMIN: 2, MANAGE_REQUESTS: 16, REQUEST: 32, REQUEST_4K: 1024, REQUEST_4K_MOVIE: 2048, REQUEST_4K_TV: 4096, REQUEST_ADVANCED: 8192,
  REQUEST_MOVIE: 262_144, REQUEST_TV: 524_288, MANAGE_ISSUES: 1_048_576, VIEW_ISSUES: 2_097_152, CREATE_ISSUES: 4_194_304,
} as const;

/** Bit mask -> readable permissions. Admins can do everything (same rule as Seerr's hasPermission). */
export function permsFrom(mask: number): SeerrPerms {
  const isAdmin = (mask & PERM.ADMIN) !== 0;
  const has = (...flags: number[]): boolean => isAdmin || flags.some(f => (mask & f) !== 0);
  return {
    isAdmin,
    request: has(PERM.REQUEST, PERM.REQUEST_MOVIE, PERM.REQUEST_TV),
    requestMovie: has(PERM.REQUEST, PERM.REQUEST_MOVIE),
    requestTv: has(PERM.REQUEST, PERM.REQUEST_TV),
    request4k: has(PERM.REQUEST_4K, PERM.REQUEST_4K_MOVIE, PERM.REQUEST_4K_TV),
    advanced: has(PERM.REQUEST_ADVANCED),
    manageRequests: has(PERM.MANAGE_REQUESTS),
    createIssues: has(PERM.CREATE_ISSUES),
    viewIssues: has(PERM.VIEW_ISSUES, PERM.MANAGE_ISSUES),
    manageIssues: has(PERM.MANAGE_ISSUES),
  };
}

/* ── raw shapes (only what is read) ── */
interface RawDownload {
  size?: number; sizeLeft?: number; estimatedCompletionTime?: string | null; timeLeft?: string;
  episode?: { seasonNumber?: number; episodeNumber?: number } | null;
}
interface RawMedia {
  id?: number; status?: number; status4k?: number; tmdbId?: number; mediaType?: string;
  jellyfinMediaId?: string | null; jellyfinMediaId4k?: string | null;
  downloadStatus?: RawDownload[]; downloadStatus4k?: RawDownload[];
  seasons?: Array<{ seasonNumber: number; status?: number }>;
  requests?: Array<{ id: number; status: number; is4k?: boolean; requestedBy?: { id?: number }; seasons?: Array<{ seasonNumber: number; status?: number }> }>;
}
interface RawUser { id?: number; displayName?: string; jellyfinUsername?: string; username?: string }
interface RawRequest {
  id: number; status: number; createdAt?: string; updatedAt?: string; type?: string; is4k?: boolean;
  seasons?: Array<{ seasonNumber: number }>; media?: RawMedia; requestedBy?: RawUser;
}
interface RawDetail {
  id?: number; title?: string; name?: string; releaseDate?: string; firstAirDate?: string; overview?: string; tagline?: string;
  posterPath?: string; backdropPath?: string; voteAverage?: number; runtime?: number; episodeRunTime?: number[];
  genres?: Array<{ name: string }>; mediaInfo?: RawMedia;
  seasons?: Array<{ seasonNumber: number; name?: string; episodeCount?: number; airDate?: string | null }>;
  releases?: { results?: Array<{ iso_3166_1?: string; release_dates?: Array<{ release_date?: string; type?: number }> }> };
  nextEpisodeToAir?: { airDate?: string | null } | null;
  numberOfSeasons?: number;
  relatedVideos?: Array<{ site?: string; key?: string; name?: string; type?: string }>;
  credits?: { cast?: Array<{ name?: string; character?: string; profilePath?: string | null; order?: number }> };
}
interface RawHit {
  id: number; mediaType?: string; title?: string; name?: string; releaseDate?: string; firstAirDate?: string; posterPath?: string; overview?: string;
  backdropPath?: string; voteAverage?: number; mediaInfo?: RawMedia;
}
interface RawPage { page?: number; totalPages?: number; totalResults?: number; results?: RawHit[] }
interface RawIssue {
  id: number; issueType: number; status: number; createdAt?: string;
  media?: { tmdbId?: number; mediaType?: string; jellyfinMediaId?: string | null };
  createdBy?: RawUser; comments?: Array<{ message?: string }>;
}

const yearOf = (d?: string): number | undefined => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : undefined);
const nameOf = (u?: RawUser): string => u?.displayName ?? u?.jellyfinUsername ?? u?.username ?? '';

/** A search / trending hit as a result card (status chip, partial flag, library id). Non film/show hits (people) give null. */
export function hitToResult(h: RawHit): SeerrResult | null {
  if (h.mediaType !== 'movie' && h.mediaType !== 'tv') return null;
  const st = h.mediaInfo?.status;
  return {
    tmdbId: h.id, mediaType: h.mediaType, title: h.title ?? h.name ?? '', year: yearOf(h.releaseDate ?? h.firstAirDate),
    overview: h.overview || undefined, posterPath: h.posterPath || undefined, state: mediaState(st),
    partial: st === 4 ? true : undefined, jellyfinId: h.mediaInfo?.jellyfinMediaId || undefined,
  };
}

/** A Discover poster: the result card plus backdrop and rating. `fallbackType` is for endpoints whose hits have no mediaType. */
export function hitToItem(h: RawHit, fallbackType?: 'movie' | 'tv'): DiscoverItem | null {
  const r = hitToResult({ ...h, mediaType: h.mediaType ?? fallbackType });
  if (!r || !r.title) return null;
  return { ...r, backdropPath: h.backdropPath || undefined, rating: h.voteAverage ? Math.round(h.voteAverage * 10) / 10 : undefined };
}

export function mapPage(r: RawPage | undefined, fallbackType?: 'movie' | 'tv'): DiscoverPage {
  const items = (r?.results ?? []).map(h => hitToItem(h, fallbackType)).filter((x): x is DiscoverItem => !!x);
  return { items, page: r?.page ?? 1, totalPages: r?.totalPages ?? 1, ...(typeof r?.totalResults === 'number' ? { total: r.totalResults } : {}) };
}

/** Radarr/Sonarr queue entries as Seerr reports them. Empty when nothing is really downloading. */
export function downloadsOf(list: RawDownload[] | undefined): DownloadInfo[] {
  return (list ?? []).map(d => {
    const pct = d.size && d.size > 0 ? Math.max(0, Math.min(100, Math.round(((d.size - (d.sizeLeft ?? 0)) / d.size) * 100))) : undefined;
    const ep = d.episode?.seasonNumber != null && d.episode.episodeNumber != null ? `S${d.episode.seasonNumber}E${d.episode.episodeNumber}` : undefined;
    return { percent: pct, eta: d.estimatedCompletionTime || undefined, label: ep };
  });
}

const day = (d?: string | null): string | undefined => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : undefined);

/** Release facts from a Seerr movie/tv details answer. Home release = earliest digital (4) or disc (5) date anywhere. */
export function factsFrom(mediaType: 'movie' | 'tv', tmdbId: number, d: RawDetail): TitleFacts {
  let home: string | undefined;
  for (const c of d.releases?.results ?? []) for (const r of c.release_dates ?? []) {
    const at = day(r.release_date);
    if (at && (r.type === 4 || r.type === 5) && (!home || at < home)) home = at;
  }
  const airs: Record<string, string> = {};
  for (const s of d.seasons ?? []) { const a = day(s.airDate); if (a) airs[String(s.seasonNumber)] = a; }
  const ready = (d.mediaInfo?.seasons ?? []).filter(s => s.status === 5).map(s => s.seasonNumber);
  const f: TitleFacts = {
    tmdbId, mediaType, title: d.title ?? d.name ?? '', year: yearOf(d.releaseDate ?? d.firstAirDate),
    posterPath: d.posterPath || undefined, backdropPath: d.backdropPath || undefined,
    releaseDate: day(mediaType === 'movie' ? d.releaseDate : d.firstAirDate),
  };
  if (home) f.homeRelease = home;
  if (mediaType === 'tv') {
    const next = day(d.nextEpisodeToAir?.airDate);
    if (next) f.nextAirDate = next;
    if (Object.keys(airs).length) f.seasonAirDates = airs;
    if (ready.length) f.seasonsReady = ready;
    const partly = (d.mediaInfo?.seasons ?? []).filter(s => s.status === 4).map(s => s.seasonNumber);
    if (partly.length) f.seasonsPartly = partly;
  }
  return f;
}

/** The trailer to show: an official YouTube "Trailer" first, then any trailer, then a teaser. */
export function pickTrailer(videos: RawDetail['relatedVideos']): { key: string; name: string } | undefined {
  const yt = (videos ?? []).filter(v => v.site === 'YouTube' && v.key && /^[\w-]{6,20}$/.test(v.key));
  const v = yt.find(x => x.type === 'Trailer' && /official/i.test(x.name ?? '')) ?? yt.find(x => x.type === 'Trailer') ?? yt.find(x => x.type === 'Teaser');
  return v?.key ? { key: v.key, name: v.name ?? 'Trailer' } : undefined;
}

/** Season state words: 5 available, 4 partly, 3 downloading, 2 asked. */
const SEASON_STATE: Record<number, RequestState> = { 2: 'requested', 3: 'downloading', 4: 'available', 5: 'available' };
const RANK: Record<RequestState, number> = { declined: 0, requested: 1, approved: 2, downloading: 3, available: 4 };

/** Per-season state: what Seerr tracks for the media, plus seasons inside open requests (pending / approved). */
export function seasonStates(media: RawMedia | undefined): Map<number, RequestState> {
  const out = new Map<number, RequestState>();
  const put = (n: number, s: RequestState): void => { const cur = out.get(n); if (!cur || RANK[cur] < RANK[s]) out.set(n, s); };
  for (const s of media?.seasons ?? []) { const st = SEASON_STATE[s.status ?? 0]; if (st) put(s.seasonNumber, st); }
  for (const r of media?.requests ?? []) {
    if (r.status === 3 || r.status === 4 || r.is4k) continue; // declined / failed / 4K do not hold a normal season
    for (const s of r.seasons ?? []) put(s.seasonNumber, r.status === 1 ? 'requested' : 'approved');
  }
  return out;
}

export function mapDetail(mediaType: 'movie' | 'tv', tmdbId: number, d: RawDetail, myUserId: number | null): SeerrDetail {
  const m = d.mediaInfo;
  const states = seasonStates(m);
  const seasons: SeasonInfo[] = (d.seasons ?? []).map(s => ({
    number: s.seasonNumber, name: s.name || (s.seasonNumber === 0 ? 'Specials' : `Season ${s.seasonNumber}`), episodes: s.episodeCount ?? 0,
    airDate: s.airDate || undefined, state: states.get(s.seasonNumber),
  })).sort((a, b) => a.number - b.number);
  const mine = m?.requests?.find(r => myUserId != null && r.requestedBy?.id === myUserId && (r.status === 1 || r.status === 2));
  return {
    tmdbId, mediaType, title: d.title ?? d.name ?? '', year: yearOf(d.releaseDate ?? d.firstAirDate), overview: d.overview || undefined, tagline: d.tagline || undefined,
    posterPath: d.posterPath || undefined, backdropPath: d.backdropPath || undefined, rating: d.voteAverage ? Math.round(d.voteAverage * 10) / 10 : undefined,
    runtimeMin: d.runtime ?? d.episodeRunTime?.[0] ?? undefined, genres: (d.genres ?? []).map(g => g.name),
    state: mediaState(m?.status), partial: m?.status === 4, jellyfinId: m?.jellyfinMediaId || undefined, seasons, myRequestId: mine?.id,
    cast: (d.credits?.cast ?? []).filter(c => c.name).slice(0, 8).map((c): CastMember => ({ name: c.name as string, character: c.character || undefined, profilePath: c.profilePath || undefined })),
    trailer: pickTrailer(d.relatedVideos), seasonCount: mediaType === 'tv' ? (d.numberOfSeasons ?? seasons.filter(s => s.number > 0).length) : undefined,
    facts: factsFrom(mediaType, tmdbId, d), mediaStatus: m?.status, downloads: downloadsOf(m?.downloadStatus),
  };
}

/** A request row. `title` is filled by the caller (the list endpoint only has TMDB ids).
 *  "downloading" only when Radarr/Sonarr really report a download: Seerr's media status 3 ("processing") also covers
 *  "approved, sent to Radarr, nothing to grab yet" (an unreleased film), which is waiting, not downloading. */
export function mapRequest(r: RawRequest, d?: { title?: string; name?: string; releaseDate?: string; firstAirDate?: string; posterPath?: string }): DeskRequest {
  const tv = r.type === 'tv' || r.media?.mediaType === 'tv';
  const media = r.media;
  const mStatus = r.is4k ? media?.status4k : media?.status;
  const raw = r.is4k ? media?.downloadStatus4k : media?.downloadStatus;
  const downloads = downloadsOf(raw);
  const done = r.status === 5 || mStatus === 5 || mStatus === 4;
  const state: RequestState = r.status === 3 ? 'declined' : done ? 'available' : r.status === 1 ? 'requested' : downloads.length ? 'downloading' : 'approved';
  const pct = downloadPercent(raw);
  return {
    requestStatus: r.status, mediaStatus: mStatus, downloads, updatedAt: r.updatedAt || undefined,
    id: r.id, tmdbId: media?.tmdbId ?? 0, mediaType: tv ? 'tv' : 'movie', title: d?.title ?? d?.name ?? '', year: yearOf(d?.releaseDate ?? d?.firstAirDate),
    posterPath: d?.posterPath || undefined, state, requestedBy: nameOf(r.requestedBy), requestedById: r.requestedBy?.id, createdAt: r.createdAt ?? '',
    seasons: r.seasons?.map(s => s.seasonNumber), progress: state === 'downloading' ? pct : undefined,
    jellyfinId: (r.is4k ? media?.jellyfinMediaId4k : media?.jellyfinMediaId) || undefined,
    failed: r.status === 4 || undefined, partial: mStatus === 4 || undefined, is4k: r.is4k || undefined,
  };
}

const ISSUE_KIND: Record<number, IssueKind> = { 1: 'video', 2: 'audio', 3: 'subtitles', 4: 'other' };

/** Plain-language explanation of a failed request. Accepts whatever the client threw. */
export function explainRequestError(e: unknown): RequestFailureInfo {
  const status = e instanceof ApiError ? e.status : -1;
  const raw = e instanceof ApiError && e.body && typeof e.body === 'object' ? String((e.body as { message?: unknown }).message ?? '') : '';
  const msg = raw.toLowerCase();
  if (e instanceof ApiError && e.kind === 'network') return { reason: 'unavailable', message: 'Could not reach the request service. Check your connection and try again.' };
  if (status === 409 || /already exists|already requested/.test(msg)) return { reason: 'duplicate', message: 'Someone already asked for this one. You can follow it in the list below.' };
  if (/quota/.test(msg)) return { reason: 'quota', message: 'You have used up your requests for now. They come back a little later, or ask the server owner for more.' };
  if (/blocklist|blacklist/.test(msg)) return { reason: 'blocked', message: 'This one cannot be requested here.' };
  if (/no seasons/.test(msg) || status === 202) return { reason: 'no-seasons', message: 'Every season of this show has already been asked for or is already here.' };
  if (status === 403 || status === 401) return { reason: 'permission', message: 'Your account is not allowed to ask for this. Ask the server owner to turn requests on for you.' };
  if (status >= 500 || status === 0) return { reason: 'unavailable', message: 'The request service is not answering right now. Try again in a moment.' };
  return { reason: 'unknown', message: 'That did not go through. Nothing was asked for. Try again in a moment.' };
}

/** Server-side filter for each UI filter (Seerr 3.x names). Declined has none, it is filtered after loading. */
export function serverFilter(f: RequestFilter): string {
  return f === 'waiting' ? 'pending' : f === 'onway' ? 'processing' : f === 'ready' ? 'completed' : 'all';
}

export const matchesFilter = (r: SeerrRequest, f: RequestFilter): boolean =>
  f === 'all' ? true : f === 'waiting' ? r.state === 'requested' : f === 'onway' ? r.state === 'approved' || r.state === 'downloading'
    : f === 'ready' ? r.state === 'available' : r.state === 'declined';

interface Session { userId: number | null; perms: number }
interface TitleBits { title?: string; name?: string; releaseDate?: string; firstAirDate?: string; posterPath?: string }

export class SeerrDesk implements SeerrDeskApi {
  private caps: Promise<SeerrCapabilities | null> | null = null;
  private readonly facts = new Map<string, { at: number; p: Promise<TitleFacts | null> }>();
  private readonly metadata = limitConcurrency(4);

  constructor(private readonly http: Http, private readonly session: () => Session, private readonly available: () => Promise<boolean>) {}

  reset(): void {
    this.caps = null;
    this.facts.clear();
    const ss = session();
    try { if (ss) for (let i = ss.length - 1; i >= 0; i--) { const k = ss.key(i); if (k?.startsWith(FACTS_KEY)) ss.removeItem(k); } } catch { /* storage blocked */ }
  }

  private remember(f: TitleFacts): void {
    const key = `${f.mediaType}:${f.tmdbId}`;
    this.facts.set(key, { at: Date.now(), p: Promise.resolve(f) });
    try { session()?.setItem(FACTS_KEY + key, JSON.stringify({ at: Date.now(), f })); } catch { /* full or blocked: memory only */ }
  }

  cachedFacts(mediaType: 'movie' | 'tv', tmdbId: number): TitleFacts | null {
    const key = `${mediaType}:${tmdbId}`;
    try {
      const raw = session()?.getItem(FACTS_KEY + key);
      if (raw) {
        const v = JSON.parse(raw) as { at?: number; f?: TitleFacts };
        if (v.f && typeof v.at === 'number' && Date.now() - v.at < FACTS_TTL_MS) return v.f;
      }
    } catch { /* ignore a broken entry */ }
    return null;
  }

  /** One /movie|/tv lookup per title per hour, shared by Home, the request rows, issues and the details sheet. */
  titleFacts(mediaType: 'movie' | 'tv', tmdbId: number, signal?: AbortSignal): Promise<TitleFacts | null> {
    const key = `${mediaType}:${tmdbId}`;
    const hit = this.facts.get(key);
    if (hit && Date.now() - hit.at < FACTS_TTL_MS) return hit.p;
    const stored = this.cachedFacts(mediaType, tmdbId);
    if (stored) { const p = Promise.resolve(stored); this.facts.set(key, { at: Date.now(), p }); return p; }
    const p = this.metadata(async () => {
      if (signal?.aborted) return null; // the row scrolled away with the page: do not spend a lookup on it
      const d = await this.http<RawDetail>(`/${mediaType}/${tmdbId}`, { timeoutMs: 8000 });
      const f = factsFrom(mediaType, tmdbId, d);
      this.remember(f);
      return f;
    }).catch(() => null);
    this.facts.set(key, { at: Date.now(), p });
    void p.then(f => { if (!f && this.facts.get(key)?.p === p) this.facts.delete(key); });
    return p;
  }

  capabilities(): Promise<SeerrCapabilities | null> {
    this.caps ??= this.loadCaps();
    return this.caps;
  }

  private async loadCaps(): Promise<SeerrCapabilities | null> {
    if (!(await this.available())) return null;
    const { userId, perms: mask } = this.session();
    if (userId == null) return null;
    const perms = permsFrom(mask);
    let pub: { movie4kEnabled?: boolean; series4kEnabled?: boolean; partialRequestsEnabled?: boolean; enableSpecialEpisodes?: boolean } = {};
    try { pub = await this.http('/settings/public', { timeoutMs: 8000 }); } catch { /* keep defaults */ }
    const fourK = { movie: !!pub.movie4kEnabled && perms.request4k, tv: !!pub.series4kEnabled && perms.request4k };
    const profiles: SeerrCapabilities['profiles'] = {};
    if (perms.advanced) {
      const [movie, tv] = await Promise.all([this.profilesFor('radarr'), this.profilesFor('sonarr')]);
      if (movie) profiles.movie = movie;
      if (tv) profiles.tv = tv;
    }
    return { userId, perms, fourK, profiles, specials: !!pub.enableSpecialEpisodes, partialRequests: pub.partialRequestsEnabled !== false };
  }

  /** Quality profiles of the default (non-4K) Radarr/Sonarr server; undefined when there is nothing to choose between. */
  private async profilesFor(app: 'radarr' | 'sonarr'): Promise<{ list: QualityProfile[]; defaultId?: number } | undefined> {
    try {
      const servers = await this.http<Array<{ id: number; is4k?: boolean; isDefault?: boolean }>>(`/service/${app}`, { timeoutMs: 8000 });
      const s = servers.find(x => x.isDefault && !x.is4k) ?? servers.find(x => !x.is4k);
      if (!s) return undefined;
      const d = await this.http<{ server?: { activeProfileId?: number }; profiles?: QualityProfile[] }>(`/service/${app}/${s.id}`, { timeoutMs: 8000 });
      const list = (d.profiles ?? []).map(p => ({ id: p.id, name: p.name }));
      return list.length > 1 ? { list, defaultId: d.server?.activeProfileId } : undefined;
    } catch { return undefined; }
  }

  async detail(mediaType: 'movie' | 'tv', tmdbId: number, signal?: AbortSignal): Promise<SeerrDetail | null> {
    if (!(await this.available())) return null;
    try {
      const d = await this.http<RawDetail>(`/${mediaType}/${tmdbId}`, { signal, timeoutMs: 10_000 });
      const out = mapDetail(mediaType, tmdbId, d, this.session().userId);
      if (out.facts) this.remember(out.facts);
      return out;
    } catch (e) {
      if (signal?.aborted) throw e;
      return null;
    }
  }

  async discover(signal?: AbortSignal): Promise<SeerrResult[]> {
    if (!(await this.available())) return [];
    try {
      const r = await this.http<{ results?: RawHit[] }>('/discover/trending', { query: { page: 1 }, signal });
      return (r.results ?? []).map(hitToResult).filter((x): x is SeerrResult => !!x && !!x.title);
    } catch (e) {
      if (signal?.aborted) throw e;
      return [];
    }
  }

  async discoverRail(rail: DiscoverRail, page = 1, signal?: AbortSignal): Promise<DiscoverPage> {
    if (!(await this.available())) return { items: [], page: 1, totalPages: 1 };
    try {
      return mapPage(await this.http<RawPage>(RAIL_PATH[rail], { query: { page }, signal, timeoutMs: 10_000 }), RAIL_TYPE[rail]);
    } catch (e) {
      if (signal?.aborted) throw e;
      return { items: [], page: 1, totalPages: 1 };
    }
  }

  async genres(mediaType: 'movie' | 'tv', signal?: AbortSignal): Promise<GenreTile[]> {
    if (!(await this.available())) return [];
    try {
      const r = await this.http<Array<{ id: number; name?: string; backdrops?: string[] }>>(`/discover/genreslider/${mediaType}`, { signal, timeoutMs: 10_000 });
      return (Array.isArray(r) ? r : []).filter(g => g.name).map(g => ({ id: g.id, name: g.name as string, backdrop: g.backdrops?.[0] || undefined }));
    } catch (e) {
      if (signal?.aborted) throw e;
      return [];
    }
  }

  async discoverGenre(mediaType: 'movie' | 'tv', genreId: number, page = 1, signal?: AbortSignal): Promise<DiscoverPage> {
    if (!(await this.available())) return { items: [], page: 1, totalPages: 1 };
    try {
      return mapPage(await this.http<RawPage>(mediaType === 'movie' ? '/discover/movies' : '/discover/tv', { query: { page, genre: genreId }, signal, timeoutMs: 10_000 }), mediaType);
    } catch (e) {
      if (signal?.aborted) throw e;
      return { items: [], page: 1, totalPages: 1 };
    }
  }

  async genreList(mediaType: 'movie' | 'tv', signal?: AbortSignal): Promise<GenreName[]> {
    if (!(await this.available())) return [];
    try {
      const r = await this.http<Array<{ id?: number; name?: string }>>(`/genres/${mediaType}`, { signal, timeoutMs: 10_000 });
      return (Array.isArray(r) ? r : []).filter((g): g is GenreName => typeof g.id === 'number' && !!g.name).map(g => ({ id: g.id, name: g.name }));
    } catch (e) {
      if (signal?.aborted) throw e;
      return [];
    }
  }

  async browse(q: BrowseQuery, page = 1, signal?: AbortSignal): Promise<DiscoverPage> {
    if (!(await this.available())) throw new ApiError(503, 'network', 'Seerr is not available');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const path = q.mediaType === 'movie' ? '/discover/movies' : '/discover/tv';
    return mapPage(await this.http<RawPage>(path, { query: browseParams(q, page, today), signal, timeoutMs: 12_000 }), q.mediaType);
  }

  /** TMDB title + poster for a media row, through the facts cache. Failures leave the title blank. */
  async titleOf(mediaType: 'movie' | 'tv', tmdbId: number): Promise<TitleBits | undefined> {
    const f = await this.titleFacts(mediaType, tmdbId);
    return f ? { title: f.title, releaseDate: f.releaseDate, posterPath: f.posterPath } : undefined;
  }

  /** Rows with whatever the facts cache already knows (no network per row). */
  private withCachedFacts(x: RawRequest): DeskRequest {
    const type = x.type === 'tv' || x.media?.mediaType === 'tv' ? 'tv' : 'movie';
    const f = x.media?.tmdbId ? this.cachedFacts(type, x.media.tmdbId) : null;
    return mapRequest(x, f ? { title: f.title, releaseDate: f.releaseDate, posterPath: f.posterPath } : undefined);
  }

  async allRequests(o: { scope: RequestScope; max?: number }): Promise<RequestsPage> {
    if (!(await this.available())) return { items: [], total: 0 };
    const { userId } = this.session();
    const max = o.max ?? 400;
    const take = 100;
    const raws: RawRequest[] = [];
    let total = 0;
    try {
      for (let skip = 0; skip < max; skip += take) {
        const r = await this.http<{ pageInfo?: { results?: number }; results?: RawRequest[] }>('/request', {
          query: { take, skip, filter: 'all', sort: 'added', requestedBy: o.scope === 'mine' && userId != null ? userId : undefined },
        });
        const got = r.results ?? [];
        raws.push(...got);
        total = r.pageInfo?.results ?? raws.length;
        if (got.length < take || raws.length >= total) break;
      }
    } catch {
      if (!raws.length) return { items: [], total: 0 };
    }
    return { items: raws.slice(0, max).map(x => this.withCachedFacts(x)), total };
  }

  async requestsPage(o: { scope: 'mine' | 'all'; filter: RequestFilter; take: number; skip: number }): Promise<RequestsPage> {
    if (!(await this.available())) return { items: [], total: 0 };
    const { userId } = this.session();
    try {
      const r = await this.http<{ pageInfo?: { results?: number }; results?: RawRequest[] }>('/request', {
        query: { take: o.take, skip: o.skip, filter: serverFilter(o.filter), sort: 'added', requestedBy: o.scope === 'mine' && userId != null ? userId : undefined },
      });
      const raws = r.results ?? [];
      const bits = await Promise.all(raws.map(x => {
        const type = x.type === 'tv' || x.media?.mediaType === 'tv' ? 'tv' : 'movie';
        return x.media?.tmdbId ? this.titleOf(type, x.media.tmdbId) : Promise.resolve(undefined);
      }));
      const items = raws.map((x, i) => mapRequest(x, bits[i])).filter(x => matchesFilter(x, o.filter));
      return { items, total: r.pageInfo?.results ?? items.length };
    } catch {
      return { items: [], total: 0 };
    }
  }

  async createRequest(input: DeskRequestInput): Promise<SeerrRequest> {
    if (!(await this.available())) throw new ApiError(0, 'unauthorized', 'Requests are not available right now');
    const r = await this.http<RawRequest & { message?: string }>('/request', {
      method: 'POST',
      body: {
        mediaType: input.mediaType, mediaId: input.tmdbId,
        ...(input.mediaType === 'tv' ? { seasons: input.seasons ?? 'all' } : {}),
        ...(input.is4k ? { is4k: true } : {}), ...(input.profileId != null ? { profileId: input.profileId } : {}),
      },
    });
    // Seerr answers 202 with only a message when there was nothing left to ask for
    if (!r || typeof r.id !== 'number') throw new ApiError(202, 'client', 'No seasons available to request', { message: r?.message ?? 'No seasons available to request' });
    const bits = await this.titleOf(input.mediaType, input.tmdbId);
    return mapRequest(r, bits);
  }

  async cancelRequest(id: number): Promise<void> { await this.http(`/request/${id}`, { method: 'DELETE' }); }
  async approveRequest(id: number): Promise<void> { await this.http(`/request/${id}/approve`, { method: 'POST' }); }
  async declineRequest(id: number): Promise<void> { await this.http(`/request/${id}/decline`, { method: 'POST' }); }

  async issues(o: { mine?: boolean; take?: number } = {}): Promise<SeerrIssue[]> {
    if (!(await this.available())) return [];
    const { userId } = this.session();
    try {
      const r = await this.http<{ results?: RawIssue[] }>('/issue', {
        query: { take: o.mine !== false ? 100 : (o.take ?? 20), skip: 0, sort: 'added', filter: 'all' }, // Seerr 3.x has no createdBy filter: narrow to mine below
      });
      const mineOnly = o.mine !== false && userId != null;
      const rows = (r.results ?? []).filter(i => !mineOnly || i.createdBy?.id === userId).slice(0, o.take ?? 20);
      return await Promise.all(rows.map(async (i): Promise<SeerrIssue> => {
        const type = i.media?.mediaType === 'tv' ? 'tv' : 'movie';
        const bits = i.media?.tmdbId ? await this.titleOf(type, i.media.tmdbId) : undefined;
        const comments = i.comments ?? [];
        return {
          id: i.id, kind: ISSUE_KIND[i.issueType] ?? 'other', status: i.status === 2 ? 'resolved' : 'open', message: comments[0]?.message ?? '',
          createdAt: i.createdAt ?? '', createdBy: nameOf(i.createdBy), tmdbId: i.media?.tmdbId ?? 0, mediaType: type,
          title: bits?.title ?? bits?.name ?? '', posterPath: bits?.posterPath || undefined, jellyfinId: i.media?.jellyfinMediaId || undefined, replies: Math.max(0, comments.length - 1),
        };
      }));
    } catch { return []; }
  }
}
