import { describe, expect, it, vi } from 'vitest';
import { DemoBackend } from '../src/api/demo';
import { HomeData } from '../src/pages/home/data';
import type { Episode } from '../src/api/types';

describe('Home episode loading', () => {
  it('shares a season lookup between tiles and retries after a failure', async () => {
    const backend = new DemoBackend();
    backend.episodes = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    const data = new HomeData(backend);
    const first = data.episodes('series', 'season');
    const shared = data.episodes('series', 'season');
    expect(shared).toBe(first);
    await expect(first).rejects.toThrow('offline');
    await expect(data.episodes('series', 'season')).resolves.toEqual([]);
    expect(backend.episodes).toHaveBeenCalledTimes(2);
  });

  it('limits different season lookups to two at a time', async () => {
    const backend = new DemoBackend();
    let active = 0, peak = 0;
    backend.episodes = async (): Promise<Episode[]> => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--; return [];
    };
    const data = new HomeData(backend);
    await Promise.all(Array.from({ length: 8 }, (_, i) => data.episodes(`series-${i}`, 'season')));
    expect(peak).toBe(2);
    expect(active).toBe(0);
  });
});
