/** Small pure helpers for the details page: which episode "Play" means, season grouping, saved picks. */
import type { AudioTrack, Episode, MediaVersion, Person } from '../../api/types';

/** The episode Play/Resume should open: one partly watched, else the first unwatched after the last watched one,
 *  else (all watched, or none) the very first. Specials (season 0) are only used when there is nothing else. */
export function pickTarget(eps: readonly Episode[]): Episode | undefined {
  const real = eps.filter(e => !e.missing);
  const main = real.filter(e => e.season > 0);
  const pool = main.length ? main : real;
  const partly = pool.filter(e => e.progress);
  if (partly.length) return partly[partly.length - 1];
  let lastPlayed = -1;
  pool.forEach((e, i) => { if (e.played) lastPlayed = i; });
  const next = pool.slice(lastPlayed + 1).find(e => !e.played);
  return next ?? pool[0];
}

export interface SeasonGroup { number: number; eps: Episode[]; watched: number }

export function groupSeasons(eps: readonly Episode[]): SeasonGroup[] {
  const map = new Map<number, Episode[]>();
  for (const e of eps) map.set(e.season, [...(map.get(e.season) ?? []), e]);
  return [...map].sort((a, b) => a[0] - b[0]).map(([number, list]) => ({
    number,
    eps: list.sort((a, b) => a.episode - b.episode),
    watched: list.filter(e => e.played).length,
  }));
}

/** "S2 E5" or "S1 E1-E2" */
export const epLabel = (e: Pick<Episode, 'season' | 'episode' | 'episodeEnd'>): string =>
  `S${e.season} E${e.episode}${e.episodeEnd ? `-E${e.episodeEnd}` : ''}`;

/** Guest stars across a season: each person once, with the episodes they appear in. */
export function guestStars(eps: readonly Episode[]): Array<{ person: Person; episodes: number[] }> {
  const seen = new Map<string, { person: Person; episodes: number[] }>();
  for (const e of eps) {
    for (const p of e.people ?? []) {
      if (p.type !== 'GuestStar') continue;
      const key = p.id || p.name;
      const hit = seen.get(key);
      if (hit) hit.episodes.push(e.episode); else seen.set(key, { person: p, episodes: [e.episode] });
    }
  }
  return [...seen.values()];
}

/* ── remembered picks ("your usual": version, sound, subtitles per title) ── */
export interface PlayPrefs { ver?: string; audio: number; sub: number }

export function validPrefs(p: PlayPrefs | undefined, versions: readonly MediaVersion[]): PlayPrefs | undefined {
  if (!p) return undefined;
  const v = versions.find(x => x.id === p.ver) ?? versions[0];
  if (!v) return undefined;
  const audioOk = v.audio.some((a: AudioTrack) => a.index === p.audio);
  const subOk = p.sub === -1 || v.subtitles.some(s => s.index === p.sub);
  return audioOk && subOk ? { ...p, ver: v.id } : undefined;
}
