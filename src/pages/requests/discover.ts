/**
 * The "Discover" tab, like Seerr's own front page: a search box and "Browse all", then sideways rails (Trending,
 * Popular films, Film genres, Upcoming films, Studios, Popular shows, Show genres, Upcoming shows, Networks).
 * Genre, studio and network tiles open the Browse view (browse.ts) with that filter on; so do "Browse all" and "See all".
 * Every poster opens the details sheet first; requesting is a second step inside it.
 * Rails load as they come near the screen, scroll with arrow buttons, the keyboard (Left/Right between posters) and swipe.
 */
import type { DiscoverRail, GenreTile } from '../../api/desk-types';
import type { SeerrResult } from '../../api/types';
import { html, raw } from '../../lib/html';
import { icon } from '../../ui/icons';
import { nutbot } from '../../ui/nutbot';
import { ic } from '../common/icons';
import type { PageContext } from '../types';
import { mountBrowse, type BrowsePanel } from './browse';
import { emptyBrowse, NETWORKS, parseBrowse, serialiseBrowse, STUDIOS, type BrowseState } from './browse-model';
import { brandTile, genreTile, posterTile, skeletonGrid, skeletonRail } from './ui';

type RailDef = { id: string; title: string; kind: 'items'; rail: DiscoverRail; all?: 'movie' | 'tv' }
  | { id: string; title: string; kind: 'genres'; mediaType: 'movie' | 'tv' }
  | { id: string; title: string; kind: 'brands'; mediaType: 'movie' | 'tv' };
const RAILS: readonly RailDef[] = [
  { id: 'trending', title: 'Trending', kind: 'items', rail: 'trending' },
  { id: 'movies', title: 'Popular films', kind: 'items', rail: 'movies', all: 'movie' },
  { id: 'mgenres', title: 'Film genres', kind: 'genres', mediaType: 'movie' },
  { id: 'mup', title: 'Upcoming films', kind: 'items', rail: 'movies-upcoming' },
  { id: 'studios', title: 'Studios', kind: 'brands', mediaType: 'movie' },
  { id: 'tv', title: 'Popular shows', kind: 'items', rail: 'tv', all: 'tv' },
  { id: 'tgenres', title: 'Show genres', kind: 'genres', mediaType: 'tv' },
  { id: 'tup', title: 'Upcoming shows', kind: 'items', rail: 'tv-upcoming' },
  { id: 'networks', title: 'Networks', kind: 'brands', mediaType: 'tv' },
];

/** Set when the Browse view was opened from Discover's front page in this visit, so its Back button can just go back. */
let cameFromHome = false;

export interface DiscoverEnv {
  ctx: PageContext;
  open(t: { tmdbId: number; mediaType: 'movie' | 'tv'; title?: string }): void;
  setQuery(q: Record<string, string | null>): void;
}
export interface DiscoverPanel { refresh(): void; dispose(): void }

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountDiscover(el: HTMLElement, env: DiscoverEnv): DiscoverPanel {
  const browsing = parseBrowse(env.ctx.query);
  if (browsing) {
    const panel: BrowsePanel = mountBrowse(el, {
      ctx: env.ctx, state: browsing, open: env.open,
      back: () => { if (cameFromHome) { cameFromHome = false; history.back(); } else env.ctx.router.navigate('/requests/discover', { replace: true }); },
    });
    return panel;
  }
  return mountHome(el, env);
}

/** Open the Browse view (a real history entry, so Back returns to the front page where it was). */
function browse(env: DiscoverEnv, s: BrowseState): void {
  cameFromHome = true;
  env.ctx.router.navigate(`/requests/discover?${serialiseBrowse(s)}`);
}

function mountHome(el: HTMLElement, env: DiscoverEnv): DiscoverPanel {
  const { ctx } = env;
  const seerr = ctx.backend.seerr;
  const q0 = ctx.query;
  const st = {
    query: (q0.get('q') ?? '').slice(0, 80),
    kind: 'all' as 'all' | 'movie' | 'tv',
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
    <div class="rq-browseall"><button type="button" class="btn sm" data-browse="movie">${ic('sliders')}Browse all films</button><button type="button" class="btn sm" data-browse="tv">${ic('sliders')}Browse all shows</button></div>
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
        <div class="rq-arrows">${r.kind === 'items' && r.all ? html`<button type="button" class="btn sm ghost rq-seeall" data-browse="${r.all}" aria-label="See all ${r.all === 'tv' ? 'shows' : 'films'}">See all</button>` : ''}<button type="button" class="iconbtn rq-arrow" data-scroll="-1" aria-label="Scroll ${r.title} back" disabled>${icon('back')}</button>
        <button type="button" class="iconbtn rq-arrow" data-scroll="1" aria-label="Scroll ${r.title} on">${icon('next')}</button></div></div>
      <div class="rq-railbox">${raw(r.kind === 'items' ? skeletonRail(8) : skeletonRail(5).replace('rq-rail sk', `rq-rail sk ${r.kind}`))}</div>
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
      } else if (def.kind === 'genres') {
        const list: GenreTile[] = await seerr.genres(def.mediaType, ctx.signal);
        markup = list.map((g, i) => genreTile(g, def.mediaType, i).value).join('');
      } else {
        markup = (def.mediaType === 'tv' ? NETWORKS : STUDIOS).map((b, i) => brandTile(b, def.mediaType, i).value).join('');
      }
      if (!alive) return;
      if (!markup) { sec.hidden = true; return; } // e.g. no show genres on this Seerr
      box.innerHTML = `<ul class="rq-rail ${def.kind === 'items' ? '' : def.kind}" aria-label="${def.title}">${markup}</ul>`;
      const rail = box.firstElementChild as HTMLElement;
      // a logo that does not load: show the name instead
      if (def.kind === 'brands') rail.addEventListener('error', e => { (e.target as Element).closest('.rq-brand')?.classList.add('noimg'); }, true);
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

  /* ── search (same behaviour as before: debounced, Films/Shows filter) ── */
  async function runSearch(): Promise<void> {
    const my = ++token;
    const text = input.value.trim();
    st.query = text;
    env.setQuery({ q: text || null });
    if (text.length < 2) { home(); return; }
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
    if (g) { browse(env, { ...emptyBrowse(g.dataset.gtype === 'tv' ? 'tv' : 'movie'), genres: [Number(g.dataset.genre)] }); return; }
    const b = t.closest<HTMLElement>('[data-brand]');
    if (b) {
      const id = Number(b.dataset.brand);
      browse(env, b.dataset.btype === 'tv' ? { ...emptyBrowse('tv'), network: id } : { ...emptyBrowse('movie'), studio: id });
      return;
    }
    const all = t.closest<HTMLElement>('[data-browse]');
    if (all) { browse(env, emptyBrowse(all.dataset.browse === 'tv' ? 'tv' : 'movie')); return; }
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
      else showRails();
    },
    dispose(): void { alive = false; io?.disconnect(); window.clearTimeout(timer); },
  };
}
