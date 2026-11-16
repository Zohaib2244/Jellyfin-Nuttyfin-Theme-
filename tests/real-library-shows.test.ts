/** Recorded real Jellyfin 12 JSON (tests/fixtures/real-*.json): shows with a half-watched episode. */
import { describe, expect, it } from 'vitest';
import resumeJson from './fixtures/real-resume.json';
import listJson from './fixtures/real-series-list.json';
import nextJson from './fixtures/real-nextup.json';
import { normaliseItem, type BaseItemDto } from '../src/api/normalise';
import type { Episode, Title } from '../src/api/types';
import { laneOf, pickResuming } from '../src/pages/library/filters';

const series = (listJson as { Items: BaseItemDto[] }).Items.map(normaliseItem) as Title[];
const resume = (resumeJson as { Items: BaseItemDto[] }).Items.map(normaliseItem);
const nextUp = (nextJson as { Items: BaseItemDto[] }).Items.map(normaliseItem) as Episode[];
const LATER = Date.parse('2027-06-01'); // well past the "new episodes" window
const byName = (n: string): Title => series.find(t => t.name === n) as Title;

describe('shows with a half-watched episode (real data)', () => {
  it('Next Up (enableResumable=false) leaves out shows whose next episode is half watched', () => {
    const ids = new Set(nextUp.map(e => e.seriesId));
    expect(ids.has(byName('Silo').id)).toBe(false);
    expect(ids.has(byName('Lanterns').id)).toBe(false);
  });

  it('the Resume list supplies them: most recently watched episode wins per series', () => {
    const m = pickResuming(resume);
    const lanterns = m.get(byName('Lanterns').id);
    expect(lanterns?.episode).toBe(7); // S1E7 was watched after S1E8 started
    expect(m.get(byName('Silo').id)?.season).toBe(2);
    expect(m.size).toBe(2); // movies are ignored
  });

  it('a show with nothing finished but one episode under way is "watching", not "not started"', () => {
    const silo = byName('Silo');
    expect(laneOf(silo, LATER)).toBe('not'); // before the Resume list is applied
    const ep = pickResuming(resume).get(silo.id) as Episode;
    silo.progress = ep.progress;
    expect(laneOf(silo, LATER)).toBe('watching');
  });

  it('a show nobody touched stays "not started"', () => {
    expect(laneOf(byName('Johnny Bravo'), LATER)).toBe('not');
  });
});
