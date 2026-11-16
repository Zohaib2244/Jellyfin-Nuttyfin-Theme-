/** Details dialogs: trailer, report a problem, and (re-exported) the owner-only Remove. */
import { imageUrl } from '../../api';
import type { Backend } from '../../api/backend';
import type { IssueKind, Title } from '../../api/types';
import { phAttrs } from '../../lib/dom';
import { html, raw, type SafeHtml } from '../../lib/html';
import { nutbot } from '../../ui/nutbot';
import { openDialog, type DialogHandle } from '../common/dialog';
import { ic } from '../common/icons';
import { embedUrl } from './trailer';

const poster = (t: { id: string; name: string; imageTags: { primary?: string } }): SafeHtml =>
  html`<div class="ph" ${raw(phAttrs(t.id, t.name))}><img src="${imageUrl(t.id, 'Primary', { maxWidth: 200, tag: t.imageTags.primary })}" alt=""></div>`;

/* ── trailer ── */
export function openTrailer(name: string, trailer: { id: string | null; url: string }): DialogHandle {
  const body = trailer.id
    ? html`<div class="vid"><iframe src="${embedUrl(trailer.id)}" title="${name} trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
    : html`<div class="vid out"><div><p>This trailer is hosted somewhere we cannot show inside Nuttyfin.</p><a class="btn primary" href="${trailer.url}" target="_blank" rel="noopener noreferrer" data-autofocus>${ic('ext')}Open the trailer<span class="sr"> (opens in a new tab)</span></a></div></div>`;
  return openDialog(body, { label: `${name} trailer`, className: 'video' });
}

/* ── report a problem ── */
const PROBLEMS: ReadonlyArray<[IssueKind, string]> = [
  ['video', "It won't play or keeps stopping"],
  ['subtitles', 'Subtitles are wrong or out of sync'],
  ['audio', 'The sound is wrong or missing'],
  ['video', 'The picture looks bad'],
  ['other', "It's the wrong movie or episode"],
  ['other', 'Something else'],
];

export interface ReportInput {
  backend: Backend;
  item: Title;
  /** "Silo, season 2 episode 1" style, goes in the message */
  what: string;
  /** versions / sound / subtitles line shown to the person and sent with the report */
  attach: string;
  isOwner: boolean;
  ownerName: string;
}

export function openReport(r: ReportInput): DialogHandle {
  const tmdb = Number(r.item.providerIds?.Tmdb);
  const form = html`<div id="repwrap"><div class="head">${poster(r.item)}<div><h2>What's wrong?</h2><p class="lead">Pick the closest one. ${r.isOwner ? 'It goes in your problems list.' : `${r.ownerName} gets it and will take a look.`}</p></div></div>
    <div class="blk"><div class="opts" role="radiogroup" aria-label="Problem">
      ${PROBLEMS.map(([, text], i) => html`<label><input type="radio" name="prob" value="${i}" ${i === 0 ? raw('checked data-autofocus') : ''}>${text}</label>`)}
    </div></div>
    <div class="blk"><label class="lbl" for="repnote">Anything else? (optional)</label><textarea id="repnote" placeholder="For example: stops at about 40 minutes"></textarea></div>
    <div class="attach">We add this for you: <code>${r.attach}</code></div>
    <p class="lead" id="repmsg" role="alert" hidden></p>
    <div class="acts"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-send>${ic('flag')}Send</button></div></div>`;
  const dlg = openDialog(form, { label: 'Report a problem' });
  dlg.el.addEventListener('click', e => {
    if (!(e.target instanceof Element) || !e.target.closest('[data-send]')) return;
    const send = dlg.el.querySelector<HTMLButtonElement>('[data-send]');
    const pick = Number((dlg.el.querySelector<HTMLInputElement>('input[name="prob"]:checked'))?.value ?? 0);
    const [kind, text] = PROBLEMS[pick] ?? PROBLEMS[0] as [IssueKind, string];
    const note = (dlg.el.querySelector<HTMLTextAreaElement>('#repnote')?.value ?? '').trim();
    const message = `${text}${note ? `: ${note}` : ''}\n${r.what} (${r.attach})`;
    if (send) { send.disabled = true; send.textContent = 'Sending...'; }
    const msg = dlg.el.querySelector<HTMLElement>('#repmsg');
    const failed = (): void => {
      if (send) { send.disabled = false; send.innerHTML = `${ic('flag').value}Send`; }
      if (msg) { msg.hidden = false; msg.textContent = `Could not send it from here right now. Please tell ${r.ownerName} directly.`; }
    };
    if (!Number.isFinite(tmdb) || tmdb <= 0) { failed(); return; }
    void r.backend.seerr.reportIssue({ mediaType: r.item.kind === 'series' ? 'tv' : 'movie', tmdbId: tmdb, kind, message }).then(ok => {
      if (!ok) { failed(); return; }
      dlg.body.innerHTML = html`<div class="okview">${nutbot(72, 'happy')}<h2 tabindex="-1" data-autofocus>Thanks, got it</h2><p>${r.isOwner ? 'It is in your problems list.' : `${r.ownerName} will take a look.`}</p><div class="acts"><button class="btn primary" type="button" data-close>Done</button></div></div>`.value;
      dlg.body.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    });
  });
  return dlg;
}

/* ── remove (owner only): the smart Remove dialog lives in remove.ts (it talks to the helper service when there is one) ── */
export { openRemove, type RemoveInput } from './remove'; // phase5-7
