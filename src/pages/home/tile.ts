/**
 * Tile framework: every tile is a <section class="tile"> with a clipped `.tin` content box. A tile loads its own
 * data, so one failing tile never breaks the page: it shows a small friendly retry instead.
 * `loadInto` runs the usual loading -> content | empty | error cycle (skeleton shimmer respects reduced motion).
 */
import type { Backend, User } from '../../api';
import { html, raw, type SafeHtml } from '../../lib/html';
import { icon, type IconName } from '../../ui/icons';
import { nutbot } from '../../ui/nutbot';
import type { RouterApi, ShellHooks } from '../types';
import type { HomeData } from './data';

export type HomeTab = 'home' | 'continue' | 'explore' | 'new';

export const TAB_LABEL: Record<HomeTab, string> = { home: 'Home', continue: 'Continue Watching', explore: 'Explore', new: 'Newly Added' };

export interface HomeCtx {
  backend: Backend;
  router: RouterApi;
  shell: ShellHooks;
  user: User | null;
  signal: AbortSignal;
  data: HomeData;
  /** Switch to another Home tab ("See all"). */
  goTab(tab: HomeTab): void;
  /** Show or leave out a tile of this page (an absent tile takes no space; desktop tiles below it move up). */
  setPresent(id: string, present: boolean): void;
  onDispose(fn: () => void): void;
  now(): Date;
}

export interface TileDef {
  id: string;
  /** the ONE tab this tile lives in (DESIGN-RULES: every tile belongs to exactly one tab) */
  tab: HomeTab;
  /** name used for the accessible label and Arrange mode */
  title: string;
  icon: IconName;
  /** desktop (>=1100px) placement on the 12-column grid: [column, row, columns, rows] */
  place: readonly [number, number, number, number];
  /** min height in px on one-column layouts (0 = fit content) */
  minH?: number;
  /** extra class on the section (e.g. 'onimg' for tiles over artwork) */
  cls?: string;
  /** Fill `host` (the .tin box). Return a cleanup function if you start timers or listeners outside `host`. */
  mount(host: HTMLElement, ctx: HomeCtx): void | (() => void);
}

/** A tile heading. `more` adds a "See all" link that opens another tab. */
export function tileHead(id: string, ic: IconName, title: string, opts: { count?: string; more?: { label: string; tab: HomeTab } } = {}): SafeHtml {
  const more = opts.more
    ? html`<span class="more"><button class="linkbtn" type="button" data-tab-link="${opts.more.tab}" aria-label="${opts.more.label}: open ${TAB_LABEL[opts.more.tab]}">${opts.more.label}${icon('next')}</button></span>`
    : '';
  return html`<h2 class="tl" id="h-${id}">${icon(ic)}${title}${opts.count ? html`<span class="cnt">${opts.count}</span>` : ''}${more}</h2>`;
}

/* ── skeletons ── */
const rep = (s: string, n: number): string => s.repeat(n);
export const skRows = (n: number): SafeHtml => raw(`<div class="sk-rows" aria-hidden="true">${rep('<div class="sk-row"><i class="sk sk-pic"></i><span><i class="sk sk-line"></i><i class="sk sk-line s"></i></span></div>', n)}</div>`);
export const skStrip = (n = 4): SafeHtml => raw(`<div class="sk-strip" aria-hidden="true">${rep('<div class="sk-card"><i class="sk sk-wide"></i><i class="sk sk-line"></i><i class="sk sk-line s"></i></div>', n)}</div>`);
export const skPosters = (n = 6): SafeHtml => raw(`<div class="sk-strip posters" aria-hidden="true">${rep('<div class="sk-card"><i class="sk sk-poster"></i><i class="sk sk-line"></i></div>', n)}</div>`);
export const skArt = (): SafeHtml => raw('<div class="sk sk-fill" aria-hidden="true"></div>');

const pad = (content: SafeHtml | string, cls = ''): string => `<div class="pad ${cls}">${typeof content === 'string' ? content : content.value}</div>`;

export interface LoadOpts<T> {
  /** heading shown while loading and on error (static: no ids needed) */
  head: SafeHtml;
  /** shimmer under the heading */
  skeleton: SafeHtml;
  fetch(): Promise<T>;
  /** Markup for the data (including its own heading); null means "nothing to show" (shows `empty`). */
  render(data: T): SafeHtml | null;
  /** friendly message when there is nothing to show */
  empty?: SafeHtml;
  /** Wire up behaviour on the rendered markup. May return a cleanup. */
  after?(host: HTMLElement, data: T): void | (() => void);
  /** extra class on the padded wrapper, e.g. 'sx' */
  padCls?: string;
  /** render() already returns a complete tile body (own wrapper), do not wrap in .pad */
  bare?: boolean;
  /** Optional lower-page tiles wait until they approach the viewport. */
  defer?: boolean;
}

/** Run the loading -> content | empty | error cycle in `host`. */
export function loadInto<T>(host: HTMLElement, ctx: HomeCtx, o: LoadOpts<T>): void {
  let cleanup: void | (() => void);
  let run = 0;
  const go = (): void => {
    const my = ++run;
    if (typeof cleanup === 'function') cleanup();
    cleanup = undefined;
    host.setAttribute('aria-busy', 'true');
    host.innerHTML = pad(html`${o.head}${o.skeleton}`, o.padCls);
    o.fetch().then(data => {
      if (my !== run || ctx.signal.aborted) return;
      host.removeAttribute('aria-busy');
      const body = o.render(data);
      if (!body) {
        host.innerHTML = pad(html`${o.head}${o.empty ?? quiet('Nothing here yet.')}`, o.padCls);
        return;
      }
      host.innerHTML = o.bare ? body.value : pad(body, o.padCls);
      cleanup = o.after?.(host, data);
    }).catch((e: unknown) => {
      if (my !== run || ctx.signal.aborted) return;
      console.warn('Home tile failed', e);
      host.removeAttribute('aria-busy');
      host.innerHTML = pad(html`${o.head}<div class="terr" role="alert"><p>This one did not load just now.</p><button class="btn sm" type="button" data-retry>${icon('undo')}Try again</button></div>`, o.padCls);
      host.querySelector('[data-retry]')?.addEventListener('click', go, { once: true });
    });
  };
  let observer: IntersectionObserver | undefined;
  if (o.defer && typeof IntersectionObserver !== 'undefined') {
    host.setAttribute('aria-busy', 'true');
    host.innerHTML = pad(html`${o.head}${o.skeleton}`, o.padCls);
    observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting) || ctx.signal.aborted) return;
      observer?.disconnect();
      go();
    }, { rootMargin: '120px' });
    observer.observe(host);
  } else go();
  ctx.onDispose(() => { run++; observer?.disconnect(); if (typeof cleanup === 'function') cleanup(); });
}

/** A friendly "nothing here" line with a small NutBot. */
export function quiet(text: string): SafeHtml { return html`<p class="quiet">${nutbot(34, 'look')}<span>${text}</span></p>`; }
