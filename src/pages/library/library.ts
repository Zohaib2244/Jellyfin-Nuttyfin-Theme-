/**
 * Library page for Movies (#/movies) and Shows (#/shows). Follows design/mockups/library.html:
 * NutBot line, the "mixing desk" of switches, a sticky summary (count, active switches, order, view),
 * five views (posters, wall, list, shelves by collection, progress board), an A to Z scrubber, "Surprise me",
 * and a phone sheet. Real data comes from paged /Items queries; filters, order and view live in the URL.
 */
import type { Backend } from '../../api/backend';
import { imageUrl } from '../../api';
import type { Collection, Episode, GenreCount, ItemsQuery, Season, Title } from '../../api/types';
import { relativeTime, parseDate, clock, runtime } from '../../lib/format';
import { html, raw, setHtml } from '../../lib/html';
import { store } from '../../lib/storage';
import { nutbot } from '../../ui/nutbot';
import type { Page, PageContext } from '../types';
import { closeAllDialogs, openDialog } from '../common/dialog';
import { ic } from '../common/icons';
import '../common/common.css';
import './library.css';
import { slotAt, type BotCtx, type Slot } from './bot';
import { cardHTML, LANES, shelfHTML, showCardHTML, type CardCtx } from './cards';
import {
  activeKeys, groupsFor, laneOf, letterOf, ORDERS, parseState, passes, stateToQuery, toQuery, VIEWS,
  type Group, type LibKind, type LibState, type OrderId, type ViewId,
} from './filters';
import { openSurprise } from './surprise';

const LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DEFAULT_PAGE = 60;
const ALL_CAP = 1000;
const RM = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;

interface Remembered { sig: string; n: number }

export function makeLibraryPage(kind: LibKind): Page {
  return {
    title: kind === 'movies' ? 'Movies' : 'Shows',
    render: ctx => render(ctx, kind),
  };
}

async function render(ctx: PageContext, kind: LibKind): Promise<HTMLElement> {
  const { backend, router } = ctx;
  const unit = kind === 'movies' ? 'film' : 'show';
  const pageSize = kind === 'movies' ? DEFAULT_PAGE : 200;
  const memoryKey = `libload.${kind}`;

  /* ── state ── */
  let groups: Group[] = groupsFor(kind);
  let st: LibState = parseState(kind, ctx.query, groups);
  let genres: GenreCount[] = [];
  let items: Title[] = [];
  let total = 0;
  let collections: Collection[] = [];
  let seasons = new Map<string, Season[]>();
  let nextUp = new Map<string, Episode>();
  let counts: { movies?: number; shows?: number; fourK?: number; unseen?: number } = {};
  let loading = false;
  let failed = false;
  let rendered = 0;
  let lastLetter: string | null = null;
  let loadAbort: AbortController | null = null;
  let generation = 0;
  let botSlot: Slot = slotAt(new Date());
  let botLine = 0;
  let botCtx: BotCtx = { name: ctx.user?.name ?? 'there', n: 0 };

  const cx = (): CardCtx => ({ href: p => router.href(p), seasons, nextUp, now: Date.now() });
  const sheetRoots = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.lib-sheet .sheetbody'));

  /* ── DOM ── */
  const root = document.createElement('section');
  root.className = 'page lib';
  setHtml(root, html`
    <div class="head">
      <div><h1 id="libTitle" data-autofocus></h1><p class="lede" id="lede"></p></div>
      <nav class="seg libtabs" id="libtabs" aria-label="Library"></nav>
    </div>
    <section class="bot" aria-label="NutBot">
      <span aria-hidden="true">${nutbot(46, 'happy')}</span>
      <p class="say" id="say" aria-live="polite"></p>
      <div class="acts">
        <button class="btn sm" type="button" id="tryMix"></button>
        <button class="btn sm primary" type="button" id="surprise">${ic('shuffle')}Surprise me</button>
      </div>
    </section>
    <div class="desk" id="desk" role="group" aria-label="Mix your list" hidden></div>
    <div class="sum" id="sum">
      <button class="btn sm filterbtn" type="button" id="filterBtn" aria-haspopup="dialog">${ic('sliders')}Filters<span class="badge" id="fcount" hidden></span></button>
      <div class="count" id="count" aria-live="polite"></div>
      <div class="actv" id="on"></div>
      <div class="ctlrow">
        <span class="lbl" id="orderLbl">ORDER</span>
        <div class="seg order" id="order" role="group" aria-labelledby="orderLbl"></div>
        <span class="lbl" id="viewLbl">VIEW</span>
        <div class="seg views" id="views" role="group" aria-labelledby="viewLbl"></div>
        <button class="iconbtn" type="button" id="foldBtn" aria-expanded="false" aria-controls="desk" title="Show the mixing desk">${ic('sliders')}<span class="sr">Show or hide the mixing desk</span></button>
      </div>
    </div>
    <div class="resw" id="resw">
      <div class="res v-posters" id="res" aria-label="Results"></div>
      <div class="azrail" id="azrail" role="slider" tabindex="0" aria-label="Jump to letter" aria-valuemin="0" aria-valuemax="26" aria-valuenow="0" aria-valuetext="Letter A"></div>
    </div>
    <div class="more" id="more" hidden>
      <span id="moreNote"></span><button class="btn" type="button" id="moreBtn">Show more</button>
    </div>
    <div class="bubble" id="bubble" aria-hidden="true"></div>
    <div class="sr" id="live" role="status" aria-live="polite"></div>`);

  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => root.querySelector<T>(sel) as T;
  const res = q('#res');
  const resw = q('#resw');
  const desk = q('#desk');
  const live = q('#live');
  const say = (msg: string): void => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 30); };

  /* ── URL ── */
  const pushUrl = (): void => router.replaceQuery(stateToQuery(kind, st, groups));
  const signature = (): string => `${kind}|${JSON.stringify(stateToQuery(kind, st, groups))}`;
  const remember = (): void => store.set<Remembered>(memoryKey, { sig: signature(), n: items.length });

  /* ── loading ── */
  const mixQuery = (): ItemsQuery => toQuery(kind, st, groups);
  const isShelves = (): boolean => st.view === 'shelves';
  const wantsAll = (): boolean => kind === 'shows' || st.view === 'progress';
  const hasMore = (): boolean => !isShelves() && items.length < total;

  async function fetchRange(start: number, limit: number, signal: AbortSignal): Promise<{ items: Title[]; total: number }> {
    const r = await backend.items({ ...mixQuery(), start, limit }, signal);
    return { items: r.items, total: r.total };
  }

  async function loadFirst(): Promise<void> {
    loadAbort?.abort();
    const ac = new AbortController();
    loadAbort = ac;
    const mine = ++generation;
    ctx.signal.addEventListener('abort', () => ac.abort(), { once: true });
    loading = true;
    failed = false;
    paintStatus();
    let nextItems: Title[] = [];
    let nextTotal = 0;
    try {
      if (isShelves()) {
        collections = await backend.collections(ac.signal);
        nextTotal = collections.length;
      } else {
        const saved = store.get<Remembered | null>(memoryKey, null);
        const restoring = saved && saved.sig === signature() && saved.n > pageSize ? Math.min(saved.n, 400) : 0;
        const first = await fetchRange(0, wantsAll() ? pageSize : Math.max(pageSize, restoring), ac.signal);
        if (mine !== generation) return;
        nextItems = first.items;
        nextTotal = first.total;
        if (wantsAll()) {
          while (nextItems.length < nextTotal && nextItems.length < ALL_CAP) {
            const more = await fetchRange(nextItems.length, pageSize, ac.signal);
            if (mine !== generation) return;
            if (!more.items.length) break;
            nextItems = nextItems.concat(more.items);
          }
        }
        if (kind === 'shows') {
          if (!seasons.size) await loadShowExtras(ac.signal);
          // "Where you are" needs the watching lane, which only the browser can work out
          if (st.sel.where?.size) {
            nextItems = nextItems.filter(t => passes(t, st, groups, { lane: x => laneOf(x) }));
            nextTotal = nextItems.length;
          }
        }
        if (st.order === 'left') nextItems = sortLeft(nextItems);
      }
    } catch (e) {
      if (mine !== generation || ac.signal.aborted) return;
      console.error(e);
      failed = true;
    }
    if (mine !== generation) return;
    loading = false;
    items = nextItems;
    total = nextTotal;
    rendered = 0;
    lastLetter = null;
    paintAll();
    remember();
    feedBackground();
  }

  async function loadShowExtras(signal: AbortSignal): Promise<void> {
    const [s, n] = await Promise.all([
      backend.allSeasons(signal).catch(() => [] as Season[]),
      backend.nextUp(200).catch(() => [] as Episode[]),
    ]);
    seasons = new Map();
    for (const x of s) seasons.set(x.seriesId, [...(seasons.get(x.seriesId) ?? []), x]);
    for (const list of seasons.values()) list.sort((a, b) => a.number - b.number);
    nextUp = new Map(n.map(e => [e.seriesId, e]));
  }

  function sortLeft(list: Title[]): Title[] {
    return [...list].sort((a, b) => ((a.unplayedCount || 9999) - (b.unplayedCount || 9999)) || a.name.localeCompare(b.name));
  }

  let inflight: Promise<void> | null = null;
  /** Waits for a page that is already on its way, then loads the next one (callers may want "at least this many"). */
  async function loadMore(focusNew: boolean, until?: number): Promise<void> {
    while (inflight) await inflight;
    if (loading || !hasMore() || (until != null && items.length >= until)) return;
    inflight = pageIn(focusNew, until);
    try { await inflight; } finally { inflight = null; }
  }

  async function pageIn(focusNew: boolean, until?: number): Promise<void> {
    const mine = generation;
    const ac = loadAbort ?? new AbortController();
    loading = true;
    paintMoreBar();
    const before = items.length;
    try {
      const limit = until != null ? Math.max(pageSize, until - items.length) : pageSize;
      const r = await fetchRange(items.length, Math.min(limit, 1000), ac.signal);
      if (mine !== generation) return;
      items = items.concat(r.items);
      total = r.total;
    } catch (e) {
      if (mine !== generation || ac.signal.aborted) return;
      console.error(e);
      toastSoft("Could not load more. Try again.");
    } finally {
      if (mine === generation) loading = false;
    }
    if (mine !== generation) return;
    paintMore();
    remember();
    say(`${items.length} of ${total} ${total === 1 ? unit : unit + 's'} showing.`);
    if (focusNew) {
      const target = res.children[firstIndexOf(before)]?.querySelector<HTMLElement>('a, button');
      target?.focus({ preventScroll: false });
    }
  }
  const toastSoft = (m: string): void => ctx.shell.toast(m, 'info');

  /** child index in #res of the card for items[i] (letter cards sit between cards) */
  function firstIndexOf(i: number): number {
    let n = -1;
    for (let k = 0; k < res.children.length; k++) {
      if ((res.children[k] as HTMLElement).dataset.i === String(i)) { n = k; break; }
    }
    return Math.max(0, n);
  }

  /* ── painting ── */
  function paintStatus(): void {
    const view = st.view;
    // keep what is on screen (dimmed) while a new list loads; skeletons only when there is nothing yet
    res.setAttribute('aria-busy', 'true');
    if (!res.children.length || res.querySelector('.status')) {
      res.className = `res v-${view}`;
      resw.classList.toggle('norail', !['posters', 'wall', 'list'].includes(view));
      const n = view === 'progress' || view === 'shelves' ? 4 : view === 'list' ? 6 : 12;
      res.innerHTML = `<div class="status">${nutbot(28, 'look').value}<span>Getting your ${kind === 'movies' ? 'films' : 'shows'} from the server.</span></div>${'<div class="sk"></div>'.repeat(n)}`;
    }
    paintChrome();
  }

  function emptyHtml(): string {
    return html`<div class="lempty">${nutbot(64, failed ? 'sleepy' : 'look')}<div>
      ${failed
        ? html`<h2>Could not reach the server</h2><p>Your ${kind === 'movies' ? 'films' : 'shows'} did not load. Check the connection and try again.</p><div class="acts"><button class="btn sm primary" type="button" data-retry>${ic('restart')}Try again</button></div>`
        : html`<h2>Nothing matches all of that</h2><p id="dropHint">Try fewer switches. Not on the server at all? Ask for it on the Requests page.</p>
          <div class="acts"><span id="dropBtn"></span><button class="btn sm" type="button" data-clear>Clear all switches</button><a class="btn sm ghost" href="${router.href('/requests')}">${ic('ask')}Ask for a ${unit}</a></div>`}
    </div></div>`.value;
  }

  /** The "Drop X" suggestion: what the count would be without each active switch (a few cheap count-only queries). */
  async function suggestDrop(mine: number): Promise<void> {
    const act = activeKeys(st.sel, groups);
    if (!act.length) return;
    const tries = await Promise.all(act.map(async a => {
      const sel = { ...st.sel, [a.g.id]: new Set([...(st.sel[a.g.id] ?? [])].filter(k => k !== a.key.k)) };
      const r = await backend.items({ ...toQuery(kind, { ...st, sel }, groups), start: 0, limit: 0 }, loadAbort?.signal).catch(() => null);
      return { a, n: r?.total ?? 0 };
    }));
    if (mine !== generation) return;
    const best = tries.sort((x, y) => y.n - x.n)[0];
    const hint = root.querySelector<HTMLElement>('#dropHint');
    const btn = root.querySelector<HTMLElement>('#dropBtn');
    if (!best || best.n === 0 || !hint || !btn) return;
    setHtml(hint, html`Drop <b>${best.a.key.t}</b> and there ${best.n === 1 ? 'is' : 'are'} ${plural(best.n, unit)}. Not on the server at all? Ask for it on the Requests page.`);
    setHtml(btn, html`<button class="btn sm primary" type="button" data-drop="${best.a.g.id}:${best.a.key.k}">Drop ${best.a.key.t}</button>`);
  }

  function nodeFor(t: Title, i: number): HTMLElement {
    const el = document.createElement('div');
    el.className = `lc${t.played && t.kind === 'movie' ? ' seen' : ''}`;
    el.dataset.i = String(i);
    el.dataset.id = t.id;
    el.setAttribute('role', 'listitem');
    el.innerHTML = cardHTML(t, st.view, cx()).value;
    return el;
  }

  function appendNodes(from: number, animate: boolean): void {
    const frag = document.createDocumentFragment();
    const az = st.order === 'az' && ['posters', 'wall', 'list'].includes(st.view);
    for (let i = from; i < items.length; i++) {
      const t = items[i] as Title;
      if (az) {
        const L = letterOf(t.name);
        if (L !== lastLetter) {
          lastLetter = L;
          const d = document.createElement('div');
          d.className = 'lettr';
          d.dataset.letter = L;
          d.setAttribute('aria-hidden', 'true');
          d.textContent = L;
          frag.append(d);
        }
      }
      const n = nodeFor(t, i);
      if (animate && !RM()) n.classList.add('in');
      frag.append(n);
    }
    res.append(frag);
    rendered = items.length;
  }

  function paintAll(): void {
    res.removeAttribute('aria-busy');
    res.className = `res v-${st.view}`;
    res.setAttribute('role', 'list');
    resw.classList.toggle('norail', !['posters', 'wall', 'list'].includes(st.view));
    res.replaceChildren();
    lastLetter = null;
    rendered = 0;
    const mine = generation;
    if (failed) { res.innerHTML = emptyHtml(); }
    else if (isShelves()) paintShelves();
    else if (!items.length) { res.innerHTML = emptyHtml(); void suggestDrop(mine); }
    else if (st.view === 'progress') paintProgress();
    else appendNodes(0, true);
    paintChrome();
    paintMoreBar();
    observeSentinel();
  }

  function paintMore(): void {
    appendNodes(rendered, true);
    paintChrome();
    paintMoreBar();
  }

  function paintShelves(): void {
    const mix = (t: Title): boolean => passes(t, st, groups);
    const sets = collections.filter(c => c.items.some(mix));
    if (!sets.length) { res.innerHTML = emptyHtml(); return; }
    for (const s of sets) {
      const el = document.createElement('section');
      el.className = 'shelf';
      el.setAttribute('aria-label', s.name);
      el.innerHTML = shelfHTML(s, cx(), mix).value;
      res.append(el);
    }
    total = sets.length;
  }

  function paintProgress(): void {
    const c = cx();
    for (const [lane, title, ico, note] of LANES) {
      const inLane = items.filter(t => laneOf(t, c.now) === lane);
      const shown = inLane;
      if (!shown.length) continue;
      const head = document.createElement('div');
      head.className = 'lane';
      head.innerHTML = html`<h2>${ic(ico)}${title}</h2><span class="n">${shown.length}</span><p>${note}</p>`.value;
      res.append(head);
      for (const t of shown) {
        const el = document.createElement('article');
        el.className = 'sc';
        el.dataset.id = t.id;
        el.innerHTML = showCardHTML(t, c).value;
        res.append(el);
      }
    }
    rendered = items.length;
  }

  function paintMoreBar(): void {
    const more = q('#more');
    const show = hasMore() && !failed;
    more.hidden = !show;
    if (!show) return;
    q('#moreNote').textContent = loading ? 'Loading more...' : `Showing ${items.length} of ${total}`;
    const btn = q<HTMLButtonElement>('#moreBtn');
    btn.disabled = loading;
    btn.textContent = loading ? 'Loading...' : `Show more (${total - items.length} left)`;
  }

  /** What the page says about itself: count, active switches, order, view, tabs, lede. */
  function paintChrome(): void {
    const act = activeKeys(st.sel, groups);
    const n = isShelves() ? total : total;
    q('#count').innerHTML = isShelves()
      ? `<b>${n}</b>${n === 1 ? 'set' : 'sets'}`
      : `<b>${loading && !items.length ? '...' : n}</b>${n === 1 ? unit : unit + 's'}${act.length ? ' <span class="sr">match</span>' : ''}`;
    q('#on').innerHTML = act.length
      ? html`${act.map(a => html`<button type="button" data-drop="${a.g.id}:${a.key.k}" aria-label="Remove ${a.key.t}">${a.key.t}${ic('x')}</button>`)}${act.length > 1 ? html`<button type="button" class="clear" data-clear>Clear all</button>` : ''}`.value
      : '<span class="none">Everything. Press a switch to narrow it down.</span>';
    const fc = q('#fcount');
    fc.textContent = String(act.length);
    fc.hidden = !act.length;
    q('#order').innerHTML = ORDERS[kind].map(([k, t]) => `<button type="button" data-order="${k}" aria-pressed="${String(st.order === k)}">${t}</button>`).join('');
    q('#views').innerHTML = VIEWS[kind].map(([k, t, i]) => `<button type="button" data-view="${k}" aria-pressed="${String(st.view === k)}" aria-label="${t}" title="${t}">${ic(i).value}</button>`).join('');
    paintDesk(desk);
    for (const r of sheetRoots()) { paintDesk(r.querySelector<HTMLElement>('.desk') as HTMLElement); syncSheet(r); }

    const only4k = st.sel.xtra?.size === 1 && st.sel.xtra.has('4k') && act.length === 1;
    const tab: 'movies' | 'shows' | '4k' | 'sets' = kind === 'shows' ? 'shows' : st.view === 'shelves' ? 'sets' : only4k ? '4k' : 'movies';
    const tabTitle = { movies: 'Movies', shows: 'Shows', '4k': '4K Movies', sets: 'Collections' }[tab];
    q('#libTitle').textContent = tabTitle;
    ctx.shell.setTitle(tabTitle);
    const tabs: Array<[typeof tab, string, string, 'film' | 'tv' | 'k4' | 'stack', number | undefined]> = [
      ['movies', '/movies', 'Movies', 'film', counts.movies], ['shows', '/shows', 'Shows', 'tv', counts.shows],
      ['4k', '/movies?xtra=4k', '4K Movies', 'k4', counts.fourK], ['sets', '/movies?view=shelves', 'Collections', 'stack', undefined],
    ];
    q('#libtabs').innerHTML = tabs.map(([k, href, t, i, c]) => `<a href="${router.href(href)}"${k === tab ? ' aria-current="page"' : ''}>${ic(i).value}${t}${c != null ? ` <small>${c}</small>` : ''}</a>`).join('');
    q('#lede').innerHTML = ledeHtml(tab);
    q('#foldBtn').setAttribute('aria-expanded', String(!desk.hidden));
    paintRail();
    paintBot();
  }

  function ledeHtml(tab: string): string {
    if (tab === 'movies' || tab === '4k') {
      if (tab === '4k') return `<b>${counts.fourK ?? '...'} ${counts.fourK === 1 ? 'film' : 'films'}</b> in 4K. The rest play in HD.`;
      return `<b>${counts.movies ?? '...'} films</b> on the server${counts.unseen != null ? ` · ${counts.unseen} you have not seen yet` : ''}`;
    }
    if (tab === 'sets') return `<b>${collections.length || '...'} sets</b> of films that belong together, in watching order`;
    const c = cx();
    const lanes = { new: 0, watching: 0 };
    if (!activeKeys(st.sel, groups).length) for (const t of items) { const l = laneOf(t, c.now); if (l === 'new' || l === 'watching') lanes[l]++; }
    return `<b>${counts.shows ?? '...'} shows</b>${items.length && !activeKeys(st.sel, groups).length ? ` · ${lanes.new} with new episodes · ${lanes.watching} on the go` : ''}`;
  }

  function paintDesk(target: HTMLElement): void {
    if (!target) return;
    // build once per group list, then just flip the pressed state
    const sig = groups.map(g => `${g.id}:${g.keys.length}`).join('|');
    if (target.dataset.sig !== sig) {
      target.dataset.sig = sig;
      target.innerHTML = groups.map(g => html`<fieldset class="chan${g.wide ? ' wide' : ''}"><legend>${ic(g.icon)}${g.label}${g.one ? html` <span class="one">pick one</span>` : ''}</legend>
        <div class="keys">${g.keys.map(k => {
          const c = g.id === 'genre' ? genres.find(x => x.name === k.k)?.count : undefined;
          return html`<button type="button" class="key" data-g="${g.id}" data-k="${k.k}" aria-pressed="false"><span>${k.t}</span>${c != null ? html`<b class="n">${c}</b>` : ''}</button>`;
        })}</div></fieldset>`).join('');
    }
    for (const b of Array.from(target.querySelectorAll<HTMLElement>('.key'))) {
      b.setAttribute('aria-pressed', String(!!st.sel[b.dataset.g ?? '']?.has(b.dataset.k ?? '')));
    }
  }

  /* ── A to Z ── */
  let railIdx = 1;
  function paintRail(): void {
    const rail = q('#azrail');
    if (!rail.children.length) rail.innerHTML = LETTERS.map(l => `<span aria-hidden="true">${l}</span>`).join('');
    Array.from(rail.children).forEach((s, i) => s.classList.toggle('cur', st.order === 'az' && i === railIdx));
  }

  async function railJump(i: number, fromKey: boolean): Promise<void> {
    const idx = Math.max(0, Math.min(LETTERS.length - 1, i));
    railIdx = idx;
    const L = LETTERS[idx] as string;
    const rail = q('#azrail');
    Array.from(rail.children).forEach((s, k) => s.classList.toggle('cur', k === idx));
    rail.setAttribute('aria-valuenow', String(idx));
    rail.setAttribute('aria-valuetext', `Letter ${L}`);
    const bub = q('#bubble');
    bub.textContent = L;
    const r = rail.getBoundingClientRect();
    const y = r.top + (idx + 0.5) * (r.height / LETTERS.length);
    const bs = bub.offsetWidth || 84;
    bub.style.top = `${Math.max(r.top, Math.min(r.bottom - bs, y - bs / 2))}px`;
    bub.style.left = `${r.left - bs - 14}px`;
    bub.classList.add('on');
    clearTimeout((bub as HTMLElement & { _t?: number })._t);
    (bub as HTMLElement & { _t?: number })._t = window.setTimeout(() => bub.classList.remove('on'), 700);

    if (st.order !== 'az') { st.order = 'az'; pushUrl(); await loadFirst(); say('Ordered A to Z so you can jump by letter.'); }
    // how many titles come before this letter tells us how far down the list it is
    if (L !== '#') {
      const before = await backend.items({ ...mixQuery(), nameLessThan: L, start: 0, limit: 0 }, ctx.signal).catch(() => null);
      // keep loading until the letter is in the list with enough below it to scroll it to the top
      while (before && items.length < before.total + 40 && hasMore()) await loadMore(false, before.total + pageSize);
    }
    const marks = Array.from(res.querySelectorAll<HTMLElement>('.lettr'));
    const order = (c: string): number => LETTERS.indexOf(c);
    const target = marks.find(m => order(m.dataset.letter ?? '') >= idx) ?? marks[marks.length - 1];
    target?.scrollIntoView({ block: 'start', behavior: RM() || !fromKey ? 'auto' : 'smooth' });
  }

  /* ── NutBot ── */
  async function refreshBot(): Promise<void> {
    const mix = botSlot.mix[kind];
    const sel: Record<string, Set<string>> = {};
    for (const p of mix) { const [g, k] = p.split(':') as [string, string]; (sel[g] ??= new Set()).add(k); }
    const [n, newest, resume] = await Promise.all([
      backend.items({ ...toQuery(kind, { sel, order: st.order, view: st.view }, groups), start: 0, limit: 0 }, ctx.signal).then(r => r.total).catch(() => 0),
      backend.latest({ kind: kind === 'movies' ? 'movie' : 'series', limit: 1 }).then(r => r[0]).catch(() => undefined),
      backend.resume(6).then(r => r.find(i => kind === 'movies' ? i.kind === 'movie' : i.kind === 'episode')).catch(() => undefined),
    ]);
    const when = (() => {
      const d = parseDate(newest?.added);
      if (!d) return '';
      const days = Math.round((Date.now() - d.getTime()) / 864e5);
      return days <= 0 ? 'today' : days === 1 ? 'yesterday' : relativeTime(d).toLowerCase();
    })();
    botCtx = {
      name: ctx.user?.name ?? 'there', n,
      ...(newest ? { newest: { t: newest.name, when } } : {}),
      ...(resume?.progress ? (() => {
        const left = resume.progress.remainingMin;
        return { resume: { t: resume.kind === 'episode' ? resume.seriesName : resume.name, pct: Math.round(resume.progress.percent), left: runtime(left), by: clock(new Date(Date.now() + left * 60_000)) } };
      })() : {}),
    };
    paintBot(true);
  }

  function paintBot(animate = false): void {
    const lines = botSlot.lines[kind];
    const line = lines[botLine % lines.length];
    if (!line) return;
    const say = q('#say');
    const swap = animate && !RM();
    say.innerHTML = html`<small>Right now · ${botSlot.label}</small><span class="ln${swap ? ' swap' : ''}">${line(botCtx)}</span>`.value;
    const names = botSlot.mix[kind].map(p => { const [g, k] = p.split(':') as [string, string]; return groups.find(x => x.id === g)?.keys.find(x => x.k === k)?.t; }).filter(Boolean) as string[];
    const tm = q('#tryMix');
    tm.innerHTML = html`${ic('sliders')}Try: ${names.join(' + ')} <small>${botCtx.n}</small>`.value;
    tm.setAttribute('aria-label', `Try this mix: ${names.join(' and ')}, ${botCtx.n} results`);
  }

  /* ── events ── */
  function changed(opts: { focus?: string } = {}): void {
    pushUrl();
    void loadFirst().then(() => { if (opts.focus) root.querySelector<HTMLElement>(opts.focus)?.focus(); });
  }

  function toggleKey(gid: string, k: string, force?: boolean): void {
    const g = groups.find(x => x.id === gid);
    const cur = st.sel[gid] ?? (st.sel[gid] = new Set());
    const want = force ?? !cur.has(k);
    if (g?.one) cur.clear();
    if (want) cur.add(k); else cur.delete(k);
    if (!cur.size) delete st.sel[gid];
    changed();
  }

  function handleClick(e: Event): void {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const key = t.closest<HTMLElement>('.key');
    if (key) { toggleKey(key.dataset.g ?? '', key.dataset.k ?? ''); return; }
    const drop = t.closest<HTMLElement>('[data-drop]');
    if (drop) {
      const [g, k] = (drop.dataset.drop ?? '').split(':') as [string, string];
      const fromChips = !!drop.closest('#on');
      toggleKey(g, k, false);
      if (fromChips) setTimeout(() => (q('#on').querySelector<HTMLElement>('button') ?? q('#foldBtn')).focus(), 0);
      return;
    }
    if (t.closest('[data-clear]')) {
      const prev = st.sel;
      st.sel = {};
      changed({ focus: '#foldBtn' });
      ctx.shell.toast('All switches off.', 'check');
      void prev;
      return;
    }
    if (t.closest('[data-retry]')) { void loadFirst(); return; }
    const o = t.closest<HTMLElement>('[data-order]');
    if (o) { st.order = o.dataset.order as OrderId; if (st.order === 'left' || st.order !== 'az') railIdx = 1; changed({ focus: `[data-order="${st.order}"]` }); return; }
    const v = t.closest<HTMLElement>('[data-view]');
    if (v) { setView(v.dataset.view as ViewId); return; }
  }

  function setView(view: ViewId): void {
    const wasAll = wantsAll();
    st.view = view;
    pushUrl();
    // moving between "page at a time" and "everything" views needs a fresh load; the rest only repaint
    if (isShelves() || wasAll !== wantsAll() || items.length === 0) void loadFirst().then(() => root.querySelector<HTMLElement>(`[data-view="${view}"]`)?.focus());
    else { paintAll(); root.querySelector<HTMLElement>(`[data-view="${view}"]`)?.focus(); }
  }

  root.addEventListener('click', handleClick);

  q('#tryMix').addEventListener('click', () => {
    const prev = st.sel;
    st.sel = {};
    for (const p of botSlot.mix[kind]) { const [g, k] = p.split(':') as [string, string]; (st.sel[g] ??= new Set()).add(k); }
    changed();
    ctx.shell.toast(`Mix set for ${botSlot.label.toLowerCase()}.`, 'check');
    void prev;
  });

  q('#surprise').addEventListener('click', () => {
    void openSurprise({
      backend, kind, query: mixQuery(), href: p => router.href(p), signal: ctx.signal,
      toast: m => ctx.shell.toast(m, 'info'), announce: say,
    });
  });

  q('#foldBtn').addEventListener('click', () => {
    desk.hidden = !desk.hidden;
    store.set('libDesk', !desk.hidden);
    q('#foldBtn').setAttribute('aria-expanded', String(!desk.hidden));
    q('#foldBtn').setAttribute('title', desk.hidden ? 'Show the mixing desk' : 'Hide the mixing desk');
  });

  /* phone: the desk lives in a sheet */
  q('#filterBtn').addEventListener('click', openSheet);
  function openSheet(): void {
    const body = html`<div class="sheethead"><h2 id="sheetT">Mix your list</h2><button class="btn sm ghost" type="button" data-clear>Clear</button><button class="iconbtn" type="button" data-close aria-label="Close">${ic('x')}</button></div>
      <div class="sheetbody">
        <div class="sgrp"><h3>LOOK</h3><div class="seg" role="group" aria-label="View">${VIEWS[kind].map(([k, t, i]) => html`<button type="button" data-view="${k}" aria-pressed="false">${ic(i)}${t.split(' ')[0]}</button>`)}</div></div>
        <div class="sgrp"><h3>ORDER</h3><div class="seg" role="group" aria-label="Order">${ORDERS[kind].map(([k, t]) => html`<button type="button" data-order="${k}" aria-pressed="false">${t}</button>`)}</div></div>
        <div class="desk"></div>
      </div>
      <div class="sheetfoot"><button class="btn primary" type="button" data-close id="sheetGo" data-autofocus></button></div>`;
    const dlg = openDialog(body, { label: 'Mix your list', scrimClass: 'lib-sheet', noClose: true });
    dlg.el.addEventListener('click', handleClick);
    paintChrome();
  }
  function syncSheet(r: HTMLElement): void {
    const go = r.parentElement?.querySelector<HTMLElement>('#sheetGo');
    if (go) go.textContent = isShelves() ? `Show ${plural(total, 'set')}` : `Show ${plural(total, unit)}`;
    r.querySelectorAll<HTMLElement>('[data-order]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.order === st.order)));
    r.querySelectorAll<HTMLElement>('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === st.view)));
  }

  /* A to Z pointer + keyboard */
  const rail = q('#azrail');
  let drag = false;
  const idxAt = (y: number): number => { const r = rail.getBoundingClientRect(); return Math.floor(((y - r.top) / r.height) * LETTERS.length); };
  rail.addEventListener('pointerdown', e => { drag = true; rail.setPointerCapture(e.pointerId); void railJump(idxAt(e.clientY), false); e.preventDefault(); });
  rail.addEventListener('pointermove', e => { if (drag) void railJump(idxAt(e.clientY), false); });
  rail.addEventListener('pointerup', () => { drag = false; });
  rail.addEventListener('pointercancel', () => { drag = false; });
  rail.addEventListener('keydown', e => {
    const step = ({ ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, PageDown: 5, PageUp: -5 } as Record<string, number>)[e.key];
    if (step) { e.preventDefault(); void railJump(railIdx + step, true); }
    else if (e.key === 'Home') { e.preventDefault(); void railJump(0, true); }
    else if (e.key === 'End') { e.preventDefault(); void railJump(LETTERS.length - 1, true); }
    else if (/^[a-z#]$/i.test(e.key)) { e.preventDefault(); void railJump(LETTERS.indexOf(e.key.toUpperCase()), true); }
  });

  /* infinite scroll + the button */
  q('#moreBtn').addEventListener('click', () => { void loadMore(true); });
  let io: IntersectionObserver | null = null;
  function observeSentinel(): void {
    io?.disconnect();
    if (typeof IntersectionObserver === 'undefined' || !hasMore()) return;
    io = new IntersectionObserver(entries => { if (entries.some(en => en.isIntersecting)) void loadMore(false); }, { rootMargin: '700px 0px' });
    io.observe(q('#more'));
  }
  // paintMore() is called after each page: re-arm so a still-visible bar loads the next page too
  const rearm = new MutationObserver(() => observeSentinel());
  rearm.observe(res, { childList: true });

  function feedBackground(): void {
    ctx.shell.setWallImages(items.slice(0, 24).filter(t => t.imageTags.primary).map(t => imageUrl(t.id, 'Primary', { maxWidth: 240, tag: t.imageTags.primary })));
  }

  ctx.onDispose(() => {
    io?.disconnect();
    rearm.disconnect();
    loadAbort?.abort();
    closeAllDialogs();
    ctx.shell.setWallImages([]);
  });

  /* ── boot ── */
  desk.hidden = !(store.get('libDesk', false) || activeKeys(st.sel, groups).length > 0);
  q('#foldBtn').setAttribute('title', desk.hidden ? 'Show the mixing desk' : 'Hide the mixing desk');
  paintChrome();

  // side data that does not block the first paint
  void backend.genres(kind === 'movies' ? 'movie' : 'series', ctx.signal).then(g => {
    genres = g;
    if (g.length) { groups = groupsFor(kind, g); paintChrome(); }
  }).catch(() => { /* the Genre switches just stay away */ });
  const cnt = async (extra: ItemsQuery): Promise<number | undefined> => (await backend.items({ start: 0, limit: 0, ...extra }, ctx.signal).catch(() => null))?.total;
  void Promise.all([cnt({ kind: 'movie' }), cnt({ kind: 'series' }), cnt({ kind: 'movie', is4k: true }), cnt({ kind: 'movie', played: false })]).then(([movies, shows, fourK, unseen]) => {
    counts = { movies, shows, fourK, unseen };
    paintChrome();
  });
  void refreshBot();
  const rotate = window.setInterval(() => {
    if (root.querySelector('.bot:hover, .bot:focus-within')) return;
    botLine++;
    paintBot(true);
  }, 9000);
  ctx.onDispose(() => clearInterval(rotate));

  await loadFirst();
  return root;
}
