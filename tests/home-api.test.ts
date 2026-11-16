import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoBackend } from '../src/api/demo';
import { JellyfinBackend } from '../src/api/jellyfin';
import { normaliseCollection, withinDays, type BaseItemDto } from '../src/api/normalise';
import { downloadPercent } from '../src/api/seerr';
import { store } from '../src/lib/storage';

describe('normaliseCollection', () => {
  const kid = (id: string, year: number, played: boolean): BaseItemDto => ({ Id: id, Name: id, Type: 'Movie', ProductionYear: year, UserData: { Played: played } });
  it('orders films by release and finds the next unwatched one', () => {
    const c = normaliseCollection({ Id: 'set', Name: 'Saga', Type: 'BoxSet' }, [kid('c', 2012, false), kid('a', 2001, true), kid('b', 2005, true), kid('d', 2019, false)]);
    expect(c.items.map(i => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(c).toMatchObject({ total: 4, seen: 2, nextId: 'c', name: 'Saga' });
  });
  it('has no next film when everything is watched', () => {
    expect(normaliseCollection({ Id: 's' }, [kid('a', 1, true)]).nextId).toBeUndefined();
  });
});

describe('withinDays', () => {
  const now = new Date('2026-11-16T12:00:00Z').getTime();
  it('keeps recent items (7-digit Jellyfin dates included) and drops old or undated ones', () => {
    const list = [{ added: '2026-11-15T09:44:19.4178445Z' }, { added: '2026-11-01T00:00:00Z' }, {}];
    expect(withinDays(list, 7, now)).toEqual([list[0]]);
    expect(withinDays(list, 30, now)).toHaveLength(2);
  });
});

describe('downloadPercent', () => {
  it('adds up sizes, tolerates missing data', () => {
    expect(downloadPercent([{ size: 1000, sizeLeft: 250 }])).toBe(75);
    expect(downloadPercent([{ size: 100, sizeLeft: 50 }, { size: 100, sizeLeft: 0 }])).toBe(75);
    expect(downloadPercent([])).toBeUndefined();
    expect(downloadPercent(undefined)).toBeUndefined();
    expect(downloadPercent([{ size: 0 }])).toBeUndefined();
  });
});

describe('JellyfinBackend home calls', () => {
  const urls: string[] = [];
  let answers: Record<string, unknown>;
  beforeEach(() => {
    urls.length = 0;
    store.set('session', { token: 't', userId: 'u1', userName: 'Sam', isAdmin: false });
    answers = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      const hit = Object.entries(answers).find(([k]) => url.includes(k));
      return new Response(JSON.stringify(hit ? hit[1] : { Items: [] }), { status: 200 });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); store.remove('session'); });

  it('suggestions: one call when the server returns full items', async () => {
    answers['/Items/Suggestions'] = { Items: [{ Id: 'm1', Type: 'Movie', Name: 'A', Overview: 'o', Genres: ['Drama'] }, { Id: 's1', Type: 'Series', Name: 'B', Genres: ['Drama'] }, { Id: 'e1', Type: 'Episode', Name: 'skip' }] };
    const r = await new JellyfinBackend().suggestions(5);
    expect(r.map(t => t.id)).toEqual(['m1', 's1']);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/jf/Items/Suggestions?userId=u1&limit=5');
  });
  it('suggestions: hydrates a bare answer with ONE follow-up call carrying Fields', async () => {
    answers['/Items/Suggestions'] = { Items: [{ Id: 'm1', Type: 'Movie' }, { Id: 'm2', Type: 'Movie' }] };
    answers['/jf/Items?'] = { Items: [{ Id: 'm1', Type: 'Movie', Name: 'One', Overview: 'o', Genres: ['Comedy'] }, { Id: 'm2', Type: 'Movie', Name: 'Two', Genres: ['Comedy'] }] };
    const r = await new JellyfinBackend().suggestions(2);
    expect(r.map(t => t.name)).toEqual(['One', 'Two']);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toMatch(/ids=m1,m2/);
    expect(urls[1]).toMatch(/fields=Overview,Genres/);
  });
  it('upcoming: asks /Shows/Upcoming with the fields the tile needs, soonest first, inside the window', async () => {
    const soon = new Date(Date.now() + 2 * 864e5).toISOString();
    const later = new Date(Date.now() + 20 * 864e5).toISOString();
    const sooner = new Date(Date.now() + 864e5).toISOString();
    answers['/Shows/Upcoming'] = { Items: [
      { Id: 'a', Type: 'Episode', SeriesId: 's', SeriesName: 'S', PremiereDate: soon },
      { Id: 'b', Type: 'Episode', SeriesId: 's', SeriesName: 'S', PremiereDate: later },
      { Id: 'c', Type: 'Episode', SeriesId: 's', SeriesName: 'S', PremiereDate: sooner },
    ] };
    const r = await new JellyfinBackend().upcoming({ days: 7 });
    expect(r.map(e => e.id)).toEqual(['c', 'a']);
    expect(urls[0]).toContain('/Shows/Upcoming');
    expect(urls[0]).toMatch(/fields=[^&]*Overview/);
    expect(urls[0]).toContain('enableImageTypes=Primary,Backdrop,Thumb,Logo');
  });
  it('recentlyAdded: newest first by DateCreated, filtered to the window', async () => {
    const fresh = new Date(Date.now() - 864e5).toISOString();
    const old = new Date(Date.now() - 90 * 864e5).toISOString();
    answers['/jf/Items?'] = { Items: [{ Id: 'n', Type: 'Movie', Name: 'N', DateCreated: fresh }, { Id: 'o', Type: 'Movie', Name: 'O', DateCreated: old }], TotalRecordCount: 2 };
    const r = await new JellyfinBackend().recentlyAdded({ kind: 'movie', days: 14 });
    expect(r.map(t => t.id)).toEqual(['n']);
    expect(urls[0]).toMatch(/sortBy=DateCreated,SortName&sortOrder=Descending/);
    expect(urls[0]).toContain('includeItemTypes=Movie');
  });
  it('boxsets: one call for the sets, one per set for its films, progress computed', async () => {
    answers['includeItemTypes=BoxSet'] = { Items: [{ Id: 'set1', Name: 'Saga', Type: 'BoxSet', ChildCount: 3, UserData: { UnplayedItemCount: 2 } }] };
    answers['parentId=set1'] = { Items: [
      { Id: 'f1', Type: 'Movie', Name: 'F1', ProductionYear: 2000, UserData: { Played: true } },
      { Id: 'f2', Type: 'Movie', Name: 'F2', ProductionYear: 2002 },
      { Id: 'f3', Type: 'Movie', Name: 'F3', ProductionYear: 2004 },
    ] };
    const r = await new JellyfinBackend().boxsets(4);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'Saga', total: 3, seen: 1, nextId: 'f2' });
    expect(urls).toHaveLength(2);
  });
  it('leavingSoon: Jellyfin does not know, so nothing (the tile stays out)', async () => {
    expect(await new JellyfinBackend().leavingSoon()).toEqual([]);
    expect(urls).toHaveLength(0);
  });
});

describe('DemoBackend home data is rich', () => {
  const b = new DemoBackend();
  it('has suggestions, new arrivals, upcoming and recent episodes, box sets, leaving soon, requests', async () => {
    expect((await b.suggestions(12)).length).toBe(12);
    expect((await b.recentlyAdded({ days: 7 })).length).toBeGreaterThanOrEqual(3);
    expect((await b.recentlyAdded({ kind: 'series', days: 60 })).length).toBeGreaterThanOrEqual(2);
    expect((await b.upcoming()).length).toBeGreaterThanOrEqual(5);
    expect((await b.recentEpisodes()).length).toBeGreaterThanOrEqual(5);
    const sets = await b.boxsets();
    expect(sets.length).toBeGreaterThanOrEqual(3);
    expect(sets.every(s => s.seen > 0 && s.seen < s.total)).toBe(true);
    expect((await b.leavingSoon()).length).toBeGreaterThan(0);
    const reqs = await b.seerr.requests();
    expect(new Set(reqs.map(r => r.state))).toEqual(new Set(['downloading', 'approved', 'requested', 'available', 'declined']));
    expect(reqs.find(r => r.state === 'downloading')?.progress).toBeGreaterThan(0);
  });
});
