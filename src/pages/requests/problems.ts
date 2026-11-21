/**
 * "Report a problem with something in the library": pick the film or show (searches the library), say what is wrong,
 * and it goes to Seerr as an issue the owner sees. Same wording as the Report dialog on a title's own page.
 */
import { imageUrl } from '../../api';
import type { Backend } from '../../api/backend';
import type { IssueKind, Title } from '../../api/types';
import { phAttrs } from '../../lib/dom';
import { esc, html, raw } from '../../lib/html';
import { nutbot } from '../../ui/nutbot';
import { openDialog, type DialogHandle } from '../common/dialog';
import { ic } from '../common/icons';

const PROBLEMS: ReadonlyArray<[IssueKind, string]> = [
  ['video', "It won't play or keeps stopping"],
  ['subtitles', 'Subtitles are wrong or out of sync'],
  ['audio', 'The sound is wrong or missing'],
  ['video', 'The picture looks bad'],
  ['other', "It's the wrong movie or episode"],
  ['other', 'Something else'],
];

export interface ProblemEnv {
  backend: Backend;
  ownerName: string;
  isOwner: boolean;
  onSent(): void;
}

const thumb = (t: { id: string; name: string }): string =>
  `<span class="ph" ${phAttrs(t.id, t.name)}><img src="${esc(imageUrl(t.id, 'Primary', { maxWidth: 120, quality: 80 }))}" alt="" loading="lazy"></span>`;

export function openProblemDialog(env: ProblemEnv): DialogHandle {
  let picked: Title | null = null;
  let timer = 0;
  let token = 0;
  const dlg = openDialog(html`<div id="rpwrap">
    <div class="head"><span class="rq-bigicon" aria-hidden="true">${ic('flag')}</span><div><h2>Report a problem</h2><p class="lead">Pick the film or show, say what is wrong, and we will look into it.</p></div></div>
    <div class="blk"><label class="lbl" for="rpq">Which film or show?</label>
      <div class="rq-pick" id="rppick" hidden></div>
      <input id="rpq" class="rq-text" type="search" autocomplete="off" maxlength="60" placeholder="Start typing a title" data-autofocus>
      <ul class="rq-found" id="rpfound" aria-label="Matches in your library"></ul></div>
    <div class="blk"><span class="lbl" id="rpl">What is wrong?</span><div class="opts" role="radiogroup" aria-labelledby="rpl">
      ${PROBLEMS.map(([, text], i) => html`<label><input type="radio" name="prob" value="${i}" ${i === 0 ? raw('checked') : ''}>${text}</label>`)}</div></div>
    <div class="blk"><label class="lbl" for="rpnote">Anything else? (optional)</label><textarea id="rpnote" placeholder="For example: stops at about 40 minutes"></textarea></div>
    <p class="rq-fail" id="rpmsg" role="alert" hidden></p>
    <div class="acts"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="button" id="rpsend" disabled>${ic('flag')}Send</button></div></div>`, { label: 'Report a problem', className: 'wide rq-dlg' });

  const q = dlg.el.querySelector<HTMLInputElement>('#rpq') as HTMLInputElement;
  const found = dlg.el.querySelector<HTMLElement>('#rpfound') as HTMLElement;
  const pick = dlg.el.querySelector<HTMLElement>('#rppick') as HTMLElement;
  const send = dlg.el.querySelector<HTMLButtonElement>('#rpsend') as HTMLButtonElement;
  const msg = dlg.el.querySelector<HTMLElement>('#rpmsg') as HTMLElement;

  const choose = (t: Title | null): void => {
    picked = t;
    send.disabled = !t;
    pick.hidden = !t;
    q.hidden = !!t;
    found.innerHTML = '';
    pick.innerHTML = t ? `${thumb(t)}<span><b>${esc(t.name)}</b><small>${t.kind === 'series' ? 'Show' : 'Film'}${t.year ? ` · ${t.year}` : ''}</small></span><button class="btn sm ghost" type="button" id="rpchange">Change</button>` : '';
    if (t) dlg.el.querySelector<HTMLElement>('#rpchange')?.focus(); else q.focus();
  };

  const search = async (text: string): Promise<void> => {
    const my = ++token;
    if (text.trim().length < 2) { found.innerHTML = ''; return; }
    try {
      const list = (await env.backend.search(text.trim(), 6)).filter(t => t.kind === 'movie' || t.kind === 'series');
      if (my !== token) return;
      found.innerHTML = list.length ? list.map(t => `<li><button type="button" class="rq-hit" data-id="${esc(t.id)}">${thumb(t)}<span><b>${esc(t.name)}</b><small>${t.kind === 'series' ? 'Show' : 'Film'}${t.year ? ` · ${t.year}` : ''}</small></span></button></li>`).join('')
        : '<li class="none">Nothing in your library with that name.</li>';
      (found as HTMLElement & { _titles?: Title[] })._titles = list;
    } catch { if (my === token) found.innerHTML = '<li class="none">The search did not work just now.</li>'; }
  };

  q.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void search(q.value); }, 260); });
  dlg.el.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    const hit = e.target.closest<HTMLElement>('.rq-hit');
    if (hit) {
      const list = (found as HTMLElement & { _titles?: Title[] })._titles ?? [];
      const t = list.find(x => x.id === hit.dataset.id);
      if (t) choose(t);
      return;
    }
    if (e.target.closest('#rpchange')) { choose(null); return; }
    if (e.target.closest('#rpsend') && picked) void submit(picked);
  });

  async function submit(t: Title): Promise<void> {
    const pickIdx = Number(dlg.el.querySelector<HTMLInputElement>('input[name="prob"]:checked')?.value ?? 0);
    const [kind, text] = PROBLEMS[pickIdx] ?? (PROBLEMS[0] as [IssueKind, string]);
    const note = (dlg.el.querySelector<HTMLTextAreaElement>('#rpnote')?.value ?? '').trim();
    send.disabled = true;
    send.textContent = 'Sending...';
    msg.hidden = true;
    const failed = (why: string): void => {
      send.disabled = false;
      send.innerHTML = `${ic('flag').value}Send`;
      msg.hidden = false;
      msg.textContent = why;
    };
    try {
      // The title comes from the full item (list calls do not carry the TMDB id Seerr needs).
      const full = await env.backend.item(t.id);
      const tmdb = Number((full as Title).providerIds?.Tmdb);
      if (!Number.isFinite(tmdb) || tmdb <= 0) { failed(`This title has no online listing, so it cannot be sent from here. Please tell ${env.ownerName} directly.`); return; }
      const ok = await env.backend.seerr.reportIssue({
        mediaType: t.kind === 'series' ? 'tv' : 'movie', tmdbId: tmdb, kind,
        message: `${text}${note ? `: ${note}` : ''}\n${t.name}${t.year ? ` (${t.year})` : ''}`,
      });
      if (!ok) { failed(`Could not send it from here right now. Please tell ${env.ownerName} directly.`); return; }
      dlg.body.innerHTML = html`<div class="okview">${nutbot(72, 'happy')}<h2 tabindex="-1" data-autofocus>Thanks, got it</h2><p>We will take a look.</p><div class="acts"><button class="btn primary" type="button" data-close>Done</button></div></div>`.value;
      dlg.body.querySelector<HTMLElement>('[data-autofocus]')?.focus();
      env.onSent();
    } catch {
      failed(`Could not send it from here right now. Please tell ${env.ownerName} directly.`);
    }
  }
  return dlg;
}
