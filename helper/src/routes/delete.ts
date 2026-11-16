/**
 * Smart delete (admin only). `plan` only READS (Jellyfin, Radarr/Sonarr, qBittorrent, file link counts) and says what each
 * mode would do and how much space would really come back. `execute` runs the steps in order (torrent + data, then
 * Radarr/Sonarr with files, then Jellyfin) and stops at the first failure. It is a dry run unless the caller says
 * `dryRun: false` AND the helper has NUTFIN_ALLOW_DELETE=1.
 */
import { toHostPath } from '../config.ts';
import { assertWritable, HttpError, json, type Ctx, type Res } from '../core.ts';
import type { DeleteMode, DeletePlan, DeleteResult, DeleteStepResult } from '../types.ts';
import { deleteItem, getItem, type JfItem } from '../jellyfin.ts';
import { findArr, Qbt, removeFromArr, type ArrMatch } from '../delete/clients.ts';
import { modesFor, notesFor, sharedCount, walkInodes, isSeeding, type InodeMap, type PlanMath, type TorrentInfo } from '../delete/plan.ts';
import { clean } from '../core.ts';

const MODES: readonly DeleteMode[] = ['jellyfin-only', 'arr-and-files', 'arr-and-files-and-torrent'];
const SCAN_BUDGET_MS = 25_000;

interface FullPlan { item: JfItem; arr: ArrMatch | null; math: PlanMath; plan: DeletePlan }

async function fullPlan(ctx: Ctx, jellyfinId: string, qbt: Qbt): Promise<FullPlan> {
  const item = await getItem(ctx, jellyfinId).catch((e: unknown) => {
    if (e instanceof HttpError && e.status === 404) throw new HttpError(404, 'not-found', 'Jellyfin does not have that item');
    throw e;
  });
  if (item.Type !== 'Movie' && item.Type !== 'Series') throw new HttpError(400, 'unsupported', 'Only films and whole shows can be removed here');
  const arr = await findArr(ctx, item);

  // Library files: where Radarr/Sonarr keep them, else where Jellyfin has them (container paths map to host paths)
  const libPath = toHostPath(ctx.cfg, arr?.path ?? item.Path ?? '');
  const library: InodeMap = libPath ? await walkInodes(ctx.deps.fs, libPath) : new Map();
  const measured = library.size > 0;

  const matched: PlanMath['matched'] = [];
  let incomplete = false;
  if (measured) {
    const minFile = Math.min(...[...library.values()].map(v => v.size));
    const started = ctx.deps.now();
    const all = (await qbt.torrents()).filter(t => (t.progress ?? 1) >= 1 && t.size >= minFile && !!t.content_path);
    for (let i = 0; i < all.length; i += 4) {
      if (ctx.deps.now() - started > SCAN_BUDGET_MS) { incomplete = true; break; }
      await Promise.all(all.slice(i, i + 4).map(async t => {
        const inodes = await walkInodes(ctx.deps.fs, toHostPath(ctx.cfg, t.content_path as string));
        const shared = sharedCount(library, inodes);
        if (shared > 0) matched.push({ info: t, inodes, shared });
      }));
    }
  }
  const math: PlanMath = { library, matched };
  const modes = modesFor(math, { app: arr?.app === 'sonarr' ? 'Sonarr' : 'Radarr' });
  const notes = notesFor(math, modes, measured, !!arr);
  if (incomplete) notes.push('The helper ran out of time checking every torrent, so the numbers may be a little off.');
  const bytes = [...library.values()].reduce((a, v) => a + v.size, 0);
  const plan: DeletePlan = {
    jellyfinId, title: clean(item.Name, 120), kind: item.Type === 'Series' ? 'series' : 'movie',
    arr: arr ? { app: arr.app, id: arr.id, title: clean(arr.title, 120), path: arr.path } : null,
    files: { count: [...library.values()].reduce((a, v) => a + v.links, 0), bytes },
    torrents: matched.map(t => ({ hash: t.info.hash, name: clean(t.info.name, 160), state: t.info.state, seeding: isSeeding(t.info.state), ratio: Math.round((t.info.ratio ?? 0) * 100) / 100, sizeBytes: t.info.size, sharedFiles: t.shared })),
    hardlinked: matched.length > 0, modes, notes, measured, deleteEnabled: ctx.cfg.allowDelete,
  };
  return { item, arr, math, plan };
}

export async function deletePlan(ctx: Ctx): Promise<Res> {
  const id = (ctx.body as { jellyfinId?: unknown } | null)?.jellyfinId;
  if (typeof id !== 'string' || !id) throw new HttpError(400, 'bad-request', 'jellyfinId is required');
  return json(200, (await fullPlan(ctx, id, new Qbt(ctx.cfg, ctx.deps))).plan);
}

export async function deleteExecute(ctx: Ctx): Promise<Res> {
  const b = (ctx.body ?? {}) as { jellyfinId?: unknown; mode?: unknown; confirm?: unknown; dryRun?: unknown };
  if (typeof b.jellyfinId !== 'string' || !b.jellyfinId) throw new HttpError(400, 'bad-request', 'jellyfinId is required');
  if (typeof b.mode !== 'string' || !MODES.includes(b.mode as DeleteMode)) throw new HttpError(400, 'bad-mode', 'mode must be jellyfin-only, arr-and-files or arr-and-files-and-torrent');
  const mode = b.mode as DeleteMode;
  const dryRun = b.dryRun !== false; // only an explicit false is a real delete
  if (!dryRun) assertWritable(ctx.cfg);

  const qbt = new Qbt(ctx.cfg, ctx.deps);
  const { item, arr, math, plan } = await fullPlan(ctx, b.jellyfinId, qbt);
  if (typeof b.confirm !== 'string' || b.confirm.trim() !== (item.Name ?? '').trim()) throw new HttpError(400, 'confirm-mismatch', 'The typed title does not match');

  const kinds: Array<DeleteStepResult['step']> = mode === 'jellyfin-only' ? ['jellyfin'] : mode === 'arr-and-files' ? ['arr', 'jellyfin'] : ['torrent', 'arr', 'jellyfin'];
  const app = arr?.app === 'sonarr' ? 'Sonarr' : 'Radarr';
  const LABEL: Record<DeleteStepResult['step'], string> = {
    torrent: math.matched.length === 1 ? 'Remove the torrent and its data from qBittorrent' : math.matched.length > 1 ? `Remove ${math.matched.length} torrents and their data from qBittorrent` : 'Remove the torrent from qBittorrent',
    arr: `Remove it from ${app} and delete its files`,
    jellyfin: 'Delete it in Jellyfin',
  };
  const steps: DeleteStepResult[] = [];
  let failed = false;

  for (const kind of kinds) {
    const label = LABEL[kind];
    if (failed) { steps.push({ step: kind, label, status: 'skipped', detail: 'Not run because an earlier step failed' }); continue; }
    if (kind === 'torrent' && !math.matched.length) { steps.push({ step: kind, label, status: 'skipped', detail: 'No torrent shares these files' }); continue; }
    if (kind === 'arr' && !arr) { steps.push({ step: kind, label, status: 'skipped', detail: 'No matching entry in Radarr or Sonarr' }); continue; }
    if (dryRun) { steps.push({ step: kind, label, status: 'dry-run', detail: kind === 'torrent' ? `${math.matched.length} torrent(s): ${math.matched.map(t => clean(t.info.name, 60)).join('; ')}` : undefined }); continue; }
    try {
      if (kind === 'torrent') await qbt.deleteTorrents(math.matched.map(t => (t.info as TorrentInfo).hash));
      else if (kind === 'arr') await removeFromArr(ctx, arr as ArrMatch);
      else await deleteItem(ctx, b.jellyfinId);
      steps.push({ step: kind, label, status: 'done' });
    } catch (e) {
      failed = true;
      steps.push({ step: kind, label, status: 'failed', detail: e instanceof HttpError ? e.message : 'Something went wrong' });
    }
  }
  const result: DeleteResult = { dryRun, mode, ok: !failed, steps, freedBytes: plan.modes[mode].freedBytes };
  return json(200, result);
}
