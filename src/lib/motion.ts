/**
 * Motion helpers (pure, no DOM at import time, unit-tested). The DOM wiring lives in motion-dom.ts, the look in
 * src/styles/motion.css. Rules (docs/DESIGN-RULES.md, "Motion"): quick, transform/opacity only, one-shot, off under
 * prefers-reduced-motion.
 */

/** Items that animate in a batch: the first N visible ones. Later items simply appear. */
export const STAGGER_MAX = 12;
/** Delay between neighbours. CSS: delay = i * step; with the 220ms item animation the last item ends by ~440ms. */
export const STAGGER_STEP_MS = 20;
export const ENTER_BUDGET_MS = 450;

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Delay for the i-th item of a batch. */
export const staggerDelay = (i: number, step = STAGGER_STEP_MS): number => Math.max(0, i) * step;

export interface EnterPlan<T> { item: T; index: number }

/**
 * Decide which of a batch of freshly added items animate and in what order.
 *  - only items that are currently on screen (`isVisible`): nothing animates off screen
 *  - items whose key was already shown in this container are skipped (filters/re-renders never replay)
 *  - at most `max` items, indexed 0..max-1 in the order given
 * `seen` is updated with every key looked at, animated or not, so the same item is never animated twice.
 */
export function planEnter<T>(
  items: readonly T[],
  opts: { isVisible: (item: T) => boolean; keyOf?: (item: T) => string | null; seen?: Set<string>; max?: number },
): Array<EnterPlan<T>> {
  const max = opts.max ?? STAGGER_MAX;
  const out: Array<EnterPlan<T>> = [];
  for (const item of items) {
    const key = opts.keyOf?.(item) ?? null;
    const known = key !== null && !!opts.seen?.has(key);
    if (key !== null) opts.seen?.add(key);
    if (known || out.length >= max) continue;
    if (!opts.isVisible(item)) continue;
    out.push({ item, index: out.length });
  }
  // keep the key memory small on very long infinite lists
  if (opts.seen && opts.seen.size > 600) opts.seen.clear();
  return out;
}

/* ── leaving: let an element play its exit animation, then remove it ── */
export interface Leavable {
  setAttribute(name: string, value: string): void;
  addEventListener(type: 'animationend' | 'transitionend', cb: () => void, opts?: { once?: boolean }): void;
  remove(): void;
}

/**
 * Mark `el` as leaving (CSS `[data-leaving]` plays the exit) and remove it when that animation ends, or after
 * `maxMs` as a safety net. With reduced motion (or ms = 0) it is removed at once. Idempotent.
 */
export function leave(el: Leavable, opts: { maxMs?: number; reduced?: boolean; schedule?: (fn: () => void, ms: number) => unknown } = {}): void {
  const reduced = opts.reduced ?? prefersReducedMotion();
  const maxMs = opts.maxMs ?? 200;
  if (reduced || maxMs <= 0) { el.remove(); return; }
  let gone = false;
  const finish = (): void => { if (!gone) { gone = true; el.remove(); } };
  el.setAttribute('data-leaving', '');
  el.addEventListener('animationend', finish, { once: true });
  (opts.schedule ?? ((fn, ms) => setTimeout(fn, ms)))(finish, maxMs + 60);
}

/* ── route progress: a thin bar that only shows when a page takes longer than `delay` ── */
export type RouteState = 'idle' | 'run' | 'done';

export class RouteProgress {
  private timer: unknown = null;
  private reset: unknown = null;
  private state: RouteState = 'idle';
  constructor(
    private readonly paint: (s: RouteState) => void,
    private readonly delay = 150,
    private readonly timers: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void } = {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: h => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
  ) {}

  get current(): RouteState { return this.state; }

  /** A navigation began and its page is pending. */
  start(): void {
    this.clearTimers();
    if (this.state !== 'idle') this.set('idle');
    this.timer = this.timers.set(() => { this.timer = null; this.set('run'); }, this.delay);
  }

  /** The page arrived (or the navigation was replaced). Quick pages never showed the bar at all. */
  done(): void {
    this.clearTimers();
    if (this.state === 'run') {
      this.set('done');
      this.reset = this.timers.set(() => { this.reset = null; this.set('idle'); }, 380);
    }
  }

  private set(s: RouteState): void { this.state = s; this.paint(s); }
  private clearTimers(): void {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
    if (this.reset !== null) { this.timers.clear(this.reset); this.reset = null; }
  }
}

/* ── router-facing singleton: no-ops until initMotion() wires the DOM ── */
interface RouteHooks { start(): void; done(): void; swapped(): void }
let hooks: RouteHooks | null = null;
export function setRouteHooks(h: RouteHooks | null): void { hooks = h; }
export const routeStart = (): void => hooks?.start();
export const routeDone = (): void => hooks?.done();
/** The router is about to put a new page in: stagger inside it should be fade-only while the page itself rises. */
export const noteSwap = (): void => hooks?.swapped();
