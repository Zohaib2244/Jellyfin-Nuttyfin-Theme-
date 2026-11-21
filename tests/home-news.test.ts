import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeskRequest, TitleFacts } from '../src/api/desk-types';
import type { Title } from '../src/api/types';
import { FIRST_VISIT_DAYS, comingRow, comingRows, freshSince, nextLastSeen, seenGate, showNewBanner } from '../src/pages/home/model';

const DAY = 864e5;
const NOW = new Date('2026-11-21T12:00:00').getTime();
const base = { overview: undefined, imageTags: {}, backdropCount: 0, played: false, favourite: false, runtimeMin: 0 };
const film = (id: string, addedDaysAgo: number): Title => ({ ...base, kind: 'movie', id, name: id, genres: [], is4k: false, studios: [], added: new Date(NOW - addedDaysAgo * DAY).toISOString() });
const lib = [film('a', 0.5), film('b', 3), film('c', 10), film('d', 40)];

describe('new-since-last-visit banner', () => {
  it('shows only what was added after the last visit', () => {
    const f = freshSince(lib, NOW - 4 * DAY, NOW);
    expect(f.first).toBe(false);
    expect(f.fresh.map(t => t.id)).toEqual(['a', 'b']);
    expect(showNewBanner(f)).toBe(true);
  });
  it('does not show at all when nothing is new since the last visit ("all caught up")', () => {
    const f = freshSince(lib, NOW - 60_000, NOW);
    expect(f.fresh).toEqual([]);
    expect(showNewBanner(f)).toBe(false);
  });
  it('first visit (nothing stored): the last 7 days count as new', () => {
    expect(FIRST_VISIT_DAYS).toBe(7);
    for (const stored of [null, undefined, 0]) {
      const f = freshSince(lib, stored, NOW);
      expect(f.first).toBe(true);
      expect(f.since).toBe(NOW - 7 * DAY);
      expect(f.fresh.map(t => t.id)).toEqual(['a', 'b']);
    }
    expect(showNewBanner(freshSince([film('old', 30)], null, NOW))).toBe(false);
  });
  it('stores the fetch time, never "now", and never moves backwards', () => {
    expect(nextLastSeen(100, 500)).toBe(500);
    expect(nextLastSeen(900, 500)).toBe(900);
    expect(nextLastSeen(null, 500)).toBe(500);
  });
});

describe('seenGate: the last visit moves up only after the banner was really seen', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('fires after the banner has been visible for a moment, once', () => {
    vi.useFakeTimers();
    const seen = vi.fn();
    const g = seenGate(seen, 1500);
    g.visible(true);
    vi.advanceTimersByTime(1499);
    expect(seen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(seen).toHaveBeenCalledTimes(1);
    g.visible(false); g.visible(true); vi.advanceTimersByTime(5000);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(g.done).toBe(true);
  });
  it('a refresh / tab switch / scroll away before that keeps the news (no update)', () => {
    vi.useFakeTimers();
    const seen = vi.fn();
    const g = seenGate(seen, 1500);
    g.visible(true); vi.advanceTimersByTime(1000); g.visible(false); vi.advanceTimersByTime(5000);
    expect(seen).not.toHaveBeenCalled();
    g.visible(true); vi.advanceTimersByTime(1000); g.dispose(); vi.advanceTimersByTime(5000); // page left (refresh)
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('On the way rows', () => {
  const now = new Date('2026-11-21T12:00:00');
  const req = (o: Partial<DeskRequest>): DeskRequest => ({
    id: 1, tmdbId: 10, mediaType: 'movie', title: 'T', state: 'approved', requestedBy: 'me', createdAt: '2026-11-01T10:00:00Z',
    requestStatus: 2, mediaStatus: 3, downloads: [], ...o,
  });
  const facts = (o: Partial<TitleFacts>): TitleFacts => ({ tmdbId: 10, mediaType: 'movie', title: 'T', ...o });

  it('uses the honest Requests-page stage lines', () => {
    expect(comingRow(req({ downloads: [{ percent: 64, eta: new Date(now.getTime() + 20 * 60_000).toISOString() }] }), null, now)?.line).toBe('Downloading · 64% · about 20 min left');
    expect(comingRow(req({}), facts({ releaseDate: '2027-03-04' }), now)?.line).toBe('Comes out 4 March 2027');
    expect(comingRow(req({}), facts({ releaseDate: '2026-11-01' }), now)?.line).toBe('In cinemas now, not available for download yet');
    expect(comingRow(req({}), facts({ releaseDate: '2024-01-01' }), now)?.line).toBe('Searching for a copy');
    expect(comingRow(req({ requestStatus: 1, mediaStatus: 2 }), null, now)?.pill.text).toBe('Requested');
  });
  it('never calls an approved request "starts soon" or "downloading" without a real download', () => {
    const r = comingRow(req({}), facts({ releaseDate: '2024-01-01' }), now);
    expect(r?.pill.cls).toBe('approved');
    expect(r?.line).not.toMatch(/starts soon|Downloading/);
  });
  it('leaves out what is in the library, removed or declined, and puts downloads first', () => {
    const list = [
      req({ id: 1, requestStatus: 1, mediaStatus: 2 }),
      req({ id: 2, mediaStatus: 5 }),
      req({ id: 3, requestStatus: 3 }),
      req({ id: 4, downloads: [{ percent: 10 }] }),
      req({ id: 5, tmdbId: 11 }),
    ];
    const rows = comingRows(list, r => (r.tmdbId === 11 ? facts({ releaseDate: '2027-01-01' }) : null), now);
    expect(rows.map(x => x.r.id)).toEqual([4, 5, 1]);
  });
});
