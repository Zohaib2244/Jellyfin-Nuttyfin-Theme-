/** Jellyfin calls made with the CALLER's token, so the helper sees exactly what that person may see. */
import { assertWritable, HttpError, upstreamJson, type Ctx } from './core.ts';

export interface JfItem {
  Id: string; Name?: string; Type?: string; ProductionYear?: number; Path?: string; RunTimeTicks?: number; Genres?: string[];
  CommunityRating?: number; OfficialRating?: string; ProviderIds?: Record<string, string>;
  UserData?: { Played?: boolean; PlaybackPositionTicks?: number; PlayCount?: number };
  ParentIndexNumber?: number; IndexNumber?: number; Overview?: string; DateCreated?: string;
}
interface Items { Items?: JfItem[] }

const headers = (ctx: Ctx): Record<string, string> => ({ 'X-Emby-Token': ctx.user.token });
const q = (o: Record<string, string | number | boolean | undefined>): string =>
  Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

/** All films and/or shows this person can see. */
export async function libraryItems(ctx: Ctx, types: Array<'Movie' | 'Series' | 'Episode'>, fields: string[], extra: Record<string, string | number | boolean> = {}): Promise<JfItem[]> {
  const url = `${ctx.cfg.jellyfinUrl}/Items?${q({ userId: ctx.user.id, includeItemTypes: types.join(','), recursive: true, fields: fields.join(','), enableTotalRecordCount: false, limit: 3000, ...extra })}`;
  const r = await upstreamJson<Items>(ctx.deps, 'jellyfin', url, { headers: headers(ctx), timeoutMs: 20_000 });
  return r?.Items ?? [];
}

/** One item with the ids Radarr/Sonarr use. 404 when this person cannot see it. */
export async function getItem(ctx: Ctx, id: string): Promise<JfItem> {
  if (!/^[0-9a-f]{32}$/i.test(id.replace(/-/g, ''))) throw new HttpError(400, 'bad-id', 'That is not a Jellyfin id');
  return upstreamJson<JfItem>(ctx.deps, 'jellyfin', `${ctx.cfg.jellyfinUrl}/Items/${encodeURIComponent(id)}?${q({ userId: ctx.user.id })}`, { headers: headers(ctx) });
}

/** Removes the item (and its files) from Jellyfin. Already gone (404) counts as done. */
export async function deleteItem(ctx: Ctx, id: string): Promise<'deleted' | 'already-gone'> {
  assertWritable(ctx.cfg); // WRITE
  let r: Response;
  try {
    r = await ctx.deps.fetch(`${ctx.cfg.jellyfinUrl}/Items/${encodeURIComponent(id)}`, { method: 'DELETE', headers: headers(ctx), signal: AbortSignal.timeout(60_000) });
  } catch { throw new HttpError(502, 'jellyfin-unreachable', 'Jellyfin did not answer'); }
  if (r.status === 404) return 'already-gone';
  if (!r.ok) throw new HttpError(502, 'jellyfin-error', `Jellyfin answered ${r.status}`);
  return 'deleted';
}
