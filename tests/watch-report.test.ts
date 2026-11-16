/** Progress reporting cadence: start once, a report every 10 s, pause / seek reports (folded together), stop exactly once. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../src/api/backend';
import type { PlaybackReport } from '../src/api/types';
import { EVENT_GAP_MS, REPORT_EVERY_MS, ReportClock, Reporter } from '../src/pages/watch/report';

describe('ReportClock', () => {
  it('start happens once, ticks report every 10 s', () => {
    const c = new ReportClock();
    expect(c.decide('tick', 0)).toBe('none'); // nothing started yet
    expect(c.decide('start', 0)).toBe('start');
    expect(c.decide('start', 5)).toBe('none');
    expect(c.decide('tick', 2000)).toBe('none');
    expect(c.decide('tick', REPORT_EVERY_MS - 1)).toBe('none');
    expect(c.decide('tick', REPORT_EVERY_MS)).toBe('progress');
    expect(c.decide('tick', REPORT_EVERY_MS + 2000)).toBe('none');
    expect(c.decide('tick', 2 * REPORT_EVERY_MS)).toBe('progress');
  });

  it('pause, play and seek report at once, but a burst is deferred', () => {
    const c = new ReportClock();
    c.decide('start', 0);
    expect(c.decide('pause', 3000)).toBe('progress');
    expect(c.decide('seek', 3100)).toBe('defer');
    expect(c.decide('seek', 3300)).toBe('defer');
    expect(c.decide('play', 3000 + EVENT_GAP_MS)).toBe('progress');
  });

  it('an event right after the first report waits (start counts as a report)', () => {
    const c = new ReportClock();
    c.decide('start', 1000);
    expect(c.decide('pause', 1200)).toBe('defer');
  });

  it('the 10 s timer restarts after an event report', () => {
    const c = new ReportClock();
    c.decide('start', 0);
    expect(c.decide('seek', 4000)).toBe('progress');
    expect(c.decide('tick', 10_000)).toBe('none'); // only 6 s since the seek report
    expect(c.decide('tick', 14_000)).toBe('progress');
  });

  it('stop is reported once, and only if a start was', () => {
    const never = new ReportClock();
    expect(never.decide('stop', 1)).toBe('none');
    const c = new ReportClock();
    c.decide('start', 0);
    expect(c.decide('stop', 50)).toBe('stopped');
    expect(c.decide('stop', 60)).toBe('none');
    expect(c.decide('tick', 99_999)).toBe('none');
    expect(c.isStopped).toBe(true);
  });
});

describe('Reporter', () => {
  const calls: string[] = [];
  let now = 0;
  const snap = (): PlaybackReport => ({ itemId: 'i', mediaSourceId: 'm', playSessionId: 'p', positionTicks: now * 1e4, playMethod: 'DirectPlay' });
  const backend = {
    reportStart: vi.fn(async () => { calls.push('start'); }),
    reportProgress: vi.fn(async () => { calls.push('progress'); }),
    reportStopped: vi.fn(async (r: PlaybackReport, o?: { unload?: boolean }) => { calls.push(`stopped@${r.positionTicks}${o?.unload ? ':unload' : ''}`); }),
  } as unknown as Backend;

  beforeEach(() => { calls.length = 0; now = 0; vi.useFakeTimers(); vi.stubGlobal('window', globalThis); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('reports start, then progress every 10 s of playing, then stopped with the position it is given', async () => {
    const r = new Reporter({ backend, snapshot: snap, now: () => now });
    r.start();
    expect(calls).toEqual(['start']);
    for (let i = 0; i < 25; i++) { now += 1000; vi.advanceTimersByTime(1000); }
    expect(calls).toEqual(['start', 'progress', 'progress']); // at 10 s and 20 s
    await r.stop({ positionTicks: 0 }); // the test item is left with no resume point
    expect(calls.at(-1)).toBe('stopped@0');
    await r.stop();
    expect(calls.filter(c => c.startsWith('stopped')).length).toBe(1);
    now += 60_000; vi.advanceTimersByTime(60_000);
    expect(calls.filter(c => c === 'progress').length).toBe(2); // the timer is gone
  });

  it('a pause is reported immediately, a quick seek afterwards is sent once after the gap', () => {
    const r = new Reporter({ backend, snapshot: snap, now: () => now });
    r.start();
    now += 3000; r.event('pause');
    expect(calls).toEqual(['start', 'progress']);
    now += 100; r.event('seek'); now += 100; r.event('seek');
    expect(calls).toEqual(['start', 'progress']);
    now += EVENT_GAP_MS; vi.advanceTimersByTime(EVENT_GAP_MS);
    expect(calls).toEqual(['start', 'progress', 'progress']);
  });

  it('the closing tab sends stopped with keepalive', async () => {
    const r = new Reporter({ backend, snapshot: snap, now: () => now });
    r.start();
    await r.stop({ unload: true });
    expect(calls.at(-1)).toBe('stopped@0:unload');
  });
});
