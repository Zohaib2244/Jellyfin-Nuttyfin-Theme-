/** Markup builders for the Requests page: result cards, request rows with their status flow, problem rows. */
import { imageUrl, tmdbImage } from '../../api';
import type { SeerrCapabilities, SeerrIssue } from '../../api/desk-types';
import type { RequestState, SeerrRequest, SeerrResult } from '../../api/types';
import { phAttrs } from '../../lib/dom';
import { esc, html, raw, type SafeHtml } from '../../lib/html';
import { relativeTime } from '../../lib/format';
import { ic } from '../common/icons';
import { requestLabel } from '../home/model';
import { canCancel, canDecide, flowSteps, isMine, seasonsText, statusLine } from './model';

const CHIP_ICON = { requested: 'clock', approved: 'check', downloading: 'dl', available: 'check', declined: 'x' } as const;

/** Status chip: Requested, Approved, Processing, Available, Partially available, Declined. */
export function chipFor(state: RequestState | undefined, partial = false): SafeHtml {
  if (!state) return raw('');
  if (partial && state === 'available') return html`<span class="chip partial">${ic('layers')}Partially available</span>`;
  return html`<span class="chip ${state}">${ic(CHIP_ICON[state])}${requestLabel(state).short}</span>`;
}

/** Poster on a .ph gradient. */
export function posterOf(x: { jellyfinId?: string; posterPath?: string; title: string; tmdbId: number }, w = 342): SafeHtml {
  // TMDB's poster first (always right, even when Seerr holds a stale library id); the library's own picture when TMDB has none
  const src = tmdbImage(x.posterPath, w > 300 ? 'w342' : 'w185') ?? (x.jellyfinId ? imageUrl(x.jellyfinId, 'Primary', { maxWidth: w, quality: 85 }) : undefined);
  return html`<span class="ph pst" ${raw(phAttrs(x.jellyfinId ?? `tmdb${x.tmdbId}`, x.title))}>${src ? raw(`<img src="${esc(src)}" alt="" loading="lazy" decoding="async">`) : ''}</span>`;
}

const kindWord = (t: 'movie' | 'tv'): string => (t === 'tv' ? 'Show' : 'Film');
export const metaOf = (t: 'movie' | 'tv', year?: number): string => [kindWord(t), year].filter(Boolean).join(' · ');

/** A search result as a poster card. The whole card opens the "Ask for it" sheet. */
export function askCard(r: SeerrResult, i = 0): SafeHtml {
  const inLib = r.state === 'available' && !r.partial;
  return html`<li class="rq-card" style="--i:${i}">
    <button type="button" class="rq-open" data-open="${r.tmdbId}" data-type="${r.mediaType}" aria-label="${r.title}, ${metaOf(r.mediaType, r.year)}${r.state ? `, ${r.partial ? 'partially available' : requestLabel(r.state).short.toLowerCase()}` : ''}. ${inLib ? 'See details' : 'Ask for it'}">
      ${posterOf({ ...r, jellyfinId: r.jellyfinId }, 342)}
      <b>${r.title}</b><small>${metaOf(r.mediaType, r.year)}</small>
    </button>
    <span class="rq-act">${r.state ? chipFor(r.state, r.partial) : html`<span class="rq-pill">${ic('plus')}Ask for it</span>`}</span>
  </li>`;
}

/** Four steps: Asked, Approved, Downloading (with %), Ready to watch. */
export function flowList(r: SeerrRequest): SafeHtml {
  const steps = flowSteps(r);
  if (!steps) return raw('');
  const now = steps.find(s => s.status === 'now')?.label ?? 'Ready to watch';
  return html`<ol class="rq-steps" aria-label="Where it is: ${r.state === 'available' ? 'Ready to watch' : now}">${steps.map(s => html`<li class="${s.status}" ${s.status === 'now' ? raw('aria-current="step"') : ''}><i aria-hidden="true"></i><span>${s.label}</span></li>`)}</ol>
    ${r.state === 'downloading' && r.progress != null ? html`<span class="prog rq-prog" role="progressbar" aria-label="${r.title} downloaded" aria-valuenow="${r.progress}" aria-valuemin="0" aria-valuemax="100"><i style="width:${r.progress}%"></i></span>` : ''}`;
}

export interface RowCtx { caps: SeerrCapabilities | null; scope: 'mine' | 'all'; now: Date }

/** One request: poster, title, who and when, the status flow, and what this person may do with it. */
export function requestRow(r: SeerrRequest, c: RowCtx): SafeHtml {
  const title = r.title || `${kindWord(r.mediaType)} #${r.tmdbId}`;
  const when = r.createdAt ? relativeTime(r.createdAt, c.now).toLowerCase() : '';
  const who = c.scope === 'all' && !isMine(r, c.caps) ? `${r.requestedBy || 'Someone'} asked` : c.scope === 'all' ? 'You asked' : 'Asked';
  const seasons = r.mediaType === 'tv' ? seasonsText(r.seasons) : '';
  const ready = r.state === 'available' || r.partial;
  const libLinks: SafeHtml = r.jellyfinId && ready
    ? html`${r.mediaType === 'movie' ? html`<a class="btn sm primary" href="#/watch/${r.jellyfinId}" aria-label="Play ${title}">${ic('play')}Play</a>` : ''}<a class="btn sm ${r.mediaType === 'movie' ? '' : 'primary'}" href="#/title/${r.jellyfinId}" aria-label="Details of ${title}">${r.mediaType === 'movie' ? '' : ic('play')}Details</a>`
    : raw('');
  return html`<article class="rq-row ${r.state}" data-req-id="${r.id}" aria-label="${title}">
    ${r.jellyfinId ? html`<a class="rq-poster" href="#/title/${r.jellyfinId}" tabindex="-1" aria-hidden="true">${posterOf({ ...r, title }, 185)}</a>` : html`<span class="rq-poster">${posterOf({ ...r, title }, 185)}</span>`}
    <div class="rq-body">
      <h3>${title}</h3>
      <p class="rq-meta">${[metaOf(r.mediaType, r.year), seasons, c.scope === 'all' || when ? `${who}${when ? ` ${when}` : ''}` : '', r.is4k ? '4K' : ''].filter(Boolean).join(' · ')}</p>
      ${r.state === 'declined' || r.failed ? html`<p class="rq-note ${r.failed ? 'warn' : ''}">${statusLine(r)}</p>` : html`${flowList(r)}<p class="rq-note">${statusLine(r)}</p>`}
    </div>
    <div class="rq-side">
      <span class="rq-chip">${chipFor(r.state, r.partial)}</span>
      <div class="rq-btns">
        ${libLinks}
        ${canDecide(r, c.caps) ? html`<button class="btn sm primary" type="button" data-act="approve" data-id="${r.id}" aria-label="Approve ${title}">${ic('check')}Approve</button><button class="btn sm" type="button" data-act="decline" data-id="${r.id}" aria-label="Decline ${title}">${ic('x')}Decline</button>` : ''}
        ${canCancel(r, c.caps) && !libLinks.value ? html`<button class="btn sm ghost" type="button" data-act="cancel" data-id="${r.id}" aria-label="Cancel the request for ${title}">Cancel request</button>` : ''}
      </div>
    </div>
  </article>`;
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

export const skeletonGrid = (n = 6): string => `<div class="rq-skgrid" aria-hidden="true">${'<div><i class="rq-sk poster"></i><i class="rq-sk line"></i></div>'.repeat(n)}</div>`;
export const skeletonRows = (n = 3): string => `<div class="rq-skrows" aria-hidden="true">${'<div><i class="rq-sk pic"></i><span><i class="rq-sk line"></i><i class="rq-sk line s"></i></span></div>'.repeat(n)}</div>`;
