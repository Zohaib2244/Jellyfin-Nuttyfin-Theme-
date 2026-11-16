/**
 * Seerr "desk": everything the full Requests page needs beyond search/request/list: permissions, 4K and quality
 * options, season states, paged lists with server-side filters, approve/decline/cancel, problem reports (issues).
 * Raw Seerr JSON is converted here once; the page only sees the normalised shapes in desk-types.ts.
 * Shapes verified against Seerr 3.5.1 (tests/fixtures/seerr/*.json).
 */
import type {
  DeskRequestInput, QualityProfile, RequestFailureInfo, RequestFilter, RequestsPage, SeasonInfo, SeerrCapabilities, SeerrDeskApi, SeerrDetail, SeerrIssue,
  SeerrPerms,
} from './desk-types';
import { ApiError, type Http } from './http';
import { downloadPercent, mediaState, requestState } from './seerr';
import { limitConcurrency } from '../lib/concurrency';
import type { IssueKind, RequestState, SeerrRequest, SeerrResult } from './types';

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
interface RawMedia {
  id?: number; status?: number; status4k?: number; tmdbId?: number; mediaType?: string;
  jellyfinMediaId?: string | null; jellyfinMediaId4k?: string | null;
  downloadStatus?: Array<{ size?: number; sizeLeft?: number }>; downloadStatus4k?: Array<{ size?: number; sizeLeft?: number }>;
  seasons?: Array<{ seasonNumber: number; status?: number }>;
  requests?: Array<{ id: number; status: number; is4k?: boolean; requestedBy?: { id?: number }; seasons?: Array<{ seasonNumber: number; status?: number }> }>;
}
interface RawUser { id?: number; displayName?: string; jellyfinUsername?: string; username?: string }
interface RawRequest {
  id: number; status: number; createdAt?: string; type?: string; is4k?: boolean;
  seasons?: Array<{ seasonNumber: number }>; media?: RawMedia; requestedBy?: RawUser;
}
interface RawDetail {
  id?: number; title?: string; name?: string; releaseDate?: string; firstAirDate?: string; overview?: string; tagline?: string;
  posterPath?: string; backdropPath?: string; voteAverage?: number; runtime?: number; episodeRunTime?: number[];
  genres?: Array<{ name: string }>; mediaInfo?: RawMedia;
  seasons?: Array<{ seasonNumber: number; name?: string; episodeCount?: number; airDate?: string }>;
}
interface RawHit {
  id: number; mediaType: string; title?: string; name?: string; releaseDate?: string; firstAirDate?: string; posterPath?: string; overview?: string;
  mediaInfo?: RawMedia;
}
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
  };
}

/** A request row. `title` is filled by the caller (the list endpoint only has TMDB ids). */
export function mapRequest(r: RawRequest, d?: { title?: string; name?: string; releaseDate?: string; firstAirDate?: string; posterPath?: string }): SeerrRequest {
  const tv = r.type === 'tv' || r.media?.mediaType === 'tv';
  const media = r.media;
  const mStatus = r.is4k ? media?.status4k : media?.status;
  const done = r.status === 5 || mStatus === 5;
  const state: RequestState = r.status === 3 ? 'declined' : done ? 'available' : r.status === 4 ? 'approved' : requestState(r.status, mStatus);
  const pct = downloadPercent(r.is4k ? media?.downloadStatus4k : media?.downloadStatus);
  return {
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
  private readonly titles = new Map<string, Promise<TitleBits | undefined>>();
  private readonly metadata = limitConcurrency(4);

  constructor(private readonly http: Http, private readonly session: () => Session, private readonly available: () => Promise<boolean>) {}

  reset(): void { this.caps = null; this.titles.clear(); }

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
      return mapDetail(mediaType, tmdbId, d, this.session().userId);
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

  /** TMDB title + poster for a media row. Cached for the session; failures leave the title blank. */
  titleOf(mediaType: 'movie' | 'tv', tmdbId: number): Promise<TitleBits | undefined> {
    const key = `${mediaType}:${tmdbId}`;
    let p = this.titles.get(key);
    if (!p) {
      p = this.metadata(() => this.http<TitleBits>(`/${mediaType}/${tmdbId}`, { timeoutMs: 8000 })).catch(() => { this.titles.delete(key); return undefined; });
      this.titles.set(key, p);
    }
    return p;
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
