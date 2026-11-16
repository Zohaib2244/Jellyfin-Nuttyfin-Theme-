import { describe, expect, it } from 'vitest';
import { normaliseItem, normaliseSeason, type BaseItemDto } from '../src/api/normalise';
import type { Episode, Title } from '../src/api/types';
import episodeJson from './fixtures/episode.json';
import minimalJson from './fixtures/minimal.json';
import movieJson from './fixtures/movie.json';
import seriesJson from './fixtures/series.json';
import virtualJson from './fixtures/virtual-episode.json';

describe('normaliseItem: movie', () => {
  const m = normaliseItem(movieJson as BaseItemDto) as Title;

  it('maps the basics', () => {
    expect(m.kind).toBe('movie');
    expect(m).toMatchObject({ id: '38f92fdc6d95b243a1a56002d646f094', name: 'Pacific Rim: Uprising', year: 2018, certification: 'PG-13', tagline: 'The Next Generation Rises' });
    expect(m.genres).toEqual(['Action', 'Fantasy', 'Science Fiction']);
    expect(m.studios).toEqual(['Legendary Pictures', 'Universal Pictures']);
    expect(m.runtimeMin).toBe(111);
    expect(m.rating).toBeCloseTo(6.109);
  });

  it('keeps image tags and counts backdrops', () => {
    expect(m.imageTags).toEqual({ primary: 'primarytag1', logo: 'logotag1', backdrop: 'backdroptag1' });
    expect(m.backdropCount).toBe(2);
  });

  it('derives resume progress and favourite from UserData', () => {
    expect(m.favourite).toBe(true);
    expect(m.played).toBe(false);
    expect(m.progress).toEqual({ positionTicks: 20000000000, percent: 30, remainingMin: 78 });
  });

  it('flags 4K from the video size', () => {
    expect(m.is4k).toBe(true);
    expect(m.versions?.[0]?.is4k).toBe(true);
  });

  it('splits people and media streams', () => {
    expect(m.people).toEqual([
      { id: 'p1', name: 'John Boyega', role: 'Jake Pentecost', type: 'Actor', imageTag: 'tagp1' },
      { id: 'p2', name: 'Steven S. DeKnight', role: undefined, type: 'Director', imageTag: undefined },
    ]);
    const v = m.versions?.[0];
    expect(v).toMatchObject({ id: 'mediasource1', container: 'mkv', videoCodec: 'hevc', width: 3840, sizeBytes: 18500000000 });
    expect(v?.audio.map(a => [a.index, a.language, a.isDefault])).toEqual([[1, 'eng', true], [2, 'spa', false]]);
    expect(v?.subtitles.map(s => [s.index, s.isForced, s.isExternal])).toEqual([[3, false, false], [4, true, true]]);
  });
});

describe('normaliseItem: series', () => {
  const s = normaliseItem(seriesJson as BaseItemDto) as Title;
  it('maps series fields', () => {
    expect(s.kind).toBe('series');
    expect(s).toMatchObject({ name: 'Silo', year: 2023, endYear: 2026, status: 'Continuing', unplayedCount: 6, seasonCount: 2, runtimeMin: 0 });
    expect(s.progress).toBeUndefined();
    expect(s.imageTags).toEqual({ primary: 'sp', thumb: 'st', backdrop: 'sb' });
  });
});

describe('normaliseItem: episode', () => {
  const e = normaliseItem(episodeJson as BaseItemDto) as Episode;
  it('maps numbering, series info and artwork', () => {
    expect(e.kind).toBe('episode');
    expect(e).toMatchObject({ seriesId: '71966498ed674de9f326ddf559d40ce9', seriesName: 'Silo', seasonId: 'season2id', season: 2, episode: 5, missing: false, runtimeMin: 50 });
    expect(e.seriesImageTags).toEqual({ primary: 'seriesprimary', logo: 'serieslogo', backdrop: 'seriesbackdrop' });
    expect(e.imageTags).toEqual({ primary: 'epprimary' });
  });
  it('has progress for a half-watched episode', () => {
    expect(e.progress).toEqual({ positionTicks: 9000000000, percent: 30, remainingMin: 35 });
  });
  it('recognises missing (virtual) double episodes and played state', () => {
    const v = normaliseItem(virtualJson as BaseItemDto) as Episode;
    expect(v).toMatchObject({ missing: true, episode: 10, episodeEnd: 11, played: true });
    expect(v.progress).toBeUndefined();
  });
});

describe('normaliseItem: sparse data', () => {
  it('does not throw on a bare item and uses safe defaults', () => {
    const t = normaliseItem(minimalJson as BaseItemDto) as Title;
    expect(t).toMatchObject({ kind: 'movie', name: '', genres: [], studios: [], runtimeMin: 0, played: false, favourite: false, is4k: false, backdropCount: 0, imageTags: {} });
    expect(t.versions).toBeUndefined();
  });
});

describe('normaliseSeason', () => {
  it('maps a season', () => {
    expect(normaliseSeason({ Id: 's1', Name: 'Season 2', IndexNumber: 2, SeriesId: 'x', ChildCount: 10, ImageTags: { Primary: 'p' }, UserData: { UnplayedItemCount: 4 } })).toEqual({
      id: 's1', seriesId: 'x', name: 'Season 2', number: 2, episodeCount: 10, imageTags: { primary: 'p' }, played: false, unplayedCount: 4,
    });
  });
});
