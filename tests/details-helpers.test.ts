import { describe, expect, it } from 'vitest';
import type { AudioTrack, Episode, MediaVersion } from '../src/api/types';
import { ticksToSeconds, watchPath } from '../src/pages/common/watch';
import { assess, bestVersion, defaultAudio, defaultSubtitle, type CanPlay } from '../src/pages/details/playability';
import { groupSeasons, guestStars, pickTarget, validPrefs } from '../src/pages/details/target';
import { externalLinks, pickTrailer, youtubeId } from '../src/pages/details/trailer';

const aud = (o: Partial<AudioTrack> = {}): AudioTrack => ({ index: 1, language: 'eng', codec: 'aac', channels: 2, label: 'English', isDefault: true, ...o });
const ver = (o: Partial<MediaVersion> = {}): MediaVersion => ({
  id: 'v', name: '1080p', container: 'mp4', width: 1920, height: 1080, is4k: false, videoCodec: 'h264', audio: [aud()], subtitles: [], ...o,
});
/** a browser like headless Chrome without HEVC: H.264/AAC/VP9 yes, HEVC/AC-3 no */
const chromeish: CanPlay = m => !/hvc1|ac-3|ec-3/.test(m);
const hevcOk: CanPlay = () => true;

describe('assess (will it play here?)', () => {
  it('H.264 + AAC in MP4 plays directly', () => {
    expect(assess(ver(), aud(), chromeish)).toMatchObject({ level: 'direct', badge: 'Plays perfectly here', tone: 'ok' });
  });
  it('MKV or AC-3 sound is only repacked: "Will be converted", no stutter warning', () => {
    const mkv = assess(ver({ container: 'mkv' }), aud(), chromeish);
    expect(mkv).toMatchObject({ level: 'convert', badge: 'Will be converted', mayStutter: false });
    const ac3 = assess(ver(), aud({ codec: 'ac3' }), chromeish);
    expect(ac3.level).toBe('convert');
    expect(ac3.why).toContain('sound');
  });
  it('HEVC the browser cannot decode is flagged "may stutter" (the server has no HEVC hardware)', () => {
    const a = assess(ver({ videoCodec: 'hevc', container: 'mkv' }), aud(), chromeish);
    expect(a).toMatchObject({ level: 'heavy', mayStutter: true, tone: 'warn' });
    expect(a.badge).toBe('Will be converted, may stutter');
  });
  it('the same HEVC file plays directly where the browser can decode it', () => {
    expect(assess(ver({ videoCodec: 'hevc' }), aud(), hevcOk).level).toBe('direct');
  });
  it('4K that must be re-encoded may stutter even when it is not HEVC', () => {
    const a = assess(ver({ videoCodec: 'vc1', width: 3840, height: 2160, is4k: true }), aud(), chromeish);
    expect(a.mayStutter).toBe(true);
  });
  it('an old 1080p codec is converted without a warning', () => {
    const a = assess(ver({ videoCodec: 'mpeg4' }), aud(), chromeish);
    expect(a).toMatchObject({ level: 'heavy', badge: 'Needs conversion', mayStutter: false });
  });
  it('no file at all', () => {
    expect(assess(undefined, undefined, chromeish).level).toBe('none');
  });
});

describe('default choices', () => {
  it('prefers the version that plays best here (HD over 4K HEVC on Chrome)', () => {
    const k4 = ver({ id: '4k', videoCodec: 'hevc', width: 3840, height: 2160, is4k: true });
    const hd = ver({ id: 'hd' });
    expect(bestVersion([k4, hd], defaultAudio, chromeish)?.id).toBe('hd');
    expect(bestVersion([k4, hd], defaultAudio, hevcOk)?.id).toBe('4k'); // a tie keeps the server's order
  });
  it('sound: the default flag, else the first', () => {
    expect(defaultAudio(ver({ audio: [aud({ index: 1, isDefault: false }), aud({ index: 2, isDefault: true })] }))?.index).toBe(2);
    expect(defaultAudio(ver({ audio: [aud({ index: 5, isDefault: false })] }))?.index).toBe(5);
  });
  it('subtitles: off unless a forced track matches the sound, or the file flags one', () => {
    const sub = (o: object) => ({ index: 9, language: 'eng', label: 's', isDefault: false, isForced: false, isExternal: false, ...o });
    expect(defaultSubtitle(ver({ subtitles: [sub({})] }), aud())).toBe(-1);
    expect(defaultSubtitle(ver({ subtitles: [sub({ index: 4, isForced: true })] }), aud())).toBe(4);
    expect(defaultSubtitle(ver({ subtitles: [sub({ index: 4, isForced: true, language: 'spa' })] }), aud())).toBe(-1);
    expect(defaultSubtitle(ver({ subtitles: [sub({ index: 7, isDefault: true })] }), aud())).toBe(7);
  });
  it('remembered picks are dropped when the file changed under them', () => {
    const v = ver({ audio: [aud({ index: 1 })], subtitles: [] });
    expect(validPrefs({ ver: 'v', audio: 1, sub: -1 }, [v])).toEqual({ ver: 'v', audio: 1, sub: -1 });
    expect(validPrefs({ ver: 'v', audio: 3, sub: -1 }, [v])).toBeUndefined();
    expect(validPrefs({ ver: 'v', audio: 1, sub: 8 }, [v])).toBeUndefined();
  });
});

const ep = (season: number, episode: number, o: Partial<Episode> = {}): Episode => ({
  kind: 'episode', id: `e${season}-${episode}`, name: `E${episode}`, imageTags: {}, backdropCount: 0, played: false, favourite: false, runtimeMin: 40,
  seriesId: 's', seriesName: 'S', season, episode, missing: false, seriesImageTags: {}, ...o,
});

describe('series helpers', () => {
  it('Play goes to the partly watched episode', () => {
    const eps = [ep(1, 1, { played: true }), ep(1, 2, { progress: { positionTicks: 1, percent: 30, remainingMin: 20 } }), ep(1, 3)];
    expect(pickTarget(eps)?.id).toBe('e1-2');
  });
  it('else the first unwatched after the last watched', () => {
    expect(pickTarget([ep(1, 1, { played: true }), ep(1, 2), ep(1, 3, { played: true }), ep(1, 4)])?.id).toBe('e1-4');
  });
  it('else the very first (nothing watched, or everything watched)', () => {
    expect(pickTarget([ep(1, 1), ep(1, 2)])?.id).toBe('e1-1');
    expect(pickTarget([ep(1, 1, { played: true }), ep(1, 2, { played: true })])?.id).toBe('e1-1');
  });
  it('skips specials and missing episodes', () => {
    expect(pickTarget([ep(0, 1), ep(1, 1, { missing: true }), ep(1, 2)])?.id).toBe('e1-2');
  });
  it('groups seasons in order with watched counts', () => {
    const g = groupSeasons([ep(2, 1), ep(1, 2, { played: true }), ep(1, 1, { played: true })]);
    expect(g.map(x => [x.number, x.eps.length, x.watched])).toEqual([[1, 2, 2], [2, 1, 0]]);
    expect(g[0]?.eps.map(e => e.episode)).toEqual([1, 2]);
  });
  it('collects guest stars once, with their episodes', () => {
    const star = { id: 'p', name: 'Ann', type: 'GuestStar', role: 'Nurse' };
    const g = guestStars([ep(1, 1, { people: [star, { id: 'a', name: 'Lead', type: 'Actor' }] }), ep(1, 3, { people: [star] })]);
    expect(g).toHaveLength(1);
    expect(g[0]?.episodes).toEqual([1, 3]);
  });
});

describe('trailers and links', () => {
  it('finds YouTube ids in the usual shapes', () => {
    for (const u of ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'https://youtu.be/aqz-KE-bpKQ?t=3', 'https://youtube.com/embed/aqz-KE-bpKQ', 'https://m.youtube.com/shorts/aqz-KE-bpKQ']) {
      expect(youtubeId(u)).toBe('aqz-KE-bpKQ');
    }
    expect(youtubeId('https://vimeo.com/123')).toBeNull();
    expect(youtubeId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(youtubeId('not a url')).toBeNull();
  });
  it('offers an embed for YouTube, an outside link for others, nothing for none', () => {
    expect(pickTrailer(undefined)).toBeNull();
    expect(pickTrailer([])).toBeNull();
    expect(pickTrailer([{ url: 'https://vimeo.com/1' }, { url: 'https://youtu.be/aqz-KE-bpKQ' }])?.id).toBe('aqz-KE-bpKQ');
    expect(pickTrailer([{ url: 'https://vimeo.com/1' }])).toMatchObject({ id: null, url: 'https://vimeo.com/1' });
    expect(pickTrailer([{ url: 'javascript:alert(1)' }])).toBeNull();
  });
  it('builds IMDb / TMDB links only from sane ids', () => {
    expect(externalLinks({ Imdb: 'tt123', Tmdb: '42' }, 'movie').map(l => l.url)).toEqual(['https://www.imdb.com/title/tt123/', 'https://www.themoviedb.org/movie/42']);
    expect(externalLinks({ Tmdb: '42' }, 'series')[0]?.url).toBe('https://www.themoviedb.org/tv/42');
    expect(externalLinks({ Imdb: '"><script>', Tmdb: 'x' }, 'movie')).toEqual([]);
    expect(externalLinks(undefined, 'movie')).toEqual([]);
  });
});

describe('watchPath (links into the player)', () => {
  it('only includes what was chosen', () => {
    expect(watchPath('abc')).toBe('/watch/abc');
    expect(watchPath('abc', { seconds: 125.9 })).toBe('/watch/abc?t=125');
    expect(watchPath('abc', { seconds: 0 })).toBe('/watch/abc');
    expect(watchPath('abc', { seconds: 60, audio: 2, sub: -1, version: 'm1' })).toBe('/watch/abc?t=60&audio=2&sub=-1&version=m1');
  });
  it('converts ticks', () => {
    expect(ticksToSeconds(20_000_000_000)).toBe(2000);
  });
});
