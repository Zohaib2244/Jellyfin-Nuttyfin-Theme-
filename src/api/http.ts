/** fetch wrapper shared by the Jellyfin and Seerr clients. UI code never calls fetch directly. */

export type ApiErrorKind = 'network' | 'unauthorized' | 'forbidden' | 'not-found' | 'server' | 'client';

export class ApiError extends Error {
  constructor(readonly status: number, readonly kind: ApiErrorKind, message: string, readonly body?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export function kindFromStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  // 502/503/504 = the proxy cannot reach the server
  if (status >= 500) return 'server';
  return 'client';
}

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];

/** key=value&... ; arrays become comma lists (Jellyfin style); null/undefined/empty arrays are skipped. */
export function buildQuery(q: Record<string, QueryValue> = {}): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      parts.push(`${k}=${v.map(x => encodeURIComponent(String(x))).join(',')}`);
    } else {
      parts.push(`${k}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join('&');
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT';
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  /** abort after this many ms (default 15000) */
  timeoutMs?: number;
  /** a 401 here is an answer (e.g. wrong password), not an expired session */
  expect401?: boolean;
}

export interface HttpConfig {
  base: string;
  headers(): Record<string, string>;
  /** called on a 401 that is not expected */
  onUnauthorized?(): void;
}

export function createHttp(cfg: HttpConfig) {
  return async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const qs = buildQuery(opts.query);
    const url = `${cfg.base}${path}${qs ? `?${qs}` : ''}`;
    const headers: Record<string, string> = { Accept: 'application/json', ...cfg.headers() };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), opts.timeoutMs ?? 15_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout.signal]) : timeout.signal;

    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        credentials: 'same-origin',
        signal,
      });
    } catch (e) {
      if (opts.signal?.aborted) throw e; // the caller cancelled: let AbortError through
      throw new ApiError(0, 'network', 'Could not reach the server');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const kind = kindFromStatus(res.status);
      if (res.status === 401 && !opts.expect401) cfg.onUnauthorized?.();
      let body: unknown;
      try { body = await res.json(); } catch { /* not json */ }
      throw new ApiError(res.status, kind, `${opts.method ?? 'GET'} ${path} failed (${res.status})`, body);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  };
}

export type Http = ReturnType<typeof createHttp>;
