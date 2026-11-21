/** Pure view-models for the Requests page (no DOM, no fetching): quota wording, status flow, who may do what, season choices. */
import type { RequestFilter, SeasonInfo, SeerrCapabilities, SeerrDetail } from '../../api/desk-types';
import type { QuotaLine, RequestState, SeerrQuota, SeerrRequest } from '../../api/types';

export const FILTERS: ReadonlyArray<{ id: RequestFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting for a yes' },
  { id: 'onway', label: 'On its way' },
  { id: 'ready', label: 'Ready to watch' },
  { id: 'declined', label: 'Declined' },
];

export const isFilter = (v: string | null | undefined): v is RequestFilter => FILTERS.some(f => f.id === v);

const windowText = (days: number | null): string =>
  days == null ? '' : days === 7 ? ' this week' : days === 1 ? ' today' : days === 30 || days === 31 ? ' this month' : ` in any ${days} days`;

/** "2 film requests left this week", "No limit on shows", or null when the quota is unknown. */
export function quotaText(line: QuotaLine | null | undefined, mediaType: 'movie' | 'tv'): string | null {
  if (!line) return null;
  const noun = mediaType === 'movie' ? 'film' : 'show';
  if (line.limit == null) return `No limit on ${noun} requests`;
  const left = Math.max(0, line.remaining ?? line.limit - line.used);
  return left === 0 ? `No ${noun} requests left${windowText(line.days)}` : `${left} ${noun} request${left === 1 ? '' : 's'} left${windowText(line.days)}`;
}

/** Number left, or null for unlimited / unknown. */
export const quotaLeft = (q: SeerrQuota | null, mediaType: 'movie' | 'tv'): number | null => {
  const l = q?.[mediaType];
  return !l || l.limit == null ? null : Math.max(0, l.remaining ?? l.limit - l.used);
};

/** One short sentence on the whole quota for the page header ("3 film requests left this week · No limit on shows"). */
export function quotaSummary(q: SeerrQuota | null): string {
  if (!q) return '';
  return [quotaText(q.movie, 'movie'), quotaText(q.tv, 'tv')].filter(Boolean).join(' · ');
}

/** Why this person cannot ask for this kind of thing (null = they can). */
export function cannotRequest(caps: SeerrCapabilities | null, mediaType: 'movie' | 'tv'): string | null {
  if (!caps) return 'Requests are not available right now.';
  const ok = mediaType === 'movie' ? caps.perms.requestMovie : caps.perms.requestTv;
  return ok ? null : `Your account is not allowed to ask for ${mediaType === 'movie' ? 'films' : 'shows'}. Ask the server owner to turn it on for you.`;
}

/* ── status flow: Asked, Approved, Downloading (with %), Ready to watch ── */
export interface FlowStep { label: string; status: 'done' | 'now' | 'todo' }

export function flowSteps(r: Pick<SeerrRequest, 'state' | 'progress'>): FlowStep[] | null {
  if (r.state === 'declined') return null;
  const at = r.state === 'requested' ? 0 : r.state === 'approved' ? 1 : r.state === 'downloading' ? 2 : 3;
  const labels = ['Asked', 'Approved', r.state === 'downloading' && r.progress != null ? `Downloading ${r.progress}%` : 'Downloading', 'Ready to watch'];
  return labels.map((label, i): FlowStep => ({ label, status: i < at || (i === at && at === 3) ? 'done' : i === at ? 'now' : 'todo' }));
}

/** A plain sentence about where a request is. */
export function statusLine(r: Pick<SeerrRequest, 'state' | 'progress' | 'failed' | 'partial' | 'mediaType'>): string {
  if (r.failed) return 'It could not be sent to the downloader. The server owner needs to look at it.';
  switch (r.state) {
    case 'requested': return 'Waiting for the server owner to say yes.';
    case 'approved': return 'Approved. It will start downloading soon.';
    case 'downloading': return r.progress != null ? `Downloading, ${r.progress}% done.` : 'Downloading now.';
    case 'available': return r.partial ? 'Some of it is ready to watch. The rest is on its way.' : 'Ready to watch.';
    case 'declined': return 'The server owner said no to this one.';
  }
}

/** "Season 1", "Seasons 1 and 2", "Seasons 1, 2 and 4", "All seasons". */
export function seasonsText(seasons: readonly number[] | undefined): string {
  if (!seasons?.length) return '';
  const s = [...seasons].sort((a, b) => a - b);
  const name = (n: number): string => (n === 0 ? 'Specials' : String(n));
  if (s.length === 1) return s[0] === 0 ? 'Specials' : `Season ${s[0]}`;
  return `Seasons ${s.slice(0, -1).map(name).join(', ')} and ${name(s[s.length - 1] as number)}`;
}

/* ── who may do what ── */
export const isMine = (r: SeerrRequest, caps: SeerrCapabilities | null): boolean => !!caps && r.requestedById === caps.userId;
/** Own request that is still waiting, or anything unfinished for people with the manage permission. */
export const canCancel = (r: SeerrRequest, caps: SeerrCapabilities | null): boolean =>
  !!caps && ((caps.perms.manageRequests && r.state !== 'available') || (isMine(r, caps) && r.state === 'requested'));
export const canDecide = (r: SeerrRequest, caps: SeerrCapabilities | null): boolean => !!caps && caps.perms.manageRequests && r.state === 'requested';

/** Open = not finished and not declined (what the rail badge counts). */
export const isOpen = (r: Pick<SeerrRequest, 'state'>): boolean => r.state !== 'available' && r.state !== 'declined';

/* ── seasons ── */
const TAKEN: Record<RequestState, string> = {
  requested: 'Already asked for', approved: 'Already approved', downloading: 'Downloading now', available: 'Already in the library', declined: '',
};
export const takenText = (s: SeasonInfo): string => (s.state ? TAKEN[s.state] : '');

/** Seasons somebody can still ask for: not in the library, not asked for yet, aired or announced; specials only when allowed. */
export function requestableSeasons(d: Pick<SeerrDetail, 'seasons'>, specials: boolean): SeasonInfo[] {
  return d.seasons.filter(s => (specials || s.number !== 0) && (!s.state || s.state === 'declined'));
}

export function seasonList(d: Pick<SeerrDetail, 'seasons'>, specials: boolean): SeasonInfo[] {
  return d.seasons.filter(s => specials || s.number !== 0);
}

/** Can this film/show be asked for at all right now? Returns the reason when not. */
export function blockedReason(d: SeerrDetail, caps: SeerrCapabilities | null, left: number | null): { text: string; tone: 'info' | 'bad' } | null {
  const perm = cannotRequest(caps, d.mediaType);
  if (perm) return { text: perm, tone: 'bad' };
  if (d.mediaType === 'movie') {
    if (d.state === 'available') return { text: d.jellyfinId ? 'This film is already in the library.' : 'This film is already available.', tone: 'info' };
    if (d.state === 'requested' || d.state === 'approved' || d.state === 'downloading') return { text: 'Someone already asked for this film. You can follow it in your requests.', tone: 'info' };
  } else if (caps && requestableSeasons(d, caps.specials).length === 0) {
    return { text: d.state === 'available' ? 'Every season is already in the library.' : 'Every season has already been asked for or is in the library.', tone: 'info' };
  }
  if (left === 0) return { text: 'You have used up your requests for now. They come back a little later, or ask the server owner for more.', tone: 'bad' };
  return null;
}

/** What to POST for seasons: 'all' when the whole show is wanted and nothing is taken, else the exact numbers. */
export function seasonsToAsk(d: Pick<SeerrDetail, 'seasons'>, specials: boolean, mode: 'all' | 'pick', picked: ReadonlySet<number>): number[] | 'all' {
  const open = requestableSeasons(d, specials).map(s => s.number);
  if (mode === 'pick') return open.filter(n => picked.has(n));
  const everything = seasonList(d, specials);
  return everything.length === open.length ? 'all' : open;
}

/** Button text: "Ask for this film", "Ask for the whole show", "Ask for 2 seasons". */
export function askLabel(mediaType: 'movie' | 'tv', seasons: number[] | 'all'): string {
  if (mediaType === 'movie') return 'Ask for this film';
  if (seasons === 'all') return 'Ask for the whole show';
  return seasons.length === 0 ? 'Pick a season' : seasons.length === 1 ? 'Ask for 1 season' : `Ask for ${seasons.length} seasons`;
}

/* ── quality choices in plain words ── */
export interface QualityChoice {
  /** profile id as text; '' = the server's usual choice */
  value: string;
  label: string;
  /** the real profile name, for the owner's small details line only */
  profile: string;
}

/** "Ultra-HD" -> "Ultra HD (4K)", "HD-1080p" -> "HD 1080p", "720p x265 (MeGusta > ELiTE)" -> "HD 720p (smaller files)". Never shows release-group tags. */
export function friendlyQuality(name: string): string {
  const small = /x265|hevc|h\.?265/i.test(name) ? ' (smaller files)' : '';
  if (/ultra|2160|4k|uhd/i.test(name)) return `Ultra HD (4K)${small}`;
  if (/720.*1080|1080.*720/.test(name)) return `HD 720p/1080p${small}`;
  if (/1080/.test(name)) return `HD 1080p${small}`;
  if (/720/.test(name)) return `HD 720p${small}`;
  if (/\bsd\b|480|576/i.test(name)) return `Smaller picture (SD)${small}`;
  if (/^\s*any\s*$/i.test(name)) return 'Any quality';
  if (/\bhd\b/i.test(name)) return `HD${small}`;
  return name.replace(/\s*\([^)]*\)/g, '').trim() || name;
}

/** The Quality list: "Standard" first (the server's default, listed once), then the others by friendly name. */
export function qualityChoices(list: ReadonlyArray<{ id: number; name: string }>, defaultId?: number): QualityChoice[] {
  const def = list.find(p => p.id === defaultId);
  const others = list.filter(p => p.id !== defaultId);
  const labels = others.map(p => friendlyQuality(p.name));
  const seen = new Map<string, number>();
  const out: QualityChoice[] = [{ value: '', label: 'Standard', profile: def?.name ?? '' }];
  others.forEach((p, i) => {
    let label = labels[i] as string;
    const dup = labels.filter(l => l === label).length > 1 || label === 'Standard';
    if (dup) { const n = (seen.get(label) ?? 0) + 1; seen.set(label, n); label = `${label} (${n})`; }
    out.push({ value: String(p.id), label, profile: p.name });
  });
  return out;
}
