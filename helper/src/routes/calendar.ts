/**
 * "On TV this week": Sonarr's calendar (and optionally Radarr's film releases) joined to the Jellyfin library so the
 * SPA can show the right artwork and a Play button once an episode has arrived. Read-only.
 */
import { clean, json, upstreamJson, type Ctx, type Res } from '../core.ts';
import { libraryItems, type JfItem } from '../jellyfin.ts';

interface SonarrEp {
  seriesId?: number; title?: string; seasonNumber?: number; episodeNumber?: number; airDateUtc?: string; airDate?: string; overview?: string; hasFile?: boolean;
  series?: { title?: string; tvdbId?: number };
}
interface RadarrMovie { title?: string; tmdbId?: number; year?: number; digitalRelease?: string; physicalRelease?: string; inCinemas?: string; hasFile?: boolean; overview?: string }

export interface CalendarEntryOut {
  kind: 'episode' | 'movie'; airs: string; title: string; subtitle?: string; season?: number; episode?: number;
  jellyfin?: { seriesId?: string; episodeId?: string; movieId?: string }; inLibrary: boolean; downloaded: boolean; overview?: string;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export async function calendar(ctx: Ctx): Promise<Res> {
  const days = Math.min(31, Math.max(1, Math.round(Number(ctx.query.get('days') ?? 7)) || 7));
  const withMovies = ctx.query.get('movies') === '1';
  const from = Date.parse(`${day(ctx.deps.now() - 864e5 / 2)}T00:00:00Z`); // include today wherever the server clock sits
  const to = from + days * 864e5;
  const range = `start=${day(from)}&end=${day(to)}`;

  const [eps, films, series, movies] = await Promise.all([
    ctx.cfg.sonarrKey ? upstreamJson<SonarrEp[]>(ctx.deps, 'sonarr', `${ctx.cfg.sonarrUrl}/api/v3/calendar?${range}&includeSeries=true`, { headers: { 'X-Api-Key': ctx.cfg.sonarrKey } }) : Promise.resolve([] as SonarrEp[]),
    withMovies && ctx.cfg.radarrKey ? upstreamJson<RadarrMovie[]>(ctx.deps, 'radarr', `${ctx.cfg.radarrUrl}/api/v3/calendar?${range}`, { headers: { 'X-Api-Key': ctx.cfg.radarrKey } }) : Promise.resolve([] as RadarrMovie[]),
    ctx.cache.get(`jf-series:${ctx.user.id}`, 300_000, () => libraryItems(ctx, ['Series'], ['ProviderIds'])),
    withMovies ? ctx.cache.get(`jf-movies:${ctx.user.id}`, 300_000, () => libraryItems(ctx, ['Movie'], ['ProviderIds'])) : Promise.resolve([] as JfItem[]),
  ]);

  const byTvdb = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const s of series) {
    if (s.ProviderIds?.Tvdb) byTvdb.set(String(s.ProviderIds.Tvdb), s.Id);
    if (s.Name) byTitle.set(norm(s.Name), s.Id);
  }
  const movieByTmdb = new Map(movies.filter(m => m.ProviderIds?.Tmdb).map(m => [String(m.ProviderIds?.Tmdb), m.Id]));

  // Episode ids, only for shows that have something already downloaded in the window (one call per such show)
  const libSeries = (e: SonarrEp): string | undefined => (e.series?.tvdbId ? byTvdb.get(String(e.series.tvdbId)) : undefined) ?? (e.series?.title ? byTitle.get(norm(e.series.title)) : undefined);
  const needEps = new Set(eps.filter(e => e.hasFile).map(libSeries).filter((x): x is string => !!x));
  const epIds = new Map<string, Map<string, string>>();
  await Promise.all([...needEps].map(async sid => {
    const list = await ctx.cache.get(`jf-eps:${ctx.user.id}:${sid}`, 120_000, () => libraryItems(ctx, ['Episode'], [], { parentId: sid })).catch(() => [] as JfItem[]);
    epIds.set(sid, new Map(list.filter(i => i.ParentIndexNumber != null && i.IndexNumber != null).map(i => [`${i.ParentIndexNumber}x${i.IndexNumber}`, i.Id])));
  }));

  const entries: CalendarEntryOut[] = [];
  for (const e of eps) {
    const airs = e.airDateUtc ?? (e.airDate ? `${e.airDate}T00:00:00Z` : '');
    if (!airs || !e.series?.title) continue;
    const sid = libSeries(e);
    const eid = sid && e.seasonNumber != null && e.episodeNumber != null ? epIds.get(sid)?.get(`${e.seasonNumber}x${e.episodeNumber}`) : undefined;
    entries.push({
      kind: 'episode', airs, title: clean(e.series.title), subtitle: e.title ? clean(e.title) : undefined, season: e.seasonNumber, episode: e.episodeNumber,
      jellyfin: sid ? { seriesId: sid, episodeId: eid } : undefined, inLibrary: !!eid, downloaded: !!e.hasFile, overview: e.overview ? clean(e.overview, 400) : undefined,
    });
  }
  for (const m of films) {
    // Radarr lists a film when ANY of its dates is in the window: use the one that is (digital first)
    const when = [m.digitalRelease, m.physicalRelease, m.inCinemas].find(d => d && Date.parse(d) >= from && Date.parse(d) < to);
    if (!when || !m.title) continue;
    const mid = m.tmdbId ? movieByTmdb.get(String(m.tmdbId)) : undefined;
    const kind = when === m.digitalRelease ? 'Digital release' : when === m.physicalRelease ? 'Disc release' : 'In cinemas';
    entries.push({ kind: 'movie', airs: when, title: clean(m.title), subtitle: kind, jellyfin: mid ? { movieId: mid } : undefined, inLibrary: !!mid, downloaded: !!m.hasFile, overview: m.overview ? clean(m.overview, 400) : undefined });
  }
  entries.sort((a, b) => a.airs.localeCompare(b.airs) || a.title.localeCompare(b.title));
  return json(200, { days, from: new Date(from).toISOString(), to: new Date(to).toISOString(), entries });
}
