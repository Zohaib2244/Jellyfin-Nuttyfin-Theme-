/**
 * Hash router: #/, #/home/<tab>, #/movies, #/shows, #/title/<id>, #/watch/<id>, #/requests, #/login.
 *  - route guard: not signed in => #/login?next=<where you wanted to go>
 *  - page lifecycle: render(ctx) -> swap -> ctx.onDispose callbacks when leaving; stale async renders are dropped
 *  - focus: the page's h1 (or [data-autofocus]) takes focus after a swap; document.title per page
 *  - swap: View Transition when available (and motion allowed), otherwise a CSS fade
 *  - scroll: going back/forward restores where you were; new navigations start at the top
 * matchRoute() is pure and unit-tested.
 */
import type { Backend } from './api';
import type { RouteDef } from './routes';
import type { Page, PageContext, RouteMatch, RouterApi, ShellHooks } from './pages/types';
import type { NavKey } from './pages/types';

/* ── pure matching ── */
export interface Matched extends RouteMatch { route: RouteDef }

export function splitHash(hash: string): { path: string; query: URLSearchParams } {
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!h.startsWith('/')) h = `/${h}`;
  const i = h.indexOf('?');
  const path = i >= 0 ? h.slice(0, i) : h;
  const query = new URLSearchParams(i >= 0 ? h.slice(i + 1) : '');
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return { path: clean || '/', query };
}

export function matchRoute(routes: readonly RouteDef[], hash: string): Matched | null {
  const { path, query } = splitHash(hash);
  const segs = path.split('/').filter(Boolean);
  for (const route of routes) {
    const pat = route.pattern.split('/').filter(Boolean);
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pat.length && ok; i++) {
      const p = pat[i] as string;
      const optional = p.endsWith('?');
      const name = p.startsWith(':') ? p.slice(1).replace(/\?$/, '') : null;
      const seg = segs[i];
      if (seg === undefined) { ok = optional; continue; }
      if (name) { try { params[name] = decodeURIComponent(seg); } catch { ok = false; } }
      else if (seg !== p) ok = false;
    }
    if (ok && segs.length <= pat.length) return { route, name: route.name, path, params, query };
  }
  return null;
}

/* ── router ── */
export interface RouterShell {
  readonly hooks: ShellHooks;
  setNav(key: NavKey | null): void;
  setChrome(mode: 'full' | 'none'): void;
  resetSlots(): void;
}

export interface RouterDeps {
  routes: readonly RouteDef[];
  backend: Backend;
  shell: RouterShell;
  /** the element pages are swapped into */
  view: HTMLElement;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const newKey = () => Math.random().toString(36).slice(2, 10);

export class Router implements RouterApi {
  current: Matched | null = null;
  private hash = '';
  private token = 0;
  private abort: AbortController | null = null;
  private disposers: Array<() => void> = [];
  private key = '';
  private readonly scrollByKey = new Map<string, number>();
  private readonly modules = new Map<RouteDef['load'], Page>();
  private hasContent = false;

  constructor(private readonly deps: RouterDeps) {}

  start(): void {
    history.scrollRestoration = 'manual';
    this.key = (history.state as { nfKey?: string } | null)?.nfKey ?? newKey();
    history.replaceState({ nfKey: this.key }, '');
    window.addEventListener('popstate', () => this.sync());
    window.addEventListener('hashchange', () => this.sync());
    this.hash = location.hash;
    void this.go(this.hash, null);
  }

  href(path: string): string { return `#${path}`; }
  back(): void { history.back(); }

  navigate(path: string, opts: { replace?: boolean } = {}): void {
    const hash = `#${path}`;
    if (hash === this.hash && !opts.replace) return;
    this.saveScroll();
    if (opts.replace) {
      history.replaceState({ nfKey: this.key }, '', hash);
    } else {
      this.key = newKey();
      history.pushState({ nfKey: this.key }, '', hash);
    }
    this.hash = hash;
    void this.go(hash, null);
  }

  replaceQuery(query: Record<string, string | null | undefined>): void {
    if (!this.current) return;
    const q = new URLSearchParams(this.current.query);
    for (const [k, v] of Object.entries(query)) { if (v == null || v === '') q.delete(k); else q.set(k, v); }
    const s = q.toString();
    const hash = `#${this.current.path}${s ? `?${s}` : ''}`;
    history.replaceState({ nfKey: this.key }, '', hash);
    this.hash = hash;
    this.current.query = q;
  }

  /** Re-run the guard for the current page (call after sign-in / sign-out). */
  reguard(): void {
    const signedIn = !!this.deps.backend.currentUser();
    const m = this.current;
    if (!m) return;
    if (!signedIn && m.route.auth !== false) this.navigate(`/login?next=${encodeURIComponent(m.path + (m.query.size ? `?${m.query}` : ''))}`, { replace: true });
  }

  /** Browser back/forward or a typed/linked hash. */
  private sync(): void {
    if (location.hash === this.hash) return;
    this.saveScroll();
    const state = history.state as { nfKey?: string } | null;
    const traversal = !!state?.nfKey;
    this.key = state?.nfKey ?? newKey();
    if (!traversal) history.replaceState({ nfKey: this.key }, '');
    this.hash = location.hash;
    void this.go(this.hash, traversal ? (this.scrollByKey.get(this.key) ?? 0) : null);
  }

  private saveScroll(): void { this.scrollByKey.set(this.key, window.scrollY); }

  private leave(): void {
    this.abort?.abort();
    for (const fn of this.disposers.splice(0)) { try { fn(); } catch (e) { console.error('dispose failed', e); } }
  }

  private async go(hash: string, restoreY: number | null): Promise<void> {
    const { backend, shell, view, routes } = this.deps;
    const m = matchRoute(routes, hash);
    const signedIn = !!backend.currentUser();

    // guards
    if (m && m.route.auth !== false && !signedIn) {
      this.navigate(`/login?next=${encodeURIComponent(m.path + (m.query.size ? `?${m.query}` : ''))}`, { replace: true });
      return;
    }
    if (m?.route.name === 'login' && signedIn) {
      const next = m.query.get('next');
      this.navigate(next && next.startsWith('/') && !next.startsWith('/login') ? next : '/', { replace: true });
      return;
    }
    if (!m) { this.navigate('/', { replace: true }); return; }

    const token = ++this.token;
    // switching a section tab in the top bar re-renders the page: keep keyboard focus on the (new) selected tab
    const tabFocus = !!document.activeElement?.closest('.toptabs');
    this.leave();
    this.current = m;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    view.setAttribute('aria-busy', 'true');
    shell.setChrome(m.route.chrome ?? 'full');
    shell.setNav(m.route.nav ?? null);
    shell.resetSlots();

    const ctx: PageContext = {
      backend, router: this, shell: shell.hooks, params: m.params, query: m.query, signal, user: backend.currentUser(),
      onDispose: fn => { this.disposers.push(fn); },
    };

    let el: HTMLElement;
    let page: Page | undefined;
    try {
      page = this.modules.get(m.route.load);
      if (!page) { page = (await m.route.load()).default; this.modules.set(m.route.load, page); }
      if (token !== this.token) return;
      shell.hooks.setTitle(page.title ?? '');
      el = await page.render(ctx);
    } catch (e) {
      if (token !== this.token || signal.aborted) return;
      console.error(e);
      el = errorView(() => { void this.go(this.hash, null); });
    }
    if (token !== this.token) return;

    await this.swap(el, restoreY);
    view.removeAttribute('aria-busy');
    if (tabFocus) this.focusSelectedTab(el); else this.focusPage(el);
  }

  private async swap(el: HTMLElement, restoreY: number | null): Promise<void> {
    const { view } = this.deps;
    const apply = () => {
      view.replaceChildren(el);
      window.scrollTo(0, restoreY ?? 0);
    };
    const st = (document as Document & { startViewTransition?: (cb: () => void) => { updateCallbackDone: Promise<void>; ready: Promise<void>; finished: Promise<void> } }).startViewTransition;
    if (this.hasContent && st && !reducedMotion()) {
      try {
        const vt = st.call(document, apply);
        // a transition cut short by a newer navigation rejects these: that is fine, but must not surface as an unhandled rejection
        vt.ready.catch(() => {});
        vt.finished.catch(() => {});
        await vt.updateCallbackDone;
      } catch { /* aborted by a newer transition */ }
    } else {
      apply();
      if (this.hasContent && !reducedMotion()) {
        document.body.classList.add('swapping');
        setTimeout(() => document.body.classList.remove('swapping'), 400);
      }
    }
    this.hasContent = true;
    if (restoreY) this.restoreLater(restoreY);
  }

  /** Pages often fill in lists after first render: keep trying to reach the saved scroll position for a moment. */
  private restoreLater(y: number): void {
    const until = performance.now() + 1500;
    const tick = () => {
      if (Math.abs(window.scrollY - y) < 2 || performance.now() > until) return;
      window.scrollTo(0, y);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private focusSelectedTab(el: HTMLElement): void {
    const tab = document.querySelector<HTMLElement>('.toptabs [role="tab"][aria-selected="true"]');
    if (tab) tab.focus({ preventScroll: true }); else this.focusPage(el);
  }

  private focusPage(el: HTMLElement): void {
    const target = el.querySelector<HTMLElement>('[data-autofocus], [autofocus]') ?? el.querySelector<HTMLElement>('h1');
    if (target) {
      if (!target.hasAttribute('tabindex') && !/^(INPUT|BUTTON|A|SELECT|TEXTAREA)$/.test(target.tagName)) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    } else {
      this.deps.view.setAttribute('tabindex', '-1');
      this.deps.view.focus({ preventScroll: true });
    }
  }
}

function errorView(retry: () => void): HTMLElement {
  const d = document.createElement('section');
  d.className = 'page';
  d.innerHTML = '<h1 class="page-h">Something went wrong</h1><p class="page-sub">This page could not load. Check your connection and try again.</p>';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn primary';
  b.textContent = 'Try again';
  b.addEventListener('click', retry);
  d.append(b);
  return d;
}
