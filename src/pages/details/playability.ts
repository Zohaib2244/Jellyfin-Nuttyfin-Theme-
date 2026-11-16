/**
 * "Will it play here?": judge a media file (version) against this browser, in plain language.
 * Pure given a `can(mime)` probe (the browser one wraps video.canPlayType), so it is unit-tested with fake probes.
 *
 * Levels
 *   direct   the browser plays the file as it is                        -> "Plays perfectly here"
 *   convert  picture is fine, only the container or sound is repacked    -> "Will be converted" (quick, lossless picture)
 *   heavy    the picture itself has to be re-encoded on the server        -> "Will be converted" / "Needs conversion"
 *            The server has no hardware HEVC decode (Haswell i5), so HEVC / AV1 / 4K sources are flagged "may stutter".
 */
import type { AudioTrack, MediaVersion } from '../../api/types';

export type CanPlay = (mime: string) => boolean;
export type Level = 'direct' | 'convert' | 'heavy' | 'none';
export type Tone = 'ok' | 'info' | 'warn' | 'bad';

export interface Assessment {
  level: Level;
  /** short text for the chip */
  badge: string;
  tone: Tone;
  /** one plain sentence for the panel */
  why: string;
  /** true when the server would have to re-encode HEVC/AV1/4K without hardware help */
  mayStutter: boolean;
  /** terse technical line (owner "details") */
  tech: string;
}

const VIDEO_MIME: Record<string, string> = {
  h264: 'video/mp4; codecs="avc1.640028"',
  avc: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L120.B0"',
  h265: 'video/mp4; codecs="hvc1.1.6.L120.B0"',
  vp9: 'video/webm; codecs="vp9"',
  vp8: 'video/webm; codecs="vp8"',
  av1: 'video/mp4; codecs="av01.0.08M.08"',
};
const AUDIO_MIME: Record<string, string> = {
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  mp3: 'audio/mpeg',
  opus: 'audio/webm; codecs="opus"',
  flac: 'audio/flac',
  vorbis: 'audio/ogg; codecs="vorbis"',
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
};
/** Containers a <video> element takes straight from the server (matches the player's device profile). */
const DIRECT_CONTAINERS = ['mp4', 'm4v', 'mov', 'webm'];

const norm = (s?: string): string => (s ?? '').toLowerCase();
const firstContainer = (s?: string): string => norm(s).split(',')[0]?.trim() ?? '';

const CODEC_NAME: Record<string, string> = { h264: 'H.264', avc: 'H.264', hevc: 'HEVC', h265: 'HEVC', av1: 'AV1', vp9: 'VP9', vp8: 'VP8', mpeg4: 'MPEG-4', vc1: 'VC-1' };
export const codecName = (c?: string): string => CODEC_NAME[norm(c)] ?? (c ? c.toUpperCase() : 'unknown');

export function assess(v: MediaVersion | undefined, audio: AudioTrack | undefined, can: CanPlay): Assessment {
  if (!v) return { level: 'none', badge: 'Cannot play here', tone: 'bad', why: 'There is no playable file for this title.', mayStutter: false, tech: '' };
  const vc = norm(v.videoCodec);
  const container = firstContainer(v.container);
  const videoOk = vc ? (VIDEO_MIME[vc] ? can(VIDEO_MIME[vc] as string) : false) : true;
  const ac = norm(audio?.codec);
  const audioOk = !ac || (AUDIO_MIME[ac] ? can(AUDIO_MIME[ac] as string) : false);
  const containerOk = !container || DIRECT_CONTAINERS.includes(container);
  const big = v.is4k || (v.height ?? 0) > 1080 || (v.width ?? 0) > 1920;
  const tech = [v.container?.toUpperCase(), codecName(v.videoCodec), v.width && v.height ? `${v.width}x${v.height}` : '', audio ? `${audio.codec?.toUpperCase() ?? ''}${audio.channels ? ` ${audio.channels === 6 ? '5.1' : audio.channels === 2 ? 'stereo' : `${audio.channels}ch`}` : ''}`.trim() : '']
    .filter(Boolean).join(' · ');

  if (videoOk && audioOk && containerOk) {
    return { level: 'direct', badge: 'Plays perfectly here', tone: 'ok', mayStutter: false, tech, why: 'Your browser plays this file as it is. Nothing is converted.' };
  }
  if (videoOk) {
    const parts = [!containerOk ? 'repack the file' : '', !audioOk ? 'convert the sound' : ''].filter(Boolean).join(' and ');
    return { level: 'convert', badge: 'Will be converted', tone: 'info', mayStutter: false, tech, why: `The server will ${parts} as you watch. The picture is untouched, so it looks the same and starts quickly.` };
  }
  // the picture has to be re-encoded
  const hard = vc === 'hevc' || vc === 'h265' || vc === 'av1' || big;
  if (hard) {
    return {
      level: 'heavy', badge: 'Will be converted, may stutter', tone: 'warn', mayStutter: true, tech,
      why: `This browser cannot play ${codecName(v.videoCodec)}${big ? ' at this size' : ''} directly. The server has to convert it as you watch and has no hardware help for that, so it may stutter. Pick a smaller version if there is one.`,
    };
  }
  return { level: 'heavy', badge: 'Needs conversion', tone: 'info', mayStutter: false, tech, why: `This browser cannot play ${codecName(v.videoCodec)} directly. The server converts it to a format that works as you watch; at this size that is fine.` };
}

const RANK: Record<Level, number> = { direct: 0, convert: 1, heavy: 2, none: 3 };

/** The version to pre-select: the one that plays best here; ties keep the server's order (usually best quality first). */
export function bestVersion(versions: readonly MediaVersion[], audioFor: (v: MediaVersion) => AudioTrack | undefined, can: CanPlay): MediaVersion | undefined {
  let best: MediaVersion | undefined;
  let bestRank = 9;
  for (const v of versions) {
    const r = RANK[assess(v, audioFor(v), can).level] + (assess(v, audioFor(v), can).mayStutter ? 0.5 : 0);
    if (r < bestRank) { best = v; bestRank = r; }
  }
  return best;
}

/** Default sound: the file's default, else the first. */
export function defaultAudio(v: MediaVersion | undefined): AudioTrack | undefined {
  return v?.audio.find(a => a.isDefault) ?? v?.audio[0];
}

/** Default subtitles: a forced track in the sound's language (foreign-speech lines only), else the file's default flag, else off (-1). */
export function defaultSubtitle(v: MediaVersion | undefined, audio: AudioTrack | undefined): number {
  if (!v) return -1;
  const forced = v.subtitles.find(s => s.isForced && (!audio?.language || s.language === audio.language));
  if (forced) return forced.index;
  return v.subtitles.find(s => s.isDefault)?.index ?? -1;
}

/** Real browser probe. */
export const browserCanPlay: CanPlay = mime => {
  try { return document.createElement('video').canPlayType(mime) !== ''; } catch { return false; }
};
