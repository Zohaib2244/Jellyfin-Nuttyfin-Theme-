/**
 * Demo version of the helper service so everything that needs it can be reviewed in ?demo=1:
 * the On TV calendar, the remote NutBot brain and the smart Remove dialog (plan + dry run + simulated delete).
 * `?nohelper=1` pretends the service is not installed, to see the silent fallbacks.
 */
import type {
  CalendarEntry, DeleteMode, DeletePlan, DeleteResult, DeleteStepResult, HelperApi, HelperHealth, NutbotPick, NutbotReply, NutbotTurn,
} from './desk-types';
import { ApiError } from './http';
import type { Episode, Title } from './types';

export interface DemoHelperCtx {
  isAdmin(): boolean;
  upcoming(): Promise<Episode[]>;
  /** library titles to pick from, in a stable order */
  titles(): Title[];
  titleById(id: string): Title | undefined;
  /** the demo's own "remove from Jellyfin" */
  removeFromJellyfin(id: string): Promise<void>;
}

const GB = 1024 ** 3;
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const off = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).has('nohelper');
const hash = (s: string): number => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

export function createDemoHelper(ctx: DemoHelperCtx): HelperApi {
  const health: HelperHealth = { ok: true, version: 'demo', features: { calendar: true, nutbot: true, delete: true, deleteEnabled: true } };

  const plan = (id: string): DeletePlan => {
    const t = ctx.titleById(id);
    if (!t) throw new ApiError(404, 'not-found', 'Not found');
    const series = t.kind === 'series';
    const size = (series ? 38 : 6.4 + (hash(id) % 9)) * GB;
    const seeding = hash(id) % 3 !== 0;
    const files = series ? 24 : 1;
    const modes: DeletePlan['modes'] = {
      'jellyfin-only': { freedBytes: seeding ? 0 : size, keptBytes: seeding ? size : 0, steps: ['Delete it in Jellyfin'] },
      'arr-and-files': { freedBytes: seeding ? 0 : size, keptBytes: seeding ? size : 0, steps: [`Remove it from ${series ? 'Sonarr' : 'Radarr'} and delete its files`, 'Delete it in Jellyfin'] },
      'arr-and-files-and-torrent': { freedBytes: size, keptBytes: 0, steps: ['Remove the torrent and its data from qBittorrent', `Remove it from ${series ? 'Sonarr' : 'Radarr'} and delete its files`, 'Delete it in Jellyfin'] },
    };
    return {
      jellyfinId: id, title: t.name, kind: t.kind,
      arr: { app: series ? 'sonarr' : 'radarr', id: 100 + (hash(id) % 400), title: t.name, path: `/media/${series ? 'TV Shows' : 'Movies'}/${t.name}` },
      files: { count: files, bytes: size },
      torrents: [{ hash: (hash(id).toString(16) + 'a1b2c3d4e5f60718').slice(0, 40).padEnd(40, '0'), name: `${t.name.replace(/\s+/g, '.')}.1080p.WEB-DL`, state: seeding ? 'stalledUP' : 'pausedUP', seeding, ratio: 0.6 + (hash(id) % 20) / 10, sizeBytes: size, sharedFiles: files }],
      hardlinked: true,
      modes,
      notes: seeding
        ? ['The torrent is still seeding and shares these files, so deleting only from Jellyfin gives no space back.']
        : ['The torrent has finished seeding, so deleting the library copy frees the space.'],
      deleteEnabled: health.features.deleteEnabled,
    };
  };

  const execute = async (input: { jellyfinId: string; mode: DeleteMode; confirm: string; dryRun?: boolean }): Promise<DeleteResult> => {
    const p = plan(input.jellyfinId);
    if (input.confirm.trim().toLowerCase() !== p.title.trim().toLowerCase()) throw new ApiError(400, 'client', 'Confirm does not match', { error: 'confirm-mismatch' });
    const dryRun = input.dryRun !== false;
    const steps: DeleteStepResult[] = [];
    const want = p.modes[input.mode].steps;
    const kinds: Array<DeleteStepResult['step']> = input.mode === 'jellyfin-only' ? ['jellyfin'] : input.mode === 'arr-and-files' ? ['arr', 'jellyfin'] : ['torrent', 'arr', 'jellyfin'];
    for (const [i, step] of kinds.entries()) {
      await sleep(dryRun ? 150 : 700);
      steps.push({ step, label: want[i] ?? step, status: dryRun ? 'dry-run' : 'done' });
      if (!dryRun && step === 'jellyfin') await ctx.removeFromJellyfin(input.jellyfinId);
    }
    return { dryRun, mode: input.mode, ok: true, steps, freedBytes: p.modes[input.mode].freedBytes };
  };

  const chat = async (messages: NutbotTurn[]): Promise<NutbotReply> => {
    await sleep(700);
    const last = [...messages].reverse().find(m => m.role === 'user')?.text ?? '';
    const titles = ctx.titles();
    const start = titles.length ? hash(last) % titles.length : 0;
    const chosen = [0, 7, 19].map(k => titles[(start + k) % Math.max(1, titles.length)]).filter((t): t is Title => !!t);
    const picks: NutbotPick[] = chosen.slice(0, 2).map(t => ({ kind: 'library', id: t.id, title: t.name, why: t.genres[0] ? `A good ${t.genres[0].toLowerCase()} pick that fits "${last.slice(0, 40)}".` : 'Fits what you asked for.' }));
    picks.push({ kind: 'request', tmdbId: 1022789, mediaType: 'movie', title: 'Inside Out 2', why: 'Not in the library yet, but it matches the mood. You can ask for it.' });
    return { reply: `Here is what I would put on, thinking about "${last.slice(0, 60)}". The first two are ready to play. I added one more you could ask for.`, picks };
  };

  return {
    available: async () => !off(),
    health: async () => (off() ? null : health),
    calendar: async (): Promise<CalendarEntry[]> => {
      if (off()) return [];
      const eps = await ctx.upcoming();
      const entries: CalendarEntry[] = eps.map(e => ({
        kind: 'episode', airs: e.premiered ?? new Date().toISOString(), title: e.seriesName, subtitle: e.name, season: e.season, episode: e.episode, overview: e.overview,
        jellyfin: { seriesId: e.seriesId, episodeId: e.missing ? undefined : e.id }, inLibrary: !e.missing, downloaded: !e.missing,
      }));
      // two shows Sonarr knows but the library does not have yet
      const day = 864e5;
      const t0 = new Date(); t0.setHours(21, 0, 0, 0);
      entries.push(
        { kind: 'episode', airs: new Date(t0.getTime() + 2 * day).toISOString(), title: 'Slow Horses', subtitle: 'Strange Bedfellows', season: 5, episode: 1, inLibrary: false, downloaded: false, overview: 'The slow horses are back on the clock.' },
        { kind: 'episode', airs: new Date(t0.getTime() + 4 * day).toISOString(), title: 'Pluribus', subtitle: 'We Are Us', season: 1, episode: 6, inLibrary: false, downloaded: false },
      );
      return entries.sort((a, b) => a.airs.localeCompare(b.airs));
    },
    chat: async (messages, _context) => {
      if (off()) throw new ApiError(503, 'server', 'down');
      return chat(messages);
    },
    deletePlan: async (id: string) => {
      if (!ctx.isAdmin()) throw new ApiError(403, 'forbidden', 'Admin only');
      await sleep(350);
      return plan(id);
    },
    deleteExecute: async input => {
      if (!ctx.isAdmin()) throw new ApiError(403, 'forbidden', 'Admin only');
      return execute(input);
    },
  };
}
