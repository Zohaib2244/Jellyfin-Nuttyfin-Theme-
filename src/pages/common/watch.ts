/** Links into the player (#/watch/:id, built by someone else). Paths have no leading '#', ready for router.href / navigate. */
const TICKS_PER_SECOND = 10_000_000;

export interface WatchChoice {
  /** start position in seconds (Resume) */
  seconds?: number;
  /** audio stream index the person picked */
  audio?: number;
  /** subtitle stream index; -1 = subtitles off (only when the person chose it) */
  sub?: number;
  /** media source (version) id the person picked */
  version?: string;
}

export const ticksToSeconds = (ticks: number): number => Math.floor(ticks / TICKS_PER_SECOND);

/** `/watch/<id>?t=<seconds>&audio=&sub=&version=`: only the parts that were chosen are included. */
export function watchPath(id: string, c: WatchChoice = {}): string {
  const q = new URLSearchParams();
  if (c.seconds != null && c.seconds > 0) q.set('t', String(Math.floor(c.seconds)));
  if (c.audio != null) q.set('audio', String(c.audio));
  if (c.sub != null) q.set('sub', String(c.sub));
  if (c.version) q.set('version', c.version);
  const s = q.toString();
  return `/watch/${encodeURIComponent(id)}${s ? `?${s}` : ''}`;
}
