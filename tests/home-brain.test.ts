import { beforeAll, describe, expect, it } from 'vitest';
import { DemoBackend } from '../src/api/demo';
import type { Title } from '../src/api/types';
import { LocalBrain, describe as describeQuery, findTitle, parseQuery } from '../src/pages/home/nutbot/local';
import { MOODS, moodPicks } from '../src/pages/home/nutbot/moods';

const t = (id: string, o: Partial<Title> = {}): Title => ({
  kind: 'movie', id, name: id, imageTags: {}, backdropCount: 0, played: false, favourite: false, runtimeMin: 100, genres: [], is4k: false, studios: [], ...o,
});

describe('parseQuery', () => {
  it('understands "something funny under 2 hours"', () => {
    const q = parseQuery('something funny under 2 hours');
    expect(q.moods.map(m => m.key)).toEqual(['funny']);
    expect(q.maxMin).toBe(120);
  });
  it('understands words, minutes and "like X"', () => {
    expect(parseQuery('scary but less than 90 minutes').maxMin).toBe(90);
    expect(parseQuery('under two hours').maxMin).toBe(120);
    expect(parseQuery('Something like Silo').like).toBe('silo');
    expect(parseQuery('I would like something funny').like).toBeUndefined();
    expect(parseQuery('I would like something funny').moods[0]?.key).toBe('funny');
  });
  it('kids, shows and length', () => {
    const q = parseQuery('a show for the kids');
    expect(q.kind).toBe('series');
    expect(q.moods.map(m => m.key)).toContain('kids');
    expect(parseQuery('something epic').minMin).toBe(130);
    expect(describeQuery(parseQuery('funny under 2 hours'))).toBe('funny, under 2 h');
  });
});

describe('moods', () => {
  const lib = [
    t('comedy', { genres: ['Comedy'], rating: 7 }), t('horror', { genres: ['Horror'] }), t('kid', { genres: ['Family', 'Animation'], certification: 'G', rating: 7.5 }),
    t('long', { genres: ['Comedy'], runtimeMin: 170 }), t('seen', { genres: ['Comedy'], played: true, rating: 9 }),
  ];
  it('filters by genre and lists unseen first', () => {
    const funny = MOODS.find(m => m.key === 'funny')!;
    expect(moodPicks(lib, funny).map(x => x.id)).toEqual(['comedy', 'long', 'seen']);
    expect(moodPicks(lib, MOODS.find(m => m.key === 'scary')!).map(x => x.id)).toEqual(['horror']);
    expect(moodPicks(lib, MOODS.find(m => m.key === 'kids')!).map(x => x.id)).toEqual(['kid']);
    expect(moodPicks(lib, MOODS.find(m => m.key === 'short')!).map(x => x.id)).not.toContain('long');
  });
  it('every mood has chip text, an ask and reasons', () => {
    for (const m of MOODS) { expect(m.chip && m.ask && m.why.length).toBeTruthy(); }
  });
  it('findTitle matches exact before partial', () => {
    expect(findTitle([t('a', { name: 'Silo Wars' }), t('b', { name: 'Silo' })], 'silo')?.id).toBe('b');
  });
});

describe('LocalBrain over the demo library', () => {
  const demo = new DemoBackend();
  const brain = new LocalBrain(demo);
  beforeAll(async () => { await demo.signIn('Sam'); }); // Seerr in demo needs a signed-in user
  it('answers a mood + runtime with library picks that obey the limits', async () => {
    const a = await brain.ask('something funny under 2 hours');
    expect(a.reply).toMatch(/funny/);
    expect(a.picks.length).toBeGreaterThanOrEqual(2);
    for (const p of a.picks) {
      expect(p.kind).toBe('library');
      if (p.kind === 'library') { expect(p.title.genres).toContain('Comedy'); expect(p.title.runtimeMin).toBeLessThanOrEqual(120); }
    }
  });
  it('"something else" gives different picks', async () => {
    const b = new LocalBrain(demo);
    const first = await b.ask('scary');
    const again = await b.ask('something else');
    const ids = (r: typeof first) => r.picks.map(p => (p.kind === 'library' ? p.title.id : ''));
    expect(ids(again).some(id => !ids(first).includes(id))).toBe(true);
  });
  it('"like Silo" returns similar library items, not Silo itself', async () => {
    const a = await brain.ask('something like Silo');
    expect(a.picks.length).toBeGreaterThan(0);
    expect(a.picks.every(p => p.kind === 'library' && p.title.name !== 'Silo')).toBe(true);
    expect(a.reply).toMatch(/Silo/);
  });
  it('offers Request for something that is not in the library', async () => {
    const a = await brain.ask('Barbie');
    expect(a.picks.some(p => p.kind === 'request' && p.result.title === 'Barbie')).toBe(true);
  });
  it('a greeting or nonsense still gets a friendly answer, never a crash', async () => {
    expect((await brain.ask('hi')).reply).toMatch(/mood/);
    expect((await brain.ask('zzzqx')).reply.length).toBeGreaterThan(10);
  });
});
