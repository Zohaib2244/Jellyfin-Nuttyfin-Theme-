/** Route table. Each page is a lazy chunk; to swap in a real page, replace the module the `load` points to. */
import type { NavKey, Page } from './pages/types';

export interface RouteDef {
  name: string;
  /** '/title/:id', '/home/:tab?' (trailing ? = optional) */
  pattern: string;
  load: () => Promise<{ default: Page }>;
  /** Rail / tab-bar highlight */
  nav?: NavKey;
  /** false = reachable when signed out (login). Default true. */
  auth?: boolean;
  /** 'none' hides the rail and top bar (login, player). Default 'full'. */
  chrome?: 'full' | 'none';
  /** The only values `:tab` may take. Any other value is an unknown address (404), not a silent fallback. */
  tabs?: readonly string[];
}

export const routes: readonly RouteDef[] = [
  { name: 'login', pattern: '/login', auth: false, chrome: 'none', load: () => import('./pages/login') },
  { name: 'home', pattern: '/', nav: 'home', load: () => import('./pages/home') },
  // 'requests' is the old Requests tab: the Home page forwards it to #/requests
  { name: 'home', pattern: '/home/:tab?', nav: 'home', tabs: ['home', 'continue', 'explore', 'new', 'requests'], load: () => import('./pages/home') },
  { name: 'movies', pattern: '/movies', nav: 'library', load: () => import('./pages/library/movies') },
  { name: 'shows', pattern: '/shows', nav: 'library', load: () => import('./pages/library/shows') },
  { name: 'title', pattern: '/title/:id', nav: 'library', load: () => import('./pages/details') },
  { name: 'requests', pattern: '/requests/:tab?', nav: 'requests', tabs: ['requests', 'discover'], load: () => import('./pages/requests') },
  { name: 'favourites', pattern: '/favourites/:tab?', nav: 'favourites', tabs: ['films', 'shows'], load: () => import('./pages/favourites') },
  { name: 'watch', pattern: '/watch/:id', chrome: 'none', load: () => import('./pages/watch') },
];

/** Shown for any address no route matches (see Router.go). */
export const notFoundRoute: RouteDef = { name: 'notfound', pattern: '*', load: () => import('./pages/notfound') };
