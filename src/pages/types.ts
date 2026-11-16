/**
 * THE PAGE CONTRACT (see docs/PAGE-CONTRACT.md).
 * A page module default-exports a `Page`. The router calls `render(ctx)` once per visit; whatever element it
 * returns is swapped into the content area (the shell stays put). Cleanup goes through `ctx.onDispose(fn)`.
 */
import type { Backend, User } from '../api';
import type { IconName } from '../ui/icons';

export interface Page {
  /** Fallback document title (e.g. "Movies"). Call ctx.shell.setTitle(...) for dynamic ones. */
  title?: string;
  /** Build the page. May be async: the old page stays visible until this resolves (then a view-transition swap). */
  render(ctx: PageContext): HTMLElement | Promise<HTMLElement>;
}

/** Highlight in the left rail / bottom bar. */
export type NavKey = 'home' | 'movies' | 'shows' | 'requests' | 'saved';

export interface Tab {
  id: string;
  label: string;
}

export interface TabsSpec {
  /** accessible name of the tab list, e.g. "Home sections" */
  label: string;
  tabs: readonly Tab[];
  selected: string;
  /** Called when the person picks a tab (click, Enter/Space, or arrow keys + activation). The page swaps its own panel. */
  onSelect(id: string): void;
  /** id of the tabpanel the tabs control (optional, for aria-controls) */
  panelId?: string;
}

/** What a page may ask of the shell. The rail, top bar, search and avatar menu are NOT page-controlled. */
export interface ShellHooks {
  /** Fill (or with null, empty) the section-tabs slot in the top bar. The router empties it on every navigation. */
  setTabs(spec: TabsSpec | null): void;
  /** Move the tab indicator/selection without calling onSelect (e.g. after the URL changed). */
  selectTab(id: string): void;
  /** The element behind the tabs slot, for pages that need something other than plain tabs. Router empties it per navigation. */
  readonly tabsSlot: HTMLElement;
  /** document.title becomes "<title> · NutFin". */
  setTitle(title: string): void;
  /** Number shown on the Requests item in the rail (0 hides it). */
  setRequestsBadge(count: number): void;
  /** Hook for the "Ambient colour" page background: a backdrop image URL, or null. */
  setAmbient(url: string | null): void;
  /** Hook for the "Poster wall" page background: poster image URLs, or []. */
  setWallImages(urls: string[]): void;
  toast(message: string, icon?: IconName): void;
  focusSearch(): void;
}

export interface NavigateOptions {
  replace?: boolean;
}

export interface RouterApi {
  /** navigate('/title/abc'), navigate('/movies?genre=Action'). Paths have no leading '#'. */
  navigate(path: string, opts?: NavigateOptions): void;
  back(): void;
  /** '#/title/abc' for an <a href>. */
  href(path: string): string;
  /** Change the query string (e.g. filters) without re-rendering the page. Uses history.replaceState. */
  replaceQuery(query: Record<string, string | null | undefined>): void;
  readonly current: RouteMatch | null;
}

export interface RouteMatch {
  name: string;
  /** matched path without query, e.g. '/title/abc' */
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
}

export interface PageContext {
  backend: Backend;
  router: RouterApi;
  shell: ShellHooks;
  /** Route params, e.g. { id } for #/title/:id, { tab } for #/home/:tab */
  params: Record<string, string>;
  /** Query string of the hash route */
  query: URLSearchParams;
  /** Aborted when the person navigates away. Pass to backend calls that take a signal. */
  signal: AbortSignal;
  user: User | null;
  /** Register cleanup (timers, listeners, observers) that runs when the person leaves this page. */
  onDispose(fn: () => void): void;
}
