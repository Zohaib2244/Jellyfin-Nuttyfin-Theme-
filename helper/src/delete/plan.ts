/**
 * Smart delete: the maths. Mirrors the owner's battle-tested /opt/docker/media-stack/tools/nuke-show + _medialib.py:
 * imports are HARDLINKS, so deleting the library copy frees nothing while a torrent still holds the second link.
 * A file's blocks come back only when every link to its inode is removed. We walk the library folder and each finished
 * torrent's data, group files by (device, inode), and count how many links each mode removes versus how many exist.
 * Pure and fully unit-tested; the filesystem comes in through FsLike.
 */
import type { FsLike } from '../core.ts';

export interface InodeInfo { /** links that exist on disk */ nlink: number; /** bytes on disk */ size: number; /** links found inside the walked folder(s) */ links: number }
export type InodeMap = Map<string, InodeInfo>;

const MAX_FILES = 200_000;

/** Every regular file under `path` (or `path` itself), grouped by inode. Missing path = empty map. */
export async function walkInodes(fs: FsLike, path: string, budget = { left: MAX_FILES }): Promise<InodeMap> {
  const out: InodeMap = new Map();
  const add = (st: { dev: string; ino: string; nlink: number; size: number; blocks: number }): void => {
    const key = `${st.dev}:${st.ino}`;
    const e = out.get(key);
    if (e) e.links++;
    else out.set(key, { nlink: st.nlink, size: st.blocks > 0 ? st.blocks * 512 : st.size, links: 1 });
  };
  const visit = async (p: string): Promise<void> => {
    if (budget.left <= 0) return;
    const st = await fs.lstat(p);
    if (!st) return;
    if (st.isFile) { if (budget.left <= 0) return; budget.left--; add(st); return; }
    if (!st.isDir) return; // symlinks and devices are never followed
    let names: string[] = [];
    try { names = await fs.readdir(p); } catch { return; }
    for (let i = 0; i < names.length; i += 16) await Promise.all(names.slice(i, i + 16).map(n => visit(`${p.replace(/\/+$/, '')}/${n}`)));
  };
  await visit(path);
  return out;
}

/** Add up what removing these sets of links does. `freed` = inodes whose every link is removed; `kept` = library inodes that survive. */
export function spaceMath(library: InodeMap, torrents: readonly InodeMap[]): { freedBytes: number; keptBytes: number } {
  const removed = new Map<string, { nlink: number; size: number; links: number }>();
  for (const set of [library, ...torrents]) {
    for (const [k, v] of set) {
      const e = removed.get(k);
      if (e) e.links += v.links;
      else removed.set(k, { nlink: v.nlink, size: v.size, links: v.links });
    }
  }
  let freed = 0;
  let kept = 0;
  for (const [k, v] of removed) {
    if (v.links >= v.nlink) freed += v.size;
    else if (library.has(k)) kept += v.size; // a library file that stays on disk because something else still links to it
  }
  return { freedBytes: freed, keptBytes: kept };
}

/** Torrents that share at least one inode with the library copy. */
export function sharedCount(library: InodeMap, torrent: InodeMap): number {
  let n = 0;
  for (const k of torrent.keys()) if (library.has(k)) n++;
  return n;
}

/** qBittorrent states that mean "finished and still seeding". */
export const SEEDING_STATES = new Set(['uploading', 'stalledUP', 'queuedUP', 'forcedUP', 'checkingUP']);
export const isSeeding = (state: string): boolean => SEEDING_STATES.has(state);

export interface TorrentInfo { hash: string; name: string; state: string; ratio: number; size: number; content_path?: string; progress?: number }

export interface PlanMath {
  library: InodeMap;
  /** torrents that share data with the library copy, with their own inode maps */
  matched: Array<{ info: TorrentInfo; inodes: InodeMap; shared: number }>;
}

export function modesFor(m: PlanMath, noun: { app: string }): Record<'jellyfin-only' | 'arr-and-files' | 'arr-and-files-and-torrent', { freedBytes: number; keptBytes: number; steps: string[] }> {
  const lib = spaceMath(m.library, []);
  const all = spaceMath(m.library, m.matched.map(t => t.inodes));
  const torrentStep = m.matched.length ? [`Remove ${m.matched.length === 1 ? 'the torrent' : `${m.matched.length} torrents`} and its data from qBittorrent`] : [];
  return {
    'jellyfin-only': { ...lib, steps: ['Delete it in Jellyfin'] },
    'arr-and-files': { ...lib, steps: [`Remove it from ${noun.app} and delete its files`, 'Delete it in Jellyfin'] },
    'arr-and-files-and-torrent': { ...all, steps: [...torrentStep, `Remove it from ${noun.app} and delete its files`, 'Delete it in Jellyfin'] },
  };
}

/** Plain-language notes the dialog shows under the numbers. */
export function notesFor(m: PlanMath, modes: ReturnType<typeof modesFor>, measured: boolean, hasArr: boolean): string[] {
  const notes: string[] = [];
  if (!measured) { notes.push('The helper could not read the media drive, so it cannot tell how much space would come back.'); return notes; }
  const seeding = m.matched.filter(t => isSeeding(t.info.state));
  if (m.matched.length && modes['jellyfin-only'].freedBytes < modes['arr-and-files-and-torrent'].freedBytes) {
    notes.push(seeding.length
      ? 'The torrent is still seeding and shares these files, so deleting only the library copy frees no space.'
      : 'A finished torrent still holds a second link to these files, so deleting only the library copy frees no space.');
  } else if (!m.matched.length) notes.push('No torrent shares these files, so deleting them gives the space back.');
  if (!hasArr) notes.push('No matching entry was found in Radarr or Sonarr, so only the files and the Jellyfin entry can go.');
  return notes;
}
