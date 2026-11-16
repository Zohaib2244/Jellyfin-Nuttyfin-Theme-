import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ApiError, type Http } from '../src/api/http';
import {
  explainRequestError, hitToResult, mapDetail, mapRequest, matchesFilter, permsFrom, PERM, seasonStates, SeerrDesk, serverFilter,
} from '../src/api/seerr-desk';

const fx = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/seerr/${name}.json`, import.meta.url), 'utf8')) as T;
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- raw Seerr fixtures

describe('permissions (Seerr bit flags)', () => {
  it('admin can do everything', () => {
    const p = permsFrom(2);
    expect(p).toMatchObject({ isAdmin: true, request: true, requestMovie: true, requestTv: true, advanced: true, manageRequests: true, createIssues: true, request4k: true });
  });
  it('a plain member', () => {
    const p = permsFrom(PERM.REQUEST | 128 /* auto-approve: grants nothing else */);
    expect(p).toMatchObject({ isAdmin: false, request: true, manageRequests: false, advanced: false, createIssues: false, request4k: false });
  });
  it('real permission values from the server: 160 = request + auto-approve', () => {
    expect(permsFrom(160)).toMatchObject({ request: true, requestMovie: true, requestTv: true, manageRequests: false });
  });
  it('film-only and none', () => {
    expect(permsFrom(PERM.REQUEST_MOVIE)).toMatchObject({ requestMovie: true, requestTv: false, request: true });
    expect(permsFrom(0)).toMatchObject({ request: false, requestMovie: false, requestTv: false });
  });
});

describe('request list from the real server shape', () => {
  const list = fx<{ results: Any[] }>('request-list');
  it('tv request that finished is Ready, linked to the library, with season numbers', () => {
    const r = mapRequest(list.results.find(x => x.type === 'tv') as never, { name: 'Show', firstAirDate: '2026-10-13', posterPath: '/p.jpg' });
    expect(r).toMatchObject({ mediaType: 'tv', state: 'available', title: 'Show', year: 2026, seasons: [1], jellyfinId: 'jf-item-id', posterPath: '/p.jpg' });
    expect(r.requestedById).toBeTypeOf('number');
  });
  it('an approved movie whose media is processing shows as downloading (no percent without sizes)', () => {
    const raw = list.results.find(x => x.type === 'movie' && x.media.status === 3) as never;
    const r = mapRequest(raw, { title: 'Film' });
    expect(r.state).toBe('downloading');
    expect(r.progress).toBeUndefined();
  });
  it('download percent comes from size and sizeLeft', () => {
    const raw = JSON.parse(JSON.stringify(list.results[1])) as Any;
    raw.status = 2; raw.media.status = 3; raw.media.downloadStatus = [{ size: 1000, sizeLeft: 250 }];
    expect(mapRequest(raw as never, { title: 'T' })).toMatchObject({ state: 'downloading', progress: 75 });
  });
  it('declined, failed and pending', () => {
    const base = { id: 9, createdAt: '2026-01-01T00:00:00Z', type: 'movie', media: { tmdbId: 3, status: 1 }, requestedBy: { id: 4, displayName: 'Mia' } };
    expect(mapRequest({ ...base, status: 3 } as never).state).toBe('declined');
    expect(mapRequest({ ...base, status: 1 } as never)).toMatchObject({ state: 'requested', requestedBy: 'Mia', requestedById: 4 });
    expect(mapRequest({ ...base, status: 4 } as never)).toMatchObject({ state: 'approved', failed: true });
    expect(mapRequest({ ...base, status: 5, media: { tmdbId: 3, status: 7 } } as never).state).toBe('available');
  });
});

describe('search hits', () => {
  it('maps films and shows, drops people, keeps partial and library id', () => {
    const hits = fx<{ results: Any[] }>('search').results;
    const mapped = hits.map(h => hitToResult(h as never));
    expect(mapped.filter(Boolean).length).toBe(hits.length);
    expect(mapped[0]).toMatchObject({ mediaType: 'movie', title: 'Dune', year: 2021, posterPath: expect.stringMatching(/jpg$/) });
    expect(hitToResult({ id: 1, mediaType: 'person', name: 'X' })).toBeNull();
    expect(hitToResult({ id: 2, mediaType: 'tv', name: 'The Boys', mediaInfo: { status: 4, jellyfinMediaId: 'abc' } })).toMatchObject({ state: 'available', partial: true, jellyfinId: 'abc' });
    expect(hitToResult({ id: 3, mediaType: 'movie', title: 'M', mediaInfo: { status: 2 } })).toMatchObject({ state: 'requested', partial: undefined });
  });
});

describe('detail and seasons', () => {
  it('real tv detail: season 1 is available', () => {
    const d = mapDetail('tv', 213375, fx('tv-detail'), 1);
    expect(d).toMatchObject({ mediaType: 'tv', state: 'available', partial: false, jellyfinId: 'jf-item-id' });
    expect(d.seasons).toEqual([expect.objectContaining({ number: 1, name: 'Miniseries', episodes: 8, state: 'available' })]);
  });
  it('seasons inside open requests count as taken; the best state wins; declined or 4K requests do not', () => {
    const m = {
      seasons: [{ seasonNumber: 1, status: 5 }, { seasonNumber: 2, status: 3 }],
      requests: [
        { id: 1, status: 1, seasons: [{ seasonNumber: 3 }] },
        { id: 2, status: 2, seasons: [{ seasonNumber: 2 }, { seasonNumber: 4 }] },
        { id: 3, status: 3, seasons: [{ seasonNumber: 5 }] },
        { id: 4, status: 2, is4k: true, seasons: [{ seasonNumber: 6 }] },
      ],
    };
    const s = seasonStates(m);
    expect([...s.entries()]).toEqual([[1, 'available'], [2, 'downloading'], [3, 'requested'], [4, 'approved']]);
  });
  it('knows my own open request so it can be cancelled', () => {
    const d = mapDetail('movie', 1, { title: 'F', mediaInfo: { status: 2, requests: [{ id: 41, status: 1, requestedBy: { id: 9 } }, { id: 42, status: 1, requestedBy: { id: 3 } }] } }, 3);
    expect(d.myRequestId).toBe(42);
    expect(d.state).toBe('requested');
    expect(mapDetail('movie', 1, { title: 'F' }, 3)).toMatchObject({ state: undefined, partial: false, seasons: [] });
  });
});

describe('failure explanations', () => {
  const err = (status: number, message?: string, kind: ApiError['kind'] = 'client'): ApiError => new ApiError(status, kind, 'x', message ? { message } : undefined);
  it('duplicate', () => expect(explainRequestError(err(409, 'Request for this media already exists.'))).toMatchObject({ reason: 'duplicate', message: expect.stringMatching(/already asked/) }));
  it('quota', () => expect(explainRequestError(err(403, 'Quota exceeded.'))).toMatchObject({ reason: 'quota', message: expect.stringMatching(/used up/) }));
  it('permission', () => expect(explainRequestError(err(403, 'You do not have permission to make this request.')).reason).toBe('permission'));
  it('blocklisted', () => expect(explainRequestError(err(403, 'This title is blocklisted.')).reason).toBe('blocked'));
  it('nothing left to ask', () => expect(explainRequestError(err(202, 'No seasons available to request')).reason).toBe('no-seasons'));
  it('network and server trouble', () => {
    expect(explainRequestError(err(0, undefined, 'network')).reason).toBe('unavailable');
    expect(explainRequestError(err(502, undefined, 'server')).reason).toBe('unavailable');
  });
  it('anything else is a calm generic message', () => {
    expect(explainRequestError(new Error('boom')).reason).toBe('unknown');
    expect(explainRequestError(err(400, 'weird')).message).toMatch(/Nothing was asked for/);
  });
});

describe('filters', () => {
  it('server-side names (Seerr 3.x) and the client check', () => {
    expect(['all', 'waiting', 'onway', 'ready', 'declined'].map(f => serverFilter(f as never))).toEqual(['all', 'pending', 'processing', 'completed', 'all']);
    const r = (state: string) => ({ state } as never);
    expect(matchesFilter(r('approved'), 'onway')).toBe(true);
    expect(matchesFilter(r('downloading'), 'onway')).toBe(true);
    expect(matchesFilter(r('requested'), 'onway')).toBe(false);
    expect(matchesFilter(r('declined'), 'declined')).toBe(true);
    expect(matchesFilter(r('available'), 'all')).toBe(true);
  });
});

/** A scripted Http: answers by path prefix and records every call. */
function fakeHttp(routes: Record<string, unknown>): { http: Http; calls: Array<{ path: string; opts: Any }> } {
  const calls: Array<{ path: string; opts: Any }> = [];
  const http = (async (path: string, opts: Any = {}) => {
    calls.push({ path, opts });
    const key = Object.keys(routes).find(k => path === k || path.startsWith(`${k}?`) || (k.endsWith('*') && path.startsWith(k.slice(0, -1))));
    if (!key) throw new ApiError(404, 'not-found', `no route ${path}`);
    const v = routes[key];
    if (v instanceof Error) throw v;
    return typeof v === 'function' ? (v as (o: Any) => unknown)(opts) : v;
  }) as unknown as Http;
  return { http, calls };
}

describe('SeerrDesk against a scripted server', () => {
  const session = (perms: number) => () => ({ userId: 1, perms });
  const yes = async (): Promise<boolean> => true;

  it('hides quality and 4K when the person may not use them (Seerr has 4K off and the member is not advanced)', async () => {
    const { http, calls } = fakeHttp({ '/settings/public': fx('settings-public') });
    const caps = await new SeerrDesk(http, session(32), yes).capabilities();
    expect(caps?.fourK).toEqual({ movie: false, tv: false });
    expect(caps?.profiles).toEqual({});
    expect(calls.some(c => c.path.startsWith('/service'))).toBe(false);
  });

  it('offers quality profiles to advanced users, from the default non-4K server', async () => {
    const { http } = fakeHttp({
      '/settings/public': { ...fx<Any>('settings-public'), movie4kEnabled: true },
      '/service/radarr/0': fx('service-radarr-0'), '/service/radarr': fx('service-radarr'),
      '/service/sonarr/0': fx('service-sonarr-0'), '/service/sonarr': [{ id: 0, isDefault: true, is4k: false }],
    });
    const caps = await new SeerrDesk(http, session(2), yes).capabilities();
    expect(caps?.profiles.movie?.list.map(p => p.name)).toContain('HD-1080p');
    expect(caps?.profiles.movie?.defaultId).toBe(6);
    expect(caps?.profiles.tv?.list.length).toBeGreaterThan(1);
    expect(caps?.fourK.movie).toBe(true);
    expect(caps?.fourK.tv).toBe(false); // series4kEnabled is false
  });

  it('a server that cannot be asked (profiles fail) just means no picker', async () => {
    const { http } = fakeHttp({ '/settings/public': fx('settings-public'), '/service/radarr': new ApiError(403, 'forbidden', 'no') });
    const caps = await new SeerrDesk(http, session(2), yes).capabilities();
    expect(caps?.profiles).toEqual({});
  });

  it('is null when Seerr is not available', async () => {
    const { http } = fakeHttp({});
    expect(await new SeerrDesk(http, session(2), async () => false).capabilities()).toBeNull();
    expect(await new SeerrDesk(http, session(2), async () => false).requestsPage({ scope: 'mine', filter: 'all', take: 5, skip: 0 })).toEqual({ items: [], total: 0 });
  });

  it('pages requests with the right query, titles filled in, declined filtered after loading', async () => {
    const list = fx<Any>('request-list');
    const { http, calls } = fakeHttp({ '/request': list, '/tv/*': { name: 'The Show', firstAirDate: '2026-10-13' }, '/movie/*': { title: 'A Film', releaseDate: '2020-01-01' } });
    const desk = new SeerrDesk(http, session(2), yes);
    const page = await desk.requestsPage({ scope: 'mine', filter: 'onway', take: 12, skip: 24 });
    const q = calls.find(c => c.path === '/request')?.opts.query;
    expect(q).toMatchObject({ take: 12, skip: 24, filter: 'processing', sort: 'added', requestedBy: 1 });
    expect(page.items.every(i => i.state === 'approved' || i.state === 'downloading')).toBe(true);
    expect(page.items[0]?.title).toBe('A Film');
    const all = await desk.requestsPage({ scope: 'all', filter: 'all', take: 12, skip: 0 });
    expect(calls.filter(c => c.path === '/request').at(-1)?.opts.query.requestedBy).toBeUndefined();
    expect(all.items.length).toBe(3);
    expect(all.total).toBe(3);
  });

  it('title lookups are cached', async () => {
    const { http, calls } = fakeHttp({ '/request': fx('request-list'), '/tv/*': { name: 'S' }, '/movie/*': { title: 'M' } });
    const desk = new SeerrDesk(http, session(2), yes);
    await desk.requestsPage({ scope: 'all', filter: 'all', take: 5, skip: 0 });
    const first = calls.length;
    await desk.requestsPage({ scope: 'all', filter: 'all', take: 5, skip: 0 });
    expect(calls.length - first).toBe(1); // only the list again
  });

  it('asks for a film, a whole show and chosen seasons; passes 4K and quality', async () => {
    const posts: Any[] = [];
    const { http } = fakeHttp({
      '/request': (o: Any) => { if (o.method === 'POST') { posts.push(o.body); return { id: 50, status: 1, type: o.body.mediaType, media: { tmdbId: o.body.mediaId, status: 2 }, seasons: [] }; } return {}; },
      '/movie/*': { title: 'M' }, '/tv/*': { name: 'S' },
    });
    const desk = new SeerrDesk(http, session(32), yes);
    expect(await desk.createRequest({ mediaType: 'movie', tmdbId: 10 })).toMatchObject({ id: 50, state: 'requested', title: 'M' });
    await desk.createRequest({ mediaType: 'tv', tmdbId: 11 });
    await desk.createRequest({ mediaType: 'tv', tmdbId: 11, seasons: [2, 3], is4k: true, profileId: 4 });
    expect(posts).toEqual([
      { mediaType: 'movie', mediaId: 10 },
      { mediaType: 'tv', mediaId: 11, seasons: 'all' },
      { mediaType: 'tv', mediaId: 11, seasons: [2, 3], is4k: true, profileId: 4 },
    ]);
  });

  it('Seerr answering 202 with only a message means nothing was left to ask', async () => {
    const { http } = fakeHttp({ '/request': { status: 202, message: 'No seasons available to request' } });
    const e = await new SeerrDesk(http, session(32), yes).createRequest({ mediaType: 'tv', tmdbId: 1 }).catch((x: unknown) => x);
    expect(explainRequestError(e).reason).toBe('no-seasons');
  });

  it('request failures keep their HTTP status for explainRequestError', async () => {
    const { http } = fakeHttp({ '/request': new ApiError(403, 'forbidden', 'x', { message: 'Quota exceeded.' }) });
    const e = await new SeerrDesk(http, session(32), yes).createRequest({ mediaType: 'movie', tmdbId: 1 }).catch((x: unknown) => x);
    expect(explainRequestError(e).reason).toBe('quota');
  });

  it('cancel, approve and decline use the right calls', async () => {
    const seen: string[] = [];
    const http = (async (path: string, o: Any = {}) => { seen.push(`${o.method ?? 'GET'} ${path}`); }) as unknown as Http;
    const desk = new SeerrDesk(http, session(2), yes);
    await desk.cancelRequest(5); await desk.approveRequest(6); await desk.declineRequest(7);
    expect(seen).toEqual(['DELETE /request/5', 'POST /request/6/approve', 'POST /request/7/decline']);
  });

  it('issues: kind, status, first comment is the message, replies counted', async () => {
    const { http, calls } = fakeHttp({
      '/issue': { results: [{ id: 3, issueType: 3, status: 1, createdAt: '2026-11-10T00:00:00Z', media: { tmdbId: 9, mediaType: 'movie', jellyfinMediaId: 'abc' }, createdBy: { displayName: 'Me' }, comments: [{ message: 'Out of sync' }, { message: 'On it' }] },
        { id: 2, issueType: 9, status: 2, media: { tmdbId: 8, mediaType: 'tv' }, comments: [] }] },
      '/movie/*': { title: 'Film' }, '/tv/*': { name: 'Show' },
    });
    const list = await new SeerrDesk(http, session(2), yes).issues({ mine: true, take: 5 });
    expect(calls[0]?.opts.query).toMatchObject({ take: 5, createdBy: 1, sort: 'added' });
    expect(list[0]).toMatchObject({ kind: 'subtitles', status: 'open', message: 'Out of sync', replies: 1, title: 'Film', jellyfinId: 'abc' });
    expect(list[1]).toMatchObject({ kind: 'other', status: 'resolved', replies: 0, title: 'Show' });
  });

  it('discover drops non film/show rows', async () => {
    const { http } = fakeHttp({ '/discover/trending': { results: [{ id: 1, mediaType: 'movie', title: 'A' }, { id: 2, mediaType: 'person', name: 'P' }] } });
    expect((await new SeerrDesk(http, session(2), yes).discover()).map(r => r.title)).toEqual(['A']);
  });

  it('detail is null when Seerr does not know it', async () => {
    const { http } = fakeHttp({});
    expect(await new SeerrDesk(http, session(2), yes).detail('movie', 1)).toBeNull();
  });
});
