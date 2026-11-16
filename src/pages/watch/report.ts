/**
 * Playback reporting to Jellyfin: /Sessions/Playing (start), /Progress (every 10 s, and on pause / play / seek), /Stopped (once, on exit
 * or when the tab closes). The cadence rules are a tiny pure state machine (`ReportClock`) so they can be tested without timers;
 * `Reporter` wires it to the backend.
 */
import type { Backend } from '../../api/backend';
import type { PlaybackReport } from '../../api/types';

export const REPORT_EVERY_MS = 10_000;
/** Pause / play / seek events closer together than this are folded into one report (a drag fires dozens of seeks). */
export const EVENT_GAP_MS = 750;

export type ReportEvent = 'start' | 'tick' | 'pause' | 'play' | 'seek' | 'stop';
export type ReportDecision = 'start' | 'progress' | 'stopped' | 'defer' | 'none';

export class ReportClock {
  private started = false;
  private stopped = false;
  private lastAt = -Infinity;

  /** What to do for this event at time `now` (ms). `defer` = too soon: try again after EVENT_GAP_MS (a trailing report). */
  decide(ev: ReportEvent, now: number): ReportDecision {
    if (this.stopped) return 'none';
    if (ev === 'start') {
      if (this.started) return 'none';
      this.started = true; this.lastAt = now;
      return 'start';
    }
    if (ev === 'stop') {
      if (!this.started) return 'none'; // nothing was ever reported: do not report a stop either
      this.stopped = true;
      return 'stopped';
    }
    if (!this.started) return 'none';
    if (ev === 'tick') {
      if (now - this.lastAt < REPORT_EVERY_MS) return 'none';
    } else if (now - this.lastAt < EVENT_GAP_MS) {
      return 'defer';
    }
    this.lastAt = now;
    return 'progress';
  }

  get isStopped(): boolean { return this.stopped; }
}

export interface ReporterDeps {
  backend: Backend;
  /** the live numbers, read at send time */
  snapshot(): PlaybackReport;
  now?(): number;
}

export class Reporter {
  private readonly clock = new ReportClock();
  private timer: number | undefined;
  private trailing: number | undefined;
  private readonly now: () => number;

  constructor(private readonly d: ReporterDeps) { this.now = d.now ?? (() => performance.now()); }

  start(): void {
    if (this.clock.decide('start', this.now()) === 'start') void this.d.backend.reportStart(this.d.snapshot()).catch(() => undefined);
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.event('tick'), 2000);
  }

  event(ev: Exclude<ReportEvent, 'start' | 'stop'>): void {
    const r = this.clock.decide(ev, this.now());
    if (r === 'progress') void this.d.backend.reportProgress(this.d.snapshot()).catch(() => undefined);
    else if (r === 'defer' && this.trailing === undefined) {
      this.trailing = window.setTimeout(() => { this.trailing = undefined; this.event(ev); }, EVENT_GAP_MS);
    }
  }

  /** Once. `unload` = the tab is closing: use keepalive. Resolves when the server has the report (or it failed). */
  async stop(opts: { unload?: boolean; positionTicks?: number } = {}): Promise<void> {
    window.clearInterval(this.timer);
    window.clearTimeout(this.trailing);
    this.trailing = undefined;
    if (this.clock.decide('stop', this.now()) !== 'stopped') return;
    const snap = this.d.snapshot();
    if (opts.positionTicks != null) snap.positionTicks = opts.positionTicks;
    await this.d.backend.reportStopped(snap, { unload: opts.unload }).catch(() => undefined);
  }

  get stopped(): boolean { return this.clock.isStopped; }
}
