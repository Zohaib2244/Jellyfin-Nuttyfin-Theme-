import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeerrClient } from '../src/api/seerr';
import { limitConcurrency } from '../src/lib/concurrency';

const user = { id: 'u', name: 'Sam', isAdmin: true };
function server() {
  const paths: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = new URL(url, 'http://localhost').pathname;
    paths.push(path);
    const body = path.endsWith('/auth/me') ? { id: 1, permissions: 2 }
      : path.endsWith('/request') ? { pageInfo: { results: 2 }, results: [
        { id: 1, type: 'movie', status: 1, media: { tmdbId: 10 } },
        { id: 2, type: 'movie', status: 2, media: { tmdbId: 10 } },
      ] } : { title: 'Movie', posterPath: '/poster.jpg' };
    return new Response(JSON.stringify(body), { status: 200 });
  }));
  return paths;
}
afterEach(() => vi.unstubAllGlobals());

describe('Seerr metadata traffic', () => {
  it('gets request states for the badge without fetching title metadata', async () => {
    const paths = server();
    const client = new SeerrClient(() => user);
    const rows = await client.requests({ mine: true, includeTitles: false });
    expect(rows.map(r => r.state)).toEqual(['requested', 'approved']);
    expect(paths.filter(p => /\/movie\//.test(p))).toHaveLength(0);
  });

  it('shares concurrent title lookups across Home and the Requests page; reset forgets them', async () => {
    const paths = server();
    const client = new SeerrClient(() => user);
    const [home, desk] = await Promise.all([
      client.requests({ mine: true }),
      client.requestsPage({ scope: 'all', filter: 'all', take: 20, skip: 0 }),
    ]);
    expect(home[0]?.title).toBe('Movie');
    expect(desk.items[0]?.title).toBe('Movie');
    expect(paths.filter(p => p.endsWith('/movie/10'))).toHaveLength(1);
    client.reset();
    await client.requests();
    expect(paths.filter(p => p.endsWith('/movie/10'))).toHaveLength(2);
  });
});

describe('metadata concurrency', () => {
  it('caps work and releases slots after errors and synchronous exceptions', async () => {
    const limit = limitConcurrency(2);
    let active = 0, peak = 0;
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => limit(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      if (i === 1) throw new Error('metadata unavailable');
      return i;
    })));
    expect(peak).toBe(2);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(7);
    await expect(limit(() => { throw new Error('sync'); })).rejects.toThrow('sync');
    await expect(limit(async () => 'next')).resolves.toBe('next');
  });
});
