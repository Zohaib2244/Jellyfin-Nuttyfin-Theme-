/**
 * Demo version of the Seerr desk (Requests page): everything in memory, nothing real is touched.
 * It shares the demo's request/search arrays so Home's Requests tab and the Requests page always agree.
 * Review aids: `?demo=1&member=1` signs in as an ordinary member (no approve/decline, no quality picker);
 * asking for "Barbie" fails with "not allowed", and the film quota runs out after three more requests.
 */
import { ApiError } from './http';
import type {
  DeskRequestInput, RequestFilter, RequestsPage, SeasonInfo, SeerrCapabilities, SeerrDeskApi, SeerrDetail, SeerrIssue,
} from './desk-types';
import { matchesFilter, permsFrom } from './seerr-desk';
import type { IssueKind, RequestState, SeerrQuota, SeerrRequest, SeerrResult, User } from './types';

export interface DemoDeskCtx {
  requests: SeerrRequest[];
  search: SeerrResult[];
  user(): User | null;
  /** Jellyfin id of a library title by name (so "Ready to watch" can link into the library) */
  libraryId(name: string): string | undefined;
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const NOW = Date.now();
const ago = (h: number): string => new Date(NOW - h * 3600e3).toISOString();
const isMember = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).has('member');
const ME = 1;

/** Season lists of the demo shows: [state per season] (undefined = nobody asked yet). */
const TV_SEASONS: Record<number, Array<RequestState | undefined>> = {
  76479: ['available', 'available', undefined, undefined],
  66732: [undefined, undefined, undefined, undefined, undefined],
  1396: ['approved', 'approved', undefined, undefined, undefined],
  83867: ['requested', undefined],
  94997: ['approved', 'approved', undefined],
};

/** Extra people, requests and search results so every list state can be seen. Called once by the demo backend. */
export function seedDemoDesk(ctx: DemoDeskCtx): void {
  const lib = (n: string): string | undefined => ctx.libraryId(n);
  for (const r of ctx.requests) { r.requestedById ??= ME; }
  const by = (id: number, name: string): Pick<SeerrRequest, 'requestedBy' | 'requestedById'> => ({ requestedBy: name, requestedById: id });
  const inception = ctx.requests.find(r => r.tmdbId === 27205);
  if (inception) inception.jellyfinId = lib('Inception');
  const more: SeerrRequest[] = [
    { id: 21, tmdbId: 402431, mediaType: 'movie', title: 'Wicked', year: 2024, state: 'requested', ...by(2, 'Mia'), createdAt: ago(3) },
    { id: 22, tmdbId: 95396, mediaType: 'tv', title: 'Severance', year: 2022, state: 'downloading', ...by(3, 'Sam'), createdAt: ago(30), seasons: [1, 2], progress: 41 },
    { id: 23, tmdbId: 565770, mediaType: 'movie', title: 'Blue Beetle', year: 2023, state: 'declined', ...by(2, 'Mia'), createdAt: ago(70) },
    { id: 24, tmdbId: 157336, mediaType: 'movie', title: 'Interstellar', year: 2014, state: 'available', ...by(3, 'Sam'), createdAt: ago(400), jellyfinId: lib('Interstellar') },
    { id: 25, tmdbId: 125988, mediaType: 'tv', title: 'Silo', year: 2023, state: 'available', ...by(ME, 'Demo'), createdAt: ago(900), seasons: [1, 2], jellyfinId: lib('Silo'), partial: true },
    { id: 26, tmdbId: 872585, mediaType: 'movie', title: 'Oppenheimer', year: 2023, state: 'available', ...by(2, 'Mia'), createdAt: ago(1300), jellyfinId: lib('Oppenheimer') },
  ];
  ctx.requests.push(...more);
  ctx.search.push(
    { tmdbId: 402431, mediaType: 'movie', title: 'Wicked', year: 2024, state: 'requested', overview: 'Elphaba and Glinda become unlikely friends at Shiz University.' },
    { tmdbId: 95396, mediaType: 'tv', title: 'Severance', year: 2022, state: 'downloading', overview: 'Employees whose memories are split between work and home.' },
    { tmdbId: 125988, mediaType: 'tv', title: 'Silo', year: 2023, state: 'available', partial: true, jellyfinId: lib('Silo'), overview: 'In a ruined future, thousands live in a giant underground silo.' },
    { tmdbId: 157336, mediaType: 'movie', title: 'Interstellar', year: 2014, state: 'available', jellyfinId: lib('Interstellar'), overview: 'A team of explorers travel through a wormhole in space.' },
    { tmdbId: 27205, mediaType: 'movie', title: 'Inception', year: 2010, state: 'available', jellyfinId: lib('Inception'), overview: 'A thief who steals secrets through dreams is given an impossible task.' },
    { tmdbId: 872585, mediaType: 'movie', title: 'Oppenheimer', year: 2023, state: 'available', jellyfinId: lib('Oppenheimer'), overview: 'The story of J. Robert Oppenheimer and the atomic bomb.' },
    { tmdbId: 1022789, mediaType: 'movie', title: 'Inside Out 2', year: 2024, overview: 'Riley becomes a teenager and new emotions arrive.' },
    { tmdbId: 912649, mediaType: 'movie', title: 'Venom: The Last Dance', year: 2024, overview: 'Eddie and Venom are on the run.' },
    { tmdbId: 119051, mediaType: 'tv', title: 'Wednesday', year: 2022, overview: 'Wednesday Addams investigates a murder spree at Nevermore Academy.' },
    { tmdbId: 100088, mediaType: 'tv', title: 'The Last of Us', year: 2023, overview: 'Joel and Ellie cross a post-pandemic America.' },
  );
  // The Boys is partly in the library
  const boys = ctx.search.find(r => r.tmdbId === 76479);
  if (boys) { boys.state = 'available'; boys.partial = true; }
}

export interface DemoDesk extends SeerrDeskApi {
  /** the demo Seerr's own quota (counts down as requests are made) */
  quota(): Promise<SeerrQuota>;
  requests(opts?: { mine?: boolean; take?: number }): Promise<SeerrRequest[]>;
  request(input: { mediaType: 'movie' | 'tv'; tmdbId: number; seasons?: number[] }): Promise<SeerrRequest>;
  reportIssue(input: { mediaType: 'movie' | 'tv'; tmdbId: number; kind: IssueKind; message: string }): Promise<boolean>;
}

export function createDemoDesk(ctx: DemoDeskCtx): DemoDesk {
  let movieUsed = 2;
  const issues: SeerrIssue[] = [
    { id: 2, kind: 'subtitles', status: 'open', message: 'Subtitles are wrong or out of sync: they run about 5 seconds late', createdAt: ago(20), createdBy: 'Demo', tmdbId: 157336, mediaType: 'movie', title: 'Interstellar', jellyfinId: ctx.libraryId('Interstellar'), replies: 0 },
    { id: 1, kind: 'audio', status: 'resolved', message: 'The sound is wrong or missing', createdAt: ago(300), createdBy: 'Demo', tmdbId: 125988, mediaType: 'tv', title: 'Silo', jellyfinId: ctx.libraryId('Silo'), replies: 1 },
  ];
  const myName = (): string => ctx.user()?.name ?? 'Demo';
  const isMine = (r: SeerrRequest): boolean => r.requestedById === ME || r.requestedBy === myName();
  const manage = (): boolean => !isMember();

  const stateOfTitle = (mediaType: 'movie' | 'tv', tmdbId: number): { state?: RequestState; partial: boolean; jellyfinId?: string } => {
    const hit = ctx.search.find(r => r.tmdbId === tmdbId && r.mediaType === mediaType);
    const open = ctx.requests.find(r => r.tmdbId === tmdbId && r.mediaType === mediaType && r.state !== 'declined');
    return { state: hit?.state ?? open?.state, partial: !!hit?.partial, jellyfinId: hit?.jellyfinId ?? open?.jellyfinId };
  };

  const detail = async (mediaType: 'movie' | 'tv', tmdbId: number): Promise<SeerrDetail | null> => {
    await sleep(160);
    const hit = ctx.search.find(r => r.tmdbId === tmdbId && r.mediaType === mediaType) ?? ctx.requests.find(r => r.tmdbId === tmdbId && r.mediaType === mediaType);
    if (!hit) return null;
    const st = stateOfTitle(mediaType, tmdbId);
    const seasonStates = TV_SEASONS[tmdbId] ?? [undefined, undefined, undefined];
    const seasons: SeasonInfo[] = mediaType === 'tv'
      ? seasonStates.map((state, i) => ({ number: i + 1, name: `Season ${i + 1}`, episodes: 8 + ((i * 2 + tmdbId) % 4), airDate: `${(hit.year ?? 2020) + i}-09-15`, state }))
      : [];
    const mine = ctx.requests.find(r => r.tmdbId === tmdbId && isMine(r) && (r.state === 'requested' || (manage() && r.state === 'approved')));
    return {
      tmdbId, mediaType, title: hit.title, year: hit.year, overview: ('overview' in hit ? hit.overview : undefined) ?? 'A good one for the whole house.', genres: ['Drama', 'Adventure'],
      rating: Math.round(74 + (tmdbId % 17)) / 10, runtimeMin: mediaType === 'movie' ? 100 + (tmdbId % 50) : 45, state: st.state, partial: st.partial, jellyfinId: st.jellyfinId, seasons, myRequestId: mine?.id,
    };
  };

  const desk: DemoDesk = {
    capabilities: async (): Promise<SeerrCapabilities> => {
      const perms = permsFrom(isMember() ? 32 : 2);
      return {
        userId: ME, perms, fourK: { movie: perms.request4k, tv: false },
        profiles: perms.advanced ? { movie: { list: [{ id: 1, name: 'Any' }, { id: 3, name: 'HD-720p' }, { id: 4, name: 'HD-1080p' }, { id: 5, name: 'Ultra-HD' }, { id: 6, name: 'HD - 720p/1080p' }], defaultId: 6 } } : {},
        specials: false, partialRequests: true,
      };
    },
    detail,
    discover: async (): Promise<SeerrResult[]> => {
      await sleep(120);
      return ctx.search.filter(r => !r.state && !ctx.requests.some(x => x.tmdbId === r.tmdbId)).slice(0, 12);
    },
    requestsPage: async (o: { scope: 'mine' | 'all'; filter: RequestFilter; take: number; skip: number }): Promise<RequestsPage> => {
      await sleep(140);
      const list = ctx.requests.filter(r => (o.scope === 'all' || isMine(r)) && matchesFilter(r, o.filter)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { items: list.slice(o.skip, o.skip + o.take), total: list.length };
    },
    createRequest: async (input: DeskRequestInput): Promise<SeerrRequest> => {
      await sleep(450);
      const hit = ctx.search.find(r => r.tmdbId === input.tmdbId);
      if (isMember() && input.tmdbId === 346698) throw new ApiError(403, 'forbidden', 'forbidden', { message: 'You do not have permission to make this request.' });
      if (input.tmdbId === 346698) throw new ApiError(403, 'forbidden', 'forbidden', { message: 'This title is blocklisted.' });
      const dup = ctx.requests.find(r => r.tmdbId === input.tmdbId && r.mediaType === input.mediaType && r.state !== 'declined' && r.state !== 'available');
      if (dup && input.mediaType === 'movie') throw new ApiError(409, 'client', 'conflict', { message: 'Request for this media already exists.' });
      if (input.mediaType === 'movie' && movieUsed >= 5) throw new ApiError(403, 'forbidden', 'forbidden', { message: 'Quota exceeded.' });
      let seasons: number[] | undefined;
      if (input.mediaType === 'tv') {
        const all = (TV_SEASONS[input.tmdbId] ?? [undefined, undefined, undefined]).map((s, i) => (s ? 0 : i + 1)).filter(Boolean);
        seasons = input.seasons === 'all' || input.seasons == null ? all : input.seasons.filter(n => all.includes(n));
        if (!seasons.length) throw new ApiError(202, 'client', 'No seasons', { message: 'No seasons available to request' });
        // remember them so the sheet shows them as asked next time
        const row = TV_SEASONS[input.tmdbId] ?? (TV_SEASONS[input.tmdbId] = [undefined, undefined, undefined]);
        for (const n of seasons) row[n - 1] = manage() ? 'approved' : 'requested';
      } else movieUsed++;
      const req: SeerrRequest = {
        id: Date.now(), tmdbId: input.tmdbId, mediaType: input.mediaType, title: hit?.title ?? 'Requested title', year: hit?.year, state: manage() ? 'approved' : 'requested',
        requestedBy: myName(), requestedById: ME, createdAt: new Date().toISOString(), seasons, is4k: input.is4k || undefined,
      };
      ctx.requests.unshift(req);
      if (hit) hit.state = req.state;
      return req;
    },
    cancelRequest: async (id: number): Promise<void> => {
      await sleep(250);
      const i = ctx.requests.findIndex(r => r.id === id);
      const r = ctx.requests[i];
      if (!r) return;
      if (!(manage() || (isMine(r) && r.state === 'requested'))) throw new ApiError(403, 'forbidden', 'forbidden', { message: 'No permission' });
      ctx.requests.splice(i, 1);
      const hit = ctx.search.find(x => x.tmdbId === r.tmdbId);
      if (hit && !ctx.requests.some(x => x.tmdbId === r.tmdbId)) hit.state = undefined;
      if (r.mediaType === 'movie' && isMine(r) && movieUsed > 0) movieUsed--;
    },
    approveRequest: async (id: number): Promise<void> => {
      await sleep(250);
      if (!manage()) throw new ApiError(403, 'forbidden', 'forbidden');
      const r = ctx.requests.find(x => x.id === id);
      if (r) r.state = 'approved';
    },
    declineRequest: async (id: number): Promise<void> => {
      await sleep(250);
      if (!manage()) throw new ApiError(403, 'forbidden', 'forbidden');
      const r = ctx.requests.find(x => x.id === id);
      if (r) { r.state = 'declined'; const hit = ctx.search.find(x => x.tmdbId === r.tmdbId); if (hit) hit.state = undefined; }
    },
    issues: async (): Promise<SeerrIssue[]> => { await sleep(120); return [...issues]; },

    quota: async (): Promise<SeerrQuota> => ({
      movie: { limit: 5, used: movieUsed, remaining: Math.max(0, 5 - movieUsed), days: 7 },
      tv: { limit: null, used: 1, remaining: null, days: null },
    }),
    requests: async (opts: { mine?: boolean; take?: number } = {}): Promise<SeerrRequest[]> =>
      ctx.requests.filter(r => !opts.mine || isMine(r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, opts.take ?? 30),
    // Home's quick button follows the same rules as the sheet
    request: input => desk.createRequest(input),
    reportIssue: async (input: { mediaType: 'movie' | 'tv'; tmdbId: number; kind: IssueKind; message: string }): Promise<boolean> => {
      await sleep(300);
      const lines = input.message.split('\n');
      const title = (lines[lines.length - 1] ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
      issues.unshift({
        id: Date.now(), kind: input.kind, status: 'open', message: lines[0] ?? '', createdAt: new Date().toISOString(), createdBy: myName(), tmdbId: input.tmdbId,
        mediaType: input.mediaType, title: lines.length > 1 && title ? title : 'Something in the library', replies: 0,
      });
      return true;
    },
  };
  return desk;
}
