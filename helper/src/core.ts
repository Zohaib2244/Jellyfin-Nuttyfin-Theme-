/** Shared types and small helpers. The whole service is built from plain functions that take `Deps`, so tests inject fakes. */
import type { TtlCache } from './cache.ts';
import type { Config } from './config.ts';

export interface Req { method: string; path: string; query: URLSearchParams; headers: Record<string, string | undefined>; body: unknown }
export interface Res { status: number; body: unknown; headers?: Record<string, string> }

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;
  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export interface FileStat { dev: string; ino: string; nlink: number; size: number; blocks: number; isFile: boolean; isDir: boolean }
export interface FsLike {
  /** null when it does not exist */
  lstat(path: string): Promise<FileStat | null>;
  readdir(path: string): Promise<string[]>;
}

export interface CliRun { cmd: string; args: string[]; stdin: string; env: Record<string, string>; cwd: string; timeoutMs: number }
/** Rejects with CliError. Resolves with stdout. */
export type RunCli = (run: CliRun) => Promise<string>;
export class CliError extends Error {
  readonly kind: 'missing' | 'timeout' | 'failed';
  constructor(kind: 'missing' | 'timeout' | 'failed', message: string) {
    super(message);
    this.name = 'CliError';
    this.kind = kind;
  }
}

export interface Deps { fetch: typeof fetch; fs: FsLike; runCli: RunCli; now(): number }

export interface User { id: string; name: string; isAdmin: boolean; token: string }

export interface Ctx { cfg: Config; deps: Deps; cache: TtlCache; user: User; query: URLSearchParams; body: unknown }

export const json = (status: number, body: unknown): Res => ({ status, body });

/** Fetch JSON from an upstream with a timeout. Network trouble and bad statuses become a 502 the SPA can show calmly. */
export async function upstreamJson<T>(deps: Deps, name: string, url: string, init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<T> {
  let r: Response;
  try {
    r = await deps.fetch(url, { method: init.method ?? 'GET', headers: { Accept: 'application/json', ...init.headers }, body: init.body, signal: AbortSignal.timeout(init.timeoutMs ?? 15_000) });
  } catch {
    throw new HttpError(502, `${name}-unreachable`, `${name} did not answer`);
  }
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, `${name}-error`, `${name} answered ${r.status}`);
  const text = await r.text();
  if (!text.trim()) return undefined as T;
  try { return JSON.parse(text) as T; } catch { throw new HttpError(502, `${name}-bad-reply`, `${name} sent something unreadable`); }
}

/** Never put a person's words or a title into a log line raw: strip control characters, cap the length. */
export const clean = (s: unknown, max = 200): string => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

/** The one gate in front of every write: real deleting only works when NUTFIN_ALLOW_DELETE=1. */
export function assertWritable(cfg: Pick<Config, 'allowDelete'>): void {
  if (!cfg.allowDelete) throw new HttpError(403, 'delete-disabled', 'Real deleting is switched off on the helper (NUTFIN_ALLOW_DELETE is not 1)');
}
