import { describe, expect, it } from 'vitest';
import { notesFor, modesFor, spaceMath, walkInodes, type InodeMap } from '../src/delete/plan.ts';
import { get as _get, JF_ADMIN_TOKEN, makeFs, post, rig, type Net, type Rig } from './harness.ts';

void _get;
const GB = 1024 ** 3;
const inode = (nlink: number, size: number, links = 1) => ({ nlink, size, links });
const map = (o: Record<string, { nlink: number; size: number; links: number }>): InodeMap => new Map(Object.entries(o));

describe('space maths (the hardlink rule from nuke-show)', () => {
  it('library file hardlinked to a seeding torrent: the library alone frees nothing, library + torrent frees it all', () => {
    const lib = map({ a: inode(2, 5 * GB) });
    const tor = map({ a: inode(2, 5 * GB) });
    expect(spaceMath(lib, [])).toEqual({ freedBytes: 0, keptBytes: 5 * GB });
    expect(spaceMath(lib, [tor])).toEqual({ freedBytes: 5 * GB, keptBytes: 0 });
  });
  it('no torrent link: deleting the library copy frees the space', () => {
    expect(spaceMath(map({ a: inode(1, 4 * GB) }), [])).toEqual({ freedBytes: 4 * GB, keptBytes: 0 });
  });
  it('a third link elsewhere keeps the blocks even after library + torrent go', () => {
    const lib = map({ a: inode(3, 2 * GB) });
    const tor = map({ a: inode(3, 2 * GB) });
    expect(spaceMath(lib, [tor])).toEqual({ freedBytes: 0, keptBytes: 2 * GB });
  });
  it('a whole show: some episodes linked to the torrent, some not', () => {
    const lib = map({ e1: inode(2, GB), e2: inode(2, GB), e3: inode(1, GB) });
    const tor = map({ e1: inode(2, GB), e2: inode(2, GB), extra: inode(1, 100) });
    expect(spaceMath(lib, [])).toEqual({ freedBytes: GB, keptBytes: 2 * GB });
    expect(spaceMath(lib, [tor])).toEqual({ freedBytes: 3 * GB + 100, keptBytes: 0 });
  });
  it('two library paths to one inode count both links', () => {
    expect(spaceMath(map({ a: inode(2, GB, 2) }), [])).toEqual({ freedBytes: GB, keptBytes: 0 });
  });
  it('the torrent extras that are not in the library are only freed with the torrent', () => {
    const lib = map({});
    expect(spaceMath(lib, [map({ x: inode(1, 50) })]).freedBytes).toBe(50);
  });
});

describe('walking files', () => {
  it('groups by inode, never follows symlinks, handles a missing path', async () => {
    const fs = makeFs({ '/m/Show/s1/a.mkv': { ino: 10, nlink: 2, size: 1000 }, '/m/Show/s1/b.mkv': { ino: 10, nlink: 2, size: 1000 }, '/m/Show/c.nfo': { ino: 11, nlink: 1, size: 10 } });
    const w = await walkInodes(fs, '/m/Show');
    expect(w.size).toBe(2);
    expect(w.get('1:10')).toMatchObject({ nlink: 2, links: 2 });
    expect([...(await walkInodes(fs, '/nowhere')).keys()]).toEqual([]);
    expect((await walkInodes(fs, '/m/Show/c.nfo')).size).toBe(1);
  });
  it('stops at the file budget', async () => {
    const files = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`/m/x/f${i}`, { ino: i + 1, nlink: 1, size: 1 }]));
    expect((await walkInodes(makeFs(files), '/m/x', { left: 10 })).size).toBe(10);
  });
});

describe('plain-language notes', () => {
  const lib = map({ a: inode(2, GB) });
  const tor = map({ a: inode(2, GB) });
  const info = (state: string) => ({ hash: 'h'.repeat(40), name: 'n', state, ratio: 1, size: GB });
  it('seeding torrent', () => {
    const m = { library: lib, matched: [{ info: info('stalledUP'), inodes: tor, shared: 1 }] };
    expect(notesFor(m, modesFor(m, { app: 'Radarr' }), true, true)[0]).toMatch(/still seeding.*frees no space/);
  });
  it('finished torrent', () => {
    const m = { library: lib, matched: [{ info: info('pausedUP'), inodes: tor, shared: 1 }] };
    expect(notesFor(m, modesFor(m, { app: 'Radarr' }), true, true)[0]).toMatch(/finished torrent/);
  });
  it('unmeasured and no arr', () => {
    const m = { library: new Map() as InodeMap, matched: [] };
    expect(notesFor(m, modesFor(m, { app: 'Radarr' }), false, true)[0]).toMatch(/could not read the media drive/);
    expect(notesFor({ library: lib, matched: [] }, modesFor({ library: lib, matched: [] }, { app: 'Radarr' }), true, false).join(' ')).toMatch(/No matching entry/);
  });
});

/* ── the routes, with mocked Jellyfin / Radarr / Sonarr / qBittorrent and a fake disk ── */
const MOVIE_JF = '4'.repeat(32);
const SHOW_JF = '5'.repeat(32);
const HASH = 'ab'.repeat(20);
const OTHER_HASH = 'cd'.repeat(20);

const DISK = {
  '/host/media/Movies/Dune (2021)/Dune (2021).mkv': { ino: 100, nlink: 2, size: 8 * GB },
  '/host/media/downloads/Dune.2021.1080p/Dune.2021.1080p.mkv': { ino: 100, nlink: 2, size: 8 * GB },
  '/host/media/downloads/Unrelated/other.mkv': { ino: 200, nlink: 1, size: 9 * GB },
  '/host/media/TV Shows/Silo/S01E01.mkv': { ino: 300, nlink: 1, size: 2 * GB },
};

function arrWorld(r: Rig, over: { movieFound?: boolean; seeding?: boolean; failArr?: boolean; failJf?: boolean; failQbt?: boolean } = {}): void {
  const { movieFound = true, seeding = true } = over;
  r.net.on(c => {
    const u = c.url;
    if (u.startsWith(`http://jf/Items/${MOVIE_JF}?`)) return { body: { Id: MOVIE_JF, Name: 'Dune', Type: 'Movie', ProviderIds: { Tmdb: '438631' }, Path: '/media/Movies/Dune (2021)/Dune (2021).mkv' } };
    if (u.startsWith(`http://jf/Items/${SHOW_JF}?`)) return { body: { Id: SHOW_JF, Name: 'Silo', Type: 'Series', ProviderIds: { Tvdb: '1' } } };
    if (u.startsWith('http://jf/Items/') && c.method === 'DELETE') return { status: over.failJf ? 500 : 204 };
    if (u.startsWith('http://jf/Items/')) return { status: 404 };
    if (u.startsWith('http://radarr/api/v3/movie?tmdbId=')) return { body: movieFound ? [{ id: 77, title: 'Dune', path: '/media/Movies/Dune (2021)', sizeOnDisk: 8 * GB }] : [] };
    if (u.startsWith('http://sonarr/api/v3/series?tvdbId=')) return { body: [{ id: 9, title: 'Silo', path: '/media/TV Shows/Silo' }] };
    if (u.startsWith('http://radarr/api/v3/movie/77') && c.method === 'DELETE') return { status: over.failArr ? 500 : 200, body: {} };
    if (u.endsWith('/api/v2/auth/login')) return { text: 'Ok.', headers: { 'set-cookie': 'SID=abc; HttpOnly' } };
    if (u.endsWith('/api/v2/torrents/info')) {
      return { body: [
        { hash: HASH, name: 'Dune.2021.1080p', state: seeding ? 'stalledUP' : 'pausedUP', ratio: 1.4, size: 8 * GB, progress: 1, content_path: '/media/downloads/Dune.2021.1080p' },
        { hash: OTHER_HASH, name: 'Unrelated', state: 'stalledUP', ratio: 2, size: 9 * GB, progress: 1, content_path: '/media/downloads/Unrelated' },
        { hash: 'ef'.repeat(20), name: 'Still downloading', state: 'downloading', ratio: 0, size: 8 * GB, progress: 0.4, content_path: '/media/downloads/Dune.2021.1080p' },
      ] };
    }
    if (u.endsWith('/api/v2/torrents/delete')) return { status: over.failQbt ? 500 : 200, text: '' };
    return undefined;
  });
}
const writesOf = (net: Net): string[] => net.writes.map(c => `${c.method} ${c.url.replace(/^http:\/\//, '')}`);
const plan = (r: Rig, id = MOVIE_JF) => r.handle(post('/nutfin-api/delete/plan', { jellyfinId: id }, JF_ADMIN_TOKEN));
const exec = (r: Rig, body: Record<string, unknown>) => r.handle(post('/nutfin-api/delete/execute', { jellyfinId: MOVIE_JF, mode: 'arr-and-files-and-torrent', confirm: 'Dune', ...body }, JF_ADMIN_TOKEN));

describe('POST /delete/plan', () => {
  it('finds the Radarr movie, the hardlinked torrent, and what each mode frees', async () => {
    const r = rig({ fs: makeFs(DISK) });
    arrWorld(r);
    const res = await plan(r);
    expect(res.status).toBe(200);
    const p = res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(p['title']).toBe('Dune');
    expect(p['arr']).toMatchObject({ app: 'radarr', id: 77, path: '/media/Movies/Dune (2021)' });
    expect(p['hardlinked']).toBe(true);
    expect(p['measured']).toBe(true);
    expect(p['torrents']).toEqual([expect.objectContaining({ hash: HASH, seeding: true, sharedFiles: 1 })]); // the unrelated and the unfinished torrent are not touched
    expect(p['modes']['jellyfin-only'].freedBytes).toBe(0);
    expect(p['modes']['jellyfin-only'].keptBytes).toBeGreaterThan(7 * GB);
    expect(p['modes']['arr-and-files'].freedBytes).toBe(0);
    expect(p['modes']['arr-and-files-and-torrent'].freedBytes).toBeGreaterThan(7 * GB);
    expect(p['modes']['arr-and-files-and-torrent'].steps).toHaveLength(3);
    expect(p['notes'][0]).toMatch(/still seeding/);
    expect(p['deleteEnabled']).toBe(false);
    expect(r.net.writes).toEqual([]);
  });

  it('a finished (not seeding) torrent is described differently but still blocks the space', async () => {
    const r = rig({ fs: makeFs(DISK) });
    arrWorld(r, { seeding: false });
    const p = (await plan(r)).body as { torrents: Array<{ seeding: boolean }>; notes: string[] };
    expect(p.torrents[0]?.seeding).toBe(false);
    expect(p.notes[0]).toMatch(/finished torrent/);
  });

  it('a show goes through Sonarr by TVDB id; no torrent shares it so deleting frees it', async () => {
    const r = rig({ fs: makeFs(DISK) });
    arrWorld(r);
    const p = (await plan(r, SHOW_JF)).body as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(p.kind).toBe('series');
    expect(p.arr).toMatchObject({ app: 'sonarr', id: 9 });
    expect(p.torrents).toEqual([]);
    expect(p.modes['jellyfin-only'].freedBytes).toBe(2 * GB);
  });

  it('no Radarr match: says so, uses Jellyfin\'s own path', async () => {
    const r = rig({ fs: makeFs(DISK) });
    arrWorld(r, { movieFound: false });
    const p = (await plan(r)).body as { arr: unknown; files: { count: number }; notes: string[] };
    expect(p.arr).toBeNull();
    expect(p.files.count).toBe(1);
    expect(p.notes.join(' ')).toMatch(/No matching entry/);
  });

  it('cannot read the disk: numbers are zero and it says so (no guessing)', async () => {
    const r = rig({ fs: makeFs({}) });
    arrWorld(r);
    const p = (await plan(r)).body as { measured: boolean; modes: Record<string, { freedBytes: number }>; notes: string[] };
    expect(p.measured).toBe(false);
    expect(p.modes['arr-and-files-and-torrent']?.freedBytes).toBe(0);
    expect(p.notes[0]).toMatch(/could not read the media drive/);
  });

  it('rejects bad input and unknown items', async () => {
    const r = rig({ fs: makeFs(DISK) });
    arrWorld(r);
    expect((await r.handle(post('/nutfin-api/delete/plan', {}, JF_ADMIN_TOKEN))).status).toBe(400);
    expect((await r.handle(post('/nutfin-api/delete/plan', { jellyfinId: 'not an id' }, JF_ADMIN_TOKEN))).status).toBe(400);
    expect((await plan(r, '9'.repeat(32))).status).toBe(404);
  });
});

describe('POST /delete/execute', () => {
  it('is a DRY RUN by default: every step says dry-run and nothing on a real service is written', async () => {
    const r = rig({ fs: makeFs(DISK), env: { NUTFIN_ALLOW_DELETE: '1' } });
    arrWorld(r);
    const res = await exec(r, {}); // no dryRun key at all
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, ok: true, mode: 'arr-and-files-and-torrent' });
    expect((res.body as { steps: Array<{ step: string; status: string }> }).steps.map(s => `${s.step}:${s.status}`)).toEqual(['torrent:dry-run', 'arr:dry-run', 'jellyfin:dry-run']);
    expect(r.net.writes).toEqual([]);
    // truthy-but-not-false values are still dry runs
    for (const v of [true, 'false', 0, null]) {
      expect(((await exec(r, { dryRun: v })).body as { dryRun: boolean }).dryRun).toBe(true);
    }
    expect(r.net.writes).toEqual([]);
  });

  it('dryRun:false without NUTFIN_ALLOW_DELETE=1 is refused (403) and touches nothing', async () => {
    const r = rig({ fs: makeFs(DISK) });
    arrWorld(r);
    const res = await exec(r, { dryRun: false });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'delete-disabled' });
    expect(r.net.writes).toEqual([]);
    expect(r.net.calls.some(c => c.url.includes('/torrents/'))).toBe(false); // refused before even reading
  });

  it('the typed title must match exactly', async () => {
    const r = rig({ fs: makeFs(DISK), env: { NUTFIN_ALLOW_DELETE: '1' } });
    arrWorld(r);
    for (const confirm of ['dune 2021', 'Silo', '', undefined]) {
      const res = await exec(r, { confirm, dryRun: false });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'confirm-mismatch' });
    }
    expect((await exec(r, { confirm: '  Dune  ' })).status).toBe(200); // surrounding spaces are forgiven
    expect(r.net.writes).toEqual([]);
  });

  it('validates the mode', async () => {
    const r = rig({ fs: makeFs(DISK) });
    arrWorld(r);
    expect((await exec(r, { mode: 'everything' })).status).toBe(400);
    expect((await exec(r, { mode: undefined })).status).toBe(400);
  });

  it('a real run does the steps in order: torrent + data, then Radarr with files, then Jellyfin', async () => {
    const r = rig({ fs: makeFs(DISK), env: { NUTFIN_ALLOW_DELETE: '1' } });
    arrWorld(r);
    const res = await exec(r, { dryRun: false });
    expect(res.body).toMatchObject({ dryRun: false, ok: true });
    expect((res.body as { steps: Array<{ status: string }> }).steps.map(s => s.status)).toEqual(['done', 'done', 'done']);
    expect(writesOf(r.net)).toEqual([
      'POST qbt/api/v2/torrents/delete',
      'DELETE radarr/api/v3/movie/77?deleteFiles=true&addImportExclusion=false',
      `DELETE jf/Items/${MOVIE_JF}`,
    ]);
    const del = r.net.calls.find(c => c.url.endsWith('/torrents/delete'));
    expect(new URLSearchParams(del?.body).get('hashes')).toBe(HASH); // only the torrent that shares the files
    expect(new URLSearchParams(del?.body).get('deleteFiles')).toBe('true');
    expect(r.net.calls.find(c => c.method === 'DELETE' && c.url.startsWith('http://jf'))?.headers['x-emby-token']).toBe(JF_ADMIN_TOKEN); // Jellyfin is asked as the person
  });

  it('a failing step stops the chain: the later steps are skipped, nothing after it is attempted', async () => {
    const r = rig({ fs: makeFs(DISK), env: { NUTFIN_ALLOW_DELETE: '1' } });
    arrWorld(r, { failArr: true });
    const res = await exec(r, { dryRun: false });
    const b = res.body as { ok: boolean; steps: Array<{ step: string; status: string; detail?: string }> };
    expect(b.ok).toBe(false);
    expect(b.steps.map(s => `${s.step}:${s.status}`)).toEqual(['torrent:done', 'arr:failed', 'jellyfin:skipped']);
    expect(b.steps[2]?.detail).toMatch(/earlier step failed/);
    expect(writesOf(r.net).some(w => w.startsWith('DELETE jf/'))).toBe(false);

    const r2 = rig({ fs: makeFs(DISK), env: { NUTFIN_ALLOW_DELETE: '1' } });
    arrWorld(r2, { failQbt: true });
    const b2 = (await exec(r2, { dryRun: false })).body as { steps: Array<{ step: string; status: string }> };
    expect(b2.steps.map(s => `${s.step}:${s.status}`)).toEqual(['torrent:failed', 'arr:skipped', 'jellyfin:skipped']);
    expect(writesOf(r2.net)).toEqual(['POST qbt/api/v2/torrents/delete']); // the failed call only
  });

  it('Jellyfin-only mode never touches Radarr or qBittorrent', async () => {
    const r = rig({ fs: makeFs(DISK), env: { NUTFIN_ALLOW_DELETE: '1' } });
    arrWorld(r);
    const res = await exec(r, { mode: 'jellyfin-only', dryRun: false });
    expect((res.body as { steps: Array<{ step: string }> }).steps.map(s => s.step)).toEqual(['jellyfin']);
    expect(writesOf(r.net)).toEqual([`DELETE jf/Items/${MOVIE_JF}`]);
  });

  it('arr-and-files without a torrent step leaves qBittorrent alone', async () => {
    const r = rig({ fs: makeFs(DISK), env: { NUTFIN_ALLOW_DELETE: '1' } });
    arrWorld(r);
    await exec(r, { mode: 'arr-and-files', dryRun: false });
    expect(writesOf(r.net).some(w => w.includes('torrents/delete'))).toBe(false);
  });

  it('no Radarr match: that step is skipped, the rest goes ahead', async () => {
    const r = rig({ fs: makeFs(DISK), env: { NUTFIN_ALLOW_DELETE: '1' } });
    arrWorld(r, { movieFound: false });
    const b = (await exec(r, { mode: 'arr-and-files', dryRun: false })).body as { ok: boolean; steps: Array<{ step: string; status: string }> };
    expect(b.steps.map(s => `${s.step}:${s.status}`)).toEqual(['arr:skipped', 'jellyfin:done']);
    expect(b.ok).toBe(true);
  });

  it('a member cannot execute even a dry run (403)', async () => {
    const r = rig({ fs: makeFs(DISK), env: { NUTFIN_ALLOW_DELETE: '1' } });
    arrWorld(r);
    const res = await r.handle(post('/nutfin-api/delete/execute', { jellyfinId: MOVIE_JF, mode: 'jellyfin-only', confirm: 'Dune', dryRun: false }, 'membertoken012345678'));
    expect(res.status).toBe(403);
    expect(r.net.writes).toEqual([]);
  });

  it('already gone in Jellyfin counts as done', async () => {
    const r = rig({ fs: makeFs(DISK), env: { NUTFIN_ALLOW_DELETE: '1' } });
    arrWorld(r);
    r.net.on(c => (c.method === 'DELETE' && c.url.startsWith('http://jf/Items/') ? { status: 404 } : undefined));
    expect(((await exec(r, { mode: 'jellyfin-only', dryRun: false })).body as { ok: boolean }).ok).toBe(true);
  });
});
