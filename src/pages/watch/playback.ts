/**
 * Playback decisions: what to ask the server for, how to say it in plain words, and where to start. Pure parts are unit-tested.
 * The server answers PlaybackInfo with direct play / direct stream / transcode based on the DeviceProfile from profile.ts.
 */
import type { Backend } from '../../api/backend';
import { ApiError } from '../../api/http';
import type { MediaItem, PlaybackInfo, PlaybackReport } from '../../api/types';
import { hlsKind } from './hls';
import { browserCaps, buildDeviceProfile, BITRATE, type Quality } from './profile';
import { initialAudio, initialSubtitle, mustRepackForAudio } from './subs';

export interface SessionChoice {
  /** media source (file) id */
  version?: string;
  audio?: number;
  /** -1 = off */
  sub: number;
  quality: Quality;
  /** where to start, seconds */
  start: number;
  /** set after a direct-play failure */
  noDirectPlay?: boolean;
}

/** Ask the server how to play, with this browser's real abilities. */
export async function openSession(backend: Backend, id: string, c: SessionChoice, item?: MediaItem): Promise<PlaybackInfo> {
  const profile = buildDeviceProfile(browserCaps(hlsKind() !== 'none'), c.quality);
  const version = c.version ? item?.versions?.find(v => v.id === c.version) : item?.versions?.[0];
  const audio = version ? initialAudio(version, c.audio, undefined) : c.audio;
  const repack = !!version && mustRepackForAudio(version, audio, undefined);
  return backend.playbackInfo(id, {
    versionId: c.version, audioIndex: audio, subtitleIndex: c.sub, startTicks: Math.round(c.start * 1e7),
    profile, maxBitrate: BITRATE[c.quality], noDirectPlay: c.noDirectPlay || repack || c.quality === 'saver',
  });
}

/** Start with the file's own sound and the subtitle asked for in the link. */
export function startingTracks(item: MediaItem, versionId: string | undefined, audio: number | undefined, sub: number | undefined): { audio: number | undefined; sub: number } {
  const v = item.versions?.find(x => x.id === versionId) ?? item.versions?.[0];
  if (!v) return { audio, sub: sub ?? -1 };
  return { audio: initialAudio(v, audio, undefined), sub: initialSubtitle(v, sub) };
}

const VIDEO_REASONS = /^(Video|RefFrames|Anamorphic|Interlaced|SecondaryAudio)/;
const AUDIO_REASONS = /^Audio/;
const RATE_REASONS = /(Bitrate|ContainerBitrateExceedsLimit)/;

/** One plain line for the person when the server is converting. null = nothing to say (plays as it is). */
export function conversionNote(info: Pick<PlaybackInfo, 'method' | 'transcodeReasons' | 'subtitleBurnedIn'>): string | null {
  if (info.method === 'direct') return null;
  if (info.method === 'unavailable') return null;
  const r = info.transcodeReasons ?? [];
  if (info.subtitleBurnedIn || r.includes('SubtitleCodecNotSupported')) return 'Adding subtitles to the picture';
  if (r.some(x => VIDEO_REASONS.test(x) && !RATE_REASONS.test(x))) return 'Converting for this browser';
  if (r.some(x => RATE_REASONS.test(x))) return 'Lowering the quality to fit your connection';
  if (r.length && r.every(x => AUDIO_REASONS.test(x))) return 'Converting the sound for this browser';
  if (r.length && r.every(x => /^Container/.test(x))) return 'Repacking for this browser';
  return 'Converting for this browser';
}

export const playMethodOf = (info: Pick<PlaybackInfo, 'method'>): NonNullable<PlaybackReport['playMethod']> =>
  info.method === 'direct' ? 'DirectPlay' : info.method === 'directStream' ? 'DirectStream' : 'Transcode';

/** Seconds to start at: the link's `t`, else where the person left off (not within the last 3 % or the first 10 s). */
export function startSeconds(link: number | null, item: MediaItem): number {
  if (link != null) return Math.max(0, link);
  const p = item.progress;
  if (!p) return 0;
  const s = p.positionTicks / 1e7;
  return s < 10 || p.percent > 97 ? 0 : s;
}

/** Jellyfin's own web page for this title: the "Open in Jellyfin" way out when playback fails. */
export function jellyfinWebUrl(id: string, loc: Pick<Location, 'protocol' | 'hostname'> = location): string {
  return `${loc.protocol}//${loc.hostname}:8096/web/#/details?id=${encodeURIComponent(id)}`;
}

/** The title record could not be read: a link to something that is gone (Jellyfin answers 400 or 404) is "not found", only real trouble is a connection problem. */
export function itemLoadFailure(e: unknown): { missing: boolean; why: string } {
  if (e instanceof ApiError && (e.kind === 'not-found' || e.kind === 'client')) return { missing: true, why: 'It may have been removed, or the link is old.' };
  return { missing: false, why: 'We could not reach the server.' };
}

/** A friendly sentence for a <video> error code. */
export function mediaErrorText(code: number | undefined): string {
  switch (code) {
    case 1: return 'Playback was stopped.';
    case 2: return 'The connection to the server dropped.';
    case 3: return 'This video could not be decoded by the browser.';
    case 4: return 'This browser cannot play this file as it is.';
    default: return 'Something went wrong while playing.';
  }
}

export class PlayError extends Error {
  constructor(message: string, readonly canRetryConverted = false) { super(message); this.name = 'PlayError'; }
}
