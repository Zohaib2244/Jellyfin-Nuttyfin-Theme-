/** Pure parts of the player: time text, segments, trickplay maths, key map, subtitle / audio choices, conversion wording. */
import { describe, expect, it } from 'vitest';
import tp from './fixtures/real-trickplay.json';
import chaptersJson from './fixtures/real-movie-chapters.json';
import undefSubs from './fixtures/real-mediasource-undefined-subs.json';
import extSub from './fixtures/real-mediasource-external-sub.json';
import { normaliseChapters, normaliseTrickplay, normaliseVersion, type BaseItemDto, type MediaSourceDto } from '../src/api/normalise';
import type { MediaItem, MediaSegment } from '../src/api/types';
import { keyAction, percentOf, stepSpeed } from '../src/pages/watch/keys';
import { conversionNote, jellyfinWebUrl, mediaErrorText, startSeconds } from '../src/pages/watch/playback';
import { creditsStart, segmentAt, segmentLeft, skipLabel, skipTarget } from '../src/pages/watch/segments';
import { audioChanged, friendlyLabel, initialAudio, initialSubtitle, modeOf, mustRepackForAudio, subtitleChoices, subtitleSwitch } from '../src/pages/watch/subs';
import { clamp, fmt, leftText, parseTime, spoken } from '../src/pages/watch/timefmt';
import { chapterAt, chapterTicks, tileAt, tileStyle } from '../src/pages/watch/trickplay';

describe('time text', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(fmt(0)).toBe('0:00');
    expect(fmt(75)).toBe('1:15');
    expect(fmt(3725)).toBe('1:02:05');
    expect(fmt(-4)).toBe('0:00');
    expect(fmt(NaN)).toBe('0:00');
    expect(fmt(59.6)).toBe('1:00');
  });
  it('speaks it for screen readers', () => {
    expect(spoken(3725)).toBe('1 hour 2 minutes 5 seconds');
    expect(spoken(60)).toBe('1 minute');
    expect(spoken(0)).toBe('0 seconds');
  });
  it('time left rounds up', () => {
    expect(leftText(61)).toBe('2 min');
    expect(leftText(3600)).toBe('1 h 00 min');
    expect(leftText(0)).toBe('1 min');
  });
  it('parses ?t= values', () => {
    expect(parseTime('754')).toBe(754);
    expect(parseTime('12:34')).toBe(754);
    expect(parseTime('1:02:03')).toBe(3723);
    expect(parseTime('')).toBeNull();
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('-5')).toBeNull();
    expect(clamp(5, 0, 3)).toBe(3);
  });
});

const seg = (type: MediaSegment['type'], start: number, end: number): MediaSegment => ({ id: `${type}${start}`, type, start, end });

describe('skip buttons from media segments', () => {
  const list = [seg('Recap', 0, 40), seg('Intro', 62, 112), seg('Outro', 2500, 2700), seg('Commercial', 900, 960)];
  it('finds the segment under the playhead', () => {
    expect(segmentAt(list, 10)?.type).toBe('Recap');
    expect(segmentAt(list, 70)?.type).toBe('Intro');
    expect(segmentAt(list, 1000)).toBeUndefined(); // commercial breaks are not offered
    expect(segmentAt(list, 45)).toBeUndefined();
  });
  it('the last 2 seconds of a segment do not count', () => {
    expect(segmentAt(list, 110.5)).toBeUndefined();
    expect(segmentAt(list, 109)?.type).toBe('Intro');
  });
  it('labels', () => {
    expect(['Intro', 'Recap', 'Outro', 'Preview'].map(skipLabel)).toEqual(['Skip intro', 'Skip recap', 'Skip credits', 'Skip preview']);
  });
  it('skips to the end of the segment, never past the end of the file', () => {
    expect(skipTarget(list[1] as MediaSegment, 3000)).toBe(112);
    expect(skipTarget(seg('Outro', 2900, 3000), 2999)).toBe(2998.5);
  });
  it('credits start at the Outro marker, else 40 s before the end', () => {
    expect(creditsStart(list, 2760)).toBe(2500);
    expect(creditsStart([], 2760)).toBe(2720);
    expect(creditsStart([seg('Outro', 100, 200)], 2760)).toBe(2720); // an "Outro" near the start is not the credits
  });
  it('countdown line shrinks from 1 to 0', () => {
    const s = seg('Intro', 100, 200);
    expect(segmentLeft(s, 100)).toBe(1);
    expect(segmentLeft(s, 150)).toBe(0.5);
    expect(segmentLeft(s, 300)).toBe(0);
  });
});

describe('trickplay (real recorded info)', () => {
  const dto = tp as unknown as BaseItemDto & { Id: string };
  const info = Object.values(normaliseTrickplay(dto.Trickplay) ?? {})[0];
  it('normalises Jellyfin Trickplay', () => {
    expect(info).toEqual({ width: 320, height: 160, tileWidth: 10, tileHeight: 10, thumbnailCount: 283, intervalMs: 10000 });
  });
  it('picks the sheet, column and row for a time', () => {
    if (!info) throw new Error('no info');
    expect(tileAt(info, 0)).toEqual({ sheet: 0, col: 0, row: 0 });
    expect(tileAt(info, 95)).toEqual({ sheet: 0, col: 9, row: 0 }); // thumbnail 9
    expect(tileAt(info, 105)).toEqual({ sheet: 0, col: 0, row: 1 }); // thumbnail 10
    expect(tileAt(info, 1000)).toEqual({ sheet: 1, col: 0, row: 0 }); // thumbnail 100: second sheet
    expect(tileAt(info, 99999)).toEqual({ sheet: 2, col: 2, row: 8 }); // clamped to the last (282)
    expect(tileAt(info, -5)).toEqual({ sheet: 0, col: 0, row: 0 });
  });
  it('scales a tile for display', () => {
    if (!info) throw new Error('no info');
    const st = tileStyle(info, { sheet: 0, col: 2, row: 1 }, '/x.jpg', 160);
    expect(st.width).toBe('160px');
    expect(st.height).toBe('80px');
    expect(st.backgroundSize).toBe('1600px 800px');
    expect(st.backgroundPosition).toBe('-320px -80px');
  });
  it('prefers the sheet nearest 320 px wide', () => {
    const r = normaliseTrickplay({ a: { 160: { Width: 160, Height: 90, TileWidth: 10, TileHeight: 10, ThumbnailCount: 5, Interval: 1000 }, 480: { Width: 480, Height: 270, TileWidth: 5, TileHeight: 5, ThumbnailCount: 5, Interval: 1000 } } });
    expect(r?.a?.width).toBe(160); // |160-320| = |480-320|: the first (smaller, quicker to load) wins
    expect(normaliseTrickplay(undefined)).toBeUndefined();
  });
});

describe('chapters (real recorded movie)', () => {
  const chapters = normaliseChapters((chaptersJson as unknown as BaseItemDto).Chapters);
  it('knows the chapter at a time and where the ticks go', () => {
    expect(chapters.length).toBe(20);
    expect(chapterAt(chapters, 0)).toBe(0);
    expect(chapterAt(chapters, 600)).toBe(1); // chapter 2 starts at 9:22
    expect(chapterAt(chapters, 99999)).toBe(19);
    const dur = ((chaptersJson as { RunTimeTicks: number }).RunTimeTicks) / 1e7;
    const ticks = chapterTicks(chapters, dur);
    expect(ticks.length).toBe(19); // the first chapter (0:00) gets no tick
    expect(ticks.every(f => f > 0 && f < 1)).toBe(true);
    expect(chapterTicks(chapters, 0)).toEqual([]);
  });
});

describe('keyboard map', () => {
  it('the basics', () => {
    expect(keyAction({ key: ' ' })).toBe('toggle');
    expect(keyAction({ key: 'k' })).toBe('toggle');
    expect(keyAction({ key: 'ArrowLeft' })).toBe('back10');
    expect(keyAction({ key: 'J' })).toBe('back10');
    expect(keyAction({ key: 'l' })).toBe('fwd10');
    expect(keyAction({ key: 'f' })).toBe('fullscreen');
    expect(keyAction({ key: 'm' })).toBe('mute');
    expect(keyAction({ key: 'c' })).toBe('subtitles');
    expect(keyAction({ key: 'ArrowUp' })).toBe('volUp');
    expect(keyAction({ key: 'N', shift: true })).toBe('next');
    expect(keyAction({ key: 'n' })).toBeNull();
  });
  it('digits jump to percentages', () => {
    const a = keyAction({ key: '4' });
    expect(a).toBe('percent40');
    expect(a && percentOf(a)).toBe(40);
    expect(keyAction({ key: '0' })).toBe('percent0');
    expect(percentOf('toggle')).toBeNull();
  });
  it('leaves keys alone that a focused control or the browser wants', () => {
    expect(keyAction({ key: ' ', onControl: true })).toBeNull();
    expect(keyAction({ key: 'Enter', onControl: true })).toBeNull();
    expect(keyAction({ key: 'ArrowLeft', onSlider: true })).toBeNull();
    expect(keyAction({ key: 'f', ctrl: true })).toBeNull();
    expect(keyAction({ key: 'f', sheetOpen: true })).toBeNull();
    expect(keyAction({ key: 'Escape', sheetOpen: true })).toBe('escape');
  });
  it('steps speed along the list and stops at the ends', () => {
    expect(stepSpeed(1, 1)).toBe(1.25);
    expect(stepSpeed(1, -1)).toBe(0.75);
    expect(stepSpeed(2, 1)).toBe(2);
    expect(stepSpeed(0.5, -1)).toBe(0.5);
    expect(stepSpeed(1.1, 1)).toBe(1.5);
  });
});

describe('track and subtitle choices (real recorded sources)', () => {
  const lanterns = normaliseVersion(undefSubs as MediaSourceDto);
  const odyssey = normaliseVersion(extSub as MediaSourceDto);
  it('starts with the file default sound, and honours a link', () => {
    expect(initialAudio(lanterns, undefined, undefined)).toBe(1);
    expect(initialAudio(lanterns, 99, 1)).toBe(1); // unknown index in the link: ignored
    expect(initialAudio(odyssey, undefined, undefined)).toBe(2);
  });
  it('subtitles start off unless the link names a real one', () => {
    expect(initialSubtitle(lanterns, undefined)).toBe(-1);
    expect(initialSubtitle(lanterns, 3)).toBe(3);
    expect(initialSubtitle(lanterns, 99)).toBe(-1);
    expect(initialSubtitle(lanterns, -1)).toBe(-1);
  });
  it('text subtitles are swapped in place', () => {
    expect(subtitleSwitch(lanterns, -1, 2, false)).toBe('track');
    expect(subtitleSwitch(lanterns, 2, -1, false)).toBe('track');
    expect(subtitleSwitch(lanterns, 2, 2, false)).toBe('none');
  });
  it('picture subtitles need a new session, and so does leaving a burned-in one', () => {
    const pgs = { ...lanterns, subtitles: [...lanterns.subtitles, { index: 50, label: 'English - PGS', isDefault: false, isForced: false, isExternal: false, isText: false, codec: 'pgssub' }] };
    expect(modeOf(pgs.subtitles[pgs.subtitles.length - 1] as never)).toBe('burn');
    expect(subtitleSwitch(pgs, -1, 50, false)).toBe('reload');
    expect(subtitleSwitch(pgs, 50, -1, true)).toBe('reload');
    expect(subtitleSwitch(pgs, 50, 2, true)).toBe('reload');
  });
  it('lists forced and default tracks first', () => {
    const v = { ...lanterns, subtitles: [{ ...(lanterns.subtitles[3] as object), index: 9, isForced: true }, ...lanterns.subtitles] } as typeof lanterns;
    const order = subtitleChoices(v).map(s => s.index);
    expect(order[0]).toBe(9);
    expect(order[1]).toBe(2); // the default one
  });
  it('a different soundtrack needs a new session, and a repack when it is not the file start', () => {
    expect(audioChanged(1, 3)).toBe(true);
    expect(audioChanged(1, 1)).toBe(false);
    const two = { ...lanterns, audio: [...lanterns.audio, { index: 5, label: 'Spanish', isDefault: false }] };
    expect(mustRepackForAudio(two, 5, undefined)).toBe(true);
    expect(mustRepackForAudio(two, 1, undefined)).toBe(false);
    expect(mustRepackForAudio(lanterns, 1, undefined)).toBe(false); // one soundtrack: nothing to choose
  });
});

describe('menu labels', () => {
  it('drops file formats nobody needs to see', () => {
    expect(friendlyLabel('English - SUBRIP - External')).toBe('English · External');
    expect(friendlyLabel('French - PGSSUB')).toBe('French');
    expect(friendlyLabel('Dolby Digital+ - 5.1 - Default')).toBe('Dolby Digital+ · 5.1 · Default');
    expect(friendlyLabel('SUBRIP')).toBe('SUBRIP'); // never ends up empty
  });
});

describe('plain-language wording', () => {
  const base = { method: 'transcode' as const, subtitleBurnedIn: false };
  it('says nothing when the file plays as it is', () => {
    expect(conversionNote({ method: 'direct', transcodeReasons: [] })).toBeNull();
  });
  it('one friendly line per cause', () => {
    expect(conversionNote({ ...base, transcodeReasons: ['VideoCodecNotSupported', 'AudioCodecNotSupported'] })).toBe('Converting for this browser');
    expect(conversionNote({ ...base, transcodeReasons: ['AudioCodecNotSupported'] })).toBe('Converting the sound for this browser');
    expect(conversionNote({ ...base, transcodeReasons: ['ContainerNotSupported'] })).toBe('Repacking for this browser');
    expect(conversionNote({ ...base, transcodeReasons: ['ContainerBitrateExceedsLimit'] })).toBe('Lowering the quality to fit your connection');
    expect(conversionNote({ ...base, transcodeReasons: [] })).toBe('Converting for this browser');
    expect(conversionNote({ method: 'directStream', transcodeReasons: ['AudioCodecNotSupported'], subtitleBurnedIn: true })).toBe('Adding subtitles to the picture');
  });
  it('turns <video> error codes into sentences', () => {
    expect(mediaErrorText(4)).toMatch(/cannot play this file/);
    expect(mediaErrorText(undefined)).toMatch(/Something went wrong/);
  });
  it('"Open in Jellyfin" points at the server on port 8096', () => {
    expect(jellyfinWebUrl('abc', { protocol: 'http:', hostname: '192.168.1.24' })).toBe('http://192.168.1.24:8096/web/#/details?id=abc');
  });
});

describe('where to start', () => {
  const item = (p?: { positionTicks: number; percent: number }): MediaItem => ({ id: 'x', kind: 'movie', name: 'X', imageTags: {}, backdropCount: 0, played: false, favourite: false, runtimeMin: 100, genres: [], is4k: false, studios: [], progress: p ? { ...p, remainingMin: 1 } : undefined });
  it('the link wins, then the saved position', () => {
    expect(startSeconds(120, item({ positionTicks: 5e9, percent: 50 }))).toBe(120);
    expect(startSeconds(null, item({ positionTicks: 5e9, percent: 50 }))).toBe(500);
    expect(startSeconds(null, item())).toBe(0);
  });
  it('a position within the first 10 s or the last 3 % starts from the top', () => {
    expect(startSeconds(null, item({ positionTicks: 5e7, percent: 1 }))).toBe(0);
    expect(startSeconds(null, item({ positionTicks: 59e9, percent: 98 }))).toBe(0);
  });
});

describe('item that cannot be read before playing', () => {
  it('a missing or malformed id is "not found", not a connection problem', async () => {
    const { itemLoadFailure } = await import('../src/pages/watch/playback');
    const { ApiError } = await import('../src/api/http');
    expect(itemLoadFailure(new ApiError(404, 'not-found', 'x'))).toMatchObject({ missing: true });
    expect(itemLoadFailure(new ApiError(400, 'client', 'x'))).toMatchObject({ missing: true });
    expect(itemLoadFailure(new ApiError(502, 'server', 'x')).missing).toBe(false);
    expect(itemLoadFailure(new ApiError(0, 'network', 'x')).why).toMatch(/reach the server/);
    expect(itemLoadFailure(new Error('boom')).missing).toBe(false);
  });
});
