/**
 * The NutBot chat: a modal <dialog> (focus trap, Escape and the backdrop come from the platform), a bottom sheet on
 * phones. It only talks to a `NutBrain`; picks are library items (Play / Details) or Seerr results (Request).
 */
import { ApiError } from '../../../api';
import type { SeerrResult, Title } from '../../../api/types';
import { esc, html, type SafeHtml } from '../../../lib/html';
import { runtime } from '../../../lib/format';
import { icon } from '../../../ui/icons';
import { nutbot } from '../../../ui/nutbot';
import { detailsPath, img, ph, playPath, posterUrl, seerrPoster } from '../art';
import type { HomeCtx } from '../tile';
import type { NutAnswer, NutBrain, Pick } from './brain';
import { MOODS } from './moods';
import { statusChip } from '../requestsPanel';

export interface ChatHandle {
  open(opts?: { ask?: string; trigger?: HTMLElement | null }): void;
  close(): void;
  destroy(): void;
  /** true once the person has said something (the tile then says "Back to our chat") */
  readonly talked: boolean;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createChat(ctx: HomeCtx, brain: NutBrain, onChange: () => void = () => {}): ChatHandle {
  const dlg = document.createElement('dialog');
  dlg.className = 'nbc';
  dlg.setAttribute('aria-labelledby', 'nbcH');
  dlg.innerHTML = `
    <div class="nbc-grab" aria-hidden="true"></div>
    <header class="nbc-head">
      <span class="nbc-face"></span>
      <div class="nbc-ttl"><h2 id="nbcH">NutBot</h2><small>Picks from your library, and what you can ask for</small></div>
      <button class="btn sm ghost" type="button" data-new aria-label="Start a new chat">${icon('undo').value}<span class="lbl">New chat</span></button>
      <button class="iconbtn" type="button" data-close aria-label="Close chat">${icon('x').value}</button>
    </header>
    <div class="nbc-log" role="log" aria-live="polite" aria-label="Conversation with NutBot" tabindex="-1"></div>
    <div class="nbc-foot">
      <div class="moods" role="group" aria-label="Quick replies"></div>
      <form class="composer" autocomplete="off">
        <label class="sr" for="nbcIn">Message NutBot</label>
        <input id="nbcIn" type="text" maxlength="160" enterkeyhint="send" placeholder="Tell NutBot, like: funny but under 2 hours">
        <button class="send" type="submit" aria-label="Send to NutBot">${icon('send').value}</button>
      </form>
      <p class="nbc-fine">NutBot only looks at this library and what you can request.</p>
    </div>`;
  document.body.append(dlg);

  const log = dlg.querySelector<HTMLElement>('.nbc-log') as HTMLElement;
  const quick = dlg.querySelector<HTMLElement>('.nbc-foot .moods') as HTMLElement;
  const input = dlg.querySelector<HTMLInputElement>('#nbcIn') as HTMLInputElement;
  const face = dlg.querySelector<HTMLElement>('.nbc-face') as HTMLElement;
  const send = dlg.querySelector<HTMLButtonElement>('.send') as HTMLButtonElement;
  let trigger: HTMLElement | null = null;
  let busy = false;
  let greeted = false;
  const state = { talked: false };

  const setFace = (m: 'idle' | 'happy' | 'look') => { face.innerHTML = nutbot(40, m).value; };
  setFace('happy');

  const row = (cls: string, inner: SafeHtml | string, bot = true): HTMLElement => {
    const last = log.lastElementChild;
    const cont = bot && !!last && last.classList.contains('bot') && !last.classList.contains('think');
    const r = document.createElement('div');
    r.className = `nm-row ${cls}${cont ? ' cont' : ''}`;
    r.innerHTML = (bot ? `<span class="av" aria-hidden="true">${nutbot(34, 'happy').value}</span>` : '') + (typeof inner === 'string' ? inner : inner.value);
    log.append(r);
    return r;
  };
  const scrollTo = (el: HTMLElement) => log.scrollTo({ top: Math.max(0, el.offsetTop - 12), behavior: reduced() ? 'auto' : 'smooth' });

  const setQuick = (labels: readonly string[]) => {
    quick.innerHTML = labels.map(l => `<button class="mood" type="button" data-say="${esc(l)}">${icon('spark').value}${esc(l)}</button>`).join('');
    quick.scrollLeft = 0;
  };
  const startQuick = () => setQuick(MOODS.slice(0, 8).map(m => m.ask));

  const greet = () => {
    const name = ctx.user?.name;
    row('bot', html`<div class="bub">${name ? `Hi ${name}.` : 'Hi!'} <b>What are you in the mood for?</b> Pick a mood or tell me in your own words, like "funny but under 2 hours" or "something like Silo".</div>`);
    startQuick();
    greeted = true;
  };

  const metaOf = (t: Title): string => [t.kind === 'series' ? 'Show' : 'Film', t.year, t.kind === 'movie' && t.runtimeMin ? runtime(t.runtimeMin) : '', t.certification].filter(Boolean).join(' · ');

  const libraryCard = (t: Title, why: string, i: number): SafeHtml => html`
    <article class="nbcard" style="--i:${i}" role="listitem" aria-label="${t.name}">
      <span class="ph" ${ph(t.id, t.name)}>${img(posterUrl(t, 200))}</span>
      <div class="cw"><h3>${t.name}</h3><span class="meta">${metaOf(t)}</span>
        <p class="why">${why}</p>${t.overview ? html`<p class="blurb">${t.overview}</p>` : ''}</div>
      <div class="acts"><a class="btn primary sm" href="#${playPath(t)}" data-nav-away>${icon('play')}${t.progress ? 'Resume' : 'Play'}</a><a class="btn sm" href="#${detailsPath(t)}" data-nav-away>Details</a></div>
    </article>`;

  const requestCard = (r: SeerrResult, why: string, i: number): SafeHtml => html`
    <article class="nbcard req" style="--i:${i}" role="listitem" aria-label="${r.title}">
      <span class="ph" ${ph(`tmdb${r.tmdbId}`, r.title)}>${img(seerrPoster(r, 'w185'))}</span>
      <div class="cw"><h3>${r.title}</h3><span class="meta">${[r.mediaType === 'tv' ? 'Show' : 'Film', r.year].filter(Boolean).join(' · ')}</span>
        <span class="ntag">${icon('cloud')}Not in your library yet</span>
        <p class="why">${why}</p>${r.overview ? html`<p class="blurb">${r.overview}</p>` : ''}</div>
      <div class="acts">${r.state
    ? statusChip(r.state)
    : html`<button class="btn sm req" type="button" data-req="${r.tmdbId}" data-type="${r.mediaType}" aria-label="Request ${r.title}">${icon('ask')}Request it</button>`}</div>
    </article>`;

  const cardsOf = (picks: readonly Pick[]): SafeHtml =>
    html`<div class="nbcards" role="list" aria-label="NutBot's picks">${picks.map((p, i) => p.kind === 'library' ? libraryCard(p.title, p.why, i) : requestCard(p.result, p.why, i))}</div>`;

  async function say(text: string): Promise<void> {
    text = text.trim().slice(0, 160);
    if (!text || busy) return;
    busy = true;
    state.talked = true;
    onChange();
    send.disabled = true;
    quick.classList.add('wait');
    const mine = row('me', html`<div class="bub">${text}</div>`, false);
    const think = row('bot think', html`<div class="bub"><span class="dots3" aria-hidden="true"><i></i><i></i><i></i></span><span>Thinking</span></div>`);
    setFace('look');
    scrollTo(mine);
    let ans: NutAnswer;
    try {
      const [a] = await Promise.all([brain.ask(text), sleep(reduced() ? 120 : 520)]);
      ans = a;
    } catch (e) {
      console.warn('NutBot failed', e);
      ans = { reply: 'Sorry, I tripped over something. Try that again in a moment?', picks: [] };
    }
    think.remove();
    const first = row('bot', html`<div class="bub">${ans.reply}</div>`);
    if (ans.picks.length) {
      const cards = document.createElement('div');
      cards.innerHTML = cardsOf(ans.picks).value;
      log.append(...Array.from(cards.children));
    }
    setQuick(ans.quick ?? MOODS.slice(0, 6).map(m => m.ask));
    setFace('happy');
    scrollTo(mine.isConnected ? mine : first);
    send.disabled = false;
    quick.classList.remove('wait');
    busy = false;
  }

  async function request(btn: HTMLButtonElement): Promise<void> {
    if (btn.disabled) return;
    const tmdbId = Number(btn.dataset.req);
    const mediaType = btn.dataset.type === 'tv' ? 'tv' : 'movie';
    btn.disabled = true;
    btn.innerHTML = '<span class="dots3" aria-hidden="true"><i></i><i></i><i></i></span>Asking';
    const acts = btn.closest('.acts') as HTMLElement;
    try {
      await ctx.backend.seerr.request({ mediaType, tmdbId });
      ctx.data.forget('myRequests', 'allRequests');
      acts.innerHTML = `<p class="done">${icon('check').value}<span>Asked for it. It shows up in Requests.<small>Someone has to say yes first.</small></span></p>`;
    } catch (e) {
      const why = e instanceof ApiError && e.status === 409 ? 'Someone already asked for this one.' : 'That did not go through. Try again in a moment.';
      acts.innerHTML = `<button class="btn sm req" type="button" data-req="${tmdbId}" data-type="${mediaType}">${icon('ask').value}Try again</button><p class="note">${esc(why)}</p>`;
    }
  }

  const reset = () => {
    log.innerHTML = '';
    greeted = false;
    state.talked = false;
    (brain as { reset?: () => void }).reset?.();
    greet();
    onChange();
  };

  dlg.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t === dlg) { close(); return; }
    if (t.closest('[data-close]')) { close(); return; }
    if (t.closest('[data-new]')) { reset(); input.focus(); return; }
    const say1 = t.closest<HTMLElement>('[data-say]');
    if (say1?.dataset.say) { void say(say1.dataset.say); return; }
    const req = t.closest<HTMLButtonElement>('[data-req]');
    if (req) { void request(req); return; }
    if (t.closest('[data-nav-away]')) dlg.close(); // the router takes over; the dialog is not needed behind the next page
  });
  dlg.querySelector('form')?.addEventListener('submit', e => { e.preventDefault(); const v = input.value; input.value = ''; void say(v); });
  dlg.addEventListener('close', () => {
    document.documentElement.classList.remove('nbc-open');
    const back = trigger && trigger.isConnected ? trigger : null;
    back?.focus();
    onChange();
  });

  function open(opts: { ask?: string; trigger?: HTMLElement | null } = {}): void {
    trigger = opts.trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (!greeted) greet();
    if (!dlg.open) { dlg.showModal(); document.documentElement.classList.add('nbc-open'); }
    log.scrollTop = log.scrollHeight;
    if (opts.ask) void say(opts.ask); else input.focus({ preventScroll: true });
  }
  function close(): void { if (dlg.open) dlg.close(); }

  return {
    open, close,
    destroy() { if (dlg.open) dlg.close(); dlg.remove(); document.documentElement.classList.remove('nbc-open'); },
    get talked() { return state.talked; },
  };
}
