/**
 * Subtitles in the player. Jellyfin hands text subtitles (SRT, ASS, ...) out as WebVTT, so those go in a <track> element and can be
 * switched without touching the stream. Picture subtitles (PGS, DVD) cannot be shown by a browser: the server burns them into the
 * video, which needs a new playback session (and a transcode). Pure helpers first, DOM at the bottom.
 */
import type { MediaVersion, SubtitleTrack } from '../../api/types';
import { subtitleVttUrl } from '../../api/playback';

export type SubtitleMode = 'text' | 'burn';

export const isText = (t: SubtitleTrack): boolean => t.isText !== false;
export const modeOf = (t: SubtitleTrack): SubtitleMode => (isText(t) ? 'text' : 'burn');

/** What choosing `next` does, given what is on screen now. */
export type SubtitleSwitch = 'none' | 'track' | 'reload';

/**
 * - same choice: nothing
 * - text <-> text or off: just swap the <track> (unless a burned-in subtitle is baked into the picture right now)
 * - to or from a picture subtitle: a new session
 */
export function subtitleSwitch(version: MediaVersion, current: number, next: number, burnedNow: boolean): SubtitleSwitch {
  if (current === next) return 'none';
  const find = (i: number): SubtitleTrack | undefined => version.subtitles.find(s => s.index === i);
  const nextTrack = next >= 0 ? find(next) : undefined;
  if (burnedNow) return 'reload';
  if (nextTrack && modeOf(nextTrack) === 'burn') return 'reload';
  return 'track';
}

/** Menu entries: forced and default tracks first, then the rest in file order. The label is already cleaned (see normalise.ts). */
export function subtitleChoices(version: MediaVersion | undefined): SubtitleTrack[] {
  const list = [...(version?.subtitles ?? [])];
  return list.sort((a, b) => Number(b.isForced) - Number(a.isForced) || Number(b.isDefault) - Number(a.isDefault) || a.index - b.index);
}

/** A second line under a menu entry. */
export function subtitleHint(t: SubtitleTrack): string {
  if (!isText(t)) return 'Picture subtitles: the server adds them to the video';
  if (t.isForced) return 'Only signs and other languages';
  if (/hearing impaired|sdh/i.test(t.label)) return 'Also describes music and noises';
  return '';
}

/** Which subtitle starts: the one asked for in the link (-1 = off), else off. */
export function initialSubtitle(version: MediaVersion, requested: number | undefined): number {
  if (requested == null) return -1;
  if (requested < 0) return -1;
  return version.subtitles.some(s => s.index === requested) ? requested : -1;
}

/** Which audio track starts: asked for, else the file's default, else the first. */
export function initialAudio(version: MediaVersion, requested: number | undefined, serverDefault: number | undefined): number | undefined {
  const has = (i: number | undefined): i is number => i != null && version.audio.some(a => a.index === i);
  if (has(requested)) return requested;
  if (has(serverDefault)) return serverDefault;
  return version.audio.find(a => a.isDefault)?.index ?? version.audio[0]?.index;
}

/** Changing sound needs a new session (the server picks the track), and a file that plays as it is must be repacked
 *  when the wanted track is not the one the file starts with. */
export const audioChanged = (current: number | undefined, next: number): boolean => current !== next;
export function mustRepackForAudio(version: MediaVersion, wanted: number | undefined, serverDefault: number | undefined): boolean {
  if (wanted == null || version.audio.length < 2) return false;
  const start = initialAudio(version, undefined, serverDefault);
  return start != null && wanted !== start;
}

/* ── user's look for subtitles (kept between visits) ── */
export interface SubStyle { size: number; box: boolean }
export const DEFAULT_SUBSTYLE: SubStyle = { size: 1, box: false };

/* ── DOM: one <track> kept in step with the choice ── */
export class TrackManager {
  private track: HTMLTrackElement | null = null;
  constructor(private readonly video: HTMLVideoElement, private readonly onCue: (text: string) => void) {}

  /** Show `index` (-1 = off). */
  show(itemId: string, version: MediaVersion, index: number, token: string): void {
    this.clear();
    const t = index >= 0 ? version.subtitles.find(s => s.index === index) : undefined;
    if (!t || !isText(t)) return;
    const el = document.createElement('track');
    el.kind = 'subtitles';
    el.label = t.label;
    el.srclang = t.language?.slice(0, 3) || 'und';
    el.src = subtitleVttUrl(itemId, version.id, index, token);
    el.default = true;
    this.video.appendChild(el);
    this.track = el;
    // our own cue line (styled like the rest of the player) instead of the browser's: keep the native one hidden
    const tt = el.track;
    tt.mode = 'hidden';
    tt.addEventListener('cuechange', () => {
      const cues = Array.from(tt.activeCues ?? []) as VTTCue[];
      this.onCue(cues.map(c => c.text.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '')).join('\n'));
    });
  }

  clear(): void {
    if (this.track) {
      this.track.track.mode = 'disabled';
      this.track.remove();
      this.track = null;
    }
    this.onCue('');
  }
}
