/** Pure view-models for Home tiles (no DOM, no fetching): easy to test. */
import type { CollectionProgress, Episode, MediaItem, SeerrRequest, Title } from '../../api/types';
import { runtime } from '../../lib/format';

/** "S2 E5" (double episodes: "S1 E1-2"). */
export function epLabel(e: Episode): string {
  return `S${e.season} E${e.episode}${e.episodeEnd ? `-${e.episodeEnd}` : ''}`;
}

/* ── Continue watching ── */
export interface WatchRow {
  /** the thing to play */
  item: MediaItem;
  title: string;
  /** "S2 E5 · Order" or "Film · 2021" */
  sub: string;
  /** 0-100, or null for "next up" rows that are not started */
  percent: number | null;
  /** minutes left, when known */
  leftMin: number | null;
  kind: 'resume' | 'next';
}

function subOf(item: MediaItem): string {
  if (item.kind === 'episode') return item.name ? `${epLabel(item)} · ${item.name}` : epLabel(item);
  return [item.kind === 'series' ? 'Show' : 'Film', item.year].filter(Boolean).join(' · ');
}

/** Partly-watched items first (as Jellyfin orders them), then the next unwatched episode of shows you follow. */
export function watchRows(resume: readonly MediaItem[], next: readonly Episode[]): WatchRow[] {
  const rows: WatchRow[] = [];
  const seen = new Set<string>();
  const series = new Set<string>();
  for (const item of resume) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.kind === 'episode') series.add(item.seriesId);
    rows.push({
      item, title: item.kind === 'episode' ? item.seriesName : item.name, sub: subOf(item),
      percent: item.progress ? Math.round(item.progress.percent) : 0,
      leftMin: item.progress ? item.progress.remainingMin : null, kind: 'resume',
    });
  }
  for (const e of next) {
    if (seen.has(e.id) || series.has(e.seriesId)) continue;
    seen.add(e.id);
    series.add(e.seriesId);
    rows.push({ item: e, title: e.seriesName, sub: subOf(e), percent: null, leftMin: e.runtimeMin || null, kind: 'next' });
  }
  return rows;
}

export const leftText = (r: Pick<WatchRow, 'leftMin' | 'kind'>): string =>
  r.leftMin == null ? '' : r.kind === 'next' ? runtime(r.leftMin) : `${runtime(r.leftMin)} left`;

/* ── Finish the season ── */
export interface SeasonProgress {
  seriesId: string;
  seriesName: string;
  season: number;
  seen: number;
  of: number;
  /** next episode to watch */
  next: Episode;
  leftMin: number;
  /** one entry per episode: 'w' watched, 'n' next, '' later */
  dots: Array<'w' | 'n' | ''>;
}

/** A started-but-unfinished season from that season's full episode list; null if not started or already done. */
export function seasonProgress(next: Episode, episodes: readonly Episode[]): SeasonProgress | null {
  const eps = episodes.filter(e => !e.missing && e.season === next.season);
  if (eps.length < 2) return null;
  const seen = eps.filter(e => e.played).length;
  if (seen === 0 || seen >= eps.length) return null;
  const firstUnseen = eps.findIndex(e => !e.played);
  return {
    seriesId: next.seriesId, seriesName: next.seriesName, season: next.season, seen, of: eps.length, next,
    leftMin: eps.filter(e => !e.played).reduce((a, e) => a + (e.runtimeMin || 0), 0),
    dots: eps.map((e, i) => (e.played ? 'w' : i === firstUnseen ? 'n' : '')),
  };
}

export const byClosestToDone = (a: SeasonProgress, b: SeasonProgress): number => (a.of - a.seen) - (b.of - b.seen) || a.leftMin - b.leftMin;

/** Box sets you have started but not finished, closest to done first. */
export function startedCollections(list: readonly CollectionProgress[]): CollectionProgress[] {
  return list.filter(c => c.seen > 0 && c.seen < c.total).sort((a, b) => (a.total - a.seen) - (b.total - b.seen) || b.seen - a.seen);
}

/* ── Short on time ── */
export interface FitCandidate {
  item: Title | Episode;
  /** minutes it will take (a resumed film: time left) */
  minutes: number;
  /** 'finish' for something half-watched, 'next' for a next episode, else '' */
  note: 'finish' | 'next' | '';
}

/** Everything that fits in `budget` minutes, best first: fills the time well, rated well, finishing beats starting. */
export function bestFits(cands: readonly FitCandidate[], budget: number): FitCandidate[] {
  const score = (c: FitCandidate): number => {
    const fill = c.minutes / budget;
    const rating = 'rating' in c.item && c.item.rating ? c.item.rating / 10 : 0.6;
    return fill * 2 + rating + (c.note === 'finish' ? 0.35 : 0);
  };
  return cands.filter(c => c.minutes > 0 && c.minutes <= budget).sort((a, b) => score(b) - score(a));
}

/* ── On TV this week ── */
export interface WeekDay {
  /** local midnight, ms */
  day: number;
  episodes: Episode[];
}
export interface Week {
  /** 'upcoming' when something is scheduled, else 'aired' (what arrived in the last days) */
  mode: 'upcoming' | 'aired';
  days: WeekDay[];
  total: number;
}

export const startOfDay = (t: number): number => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const DAY = 864e5;
const when = (v: string | undefined): number => (v ? new Date(v.replace(/(\.\d{3})\d+/, '$1')).getTime() : NaN);

/**
 * Seven days of episodes. Upcoming episodes (today and the next six days) when there are any; otherwise the
 * seven days up to and including today from recently added episodes, so the tile is never empty.
 */
export function buildWeek(upcoming: readonly Episode[], recent: readonly Episode[], now: number = Date.now()): Week {
  const today = startOfDay(now);
  const dayOf = (v: string | undefined): number => { const t = when(v); return Number.isFinite(t) ? startOfDay(t) : NaN; };
  const upcomingInWeek = upcoming.filter(e => { const d = dayOf(e.premiered ?? e.added); return d >= today && d < today + 7 * DAY; });
  const mode: Week['mode'] = upcomingInWeek.length ? 'upcoming' : 'aired';
  const from = mode === 'upcoming' ? today : today - 6 * DAY;
  const days: WeekDay[] = Array.from({ length: 7 }, (_, i) => ({ day: from + i * DAY, episodes: [] }));
  const place = (e: Episode, v: string | undefined) => { days.find(x => x.day === dayOf(v))?.episodes.push(e); };
  if (mode === 'upcoming') upcomingInWeek.forEach(e => place(e, e.premiered ?? e.added));
  else recent.forEach(e => place(e, e.added ?? e.premiered));
  for (const d of days) d.episodes.sort((a, b) => (a.premiered ?? a.added ?? '').localeCompare(b.premiered ?? b.added ?? '') || a.seriesName.localeCompare(b.seriesName));
  return { mode, days, total: days.reduce((a, d) => a + d.episodes.length, 0) };
}

/** Index of the day to open first: today if it has episodes, else the nearest busy day, else today. */
export function firstBusyDay(w: Week, now: number = Date.now()): number {
  const today = startOfDay(now);
  const todayIdx = Math.max(0, w.days.findIndex(d => d.day === today));
  if (w.days[todayIdx]?.episodes.length) return todayIdx;
  if (w.mode === 'aired') {
    for (let i = w.days.length - 1; i >= 0; i--) if (w.days[i]?.episodes.length) return i;
  } else {
    const i = w.days.findIndex(d => d.episodes.length);
    if (i >= 0) return i;
  }
  return todayIdx;
}

/* ── Requests ── */
export const REQUEST_ORDER: ReadonlyArray<SeerrRequest['state']> = ['downloading', 'approved', 'requested', 'available', 'declined'];
export const byRequestState = (a: SeerrRequest, b: SeerrRequest): number =>
  REQUEST_ORDER.indexOf(a.state) - REQUEST_ORDER.indexOf(b.state) || b.createdAt.localeCompare(a.createdAt);

/** Plain-language status for a request: `label` for roomy spots, `short` for chips. */
export function requestLabel(state: SeerrRequest['state']): { label: string; short: string } {
  switch (state) {
    case 'downloading': return { label: 'On its way', short: 'Processing' };
    case 'approved': return { label: 'Approved', short: 'Approved' };
    case 'available': return { label: 'Ready to watch', short: 'Available' };
    case 'declined': return { label: 'Not this time', short: 'Declined' };
    default: return { label: 'Waiting for a yes', short: 'Requested' };
  }
}
