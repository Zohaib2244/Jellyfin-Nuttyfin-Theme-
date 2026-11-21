/** Pure view-models for Home tiles (no DOM, no fetching): easy to test. */
import type { CollectionProgress, Episode, MediaItem, SeerrRequest, Title } from '../../api/types';
import type { DeskRequest, TitleFacts } from '../../api/desk-types';
import { relativeTime, runtime } from '../../lib/format';
import { etaText, releaseWait, requestStage, type Stage } from '../requests/stage';

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

/* ── Newly Added: the "new since your last visit" banner ── */
const NEW_DAY = 864e5;
/** On the very first visit (no stored last visit) the last week counts as new. */
export const FIRST_VISIT_DAYS = 7;

export interface Fresh {
  /** ms: things added after this are new */
  since: number;
  /** no last visit was stored */
  first: boolean;
  /** titles added after `since`, newest first (as given) */
  fresh: Title[];
}

/** What is new since the last visit (or, the first time, in the last FIRST_VISIT_DAYS days). */
export function freshSince(list: readonly Title[], lastSeen: number | null | undefined, now: number): Fresh {
  const first = !(typeof lastSeen === 'number' && lastSeen > 0);
  const since = first ? now - FIRST_VISIT_DAYS * NEW_DAY : (lastSeen as number);
  const fresh = list.filter(t => {
    const ms = t.added ? new Date(t.added.replace(/(\.\d{3})\d+/, '$1')).getTime() : NaN;
    return Number.isFinite(ms) && ms > since;
  });
  return { since, first, fresh };
}

/** The banner only exists when something is new: "all caught up" means no banner at all. */
export const showNewBanner = (f: Fresh): boolean => f.fresh.length > 0;

/**
 * The last-visit time to store once the banner has really been seen: the time the list was FETCHED (not "now"), so
 * anything added while the page was open still counts as new next time. Never moves backwards.
 */
export const nextLastSeen = (prev: number | null | undefined, fetchedAt: number): number => Math.max(prev ?? 0, fetchedAt);

/**
 * Calls `onSeen` once the banner has been on screen for `minMs` in one go. `visible(false)` (scrolled away, tab
 * switched, dismissed before it was read) cancels the wait. A refresh before that leaves the last visit alone.
 */
export function seenGate(onSeen: () => void, minMs = 1500): { visible(on: boolean): void; dispose(): void; readonly done: boolean } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const stop = (): void => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  return {
    visible(on) {
      if (done) return;
      if (!on) { stop(); return; }
      if (timer !== undefined) return;
      timer = setTimeout(() => { timer = undefined; done = true; onSeen(); }, minMs);
    },
    dispose: stop,
    get done() { return done; },
  };
}

/* ── Newly Added: "On the way" (the person's own open requests, with the Requests page's honest stages) ── */
export interface ComingRow {
  r: DeskRequest;
  stage: Stage;
  /** one plain status line: "Comes out 4 March", "Searching for a copy", "Downloading · 64% · about 20 min left" */
  line: string;
  /** small coloured pill, same colours as the Requests page chips */
  pill: { cls: 'downloading' | 'approved' | 'requested' | 'available'; text: string };
  /** sort key: downloading, dated releases (soonest first), in cinemas, searching, partly ready, needs a look, asked */
  rank: number;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** One request as an "On the way" row; null when it is not on the way (in the library, removed or declined). */
export function comingRow(r: DeskRequest, facts: TitleFacts | null | undefined, now: Date): ComingRow | null {
  const stage = requestStage(r, facts, now);
  switch (stage.id) {
    case 'downloading': {
      const parts = ['Downloading', stage.percent != null ? `${stage.percent}%` : '', etaText(stage.eta, now)].filter(Boolean);
      return { r, stage, line: parts.join(' · '), pill: { cls: 'downloading', text: 'Downloading' }, rank: 0 };
    }
    case 'partial': return { r, stage, line: stage.line, pill: { cls: 'available', text: 'Partly ready' }, rank: 4 };
    case 'waiting': {
      const wait = releaseWait(r.mediaType, facts, r.seasons, now);
      if (wait?.date) return { r, stage, line: cap(wait.text), pill: { cls: 'approved', text: stage.short }, rank: 1 };
      if (wait) return { r, stage, line: cap(wait.text), pill: { cls: 'approved', text: 'In cinemas' }, rank: 2 };
      return { r, stage, line: facts ? 'Searching for a copy' : 'Approved · waiting to download', pill: { cls: 'approved', text: 'Searching' }, rank: 3 };
    }
    case 'failed': return { r, stage, line: 'Could not be sent to the downloader · the owner will look', pill: { cls: 'requested', text: 'Needs a look' }, rank: 5 };
    case 'requested': return { r, stage, line: `Waiting for a yes · asked ${relativeTime(r.createdAt, now).toLowerCase()}`, pill: { cls: 'requested', text: 'Requested' }, rank: 6 };
    default: return null;
  }
}

/** Every open request as rows, best first (ties: the soonest release, then the newest request). */
export function comingRows(list: readonly DeskRequest[], factsOf: (r: DeskRequest) => TitleFacts | null | undefined, now: Date): ComingRow[] {
  return list.map(r => comingRow(r, factsOf(r), now)).filter((x): x is ComingRow => !!x)
    .sort((a, b) => a.rank - b.rank || (a.stage.waitsFor ?? '').localeCompare(b.stage.waitsFor ?? '') || b.r.createdAt.localeCompare(a.r.createdAt));
}
