import { describe, expect, it } from 'vitest';
import { get, JF_MEMBER_TOKEN, rig, type Rig } from './harness.ts';

const SERIES_JF = 's'.repeat(32);
const EP_JF = 'e'.repeat(32);

function withLibrary(r: Rig): void {
  r.net.on(c => {
    if (c.url.startsWith('http://sonarr/api/v3/calendar')) {
      return { body: [
        { seriesId: 1, title: 'Strange Bedfellows', seasonNumber: 5, episodeNumber: 1, airDateUtc: '2026-11-18T21:00:00Z', hasFile: false, overview: 'Back on the clock.', series: { title: 'Slow Horses', tvdbId: 111 } },
        { seriesId: 2, title: 'Order', seasonNumber: 2, episodeNumber: 5, airDateUtc: '2026-11-16T18:00:00Z', hasFile: true, series: { title: 'Silo', tvdbId: 222 } },
        { seriesId: 3, title: 'No date', seasonNumber: 1, episodeNumber: 1, series: { title: 'Ghost' } },
      ] };
    }
    if (c.url.startsWith('http://radarr/api/v3/calendar')) return { body: [{ title: 'Dune 3', tmdbId: 555, digitalRelease: '2026-11-20T00:00:00Z', hasFile: false }] };
    if (c.url.includes('/Items?') && c.url.includes('includeItemTypes=Series')) return { body: { Items: [{ Id: SERIES_JF, Name: 'Silo', ProviderIds: { Tvdb: '222' } }] } };
    if (c.url.includes('/Items?') && c.url.includes('includeItemTypes=Movie')) return { body: { Items: [] } };
    if (c.url.includes('/Items?') && c.url.includes('includeItemTypes=Episode')) return { body: { Items: [{ Id: EP_JF, ParentIndexNumber: 2, IndexNumber: 5 }] } };
    return undefined;
  });
}

describe('GET /calendar', () => {
  it('joins Sonarr episodes to the Jellyfin library and normalises them', async () => {
    const r = rig();
    withLibrary(r);
    const res = await r.handle(get('/nutfin-api/calendar', JF_MEMBER_TOKEN, 'days=7'));
    expect(res.status).toBe(200);
    const body = res.body as { days: number; entries: Array<Record<string, unknown>> };
    expect(body.days).toBe(7);
    expect(body.entries.map(e => e['title'])).toEqual(['Silo', 'Slow Horses']); // sorted by air time; the undated one is dropped
    expect(body.entries[0]).toMatchObject({ kind: 'episode', season: 2, episode: 5, subtitle: 'Order', inLibrary: true, downloaded: true, jellyfin: { seriesId: SERIES_JF, episodeId: EP_JF } });
    expect(body.entries[1]).toMatchObject({ title: 'Slow Horses', inLibrary: false, downloaded: false, overview: 'Back on the clock.' });
    expect(body.entries[1]?.['jellyfin']).toBeUndefined();
  });

  it('asks Sonarr for the right window, with its key, and Jellyfin with the caller token', async () => {
    const r = rig();
    withLibrary(r);
    await r.handle(get('/nutfin-api/calendar', JF_MEMBER_TOKEN, 'days=3'));
    const s = r.net.calls.find(c => c.url.startsWith('http://sonarr/api/v3/calendar'));
    expect(s?.headers['x-api-key']).toBe('sk');
    expect(s?.url).toMatch(/start=\d{4}-\d{2}-\d{2}&end=\d{4}-\d{2}-\d{2}&includeSeries=true/);
    const jf = r.net.calls.find(c => c.url.includes('/Items?'));
    expect(jf?.headers['x-emby-token']).toBe(JF_MEMBER_TOKEN);
    expect(jf?.url).toContain(`userId=${'b'.repeat(32)}`);
  });

  it('days is clamped to 1..31', async () => {
    const r = rig();
    withLibrary(r);
    expect(((await r.handle(get('/nutfin-api/calendar', JF_MEMBER_TOKEN, 'days=900'))).body as { days: number }).days).toBe(31);
    expect(((await r.handle(get('/nutfin-api/calendar', JF_MEMBER_TOKEN, 'days=abc'))).body as { days: number }).days).toBe(7);
  });

  it('adds film releases only when asked', async () => {
    const r = rig();
    withLibrary(r);
    const plain = (await r.handle(get('/nutfin-api/calendar', JF_MEMBER_TOKEN))).body as { entries: Array<{ kind: string }> };
    expect(plain.entries.some(e => e.kind === 'movie')).toBe(false);
    const withFilms = (await r.handle(get('/nutfin-api/calendar', JF_MEMBER_TOKEN, 'movies=1'))).body as { entries: Array<{ kind: string; title: string; subtitle?: string }> };
    expect(withFilms.entries.find(e => e.kind === 'movie')).toMatchObject({ title: 'Dune 3', subtitle: 'Digital release' });
  });

  it('Sonarr down: 502, so the SPA falls back to Jellyfin\'s own list', async () => {
    const r = rig();
    r.net.on(c => (c.url.startsWith('http://sonarr') ? { status: 500 } : undefined));
    withLibrary(r);
    r.net.on(c => (c.url.startsWith('http://sonarr') ? { status: 500 } : undefined));
    expect((await r.handle(get('/nutfin-api/calendar', JF_MEMBER_TOKEN))).status).toBe(502);
  });

  it('never makes a write call', async () => {
    const r = rig();
    withLibrary(r);
    await r.handle(get('/nutfin-api/calendar', JF_MEMBER_TOKEN, 'movies=1'));
    expect(r.net.writes).toEqual([]);
  });
});
