/**
 * The "Discover" tab, like Seerr's own front page: a search box, then sideways rails (Trending, Popular films,
 * Film genres, Upcoming films, Popular shows, Show genres, Upcoming shows). A genre tile opens that genre's results.
 * Every poster opens the details sheet first; requesting is a second step inside it.
 * Rails load as they come near the screen, scroll with arrow buttons, the keyboard (Left/Right between posters) and swipe.
 */
import type { DiscoverItem, DiscoverRail, GenreTile } from '../../api/desk-types';
import type { SeerrResult } from '../../api/types';
import { html, raw } from '../../lib/html';
import { icon } from '../../ui/icons';
import { nutbot } from '../../ui/nutbot';
import type { PageContext } from '../types';
import { genreTile, posterTile, skeletonGrid, skeletonRail } from './ui';

type RailDef = { id: string; title: string; kind: 'items'; rail: DiscoverRail } | { id: string; title: string; kind: 'genres'; mediaType: 'movie' | 'tv' };
const RAILS: readonly RailDef[] = [
  { id: 'trending', title: 'Trending', kind: 'items', rail: 'trending' },
  { id: 'movies', title: 'Popular films', kind: 'items', rail: 'movies' },
  { id: 'mgenres', title: 'Film genres', kind: 'genres', mediaType: 'movie' },
  { id: 'mup', title: 'Upcoming films', kind: 'items', rail: 'movies-upcoming' },
  { id: 'tv', title: 'Popular shows', kind: 'items', rail: 'tv' },
  { id: 'tgenres', title: 'Show genres', kind: 'genres', mediaType: 'tv' },
  { id: 'tup', title: 'Upcoming shows', kind: 'items', rail: 'tv-upcoming' },
];

export interface DiscoverEnv {
  ctx: PageContext;
  open(t: { tmdbId: number; mediaType: 'movie' | 'tv'; title?: string }): void;
  setQuery(q: Record<string, string | null>): void;
}
export interface DiscoverPanel { refresh(): void; dispose(): void }

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountDiscover(el: HTMLElement, env: DiscoverEnv): DiscoverPanel {
  const { ctx } = env;
  const seerr = ctx.backend.seerr;
  const q0 = ctx.query;
  const st = {
    query: (q0.get('q') ?? '').slice(0, 80),
    kind: 'all' as 'all' | 'movie' | 'tv',
    genre: q0.get('genre') ? { id: Number(q0.get('genre')), mediaType: (q0.get('gtype') === 'tv' ? 'tv' : 'movie') as 'movie' | 'tv', name: q0.get('gname') ?? 'Genre', page: 1, totalPages: 1, items: [] as DiscoverItem[] } : null,
    results: [] as SeerrResult[],
  };
  let alive = true;
  let token = 0;
  let timer = 0;

  el.innerHTML = html`
    <form class="rq-form" role="search" autocomplete="off">
      <label class="sr" for="rqq">Search films and shows to request</label>${icon('search')}
      <input id="rqq" type="search" maxlength="80" placeholder="Search films and shows" value="${st.query}">
      <button class="btn primary sm" type="submit">${icon('search')}<span class="lbl">Search</span></button>
    </form>
    <div id="rqview"></div>`.value;
  const view = el.querySelector<HTMLElement>('#rqview') as HTMLElement;
  const input = el.querySelector<HTMLInputElement>('#rqq') as HTMLInputElement;
  const quiet = (text: string): string => `<p class="rq-quiet">${nutbot(34, 'look').value}<span>${text.replace(/[<>&]/g, '')}</span></p>`;
  const grid = (list: readonly SeerrResult[]): string => `<ul class="rq-grid">${list.map((r, i) => posterTile(r, i).value).join('')}</ul>`;

  /* ── rails ── */
  let io: IntersectionObserver | null = null;
  function showRails(): void {
    view.innerHTML = RAILS.map(r => html`<section class="rq-railsec" data-rail="${r.id}" aria-labelledby="rqr-${r.id}">
      <div class="rq-railhead"><h2 class="rq-gh" id="rqr-${r.id}">${r.title}</h2>
        <div class="rq-arrows"><button type="button" class="iconbtn rq-arrow" data-scroll="-1" aria-label="Scroll ${r.title} back" disabled>${icon('back')}</button>
        <button type="button" class="iconbtn rq-arrow" data-scroll="1" aria-label="Scroll ${r.title} on">${icon('next')}</button></div></div>
      <div class="rq-railbox">${raw(skeletonRail(r.kind === 'genres' ? 5 : 8))}</div>
    </section>`.value).join('');
    io?.disconnect();
    io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { io?.unobserve(e.target); void fillRail(e.target as HTMLElement); }
    }, { rootMargin: '400px 0px' });
    view.querySelectorAll<HTMLElement>('[data-rail]').forEach(s => io?.observe(s));
  }

  async function fillRail(sec: HTMLElement): Promise<void> {
    const def = RAILS.find(r => r.id === sec.dataset.rail);
    const box = sec.querySelector<HTMLElement>('.rq-railbox');
    if (!def || !box) return;
    try {
      let markup = '';
      if (def.kind === 'items') {
        const page = await seerr.discoverRail(def.rail, 1, ctx.signal);
        markup = page.items.length ? page.items.map((r, i) => posterTile(r, i).value).join('') : '';
      } else {
        const list: GenreTile[] = await seerr.genres(def.mediaType, ctx.signal);
        markup = list.map((g, i) => genreTile(g, def.mediaType, i).value).join('');
      }
      if (!alive) return;
      if (!markup) { sec.hidden = true; return; } // e.g. no show genres on this Seerr
      box.innerHTML = `<ul class="rq-rail ${def.kind === 'genres' ? 'genres' : ''}" aria-label="${def.title}">${markup}</ul>`;
      const rail = box.firstElementChild as HTMLElement;
      const sync = (): void => {
        const [back, on] = Array.from(sec.querySelectorAll<HTMLButtonElement>('[data-scroll]'));
        if (back) back.disabled = rail.scrollLeft <= 4;
        if (on) on.disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4;
      };
      rail.addEventListener('scroll', sync, { passive: true });
      sync();
    } catch {
      if (alive && !ctx.signal.aborted) box.innerHTML = quiet('This row did not load. Try again later.');
    }
  }

  /* ── genre view ── */
  async function showGenre(more = false): Promise<void> {
    const g = st.genre;
    if (!g) return;
    const my = ++token;
    if (!more) {
      view.innerHTML = html`<div class="rq-genrehead"><button type="button" class="btn sm" id="rqgback">${icon('back')}Back to Discover</button>
        <h2 class="rq-gh" id="rqgh" tabindex="-1">${g.name} ${g.mediaType === 'tv' ? 'shows' : 'films'}</h2></div><div id="rqgres">${skeletonGrid(12)}</div>`.value;
    }
    const page = await seerr.discoverGenre(g.mediaType, g.id, more ? g.page + 1 : 1, ctx.signal).catch(() => null);
    if (!alive || my !== token || st.genre !== g) return;
    const box = view.querySelector<HTMLElement>('#rqgres') as HTMLElement;
    if (!page) { box.innerHTML = quiet('That did not load. Try again in a moment.'); return; }
    const before = g.items.length;
    g.items = more ? [...g.items, ...page.items.filter(x => !g.items.some(y => y.tmdbId === x.tmdbId))] : page.items;
    g.page = page.page;
    g.totalPages = page.totalPages;
    box.innerHTML = g.items.length ? `${grid(g.items)}${g.page < g.totalPages ? '<div class="rq-moregrid"><button type="button" class="btn sm" id="rqgmore">Show more</button></div>' : ''}` : quiet('Nothing in this genre right now.');
    if (more) box.querySelectorAll<HTMLElement>('.rq-open')[before]?.focus();
    else view.querySelector<HTMLElement>('#rqgh')?.focus({ preventScroll: true });
  }

  /* ── search (same behaviour as before: debounced, Films/Shows filter) ── */
  async function runSearch(): Promise<void> {
    const my = ++token;
    const text = input.value.trim();
    st.query = text;
    env.setQuery({ q: text || null });
    if (text.length < 2) { home(); return; }
    st.genre = null;
    let res = view.querySelector<HTMLElement>('#rqsres');
    if (!res) {
      view.innerHTML = html`<div class="rq-searchhead"><div class="rq-kinds" role="group" aria-label="What to show">
        <button type="button" class="rq-fchip" data-kind="all" aria-pressed="${st.kind === 'all'}">Films and shows</button>
        <button type="button" class="rq-fchip" data-kind="movie" aria-pressed="${st.kind === 'movie'}">Films</button>
        <button type="button" class="rq-fchip" data-kind="tv" aria-pressed="${st.kind === 'tv'}">Shows</button></div>
        <button type="button" class="btn sm ghost" id="rqclear">${icon('x')}Clear search</button></div>
        <p class="rq-sub" id="rqscount" aria-live="polite"></p><div id="rqsres"></div>`.value;
      res = view.querySelector<HTMLElement>('#rqsres') as HTMLElement;
    }
    res.innerHTML = skeletonGrid(6);
    try {
      const list = (await seerr.search(text, ctx.signal)).filter(r => st.kind === 'all' || r.mediaType === st.kind);
      if (my !== token || !alive) return;
      st.results = list;
      const safe = text.replace(/[<>&"]/g, '');
      (view.querySelector('#rqscount') as HTMLElement).textContent = list.length ? `${list.length} result${list.length === 1 ? '' : 's'} for "${safe}"` : '';
      res.innerHTML = list.length ? grid(list) : quiet(`Nothing found for "${safe}". Check the spelling, or try a shorter name.`);
    } catch {
      if (my !== token || ctx.signal.aborted) return;
      res.innerHTML = quiet('The search did not work just now. Try again in a moment.');
    }
  }

  function home(): void {
    ++token;
    if (st.genre) { void showGenre(); return; }
    if (!view.querySelector('[data-rail]')) showRails();
  }

  /* ── events ── */
  el.addEventListener('submit', e => { e.preventDefault(); window.clearTimeout(timer); void runSearch(); });
  input.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void runSearch(); }, 320); });
  el.addEventListener('click', e => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const open = t.closest<HTMLElement>('[data-open]');
    if (open) { env.open({ tmdbId: Number(open.dataset.open), mediaType: open.dataset.type === 'tv' ? 'tv' : 'movie', title: open.dataset.title || undefined }); return; }
    const g = t.closest<HTMLElement>('[data-genre]');
    if (g) {
      st.genre = { id: Number(g.dataset.genre), mediaType: g.dataset.gtype === 'tv' ? 'tv' : 'movie', name: g.dataset.gname ?? 'Genre', page: 1, totalPages: 1, items: [] };
      env.setQuery({ genre: String(st.genre.id), gtype: st.genre.mediaType, gname: st.genre.name });
      lastGenreTile = `[data-genre="${st.genre.id}"][data-gtype="${st.genre.mediaType}"]`;
      void showGenre();
      return;
    }
    if (t.closest('#rqgback')) {
      st.genre = null;
      env.setQuery({ genre: null, gtype: null, gname: null });
      showRails();
      // back to the tile that was opened, once its rail has loaded
      const sel = lastGenreTile;
      const sec = view.querySelector<HTMLElement>(`[data-rail="${sel.includes('"tv"') ? 'tgenres' : 'mgenres'}"]`);
      sec?.scrollIntoView({ block: 'center' });
      const tryFocus = (n: number): void => { const b = view.querySelector<HTMLElement>(sel); if (b) b.focus(); else if (n > 0 && alive) setTimeout(() => tryFocus(n - 1), 150); };
      tryFocus(20);
      return;
    }
    if (t.closest('#rqgmore')) { void showGenre(true); return; }
    if (t.closest('#rqclear')) { input.value = ''; void runSearch(); input.focus(); return; }
    const kind = t.closest<HTMLElement>('[data-kind]');
    if (kind) {
      st.kind = kind.dataset.kind as 'all' | 'movie' | 'tv';
      view.querySelectorAll<HTMLElement>('[data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === st.kind)));
      void runSearch();
      return;
    }
    const arrow = t.closest<HTMLButtonElement>('[data-scroll]');
    if (arrow) {
      const rail = arrow.closest('section')?.querySelector<HTMLElement>('.rq-rail:not(.sk)');
      if (rail) rail.scrollBy({ left: Number(arrow.dataset.scroll) * Math.max(200, rail.clientWidth * 0.85), behavior: reduced() ? 'auto' : 'smooth' });
    }
  });
  let lastGenreTile = '';
  // Left / Right between posters in a rail (Tab still walks through them all)
  el.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const cur = (e.target as Element).closest?.('.rq-rail > li');
    if (!cur) return;
    const next = (e.key === 'ArrowRight' ? cur.nextElementSibling : cur.previousElementSibling)?.querySelector<HTMLElement>('button');
    if (next) { e.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); }
  });

  if (st.query.length >= 2) void runSearch(); else home();

  return {
    refresh(): void {
      // statuses may have changed after a request: reload what is on screen
      if (st.query.length >= 2) void runSearch();
      else if (st.genre) void showGenre();
      else showRails();
    },
    dispose(): void { alive = false; io?.disconnect(); window.clearTimeout(timer); },
  };
}
