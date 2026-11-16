/**
 * Seerr UI pieces: status chips, request rows with their status flow, poster result cards and the "Ask for
 * something" search. Kept free of Home internals (they only need a Backend) so the full Requests page can reuse them.
 */
import { ApiError, type Backend } from '../../api';
import type { RequestState, SeerrRequest, SeerrResult } from '../../api/types';
import { html, raw, type SafeHtml } from '../../lib/html';
import { relativeTime } from '../../lib/format';
import { icon } from '../../ui/icons';
import { nutbot } from '../../ui/nutbot';
import { img, ph, seerrPoster } from './art';
import { requestLabel } from './model';

const CHIP_ICON = { requested: 'clock', approved: 'check', downloading: 'dl', available: 'check', declined: 'x' } as const;

/** Status chip: Requested, Approved, Processing, Available, Declined. */
export function statusChip(state: RequestState): SafeHtml {
  return html`<span class="chip ${state}">${icon(CHIP_ICON[state])}${requestLabel(state).short}</span>`;
}

/** Four steps a request moves through; `step` 0 = just asked ... 3 = ready. Declined has none. */
const STEPS = ['Asked', 'Approved', 'Processing', 'Ready'] as const;
export const stepOf = (s: RequestState): number => (s === 'requested' ? 0 : s === 'approved' ? 1 : s === 'downloading' ? 2 : s === 'available' ? 3 : -1);

export function flowDots(state: RequestState): SafeHtml {
  const at = stepOf(state);
  if (at < 0) return raw('');
  return html`<span class="flow" role="img" aria-label="Step ${at + 1} of 4: ${STEPS[at]}">${STEPS.map((_, i) => raw(`<i class="${i < at ? 'w' : i === at ? 'n' : ''}"></i>`))}</span>`;
}

const meta = (type: 'movie' | 'tv', year?: number): string => [type === 'tv' ? 'Show' : 'Film', year].filter(Boolean).join(' · ');

/** One request in a list: poster, title, "who/when · status", progress while processing, status chip. */
export function requestRow(r: SeerrRequest, now: Date = new Date()): SafeHtml {
  const when = r.createdAt ? relativeTime(r.createdAt, now) : '';
  const sub = r.state === 'downloading' && r.progress != null ? `On its way · ${r.progress}%`
    : [requestLabel(r.state).label, when ? `asked ${when.toLowerCase()}` : ''].filter(Boolean).join(' · ');
  const title = r.title || `${r.mediaType === 'tv' ? 'Show' : 'Film'} #${r.tmdbId}`;
  return html`<div class="row2 ritem" data-req-id="${r.id}">
    <span class="ph" ${ph(`tmdb${r.tmdbId}`, title)}>${img(seerrPoster(r, 'w185'))}</span>
    <span class="w"><b>${title}</b><small>${meta(r.mediaType, r.year)} · ${sub}</small>
      ${r.state === 'downloading' && r.progress != null ? html`<span class="prog" role="progressbar" aria-label="${title} downloaded" aria-valuenow="${r.progress}" aria-valuemin="0" aria-valuemax="100"><i style="width:${r.progress}%"></i></span>` : flowDots(r.state)}</span>
    <span class="cs">${statusChip(r.state)}</span>
  </div>`;
}

/** A poster card for a search result: status chip when Seerr already knows it, else a Request button. */
export function resultCard(r: SeerrResult, i = 0): SafeHtml {
  return html`<li class="rs" style="--i:${i}" data-tmdb="${r.tmdbId}">
    <span class="pst ph" ${ph(`tmdb${r.tmdbId}`, r.title)}>${img(seerrPoster(r, 'w342'))}</span>
    <b title="${r.title}">${r.title}</b><small>${meta(r.mediaType, r.year)}</small>
    <span class="act">${r.state ? statusChip(r.state)
    : html`<button class="minibtn" type="button" data-request="${r.tmdbId}" data-type="${r.mediaType}" aria-label="Request ${r.title}">${icon('plus')}Request</button>`}</span>
  </li>`;
}

export interface RequestsEnv {
  backend: Backend;
  signal: AbortSignal;
  /** called after a successful request (refresh lists, toast) */
  onRequested?(r: SeerrRequest): void;
}

/**
 * Search box + results + request buttons inside `host`. `idle` fills the area while the box is empty
 * (for example what the house asked for lately). Returns a cleanup.
 */
export function mountRequestSearch(host: HTMLElement, env: RequestsEnv, opts: { idle?: () => Promise<SeerrResult[]>; idleTitle?: string } = {}): () => void {
  host.innerHTML = `
    <form class="raform" role="search" autocomplete="off">
      <label class="sr" for="raq">Film or show to ask for</label>
      ${icon('search').value}
      <input id="raq" type="search" placeholder="Search for a film or show to ask for" maxlength="80">
      <button class="btn primary sm" type="submit">${icon('search').value}<span class="lbl">Search</span></button>
    </form>
    <div class="rres" aria-live="polite"></div>`;
  const form = host.querySelector('form') as HTMLFormElement;
  const input = host.querySelector('input') as HTMLInputElement;
  const out = host.querySelector('.rres') as HTMLElement;
  let timer = 0;
  let token = 0;
  let ctl: AbortController | null = null;

  const grid = (list: readonly SeerrResult[], heading: string): string =>
    `<p class="sub">${heading}</p><ul class="rasug">${list.map((r, i) => resultCard(r, i).value).join('')}</ul>`;
  const msg = (text: string): string => `<p class="quiet">${nutbot(34, 'look').value}<span>${text}</span></p>`;

  async function showIdle(): Promise<void> {
    const my = ++token;
    if (!opts.idle) { out.innerHTML = msg('Type a title above. If it is not in the library yet, you can ask for it.'); return; }
    out.innerHTML = '<div class="sk-strip posters" aria-hidden="true">' + '<div class="sk-card"><i class="sk sk-poster"></i><i class="sk sk-line"></i></div>'.repeat(6) + '</div>';
    try {
      const list = await opts.idle();
      if (my !== token) return;
      out.innerHTML = list.length ? grid(list.slice(0, 10), opts.idleTitle ?? 'Popular with the house right now') : msg('Type a title above. If it is not in the library yet, you can ask for it.');
    } catch { if (my === token) out.innerHTML = msg('Type a title above. If it is not in the library yet, you can ask for it.'); }
  }

  async function search(q: string): Promise<void> {
    const my = ++token;
    ctl?.abort();
    ctl = new AbortController();
    const signal = AbortSignal.any([ctl.signal, env.signal]);
    if (!(await env.backend.seerr.available())) { out.innerHTML = msg('Requests are not available right now. Everything else still works.'); return; }
    out.innerHTML = '<div class="sk-strip posters" aria-hidden="true">' + '<div class="sk-card"><i class="sk sk-poster"></i><i class="sk sk-line"></i></div>'.repeat(6) + '</div>';
    try {
      const list = await env.backend.seerr.search(q, signal);
      if (my !== token) return;
      out.innerHTML = list.length ? grid(list.slice(0, 12), `${list.length > 12 ? 'Top 12 of ' : ''}${list.length} result${list.length === 1 ? '' : 's'} for "${q.replace(/[<>&"]/g, '')}"`)
        : msg(`Nothing found for "${q.replace(/[<>&"]/g, '')}". Check the spelling, or try a shorter name.`);
    } catch (e) {
      if (my !== token || (e instanceof DOMException && e.name === 'AbortError')) return;
      out.innerHTML = msg('The search did not work just now. Try again in a moment.');
    }
  }

  const run = (): void => {
    window.clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { void showIdle(); return; }
    void search(q);
  };
  const onInput = (): void => { window.clearTimeout(timer); timer = window.setTimeout(run, 320); };
  const onSubmit = (e: Event): void => { e.preventDefault(); run(); };

  const onClick = async (e: Event): Promise<void> => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('[data-request]');
    if (!btn || btn.disabled) return;
    const tmdbId = Number(btn.dataset.request);
    const mediaType = btn.dataset.type === 'tv' ? 'tv' : 'movie';
    const act = btn.closest('.act') as HTMLElement;
    btn.disabled = true;
    btn.innerHTML = '<span class="dots3" aria-hidden="true"><i></i><i></i><i></i></span>Asking';
    try {
      const r = await env.backend.seerr.request({ mediaType, tmdbId });
      act.innerHTML = statusChip('requested').value;
      act.classList.add('flip');
      env.onRequested?.(r);
    } catch (err) {
      const text = err instanceof ApiError && err.status === 409 ? 'Already asked for' : 'Did not work. Try again';
      act.innerHTML = `<button class="minibtn" type="button" data-request="${tmdbId}" data-type="${mediaType}">${icon('undo').value}${text}</button>`;
    }
  };

  form.addEventListener('submit', onSubmit);
  input.addEventListener('input', onInput);
  host.addEventListener('click', e => { void onClick(e); });
  void showIdle();
  return () => { window.clearTimeout(timer); token++; ctl?.abort(); form.removeEventListener('submit', onSubmit); input.removeEventListener('input', onInput); };
}

/** "Asked -> Approved -> Processing -> Ready" with how many of YOUR requests sit at each step. */
export function flowSummary(requests: readonly SeerrRequest[]): SafeHtml {
  const count = (s: RequestState): number => requests.filter(r => r.state === s).length;
  const steps: Array<{ label: string; hint: string; n: number; ic: 'ask' | 'check' | 'dl' | 'play' }> = [
    { label: 'You ask', hint: 'Search above or tell NutBot.', n: count('requested'), ic: 'ask' },
    { label: 'It gets a yes', hint: 'The server owner approves it.', n: count('approved'), ic: 'check' },
    { label: 'It downloads', hint: 'Progress shows in your list.', n: count('downloading'), ic: 'dl' },
    { label: 'Ready to watch', hint: 'It lands in Newly Added.', n: count('available'), ic: 'play' },
  ];
  return html`<ol class="rfsteps">${steps.map((s, i) => html`<li class="${s.n ? 'has' : ''}">${icon(s.ic)}<b>${i + 1}. ${s.label}</b><small>${s.hint}</small>${s.n ? html`<span class="n" aria-label="${s.n} of yours here">${s.n}</span>` : ''}</li>`)}</ol>`;
}
