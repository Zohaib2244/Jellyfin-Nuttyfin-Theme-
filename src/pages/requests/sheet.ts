/**
 * The title sheet. Step 1 is the DETAILS view (backdrop, poster, facts, genres, overview, cast, trailer, status, and a
 * link into the library when it is there). Only when the person presses "Request" does step 2 appear in the same
 * dialog: the season picker for shows, quality / 4K when this Seerr offers them, the quota, and Confirm.
 * A centred dialog on desktop, a bottom sheet on phones (common/dialog).
 */
import type { Backend } from '../../api/backend';
import { explainRequestError } from '../../api/seerr-desk';
import type { DeskRequestInput, SeerrCapabilities, SeerrDetail } from '../../api/desk-types';
import type { SeerrQuota, SeerrRequest } from '../../api/types';
import { tmdbImage } from '../../api';
import { runtime } from '../../lib/format';
import { esc, html, raw, type SafeHtml } from '../../lib/html';
import { nutbot } from '../../ui/nutbot';
import { openDialog, type DialogHandle } from '../common/dialog';
import { morphHeight } from '../../lib/morph';
import { ic } from '../common/icons';
import { embedUrl } from '../details/trailer';
import { askLabel, blockedReason, qualityChoices, quotaLeft, quotaText, requestableSeasons, seasonList, seasonsToAsk, takenText } from './model';
import { longDate, titleStatus } from './stage';
import { metaOf, posterOf, tmdbBackdrop } from './ui';

export interface SheetEnv {
  backend: Backend;
  caps: SeerrCapabilities | null;
  quota(): Promise<SeerrQuota | null>;
  /** After anything changed (asked, cancelled): refresh the lists. */
  onChanged(): void;
  toast(message: string): void;
  /** Go to the Requests tab after asking. */
  showMine(): void;
}

export interface SheetTarget { tmdbId: number; mediaType: 'movie' | 'tv'; title?: string }

/** Trailer in its own dialog (youtube-nocookie embed). */
export function openTrailer(title: string, key: string): DialogHandle {
  return openDialog(html`<div class="rq-vid"><span class="spin" aria-hidden="true"></span><iframe src="${embedUrl(key)}" title="${title} trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`, {
    label: `${title} trailer`, className: 'video rq-dlg',
  });
}

export function openTitleSheet(env: SheetEnv, target: SheetTarget): DialogHandle {
  const dlg = openDialog(html`<div class="rq-sheet-load" role="status"><span class="spin" aria-hidden="true"></span><span>Looking ${target.title ? `at ${target.title}` : 'it up'}…</span></div>`, {
    label: target.title || 'Film or show', className: 'wide rq-dlg rq-detdlg',
  });
  void load();
  return dlg;

  async function load(): Promise<void> {
    const [d, q] = await Promise.all([env.backend.seerr.detail(target.mediaType, target.tmdbId).catch(() => null), env.quota().catch(() => null)]);
    if (!dlg.el.isConnected) return;
    if (!d) {
      dlg.body.innerHTML = html`<div class="okview">${nutbot(64, 'sleepy')}<h2 tabindex="-1" data-autofocus>Could not find that one</h2><p>The request service does not know it, or is not answering. Try again in a moment.</p><div class="acts"><button class="btn primary" type="button" data-close>Close</button></div></div>`.value;
      dlg.body.querySelector<HTMLElement>('[data-autofocus]')?.focus();
      return;
    }
    dlg.el.setAttribute('aria-label', d.title);
    details(d, q);
  }

  function focusFirst(sel = '[data-autofocus]'): void { dlg.body.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true }); }

  /* ── step 1: details ── */
  function details(d: SeerrDetail, q: SeerrQuota | null): void {
    const caps = env.caps;
    const left = quotaLeft(q, d.mediaType);
    const block = blockedReason(d, caps, left);
    const status = titleStatus(d);
    const length = d.mediaType === 'movie' ? (d.runtimeMin ? runtime(d.runtimeMin) : '') : d.seasonCount ? `${d.seasonCount} season${d.seasonCount === 1 ? '' : 's'}` : '';
    const now = new Date();
    const rel = d.facts?.releaseDate;
    const future = rel && rel > now.toISOString().slice(0, 10) ? `${d.mediaType === 'movie' ? 'Comes out' : 'Starts'} ${longDate(rel, now)}` : '';
    const meta = [metaOf(d.mediaType, d.year), length, future].filter(Boolean);
    const bg = tmdbBackdrop(d.backdropPath, 'w1280');
    const cast = (d.cast ?? []).slice(0, 6);
    const inLib = !!d.jellyfinId && (d.state === 'available');
    const canAsk = !block;
    // "already asked / in the library" is said by the status line; only show the reason when it adds something
    const showBlock = block && !(status && block.tone === 'info');

    const next = html`<article class="rq-det" aria-labelledby="rqdh">
      <div class="rq-hero ${bg ? '' : 'none'}">${bg ? raw(`<img src="${esc(bg)}" alt="" decoding="async">`) : ''}</div>
      <div class="rq-dhead">
        ${posterOf(d, 342)}
        <div class="rq-dtitle">
          <h2 id="rqdh" tabindex="-1">${d.title}</h2>
          <p class="rq-dmeta">${meta.join(' · ')}${d.rating ? html` · <span class="rq-rate">${ic('star')}${d.rating.toFixed(1)}<span class="sr"> out of 10</span></span>` : ''}</p>
          ${d.genres.length ? html`<ul class="rq-genres" aria-label="Genres">${d.genres.slice(0, 4).map(g => html`<li>${g}</li>`)}</ul>` : ''}
        </div>
      </div>
      ${status ? html`<p class="rq-dstatus ${status.tone}" role="status">${ic(status.tone === 'ok' ? 'check' : status.tone === 'wait' ? 'clock' : status.tone === 'bad' ? 'x' : 'dl')}<span>${status.text}</span></p>` : ''}
      <div class="rq-dacts">
        ${inLib ? html`<a class="btn primary" href="#/title/${d.jellyfinId}" data-go data-autofocus>${ic('play')}${d.mediaType === 'movie' ? 'Play or open in library' : 'Open in library'}</a>` : ''}
        ${canAsk ? html`<button class="btn ${inLib ? '' : 'primary'}" type="button" id="rq-req" ${inLib ? '' : raw('data-autofocus')}>${ic('ask')}${d.partial ? 'Request more seasons' : d.mediaStatus === 7 ? 'Request again' : 'Request'}</button>` : ''}
        ${d.trailer ? html`<button class="btn" type="button" id="rq-trailer" ${!inLib && !canAsk ? raw('data-autofocus') : ''}>${ic('trailer')}Trailer</button>` : ''}
        ${d.myRequestId ? html`<button class="btn ghost" type="button" id="rq-cancel">Cancel my request</button>` : ''}
      </div>
      ${showBlock && block ? html`<p class="rq-block ${block.tone}" role="${block.tone === 'bad' ? 'alert' : 'status'}">${ic(block.tone === 'bad' ? 'warn' : 'info')}<span>${block.text}</span></p>` : ''}
      <p class="rq-fail" id="rqmsg" role="alert" hidden></p>
      ${d.tagline ? html`<p class="rq-tagline">${d.tagline}</p>` : ''}
      ${d.overview ? html`<p class="rq-over">${d.overview}</p>` : ''}
      ${cast.length ? html`<h3 class="rq-dh3">Cast</h3><ul class="rq-cast">${cast.map(c => {
    const pic = tmdbImage(c.profilePath, 'w185');
    return html`<li><span class="rq-face">${pic ? raw(`<img src="${esc(pic)}" alt="" loading="lazy">`) : html`${c.name.split(' ').map(w => w[0]).slice(0, 2).join('')}`}</span><b>${c.name}</b>${c.character ? html`<small>${c.character}</small>` : ''}</li>`;
  })}</ul>` : ''}
    </article>`.value;
    morphHeight(dlg.el, () => { dlg.body.innerHTML = next; });
    if (!dlg.body.querySelector('[data-autofocus]')) dlg.body.querySelector<HTMLElement>('#rqdh')?.setAttribute('data-autofocus', '');
    focusFirst();
    dlg.body.scrollTop = 0;
    dlg.el.scrollTop = 0;

    dlg.body.onclick = e => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('[data-go]')) { dlg.close(); return; }
      if (e.target.closest('#rq-trailer') && d.trailer) { openTrailer(d.title, d.trailer.key); return; }
      if (e.target.closest('#rq-req')) { requestStep(d, q); return; }
      const c = e.target.closest<HTMLButtonElement>('#rq-cancel');
      if (c && d.myRequestId != null) void cancel(d, d.myRequestId, c);
    };
  }

  async function cancel(d: SeerrDetail, id: number, btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    try {
      await env.backend.seerr.cancelRequest(id);
      env.toast(`Cancelled the request for ${d.title}`);
      env.onChanged();
      dlg.close();
    } catch (err) {
      btn.disabled = false;
      fail(explainRequestError(err).reason === 'permission' ? 'You can only cancel requests that are still waiting.' : 'That did not work. Try again in a moment.');
    }
  }

  function fail(text: string): void {
    const msg = dlg.body.querySelector<HTMLElement>('#rqmsg');
    if (!msg) return;
    msg.hidden = false;
    msg.innerHTML = `${ic('warn').value}<span></span>`;
    (msg.lastElementChild as HTMLElement).textContent = text;
  }

  /* ── step 2: what to request ── */
  function requestStep(d: SeerrDetail, q: SeerrQuota | null): void {
    const caps = env.caps;
    const specials = caps?.specials ?? false;
    const open = d.mediaType === 'tv' ? requestableSeasons(d, specials) : [];
    const all = d.mediaType === 'tv' ? seasonList(d, specials) : [];
    const profiles = caps?.profiles[d.mediaType === 'movie' ? 'movie' : 'tv'];
    const choices = profiles ? qualityChoices(profiles.list, profiles.defaultId) : [];
    const isAdmin = !!caps?.perms.isAdmin;
    const showFourK = !!caps?.fourK[d.mediaType === 'movie' ? 'movie' : 'tv'];
    const canPick = d.mediaType === 'tv' && (caps?.partialRequests ?? true) && open.length > 1;
    const st = { mode: 'all' as 'all' | 'pick', picked: new Set<number>(open.map(s => s.number)), profile: '', fourK: false };
    const qt = quotaText(q?.[d.mediaType], d.mediaType);

    const seasonsBlock = (): SafeHtml => all.length === 0 ? html`` : html`<div class="blk"><span class="lbl" id="rq-sl">Which seasons?</span>
      ${canPick ? html`<div class="opts" role="radiogroup" aria-labelledby="rq-sl">
        <label><input type="radio" name="smode" value="all" checked>${open.length === all.length ? 'The whole show' : `Everything that is missing (${open.length} season${open.length === 1 ? '' : 's'})`}</label>
        <label><input type="radio" name="smode" value="pick">I will pick the seasons</label></div>` : ''}
      <ul class="rq-seasons" role="group" aria-label="Seasons">${all.map(s => {
    const taken = takenText(s);
    return html`<li class="${taken ? 'taken' : ''}"><label><input type="checkbox" name="season" value="${s.number}" disabled ${!taken ? 'checked' : ''}>
        <span class="n">${s.name}</span><span class="e">${s.episodes ? `${s.episodes} episodes` : ''}${s.airDate ? `${s.episodes ? ' · ' : ''}${s.airDate.slice(0, 4)}` : ''}</span>
        ${taken ? html`<span class="t">${s.state === 'available' ? ic('check') : ic('clock')}${taken}</span>` : ''}</label></li>`;
  })}</ul></div>`;

    const next = html`<div class="rq-step2">
      <div class="head">${posterOf(d, 185)}<div><p class="rq-stepno">Step 2 of 2</p><h2 id="rq2h" tabindex="-1" data-autofocus>Request ${d.title}</h2><p class="lead">${metaOf(d.mediaType, d.year)}</p></div></div>
      ${d.mediaType === 'tv' ? seasonsBlock() : html`<p class="rq-plain">${ic('film')}<span>The film will be added to the library once it can be downloaded.</span></p>`}
      ${profiles ? html`<div class="blk"><label class="lbl" for="rq-q">Quality</label>
        <select id="rq-q" class="rq-select">${choices.map(c => html`<option value="${c.value}">${c.label}</option>`)}</select>
        <p class="note">Standard is right for almost everything. Bigger files take longer and may need converting to play here.</p>
        ${isAdmin ? html`<p class="note rq-profile" id="rq-prof">Server profile: ${choices[0]?.profile || 'default'}</p>` : ''}</div>` : ''}
      ${showFourK ? html`<div class="blk"><div class="opts"><label><input type="checkbox" id="rq-4k">Ask for the 4K version instead</label></div>
        <p class="note">4K files are very large, and this server often has to convert them to play.</p></div>` : ''}
      ${qt && !qt.startsWith('No limit') ? html`<p class="rq-quota">${ic('info')}<span>${qt}.</span></p>` : ''}
      <p class="rq-fail" id="rqmsg" role="alert" hidden></p>
      <div class="acts">
        <button class="btn" type="button" id="rq-back">${ic('back')}Back to details</button>
        <button class="btn primary" type="button" id="rq-go">${ic('check')}<span id="rq-golbl">${askLabel(d.mediaType, 'all')}</span></button>
      </div></div>`.value;
    morphHeight(dlg.el, () => { dlg.body.innerHTML = next; });
    focusFirst();
    dlg.body.scrollTop = 0;
    dlg.el.scrollTop = 0;

    const go = dlg.body.querySelector<HTMLButtonElement>('#rq-go') as HTMLButtonElement;
    const lbl = dlg.body.querySelector<HTMLElement>('#rq-golbl');
    const wanted = (): number[] | 'all' => seasonsToAsk(d, specials, st.mode, st.picked);
    const sync = (): void => {
      dlg.body.querySelectorAll<HTMLInputElement>('input[name="season"]').forEach(b => {
        const n = Number(b.value);
        const free = open.some(s => s.number === n);
        b.disabled = !(st.mode === 'pick' && free);
        b.checked = free && (st.mode === 'all' || st.picked.has(n));
      });
      const w = d.mediaType === 'tv' ? wanted() : 'all';
      if (lbl) lbl.textContent = askLabel(d.mediaType, w).replace(/^Ask for/, 'Request');
      go.disabled = d.mediaType === 'tv' && Array.isArray(w) && w.length === 0;
    };
    sync();

    dlg.body.onchange = e => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) && !(t instanceof HTMLSelectElement)) return;
      if (t.name === 'smode') { st.mode = t.value === 'pick' ? 'pick' : 'all'; if (st.mode === 'pick') st.picked = new Set(); sync(); }
      else if (t.name === 'season' && t instanceof HTMLInputElement) { if (t.checked) st.picked.add(Number(t.value)); else st.picked.delete(Number(t.value)); sync(); }
      else if (t.id === 'rq-q') {
        st.profile = t.value;
        const prof = dlg.body.querySelector<HTMLElement>('#rq-prof');
        if (prof) prof.textContent = `Server profile: ${choices.find(c => c.value === t.value)?.profile || 'default'}`;
      }
      else if (t.id === 'rq-4k' && t instanceof HTMLInputElement) st.fourK = t.checked;
    };
    dlg.body.onclick = e => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('#rq-back')) { dlg.body.onchange = null; details(d, q); focusFirst('#rq-req'); return; }
      if (e.target.closest('#rq-go') && !go.disabled) void ask();
    };

    async function ask(): Promise<void> {
      dlg.body.querySelector<HTMLElement>('#rqmsg')!.hidden = true;
      go.disabled = true;
      go.innerHTML = '<span class="spin sm" aria-hidden="true"></span>Sending…';
      const input: DeskRequestInput = {
        mediaType: d.mediaType, tmdbId: d.tmdbId,
        ...(d.mediaType === 'tv' ? { seasons: wanted() } : {}),
        ...(st.fourK ? { is4k: true } : {}), ...(st.profile ? { profileId: Number(st.profile) } : {}),
      };
      try {
        const r = await env.backend.seerr.createRequest(input);
        done(d, r);
        env.onChanged();
      } catch (err) {
        const info = explainRequestError(err);
        go.innerHTML = `${ic('check').value}<span id="rq-golbl"></span>`;
        sync();
        go.disabled = false;
        fail(info.message);
        if (info.reason === 'duplicate' || info.reason === 'no-seasons') env.onChanged();
      }
    }
  }

  function done(d: SeerrDetail, r: SeerrRequest): void {
    const approved = r.state !== 'requested';
    dlg.body.onclick = null;
    dlg.body.onchange = null;
    const next = html`<div class="okview">${nutbot(72, 'happy')}<h2 tabindex="-1" data-autofocus>Requested ${d.title}</h2>
      <p>${approved ? 'It is approved. It will be downloaded as soon as a copy can be found.' : 'It is waiting for the server owner to say yes. You can follow it on the Requests tab.'}</p>
      <div class="acts"><button class="btn" type="button" data-close>Done</button><button class="btn primary" type="button" id="rq-see">See my requests</button></div></div>`.value;
    morphHeight(dlg.el, () => { dlg.body.innerHTML = next; });
    focusFirst();
    dlg.body.querySelector('#rq-see')?.addEventListener('click', () => { dlg.close(); env.showMine(); });
  }
}
