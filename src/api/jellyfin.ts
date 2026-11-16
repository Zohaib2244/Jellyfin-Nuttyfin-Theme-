/**
 * Real Jellyfin client (same-origin /jf proxy). Auth: `Authorization: MediaBrowser Client=.., Token=..`.
 * A 401 on any call (except the sign-in calls themselves) signs out and sends the browser to #/login.
 * Field lists are chosen so ONE call returns everything the UI shows (no per-row follow-up requests).
 */
import { currentAuthHeader, session as sessionStore, type StoredSession } from './auth';
import type { Backend, QuickConnectApi } from './backend';
import { SignInError } from './backend';
import { ApiError, createHttp, type Http } from './http';
import { JF_BASE } from './images';
import { normaliseCollection, normaliseItem, normaliseSeason, normaliseVersion, withinDays, type BaseItemDto } from './normalise';
import { SeerrClient } from './seerr';
import type { CollectionProgress, LeavingSoon } from './types'; // home
import type {
  Collection, Episode, GenreCount, ItemsQuery, LibraryView, MediaItem, Paged, PlaybackInfo, PlaybackReport, QuickConnectSession, Season,
  SortKey, Title, User,
} from './types';

/* Optional fields. (CommunityRating, OfficialRating, RunTimeTicks, ProductionYear, UserData and image tags always come back.) */
export const LIST_FIELDS = ['Overview', 'Genres', 'DateCreated', 'PrimaryImageAspectRatio', 'Taglines', 'ChildCount', 'Studios'] as const;
export const EPISODE_FIELDS = ['Overview', 'DateCreated', 'PrimaryImageAspectRatio', 'ParentId'] as const;
const IMAGE_TYPES = ['Primary', 'Backdrop', 'Thumb', 'Logo'] as const;
// ── library/details: begin ──
/** Library lists also need the episode totals and "last added" date that drive the shows progress board. */
export const LIB_FIELDS = [...LIST_FIELDS, 'RecursiveItemCount', 'DateLastMediaAdded'] as const;
const PAGE_CHUNK = 500;
// ── library/details: end ──

const SORT: Record<SortKey, string> = {
  name: 'SortName', added: 'DateCreated', rating: 'CommunityRating', year: 'PremiereDate',
  runtime: 'Runtime', played: 'DatePlayed', random: 'Random',
};
const TYPE: Record<NonNullable<ItemsQuery['kind']>, string> = { movie: 'Movie', series: 'Series', episode: 'Episode' };

interface AuthResult {
  AccessToken: string;
  User: { Id: string; Name: string; PrimaryImageTag?: string; Policy?: { IsAdministrator?: boolean } };
}
interface ItemsResult { Items?: BaseItemDto[]; TotalRecordCount?: number; StartIndex?: number }
interface QuickConnectResult { Secret: string; Code: string; Authenticated?: boolean }

interface PlaybackInfoResult {
  PlaySessionId?: string;
  MediaSources?: Array<{
    Id?: string;
    ETag?: string;
    SupportsDirectPlay?: boolean;
    SupportsDirectStream?: boolean;
    SupportsTranscoding?: boolean;
    TranscodingUrl?: string;
    DirectStreamUrl?: string;
    DefaultAudioStreamIndex?: number;
    DefaultSubtitleStreamIndex?: number;
  } & import('./normalise').MediaSourceDto>;
}

/** Browser-side playback capabilities sent to PlaybackInfo. The server is Haswell (H.264 hardware only):
 *  prefer direct play of H.264/AAC MP4/MKV, otherwise ask for an H.264 <=1080p HLS transcode. */
const DEVICE_PROFILE = {
  Name: 'Nuttyfin web',
  MaxStreamingBitrate: 20_000_000,
  DirectPlayProfiles: [
    { Container: 'mp4,m4v', Type: 'Video', VideoCodec: 'h264,vp9,av1', AudioCodec: 'aac,mp3,opus,flac' },
    { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9,av1', AudioCodec: 'vorbis,opus' },
  ],
  TranscodingProfiles: [
    { Container: 'ts', Type: 'Video', Protocol: 'hls', Context: 'Streaming', VideoCodec: 'h264', AudioCodec: 'aac,mp3', MaxAudioChannels: '2', MinSegments: 1, BreakOnNonKeyFrames: true },
  ],
  CodecProfiles: [
    { Type: 'Video', Codec: 'h264', Conditions: [{ Condition: 'LessThanEqual', Property: 'Width', Value: '1920', IsRequired: false }] },
  ],
  SubtitleProfiles: [
    { Format: 'vtt', Method: 'External' },
    { Format: 'srt', Method: 'External' },
    { Format: 'ass', Method: 'Encode' },
    { Format: 'ssa', Method: 'Encode' },
    { Format: 'pgssub', Method: 'Encode' },
  ],
};

/** Map a failed sign-in call to a reason the login page can explain. */
export function toSignInError(e: unknown): SignInError {
  if (e instanceof SignInError) return e;
  if (e instanceof ApiError) {
    if (e.kind === 'unauthorized') return new SignInError('bad-credentials');
    if (e.kind === 'network') return new SignInError('unreachable');
    if (e.kind === 'server') return new SignInError(e.status === 500 ? 'server-error' : 'unreachable');
  }
  return new SignInError('unknown');
}

export class JellyfinBackend implements Backend {
  readonly mode = 'jellyfin' as const;
  readonly seerr: SeerrClient;
  readonly quickConnect: QuickConnectApi;
  private user: User | null = null;
  private token: string | null = null;
  private readonly listeners = new Set<(u: User | null) => void>();
  private readonly http: Http;

  constructor() {
    const saved = sessionStore.load();
    if (saved) {
      this.token = saved.token;
      this.user = { id: saved.userId, name: saved.userName, isAdmin: saved.isAdmin, avatarTag: saved.avatarTag };
    }
    this.http = createHttp({
      base: JF_BASE,
      headers: () => ({ Authorization: currentAuthHeader(this.token ?? undefined) }),
      onUnauthorized: () => this.expire(),
    });
    this.seerr = new SeerrClient(() => this.user);
    this.quickConnect = {
      enabled: async () => {
        try { return await this.http<boolean>('/QuickConnect/Enabled', { expect401: true }); } catch { return false; }
      },
      start: async () => {
        try {
          const r = await this.http<QuickConnectResult>('/QuickConnect/Initiate', { method: 'POST', expect401: true });
          return { secret: r.Secret, code: r.Code };
        } catch (e) { throw toSignInError(e); }
      },
      poll: async (s: QuickConnectSession) => {
        try {
          const r = await this.http<QuickConnectResult>('/QuickConnect/Connect', { query: { secret: s.secret }, expect401: true });
          if (!r.Authenticated) return null;
          const auth = await this.http<AuthResult>('/Users/AuthenticateWithQuickConnect', { method: 'POST', body: { Secret: s.secret }, expect401: true });
          return this.adopt(auth);
        } catch (e) { throw toSignInError(e); }
      },
    };
  }

  /* ── auth ── */
  currentUser(): User | null { return this.user; }

  onAuthChange(cb: (u: User | null) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private emit(): void { for (const cb of [...this.listeners]) cb(this.user); }

  private adopt(auth: AuthResult): User {
    const user: User = { id: auth.User.Id, name: auth.User.Name, isAdmin: !!auth.User.Policy?.IsAdministrator, avatarTag: auth.User.PrimaryImageTag };
    this.token = auth.AccessToken;
    this.user = user;
    const stored: StoredSession = { token: auth.AccessToken, userId: user.id, userName: user.name, isAdmin: user.isAdmin, avatarTag: user.avatarTag };
    sessionStore.save(stored);
    this.emit();
    return user;
  }

  async signIn(username: string, password: string): Promise<User> {
    let auth: AuthResult;
    try {
      auth = await this.http<AuthResult>('/Users/AuthenticateByName', { method: 'POST', body: { Username: username, Pw: password }, expect401: true });
    } catch (e) { throw toSignInError(e); }
    const user = this.adopt(auth);
    // Requests live in Seerr, which signs in with the same account. Failure is fine: request features just stay hidden.
    await Promise.race([this.seerr.connect(username, password), new Promise<void>(r => setTimeout(r, 5000))]);
    return user;
  }

  async signOut(): Promise<void> {
    const wasSignedIn = !!this.token;
    if (wasSignedIn) { try { await this.http('/Sessions/Logout', { method: 'POST', expect401: true, timeoutMs: 4000 }); } catch { /* the token may already be dead */ } }
    this.seerr.reset();
    this.clear();
  }

  private clear(): void {
    this.token = null;
    this.user = null;
    sessionStore.clear();
    this.emit();
  }

  /** A 401 on a normal call: the token is dead. */
  private expire(): void {
    if (!this.token) return;
    this.seerr.reset();
    this.clear();
    if (!location.hash.startsWith('#/login')) location.hash = '#/login';
  }

  private get uid(): string {
    if (!this.user) throw new ApiError(401, 'unauthorized', 'Not signed in');
    return this.user.id;
  }

  /* ── browsing ── */
  async views(): Promise<LibraryView[]> {
    const r = await this.http<{ Items?: Array<BaseItemDto & { CollectionType?: string }> }>('/UserViews', { query: { userId: this.uid } });
    return (r.Items ?? []).map(v => ({ id: v.Id, name: v.Name ?? '', collection: v.CollectionType ?? '' }));
  }

  async resume(limit = 12): Promise<MediaItem[]> {
    const r = await this.http<ItemsResult>('/UserItems/Resume', {
      query: { userId: this.uid, limit, mediaTypes: 'Video', includeItemTypes: ['Movie', 'Episode'], fields: [...LIST_FIELDS, 'ParentId'], enableImageTypes: IMAGE_TYPES, imageTypeLimit: 1 },
    });
    return (r.Items ?? []).map(normaliseItem);
  }

  async nextUp(limit = 12): Promise<Episode[]> {
    const r = await this.http<ItemsResult>('/Shows/NextUp', {
      query: { userId: this.uid, limit, fields: EPISODE_FIELDS, enableImageTypes: IMAGE_TYPES, imageTypeLimit: 1, enableResumable: false, enableRewatching: false },
    });
    return (r.Items ?? []).map(normaliseItem).filter((i): i is Episode => i.kind === 'episode');
  }

  async latest(opts: { kind?: 'movie' | 'series'; limit?: number } = {}): Promise<Title[]> {
    const r = await this.http<BaseItemDto[]>('/Items/Latest', {
      query: {
        userId: this.uid, limit: opts.limit ?? 20, groupItems: true, fields: LIST_FIELDS,
        includeItemTypes: opts.kind ? TYPE[opts.kind] : ['Movie', 'Series'], enableImageTypes: IMAGE_TYPES, imageTypeLimit: 1,
      },
    });
    return titles(r ?? []);
  }

  // ── library/details: begin ── (filters, runtime window, name windows; genres/ratings are PIPE separated in Jellyfin)
  async items(q: ItemsQuery, signal?: AbortSignal): Promise<Paged<Title>> {
    if (q.minRuntimeMin != null || q.maxRuntimeMin != null) return this.itemsByRuntime(q, signal);
    return this.itemsPage(q, signal);
  }

  private async itemsPage(q: ItemsQuery, signal?: AbortSignal): Promise<Paged<Title>> {
    const sort = SORT[q.sort ?? 'name'];
    const r = await this.http<ItemsResult>('/Items', {
      signal,
      query: {
        userId: this.uid, recursive: true,
        includeItemTypes: q.kind ? TYPE[q.kind] : ['Movie', 'Series'],
        searchTerm: q.search, genres: q.genres?.length ? q.genres.join('|') : undefined, years: q.years,
        officialRatings: q.ratings?.length ? q.ratings.join('|') : undefined,
        is4K: q.is4k || undefined, seriesStatus: q.seriesStatus,
        nameLessThan: q.nameLessThan, nameStartsWith: q.nameStartsWith,
        parentId: q.parentId, ids: q.ids,
        sortBy: sort === 'SortName' ? 'SortName' : [sort, 'SortName'],
        sortOrder: q.descending ? 'Descending' : 'Ascending',
        startIndex: q.start ?? 0, limit: q.limit ?? 60,
        isPlayed: q.played, isFavorite: q.favourite, filters: q.resumable ? 'IsResumable' : undefined,
        fields: LIB_FIELDS, enableImageTypes: IMAGE_TYPES, imageTypeLimit: 1,
      },
    });
    return { items: titles(r.Items ?? []), total: r.TotalRecordCount ?? 0, start: r.StartIndex ?? q.start ?? 0 };
  }

  /** Jellyfin has no runtime filter, so walk the (otherwise filtered) list in big chunks and slice it ourselves.
   *  The walked list is kept for a minute so "Show more" and A to Z jumps do not repeat the walk. */
  private runtimeCache: { key: string; at: number; items: Title[] } | null = null;
  private async itemsByRuntime(q: ItemsQuery, signal?: AbortSignal): Promise<Paged<Title>> {
    const { start: _s, limit: _l, ...rest } = q;
    const key = JSON.stringify(rest);
    let all: Title[];
    const hit = this.runtimeCache;
    if (hit && hit.key === key && Date.now() - hit.at < 60_000) {
      all = hit.items;
    } else {
      const base: ItemsQuery = { ...rest, minRuntimeMin: undefined, maxRuntimeMin: undefined };
      all = [];
      for (let at = 0; ; at += PAGE_CHUNK) {
        const page = await this.itemsPage({ ...base, start: at, limit: PAGE_CHUNK }, signal);
        all.push(...page.items.filter(t => (q.minRuntimeMin == null || t.runtimeMin >= q.minRuntimeMin) && (q.maxRuntimeMin == null || t.runtimeMin <= q.maxRuntimeMin)));
        if (at + PAGE_CHUNK >= page.total || page.items.length === 0) break;
      }
      this.runtimeCache = { key, at: Date.now(), items: all };
    }
    const start = q.start ?? 0;
    return { items: all.slice(start, start + (q.limit ?? 60)), total: all.length, start };
  }
  // ── library/details: end ──

  async item(id: string): Promise<MediaItem> {
    const dto = await this.http<BaseItemDto>(`/Items/${encodeURIComponent(id)}`, { query: { userId: this.uid } });
    return normaliseItem(dto);
  }

  async similar(id: string, limit = 12): Promise<Title[]> {
    const r = await this.http<ItemsResult>(`/Items/${encodeURIComponent(id)}/Similar`, { query: { userId: this.uid, limit, fields: LIST_FIELDS } });
    return titles(r.Items ?? []);
  }

  async seasons(seriesId: string): Promise<Season[]> {
    const r = await this.http<ItemsResult>(`/Shows/${encodeURIComponent(seriesId)}/Seasons`, { query: { userId: this.uid, fields: ['ChildCount'], enableImageTypes: ['Primary'] } });
    return (r.Items ?? []).map(normaliseSeason);
  }

  async episodes(seriesId: string, seasonId?: string): Promise<Episode[]> {
    const r = await this.http<ItemsResult>(`/Shows/${encodeURIComponent(seriesId)}/Episodes`, {
      query: { userId: this.uid, seasonId, fields: EPISODE_FIELDS, enableImageTypes: ['Primary'], imageTypeLimit: 1 },
    });
    return (r.Items ?? []).map(normaliseItem).filter((i): i is Episode => i.kind === 'episode');
  }

  async search(query: string, limit = 8, signal?: AbortSignal): Promise<Title[]> {
    const r = await this.items({ search: query, limit }, signal);
    return r.items;
  }

  // ── home: begin ──
  async suggestions(limit = 12): Promise<Title[]> {
    const r = await this.http<ItemsResult>('/Items/Suggestions', {
      query: { userId: this.uid, limit, mediaType: 'Video', type: ['Movie', 'Series'], enableTotalRecordCount: false },
    });
    const dtos = r.Items ?? [];
    // This endpoint ignores Fields: if it came back bare, hydrate all picks in ONE follow-up call.
    if (dtos.length && !dtos.some(d => d.Overview || d.Genres?.length)) {
      const h = await this.http<ItemsResult>('/Items', {
        query: { userId: this.uid, ids: dtos.map(d => d.Id), fields: LIST_FIELDS, enableImageTypes: IMAGE_TYPES, imageTypeLimit: 1 },
      });
      const byId = new Map((h.Items ?? []).map(d => [d.Id, d] as const));
      return titles(dtos.map(d => byId.get(d.Id) ?? d));
    }
    return titles(dtos);
  }

  async recentlyAdded(opts: { kind?: 'movie' | 'series'; days?: number; limit?: number } = {}): Promise<Title[]> {
    const r = await this.items({ kind: opts.kind, sort: 'added', descending: true, limit: opts.limit ?? 40 });
    return withinDays(r.items, opts.days ?? 14);
  }

  async recentEpisodes(opts: { days?: number; limit?: number } = {}): Promise<Episode[]> {
    const r = await this.http<ItemsResult>('/Items', {
      query: {
        userId: this.uid, recursive: true, includeItemTypes: 'Episode', sortBy: ['DateCreated'], sortOrder: 'Descending',
        limit: opts.limit ?? 40, fields: EPISODE_FIELDS, enableImageTypes: IMAGE_TYPES, imageTypeLimit: 1, enableTotalRecordCount: false,
      },
    });
    const eps = (r.Items ?? []).map(normaliseItem).filter((i): i is Episode => i.kind === 'episode');
    return withinDays(eps, opts.days ?? 7);
  }

  async upcoming(opts: { days?: number; limit?: number } = {}): Promise<Episode[]> {
    const r = await this.http<ItemsResult>('/Shows/Upcoming', {
      query: { userId: this.uid, limit: opts.limit ?? 30, fields: EPISODE_FIELDS, enableImageTypes: IMAGE_TYPES, imageTypeLimit: 1, enableTotalRecordCount: false },
    });
    const horizon = Date.now() + (opts.days ?? 7) * 864e5;
    return (r.Items ?? []).map(normaliseItem)
      .filter((i): i is Episode => i.kind === 'episode')
      .filter(e => !e.premiered || new Date(e.premiered).getTime() <= horizon)
      .sort((a, b) => (a.premiered ?? '').localeCompare(b.premiered ?? ''));
  }

  async boxsets(limit = 6): Promise<CollectionProgress[]> {
    const sets = await this.http<ItemsResult>('/Items', {
      query: { userId: this.uid, recursive: true, includeItemTypes: 'BoxSet', sortBy: 'SortName', fields: ['ChildCount'], enableImageTypes: ['Primary'], imageTypeLimit: 1, enableTotalRecordCount: false },
    });
    // Sets we know are partly watched first (UnplayedItemCount < ChildCount); the rest only if there is room.
    const list = (sets.Items ?? []).map(d => ({ d, started: d.ChildCount != null && d.UserData?.UnplayedItemCount != null && d.UserData.UnplayedItemCount < d.ChildCount && d.UserData.UnplayedItemCount > 0 }));
    const picked = [...list.filter(x => x.started), ...list.filter(x => !x.started)].slice(0, limit * 2).map(x => x.d);
    const out = await Promise.all(picked.map(async set => {
      const kids = await this.http<ItemsResult>('/Items', {
        query: { userId: this.uid, parentId: set.Id, includeItemTypes: 'Movie', sortBy: ['PremiereDate', 'ProductionYear', 'SortName'], fields: ['PrimaryImageAspectRatio'], enableImageTypes: ['Primary'], imageTypeLimit: 1, enableTotalRecordCount: false },
      }).catch(() => ({ Items: [] as BaseItemDto[] }));
      return normaliseCollection(set, kids.Items ?? []);
    }));
    return out.filter(c => c.total >= 2).slice(0, limit);
  }

  async leavingSoon(): Promise<LeavingSoon[]> { return []; }
  // ── home: end ──

  /* ── playback ── */
  async playbackInfo(id: string, opts: { versionId?: string; audioIndex?: number; subtitleIndex?: number; startTicks?: number } = {}): Promise<PlaybackInfo> {
    const r = await this.http<PlaybackInfoResult>(`/Items/${encodeURIComponent(id)}/PlaybackInfo`, {
      method: 'POST',
      query: {
        userId: this.uid, mediaSourceId: opts.versionId, audioStreamIndex: opts.audioIndex, subtitleStreamIndex: opts.subtitleIndex,
        startTimeTicks: opts.startTicks, maxStreamingBitrate: DEVICE_PROFILE.MaxStreamingBitrate, autoOpenLiveStream: false,
      },
      body: { DeviceProfile: DEVICE_PROFILE },
    });
    const sources = r.MediaSources ?? [];
    const src = sources.find(s => s.Id === opts.versionId) ?? sources[0];
    if (!src?.Id) throw new ApiError(404, 'not-found', 'No playable file for this title');
    const version = normaliseVersion(src);
    const key = encodeURIComponent(this.token ?? '');
    let url = '';
    let method: PlaybackInfo['method'] = 'unavailable';
    if (src.SupportsDirectPlay) {
      method = 'direct';
      url = `${JF_BASE}/Videos/${encodeURIComponent(id)}/stream?static=true&mediaSourceId=${encodeURIComponent(src.Id)}&api_key=${key}${src.ETag ? `&tag=${encodeURIComponent(src.ETag)}` : ''}`;
    } else if (src.TranscodingUrl) {
      method = src.SupportsDirectStream ? 'directStream' : 'transcode';
      url = `${JF_BASE}${src.TranscodingUrl}`;
      if (!/api_key=/i.test(url)) url += `${url.includes('?') ? '&' : '?'}api_key=${key}`;
    }
    return {
      itemId: id, mediaSourceId: src.Id, playSessionId: r.PlaySessionId, url, method,
      badge: method === 'transcode' ? 'Will be converted' : method === 'unavailable' ? 'Cannot play here' : 'Plays perfectly here',
      isHls: /\.m3u8/i.test(url), version,
      audioStreamIndex: opts.audioIndex ?? src.DefaultAudioStreamIndex,
      subtitleStreamIndex: opts.subtitleIndex ?? src.DefaultSubtitleStreamIndex,
      startPositionTicks: opts.startTicks ?? 0,
    };
  }

  private report(path: string, r: PlaybackReport): Promise<void> {
    return this.http<void>(`/Sessions/Playing${path}`, {
      method: 'POST',
      body: {
        ItemId: r.itemId, MediaSourceId: r.mediaSourceId, PlaySessionId: r.playSessionId, PositionTicks: r.positionTicks,
        IsPaused: !!r.isPaused, CanSeek: true, AudioStreamIndex: r.audioStreamIndex, SubtitleStreamIndex: r.subtitleStreamIndex,
      },
    });
  }
  reportStart(r: PlaybackReport): Promise<void> { return this.report('', r); }
  reportProgress(r: PlaybackReport): Promise<void> { return this.report('/Progress', r); }
  reportStopped(r: PlaybackReport): Promise<void> { return this.report('/Stopped', r); }

  // ── library/details: begin ──
  async genres(kind: 'movie' | 'series', signal?: AbortSignal): Promise<GenreCount[]> {
    const r = await this.http<{ Items?: Array<BaseItemDto & { MovieCount?: number; SeriesCount?: number }> }>('/Genres', {
      signal, query: { userId: this.uid, includeItemTypes: TYPE[kind], sortBy: 'SortName', fields: 'ItemCounts' },
    });
    return (r.Items ?? []).map(g => ({ name: g.Name ?? '', count: (kind === 'movie' ? g.MovieCount : g.SeriesCount) ?? 0 })).filter(g => g.name);
  }

  async allSeasons(signal?: AbortSignal): Promise<Season[]> {
    const r = await this.http<ItemsResult>('/Items', {
      signal, query: { userId: this.uid, recursive: true, includeItemTypes: 'Season', fields: ['ChildCount'], enableImageTypes: ['Primary'], limit: 3000 },
    });
    return (r.Items ?? []).map(normaliseSeason);
  }

  async collections(signal?: AbortSignal): Promise<Collection[]> {
    const sets = await this.http<ItemsResult>('/Items', { signal, query: { userId: this.uid, recursive: true, includeItemTypes: 'BoxSet', sortBy: 'SortName', limit: 200 } });
    const out: Collection[] = [];
    const queue = [...(sets.Items ?? [])];
    const worker = async (): Promise<void> => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const kids = await this.http<ItemsResult>('/Items', {
          signal, query: { userId: this.uid, parentId: s.Id, sortBy: 'PremiereDate', fields: LIST_FIELDS, enableImageTypes: IMAGE_TYPES, imageTypeLimit: 1, limit: 100 },
        }).catch(() => ({ Items: [] as BaseItemDto[] }));
        const items = titles(kids.Items ?? []);
        if (items.length) out.push({ id: s.Id, name: s.Name ?? '', items });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out.sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
  }

  async episodeDetails(seriesId: string, seasonId: string, signal?: AbortSignal): Promise<Episode[]> {
    const r = await this.http<ItemsResult>(`/Shows/${encodeURIComponent(seriesId)}/Episodes`, {
      signal, query: { userId: this.uid, seasonId, fields: [...EPISODE_FIELDS, 'People', 'MediaSources'], enableImageTypes: ['Primary'], imageTypeLimit: 1 },
    });
    return (r.Items ?? []).map(normaliseItem).filter((i): i is Episode => i.kind === 'episode');
  }

  /** Only called from the owner-only Remove dialog, behind a two-step confirm. */
  async deleteFromJellyfin(id: string): Promise<void> {
    await this.http(`/Items/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  // ── library/details: end ──

  /* ── user actions ── */
  async setPlayed(id: string, played: boolean): Promise<void> {
    await this.http(`/UserPlayedItems/${encodeURIComponent(id)}`, { method: played ? 'POST' : 'DELETE', query: { userId: this.uid } });
  }
  async setFavourite(id: string, favourite: boolean): Promise<void> {
    await this.http(`/UserFavoriteItems/${encodeURIComponent(id)}`, { method: favourite ? 'POST' : 'DELETE', query: { userId: this.uid } });
  }
}

/** Movies/series only (a Latest or Similar call can include other types). */
function titles(dtos: BaseItemDto[]): Title[] {
  return dtos.map(normaliseItem).filter((i): i is Title => i.kind !== 'episode');
}
