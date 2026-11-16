/** node:http adapter + entry point. Run with `node src/server.ts` (Node 22.6+ strips the types itself). */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { lstat, readdir } from 'node:fs/promises';
import { createApp } from './app.ts';
import { loadConfig, type Config } from './config.ts';
import type { Deps, FileStat, FsLike, Req } from './core.ts';
import { runCli } from './nutbot/cli.ts';

const MAX_BODY = 32 * 1024;

export const realFs: FsLike = {
  async lstat(path): Promise<FileStat | null> {
    try {
      const st = await lstat(path, { bigint: true });
      return { dev: String(st.dev), ino: String(st.ino), nlink: Number(st.nlink), size: Number(st.size), blocks: Number(st.blocks), isFile: st.isFile(), isDir: st.isDirectory() };
    } catch { return null; }
  },
  readdir: path => readdir(path),
};

export const realDeps: Deps = { fetch: (input, init) => fetch(input, init), fs: realFs, runCli, now: () => Date.now() };

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') { resolve(undefined); return; }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) { resolve(undefined); return; }
      try { resolve(JSON.parse(text)); } catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

export function startServer(cfg: Config, deps: Deps = realDeps): ReturnType<typeof createServer> {
  const handle = createApp(cfg, deps);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown, extra: Record<string, string> = {}): void => {
      const text = JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
      res.end(text);
    };
    const url = new URL(req.url ?? '/', 'http://helper');
    readBody(req).then(async body => {
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v[0] : v;
      const r: Req = { method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, headers, body };
      const out = await handle(r);
      send(out.status, out.body, out.headers);
    }).catch((e: { status?: number }) => send(e.status ?? 400, { error: e.status === 413 ? 'too-large' : 'bad-request', message: e.status === 413 ? 'Too much data' : 'That did not look right' }));
  });
  server.requestTimeout = 150_000;
  server.headersTimeout = 20_000;
  server.listen(cfg.port, cfg.host);
  return server;
}

// Run when started directly (not when a test imports this file).
if (import.meta.main) {
  const cfg = loadConfig(process.env);
  startServer(cfg);
  console.log(`nuttyfin-helper listening on http://${cfg.host}:${cfg.port}  (delete ${cfg.allowDelete ? 'ENABLED' : 'disabled'}, brain ${cfg.cli})`);
}
