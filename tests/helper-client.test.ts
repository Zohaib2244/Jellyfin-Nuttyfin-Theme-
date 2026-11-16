import { afterEach, describe, expect, it, vi } from 'vitest';
import { HelperClient } from '../src/api/helper';

const reply = (body: string, status = 200, type = 'application/json'): Response => new Response(body, { status, headers: { 'Content-Type': type } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('HelperClient', () => {
  it('feature-detects through /nutfin-api/health and sends the person\'s Jellyfin token', async () => {
    const f = vi.fn(async () => reply('{"ok":true,"version":"0.1.0","features":{"calendar":true,"nutbot":true,"delete":true,"deleteEnabled":false}}'));
    vi.stubGlobal('fetch', f);
    const c = new HelperClient(() => 'tok123456789');
    expect(await c.available()).toBe(true);
    expect(await c.available()).toBe(true); // cached
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/nutfin-api/health');
    expect((init.headers as Record<string, string>)['Authorization']).toMatch(/^MediaBrowser .*Token="tok123456789"/);
  });

  it('a static host answering with index.html does not count as a helper', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('<!doctype html><title>Nuttyfin</title>', 200, 'text/html')));
    const c = new HelperClient(() => 't');
    expect(await c.available()).toBe(false);
    expect(await c.calendar()).toEqual([]);
  });

  it('errors and network failures mean unavailable, silently', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('{"error":"unauthorized"}', 401)));
    expect(await new HelperClient(() => null).available()).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await new HelperClient(() => 't').available()).toBe(false);
  });

  it('retries the health check after a minute, and on reset', async () => {
    vi.useFakeTimers();
    const f = vi.fn(async () => reply('{"ok":false}'));
    vi.stubGlobal('fetch', f);
    const c = new HelperClient(() => 't');
    expect(await c.available()).toBe(false);
    await c.available();
    expect(f).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    await c.available();
    expect(f).toHaveBeenCalledTimes(2);
    c.reset();
    await c.available();
    expect(f).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('calendar returns entries, chat rejects when the brain is down, delete defaults are passed through', async () => {
    const f = vi.fn(async (url: string) => {
      if (url === '/nutfin-api/health') return reply('{"ok":true}');
      if (url.startsWith('/nutfin-api/calendar')) return reply('{"entries":[{"kind":"episode","title":"Silo"}]}');
      if (url === '/nutfin-api/nutbot/chat') return reply('{"error":"brain-unavailable"}', 503);
      return reply('{"dryRun":true,"ok":true,"steps":[],"mode":"jellyfin-only"}');
    });
    vi.stubGlobal('fetch', f);
    const c = new HelperClient(() => 'tok123456789');
    expect(await c.calendar(5)).toEqual([{ kind: 'episode', title: 'Silo' }]);
    expect(f.mock.calls.some(call => String(call[0]) === '/nutfin-api/calendar?days=5')).toBe(true);
    await expect(c.chat([{ role: 'user', text: 'hi' }], {})).rejects.toMatchObject({ status: 503 });
    await c.deleteExecute({ jellyfinId: 'x', mode: 'jellyfin-only', confirm: 'X' });
    const last = f.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(JSON.parse(String(last[1].body))).toEqual({ jellyfinId: 'x', mode: 'jellyfin-only', confirm: 'X' }); // no dryRun key: the helper's default (a dry run) applies
  });
});
