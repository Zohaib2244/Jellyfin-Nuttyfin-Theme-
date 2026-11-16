/**
 * HLS for converted streams. hls.js (loaded only when needed, its own chunk) wherever MediaSource exists; Safari / iOS play the
 * playlist natively. Segment requests carry the Authorization header too, so it does not matter whether the server wants the
 * token in the URL or in a header.
 */
import type HlsType from 'hls.js';

export type HlsKind = 'hlsjs' | 'native' | 'none';

/** Which HLS route this browser has. hls.js is preferred: Chrome also claims native HLS in canPlayType, but only Safari does it well. */
export function hlsKind(): HlsKind {
  const w = window as unknown as { MediaSource?: unknown; ManagedMediaSource?: unknown };
  if (typeof w.MediaSource !== 'undefined') return 'hlsjs';
  if (document.createElement('video').canPlayType('application/vnd.apple.mpegurl')) return 'native';
  return 'none';
}

export interface HlsHandle {
  destroy(): void;
  /** hls.js asked to give up: a plain-language reason for the error panel */
  readonly kind: HlsKind;
}

export interface HlsStart {
  url: string;
  video: HTMLVideoElement;
  startSeconds: number;
  authHeader: string;
  onFatal(message: string): void;
  onReady(): void;
}

export async function startHls(o: HlsStart): Promise<HlsHandle> {
  const kind = hlsKind();
  if (kind === 'native') {
    o.video.src = o.url;
    o.video.addEventListener('loadedmetadata', () => { if (o.startSeconds > 0) o.video.currentTime = o.startSeconds; o.onReady(); }, { once: true });
    return { kind, destroy() { o.video.removeAttribute('src'); o.video.load(); } };
  }
  if (kind === 'none') { o.onFatal('This browser cannot play converted video.'); return { kind, destroy() { /* nothing to stop */ } }; }

  const { default: Hls } = await import('hls.js');
  if (!Hls.isSupported()) { o.onFatal('This browser cannot play converted video.'); return { kind, destroy() { /* nothing to stop */ } }; }
  const hls: HlsType = new Hls({
    startPosition: o.startSeconds > 0 ? o.startSeconds : -1,
    enableWorker: true,
    maxBufferLength: 30,
    backBufferLength: 60,
    xhrSetup(xhr: XMLHttpRequest) { try { xhr.setRequestHeader('Authorization', o.authHeader); } catch { /* the URL already has the key */ } },
  });
  let netRetries = 0;
  let mediaRetries = 0;
  hls.on(Hls.Events.MANIFEST_PARSED, () => o.onReady());
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR && netRetries < 2) { netRetries++; setTimeout(() => hls.startLoad(), 800 * netRetries); return; }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) { mediaRetries++; if (mediaRetries === 2) hls.swapAudioCodec(); hls.recoverMediaError(); return; }
    o.onFatal(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'The server stopped sending the video.' : 'This video could not be converted for this browser.');
  });
  hls.loadSource(o.url);
  hls.attachMedia(o.video);
  return { kind, destroy() { hls.destroy(); } };
}
