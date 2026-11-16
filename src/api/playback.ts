/**
 * Pure helpers that turn Jellyfin's PlaybackInfo / MediaSegments JSON into the small shapes the player uses.
 * Kept apart from jellyfin.ts so they can be unit-tested against recorded real responses.
 */
import { JF_BASE } from './images';
import { normaliseVersion, type MediaSourceDto } from './normalise';
import type { MediaSegment, PlaybackInfo, PlaybackRequest } from './types';

export type PlaybackSourceDto = {
  Id?: string;
  ETag?: string;
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  SupportsTranscoding?: boolean;
  TranscodingUrl?: string;
  TranscodingSubProtocol?: string;
  DirectStreamUrl?: string;
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
} & MediaSourceDto;

export interface PlaybackInfoResult {
  PlaySessionId?: string;
  MediaSources?: PlaybackSourceDto[];
  ErrorCode?: string;
}

/** `TranscodeReasons=VideoCodecNotSupported,AudioCodecNotSupported` from a transcoding URL. */
export function transcodeReasonsOf(url: string | undefined): string[] {
  if (!url) return [];
  const m = /[?&]TranscodeReasons=([^&]+)/i.exec(url);
  return m?.[1] ? decodeURIComponent(m[1]).split(',').map(x => x.trim()).filter(Boolean) : [];
}

/** The URL a <video> can load for a file the browser plays as it is. Media elements cannot send headers, so the token rides in api_key. */
export function directUrl(itemId: string, sourceId: string, token: string, etag?: string): string {
  const q = [`static=true`, `mediaSourceId=${encodeURIComponent(sourceId)}`, `api_key=${encodeURIComponent(token)}`];
  if (etag) q.push(`tag=${encodeURIComponent(etag)}`);
  return `${JF_BASE}/Videos/${encodeURIComponent(itemId)}/stream?${q.join('&')}`;
}

export function interpretPlayback(itemId: string, r: PlaybackInfoResult, src: PlaybackSourceDto, token: string, opts: PlaybackRequest = {}): PlaybackInfo {
  const sourceId = src.Id as string;
  const version = normaliseVersion(src);
  const reasons = transcodeReasonsOf(src.TranscodingUrl);
  let url = '';
  let method: PlaybackInfo['method'] = 'unavailable';
  if (src.SupportsDirectPlay) {
    method = 'direct';
    url = directUrl(itemId, sourceId, token, src.ETag);
  } else if (src.TranscodingUrl) {
    method = src.SupportsDirectStream ? 'directStream' : 'transcode';
    url = `${JF_BASE}${src.TranscodingUrl}`;
    if (!/api_key=/i.test(url)) url += `${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(token)}`;
  } else if (src.SupportsDirectStream) {
    method = 'directStream';
    url = directUrl(itemId, sourceId, token, src.ETag);
  }
  const subIndex = opts.subtitleIndex != null && opts.subtitleIndex >= 0 ? opts.subtitleIndex : undefined;
  const burned = subIndex != null && (src.MediaStreams ?? []).some(s => s.Index === subIndex && s.DeliveryMethod === 'Encode');
  return {
    itemId, mediaSourceId: sourceId, playSessionId: r.PlaySessionId, url, method,
    badge: method === 'transcode' ? 'Will be converted' : method === 'unavailable' ? 'Cannot play here' : 'Plays perfectly here',
    isHls: /\.m3u8/i.test(url), version,
    audioStreamIndex: opts.audioIndex ?? src.DefaultAudioStreamIndex,
    subtitleStreamIndex: subIndex ?? (opts.subtitleIndex === -1 ? -1 : undefined),
    startPositionTicks: opts.startTicks ?? 0,
    transcodeReasons: method === 'direct' ? [] : reasons,
    subtitleBurnedIn: burned,
    versions: (r.MediaSources ?? []).map(normaliseVersion),
  };
}

const SEGMENT_TYPES = new Set(['Intro', 'Outro', 'Recap', 'Preview', 'Commercial', 'Unknown']);

/** GET /MediaSegments/{id} Items -> seconds, sorted, empty or inverted ranges dropped. */
export function normaliseSegments(items: ReadonlyArray<{ Id?: string; Type?: string; StartTicks?: number; EndTicks?: number }> | undefined): MediaSegment[] {
  return (items ?? [])
    .map((s, i): MediaSegment => ({
      id: s.Id ?? String(i),
      type: (SEGMENT_TYPES.has(s.Type ?? '') ? s.Type : 'Unknown') as MediaSegment['type'],
      start: (s.StartTicks ?? 0) / 1e7,
      end: (s.EndTicks ?? 0) / 1e7,
    }))
    .filter(s => s.end > s.start)
    .sort((a, b) => a.start - b.start);
}

/** One sheet of seek-bar previews: /Videos/{id}/Trickplay/{width}/{n}.jpg */
export function trickplayUrl(itemId: string, sourceId: string, width: number, sheet: number, token: string): string {
  return `${JF_BASE}/Videos/${encodeURIComponent(itemId)}/Trickplay/${width}/${sheet}.jpg?mediaSourceId=${encodeURIComponent(sourceId)}&api_key=${encodeURIComponent(token)}`;
}

/** Text subtitles as WebVTT (the server converts SRT/ASS/etc.), loadable by a <track>. */
export function subtitleVttUrl(itemId: string, sourceId: string, index: number, token: string): string {
  return `${JF_BASE}/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(sourceId)}/Subtitles/${index}/0/Stream.vtt?api_key=${encodeURIComponent(token)}`;
}
