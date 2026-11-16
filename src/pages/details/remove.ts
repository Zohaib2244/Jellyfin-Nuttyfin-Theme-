/**
 * Remove a film or show (owner only). With the Nuttyfin helper service running, the dialog first asks it for a PLAN (read-only):
 * which Radarr/Sonarr entry and which torrent hold the files, and how much space each choice would really give back
 * (imports are hardlinks, so deleting the library copy alone often frees nothing while the torrent is still seeding).
 * Then: choose, type the title to confirm, optionally preview with a dry run, and watch each step finish.
 * Without the helper it is the plain "remove from Jellyfin only" dialog, and the other options say why they are off.
 */
import { imageUrl } from '../../api';
import type { Backend } from '../../api/backend';
import type { DeleteMode, DeletePlan, DeleteResult } from '../../api/desk-types';
import type { Title } from '../../api/types';
import { phAttrs } from '../../lib/dom';
import { html, raw, type SafeHtml } from '../../lib/html';
import { nutbot } from '../../ui/nutbot';
import { openDialog, type DialogHandle } from '../common/dialog';
import { ic } from '../common/icons';
import { fmtBytes, freedSentence, freesTag, hasTorrent, modeOf, outcomeText, showsNoSpace, type Choice } from './removeModel';
import './remove.css';

export interface RemoveInput {
  backend: Backend;
  item: Title;
  isSeries: boolean;
  /** called after the item is gone */
  onRemoved(): void;
}

const poster = (t: { id: string; name: string; imageTags: { primary?: string } }): SafeHtml =>
  html`<div class="ph" ${raw(phAttrs(t.id, t.name))}><img src="${imageUrl(t.id, 'Primary', { maxWidth: 200, tag: t.imageTags.primary })}" alt=""></div>`;

type PlanState = { s: 'loading' } | { s: 'none'; why: string } | { s: 'ready'; plan: DeletePlan };

const norm = (s: string): string => s.trim().toLowerCase();

export function openRemove(r: RemoveInput): DialogHandle {
  const { item } = r;
  const apps = r.isSeries ? 'Sonarr' : 'Radarr';
  const what = r.isSeries ? 'show' : 'film';
  const choice: Choice = { arr: false, torrent: false };
  let busy = false;
  let state: PlanState = { s: 'loading' };

  const ready = (): DeletePlan | null => (state.s === 'ready' ? state.plan : null);
  const canArr = (): boolean => { const p = ready(); return !!p && !!p.arr && p.deleteEnabled; };
  const arrWhy = (): string => {
    if (state.s === 'loading') return 'Checking what is on the drive...';
    if (state.s === 'none') return state.why;
    const p = state.plan;
    if (!p.arr) return `${apps} does not list this ${what}.`;
    if (!p.deleteEnabled) return 'Deleting through the helper is switched off. The server owner turns it on in the helper settings (NUTFIN_ALLOW_DELETE).';
    return '';
  };
  const mode = (): DeleteMode => modeOf({ arr: choice.arr && canArr(), torrent: choice.torrent && choice.arr && canArr() });

  /* ── step 1: choose ── */
  const planList = (): SafeHtml => {
    const m = mode();
    const p = ready();
    const torrents = p?.torrents.length ?? 0;
    return html`<ul class="plan">
      ${m !== 'jellyfin-only' && torrents && m === 'arr-and-files-and-torrent' ? html`<li><span class="app qbit">qB</span><span>Remove ${torrents === 1 ? 'the torrent' : `${torrents} torrents`} and ${torrents === 1 ? 'its' : 'their'} data from qBittorrent.</span></li>` : html`<li class="skip"><span class="app qbit">qB</span><span>qBittorrent: left as it is.</span></li>`}
      ${m !== 'jellyfin-only' ? html`<li><span class="app ${r.isSeries ? 'sonarr' : 'radarr'}">${r.isSeries ? 'So' : 'Ra'}</span><span>Remove <b>${item.name}</b> from ${apps} and delete ${r.isSeries ? 'its files' : 'its file'}.</span></li>` : html`<li class="skip"><span class="app ${r.isSeries ? 'sonarr' : 'radarr'}">${r.isSeries ? 'So' : 'Ra'}</span><span>${apps}: left as it is.</span></li>`}
      <li><span class="app jf">Jf</span><span>Delete <b>${item.name}</b> in Jellyfin${m === 'jellyfin-only' ? `, including the file${r.isSeries ? 's' : ''} on disk` : ''}.</span></li></ul>`;
  };
  const freeBox = (): SafeHtml => {
    const p = ready();
    if (!p) return html`<p class="rmfree muted">${state.s === 'loading' ? html`<span class="spin sm" aria-hidden="true"></span>Checking what is on the drive...` : html`${ic('info')}How much space comes back is only known when the Nuttyfin helper is running.`}</p>`;
    const m = mode();
    const bad = showsNoSpace(p, m);
    return html`<div class="rmfree ${bad ? 'warn' : 'good'}">${ic(bad ? 'warn' : 'drive')}<div><b>${freedSentence(p, m)}</b>
      ${bad && hasTorrent(p) && m !== 'arr-and-files-and-torrent' && canArr() ? html`<span>To get it back, choose "Also remove it from ${apps}" and tick the torrent too.</span>` : ''}
      ${p.notes.filter(n => !/space/i.test(n)).map(n => html`<span>${n}</span>`)}</div></div>`;
  };

  const step1 = (): SafeHtml => {
    const p = ready();
    const t = p?.torrents[0];
    return html`
    <div class="head">${poster(item)}<div><h2 id="rmh">Remove ${item.name}?</h2><p class="lead">Choose how far it goes. Nothing changes until you confirm on the next step.</p></div></div>
    <div class="blk" role="radiogroup" aria-labelledby="hl-how"><span class="lbl" id="hl-how">How far should it go?</span>
      <div class="rmopts">
        <label class="rmopt"><input type="radio" name="rmmode" value="jf" ${choice.arr ? '' : raw('checked')} data-autofocus><span class="dot" aria-hidden="true"></span><span class="tt">Remove from Jellyfin only${p ? html` <small class="tag">(${freesTag(p, 'jellyfin-only')})</small>` : ''}</span>
          <span class="dd">Deletes ${r.isSeries ? 'the show and its episode files' : 'the film and its file'} from the media drive and from Nuttyfin. ${apps} and the download are not told, so ${apps} may still list it.</span></label>
        <label class="rmopt"><input type="radio" name="rmmode" value="arr" ${choice.arr ? raw('checked') : ''} ${canArr() ? '' : raw('disabled')}><span class="dot" aria-hidden="true"></span><span class="tt">Also remove it from ${apps}${p && canArr() ? html` <small class="tag">(${freesTag(p, 'arr-and-files')})</small>` : ''}</span>
          <span class="dd">${apps} stops watching for it and will not fetch it again, and deletes its files.</span>${canArr() ? '' : html`<span class="why3">${arrWhy()}</span>`}</label>
      </div></div>
    <div class="blk"><span class="lbl">Afterwards</span>
      <label class="tog" id="rmtog" aria-disabled="${String(!(choice.arr && canArr() && !!p && hasTorrent(p)))}"><span class="tt">Also remove the download in qBittorrent${p && choice.arr && canArr() && hasTorrent(p) ? html` <small class="tag">(${freesTag(p, 'arr-and-files-and-torrent')})</small>` : ''}</span>
        <span class="dd" id="rmtogd">${!p ? arrWhy() : !hasTorrent(p) ? 'No download shares these files, so there is nothing to remove there.' : !choice.arr ? 'Choose "Also remove it from ' + apps + '" first.' : t ? `${p.torrents.length === 1 ? 'One download shares' : `${p.torrents.length} downloads share`} these files: ${t.name}${p.torrents.length === 1 ? (t.seeding ? ', still seeding' : ', finished') : ''}.` : ''}</span>
        <input type="checkbox" id="rmtorrent" ${choice.torrent ? raw('checked') : ''} ${choice.arr && canArr() && p && hasTorrent(p) ? '' : raw('disabled')}><span class="sw" aria-hidden="true"></span></label>
    </div>
    <div class="blk" id="rmfreeblk" aria-live="polite">${freeBox()}</div>
    <div class="blk"><span class="lbl">Exactly what will happen</span><div id="rmplan">${planList()}</div></div>
    <div class="acts sticky"><button class="btn" type="button" data-close>Cancel</button><button class="btn danger" type="button" data-next>${ic('trash')}Continue...</button></div>`;
  };

  /* ── step 2: type the title ── */
  const step2 = (typed: string, preview: SafeHtml | null = null): SafeHtml => {
    const m = mode();
    const label = m === 'jellyfin-only' ? 'Remove from Jellyfin' : m === 'arr-and-files' ? `Remove from ${apps} and Jellyfin` : 'Remove everything';
    return html`
    <div class="head">${poster(item)}<div><h2 id="rmh">Last check</h2><p class="lead">This deletes ${r.isSeries ? 'every episode of ' : ''}<b>${item.name}</b> from the server${m === 'jellyfin-only' ? '' : `, and from ${apps}${m === 'arr-and-files-and-torrent' ? ' and qBittorrent' : ''}`}.</p></div></div>
    <div class="confirmbox blk"><label for="rmtype">This can't be undone. Type <b>${item.name}</b> to confirm.</label>
      <input id="rmtype" autocomplete="off" autocapitalize="off" spellcheck="false" value="${typed}" aria-describedby="permnote" data-autofocus>
      <div class="perm" id="permnote">${ic('warn')}<span>The file${r.isSeries ? 's are' : ' is'} deleted for good. There is no undo.</span></div></div>
    ${preview ? html`<div class="blk" id="rmprevbox" role="status">${preview}</div>` : ''}
    <div class="acts sticky"><p class="gohint" id="gohint">${ic('lock')}Type the title above to unlock the button.</p><button class="btn" type="button" data-back>Back</button>${ready() ? html`<button class="btn" type="button" id="rmprev" disabled>${ic('eye')}Preview only</button>` : ''}<button class="btn danger" type="button" id="rmgo" disabled>${ic('trash')}${label}</button></div>`;
  };

  const dlg = openDialog(step1(), { label: `Remove ${item.name}`, className: 'wide rm', canClose: () => !busy });
  const set = (content: SafeHtml): void => { dlg.body.innerHTML = content.value; dlg.body.querySelector<HTMLElement>('[data-autofocus]')?.focus(); };
  const paintDynamic = (): void => {
    const f = dlg.el.querySelector('#rmfreeblk');
    const pl = dlg.el.querySelector('#rmplan');
    if (f) f.innerHTML = freeBox().value;
    if (pl) pl.innerHTML = planList().value;
  };

  // Ask the helper for the plan (read-only). Everything degrades to the plain dialog.
  void (async () => {
    const admin = !!r.backend.currentUser()?.isAdmin;
    try {
      if (!admin || !(await r.backend.helper.available())) { state = { s: 'none', why: 'The Nuttyfin helper service is not running, so this is not available.' }; }
      else state = { s: 'ready', plan: await r.backend.helper.deletePlan(item.id) };
    } catch { state = { s: 'none', why: 'The helper could not check this one just now, so this is not available.' }; }
    if (!dlg.el.isConnected || busy || !dlg.el.querySelector('input[name="rmmode"]')) return; // the person moved on
    set(step1());
  })();

  dlg.el.addEventListener('input', e => {
    if (!(e.target instanceof HTMLInputElement) || e.target.id !== 'rmtype') return;
    const ok = norm(e.target.value) === norm(item.name);
    e.target.classList.toggle('match', ok);
    for (const id of ['#rmgo', '#rmprev']) { const b = dlg.el.querySelector<HTMLButtonElement>(id); if (b) b.disabled = !ok; }
    const hint = dlg.el.querySelector<HTMLElement>('#gohint');
    if (hint) hint.hidden = ok;
  });
  dlg.el.addEventListener('change', e => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.name === 'rmmode') {
      choice.arr = t.value === 'arr';
      if (!choice.arr) choice.torrent = false;
      const p = ready();
      const tog = dlg.el.querySelector<HTMLInputElement>('#rmtorrent');
      const on = choice.arr && canArr() && !!p && hasTorrent(p);
      if (tog) { tog.disabled = !on; tog.checked = choice.torrent; }
      dlg.el.querySelector('#rmtog')?.setAttribute('aria-disabled', String(!on));
      const d = dlg.el.querySelector('#rmtogd');
      if (d && p && hasTorrent(p)) d.textContent = on ? `${p.torrents.length === 1 ? 'One download shares' : `${p.torrents.length} downloads share`} these files: ${p.torrents[0]?.name ?? ''}${p.torrents.length === 1 ? (p.torrents[0]?.seeding ? ', still seeding' : ', finished') : ''}.` : `Choose "Also remove it from ${apps}" first.`;
      paintDynamic();
    } else if (t.id === 'rmtorrent') { choice.torrent = t.checked; paintDynamic(); }
  });

  const stepList = (steps: Array<{ label: string; status: string; detail?: string }>, dry: boolean): SafeHtml =>
    html`<ol class="rmsteps">${steps.map(s => html`<li class="${s.status}"><span class="st" aria-hidden="true">${s.status === 'done' ? ic('check') : s.status === 'failed' ? ic('x') : s.status === 'running' ? raw('<span class="spin sm"></span>') : s.status === 'skipped' ? ic('back') : s.status === 'dry-run' ? ic('eye') : raw('<i></i>')}</span>
      <span class="tx"><b>${dry && s.status === 'dry-run' ? `Would: ${s.label}` : s.label}</b>${s.detail ? html`<small>${s.detail}</small>` : ''}</span>
      <span class="sr">${s.status === 'dry-run' ? 'would run' : s.status}</span></li>`)}</ol>`;

  const helperRun = async (dryRun: boolean): Promise<DeleteResult> =>
    r.backend.helper.deleteExecute({ jellyfinId: item.id, mode: mode(), confirm: item.name, dryRun });

  const errorText = (err: unknown): string => {
    const status = (err as { status?: number } | null)?.status;
    const code = ((err as { body?: { error?: string } } | null)?.body?.error) ?? '';
    if (status === 403 && code === 'delete-disabled') return 'Deleting through the helper is switched off. Nothing was changed.';
    if (status === 403) return 'This account is not allowed to delete things.';
    if (status === 400) return 'The helper did not accept the typed title. Nothing was changed.';
    return 'The helper could not be reached, or did not accept it. Nothing was changed.';
  };

  dlg.el.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('[data-next]')) { set(step2('')); return; }
    if (e.target.closest('[data-back]')) { set(step1()); return; }

    const prev = e.target.closest<HTMLButtonElement>('#rmprev');
    if (prev && !prev.disabled) {
      const typed = dlg.el.querySelector<HTMLInputElement>('#rmtype')?.value ?? '';
      if (norm(typed) !== norm(item.name)) return;
      prev.disabled = true;
      void helperRun(true).then(res => {
        set(step2(typed, html`<span class="lbl">Preview: nothing was deleted</span>${stepList(res.steps, true)}<p class="rmfree good">${ic('drive')}<span><b>${ready() ? freedSentence(ready() as DeletePlan, res.mode) : ''}</b></span></p>`));
        const t = dlg.el.querySelector<HTMLInputElement>('#rmtype');
        if (t) { t.value = typed; t.dispatchEvent(new Event('input', { bubbles: true })); t.focus(); }
      }).catch((err: unknown) => {
        prev.disabled = false;
        set(step2(typed, html`<p class="rmfree warn">${ic('warn')}<span><b>${errorText(err)}</b></span></p>`));
      });
      return;
    }

    const go = e.target.closest<HTMLButtonElement>('#rmgo');
    if (!go || go.disabled || busy) return;
    const typed = dlg.el.querySelector<HTMLInputElement>('#rmtype')?.value ?? '';
    if (norm(typed) !== norm(item.name)) return; // the second confirm: the button alone is not enough
    busy = true;
    const m = mode();
    const p = ready();
    const viaHelper = !!p && p.deleteEnabled;
    const labels = (p?.modes[m].steps ?? ['Delete it in Jellyfin']).map((label, i) => ({ label, status: i === 0 ? 'running' : 'pending' }));
    dlg.body.innerHTML = html`<div class="head">${poster(item)}<div><h2 id="rmh">Removing...</h2><p class="lead">Please keep this open. It goes step by step and stops if anything fails.</p></div></div>
      <div class="blk" role="status" aria-live="polite" id="rmprog">${stepList(labels, false)}</div>`.value;

    const finish = (res: DeleteResult): void => {
      busy = false;
      const out = outcomeText(res);
      const freed = res.ok && m === 'arr-and-files-and-torrent' && p?.measured ? `About ${fmtBytes(res.freedBytes ?? 0)} came back on the drive.` : res.ok && p?.measured ? freedSentence(p, m) : '';
      dlg.body.innerHTML = res.ok
        ? html`<div class="head">${poster(item)}<div><h2 id="rmh" tabindex="-1" data-autofocus>${item.name} is gone</h2><p class="lead">${m === 'jellyfin-only' ? `${apps} and the download were not touched.` : 'Every step finished.'}</p></div></div>
          <div class="blk">${stepList(res.steps, false)}</div>
          <div class="result" role="status">${nutbot(40, 'happy')}<div><b>Removed</b><span>${freed || 'It no longer shows up in Nuttyfin.'}</span></div></div>
          <div class="acts"><button class="btn primary" type="button" data-done>Back to the library</button></div>`.value
        : html`<div class="head">${poster(item)}<div><h2 id="rmh" tabindex="-1" data-autofocus>${out.title}</h2><p class="lead">${out.detail}</p></div></div>
          <div class="blk">${stepList(res.steps, false)}</div>
          <div class="result bad" role="alert">${nutbot(40, 'sleepy')}<div><b>Not everything was removed</b><span>You can try again, or fix it in ${apps} or qBittorrent by hand.</span></div></div>
          <div class="acts"><button class="btn" type="button" data-close>Close</button><button class="btn" type="button" data-back>Try again</button></div>`.value;
      dlg.body.querySelector<HTMLElement>('[data-autofocus]')?.focus();
      dlg.body.querySelector('[data-done]')?.addEventListener('click', () => { dlg.close(); r.onRemoved(); });
    };

    if (viaHelper) {
      helperRun(false).then(finish).catch((err: unknown) => finish({ dryRun: false, mode: m, ok: false, steps: [{ step: 'jellyfin', label: 'Ask the helper', status: 'failed', detail: errorText(err) }] }));
    } else {
      // No helper (or deleting through it is off): the original direct path, Jellyfin only.
      r.backend.deleteFromJellyfin(item.id).then(() => finish({ dryRun: false, mode: 'jellyfin-only', ok: true, steps: [{ step: 'jellyfin', label: 'Delete it in Jellyfin', status: 'done' }] }))
        .catch((err: unknown) => {
          const status = (err as { status?: number } | null)?.status;
          finish({ dryRun: false, mode: 'jellyfin-only', ok: false, steps: [{ step: 'jellyfin', label: 'Delete it in Jellyfin', status: 'failed', detail: status === 403 ? 'Jellyfin says this account is not allowed to delete things' : 'Jellyfin did not accept it, or could not be reached' }] });
        });
    }
  });
  return dlg;
}
