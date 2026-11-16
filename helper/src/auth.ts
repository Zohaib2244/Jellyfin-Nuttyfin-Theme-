/**
 * Every route is behind the person's own Jellyfin token. The browser sends it as `Authorization: MediaBrowser ..., Token="..."`
 * or `X-Emby-Token`; we ask Jellyfin who it belongs to (GET /Users/Me) and whether they are an administrator, and
 * remember the answer for about a minute. The helper never stores or logs the token.
 */
import { createHash } from 'node:crypto';
import type { Config } from './config.ts';
import { HttpError, type Deps, type User } from './core.ts';

const TTL_OK = 60_000;
const TTL_BAD = 5_000;
const MAX_ENTRIES = 500;

export function extractToken(headers: Record<string, string | undefined>): string | null {
  const x = headers['x-emby-token'] ?? headers['x-mediabrowser-token'];
  if (x && /^[\w-]{8,128}$/.test(x.trim())) return x.trim();
  const a = headers['authorization'];
  const m = a ? /Token="([\w-]{8,128})"/.exec(a) : null;
  return m ? (m[1] as string) : null;
}

interface Entry { at: number; user: Omit<User, 'token'> | null }

export class Authenticator {
  private readonly cache = new Map<string, Entry>();
  private readonly cfg: Config;
  private readonly deps: Deps;
  constructor(cfg: Config, deps: Deps) { this.cfg = cfg; this.deps = deps; }

  /** Throws 401 when there is no token or Jellyfin does not know it. */
  async authenticate(headers: Record<string, string | undefined>): Promise<User> {
    const token = extractToken(headers);
    if (!token) throw new HttpError(401, 'unauthorized', 'Sign in to Nuttyfin first');
    const key = createHash('sha256').update(token).digest('hex');
    const now = this.deps.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < (hit.user ? TTL_OK : TTL_BAD)) {
      if (!hit.user) throw new HttpError(401, 'unauthorized', 'Sign in to Nuttyfin again');
      return { ...hit.user, token };
    }
    let res: Response;
    try {
      res = await this.deps.fetch(`${this.cfg.jellyfinUrl}/Users/Me`, { headers: { 'X-Emby-Token': token, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    } catch {
      throw new HttpError(502, 'jellyfin-unreachable', 'Jellyfin did not answer');
    }
    if (res.status === 401 || res.status === 403) {
      this.remember(key, now, null);
      throw new HttpError(401, 'unauthorized', 'Sign in to Nuttyfin again');
    }
    if (!res.ok) throw new HttpError(502, 'jellyfin-error', `Jellyfin answered ${res.status}`);
    const me = (await res.json().catch(() => null)) as { Id?: string; Name?: string; Policy?: { IsAdministrator?: boolean } } | null;
    if (!me?.Id) throw new HttpError(502, 'jellyfin-bad-reply', 'Jellyfin sent something unreadable');
    const user = { id: me.Id, name: me.Name ?? '', isAdmin: me.Policy?.IsAdministrator === true };
    this.remember(key, now, user);
    return { ...user, token };
  }

  private remember(key: string, at: number, user: Entry['user']): void {
    if (this.cache.size >= MAX_ENTRIES) {
      for (const [k, v] of this.cache) if (at - v.at > TTL_OK) this.cache.delete(k);
      if (this.cache.size >= MAX_ENTRIES) this.cache.clear();
    }
    this.cache.set(key, { at, user });
  }
}

export function requireAdmin(user: User): void {
  if (!user.isAdmin) throw new HttpError(403, 'forbidden', 'Only the server owner can do that');
}
