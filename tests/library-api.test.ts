import { describe, expect, it } from 'vitest';
import { DemoBackend } from '../src/api/demo';
import { chapterImageUrl } from '../src/api/images';
import { normaliseItem, type BaseItemDto } from '../src/api/normalise';
import type { Episode, Title } from '../src/api/types';

describe('normalise: detail extras', () => {
  const dto: BaseItemDto = {
    Id: 'm1', Type: 'Movie', Name: 'M',
    ProviderIds: { Imdb: 'tt1', Tmdb: '2', Tvdb: null },
    Tags: ['Rewatchable'],
    RemoteTrailers: [{ Url: 'https://youtu.be/aqz-KE-bpKQ', Name: 'T' }, { Name: 'no url' }],
    Chapters: [{ StartPositionTicks: 0, Name: 'Opening', ImageTag: 'c0' }, { StartPositionTicks: 600_000_000 }],
  };
  const t = normaliseItem(dto) as Title;
  it('keeps provider ids (dropping empty ones), tags, trailers and chapters', () => {
    expect(t.providerIds).toEqual({ Imdb: 'tt1', Tmdb: '2' });
    expect(t.tags).toEqual(['Rewatchable']);
    expect(t.remoteTrailers).toEqual([{ url: 'https://youtu.be/aqz-KE-bpKQ', name: 'T' }]);
    expect(t.chapters).toEqual([
      { index: 0, name: 'Opening', startTicks: 0, imageTag: 'c0' },
      { index: 1, name: 'Chapter 2', startTicks: 600_000_000, imageTag: undefined },
    ]);
  });
  it('leaves list rows light (no empty detail fields)', () => {
    const light = normaliseItem({ Id: 'x', Type: 'Movie' }) as Title;
    expect(light.chapters).toBeUndefined();
    expect(light.providerIds).toBeUndefined();
    expect(light.remoteTrailers).toBeUndefined();
  });
  it('marks seasons and box sets so the details page can route them', () => {
    const s = normaliseItem({ Id: 's', Type: 'Season', SeriesId: 'ser', IndexNumber: 2 }) as Title;
    expect(s).toMatchObject({ rawType: 'Season', seriesId: 'ser', seasonNumber: 2 });
    expect((normaliseItem({ Id: 'b', Type: 'BoxSet' }) as Title).rawType).toBe('BoxSet');
    expect((normaliseItem({ Id: 'm', Type: 'Movie' }) as Title).rawType).toBeUndefined();
  });
  it('episodes carry people and files on detail calls', () => {
    const e = normaliseItem({ Id: 'e', Type: 'Episode', People: [{ Id: 'p', Name: 'A', Type: 'GuestStar' }], MediaSources: [{ Id: 'ms', MediaStreams: [] }] }) as Episode;
    expect(e.people?.[0]?.type).toBe('GuestStar');
    expect(e.versions).toHaveLength(1);
  });
  it('chapter thumbnails are same-origin /jf URLs', () => {
    expect(chapterImageUrl('abc', 3, 'tg', 300)).toBe('/jf/Items/abc/Images/Chapter/3?maxWidth=300&quality=85&tag=tg');
  });
});

describe('demo backend: library queries', () => {
  const be = new DemoBackend();
  it('filters by rating, runtime window, genre OR, 4K and years', async () => {
    const fam = await be.items({ kind: 'movie', ratings: ['G', 'PG'], limit: 500 });
    expect(fam.items.length).toBeGreaterThan(0);
    expect(fam.items.every(t => t.certification === 'G' || t.certification === 'PG')).toBe(true);
    const short = await be.items({ kind: 'movie', maxRuntimeMin: 90, limit: 500 });
    expect(short.items.every(t => t.runtimeMin <= 90)).toBe(true);
    const mixed = await be.items({ kind: 'movie', genres: ['Horror', 'Comedy'], limit: 500 });
    expect(mixed.items.every(t => t.genres.includes('Horror') || t.genres.includes('Comedy'))).toBe(true);
    expect((await be.items({ kind: 'movie', is4k: true })).items.every(t => t.is4k)).toBe(true);
    expect((await be.items({ kind: 'movie', years: [2018, 2019], limit: 500 })).items.every(t => t.year === 2018 || t.year === 2019)).toBe(true);
  });
  it('pages: start/limit with a stable total', async () => {
    const a = await be.items({ kind: 'movie', sort: 'name', limit: 10 });
    const b = await be.items({ kind: 'movie', sort: 'name', start: 10, limit: 10 });
    expect(a.items).toHaveLength(10);
    expect(b.start).toBe(10);
    expect(b.total).toBe(a.total);
    expect(a.items.some(x => b.items.some(y => y.id === x.id))).toBe(false);
  });
  it('limit 0 gives only the count (used by letter jumps and tab counts)', async () => {
    const r = await be.items({ kind: 'movie', limit: 0 });
    expect(r.items).toHaveLength(0);
    expect(r.total).toBeGreaterThan(100);
  });
  it('name windows count how many titles come before a letter', async () => {
    const before = await be.items({ kind: 'movie', sort: 'name', nameLessThan: 'M', limit: 0 });
    const list = await be.items({ kind: 'movie', sort: 'name', limit: 500 });
    const idx = list.items.findIndex(t => t.name.replace(/^(the|a|an)\s+/i, '').toLowerCase() >= 'm');
    expect(before.total).toBe(idx);
  });
  it('genres come with counts', async () => {
    const g = await be.genres('movie');
    expect(g.find(x => x.name === 'Comedy')?.count).toBeGreaterThan(10);
  });
});

describe('demo backend: details', () => {
  const be = new DemoBackend();
  it('a movie has people, chapters, files, provider ids', async () => {
    const m = (await be.item('38f92fdc6d95b243a1a56002d646f094')) as Title;
    expect(m.people?.some(p => p.type === 'Actor')).toBe(true);
    expect(m.people?.some(p => p.type === 'Director')).toBe(true);
    expect(m.chapters?.length).toBeGreaterThan(3);
    expect(m.versions?.length).toBeGreaterThan(0);
    expect(m.providerIds?.Imdb).toMatch(/^tt\d+$/);
  });
  it('a 4K film has an HD alternative', async () => {
    const m = (await be.item('4028b4ed1e8164ca2f693e718f9dd295')) as Title;
    expect(m.versions?.map(v => v.is4k)).toEqual([true, false]);
  });
  it('Silo has two seasons with watched counts, and episode details carry guest stars', async () => {
    const seasons = await be.seasons('71966498ed674de9f326ddf559d40ce9');
    expect(seasons.map(s => s.number)).toEqual([1, 2]);
    expect(seasons[0]?.played).toBe(true);
    const eps = await be.episodeDetails('71966498ed674de9f326ddf559d40ce9', seasons[1]?.id ?? '');
    expect(eps[0]?.people?.some(p => p.type === 'GuestStar')).toBe(true);
  });
  it('an episode id resolves to an episode of its series', async () => {
    const e = (await be.item('0b2d969dc7039e6e9ff1dd62426700c7')) as Episode;
    expect(e.kind).toBe('episode');
    expect(e.seriesId).toBe('71966498ed674de9f326ddf559d40ce9');
  });
  it('delete is simulated: the title disappears from lists, nothing else happens', async () => {
    const id = '063ce36ba262562c0d4d5c8beacf7ab8';
    expect((await be.items({ ids: [id] })).total).toBe(1);
    await be.deleteFromJellyfin(id);
    expect((await be.items({ ids: [id] })).total).toBe(0);
    await expect(be.item(id)).rejects.toThrow();
  });
  it('reporting an issue works in demo', async () => {
    expect(await be.seerr.reportIssue({ mediaType: 'movie', tmdbId: 1, kind: 'video', message: 'x' })).toBe(true);
  });
});
