/**
 * DOM wiring for the motion system (look: src/styles/motion.css, rules: docs/DESIGN-RULES.md "Motion").
 * One MutationObserver, no per-item timers, no markup changes in pages:
 *  - list stagger:   new items of known lists get a one-shot `data-enter` (first 12 that are on screen, never replayed)
 *  - tab panels:     content swapped into a [role=tabpanel] fades in
 *  - skeletons:      what replaces a skeleton fades in instead of popping
 *  - images:         posters/backdrops that are still loading wait at opacity 0, then fade in (placeholder behind)
 *  - toggles:        favourite / watched pop, badge count bump
 *  - rail:           a single indicator that slides between nav items
 *  - theme:          `html.theme-switching` for ~300ms so colours cross-fade
 *  - route bar:      thin progress line while a page is pending > 150ms
 * Everything is skipped under prefers-reduced-motion and on the full-screen pages (login, player).
 */
import { onPrefsChange } from '../state/prefs';
import { planEnter, prefersReducedMotion, RouteProgress, setRouteHooks } from './motion';

/** Items that stagger in. Add a class here to opt a list in; add data-no-enter on a container to opt out. */
const ITEM_SEL = [
  '.lc', '.sc', '.ep', '.pc', '.chap', '.person', '.rq-row', '.rq-tile', '.rq-gtile', '.rc', '.nli',
  '.qres [role="option"]',
].join(', ');
const SKELETON_SEL = '.sk, .sk-strip, .sk-rows, .rq-skgrid, .rq-skrows, .rq-sk, .rq-rail.sk, .status';
const IMG_SEL = '.ph img, .pic img';
const IMG_SKIP = '.coll, .lg-art, .lg-col, .pagebg, .bd, .pl, .kb, [data-no-enter]';
const POP_SEL = '[data-fav], [data-watched], [data-epwatch]';
const CLEANUP_MS = 1200;

let started = false;
let swapAt = -1e9;
/** What was already shown, per page / dialog / dropdown. A list that is rebuilt inside the same page (filters, view or
 *  season switches) keeps its memory, so only genuinely new items animate. Keys are scoped by the list's class names. */
const seenByScope = new WeakMap<Element, Set<string>>();

const inSwapWindow = (): boolean => performance.now() - swapAt < 500;

function keyOf(el: Element): string | null {
  const h = el as HTMLElement;
  const own = h.dataset.id ?? h.dataset.reqId ?? el.getAttribute('href');
  if (own) return own;
  const inner = el.querySelector<HTMLElement>('[data-open]');
  if (inner) return `${inner.dataset.type ?? ''}:${inner.dataset.open ?? ''}`;
  const link = el.querySelector('a[href]');
  if (link) return link.getAttribute('href');
  const g = el.querySelector<HTMLElement>('[data-genre]');
  return g ? `g:${g.dataset.genre ?? ''}` : null;
}

function onScreen(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
}

const skipped = (el: Element): boolean => !!el.closest('[aria-hidden="true"], [data-leaving], [data-no-enter], .coll');

function stampBatch(container: Element, items: Element[], soft: boolean): void {
  const scope = container.closest('.page, .dialog, .qres') ?? document.body;
  let seen = seenByScope.get(scope);
  if (!seen) { seen = new Set(); seenByScope.set(scope, seen); }
  const where = `${container.className}|`;
  const plan = planEnter(items.filter(i => !skipped(i)), { isVisible: onScreen, keyOf: i => { const k = keyOf(i); return k === null ? null : where + k; }, seen });
  if (!plan.length) return;
  for (const { item, index } of plan) {
    (item as HTMLElement).style.setProperty('--i', String(index));
    item.setAttribute('data-enter', soft ? 'soft' : 'up');
  }
  // one timer per batch: the attribute is only there to run the animation once
  window.setTimeout(() => { for (const { item } of plan) item.removeAttribute('data-enter'); }, CLEANUP_MS);
}

function holdImages(root: Element): void {
  const imgs = root instanceof HTMLImageElement ? [root] : Array.from(root.querySelectorAll('img'));
  for (const img of imgs) {
    if (img.complete || img.hasAttribute('data-img') || !img.matches(IMG_SEL) || img.closest(IMG_SKIP)) continue;
    if (!onScreen(img)) continue; // off screen: nobody sees it arrive, so it just loads
    img.setAttribute('data-img', 'wait');
    // safety net: never keep a visible image hidden because an event was missed
    if (img.loading !== 'lazy') window.setTimeout(() => releaseImage(img), 8000);
  }
}
function releaseImage(img: HTMLImageElement): void {
  if (img.getAttribute('data-img') === 'wait') img.setAttribute('data-img', 'in');
}

const flag = (el: Element, attr: string, ms: number): void => {
  el.removeAttribute(attr);
  void (el as HTMLElement).offsetWidth; // restart the animation if it was still running
  el.setAttribute(attr, '');
  window.setTimeout(() => el.removeAttribute(attr), ms);
};

function handle(records: MutationRecord[]): void {
  if (prefersReducedMotion() || document.body.dataset.shell === 'none') return;
  const soft = inSwapWindow();
  const batches = new Map<Element, Element[]>();
  const skeletonHosts = new Set<Node>();
  const faded: Element[] = [];

  for (const r of records) {
    if (r.type === 'attributes') {
      const el = r.target;
      if (el instanceof HTMLElement && r.oldValue === 'false' && el.getAttribute('aria-pressed') === 'true' && el.matches(POP_SEL)) flag(el, 'data-pop', 450);
      continue;
    }
    for (const n of r.removedNodes) if (n instanceof Element && n.matches(SKELETON_SEL)) skeletonHosts.add(r.target);
  }

  for (const r of records) {
    if (r.type !== 'childList' || !r.addedNodes.length) continue;
    const target = r.target;
    if (target instanceof Element && target.classList.contains('badge')) flag(target, 'data-bump', 400);
    const panelSwap = target instanceof Element && target.matches('[role="tabpanel"]:not(.board)');
    let plain = 0;
    for (const n of r.addedNodes) {
      if (!(n instanceof Element) || n.matches('[data-leaving], .toast, dialog') ) continue;
      holdImages(n);
      const found = n.matches(ITEM_SEL) ? [n] : [];
      for (const el of n.querySelectorAll(ITEM_SEL)) found.push(el);
      for (const el of found) {
        const parent = el.parentElement;
        if (!parent) continue;
        const list = batches.get(parent);
        if (list) list.push(el); else batches.set(parent, [el]);
      }
      if (found.some(el => !skipped(el)) || n.matches(SKELETON_SEL) || skipped(n) || !target.isConnected) continue;
      // content swapped into a tab panel, or into a place a skeleton just left: fade it in
      if ((panelSwap || skeletonHosts.has(target)) && plain++ < 8 && onScreen(n)) {
        n.setAttribute('data-enter', 'soft');
        faded.push(n);
        window.setTimeout(() => n.removeAttribute('data-enter'), CLEANUP_MS);
      }
    }
  }
  for (const [container, items] of batches) {
    // a faded tab panel is already the animation; fresh page content is fade-only because the page itself rises
    const own = faded.length ? items.filter(i => !faded.some(f => f.contains(i))) : items;
    if (own.length) stampBatch(container, own, soft);
  }
}

/* ── rail indicator ── */
function mountNavIndicator(): void {
  const nav = document.querySelector<HTMLElement>('.nav');
  if (!nav || nav.querySelector('.nav-ind')) return;
  const ind = document.createElement('span');
  ind.className = 'nav-ind';
  ind.setAttribute('aria-hidden', 'true');
  nav.prepend(ind);
  let placed = false;
  const place = (): void => {
    const cur = nav.querySelector<HTMLElement>('.ni[aria-current="page"]');
    if (!cur || cur.offsetWidth === 0) { ind.dataset.on = 'false'; placed = false; ind.removeAttribute('data-ready'); return; }
    const wasPlaced = placed;
    if (!wasPlaced) ind.removeAttribute('data-ready');
    ind.style.setProperty('--ix', `${cur.offsetLeft}px`);
    ind.style.setProperty('--iy', `${cur.offsetTop}px`);
    ind.style.setProperty('--iw', `${cur.offsetWidth}px`);
    ind.style.setProperty('--ih', `${cur.offsetHeight}px`);
    ind.dataset.on = 'true';
    placed = true;
    // the first placement (or a re-appearance after the rail was hidden) jumps; later ones slide
    if (!wasPlaced) requestAnimationFrame(() => requestAnimationFrame(() => ind.setAttribute('data-ready', '')));
  };
  new MutationObserver(place).observe(nav, { attributes: true, attributeFilter: ['aria-current'], subtree: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(place).observe(nav);
  addEventListener('resize', place);
  place();
}

/* ── theme / palette cross-fade ── */
function watchTheme(): void {
  const root = document.documentElement;
  let t = 0;
  const run = (): void => {
    if (prefersReducedMotion()) return;
    root.classList.add('theme-switching');
    window.clearTimeout(t);
    t = window.setTimeout(() => root.classList.remove('theme-switching'), 320);
  };
  // the click handler runs before the controls change the theme, so the class is on when colours change
  document.addEventListener('click', e => {
    if (e.target instanceof Element && e.target.closest('#themeSw, [data-theme-set], [data-pal-set]')) run();
  }, true);
  onPrefsChange(run);
}

/* ── route progress bar ── */
function mountRouteBar(): void {
  const bar = document.createElement('div');
  bar.className = 'route-bar';
  bar.setAttribute('aria-hidden', 'true');
  bar.dataset.state = 'idle';
  document.body.append(bar);
  const progress = new RouteProgress(s => { bar.dataset.state = s; });
  setRouteHooks({
    start: () => { if (!prefersReducedMotion()) progress.start(); },
    done: () => progress.done(),
    swapped: () => { swapAt = performance.now(); },
  });
}

export function initMotion(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  mountRouteBar();
  mountNavIndicator();
  watchTheme();
  new MutationObserver(handle).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'], attributeOldValue: true });
  const release = (e: Event): void => { if (e.target instanceof HTMLImageElement) releaseImage(e.target); };
  document.addEventListener('load', release, true);
  document.addEventListener('error', release, true);
}
