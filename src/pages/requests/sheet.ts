/**
 * The "Ask for it" sheet: one film or show with its status, a season picker for shows (seasons already in the library
 * or already asked for are skipped), quality / 4K only when this Seerr offers them, the quota, and plain failure text.
 * A centred dialog on desktop, a bottom sheet on phones (common/dialog).
 */
import type { Backend } from '../../api/backend';
import { explainRequestError } from '../../api/seerr-desk';
import type { DeskRequestInput, SeerrCapabilities, SeerrDetail } from '../../api/desk-types';
import type { SeerrQuota, SeerrRequest } from '../../api/types';
import { runtime } from '../../lib/format';
import { html, type SafeHtml } from '../../lib/html';
import { nutbot } from '../../ui/nutbot';
import { openDialog, type DialogHandle } from '../common/dialog';
import { ic } from '../common/icons';
import {
  askLabel, blockedReason, quotaLeft, quotaText, requestableSeasons, seasonList, seasonsToAsk, takenText,
} from './model';
import { chipFor, metaOf, posterOf } from './ui';

export interface SheetEnv {
  backend: Backend;
  caps: SeerrCapabilities | null;
  quota(): Promise<SeerrQuota | null>;
  /** After anything changed (asked, cancelled): refresh the lists. */
  onChanged(): void;
  toast(message: string): void;
  /** Go to "Your requests" after asking. */
  showMine(): void;
}

export interface SheetTarget { tmdbId: number; mediaType: 'movie' | 'tv'; title?: string }

export function openRequestSheet(env: SheetEnv, target: SheetTarget): DialogHandle {
  const dlg = openDialog(html`<div class="rq-sheet-load" role="status"><span class="spin" aria-hidden="true"></span><span>Looking ${target.title ? `at ${target.title}` : 'it up'}...</span></div>`, {
    label: target.title ? `Ask for ${target.title}` : 'Ask for something', className: 'wide rq-dlg',
  });
  void load();
  return dlg;

  async function load(): Promise<void> {
    const [d, q] = await Promise.all([env.backend.seerr.detail(target.mediaType, target.tmdbId).catch(() => null), env.quota().catch(() => null)]);
    if (!dlg.el.isConnected) return;
    if (!d) {
      dlg.body.innerHTML = html`<div class="okview">${nutbot(64, 'sleepy')}<h2 tabindex="-1" data-autofocus>Could not find that one</h2><p>The request service does not know it, or is not answering. Try searching for it again.</p><div class="acts"><button class="btn primary" type="button" data-close>Close</button></div></div>`.value;
      dlg.body.querySelector<HTMLElement>('[data-autofocus]')?.focus();
      return;
    }
    render(d, q);
  }

  function render(d: SeerrDetail, q: SeerrQuota | null): void {
    const caps = env.caps;
    const specials = caps?.specials ?? false;
    const left = quotaLeft(q, d.mediaType);
    const block = blockedReason(d, caps, left);
    const open = d.mediaType === 'tv' ? requestableSeasons(d, specials) : [];
    const all = d.mediaType === 'tv' ? seasonList(d, specials) : [];
    const profiles = caps?.profiles[d.mediaType === 'movie' ? 'movie' : 'tv'];
    const showFourK = !!caps?.fourK[d.mediaType === 'movie' ? 'movie' : 'tv'];
    const canPick = d.mediaType === 'tv' && (caps?.partialRequests ?? true) && open.length > 1;
    const st = { mode: 'all' as 'all' | 'pick', picked: new Set<number>(open.map(s => s.number)), profile: '', fourK: false };
    const lead = [metaOf(d.mediaType, d.year), d.runtimeMin ? runtime(d.runtimeMin) : '', d.rating ? `${d.rating} / 10` : '', d.genres.slice(0, 2).join(', ')].filter(Boolean).join(' · ');
    const qt = quotaText(q?.[d.mediaType], d.mediaType);

    const seasonsBlock = (): SafeHtml => all.length === 0 ? html`` : html`<div class="blk"><span class="lbl" id="rq-sl">Which seasons?</span>
      ${canPick ? html`<div class="opts" role="radiogroup" aria-labelledby="rq-sl">
        <label><input type="radio" name="smode" value="all" checked>${open.length === all.length ? 'The whole show' : `Everything that is missing (${open.length} season${open.length === 1 ? '' : 's'})`}</label>
        <label><input type="radio" name="smode" value="pick">I will pick the seasons</label></div>` : ''}
      <ul class="rq-seasons" id="rq-seasons" role="group" aria-label="Seasons">${all.map(s => {
    const taken = takenText(s);
    return html`<li class="${taken ? 'taken' : ''}"><label><input type="checkbox" name="season" value="${s.number}" disabled ${!taken ? 'checked' : ''}>
        <span class="n">${s.name}</span><span class="e">${s.episodes ? `${s.episodes} episodes` : ''}${s.airDate ? `${s.episodes ? ' · ' : ''}${s.airDate.slice(0, 4)}` : ''}</span>
        ${taken ? html`<span class="t">${s.state === 'available' ? ic('check') : ic('clock')}${taken}</span>` : ''}</label></li>`;
  })}</ul></div>`;

    dlg.body.innerHTML = html`<div id="rqform">
      <div class="head">${posterOf({ ...d, title: d.title }, 185)}<div><h2 id="rqh">${d.title}</h2><p class="lead">${lead}</p><p class="rq-statusrow">${chipFor(d.state, d.partial)}</p></div></div>
      ${d.overview ? html`<p class="rq-over">${d.overview}</p>` : ''}
      ${d.jellyfinId ? html`<div class="rq-inlib">${ic('check')}<span><b>${d.partial ? 'Some of it is in the library' : 'It is in the library'}</b></span>
        ${d.mediaType === 'movie' ? html`<a class="btn sm primary" href="#/watch/${d.jellyfinId}" data-go>${ic('play')}Play</a>` : ''}<a class="btn sm" href="#/title/${d.jellyfinId}" data-go>Details</a></div>` : ''}
      ${block ? html`<p class="rq-block ${block.tone}" role="${block.tone === 'bad' ? 'alert' : 'status'}">${ic(block.tone === 'bad' ? 'warn' : 'info')}<span>${block.text}</span></p>` : ''}
      ${d.mediaType === 'tv' ? seasonsBlock() : ''}
      ${!block && profiles ? html`<div class="blk"><label class="lbl" for="rq-q">Quality</label>
        <select id="rq-q" class="rq-select"><option value="">Standard${profiles.defaultId != null ? ` (${profiles.list.find(p => p.id === profiles.defaultId)?.name ?? 'default'})` : ''}</option>${profiles.list.map(p => html`<option value="${p.id}">${p.name}</option>`)}</select>
        <p class="note">Standard is right for almost everything. Bigger files take longer and may need converting to play here.</p></div>` : ''}
      ${!block && showFourK ? html`<div class="blk"><div class="opts"><label><input type="checkbox" id="rq-4k">Ask for the 4K version instead</label></div>
        <p class="note">4K files are very large, and this server often has to convert them to play.</p></div>` : ''}
      ${qt && !block?.text.startsWith('Your account') ? html`<p class="rq-quota">${ic('info')}<span>${qt}.</span></p>` : ''}
      <p class="rq-fail" id="rqmsg" role="alert" hidden></p>
      <div class="acts">
        <button class="btn" type="button" data-close>${block ? 'Close' : 'Not now'}</button>
        ${d.myRequestId ? html`<button class="btn" type="button" id="rq-cancel">Cancel my request</button>` : ''}
        ${!block ? html`<button class="btn primary" type="button" id="rq-go" data-autofocus>${ic('ask')}<span id="rq-golbl">${askLabel(d.mediaType, 'all')}</span></button>` : ''}
      </div></div>`.value;
    dlg.body.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    const go = dlg.body.querySelector<HTMLButtonElement>('#rq-go');
    const msg = dlg.body.querySelector<HTMLElement>('#rqmsg') as HTMLElement;
    const lbl = dlg.body.querySelector<HTMLElement>('#rq-golbl');
    const wanted = (): number[] | 'all' => seasonsToAsk(d, specials, st.mode, st.picked);

    const sync = (): void => {
      const boxes = dlg.body.querySelectorAll<HTMLInputElement>('input[name="season"]');
      boxes.forEach(b => {
        const n = Number(b.value);
        const free = open.some(s => s.number === n);
        b.disabled = !(st.mode === 'pick' && free);
        b.checked = free && (st.mode === 'all' || st.picked.has(n));
      });
      const w = d.mediaType === 'tv' ? wanted() : 'all';
      if (lbl) lbl.textContent = askLabel(d.mediaType, w);
      if (go) go.disabled = d.mediaType === 'tv' && Array.isArray(w) && w.length === 0;
    };
    sync();

    dlg.body.addEventListener('change', e => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) && !(t instanceof HTMLSelectElement)) return;
      if (t.name === 'smode') { st.mode = t.value === 'pick' ? 'pick' : 'all'; if (st.mode === 'pick') st.picked = new Set(); sync(); }
      else if (t.name === 'season' && t instanceof HTMLInputElement) { if (t.checked) st.picked.add(Number(t.value)); else st.picked.delete(Number(t.value)); sync(); }
      else if (t.id === 'rq-q') st.profile = t.value;
      else if (t.id === 'rq-4k' && t instanceof HTMLInputElement) st.fourK = t.checked;
    });

    dlg.body.addEventListener('click', e => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('[data-go]')) { dlg.close(); return; }
      if (e.target.closest('#rq-cancel') && d.myRequestId != null) { void cancel(d.myRequestId, e.target.closest('#rq-cancel') as HTMLButtonElement); return; }
      if (e.target.closest('#rq-go') && go && !go.disabled) void ask();
    });

    function fail(text: string): void {
      msg.hidden = false;
      msg.innerHTML = `${ic('warn').value}<span></span>`;
      (msg.lastElementChild as HTMLElement).textContent = text;
    }

    async function ask(): Promise<void> {
      if (!go) return;
      msg.hidden = true;
      go.disabled = true;
      go.innerHTML = '<span class="spin sm" aria-hidden="true"></span>Asking...';
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
        go.innerHTML = `${ic('ask').value}<span>${askLabel(d.mediaType, d.mediaType === 'tv' ? wanted() : 'all')}</span>`;
        go.disabled = false;
        fail(info.message);
        if (info.reason === 'duplicate' || info.reason === 'no-seasons') env.onChanged();
      }
    }

    async function cancel(id: number, btn: HTMLButtonElement): Promise<void> {
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
  }

  function done(d: SeerrDetail, r: SeerrRequest): void {
    const approved = r.state !== 'requested';
    dlg.body.innerHTML = html`<div class="okview">${nutbot(72, 'happy')}<h2 tabindex="-1" data-autofocus>Asked for ${d.title}</h2>
      <p>${approved ? 'It is approved and will start downloading soon.' : 'It is waiting for the server owner to say yes. You will see it move along in your list.'}</p>
      <div class="acts"><button class="btn" type="button" data-close>Done</button><button class="btn primary" type="button" id="rq-see">See my requests</button></div></div>`.value;
    dlg.body.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    dlg.body.querySelector('#rq-see')?.addEventListener('click', () => { dlg.close(); env.showMine(); });
  }
}
