import { describe, expect, it } from 'vitest';
import type { Title } from '../src/api/types';
import { groupsFor, laneOf, passes, VIEW_CHOICES, VIEWS, type LibState } from '../src/pages/library/filters';
import { libTabOf } from '../src/pages/library/tabs';
import { SLOTS } from '../src/pages/library/bot';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const show = (o: Partial<Title>): Title => ({
  id: 'x', name: 'S', kind: 'series', year: 2020, genres: [], imageTags: {}, played: false, favourite: false, runtimeMin: 40,
  episodeCount: 10, unplayedCount: 5, status: 'Continuing', lastEpisodeAdded: '2026-11-18T00:00:00Z', progress: undefined, ...o,
} as unknown as Title);

describe('shows: one definition of "new episodes"', () => {
  const groups = groupsFor('shows');
  const state: LibState = { sel: { where: new Set(['new']) }, order: 'added', view: 'progress' };
  const list = [
    show({ id: 'a' }), // started, still airing, an episode landed 3 days ago: new
    show({ id: 'b', lastEpisodeAdded: '2026-09-01T00:00:00Z' }), // started but nothing recent: just "watching"
    show({ id: 'c', unplayedCount: 10 }), // not started: never "new"
    show({ id: 'd', status: 'Ended' }), // finished run: not "new"
    show({ id: 'e', unplayedCount: 0 }), // all watched: done
  ];
  it('the mix count is the lane count, not "every show that matches the other switches"', () => {
    const viaMix = list.filter(t => passes(t, state, groups, { lane: x => laneOf(x, NOW) })).length;
    const viaLanes = list.filter(t => laneOf(t, NOW) === 'new').length;
    expect(viaMix).toBe(viaLanes);
    expect(viaMix).toBe(1);
  });
  it('a plain filter without the lane matches everything (what the server alone would answer)', () => {
    const noLane: LibState = { sel: {}, order: 'added', view: 'progress' };
    expect(list.filter(t => passes(t, noLane, groups)).length).toBe(list.length);
  });
});

describe('library navigation', () => {
  it('Shelves is the Collections tab, so the look switch does not offer it', () => {
    expect(VIEWS.movies.some(v => v[0] === 'shelves')).toBe(true); // still a valid URL state for the tab
    expect(VIEW_CHOICES.movies.some(v => v[0] === 'shelves')).toBe(false);
    expect(VIEW_CHOICES.shows).toEqual(VIEWS.shows);
    expect(libTabOf('movies', { sel: {}, order: 'added', view: 'shelves' }, groupsFor('movies'))).toBe('sets');
  });
});

describe('NutBot lines read right at one', () => {
  const lines = SLOTS.flatMap(s => [...s.lines.movies, ...s.lines.shows]);
  const text = (n: number): string[] => lines.map(l => l({ name: 'Sam', n }).value.replace(/<[^>]+>/g, ''));
  it('never says "1 films" or "1 shows are"', () => {
    for (const t of text(1)) { expect(t).not.toMatch(/\b1 (films|shows|thrillers|adventures|family films|grown-up shows)\b/); expect(t).not.toMatch(/\b1 (show|film)s? (are|have)\b/); }
  });
  it('says "shows" and "are" in the plural', () => {
    expect(text(5).some(t => /5 shows are/.test(t))).toBe(true);
  });
});
