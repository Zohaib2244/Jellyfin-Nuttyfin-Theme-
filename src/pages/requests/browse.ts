/**
 * Discover's Browse view: one type at a time (Films · Shows), genre chips, sort, a year range, "hide what is already in
 * the library", and a network or studio when it was opened from a logo tile. Everything lives in the URL
 * (browse-model.ts), so Back and a shared link land on the same list.
 * Desktop: a sticky filter bar. Phones: Type + a "Filters" button that opens the same controls in a bottom sheet.
 * Results come in Seerr pages of 20, loaded as the end of the grid nears the screen or with "Show more".
 */
import type { DiscoverItem, GenreName } from '../../api/desk-types';
import { html, raw, type SafeHtml } from '../../lib/html';
import { icon } from '../../ui/icons';
import { nutbot } from '../../ui/nutbot';
import { openDialog, type DialogHandle } from '../common/dialog';
import { ic } from '../common/icons';
import type { PageContext } from '../types';
import { activeFilters, browseTitle, clearFilters, SORTS, serialiseBrowse, switchType, type BrowseState } from './browse-model';
import { posterTile, skeletonGrid } from './ui';

export interface BrowseEnv {
  ctx: PageContext;
  state: BrowseState;
  open(t: { tmdbId: number; mediaType: 'movie' | 'tv'; title?: string }): void;
  /** leave the Browse view (back to Discover's front page) */
  back(): void;
}
export interface BrowsePanel { refresh(): void; dispose(): void }

/** Genre names per type, kept for the visit (they never change). */
const genreCache = new Map<'movie' | 'tv', GenreName[]>();
/** Pages loaded without a click before "Show more" takes over (keeps the page from growing forever). */
const AUTO_PAGES = 6;
const URL_KEYS = ['type', 'genre', 'sort', 'from', 'to', 'network', 'studio', 'hide', 'q', 'gtype', 'gname'] as const;

export function mountBrowse(el: HTMLElement, env: BrowseEnv): BrowsePanel {
  const { ctx } = env;
  const seerr = ctx.backend.seerr;
  let st = env.state;
  let genres: GenreName[] = genreCache.get(st.mediaType) ?? [];
  let names = new Map<number, string>(genres.map(g => [g.id, g.name]));
  const res = { items: [] as DiscoverItem[], page: 0, totalPages: 1, total: undefined as number | undefined, loading: false, failed: false, auto: 0 };
  let alive = true;
  let token = 0;
  let sheet: DialogHandle | null = null;
  const thisYear = new Date().getFullYear();

  el.innerHTML = html`<div class="rq-browse">
    <div class="rq-bhead">
      <button type="button" class="btn sm" id="rqbback">${icon('back')}Discover</button>
      <div class="rq-bt"><h2 class="rq-btitle" id="rqbh" tabindex="-1"></h2><p class="rq-bcount" id="rqbcount" aria-live="polite"></p></div>
    </div>
    <div class="rq-bbar" id="rqbbar" role="region" aria-label="Filters"></div>
    <div class="rq-bactive" id="rqbactive"></div>
    <div id="rqbres" aria-live="polite"></div>
    <div class="rq-moregrid" id="rqbmorebox"></div>
    <div class="rq-bsentinel" id="rqbsent" aria-hidden="true"></div>
  </div>`.value;
  const bar = el.querySelector<HTMLElement>('#rqbbar') as HTMLElement;
  const resEl = el.querySelector<HTMLElement>('#rqbres') as HTMLElement;
  const moreBox = el.querySelector<HTMLElement>('#rqbmorebox') as HTMLElement;

  // the bar sticks just under the shell's top bar, whatever height that has at this width
  const stick = (): void => { el.style.setProperty('--rq-stick', `${Math.round(document.querySelector('.top')?.getBoundingClientRect().height ?? 0)}px`); };
  stick();
  window.addEventListener('resize', stick, { passive: true });

  /* ── controls (the same builder fills the desktop bar and the phone sheet) ── */
  const typeSeg = (): SafeHtml => html`<div class="rq-seg" role="radiogroup" aria-label="Show">
    ${(['movie', 'tv'] as const).map(t => html`<button type="button" role="radio" data-f="type" data-type="${t}" aria-checked="${st.mediaType === t}" tabindex="${st.mediaType === t ? 0 : -1}">${ic(t === 'tv' ? 'tv' : 'film')}${t === 'tv' ? 'Shows' : 'Films'}</button>`)}
  </div>`;

  const sortSel = (id: string): SafeHtml => html`<label class="rq-bfield" for="${id}"><span class="lbl">Sort by</span>
    <select id="${id}" data-f="sort">${SORTS.map(s => html`<option value="${s.id}" ${s.id === st.sort ? raw('selected') : ''}>${s.label}</option>`)}</select></label>`;

  const years = (p: string): SafeHtml => html`<fieldset class="rq-years"><legend class="lbl">Released</legend>
    <label class="sr" for="${p}from">From year</label><input id="${p}from" type="number" inputmode="numeric" data-f="from" min="1900" max="${thisYear + 5}" placeholder="From" value="${st.fromYear ?? ''}">
    <span aria-hidden="true">to</span>
    <label class="sr" for="${p}to">To year</label><input id="${p}to" type="number" inputmode="numeric" data-f="to" min="1900" max="${thisYear + 5}" placeholder="To" value="${st.toYear ?? ''}">
  </fieldset>`;

  const hideBox = (id: string): SafeHtml => html`<label class="rq-bhide" for="${id}"><input id="${id}" type="checkbox" data-f="hide" ${st.hide ? raw('checked') : ''}><span>Hide what is in the library</span></label>`;

  const genreChips = (): SafeHtml => genres.length
    ? html`<div class="rq-bgenres" role="group" aria-label="Genres (pick one or more)">${genres.map(g => html`<button type="button" class="rq-gchip" data-f="genre" data-id="${g.id}" aria-pressed="${st.genres.includes(g.id)}">${st.genres.includes(g.id) ? ic('check') : ''}${g.name}</button>`)}</div>`
    : html`<div class="rq-bgenres sk" aria-hidden="true">${raw('<i class="rq-sk chip"></i>'.repeat(8))}</div>`;

  const filterCount = (): number => activeFilters(st, names).length;

  function paintBar(): void {
    const n = filterCount();
    const focused = document.activeElement instanceof HTMLElement && bar.contains(document.activeElement) ? document.activeElement : null;
    const refocus = focused ? (focused.dataset.f === 'genre' ? `[data-f="genre"][data-id="${focused.dataset.id}"]` : focused.dataset.f === 'type' ? '[data-f="type"][aria-checked="true"]' : focused.id ? `#${focused.id}` : '') : '';
    bar.innerHTML = html`<div class="rq-brow">
        ${typeSeg()}
        <div class="rq-bwide">${sortSel('rqbsort')}${years('rqb')}${hideBox('rqbhide')}</div>
        <button type="button" class="btn sm rq-bfilt" id="rqbfilt" aria-haspopup="dialog">${ic('sliders')}Filters${n ? html`<span class="n">${n}</span>` : ''}</button>
      </div>
      <div class="rq-bwide">${genreChips()}</div>`.value;
    if (refocus) bar.querySelector<HTMLElement>(refocus)?.focus({ preventScroll: true });
  }

  function paintSheet(): void {
    if (!sheet) return;
    const focused = document.activeElement instanceof HTMLElement && sheet.body.contains(document.activeElement) ? document.activeElement : null;
    const refocus = focused?.dataset.f === 'genre' ? `[data-f="genre"][data-id="${focused.dataset.id}"]` : focused?.id ? `#${focused.id}` : '';
    sheet.body.innerHTML = html`<div class="rq-fsheet">
      <h2 class="rq-fsh" tabindex="-1" data-autofocus>Filters</h2>
      ${sortSel('rqfsort')}
      <div class="rq-fblk"><span class="lbl">Genres</span>${genreChips()}</div>
      ${years('rqf')}
      ${hideBox('rqfhide')}
      <div class="acts">${filterCount() ? html`<button type="button" class="btn" data-f="clear">Clear all</button>` : ''}<button type="button" class="btn primary" data-close>Show ${countWords() || 'results'}</button></div>
    </div>`.value;
    if (refocus) sheet.body.querySelector<HTMLElement>(refocus)?.focus({ preventScroll: true });
  }

  function paintHead(): void {
    const title = browseTitle(st, names);
    (el.querySelector('#rqbh') as HTMLElement).textContent = title;
    ctx.shell.setTitle(`${title} · Discover`);
    (el.querySelector('#rqbcount') as HTMLElement).textContent = res.loading && !res.items.length ? '' : countWords();
    const act = activeFilters(st, names);
    (el.querySelector('#rqbactive') as HTMLElement).innerHTML = act.length ? html`<ul class="rq-achips" aria-label="Filters that are on">
      ${act.map(a => html`<li><button type="button" class="rq-achip" data-f="unset" data-key="${a.key}" aria-label="Remove filter: ${a.label}">${a.label}${icon('x')}</button></li>`)}
      </ul><button type="button" class="btn sm ghost" data-f="clear">Clear all</button>`.value : '';
  }

  const shown = (): DiscoverItem[] => (st.hide ? res.items.filter(i => !(i.state === 'available' && !i.partial)) : res.items);
  function countWords(): string {
    const noun = st.mediaType === 'tv' ? 'shows' : 'films';
    if (res.total == null) return '';
    if (res.total === 0) return `No ${noun}`;
    const n = res.total >= 10_000 ? 'Over 10,000' : res.total.toLocaleString('en-GB');
    return `${n} ${res.total === 1 ? noun.slice(0, -1) : noun}${st.hide ? ', minus what is in the library' : ''}`;
  }

  /* ── results ── */
  const quiet = (text: string, extra: SafeHtml | string = ''): string => html`<div class="rq-bquiet">${nutbot(40, 'look')}<p>${text}</p>${extra}</div>`.value;

  function paintResults(focusFrom = -1): void {
    const list = shown();
    if (res.failed && !res.items.length) {
      resEl.innerHTML = quiet('That did not load. Seerr may be busy.', html`<button type="button" class="btn sm" id="rqbretry">${ic('restart')}Try again</button>`);
    } else if (!list.length && !res.loading && res.page >= res.totalPages) {
      resEl.innerHTML = quiet(res.items.length ? 'Everything here is already in the library.' : 'Nothing matches these filters.', filterCount() ? html`<button type="button" class="btn sm" data-f="clear">Clear all filters</button>` : '');
    } else if (!list.length) {
      resEl.innerHTML = skeletonGrid(12);
    } else {
      resEl.innerHTML = `<ul class="rq-grid rq-bgrid">${list.map((r, i) => posterTile(r, i - Math.max(0, focusFrom)).value).join('')}</ul>`;
      if (focusFrom >= 0) resEl.querySelectorAll<HTMLElement>('.rq-open')[focusFrom]?.focus();
    }
    const more = list.length > 0 && res.page < res.totalPages;
    moreBox.innerHTML = more
      ? (res.loading ? '<span class="rq-bload" role="status"><span class="spin" aria-hidden="true"></span>Loading more…</span>' : html`<button type="button" class="btn sm" id="rqbmore">Show more</button>`.value)
      : res.failed && res.items.length ? html`<button type="button" class="btn sm" id="rqbmore">${ic('restart')}Try again</button>`.value : '';
    paintHead();
  }

  async function load(more: boolean, byClick = false): Promise<void> {
    if (res.loading && more) return;
    const my = ++token;
    if (!more) { res.items = []; res.page = 0; res.totalPages = 1; res.total = undefined; res.auto = 0; }
    res.loading = true;
    res.failed = false;
    const before = shown().length;
    paintResults();
    try {
      const page = await seerr.browse(st, res.page + 1, ctx.signal);
      if (!alive || my !== token) return;
      const seen = new Set(res.items.map(i => `${i.mediaType}:${i.tmdbId}`));
      res.items = [...res.items, ...page.items.filter(i => !seen.has(`${i.mediaType}:${i.tmdbId}`))];
      res.page = page.page;
      res.totalPages = Math.min(page.totalPages, 500); // TMDB stops at page 500
      res.total = page.total ?? res.total ?? (page.totalPages <= 1 ? page.items.length : undefined);
      res.loading = false;
      if (!byClick) res.auto++;
      paintResults(byClick ? before : -1);
      // "hide what is in the library" can thin a page out a lot: fetch on so the grid is not half empty
      if (st.hide && shown().length - before < 8 && res.page < res.totalPages && res.auto < AUTO_PAGES) void load(true);
      // the observer only reports changes: if the end of the grid is still on screen, ask it again
      else { io.unobserve(sentinel); io.observe(sentinel); }
    } catch {
      if (!alive || my !== token || ctx.signal.aborted) return;
      res.loading = false;
      res.failed = true;
      paintResults();
    }
  }

  // load the next page as the end of the grid comes near (until AUTO_PAGES; then the button)
  const sentinel = el.querySelector<HTMLElement>('#rqbsent') as HTMLElement;
  const io = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting) && !res.loading && !res.failed && res.page > 0 && res.page < res.totalPages && res.auto < AUTO_PAGES) void load(true);
  }, { rootMargin: '600px 0px' });
  io.observe(sentinel);

  /* ── state changes ── */
  /** `soft`: the change came from a form field (sort, years, hide) that already shows it; re-rendering would steal focus
   *  mid-Tab, so only copy the values into the other surface (bar or sheet) and update the Filters count. */
  function apply(next: BrowseState, soft = false): void {
    const typeChanged = next.mediaType !== st.mediaType;
    st = next;
    const q = new URLSearchParams(serialiseBrowse(st));
    ctx.router.replaceQuery(Object.fromEntries(URL_KEYS.map(k => [k, q.get(k)])));
    // readable commas in the address bar (genre=28,12); both forms parse the same
    if (location.hash.includes('%2C')) history.replaceState(history.state, '', location.hash.replace(/%2C/g, ','));
    if (typeChanged) void loadGenres();
    if (soft) syncFields(); else { paintBar(); paintSheet(); }
    void load(false);
  }

  function syncFields(): void {
    const roots = [bar, sheet?.body].filter((x): x is HTMLElement => !!x);
    for (const r of roots) {
      r.querySelectorAll<HTMLSelectElement>('select[data-f="sort"]').forEach(x => { x.value = st.sort; });
      r.querySelectorAll<HTMLInputElement>('input[data-f="hide"]').forEach(x => { x.checked = st.hide; });
      r.querySelectorAll<HTMLInputElement>('input[data-f="from"], input[data-f="to"]').forEach(x => {
        if (x !== document.activeElement) x.value = String((x.dataset.f === 'from' ? st.fromYear : st.toYear) ?? '');
      });
    }
    const n = filterCount();
    const b = bar.querySelector<HTMLElement>('#rqbfilt');
    if (b) b.innerHTML = `${ic('sliders').value}Filters${n ? `<span class="n">${n}</span>` : ''}`;
  }

  async function loadGenres(): Promise<void> {
    const type = st.mediaType;
    const cached = genreCache.get(type);
    const list = cached ?? await seerr.genreList(type, ctx.signal).catch(() => [] as GenreName[]);
    if (!alive || type !== st.mediaType) return;
    if (list.length) genreCache.set(type, list);
    genres = list;
    names = new Map(list.map(g => [g.id, g.name]));
    paintBar();
    paintSheet();
    paintHead();
  }

  function openSheet(): void {
    sheet = openDialog(html`<div></div>`, { label: 'Filters', className: 'rq-dlg rq-fdlg', onClose: () => { sheet = null; } });
    paintSheet();
    sheet.body.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    sheet.body.addEventListener('click', onClick);
    sheet.body.addEventListener('change', onChange);
  }

  function onClick(e: Event): void {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const open = t.closest<HTMLElement>('[data-open]');
    if (open) { env.open({ tmdbId: Number(open.dataset.open), mediaType: open.dataset.type === 'tv' ? 'tv' : 'movie', title: open.dataset.title || undefined }); return; }
    const f = t.closest<HTMLElement>('[data-f]');
    if (f) {
      switch (f.dataset.f) {
        case 'type': {
          const to = f.dataset.type === 'tv' ? 'tv' : 'movie';
          if (to !== st.mediaType) apply(switchType(st, to, genreCache.get(to)));
          return;
        }
        case 'genre': {
          const id = Number(f.dataset.id);
          apply({ ...st, genres: st.genres.includes(id) ? st.genres.filter(g => g !== id) : [...st.genres, id] });
          return;
        }
        case 'unset': {
          const a = activeFilters(st, names).find(x => x.key === f.dataset.key);
          if (!a) return;
          const list = Array.from(el.querySelectorAll<HTMLElement>('[data-f="unset"]'));
          const i = list.indexOf(f);
          apply(a.next);
          // keep the keyboard near: the next chip, else "Clear all"/the heading
          const after = Array.from(el.querySelectorAll<HTMLElement>('[data-f="unset"]'));
          (after[Math.min(i, after.length - 1)] ?? el.querySelector<HTMLElement>('#rqbh'))?.focus();
          return;
        }
        case 'clear': {
          apply(clearFilters(st));
          if (!sheet) el.querySelector<HTMLElement>('#rqbh')?.focus();
          return;
        }
      }
    }
    if (t.closest('#rqbfilt')) { openSheet(); return; }
    if (t.closest('#rqbmore')) { void load(true, true); return; }
    if (t.closest('#rqbretry')) { void load(false); return; }
    if (t.closest('#rqbback')) env.back();
  }

  function onChange(e: Event): void {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) && !(t instanceof HTMLSelectElement)) return;
    const f = t.dataset.f;
    if (f === 'sort') { const v = SORTS.find(s => s.id === t.value); if (v) apply({ ...st, sort: v.id }, true); return; }
    if (f === 'hide' && t instanceof HTMLInputElement) { apply({ ...st, hide: t.checked }, true); return; }
    if (f === 'from' || f === 'to') {
      const raw = t.value.trim();
      const n = raw === '' ? undefined : Number(raw);
      if (n != null && (!Number.isInteger(n) || n < 1900 || n > thisYear + 5)) { t.setCustomValidity(`Enter a year between 1900 and ${thisYear + 5}`); t.reportValidity(); return; }
      t.setCustomValidity('');
      let next: BrowseState = { ...st, [f === 'from' ? 'fromYear' : 'toYear']: n };
      if (next.fromYear && next.toYear && next.fromYear > next.toYear) next = { ...next, fromYear: next.toYear, toYear: next.fromYear };
      apply(next, true);
    }
  }

  // arrow keys inside the Films/Shows radio group
  function onKey(e: KeyboardEvent): void {
    const t = e.target;
    if (!(t instanceof HTMLElement) || t.dataset.f !== 'type' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const to = st.mediaType === 'tv' ? 'movie' : 'tv';
    apply(switchType(st, to, genreCache.get(to)));
  }

  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('keydown', onKey);

  paintBar();
  paintHead();
  void loadGenres();
  void load(false);
  el.querySelector<HTMLElement>('#rqbh')?.focus({ preventScroll: true });

  return {
    // after a request: page 1 is reloaded so its status marks are right; deeper in the list, keep the reader's place
    refresh(): void { if (res.page <= 1) void load(false); },
    dispose(): void { alive = false; io.disconnect(); window.removeEventListener('resize', stick); sheet?.close(); },
  };
}
