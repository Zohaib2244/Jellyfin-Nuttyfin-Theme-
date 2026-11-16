/** Details dialogs: trailer, report a problem, and the owner-only Remove (Jellyfin only; the rest waits for the helper). */
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

/* ── remove (owner only) ── */
export interface RemoveInput {
  backend: Backend;
  item: Title;
  isSeries: boolean;
  /** called after Jellyfin said yes */
  onRemoved(): void;
}

const NEEDS_HELPER = 'Needs the Nuttyfin helper service (coming)';

export function openRemove(r: RemoveInput): DialogHandle {
  const { item } = r;
  const apps = r.isSeries ? 'Sonarr' : 'Radarr';
  let busy = false;
  const step1 = (): SafeHtml => html`
    <div class="head">${poster(item)}<div><h2 id="rmh">Remove ${item.name}?</h2><p class="lead">Choose how far it goes. Nothing changes until you confirm on the next step.</p></div></div>
    <div class="blk" role="radiogroup" aria-labelledby="hl-how"><span class="lbl" id="hl-how">How far should it go?</span>
      <div class="rmopts">
        <label class="rmopt"><input type="radio" name="rmmode" value="jf" checked data-autofocus><span class="dot" aria-hidden="true"></span><span class="tt">Remove from Jellyfin only</span>
          <span class="dd">Deletes ${r.isSeries ? 'the show and its episode files' : 'the film and its file'} from the media drive and from Nuttyfin. ${apps} and the download are not told, so ${apps} may still list it.</span></label>
        <label class="rmopt"><input type="radio" name="rmmode" value="arr" disabled><span class="dot" aria-hidden="true"></span><span class="tt">Also remove it from ${apps}</span>
          <span class="dd">${apps} stops watching for it and will not fetch it again.</span><span class="why3">${NEEDS_HELPER}</span></label>
      </div></div>
    <div class="blk"><span class="lbl">Afterwards</span>
      <label class="tog" aria-disabled="true"><span class="tt">Also delete the release in qBittorrent</span><span class="dd">${NEEDS_HELPER}</span><input type="checkbox" disabled><span class="sw" aria-hidden="true"></span></label>
    </div>
    <div class="blk"><span class="lbl">Exactly what will happen</span>
      <ul class="plan"><li><span class="app jf">Jf</span><span>Delete <b>${item.name}</b> in Jellyfin, including the file${r.isSeries ? 's' : ''} on disk.</span></li>
        <li class="skip"><span class="app ${r.isSeries ? 'sonarr' : 'radarr'}">${r.isSeries ? 'So' : 'Ra'}</span><span>${apps}: left as it is.</span></li>
        <li class="skip"><span class="app qbit">qB</span><span>qBittorrent: left as it is.</span></li></ul></div>
    <div class="acts sticky"><button class="btn" type="button" data-close>Cancel</button><button class="btn danger" type="button" data-next>${ic('trash')}Continue...</button></div>`;

  const step2 = (typed: string): SafeHtml => html`
    <div class="head">${poster(item)}<div><h2 id="rmh">Last check</h2><p class="lead">This deletes ${r.isSeries ? 'every episode of ' : ''}<b>${item.name}</b> from the server.</p></div></div>
    <div class="confirmbox blk"><label for="rmtype">This can't be undone. Type <b>${item.name}</b> to confirm.</label>
      <input id="rmtype" autocomplete="off" autocapitalize="off" spellcheck="false" value="${typed}" aria-describedby="permnote" data-autofocus>
      <div class="perm" id="permnote">${ic('warn')}<span>The file${r.isSeries ? 's are' : ' is'} deleted for good. There is no undo.</span></div></div>
    <div class="acts sticky"><p class="gohint" id="gohint">${ic('lock')}Type the title above to unlock the button.</p><button class="btn" type="button" data-back>Back</button><button class="btn danger" type="button" id="rmgo" disabled>${ic('trash')}Remove from Jellyfin</button></div>`;

  const dlg = openDialog(step1(), { label: `Remove ${item.name}`, className: 'wide rm', canClose: () => !busy });
  const set = (content: SafeHtml): void => { dlg.body.innerHTML = content.value; dlg.body.querySelector<HTMLElement>('[data-autofocus]')?.focus(); };
  const norm = (s: string): string => s.trim().toLowerCase();

  dlg.el.addEventListener('input', e => {
    if (!(e.target instanceof HTMLInputElement) || e.target.id !== 'rmtype') return;
    const ok = norm(e.target.value) === norm(item.name);
    e.target.classList.toggle('match', ok);
    const go = dlg.el.querySelector<HTMLButtonElement>('#rmgo');
    if (go) go.disabled = !ok;
    const hint = dlg.el.querySelector<HTMLElement>('#gohint');
    if (hint) hint.hidden = ok;
  });
  dlg.el.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('[data-next]')) { set(step2('')); return; }
    if (e.target.closest('[data-back]')) { set(step1()); return; }
    const go = e.target.closest<HTMLButtonElement>('#rmgo');
    if (!go || go.disabled || busy) return;
    const typed = dlg.el.querySelector<HTMLInputElement>('#rmtype')?.value ?? '';
    if (norm(typed) !== norm(item.name)) return; // the second confirm: the button alone is not enough
    busy = true;
    dlg.body.innerHTML = html`<div class="head">${poster(item)}<div><h2 id="rmh">Removing...</h2><p class="lead">Asking Jellyfin to delete it.</p></div></div><div class="result" role="status"><span class="spin" aria-hidden="true"></span><span>Working on it. Please keep this open.</span></div>`.value;
    void r.backend.deleteFromJellyfin(item.id).then(() => {
      busy = false;
      dlg.body.innerHTML = html`<div class="head">${poster(item)}<div><h2 id="rmh" tabindex="-1" data-autofocus>${item.name} is gone from Jellyfin</h2><p class="lead">${apps} and the download were not touched.</p></div></div>
        <div class="result" role="status">${nutbot(40, 'happy')}<div><b>Removed</b><span>It no longer shows up in Nuttyfin.</span></div></div>
        <div class="acts"><button class="btn primary" type="button" data-done>Back to the library</button></div>`.value;
      dlg.body.querySelector<HTMLElement>('[data-autofocus]')?.focus();
      dlg.body.querySelector('[data-done]')?.addEventListener('click', () => { dlg.close(); r.onRemoved(); });
    }).catch((err: unknown) => {
      busy = false;
      const status = (err as { status?: number } | null)?.status;
      const why = status === 403 ? 'Jellyfin says this account is not allowed to delete things.' : 'Jellyfin did not accept it, or could not be reached. Nothing was changed.';
      dlg.body.innerHTML = html`<div class="head">${poster(item)}<div><h2 id="rmh" tabindex="-1" data-autofocus>Could not remove it</h2><p class="lead">${why}</p></div></div>
        <div class="result bad" role="alert">${nutbot(40, 'sleepy')}<div><b>Still in the library</b><span>You can try again.</span></div></div>
        <div class="acts"><button class="btn" type="button" data-close>Close</button><button class="btn" type="button" data-back>Try again</button></div>`.value;
      dlg.body.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    });
  });
  return dlg;
}
