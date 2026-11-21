import { describe, expect, it } from 'vitest';
import type { TitleFacts } from '../src/api/desk-types';
import { etaText, longDate, releaseWait, requestStage, titleStatus, type StageInput } from '../src/pages/requests/stage';

const NOW = new Date('2026-11-21T12:00:00Z');
const r = (o: Partial<StageInput> = {}): StageInput => ({
  requestStatus: 2, mediaStatus: 3, mediaType: 'movie', downloads: [], createdAt: '2026-10-31T12:00:00Z', updatedAt: '2026-10-31T12:00:00Z', ...o,
});
const film = (o: Partial<TitleFacts> = {}): TitleFacts => ({ tmdbId: 1, mediaType: 'movie', title: 'F', ...o });
const show = (o: Partial<TitleFacts> = {}): TitleFacts => ({ tmdbId: 2, mediaType: 'tv', title: 'S', ...o });

describe('request stage', () => {
  it('pending: step 1, waiting for a yes', () => {
    const s = requestStage(r({ requestStatus: 1, mediaStatus: 2, createdAt: '2026-11-18T12:00:00Z' }), null, NOW);
    expect(s).toMatchObject({ id: 'requested', step: 0, group: 'pending' });
    expect(s.line).toBe('Requested 3 days ago · waiting for a yes');
  });

  it('declined', () => {
    expect(requestStage(r({ requestStatus: 3, mediaStatus: 1 }), null, NOW)).toMatchObject({ id: 'declined', group: 'declined', line: 'Declined 3 weeks ago' });
  });

  it('approved + processing but NOT released: waiting with "comes out <date>", never downloading', () => {
    const s = requestStage(r(), film({ releaseDate: '2027-03-04' }), NOW);
    expect(s).toMatchObject({ id: 'waiting', step: 2, group: 'onway', waitsFor: '2027-03-04' });
    expect(s.line).toBe('Approved 3 weeks ago · comes out 4 March 2027');
  });

  it('in cinemas with a later home release says when it can be watched at home', () => {
    const s = requestStage(r(), film({ releaseDate: '2026-11-03', homeRelease: '2027-01-20' }), NOW);
    expect(s.line).toBe('Approved 3 weeks ago · in cinemas now, out to watch at home 20 January 2027');
  });

  it('in cinemas recently with no home date announced (the real Godzilla case)', () => {
    expect(requestStage(r(), film({ releaseDate: '2026-11-03' }), NOW).line).toBe('Approved 3 weeks ago · in cinemas now, not out to watch at home yet');
  });

  it('released and out at home but not grabbed: searching for a copy', () => {
    const s = requestStage(r(), film({ releaseDate: '2020-01-01', homeRelease: '2020-04-01' }), NOW);
    expect(s).toMatchObject({ id: 'waiting', step: 2 });
    expect(s.line).toBe('Approved 3 weeks ago · searching for a copy');
  });

  it('before the facts arrive it does not guess', () => {
    expect(requestStage(r(), null, NOW).line).toBe('Approved 3 weeks ago · waiting to download');
  });

  it('downloading ONLY with real queue entries, with percent and ETA', () => {
    const s = requestStage(r({ downloads: [{ percent: 30, eta: '2026-11-21T14:00:00Z' }, { percent: 50 }] }), film({ releaseDate: '2027-01-01' }), NOW);
    expect(s).toMatchObject({ id: 'downloading', step: 3, percent: 40 });
    expect(s.line).toBe('Downloading · 40% · about 2 h left');
  });

  it('available and the library line', () => {
    expect(requestStage(r({ requestStatus: 5, mediaStatus: 5 }), null, NOW)).toMatchObject({ id: 'available', step: 4, group: 'added' });
    expect(requestStage(r({ requestStatus: 5, mediaStatus: 7 }), null, NOW)).toMatchObject({ id: 'removed', group: 'added' });
  });

  it('partly available shows say which seasons', () => {
    const tv = r({ mediaType: 'tv', mediaStatus: 4, seasons: [1, 2] });
    expect(requestStage(tv, show({ seasonsReady: [1] }), NOW)).toMatchObject({ id: 'partial', group: 'onway', line: 'Season 1 is ready to watch · the rest is on the way' });
    expect(requestStage({ ...tv, seasons: [1] }, show({ seasonsPartly: [1] }), NOW).line).toBe('Some episodes of Season 1 are ready to watch · the rest is on the way');
    expect(requestStage({ ...tv, seasons: [1] }, show({ seasonsReady: [1] }), NOW)).toMatchObject({ id: 'available', group: 'added', line: 'Season 1 is in the library · ready to watch' });
  });

  it('shows: unaired requested season waits for its air date; aired ones are searched for', () => {
    const facts = show({ releaseDate: '2022-08-21', seasonAirDates: { 1: '2022-08-21', 3: '2027-06-01' }, nextAirDate: '2027-06-01' });
    expect(requestStage(r({ mediaType: 'tv', seasons: [3] }), facts, NOW).line).toBe('Approved 3 weeks ago · comes out 1 June 2027');
    expect(requestStage(r({ mediaType: 'tv', seasons: [1] }), facts, NOW).line).toBe('Approved 3 weeks ago · searching for a copy');
  });

  it('failed hand-over to the downloader', () => {
    expect(requestStage(r({ requestStatus: 4 }), null, NOW)).toMatchObject({ id: 'failed', group: 'onway' });
  });
});

describe('helpers', () => {
  it('dates and ETA words', () => {
    expect(longDate('2026-12-24', NOW)).toBe('24 December');
    expect(longDate('2027-03-04', NOW)).toBe('4 March 2027');
    expect(etaText('2026-11-21T12:20:00Z', NOW)).toBe('about 20 min left');
    expect(etaText('2026-11-20T12:20:00Z', NOW)).toBe('');
    expect(etaText(undefined, NOW)).toBe('');
  });
  it('releaseWait is null when nothing is known', () => {
    expect(releaseWait('movie', null, undefined, NOW)).toBeNull();
  });
  it('details status line', () => {
    expect(titleStatus({ mediaType: 'movie', mediaStatus: 5 }, NOW)?.text).toBe('In the library · ready to watch');
    expect(titleStatus({ mediaType: 'movie', mediaStatus: 3, facts: film({ releaseDate: '2027-03-04' }) }, NOW)?.text).toBe('Approved · comes out 4 March 2027');
    expect(titleStatus({ mediaType: 'movie', mediaStatus: 2 }, NOW)?.text).toBe('Requested · waiting for a yes');
    expect(titleStatus({ mediaType: 'movie', mediaStatus: 1 }, NOW)).toBeNull();
    expect(titleStatus({ mediaType: 'tv', mediaStatus: 4, facts: show({ seasonsReady: [1, 2] }) }, NOW)?.text).toBe('Seasons 1 and 2 are in the library');
  });
});
