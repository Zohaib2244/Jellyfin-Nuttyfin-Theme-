/** Markup builders for the Requests page: Discover posters and genre tiles, request rows with their stepper, problem rows. */
import { imageUrl, tmdbImage } from '../../api';
import type { DeskRequest, DiscoverItem, GenreTile, SeerrCapabilities, SeerrIssue } from '../../api/desk-types';
import type { RequestState, SeerrResult } from '../../api/types';
import { phAttrs } from '../../lib/dom';
import { esc, html, raw, type SafeHtml } from '../../lib/html';
import { relativeTime } from '../../lib/format';
import { ic } from '../common/icons';
import { requestLabel } from '../home/model';
import { seasonsText } from './model';
import { STEPS, type Stage } from './stage';

const CHIP_ICON = { requested: 'clock', approved: 'check', downloading: 'dl', available: 'check', declined: 'x' } as const;

/** Status chip: Requested, Approved, Processing, Available, Partially available, Declined. */
export function chipFor(state: RequestState | undefined, partial = false): SafeHtml {
  if (!state) return raw('');
  if (partial && state === 'available') return html`<span class="chip partial">${ic('layers')}Partially available</span>`;
  return html`<span class="chip ${state}">${ic(CHIP_ICON[state])}${requestLabel(state).short}</span>`;
}

/** TMDB backdrop (wider sizes than tmdbImage offers). */
export const tmdbBackdrop = (path: string | undefined, size: 'w300' | 'w780' | 'w1280' = 'w780'): string | undefined =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;

/** Poster on a .ph gradient. */
export function posterOf(x: { jellyfinId?: string; posterPath?: string; title: string; tmdbId: number }, w = 342): SafeHtml {
  // TMDB's poster first (always right, even when Seerr holds a stale library id); the library's own picture when TMDB has none
  const src = tmdbImage(x.posterPath, w > 300 ? 'w342' : 'w185') ?? (x.jellyfinId ? imageUrl(x.jellyfinId, 'Primary', { maxWidth: w, quality: 85 }) : undefined);
  return html`<span class="ph pst" ${raw(phAttrs(x.jellyfinId ?? `tmdb${x.tmdbId}`, x.title))}>${src ? raw(`<img src="${esc(src)}" alt="" loading="lazy" decoding="async">`) : ''}</span>`;
}

const kindWord = (t: 'movie' | 'tv'): string => (t === 'tv' ? 'Show' : 'Film');
export const metaOf = (t: 'movie' | 'tv', year?: number): string => [kindWord(t), year].filter(Boolean).join(' · ');

/* ── Discover ── */
type Mark = { cls: string; label: string; icon: 'check' | 'layers' | 'clock' | 'dl' };
/** Seerr's status marks on a poster. Nothing when nobody has asked for it. */
export function markOf(r: Pick<SeerrResult, 'state' | 'partial'>): Mark | null {
  switch (r.state) {
    case 'available': return r.partial ? { cls: 'partial', label: 'Partly available', icon: 'layers' } : { cls: 'available', label: 'Available', icon: 'check' };
    case 'requested': return { cls: 'requested', label: 'Requested', icon: 'clock' };
    case 'approved': case 'downloading': return { cls: 'processing', label: 'Processing', icon: 'dl' };
    default: return null;
  }
}

/** A poster tile (rails and grids). The whole tile opens the details sheet. */
export function posterTile(r: DiscoverItem | SeerrResult, i = 0): SafeHtml {
  const mark = markOf(r);
  const label = `${r.title}, ${metaOf(r.mediaType, r.year)}${mark ? `, ${mark.label.toLowerCase()}` : ''}`;
  return html`<li class="rq-tile" style="--i:${Math.min(i, 12)}">
    <button type="button" class="rq-open" data-open="${r.tmdbId}" data-type="${r.mediaType}" data-title="${r.title}" aria-label="${label}">
      <span class="rq-art">${posterOf(r, 342)}
        <span class="rq-kind ${r.mediaType}" aria-hidden="true">${r.mediaType === 'tv' ? 'Show' : 'Film'}</span>
        ${mark ? html`<span class="rq-mark ${mark.cls}" aria-hidden="true" title="${mark.label}">${ic(mark.icon)}</span>` : ''}
      </span>
      <b>${r.title}</b><small>${r.year ?? ''}${mark ? html`<span class="rq-markword ${mark.cls}"> · ${mark.label}</span>` : ''}</small>
    </button>
  </li>`;
}

/** A wide coloured genre tile with a backdrop, like Seerr's genre sliders. */
export function genreTile(g: GenreTile, mediaType: 'movie' | 'tv', i: number): SafeHtml {
  const bg = tmdbBackdrop(g.backdrop, 'w780');
  return html`<li class="rq-gtile" style="--i:${Math.min(i, 12)}">
    <button type="button" class="rq-genre tone-${i % 6}" data-genre="${g.id}" data-gtype="${mediaType}" data-gname="${g.name}">
      ${bg ? raw(`<img src="${esc(bg)}" alt="" loading="lazy" decoding="async">`) : ''}<span>${g.name}</span>
    </button>
  </li>`;
}

export const skeletonRail = (n = 8): string => `<ul class="rq-rail sk" aria-hidden="true">${'<li class="rq-tile"><i class="rq-sk poster"></i><i class="rq-sk line"></i></li>'.repeat(n)}</ul>`;
export const skeletonGrid = (n = 6): string => `<div class="rq-skgrid" aria-hidden="true">${'<div><i class="rq-sk poster"></i><i class="rq-sk line"></i></div>'.repeat(n)}</div>`;
export const skeletonRows = (n = 3): string => `<div class="rq-skrows" aria-hidden="true">${'<div><i class="rq-sk pic"></i><span><i class="rq-sk line"></i><i class="rq-sk line s"></i></span></div>'.repeat(n)}</div>`;

/* ── request rows ── */
/** Five dots: Requested, Approved, Waiting, Downloading, In the library. Declined has no stepper. */
export function stepper(s: Stage): SafeHtml {
  if (s.id === 'declined') return raw('');
  const bad = s.id === 'failed';
  return html`<ol class="rq-stepper ${s.id}" aria-label="Progress: ${STEPS[s.step]}, step ${s.step + 1} of ${STEPS.length}">${STEPS.map((label, i) => {
    const st = i < s.step || (i === s.step && s.step === 4 && s.id !== 'partial') ? 'done' : i === s.step ? (bad ? 'bad' : 'now') : 'todo';
    return html`<li class="${st}" ${i === s.step ? raw('aria-current="step"') : ''}><i aria-hidden="true"></i><span>${label}</span></li>`;
  })}</ol>`;
}

export interface RowCtx {
  caps: SeerrCapabilities | null;
  /** show who asked (admin view of everyone) */
  showWho: boolean;
  now: Date;
  /** title facts are still loading for this row */
  loading: boolean;
}

/** One request: poster, title, who and when, the stepper with its plain line, and what this person may do with it. */
export function requestRow(r: DeskRequest, s: Stage, c: RowCtx): SafeHtml {
  const title = r.title || (c.loading ? 'Loading…' : `${kindWord(r.mediaType)} #${r.tmdbId}`);
  const named = r.title || `this ${kindWord(r.mediaType).toLowerCase()}`;
  const mine = !!c.caps && r.requestedById === c.caps.userId;
  const who = c.showWho ? (mine ? 'You' : (r.requestedBy || 'Someone')) : '';
  const when = r.createdAt ? relativeTime(r.createdAt, c.now).toLowerCase() : '';
  const meta = [metaOf(r.mediaType, r.year), r.mediaType === 'tv' ? seasonsText(r.seasons) : '', r.is4k ? '4K' : ''].filter(Boolean).join(' · ');
  const decide = !!c.caps?.perms.manageRequests && r.requestStatus === 1;
  const lib = (s.id === 'available' || s.id === 'partial') && r.jellyfinId;
  return html`<li class="rq-row g-${s.group}" data-req-id="${r.id}">
    <button type="button" class="rq-rowopen" data-open="${r.tmdbId}" data-type="${r.mediaType}" data-title="${r.title}" aria-label="${title}: details">
      <span class="rq-poster">${posterOf({ ...r, title }, 185)}</span>
    </button>
    <div class="rq-body">
      <h3><button type="button" class="rq-tlink ${r.title ? '' : 'loading'}" data-open="${r.tmdbId}" data-type="${r.mediaType}" data-title="${r.title}">${title}</button></h3>
      <p class="rq-meta">${meta}${who ? html` · <span class="rq-who">asked by ${who === 'You' ? 'you' : who}</span>` : s.id === 'requested' || !when ? '' : ` · asked ${when}`}</p>
      ${stepper(s)}
      <p class="rq-line ${s.id}">${s.line}</p>
      ${s.id === 'downloading' && s.percent != null ? html`<span class="prog rq-prog" role="progressbar" aria-label="${named} downloaded" aria-valuenow="${s.percent}" aria-valuemin="0" aria-valuemax="100"><i style="width:${s.percent}%"></i></span>` : ''}
    </div>
    ${decide || lib ? html`<div class="rq-btns">
      ${lib ? html`<a class="btn sm" href="#/title/${r.jellyfinId}" aria-label="Open ${named} in the library">${ic('play')}Open</a>` : ''}
      ${decide ? html`<button class="btn sm primary" type="button" data-act="approve" data-id="${r.id}" aria-label="Approve ${named}">${ic('check')}Approve</button>
        <button class="btn sm" type="button" data-act="decline" data-id="${r.id}" aria-label="Decline ${named}">${ic('x')}Decline</button>` : ''}
    </div>` : ''}
  </li>`;
}

const ISSUE_TEXT = { video: 'Picture', audio: 'Sound', subtitles: 'Subtitles', other: 'Something else' } as const;

/** One problem report of this person. */
export function issueRow(i: SeerrIssue, now: Date): SafeHtml {
  const title = i.title || 'Something in the library';
  const when = i.createdAt ? relativeTime(i.createdAt, now).toLowerCase() : '';
  return html`<li class="rq-issue ${i.status}">
    ${i.jellyfinId ? html`<a class="rq-poster sm" href="#/title/${i.jellyfinId}" tabindex="-1" aria-hidden="true">${posterOf({ ...i, title }, 185)}</a>` : html`<span class="rq-poster sm">${posterOf({ ...i, title }, 185)}</span>`}
    <div class="rq-body"><b>${title}</b><small>${ISSUE_TEXT[i.kind]} · ${when}</small>
      <p>${i.message.split('\n')[0]}</p>${i.replies ? html`<small class="rep">${ic('chat')}${i.replies} ${i.replies === 1 ? 'reply' : 'replies'} from the owner</small>` : ''}</div>
    <span class="chip ${i.status === 'resolved' ? 'available' : 'requested'}">${i.status === 'resolved' ? html`${ic('check')}Fixed` : html`${ic('clock')}Open`}</span>
  </li>`;
}
