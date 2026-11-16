import { describe, expect, it } from 'vitest';
import { extractToken } from '../src/auth.ts';
import { get, JF_ADMIN_TOKEN, JF_MEMBER_TOKEN, post, rig } from './harness.ts';

describe('token extraction', () => {
  it('reads X-Emby-Token and the MediaBrowser Authorization header', () => {
    expect(extractToken({ 'x-emby-token': 'abcdef0123456789' })).toBe('abcdef0123456789');
    expect(extractToken({ authorization: 'MediaBrowser Client="Nuttyfin", Device="Chrome", DeviceId="d", Version="0.1.0", Token="abcdef0123456789"' })).toBe('abcdef0123456789');
  });
  it('rejects junk', () => {
    expect(extractToken({})).toBeNull();
    expect(extractToken({ 'x-emby-token': 'short' })).toBeNull();
    expect(extractToken({ 'x-emby-token': 'has space and "quotes"' })).toBeNull();
    expect(extractToken({ authorization: 'Bearer abcdef0123456789' })).toBeNull();
  });
});

describe('every route needs a Jellyfin token', () => {
  it('no token: 401 and Jellyfin is not even asked', async () => {
    const r = rig();
    for (const [method, path] of [['GET', '/nutfin-api/health'], ['GET', '/nutfin-api/calendar'], ['POST', '/nutfin-api/nutbot/chat'], ['POST', '/nutfin-api/delete/plan'], ['POST', '/nutfin-api/delete/execute']] as const) {
      const res = await r.handle(method === 'GET' ? get(path, null) : post(path, {}, null));
      expect(res.status, path).toBe(401);
      expect(res.body).toMatchObject({ error: 'unauthorized' });
    }
    expect(r.net.calls).toHaveLength(0);
  });

  it('a token Jellyfin does not know: 401', async () => {
    const r = rig();
    const res = await r.handle(get('/nutfin-api/health', 'not-a-real-token-123456'));
    expect(res.status).toBe(401);
  });

  it('Jellyfin down: 502, not a crash', async () => {
    const r = rig();
    r.net.on(c => (c.url.endsWith('/Users/Me') ? { status: 503 } : undefined));
    expect((await r.handle(get('/nutfin-api/health'))).status).toBe(502);
  });

  it('a valid token answers health and says what is switched on', async () => {
    const r = rig();
    const res = await r.handle(get('/nutfin-api/health', JF_MEMBER_TOKEN));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, features: { calendar: true, nutbot: true, delete: true, deleteEnabled: false } });
  });

  it('the answer from Jellyfin is cached for about a minute, then asked again', async () => {
    const r = rig();
    await r.handle(get('/nutfin-api/health'));
    await r.handle(get('/nutfin-api/health'));
    expect(r.net.calls.filter(c => c.url.endsWith('/Users/Me'))).toHaveLength(1);
    r.clock.t += 61_000;
    await r.handle(get('/nutfin-api/health'));
    expect(r.net.calls.filter(c => c.url.endsWith('/Users/Me'))).toHaveLength(2);
  });

  it('a rejected token is remembered only briefly', async () => {
    const r = rig();
    const bad = 'revokedtoken0123456789';
    await r.handle(get('/nutfin-api/health', bad));
    await r.handle(get('/nutfin-api/health', bad));
    expect(r.net.calls.filter(c => c.url.endsWith('/Users/Me'))).toHaveLength(1);
    r.clock.t += 6_000;
    await r.handle(get('/nutfin-api/health', bad));
    expect(r.net.calls.filter(c => c.url.endsWith('/Users/Me'))).toHaveLength(2);
  });

  it('the token is sent to Jellyfin and never echoed back', async () => {
    const r = rig();
    const res = await r.handle(get('/nutfin-api/health'));
    expect(JSON.stringify(res)).not.toContain(JF_ADMIN_TOKEN);
  });
});

describe('admin-only routes', () => {
  it('a member gets 403 on plan and execute, before anything is read', async () => {
    const r = rig();
    for (const p of ['/nutfin-api/delete/plan', '/nutfin-api/delete/execute']) {
      const res = await r.handle(post(p, { jellyfinId: 'c'.repeat(32), mode: 'jellyfin-only', confirm: 'x' }, JF_MEMBER_TOKEN));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: 'forbidden' });
    }
    expect(r.net.calls.every(c => c.url.endsWith('/Users/Me'))).toBe(true);
  });
});

describe('routing', () => {
  it('unknown path 404, wrong method 405 with Allow', async () => {
    const r = rig();
    expect((await r.handle(get('/nutfin-api/nope'))).status).toBe(404);
    expect((await r.handle(get('/elsewhere'))).status).toBe(404);
    const res = await r.handle(post('/nutfin-api/health', {}));
    expect(res.status).toBe(405);
    expect(res.headers).toMatchObject({ Allow: 'GET' });
  });
  it('a trailing slash is fine', async () => {
    expect((await rig().handle(get('/nutfin-api/health/'))).status).toBe(200);
  });
});
