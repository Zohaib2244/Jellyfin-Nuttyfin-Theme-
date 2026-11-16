/**
 * Radarr / Sonarr / qBittorrent calls for the smart delete. Reads are always allowed. EVERY write goes through
 * `assertWritable`, which refuses unless NUTFIN_ALLOW_DELETE=1, so a bug upstream of here still cannot delete anything.
 */
import type { Config } from '../config.ts';
import { assertWritable, HttpError, upstreamJson, type Ctx, type Deps } from '../core.ts';
import type { JfItem } from '../jellyfin.ts';
import type { TorrentInfo } from './plan.ts';

export interface ArrMatch { app: 'radarr' | 'sonarr'; id: number; title: string; path: string; sizeOnDisk: number }

interface RadarrMovie { id: number; title?: string; path?: string; sizeOnDisk?: number }
interface SonarrSeries { id: number; title?: string; path?: string; statistics?: { sizeOnDisk?: number } }

/** Radarr movie by TMDB id, or Sonarr series by TVDB id (falls back to an exact title match when there is no id). */
export async function findArr(ctx: Ctx, item: JfItem): Promise<ArrMatch | null> {
  const ids = item.ProviderIds ?? {};
  if (item.Type === 'Movie') {
    if (!ctx.cfg.radarrKey) return null;
    const h = { 'X-Api-Key': ctx.cfg.radarrKey };
    const list = ids['Tmdb']
      ? await upstreamJson<RadarrMovie[]>(ctx.deps, 'radarr', `${ctx.cfg.radarrUrl}/api/v3/movie?tmdbId=${encodeURIComponent(ids['Tmdb'])}`, { headers: h })
      : (await upstreamJson<RadarrMovie[]>(ctx.deps, 'radarr', `${ctx.cfg.radarrUrl}/api/v3/movie`, { headers: h })).filter(m => m.title === item.Name);
    const m = list?.[0];
    return m?.path ? { app: 'radarr', id: m.id, title: m.title ?? item.Name ?? '', path: m.path, sizeOnDisk: m.sizeOnDisk ?? 0 } : null;
  }
  if (item.Type === 'Series') {
    if (!ctx.cfg.sonarrKey) return null;
    const h = { 'X-Api-Key': ctx.cfg.sonarrKey };
    const list = ids['Tvdb']
      ? await upstreamJson<SonarrSeries[]>(ctx.deps, 'sonarr', `${ctx.cfg.sonarrUrl}/api/v3/series?tvdbId=${encodeURIComponent(ids['Tvdb'])}`, { headers: h })
      : (await upstreamJson<SonarrSeries[]>(ctx.deps, 'sonarr', `${ctx.cfg.sonarrUrl}/api/v3/series`, { headers: h })).filter(s => s.title === item.Name);
    const s = list?.[0];
    return s?.path ? { app: 'sonarr', id: s.id, title: s.title ?? item.Name ?? '', path: s.path, sizeOnDisk: s.statistics?.sizeOnDisk ?? 0 } : null;
  }
  return null;
}

/** WRITE: remove from Radarr/Sonarr and delete its files. Does not add an import exclusion (same as nuke-show). */
export async function removeFromArr(ctx: Ctx, m: ArrMatch): Promise<void> {
  assertWritable(ctx.cfg);
  const radarr = m.app === 'radarr';
  const url = radarr
    ? `${ctx.cfg.radarrUrl}/api/v3/movie/${m.id}?deleteFiles=true&addImportExclusion=false`
    : `${ctx.cfg.sonarrUrl}/api/v3/series/${m.id}?deleteFiles=true&addImportListExclusion=false`;
  await upstreamJson<unknown>(ctx.deps, m.app, url, { method: 'DELETE', headers: { 'X-Api-Key': radarr ? ctx.cfg.radarrKey : ctx.cfg.sonarrKey }, timeoutMs: 120_000 });
}

/** qBittorrent Web API v2 with a cached login cookie. */
export class Qbt {
  private cookie = '';
  private readonly cfg: Config;
  private readonly deps: Deps;
  constructor(cfg: Config, deps: Deps) { this.cfg = cfg; this.deps = deps; }

  private async login(): Promise<void> {
    if (!this.cfg.qbtUser) { this.cookie = ''; return; } // auth bypass for this address
    let r: Response;
    try {
      r = await this.deps.fetch(`${this.cfg.qbtUrl}/api/v2/auth/login`, {
        method: 'POST', headers: { Referer: this.cfg.qbtUrl, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: this.cfg.qbtUser, password: this.cfg.qbtPass }).toString(), signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new HttpError(502, 'qbittorrent-unreachable', 'qBittorrent did not answer'); }
    const sid = r.headers.getSetCookie?.().map(c => c.split(';')[0]).find(c => c?.startsWith('SID=')) ?? '';
    if (!r.ok || (!sid && (await r.text().catch(() => '')).trim() !== 'Ok.')) throw new HttpError(502, 'qbittorrent-login', 'qBittorrent did not accept the helper\'s login');
    this.cookie = sid;
  }

  private async call(path: string, form?: Record<string, string>, retry = true): Promise<Response> {
    if (!this.cookie && this.cfg.qbtUser) await this.login();
    let r: Response;
    try {
      r = await this.deps.fetch(`${this.cfg.qbtUrl}${path}`, {
        method: form ? 'POST' : 'GET', headers: { Referer: this.cfg.qbtUrl, ...(this.cookie ? { Cookie: this.cookie } : {}), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        body: form ? new URLSearchParams(form).toString() : undefined, signal: AbortSignal.timeout(60_000),
      });
    } catch { throw new HttpError(502, 'qbittorrent-unreachable', 'qBittorrent did not answer'); }
    if (r.status === 403 && retry && this.cfg.qbtUser) { this.cookie = ''; return this.call(path, form, false); }
    if (!r.ok) throw new HttpError(502, 'qbittorrent-error', `qBittorrent answered ${r.status}`);
    return r;
  }

  async torrents(): Promise<TorrentInfo[]> {
    const r = await this.call('/api/v2/torrents/info');
    const list = (await r.json().catch(() => [])) as TorrentInfo[];
    return Array.isArray(list) ? list : [];
  }

  /** WRITE: remove torrents and their data. */
  async deleteTorrents(hashes: readonly string[]): Promise<void> {
    assertWritable(this.cfg);
    if (!hashes.length) return;
    if (hashes.some(h => !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/i.test(h))) throw new HttpError(500, 'bad-hash', 'Refusing to send a malformed torrent hash');
    await this.call('/api/v2/torrents/delete', { hashes: hashes.join('|'), deleteFiles: 'true' });
  }
}
