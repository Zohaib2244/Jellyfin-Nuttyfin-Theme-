import { describe, expect, it } from 'vitest';
import type { DeletePlan } from '../src/api/desk-types';
import { calendarToEpisodes } from '../src/pages/home/calendar';
import { fmtBytes, freedSentence, freesTag, modeOf, outcomeText, plainText, showsNoSpace } from '../src/pages/details/removeModel';

const GB = 1024 ** 3;
const plan = (o: Partial<DeletePlan> = {}): DeletePlan => ({
  jellyfinId: 'x', title: 'Dune', kind: 'movie', arr: { app: 'radarr', id: 1, title: 'Dune', path: '/m' }, files: { count: 1, bytes: 8 * GB },
  torrents: [{ hash: 'h', name: 'n', state: 'stalledUP', seeding: true, ratio: 1, sizeBytes: 8 * GB, sharedFiles: 1 }], hardlinked: true, measured: true, deleteEnabled: true, notes: [],
  modes: {
    'jellyfin-only': { freedBytes: 0, keptBytes: 8 * GB, steps: [] }, 'arr-and-files': { freedBytes: 0, keptBytes: 8 * GB, steps: [] },
    'arr-and-files-and-torrent': { freedBytes: 8 * GB, keptBytes: 0, steps: [] },
  }, ...o,
});

describe('byte wording', () => {
  it('reads like a person would say it', () => {
    expect(fmtBytes(0)).toBe('0 GB');
    expect(fmtBytes(300 * 1024)).toBe('300 KB');
    expect(fmtBytes(850 * 1024 ** 2)).toBe('850 MB');
    expect(fmtBytes(6.44 * GB)).toBe('6.4 GB');
    expect(fmtBytes(8 * GB)).toBe('8 GB');
    expect(fmtBytes(38 * GB)).toBe('38 GB');
    expect(fmtBytes(1.25 * 1024 ** 4)).toBe('1.3 TB');
  });
});

describe('choices to modes', () => {
  it('maps the radio and the toggle', () => {
    expect(modeOf({ arr: false, torrent: true })).toBe('jellyfin-only'); // the toggle only counts with the Radarr/Sonarr choice
    expect(modeOf({ arr: true, torrent: false })).toBe('arr-and-files');
    expect(modeOf({ arr: true, torrent: true })).toBe('arr-and-files-and-torrent');
  });
});

describe('the space sentence', () => {
  it('seeding torrent: says exactly why nothing comes back', () => {
    expect(freedSentence(plan(), 'jellyfin-only')).toBe('Frees 0 GB because the downloaded copy is still being shared and keeps the file.');
    expect(freedSentence(plan(), 'arr-and-files')).toMatch(/still being shared/);
  });
  it('removing the torrent too gives it back', () => {
    expect(freedSentence(plan(), 'arr-and-files-and-torrent')).toBe('About 8 GB comes back on the drive.');
    expect(freesTag(plan(), 'arr-and-files-and-torrent')).toBe('frees 8 GB');
    expect(freesTag(plan(), 'jellyfin-only')).toBe('frees 0 GB');
  });
  it('finished torrent, no torrent, extra copy, unmeasured', () => {
    expect(freedSentence(plan({ torrents: [{ hash: 'h', name: 'n', state: 'pausedUP', seeding: false, ratio: 1, sizeBytes: 1, sharedFiles: 1 }] }), 'jellyfin-only')).toMatch(/finished download still keeps/);
    const free = plan({ torrents: [], modes: { ...plan().modes, 'jellyfin-only': { freedBytes: 6.4 * GB, keptBytes: 0, steps: [] } } });
    expect(freedSentence(free, 'jellyfin-only')).toBe('About 6.4 GB comes back on the drive.');
    expect(freedSentence(plan({ torrents: [], modes: { ...plan().modes, 'jellyfin-only': { freedBytes: 0, keptBytes: GB, steps: [] } } }), 'jellyfin-only')).toMatch(/another copy/);
    expect(freedSentence(plan({ measured: false }), 'jellyfin-only')).toMatch(/could not measure/);
    expect(freesTag(plan({ measured: false }), 'jellyfin-only')).toBe('');
    expect(freedSentence(plan({ modes: { ...plan().modes, 'arr-and-files-and-torrent': { freedBytes: 5 * GB, keptBytes: 2 * GB, steps: [] } } }), 'arr-and-files-and-torrent')).toMatch(/5 GB comes back.*2 GB stays/);
  });
  it('leftover extras do not count as space: "frees almost nothing"', () => {
    const real = plan({ modes: { ...plan().modes, 'jellyfin-only': { freedBytes: 11 * 1024 ** 2, keptBytes: 2.4 * GB, steps: [] } } });
    expect(freedSentence(real, 'jellyfin-only')).toBe('Frees almost nothing because the downloaded copy is still being shared and keeps the file.');
    expect(freesTag(real, 'jellyfin-only')).toBe('frees almost nothing');
    expect(showsNoSpace(real, 'jellyfin-only')).toBe(true);
  });
  it('flags the no-space case', () => {
    expect(showsNoSpace(plan(), 'jellyfin-only')).toBe(true);
    expect(showsNoSpace(plan(), 'arr-and-files-and-torrent')).toBe(false);
  });
});

describe('outcome wording', () => {
  it('failed step and what was not run', () => {
    const o = outcomeText({ ok: false, steps: [{ label: 'Remove the torrent', status: 'done' }, { label: 'Remove it from Radarr', status: 'failed', detail: 'Radarr did not answer' }, { label: 'Delete it in Jellyfin', status: 'skipped' }] });
    expect(o.title).toBe('It stopped part-way');
    expect(o.detail).toBe('"Remove it from Radarr" did not work (Radarr did not answer). The step after it was not run.');
    expect(outcomeText({ ok: true, steps: [] }).title).toBe('Done');
  });
});

describe('calendar to episodes (On TV tile)', () => {
  it('maps helper entries, keeps shows that are not in the library, skips films', () => {
    const eps = calendarToEpisodes([
      { kind: 'episode', airs: '2026-11-18T21:00:00Z', title: 'Silo', subtitle: 'Order', season: 2, episode: 5, jellyfin: { seriesId: 'S1', episodeId: 'E1' }, inLibrary: true, downloaded: true },
      { kind: 'episode', airs: '2026-11-19T21:00:00Z', title: 'Slow Horses', season: 5, episode: 1, jellyfin: { seriesId: 'S2' }, inLibrary: false, downloaded: false },
      { kind: 'episode', airs: '2026-11-20T21:00:00Z', title: 'Pluribus', season: 1, episode: 6, inLibrary: false, downloaded: false },
      { kind: 'movie', airs: '2026-11-20T00:00:00Z', title: 'Dune 3', inLibrary: false, downloaded: false },
    ]);
    expect(eps.map(e => e.seriesName)).toEqual(['Silo', 'Slow Horses', 'Pluribus']);
    expect(eps[0]).toMatchObject({ id: 'E1', seriesId: 'S1', missing: false, premiered: '2026-11-18T21:00:00Z', imageTags: { primary: 'cal' } });
    expect(eps[1]).toMatchObject({ seriesId: 'S2', missing: true, imageTags: {} });
    expect(eps[1]?.seriesImageTags.backdrop).toBeDefined();
    expect(eps[2]).toMatchObject({ seriesId: '', missing: true, seriesImageTags: {} });
    expect(new Set(eps.map(e => e.id)).size).toBe(3);
  });
});

describe('plain words for members and the owner', () => {
  it('app names become "the downloader"', () => {
    expect(plainText('Remove it from Radarr')).toBe('Remove it from the downloader');
    expect(plainText('Remove the torrent from qBittorrent')).toBe('Remove the download from the downloader');
    expect(plainText('Sonarr and qBittorrent did not answer')).toBe('the downloader and the downloader did not answer'.replace('the downloader and the downloader', 'the downloader'));
    expect(plainText('2 torrents share these files')).toBe('2 downloads share these files');
  });
});
