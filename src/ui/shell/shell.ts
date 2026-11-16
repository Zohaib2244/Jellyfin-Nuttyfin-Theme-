/**
 * The app shell, built ONCE at startup and never re-rendered per page:
 *   - one <aside class="rail"> (left rail on desktop, bottom tab bar on phones: the same element, restyled)
 *   - one top bar: section-tabs slot, ONE search, theme switch, avatar menu
 *   - <main><div id="view"> where pages are swapped in
 * Pages get the narrow ShellHooks API only. Login and the player set chrome "none", which hides the rail and top bar
 * with CSS (they stay in the DOM, so navigation is identical everywhere and can never jump from side to top).
 */
import type { Backend, User } from '../../api';
import { esc, html, raw, setHtml } from '../../lib/html';
import { onPrefsChange, effectiveTheme, getBackgroundPref, initPrefs, toggleTheme } from '../../state/prefs';
import type { NavKey, ShellHooks, TabsSpec } from '../../pages/types';
import type { RouterShell } from '../../router';
import { icon, mountIconSprite, pixelIcon, type IconName } from '../icons';
import { nutbot } from '../nutbot';
import { mountAccountMenu, picMarkup, roleOf, type AccountMenu } from './accountmenu';
import { createPageBg, type PageBg } from './pagebg';
import { mountSearch, searchMarkup, type SearchController } from './search';
import { renderTabs, type TabsController } from './tabs';

export interface Shell extends RouterShell {
  readonly view: HTMLElement;
  readonly pagebg: PageBg;
  setUser(u: User | null): void;
}

interface NavItem { key: NavKey; label: string; icon: IconName; href?: string }
const NAV: readonly NavItem[] = [
  { key: 'home', label: 'Home', icon: 'home', href: '#/' },
  { key: 'movies', label: 'Movies', icon: 'film', href: '#/movies' },
  { key: 'shows', label: 'Shows', icon: 'tv', href: '#/shows' },
  { key: 'requests', label: 'Requests', icon: 'inbox', href: '#/requests' },
  { key: 'saved', label: 'Saved', icon: 'plane' }, // placeholder: not built yet
];

export interface ShellOptions {
  backend: Backend;
  navigate(path: string): void;
}

export function mountShell({ backend, navigate }: ShellOptions): Shell {
  const body = document.body;
  initPrefs();
  mountIconSprite(body);

  const navItems = NAV.map(n => n.href
    ? html`<a class="ni" href="${n.href}" data-nav="${n.key}">${icon(n.icon)}<span class="lbl">${n.label}</span>${n.key === 'requests' ? raw('<span class="badge" id="reqBadge"></span>') : ''}</a>`
    : html`<button class="ni" type="button" data-soon="${n.label}">${icon(n.icon)}<span class="lbl">${n.label}</span></button>`);

  const shellHtml = html`
    <div class="pagebg" id="pagebg" aria-hidden="true"></div>
    <button class="skip" type="button" id="skip">Skip to content</button>
    <aside class="rail" id="rail">
      <a class="rbrand" href="#/" aria-label="NutFin home">${nutbot(40, 'idle')}</a>
      <nav class="nav" aria-label="Main">${navItems}</nav>
    </aside>
    <header class="top" id="top">
      <a class="brand" href="#/" aria-label="NutFin home">${nutbot(38, 'idle')}<span class="wm">Nut<em>Fin</em></span></a>
      <div class="toptabs" id="toptabs"></div>
      ${searchMarkup()}
      <button class="themesw" type="button" role="switch" id="themeSw" aria-checked="true" aria-label="Dark theme">${pixelIcon('moon', 'moon')}${pixelIcon('sun', 'sun')}</button>
      <div class="acct"><button class="avatar" type="button" id="avatarBtn" aria-haspopup="dialog" aria-expanded="false" aria-controls="acct-menu" hidden></button></div>
    </header>
    <main id="app"><div id="view"></div></main>
    <div class="toasts" id="toasts" role="status" aria-live="polite"></div>`;
  body.insertAdjacentHTML('beforeend', shellHtml.value);

  const q = <T extends HTMLElement>(sel: string) => body.querySelector<T>(sel) as T;
  const view = q('#view');
  const top = q('#top');
  const tabsSlot = q('#toptabs');
  const avatarBtn = q<HTMLButtonElement>('#avatarBtn');
  const themeSw = q<HTMLButtonElement>('#themeSw');
  const toasts = q('#toasts');

  /* page background */
  const pagebg = createPageBg(q('#pagebg'), getBackgroundPref());

  /* theme switch */
  const paintTheme = () => {
    const dark = effectiveTheme() === 'dark';
    themeSw.setAttribute('aria-checked', String(dark));
    themeSw.setAttribute('aria-label', dark ? 'Dark theme' : 'Light theme');
    themeSw.title = dark ? 'Dark. Switch to light' : 'Light. Switch to dark';
  };
  paintTheme();
  themeSw.addEventListener('click', toggleTheme);
  onPrefsChange(() => { paintTheme(); pagebg.set(getBackgroundPref()); });

  /* toasts */
  const toast = (message: string, ic: IconName = 'check') => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `${icon(ic).value}<span>${esc(message)}</span>`;
    toasts.append(t);
    setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 200); }, 3500);
  };

  /* search + account */
  const search: SearchController = mountSearch(top, backend, navigate);
  const account: AccountMenu = mountAccountMenu(avatarBtn, () => { void backend.signOut(); });

  /* rail */
  q('#rail').addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-soon]');
    if (b) toast(`${b.dataset.soon} is coming soon`, 'info');
  });
  q('#skip').addEventListener('click', () => { view.setAttribute('tabindex', '-1'); view.focus(); });

  /* tabs slot */
  let tabs: TabsController | null = null;
  const setTabs = (spec: TabsSpec | null) => {
    tabs?.destroy();
    tabs = null;
    if (spec) tabs = renderTabs(tabsSlot, spec); else tabsSlot.replaceChildren();
  };

  const hooks: ShellHooks = {
    setTabs,
    selectTab: id => tabs?.select(id),
    tabsSlot,
    setTitle(title) { document.title = title ? `${title} · NutFin` : 'NutFin'; },
    setRequestsBadge(n) {
      const b = body.querySelector<HTMLElement>('#reqBadge');
      if (b) { b.textContent = n > 0 ? String(n) : ''; b.setAttribute('aria-label', n > 0 ? `${n} open` : ''); }
    },
    setAmbient: url => pagebg.setAmbientImage(url),
    setWallImages: urls => pagebg.setWallImages(urls),
    toast,
    focusSearch: () => search.focus(),
  };

  return {
    view,
    pagebg,
    hooks,
    setNav(key) {
      for (const a of body.querySelectorAll<HTMLElement>('.nav .ni')) {
        if (a.dataset.nav === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      }
    },
    setChrome(mode) { body.dataset.shell = mode; },
    resetSlots() { setTabs(null); search.close(); account.close(); },
    setUser(u) {
      account.setUser(u);
      avatarBtn.hidden = !u;
      if (u) {
        avatarBtn.setAttribute('aria-label', `${u.name}, ${roleOf(u)}. Account and page look`);
        setHtml(avatarBtn, html`${raw(picMarkup(u))}<span class="nm">${u.name}<small>${roleOf(u)}</small></span>${icon('down')}`);
      } else avatarBtn.replaceChildren();
    },
  };
}
