/** Test doubles: a scripted fetch (records every call), an in-memory file system with inodes, a fake CLI, a controllable clock. */
import { createApp } from '../src/app.ts';
import { loadConfig, type Config } from '../src/config.ts';
import type { CliRun, Deps, FileStat, FsLike, Req, Res, RunCli } from '../src/core.ts';

export const JF_ADMIN_TOKEN = 'admintoken0123456789';
export const JF_MEMBER_TOKEN = 'membertoken012345678';

export function testConfig(over: Record<string, string> = {}): Config {
  return loadConfig({
    NUTFIN_JELLYFIN_URL: 'http://jf', NUTFIN_SEERR_URL: 'http://seerr', NUTFIN_SONARR_URL: 'http://sonarr', NUTFIN_RADARR_URL: 'http://radarr', NUTFIN_QBT_URL: 'http://qbt',
    NUTFIN_SONARR_KEY: 'sk', NUTFIN_RADARR_KEY: 'rk', NUTFIN_SEERR_KEY: 'zk', NUTFIN_QBT_USER: 'u', NUTFIN_QBT_PASS: 'p', NUTFIN_PATH_MAPS: '/media=/host/media',
    ...over,
  });
}

export interface Call { method: string; url: string; headers: Record<string, string>; body?: string }
export type Responder = (call: Call) => { status?: number; body?: unknown; headers?: Record<string, string>; text?: string } | undefined;

export class Net {
  calls: Call[] = [];
  private readonly responders: Responder[] = [];
  /** First responder that returns something wins; later `on` calls are tried first so tests can override defaults. */
  on(r: Responder): this { this.responders.unshift(r); return this; }
  fetch: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const call: Call = { method: init?.method ?? 'GET', url: String(input), headers, body: typeof init?.body === 'string' ? init.body : undefined };
    this.calls.push(call);
    for (const r of this.responders) {
      const out = r(call);
      if (out) {
        const text = out.text ?? (out.body === undefined ? '' : JSON.stringify(out.body));
        const h = new Headers(out.headers ?? {});
        const status = out.status ?? 200;
        return new Response(status === 204 || status === 205 ? null : text, { status, headers: h });
      }
    }
    return new Response('no route', { status: 599 });
  };
  /** Requests that change something on a real service. */
  get writes(): Call[] {
    return this.calls.filter(c => c.method === 'DELETE' || /\/torrents\/delete$/.test(c.url) || (c.method === 'POST' && /\/api\/v3\//.test(c.url)));
  }
}

interface FileSpec { ino: number; nlink: number; size: number; dev?: number }
export function makeFs(files: Record<string, FileSpec>): FsLike {
  const dirs = new Set<string>();
  for (const p of Object.keys(files)) { let d = p; while ((d = d.slice(0, d.lastIndexOf('/'))) !== '') dirs.add(d); }
  return {
    async lstat(path): Promise<FileStat | null> {
      const f = files[path];
      if (f) return { dev: String(f.dev ?? 1), ino: String(f.ino), nlink: f.nlink, size: f.size, blocks: Math.ceil(f.size / 512), isFile: true, isDir: false };
      if (dirs.has(path)) return { dev: '1', ino: String(path.length), nlink: 2, size: 0, blocks: 0, isFile: false, isDir: true };
      return null;
    },
    async readdir(path): Promise<string[]> {
      const names = new Set<string>();
      for (const p of [...Object.keys(files), ...dirs]) if (p.startsWith(`${path}/`)) names.add(p.slice(path.length + 1).split('/')[0] as string);
      return [...names];
    },
  };
}

export interface Rig { handle: (req: Req) => Promise<Res>; net: Net; cfg: Config; clock: { t: number }; cliRuns: CliRun[] }

/** Jellyfin that knows two tokens. */
export function jellyfinUsers(net: Net): void {
  net.on(c => {
    if (c.url === 'http://jf/Users/Me') {
      if (c.headers['x-emby-token'] === JF_ADMIN_TOKEN) return { body: { Id: 'a'.repeat(32), Name: 'Owner', Policy: { IsAdministrator: true } } };
      if (c.headers['x-emby-token'] === JF_MEMBER_TOKEN) return { body: { Id: 'b'.repeat(32), Name: 'Mia', Policy: { IsAdministrator: false } } };
      return { status: 401 };
    }
    return undefined;
  });
}

export function rig(opts: { env?: Record<string, string>; fs?: FsLike; runCli?: RunCli } = {}): Rig {
  const net = new Net();
  jellyfinUsers(net);
  const clock = { t: 1_000_000 };
  const cliRuns: CliRun[] = [];
  const deps: Deps = {
    fetch: net.fetch, fs: opts.fs ?? makeFs({}), now: () => clock.t,
    runCli: opts.runCli ?? (async run => { cliRuns.push(run); return JSON.stringify({ result: '{"reply":"ok","picks":[]}' }); }),
  };
  const cfg = testConfig(opts.env);
  return { handle: createApp(cfg, deps), net, cfg, clock, cliRuns };
}

export const get = (path: string, token: string | null = JF_ADMIN_TOKEN, q = ''): Req => ({
  method: 'GET', path, query: new URLSearchParams(q), headers: token ? { 'x-emby-token': token } : {}, body: undefined,
});
export const post = (path: string, body: unknown, token: string | null = JF_ADMIN_TOKEN): Req => ({
  method: 'POST', path, query: new URLSearchParams(), headers: token ? { authorization: `MediaBrowser Client="Nuttyfin", Device="Chrome", DeviceId="x", Version="0.1.0", Token="${token}"` } : {}, body,
});
