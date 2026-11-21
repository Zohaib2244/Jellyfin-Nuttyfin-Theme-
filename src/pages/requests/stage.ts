/**
 * Where a request is on its journey, Seerr-style, as one pure function (unit-tested in tests/requests-stage.test.ts):
 *
 *   Requested -> Approved (or Declined) -> Waiting -> Downloading -> In the library
 *
 * Inputs are Seerr's own numbers: request.status (1 pending, 2 approved, 3 declined, 4 failed, 5 completed),
 * media.status (1 unknown, 2 pending, 3 processing, 4 partly available, 5 available, 6 blocklisted, 7 deleted),
 * media.downloadStatus (the Radarr/Sonarr queue) and the release dates from the title's Seerr details.
 * "Downloading" is ONLY used when the downloader really reports a download; Seerr's "processing" alone means
 * "handed to Radarr/Sonarr", which for an unreleased film is just waiting.
 */
import type { DownloadInfo, TitleFacts } from '../../api/desk-types';
import { relativeTime } from '../../lib/format';

export type StageId = 'requested' | 'declined' | 'failed' | 'waiting' | 'downloading' | 'partial' | 'available' | 'removed';
export type StageGroup = 'pending' | 'onway' | 'added' | 'removed' | 'declined';

export interface Stage {
  id: StageId;
  /** index into STEPS of the current step (0 Requested ... 4 In the library) */
  step: number;
  group: StageGroup;
  /** short word for the chip: "Waiting for a yes", "Comes out 4 Mar", "Downloading 41%" */
  short: string;
  /** the plain-language line under the stepper */
  line: string;
  /** whole-request download progress, when downloading */
  percent?: number;
  /** ISO time the downloads should be done */
  eta?: string;
  /** a future release date that the request is waiting for (YYYY-MM-DD) */
  waitsFor?: string;
}

export const STEPS = ['Requested', 'Approved', 'Waiting', 'Downloading', 'In the library'] as const;

export interface StageInput {
  requestStatus: number;
  mediaStatus?: number;
  mediaType: 'movie' | 'tv';
  downloads: readonly DownloadInfo[];
  createdAt: string;
  updatedAt?: string;
  /** TV: requested season numbers */
  seasons?: readonly number[];
}

const DAY = 864e5;
const isoDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "4 March 2027" ("4 March" when it is this year). */
export function longDate(ymd: string, now: Date): string {
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-GB', sameYear ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' });
}
const shortDate = (ymd: string): string => {
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/** "about 2 h left", "about 25 min left", "" when unknown or past. */
export function etaText(eta: string | undefined, now: Date): string {
  if (!eta) return '';
  const ms = new Date(eta).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `about ${Math.max(1, min)} min left`;
  const h = Math.round(min / 60);
  return h < 48 ? `about ${h} h left` : `about ${Math.round(h / 24)} days left`;
}

/** Combined progress of several queue entries (each episode is its own entry): the average of the known percents. */
function overall(list: readonly DownloadInfo[]): { percent?: number; eta?: string } {
  const pcts = list.map(d => d.percent).filter((p): p is number => p != null);
  const etas = list.map(d => d.eta).filter((e): e is string => !!e).sort();
  return { percent: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : undefined, eta: etas[etas.length - 1] };
}

/** "Season 2", "Seasons 1 and 2". */
const seasonWords = (ns: readonly number[]): string => {
  const s = [...ns].sort((a, b) => a - b);
  if (s.length === 1) return `Season ${s[0]}`;
  return `Seasons ${s.slice(0, -1).join(', ')} and ${s[s.length - 1]}`;
};

/**
 * What is the request waiting for? A future date, or null when it is out and only needs to be found.
 * Films: the cinema date first; once in cinemas, the digital/disc date (that is what a downloader can find).
 * Shows: the first air date of the requested seasons (or the next episode) when none of them has aired yet.
 */
export function releaseWait(mediaType: 'movie' | 'tv', facts: TitleFacts | null | undefined, seasons: readonly number[] | undefined, now: Date): { date?: string; text: string } | null {
  if (!facts) return null;
  const today = isoDay(now);
  if (mediaType === 'movie') {
    if (facts.releaseDate && facts.releaseDate > today) return { date: facts.releaseDate, text: `comes out ${longDate(facts.releaseDate, now)}` };
    if (facts.homeRelease && facts.homeRelease > today) return { date: facts.homeRelease, text: `in cinemas now, available for download from ${longDate(facts.homeRelease, now)}` };
    // in cinemas recently with no digital/disc date announced yet: nothing to download for a while
    if (!facts.homeRelease && facts.releaseDate && now.getTime() - new Date(`${facts.releaseDate}T00:00:00`).getTime() < 100 * DAY) {
      return { text: 'in cinemas now, not available for download yet' };
    }
    return null;
  }
  const airs = facts.seasonAirDates ?? {};
  const wanted = (seasons?.length ? seasons : Object.keys(airs).map(Number)).filter(n => n > 0);
  const dates = wanted.map(n => airs[String(n)]);
  const aired = dates.some(d => d && d <= today);
  if (!aired) {
    const next = [facts.nextAirDate, ...dates].filter((d): d is string => !!d && d > today).sort()[0];
    if (next) return { date: next, text: `comes out ${longDate(next, now)}` };
    if (facts.releaseDate && facts.releaseDate > today) return { date: facts.releaseDate, text: `comes out ${longDate(facts.releaseDate, now)}` };
  }
  return null;
}

/**
 * Was this request's title in the library and then removed? Seerr marks the media "deleted" (7) and leaves the request
 * completed (5) or approved (2). A live download means it is coming back, so that is not "removed".
 */
export const isRemoved = (r: Pick<StageInput, 'requestStatus' | 'mediaStatus' | 'downloads'>): boolean =>
  r.mediaStatus === 7 && (r.requestStatus === 5 || r.requestStatus === 2) && !r.downloads.length;

export function requestStage(r: StageInput, facts: TitleFacts | null | undefined, now: Date = new Date()): Stage {
  const asked = relativeTime(r.createdAt, now).toLowerCase();
  const decidedAt = relativeTime(r.updatedAt ?? r.createdAt, now).toLowerCase();
  const ms = r.mediaStatus;

  if (r.requestStatus === 3) return { id: 'declined', step: 1, group: 'declined', short: 'Declined', line: `Declined ${decidedAt}` };

  // in the library (whole, or the seasons that were asked for)
  if (ms === 5) return { id: 'available', step: 4, group: 'added', short: 'Ready to watch', line: `Added to the library · ready to watch` };
  if (ms === 4) {
    const ready = facts?.seasonsReady ?? [];
    const asked4 = (r.seasons ?? []).filter(n => n > 0);
    if (asked4.length && asked4.every(n => ready.includes(n))) {
      return { id: 'available', step: 4, group: 'added', short: 'Ready to watch', line: `${seasonWords(asked4)} ${asked4.length === 1 ? 'is' : 'are'} in the library · ready to watch` };
    }
    const have = asked4.length ? ready.filter(n => asked4.includes(n)) : ready;
    const partly = (facts?.seasonsPartly ?? []).filter(n => !asked4.length || asked4.includes(n));
    const line = have.length ? `${seasonWords(have)} ${have.length === 1 ? 'is' : 'are'} ready to watch · the rest is on the way`
      : partly.length ? `Some episodes of ${seasonWords(partly)} are ready to watch · the rest is on the way` : 'Partly in the library · the rest is on the way';
    return { id: 'partial', step: 4, group: 'onway', short: 'Partly ready', line };
  }
  // was in the library, then removed (Seerr media status 7 "deleted"): its own red group, can be asked for again
  if (isRemoved(r)) return { id: 'removed', step: 4, group: 'removed', short: 'Removed', line: 'Removed from the library' };
  if (r.requestStatus === 5) {
    return { id: 'available', step: 4, group: 'added', short: 'Done', line: 'Finished' };
  }

  if (r.requestStatus === 1) return { id: 'requested', step: 0, group: 'pending', short: 'Waiting for a yes', line: `Requested ${asked} · waiting for a yes` };
  if (r.requestStatus === 4) return { id: 'failed', step: 1, group: 'onway', short: 'Needs a look', line: 'Approved, but it could not be sent to the downloader · the server owner needs to look at it' };

  // approved (2): downloading only with real queue entries
  if (r.downloads.length) {
    const o = overall(r.downloads);
    const parts = ['Downloading', o.percent != null ? `${o.percent}%` : '', etaText(o.eta, now)].filter(Boolean);
    return { id: 'downloading', step: 3, group: 'onway', short: o.percent != null ? `Downloading ${o.percent}%` : 'Downloading', line: parts.join(' · '), percent: o.percent, eta: o.eta };
  }
  const wait = releaseWait(r.mediaType, facts, r.seasons, now);
  if (wait) {
    return { id: 'waiting', step: 2, group: 'onway', short: wait.date ? `Out ${shortDate(wait.date)}` : 'Not out yet', line: `Approved ${decidedAt} · ${wait.text}`, waitsFor: wait.date };
  }
  return { id: 'waiting', step: 2, group: 'onway', short: 'Searching', line: facts ? `Approved ${decidedAt} · searching for a copy` : `Approved ${decidedAt} · waiting to download` };
}

export const GROUPS: ReadonlyArray<{ id: StageGroup; label: string; empty: string }> = [
  { id: 'pending', label: 'Waiting for a yes', empty: 'Nothing is waiting for a yes.' },
  { id: 'onway', label: 'On the way', empty: 'Nothing on the way right now.' },
  { id: 'added', label: 'Added to the library', empty: 'Nothing added yet.' },
  { id: 'removed', label: 'Removed', empty: 'Nothing has been removed from the library.' },
  { id: 'declined', label: 'Declined', empty: 'Nothing declined.' },
];

/**
 * The status line of a title in the details sheet (no single request in hand: Seerr's media status for everyone).
 * null when nobody has asked for it and it is not in the library.
 */
export function titleStatus(
  d: { mediaType: 'movie' | 'tv'; mediaStatus?: number; downloads?: readonly DownloadInfo[]; facts?: TitleFacts; seasons?: ReadonlyArray<{ number: number; state?: string }> },
  now: Date = new Date(),
): { tone: 'ok' | 'info' | 'wait' | 'bad'; text: string } | null {
  const ms = d.mediaStatus;
  if (ms === 7 && !d.downloads?.length) return { tone: 'bad', text: 'Removed from the library · you can request it again' };
  if (ms === 5) return { tone: 'ok', text: 'In the library · ready to watch' };
  if (ms === 4) {
    const ready = d.facts?.seasonsReady ?? d.seasons?.filter(s => s.state === 'available').map(s => s.number) ?? [];
    return { tone: 'ok', text: ready.length ? `${seasonWords(ready)} ${ready.length === 1 ? 'is' : 'are'} in the library` : 'Partly in the library' };
  }
  if (d.downloads?.length) {
    const o = overall(d.downloads);
    return { tone: 'info', text: ['Downloading', o.percent != null ? `${o.percent}%` : '', etaText(o.eta, now)].filter(Boolean).join(' · ') };
  }
  if (ms === 2) return { tone: 'wait', text: 'Requested · waiting for a yes' };
  if (ms === 3) {
    const wanted = d.seasons?.filter(s => s.state === 'approved' || s.state === 'downloading').map(s => s.number);
    const w = releaseWait(d.mediaType, d.facts, wanted, now);
    return { tone: 'info', text: w ? `Approved · ${w.text}` : 'Approved · searching for a copy' };
  }
  return null;
}
