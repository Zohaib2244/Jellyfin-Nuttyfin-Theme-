/** "Skip intro / recap / credits" lookups over Jellyfin MediaSegments (seconds). Pure. */
import type { MediaSegment } from '../../api/types';

export type SkippableKind = 'Intro' | 'Recap' | 'Outro' | 'Preview';
const SKIPPABLE = new Set<string>(['Intro', 'Recap', 'Outro', 'Preview']);

export const skipLabel = (type: string): string => (
  type === 'Intro' ? 'Skip intro' : type === 'Recap' ? 'Skip recap' : type === 'Outro' ? 'Skip credits' : type === 'Preview' ? 'Skip preview' : 'Skip'
);

/** The skippable segment playing at `t`, if any. The last 2 s of a segment do not count (nothing left to skip). */
export function segmentAt(segments: readonly MediaSegment[], t: number): MediaSegment | undefined {
  return segments.find(s => SKIPPABLE.has(s.type) && t >= s.start && t < s.end - 2);
}

/** Where to seek when "Skip" is pressed: the end of the segment (or the very end if it runs to the end of the file). */
export function skipTarget(seg: MediaSegment, duration: number): number {
  return duration > 0 ? Math.min(seg.end, Math.max(0, duration - 0.5)) : seg.end;
}

/** When the credits begin: the Outro marker, else the last 40 s (the same fallback for every episode). */
export function creditsStart(segments: readonly MediaSegment[], duration: number): number {
  const outro = segments.find(s => s.type === 'Outro' && s.start > duration * 0.5);
  if (outro) return outro.start;
  return Math.max(0, duration - 40);
}

/** Fraction of the segment still ahead (1 at its start, 0 at its end) for the thin countdown line on the Skip button. */
export function segmentLeft(seg: MediaSegment, t: number): number {
  const len = seg.end - seg.start;
  return len <= 0 ? 0 : Math.max(0, Math.min(1, (seg.end - t) / len));
}
