import { describe, expect, it, vi } from 'vitest';
import { ENTER_BUDGET_MS, leave, planEnter, RouteProgress, STAGGER_MAX, STAGGER_STEP_MS, staggerDelay, type Leavable, type RouteState } from '../src/lib/motion';

const items = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `id${from + i}`, y: (from + i) * 100 }));

describe('stagger budget', () => {
  it('keeps the whole entrance within 450ms for a 200ms item animation', () => {
    expect(STAGGER_STEP_MS).toBeLessThanOrEqual(30);
    expect(staggerDelay(STAGGER_MAX - 1) + 200).toBeLessThanOrEqual(ENTER_BUDGET_MS);
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(-3)).toBe(0);
  });
});

describe('planEnter', () => {
  it('animates only the first 12 items, in order', () => {
    const plan = planEnter(items(30), { isVisible: () => true, keyOf: x => x.id });
    expect(plan).toHaveLength(STAGGER_MAX);
    expect(plan.map(p => p.index)).toEqual([...Array(STAGGER_MAX).keys()]);
    expect(plan[0]?.item.id).toBe('id0');
  });

  it('skips items that are off screen and does not count them toward the cap', () => {
    const plan = planEnter(items(30), { isVisible: x => x.y < 500, keyOf: x => x.id });
    expect(plan.map(p => p.item.id)).toEqual(['id0', 'id1', 'id2', 'id3', 'id4']);
  });

  it('never re-animates an item whose key was already shown (filters, re-renders, infinite scroll)', () => {
    const seen = new Set<string>();
    const first = planEnter(items(8), { isVisible: () => true, keyOf: x => x.id, seen });
    expect(first).toHaveLength(8);
    // same 8 items re-rendered plus 4 new ones appended
    const second = planEnter(items(12), { isVisible: () => true, keyOf: x => x.id, seen });
    expect(second.map(p => p.item.id)).toEqual(['id8', 'id9', 'id10', 'id11']);
    expect(second.map(p => p.index)).toEqual([0, 1, 2, 3]);
  });

  it('remembers offscreen and capped keys too, so scrolling a later render does not replay them', () => {
    const seen = new Set<string>();
    planEnter(items(30), { isVisible: x => x.y < 300, keyOf: x => x.id, seen });
    expect(seen.size).toBe(30);
    expect(planEnter(items(30), { isVisible: () => true, keyOf: x => x.id, seen })).toHaveLength(0);
  });

  it('animates items without a key every time (nothing to compare)', () => {
    const seen = new Set<string>();
    expect(planEnter(items(3), { isVisible: () => true, seen })).toHaveLength(3);
    expect(planEnter(items(3), { isVisible: () => true, seen })).toHaveLength(3);
  });

  it('caps the key memory on very long lists', () => {
    const seen = new Set<string>();
    planEnter(items(700), { isVisible: () => false, keyOf: x => x.id, seen });
    expect(seen.size).toBe(0);
  });
});

function fakeEl() {
  const attrs: Record<string, string> = {};
  let ended: (() => void) | null = null;
  const el: Leavable & { removed: number; attrs: Record<string, string>; end(): void } = {
    removed: 0,
    attrs,
    setAttribute: (n, v) => { attrs[n] = v; },
    addEventListener: (_t, cb) => { ended = cb; },
    remove() { this.removed++; },
    end() { ended?.(); },
  };
  return el;
}

describe('leave', () => {
  it('removes at once with reduced motion', () => {
    const el = fakeEl();
    leave(el, { reduced: true });
    expect(el.removed).toBe(1);
    expect(el.attrs['data-leaving']).toBeUndefined();
  });

  it('flags the element, then removes it when its animation ends (once)', () => {
    const el = fakeEl();
    const timers: Array<() => void> = [];
    leave(el, { reduced: false, schedule: fn => { timers.push(fn); } });
    expect(el.attrs['data-leaving']).toBe('');
    expect(el.removed).toBe(0);
    el.end();
    timers[0]?.(); // the safety net firing later must not remove twice
    expect(el.removed).toBe(1);
  });

  it('falls back to the timer when no animation event arrives', () => {
    const el = fakeEl();
    let delay = 0;
    let run: () => void = () => {};
    leave(el, { reduced: false, maxMs: 150, schedule: (fn, ms) => { run = fn; delay = ms; } });
    expect(delay).toBeGreaterThanOrEqual(150);
    run();
    expect(el.removed).toBe(1);
  });
});

describe('RouteProgress', () => {
  const make = () => {
    const calls: RouteState[] = [];
    vi.useFakeTimers();
    return { calls, rp: new RouteProgress(s => calls.push(s), 150) };
  };

  it('never shows for a page that arrives within 150ms', () => {
    const { calls, rp } = make();
    rp.start();
    vi.advanceTimersByTime(140);
    rp.done();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([]);
    vi.useRealTimers();
  });

  it('shows after 150ms, finishes on done and goes idle again', () => {
    const { calls, rp } = make();
    rp.start();
    vi.advanceTimersByTime(151);
    expect(rp.current).toBe('run');
    rp.done();
    expect(rp.current).toBe('done');
    vi.advanceTimersByTime(400);
    expect(calls).toEqual(['run', 'done', 'idle']);
    vi.useRealTimers();
  });

  it('a newer navigation restarts the wait instead of stacking bars', () => {
    const { calls, rp } = make();
    rp.start();
    vi.advanceTimersByTime(200);
    rp.start(); // user clicked elsewhere while the first page was still pending
    expect(rp.current).toBe('idle');
    vi.advanceTimersByTime(100);
    expect(rp.current).toBe('idle');
    vi.advanceTimersByTime(60);
    expect(rp.current).toBe('run');
    rp.done();
    vi.advanceTimersByTime(500);
    expect(calls).toEqual(['run', 'idle', 'run', 'done', 'idle']);
    vi.useRealTimers();
  });
});
