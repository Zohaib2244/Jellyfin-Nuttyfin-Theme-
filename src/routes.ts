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
}

export const routes: readonly RouteDef[] = [
  { name: 'login', pattern: '/login', auth: false, chrome: 'none', load: () => import('./pages/login') },
  { name: 'home', pattern: '/', nav: 'home', load: () => import('./pages/home') },
  { name: 'home', pattern: '/home/:tab?', nav: 'home', load: () => import('./pages/home') },
  { name: 'movies', pattern: '/movies', nav: 'movies', load: () => import('./pages/library/movies') },
  { name: 'shows', pattern: '/shows', nav: 'shows', load: () => import('./pages/library/shows') },
  { name: 'title', pattern: '/title/:id', load: () => import('./pages/details') },
  { name: 'requests', pattern: '/requests', nav: 'requests', load: () => import('./pages/requests') },
  { name: 'watch', pattern: '/watch/:id', chrome: 'none', load: () => import('./pages/watch') },
];
