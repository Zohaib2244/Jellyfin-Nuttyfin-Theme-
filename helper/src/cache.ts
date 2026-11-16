/** Tiny in-memory cache with a time-to-live. Keys should include the user id when the data depends on who is asking. */
export class TtlCache {
  private readonly m = new Map<string, { at: number; v: Promise<unknown> }>();
  private readonly now: () => number;
  private readonly max: number;
  constructor(now: () => number, max = 300) { this.now = now; this.max = max; }

  /** Returns the cached value or runs `load`. A failed load is not kept. */
  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const t = this.now();
    const hit = this.m.get(key);
    if (hit && t - hit.at < ttlMs) return hit.v as Promise<T>;
    if (this.m.size >= this.max) for (const [k, e] of this.m) if (t - e.at >= ttlMs) this.m.delete(k);
    if (this.m.size >= this.max) this.m.clear();
    const v = load().catch((e: unknown) => { this.m.delete(key); throw e; });
    this.m.set(key, { at: t, v });
    return v;
  }
}
