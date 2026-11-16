/**
 * Seerr (request manager) client via the same-origin /seerr proxy. Cookie session: after the Jellyfin sign-in we
 * POST the same username/password to /seerr/api/v1/auth/jellyfin and Seerr sets its own session cookie.
 * EVERYTHING here fails soft: if Seerr is down or the login fails, available() is false and lists are empty,
 * so requests UI can hide itself while the rest of the app keeps working. Quick Connect sign-ins have no password,
 * so Seerr stays unavailable for them until the next password sign-in.
 */
import type { SeerrApi } from './backend';
import { ApiError, createHttp, type Http } from './http';
import { hitToResult, SeerrDesk } from './seerr-desk'; // phase5-7
import type { IssueKind, QuotaLine, RequestState, SeerrQuota, SeerrRequest, SeerrResult, User } from './types';

export const SEERR_BASE = '/seerr/api/v1';

/* ── raw shapes (only what we read) ── */
interface MediaInfo { status?: number; tmdbId?: number; mediaType?: string; downloadStatus?: Array<{ size?: number; sizeLeft?: number }> }
interface SearchHit {
  id: number; mediaType: string; title?: string; name?: string; releaseDate?: string; firstAirDate?: string;
  posterPath?: string; overview?: string; mediaInfo?: MediaInfo;
}
interface RequestRaw {
  id?: number; status: number; createdAt?: string; type?: string; seasons?: Array<{ seasonNumber: number }>;
  media?: MediaInfo & { status?: number }; requestedBy?: { displayName?: string; jellyfinUsername?: string; username?: string };
}
interface Quota { movie?: RawLine; tv?: RawLine }
interface RawLine { days?: number; limit?: number; used?: number; remaining?: number; restricted?: boolean }

/** Seerr media status: 1 unknown, 2 pending, 3 processing, 4 partially available, 5 available. */
export function mediaState(status: number | undefined): RequestState | undefined {
  switch (status) {
    case 2: return 'requested';
    case 3: return 'downloading';
    case 4: case 5: return 'available';
    default: return undefined;
  }
}

/** Seerr request status: 1 pending approval, 2 approved, 3 declined. A processing/available media status wins. */
export function requestState(requestStatus: number, mediaStatus?: number): RequestState {
  if (requestStatus === 3) return 'declined';
  if (mediaStatus === 5 || mediaStatus === 4) return 'available';
  if (mediaStatus === 3) return 'downloading';
  return requestStatus === 2 ? 'approved' : 'requested';
}

const yearOf = (d?: string): number | undefined => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : undefined);

function quotaLine(l?: RawLine): QuotaLine {
  const limit = l?.limit && l.limit > 0 ? l.limit : null;
  return { limit, used: l?.used ?? 0, remaining: limit == null ? null : (l?.remaining ?? Math.max(0, limit - (l?.used ?? 0))), days: l?.days ?? null };
}

export class SeerrClient implements SeerrApi {
  private ok: boolean | null = null;
  private seerrUserId: number | null = null;
  private probing: Promise<boolean> | null = null;
  private readonly http: Http;
  // ── phase5-7: begin ──
  private perms = 0;
  private readonly desk: SeerrDesk;
  // ── phase5-7: end ──

  constructor(private readonly getUser: () => User | null) {
    this.http = createHttp({ base: SEERR_BASE, headers: () => ({}) });
    this.desk = new SeerrDesk(this.http, () => ({ userId: this.seerrUserId, perms: this.perms }), () => this.available()); // phase5-7
  }

  /** Called by the Jellyfin client after a password sign-in. Never throws. */
  async connect(username: string, password: string): Promise<boolean> {
    try {
      const me = await this.http<{ id?: number; permissions?: number }>('/auth/jellyfin', { method: 'POST', body: { username, password }, timeoutMs: 8000 });
      this.seerrUserId = me.id ?? null;
      this.perms = me.permissions ?? 0; // phase5-7
      this.ok = true;
    } catch {
      this.ok = false;
    }
    return this.ok;
  }

  reset(): void { this.ok = null; this.seerrUserId = null; this.probing = null; this.desk.reset(); /* phase5-7 */ }

  async available(): Promise<boolean> {
    if (!this.getUser()) return false;
    if (this.ok !== null) return this.ok;
    this.probing ??= (async () => {
      try {
        const me = await this.http<{ id?: number; permissions?: number }>('/auth/me', { timeoutMs: 6000 });
        this.seerrUserId = me.id ?? null;
        this.perms = me.permissions ?? 0; // phase5-7
        this.ok = true;
      } catch {
        this.ok = false;
      }
      this.probing = null;
      return this.ok;
    })();
    return this.probing;
  }

  async search(query: string, signal?: AbortSignal): Promise<SeerrResult[]> {
    if (!query.trim() || !(await this.available())) return [];
    try {
      const r = await this.http<{ results?: SearchHit[] }>('/search', { query: { query: query.trim(), page: 1 }, signal });
      return (r.results ?? []).map(hitToResult).filter((x): x is SeerrResult => !!x); // phase5-7: adds partial + library id
    } catch (e) {
      if (signal?.aborted) throw e;
      return [];
    }
  }

  /** Unlike the list calls, a failed request must tell the person, so this one throws (ApiError). */
  async request(input: { mediaType: 'movie' | 'tv'; tmdbId: number; seasons?: number[] }): Promise<SeerrRequest> {
    if (!(await this.available())) throw new ApiError(0, 'unauthorized', 'Requests are not available right now');
    const r = await this.http<RequestRaw>('/request', {
      method: 'POST',
      body: { mediaType: input.mediaType, mediaId: input.tmdbId, ...(input.mediaType === 'tv' ? { seasons: input.seasons ?? 'all' } : {}) },
    });
    if (typeof r.id !== 'number') throw new ApiError(202, 'client', 'No seasons available to request', { message: 'No seasons available to request' }); // phase5-7
    return this.toRequest(r, undefined);
  }

  async requests(opts: { mine?: boolean; take?: number; includeTitles?: boolean } = {}): Promise<SeerrRequest[]> {
    if (!(await this.available())) return [];
    try {
      const r = await this.http<{ results?: RequestRaw[] }>('/request', {
        query: { take: opts.take ?? 30, skip: 0, filter: 'all', sort: 'added', requestedBy: opts.mine && this.seerrUserId ? this.seerrUserId : undefined },
      });
      const raws = r.results ?? [];
      // The list has TMDB ids only; fetch titles in parallel (each failure just leaves a blank title).
      const details = opts.includeTitles === false ? [] : await Promise.all(raws.map(x => this.rowDetail(x)));
      return raws.map((x, i) => this.toRequest(x, details[i]));
    } catch {
      return [];
    }
  }

  async quota(): Promise<SeerrQuota | null> {
    if (!(await this.available()) || this.seerrUserId == null) return null;
    try {
      const q = await this.http<Quota>(`/user/${this.seerrUserId}/quota`);
      return { movie: quotaLine(q.movie), tv: quotaLine(q.tv) };
    } catch {
      return null;
    }
  }

  // ── library/details: begin ──
  /** Seerr issue types: 1 video, 2 audio, 3 subtitles, 4 other. Needs Seerr's internal media id, found through the TMDB id. */
  async reportIssue(input: { mediaType: 'movie' | 'tv'; tmdbId: number; kind: IssueKind; message: string }): Promise<boolean> {
    if (!(await this.available())) return false;
    try {
      const d = await this.http<{ mediaInfo?: { id?: number } }>(`/${input.mediaType}/${input.tmdbId}`, { timeoutMs: 8000 });
      const mediaId = d.mediaInfo?.id;
      if (!mediaId) return false;
      const issueType = { video: 1, audio: 2, subtitles: 3, other: 4 }[input.kind];
      await this.http('/issue', { method: 'POST', body: { issueType, message: input.message.slice(0, 1000), mediaId } });
      return true;
    } catch {
      return false;
    }
  }
  // ── library/details: end ──

  // ── phase5-7: begin ── the full Requests page (see seerr-desk.ts)
  capabilities(): ReturnType<SeerrApi['capabilities']> { return this.desk.capabilities(); }
  detail(...a: Parameters<SeerrApi['detail']>): ReturnType<SeerrApi['detail']> { return this.desk.detail(...a); }
  discover(signal?: AbortSignal): ReturnType<SeerrApi['discover']> { return this.desk.discover(signal); }
  requestsPage(...a: Parameters<SeerrApi['requestsPage']>): ReturnType<SeerrApi['requestsPage']> { return this.desk.requestsPage(...a); }
  createRequest(...a: Parameters<SeerrApi['createRequest']>): ReturnType<SeerrApi['createRequest']> { return this.desk.createRequest(...a); }
  cancelRequest(id: number): Promise<void> { return this.desk.cancelRequest(id); }
  approveRequest(id: number): Promise<void> { return this.desk.approveRequest(id); }
  declineRequest(id: number): Promise<void> { return this.desk.declineRequest(id); }
  issues(...a: Parameters<SeerrApi['issues']>): ReturnType<SeerrApi['issues']> { return this.desk.issues(...a); }
  // ── phase5-7: end ──

  private async rowDetail(r: RequestRaw): Promise<{ title?: string; name?: string; releaseDate?: string; firstAirDate?: string; posterPath?: string } | undefined> {
    const tmdb = r.media?.tmdbId;
    if (!tmdb) return undefined;
    try {
      return await this.desk.titleOf(r.type === 'tv' || r.media?.mediaType === 'tv' ? 'tv' : 'movie', tmdb);
    } catch {
      return undefined;
    }
  }

  private toRequest(r: RequestRaw, d?: { title?: string; name?: string; releaseDate?: string; firstAirDate?: string; posterPath?: string }): SeerrRequest {
    const tv = r.type === 'tv' || r.media?.mediaType === 'tv';
    return {
      id: r.id ?? 0,
      tmdbId: r.media?.tmdbId ?? 0,
      mediaType: tv ? 'tv' : 'movie',
      title: d?.title ?? d?.name ?? '',
      year: yearOf(d?.releaseDate ?? d?.firstAirDate),
      posterPath: d?.posterPath || undefined,
      state: requestState(r.status, r.media?.status),
      requestedBy: r.requestedBy?.displayName ?? r.requestedBy?.jellyfinUsername ?? r.requestedBy?.username ?? '',
      createdAt: r.createdAt ?? '',
      seasons: r.seasons?.map(s => s.seasonNumber),
      progress: downloadPercent(r.media?.downloadStatus), // home
    };
  }
}

// ── home: begin ──
/** Percent downloaded (0-100) from Seerr's downloadStatus list, or undefined when nothing is downloading / sizes are unknown. */
export function downloadPercent(list: Array<{ size?: number; sizeLeft?: number }> | undefined): number | undefined {
  if (!list?.length) return undefined;
  const size = list.reduce((a, d) => a + (d.size ?? 0), 0);
  const left = list.reduce((a, d) => a + (d.sizeLeft ?? 0), 0);
  if (size <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round(((size - left) / size) * 100)));
}
// ── home: end ──
