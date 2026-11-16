import { describe, expect, it } from 'vitest';
import { BITRATE, buildDeviceProfile, supportedAudio, supportedVideo, type Caps } from '../src/pages/watch/profile';

/** What a browser answers to canPlayType, by substring of the mime string. */
const caps = (yes: string[], hls = true): Caps => ({ can: m => (m.includes('x-matroska') ? yes.includes('x-matroska') : yes.some(y => m.includes(y))), hls });

const CHROME = caps(['avc1', 'vp9', 'vp8', 'av01', 'mp4a.40.2', 'audio/mpeg', 'audio/flac', 'opus', 'vorbis', 'x-matroska']);
const SAFARI = caps(['avc1', 'hvc1', 'mp4a.40.2', 'audio/mpeg', 'ac-3', 'ec-3', 'audio/flac']);
const FIREFOX = caps(['avc1', 'vp9', 'vp8', 'av01', 'mp4a.40.2', 'audio/mpeg', 'audio/flac', 'opus', 'vorbis']);

type P = { Container?: string; VideoCodec?: string; AudioCodec?: string; Protocol?: string; MaxAudioChannels?: string };
const direct = (p: Record<string, unknown>): P[] => p.DirectPlayProfiles as P[];
const trans = (p: Record<string, unknown>): P[] => p.TranscodingProfiles as P[];

describe('device profile from browser abilities', () => {
  it('Chrome: mp4, mkv and webm direct, no HEVC anywhere, H.264 HLS to convert', () => {
    const p = buildDeviceProfile(CHROME);
    const containers = direct(p).map(d => d.Container);
    expect(containers).toEqual(['mp4,m4v,mov', 'mkv', 'webm']);
    expect(direct(p)[0]?.VideoCodec).toBe('h264,av1,vp9');
    expect(direct(p)[1]?.AudioCodec).toContain('aac');
    expect(JSON.stringify(p)).not.toMatch(/hevc/);
    expect(trans(p)[0]).toMatchObject({ Container: 'ts', Protocol: 'hls', VideoCodec: 'h264', MaxAudioChannels: '2' });
    expect(trans(p)[0]?.AudioCodec).toBe('aac,mp3');
  });

  it('Safari: HEVC is allowed so the server may copy it, AC-3 is not forced into AAC', () => {
    const p = buildDeviceProfile(SAFARI);
    expect(direct(p).map(d => d.Container)).toEqual(['mp4,m4v,mov']); // no matroska, no webm
    expect(direct(p)[0]?.VideoCodec).toBe('h264,hevc');
    expect(direct(p)[0]?.AudioCodec).toContain('eac3');
    expect(trans(p)[0]?.VideoCodec).toBe('h264,hevc');
    expect(trans(p)[0]?.AudioCodec).toBe('aac,mp3,ac3,eac3');
  });

  it('Firefox: no mkv (it does not play matroska)', () => {
    expect(direct(buildDeviceProfile(FIREFOX)).map(d => d.Container)).toEqual(['mp4,m4v,mov', 'webm']);
  });

  it('a browser with no HLS gets no transcoding profile (the server then refuses instead of sending something unplayable)', () => {
    expect(trans(buildDeviceProfile(caps(['avc1', 'mp4a.40.2'], false)))).toEqual([]);
  });

  it('quality sets the bitrate ceiling; saver is far lower than auto', () => {
    expect(buildDeviceProfile(CHROME, 'auto').MaxStreamingBitrate).toBe(BITRATE.auto);
    expect(buildDeviceProfile(CHROME, 'saver').MaxStreamingBitrate).toBe(3_500_000);
    expect(BITRATE.original).toBeGreaterThan(BITRATE.auto);
    expect(BITRATE.auto).toBeGreaterThan(BITRATE.saver);
  });

  it('text subtitles stay outside the video, picture subtitles are burned in', () => {
    const p = buildDeviceProfile(CHROME);
    const subs = p.SubtitleProfiles as Array<{ Format: string; Method: string }>;
    expect(subs.find(s => s.Format === 'subrip')?.Method).toBe('External');
    expect(subs.find(s => s.Format === 'ass')?.Method).toBe('External');
    expect(subs.find(s => s.Format === 'pgssub')?.Method).toBe('Encode');
  });

  it('10-bit H.264 is rejected (browsers cannot decode Hi10P)', () => {
    const cp = buildDeviceProfile(CHROME).CodecProfiles as Array<{ Codec?: string; Conditions: Array<{ Property: string; Value: string }> }>;
    const h264 = cp.find(c => c.Codec === 'h264');
    expect(h264?.Conditions.find(c => c.Property === 'VideoBitDepth')?.Value).toBe('8');
  });

  it('lists what the probe says, in a fixed order', () => {
    expect(supportedVideo(CHROME)).toEqual(['h264', 'av1', 'vp9', 'vp8']);
    expect(supportedAudio(SAFARI)).toEqual(['aac', 'mp3', 'ac3', 'eac3', 'flac']);
  });
});
