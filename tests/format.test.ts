import { describe, expect, it } from 'vitest';
import { clock, endsAt, minutesToTicks, parseDate, relativeTime, runtime, ticksToMinutes } from '../src/lib/format';

describe('runtime', () => {
  it.each([[0, '0 min'], [45, '45 min'], [60, '1 h'], [100, '1 h 40 min'], [125, '2 h 05 min'], [119.6, '2 h']])('%s -> %s', (m, s) => expect(runtime(m)).toBe(s));
});

describe('clock / endsAt', () => {
  it('formats 12-hour lower-case', () => {
    expect(clock(new Date(2026, 10, 16, 21, 18))).toBe('9:18 pm');
    expect(clock(new Date(2026, 10, 16, 0, 5))).toBe('12:05 am');
    expect(clock(new Date(2026, 10, 16, 12, 0))).toBe('12:00 pm');
  });
  it('adds the remaining time to now', () => {
    expect(endsAt(100, new Date(2026, 10, 16, 19, 38))).toBe('ends at 9:18 pm');
    expect(endsAt(30, new Date(2026, 10, 16, 23, 50))).toBe('ends at 12:20 am');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const D = 864e5;
  it.each([
    [10_000, 'Just now'], [5 * 60_000, '5 min ago'], [3 * 3600_000, '3 h ago'], [1.2 * D, 'Yesterday'],
    [4 * D, '4 days ago'], [8 * D, 'Last week'], [21 * D, '3 weeks ago'], [35 * D, '1 month ago'], [95 * D, '3 months ago'],
    [400 * D, '1 year ago'], [800 * D, '2 years ago'],
  ])('%s ms -> %s', (ms, text) => expect(relativeTime(ago(ms), now)).toBe(text));
  it('accepts strings, treats the future as now, and ignores garbage', () => {
    expect(relativeTime('2026-11-09T12:00:00Z', now)).toBe('Last week');
    expect(relativeTime(new Date(now.getTime() + 5000), now)).toBe('Just now');
    expect(relativeTime('nope', now)).toBe('');
  });
});

describe('ticks and dates', () => {
  it('converts both ways', () => {
    expect(ticksToMinutes(66600000000)).toBeCloseTo(111);
    expect(ticksToMinutes(undefined)).toBe(0);
    expect(minutesToTicks(1)).toBe(600000000);
  });
  it('parses Jellyfin 7-digit fractional seconds', () => {
    expect(parseDate('2026-11-15T09:44:19.4178445Z')?.toISOString()).toBe('2026-11-15T09:44:19.417Z');
    expect(parseDate('garbage')).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });
});
