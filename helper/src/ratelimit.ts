/** Sliding-window limiter per key (the Jellyfin user id): at most `limit` hits in the last 60 seconds. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs = 60_000) { this.limit = limit; this.windowMs = windowMs; }

  /** Returns 0 when allowed (and counts it), else the milliseconds to wait. */
  take(key: string, now: number): number {
    const recent = (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.max(1, (recent[0] as number) + this.windowMs - now);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 1000) for (const [k, v] of this.hits) if (v.every(t => now - t >= this.windowMs)) this.hits.delete(k);
    return 0;
  }
}
