/** Recorded real PlaybackInfo answers (Jellyfin 12.3) to the profile this player builds for headless Chromium. */
import { describe, expect, it } from 'vitest';
import direct from './fixtures/real-playbackinfo-direct.json';
import hls from './fixtures/real-playbackinfo-hls.json';
import { directUrl, interpretPlayback, normaliseSegments, subtitleVttUrl, transcodeReasonsOf, trickplayUrl, type PlaybackInfoResult } from '../src/api/playback';
import { conversionNote, playMethodOf } from '../src/pages/watch/playback';

const D = direct.response as unknown as PlaybackInfoResult;
const H = hls.response as unknown as PlaybackInfoResult;

describe('PlaybackInfo: a file the browser plays as it is (mkv, H.264 + AAC)', () => {
  const src = D.MediaSources?.[0] as NonNullable<PlaybackInfoResult['MediaSources']>[number];
  const info = interpretPlayback('ep1', D, src, 'TOKEN', { audioIndex: 1, subtitleIndex: -1 });
  it('direct play, with the token in the URL (a <video> cannot send headers)', () => {
    expect(info.method).toBe('direct');
    expect(info.isHls).toBe(false);
    expect(info.url).toBe(directUrl('ep1', src.Id as string, 'TOKEN', src.ETag));
    expect(info.url).toContain('/jf/Videos/ep1/stream?static=true&mediaSourceId=');
    expect(info.url).toContain('api_key=TOKEN');
    expect(info.transcodeReasons).toEqual([]);
    expect(playMethodOf(info)).toBe('DirectPlay');
    expect(conversionNote(info)).toBeNull();
  });
  it('keeps the session id and the tracks', () => {
    expect(info.playSessionId).toBeTruthy();
    expect(info.audioStreamIndex).toBe(1);
    expect(info.subtitleStreamIndex).toBe(-1);
    expect(info.versions?.length).toBe(1);
    expect(info.version.audio.length).toBeGreaterThan(0);
  });
});

describe('PlaybackInfo: H.264 + E-AC-3 (sound must be converted for Chrome)', () => {
  const src = H.MediaSources?.[0] as NonNullable<PlaybackInfoResult['MediaSources']>[number];
  const info = interpretPlayback('ep2', H, src, 'TOKEN', { audioIndex: 1 });
  it('is an HLS stream on the server, not a direct play', () => {
    expect(src.SupportsDirectPlay).toBe(false);
    expect(info.method).toBe('transcode');
    expect(info.isHls).toBe(true);
    expect(info.url.startsWith('/jf/videos/')).toBe(true);
    expect(info.url).toMatch(/master\.m3u8\?/);
    expect(info.url).toContain('api_key=TOKEN');
    expect(playMethodOf(info)).toBe('Transcode');
  });
  it('knows why, and says it in one friendly line', () => {
    expect(info.transcodeReasons).toEqual(['AudioCodecNotSupported']);
    expect(conversionNote(info)).toBe('Converting the sound for this browser');
  });
  it('only the sound is re-encoded: the picture stays H.264 in the URL the server made', () => {
    expect(info.url).toMatch(/VideoCodec=h264/);
    expect(info.url).toMatch(/AudioCodec=aac/);
  });
  it('reads TranscodeReasons from any URL', () => {
    expect(transcodeReasonsOf('/x?a=1&TranscodeReasons=VideoCodecNotSupported%2CAudioCodecNotSupported&b=2')).toEqual(['VideoCodecNotSupported', 'AudioCodecNotSupported']);
    expect(transcodeReasonsOf('/x?a=1')).toEqual([]);
    expect(transcodeReasonsOf(undefined)).toEqual([]);
  });
});

describe('URLs for things that cannot send headers', () => {
  it('trickplay sheet and subtitles', () => {
    expect(trickplayUrl('i', 's', 320, 2, 'T')).toBe('/jf/Videos/i/Trickplay/320/2.jpg?mediaSourceId=s&api_key=T');
    expect(subtitleVttUrl('i', 's', 4, 'T')).toBe('/jf/Videos/i/s/Subtitles/4/0/Stream.vtt?api_key=T');
  });
});

describe('MediaSegments', () => {
  it('the real server answered with none for these files: that is a normal answer', () => {
    expect(normaliseSegments([])).toEqual([]);
    expect(normaliseSegments(undefined)).toEqual([]);
  });
  it('ticks become seconds, unknown types are kept as Unknown, junk ranges dropped, sorted', () => {
    const r = normaliseSegments([
      { Id: 'b', Type: 'Outro', StartTicks: 25_000_000_000, EndTicks: 27_000_000_000 },
      { Id: 'a', Type: 'Intro', StartTicks: 620_000_000, EndTicks: 1_120_000_000 },
      { Id: 'c', Type: 'Whatever', StartTicks: 1, EndTicks: 5_000_000 },
      { Id: 'd', Type: 'Recap', StartTicks: 500, EndTicks: 500 },
    ]);
    expect(r.map(s => s.id)).toEqual(['c', 'a', 'b']);
    expect(r[1]).toEqual({ id: 'a', type: 'Intro', start: 62, end: 112 });
    expect(r[0]?.type).toBe('Unknown');
  });
});
