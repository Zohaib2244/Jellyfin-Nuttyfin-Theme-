/**
 * The Jellyfin DeviceProfile for THIS browser, built from what it says it can play (canPlayType / MediaSource).
 * Pure given a `Caps` probe, so it is unit-tested with fake Chrome / Firefox / Safari probes.
 *
 * What the profile asks for, in order of preference:
 *   1. direct play   the file goes to <video> untouched (mp4/m4v/mov, mkv and webm when the browser takes them)
 *   2. direct stream the picture is copied, only the container or sound is repacked (HLS, almost no server work)
 *   3. transcode     H.264 + AAC in HLS. The server (Haswell i5) has Quick Sync for H.264 only and no HEVC decode,
 *                    so H.264 is the only picture codec we ever ask it to encode; HEVC is listed only so a
 *                    browser that can decode it lets the server copy it instead of re-encoding.
 */
import type { DeviceProfile } from '../../api/types';

export interface Caps {
  /** canPlayType(mime) is non-empty */
  can(mime: string): boolean;
  /** hls.js (MediaSource) or native HLS is available */
  hls: boolean;
}

export type Quality = 'auto' | 'original' | 'saver';

/** Bits per second the server may stream. Auto stays under what a busy home Wi-Fi manages; saver is about 720p. */
export const BITRATE: Record<Quality, number> = { auto: 20_000_000, original: 120_000_000, saver: 3_500_000 };

const VIDEO_MIME: Array<[string, string]> = [
  ['h264', 'video/mp4; codecs="avc1.640028"'],
  ['hevc', 'video/mp4; codecs="hvc1.1.6.L120.B0"'],
  ['av1', 'video/mp4; codecs="av01.0.08M.08"'],
  ['vp9', 'video/webm; codecs="vp9"'],
  ['vp8', 'video/webm; codecs="vp8"'],
];
const AUDIO_MIME: Array<[string, string]> = [
  ['aac', 'audio/mp4; codecs="mp4a.40.2"'],
  ['mp3', 'audio/mpeg'],
  ['ac3', 'audio/mp4; codecs="ac-3"'],
  ['eac3', 'audio/mp4; codecs="ec-3"'],
  ['opus', 'audio/webm; codecs="opus"'],
  ['flac', 'audio/flac'],
  ['vorbis', 'audio/ogg; codecs="vorbis"'],
];

export const supportedVideo = (caps: Caps): string[] => VIDEO_MIME.filter(([, m]) => caps.can(m)).map(([c]) => c);
export const supportedAudio = (caps: Caps): string[] => AUDIO_MIME.filter(([, m]) => caps.can(m)).map(([c]) => c);

export function buildDeviceProfile(caps: Caps, quality: Quality = 'auto'): DeviceProfile {
  const video = supportedVideo(caps);
  const audio = supportedAudio(caps);
  const bitrate = BITRATE[quality];
  const has = (c: string): boolean => video.includes(c);

  const mp4Video = video.filter(c => c !== 'vp8');
  const mkvOk = caps.can('video/x-matroska; codecs="avc1.640028,mp4a.40.2"') || caps.can('video/x-matroska; codecs="vp9,opus"');
  const mp4Audio = audio.filter(c => c !== 'vorbis');
  const direct: Array<Record<string, unknown>> = [];
  if (mp4Video.length) direct.push({ Container: 'mp4,m4v,mov', Type: 'Video', VideoCodec: mp4Video.join(','), AudioCodec: mp4Audio.join(',') });
  if (mkvOk) direct.push({ Container: 'mkv', Type: 'Video', VideoCodec: video.filter(c => c !== 'vp8').join(','), AudioCodec: audio.join(',') });
  if (has('vp9') || has('vp8') || has('av1')) direct.push({ Container: 'webm', Type: 'Video', VideoCodec: video.filter(c => ['vp8', 'vp9', 'av1'].includes(c)).join(','), AudioCodec: audio.filter(c => ['vorbis', 'opus'].includes(c)).join(',') });

  // transcoded audio: AAC always works in HLS; AC-3 only where the browser really decodes it
  const hlsAudio = ['aac', 'mp3', ...audio.filter(c => c === 'ac3' || c === 'eac3')];
  const transcoding: Array<Record<string, unknown>> = caps.hls
    ? [{
      Container: 'ts', Type: 'Video', Protocol: 'hls', Context: 'Streaming',
      VideoCodec: has('hevc') ? 'h264,hevc' : 'h264', AudioCodec: hlsAudio.join(','),
      MaxAudioChannels: '2', MinSegments: 1, BreakOnNonKeyFrames: true,
    }]
    : [];

  return {
    Name: 'Nuttyfin web',
    MaxStreamingBitrate: bitrate,
    MaxStaticBitrate: bitrate,
    MusicStreamingTranscodingBitrate: 192_000,
    DirectPlayProfiles: direct,
    TranscodingProfiles: transcoding,
    ContainerProfiles: [],
    CodecProfiles: [
      // Chrome and Safari decode 8-bit H.264 up to level 5.2; 10-bit ("Hi10P") is not decodable in a browser
      { Type: 'Video', Codec: 'h264', Conditions: [
        { Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: false },
        { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '52', IsRequired: false },
      ] },
      { Type: 'VideoAudio', Codec: 'aac', Conditions: [{ Condition: 'NotEquals', Property: 'AudioProfile', Value: 'HE-AACv2', IsRequired: false }] },
      { Type: 'VideoAudio', Conditions: [{ Condition: 'LessThanEqual', Property: 'AudioChannels', Value: '8', IsRequired: false }] },
    ],
    ResponseProfiles: [{ Type: 'Video', Container: 'm4v', MimeType: 'video/mp4' }],
    SubtitleProfiles: [
      // text: the server converts these to WebVTT for a <track> (see subs.ts). Picture subtitles can only be burned in.
      ...['vtt', 'srt', 'subrip', 'ass', 'ssa'].map(Format => ({ Format, Method: 'External' })),
      ...['pgssub', 'dvdsub', 'dvbsub'].map(Format => ({ Format, Method: 'Encode' })),
    ],
  };
}

/** The real probe: one throwaway <video> element. */
export function browserCaps(hlsSupported: boolean): Caps {
  const v = document.createElement('video');
  return { can: mime => !!v.canPlayType(mime), hls: hlsSupported };
}
