/** Avatar menu: who you are, light/dark, colour theme, background, settings (Jellyfin's own pages for the deep stuff), Sign out. A small dialog under the avatar. */
import type { User } from '../../api';
import { userImageUrl } from '../../api';
import { esc, html, raw, setHtml } from '../../lib/html';
import { leave } from '../../lib/motion';
import { BACKGROUND_CHOICES, PALETTES, getBackgroundPref, getPalette, getThemePref, setBackgroundPref, setPalette, setThemePref, type PaletteId, type ThemePref } from '../../state/prefs';
import { BACKGROUNDS, type BackgroundId } from './pagebg';
import { icon } from '../icons';

const THEMES: ReadonlyArray<[ThemePref, string, 'auto' | 'sunsm' | 'moonsm']> = [
  ['auto', 'Auto', 'auto'], ['light', 'Light', 'sunsm'], ['dark', 'Dark', 'moonsm'],
];

/** Jellyfin's own web app lives at /web/ on the same host in production (the dev server proxies it under /jf). */
const JF_WEB = import.meta.env.DEV ? '/jf/web/' : '/web/';
const jf = (route: string): string => `${JF_WEB}#/${route}`;
/** Seerr's own site, for its admin settings. */
const seerrSite = (): string => (location.hostname.endsWith('avns.site') ? 'https://jellyseerr.avns.site' : 'http://jellyseerr.avns.nut');

interface SettingLink { label: string; hint: string; href: (u: User) => string; ic: Parameters<typeof icon>[0]; admin?: boolean }
const SETTINGS: readonly SettingLink[] = [
  { label: 'Profile & password', hint: 'Picture, password', href: u => jf(`userprofile?userId=${encodeURIComponent(u.id)}`), ic: 'user' },
  { label: 'Playback', hint: 'Quality, audio language, skip intros', href: () => jf('mypreferencesplayback'), ic: 'play' },
  { label: 'Subtitles', hint: 'Language and look', href: () => jf('mypreferencessubtitles'), ic: 'cc' },
  { label: 'Quick Connect', hint: 'Sign in a TV or phone with a code', href: () => jf('quickconnect'), ic: 'tv' },
  { label: 'All Jellyfin settings', hint: 'Display, home screen, controls', href: () => jf('mypreferencesmenu'), ic: 'gear' },
  { label: 'Server dashboard', hint: 'Users, libraries, scheduled tasks', href: () => jf('dashboard'), ic: 'server', admin: true },
  { label: 'Requests settings', hint: 'Seerr: who can ask, quotas', href: () => seerrSite(), ic: 'inbox', admin: true },
];

export const initialOf = (name: string): string => (name.trim()[0] ?? '?').toUpperCase();
export const roleOf = (u: User): string => (u.isAdmin ? 'Owner' : 'Member');

/** The avatar circle contents (photo when the account has one, otherwise the first letter). */
export function picMarkup(u: User): string {
  const img = u.avatarTag ? `<img src="${esc(userImageUrl(u.id, u.avatarTag))}" alt="">` : '';
  return `<span class="pic" aria-hidden="true">${esc(initialOf(u.name))}${img}</span>`;
}

export interface AccountMenu {
  setUser(u: User | null): void;
  close(): void;
}

export function mountAccountMenu(trigger: HTMLButtonElement, onSignOut: () => void): AccountMenu {
  let user: User | null = null;
  let menu: HTMLElement | null = null;

  const close = (returnFocus = false) => {
    if (!menu) return;
    const gone = menu;
    menu = null;
    gone.inert = true; // plays its exit, takes no focus or clicks
    leave(gone, { maxMs: 140 });
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) trigger.focus();
  };

  const radios = (group: HTMLElement) => Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
  const sync = () => {
    if (!menu) return;
    const theme = getThemePref();
    const pal = getPalette();
    const bg = getBackgroundPref();
    const sum = menu.querySelector<HTMLElement>('[data-look-sum]');
    if (sum) sum.textContent = [THEMES.find(x => x[0] === theme)?.[1], PALETTES.find(p => p.id === pal)?.label, BACKGROUNDS.find(b => b.id === bg)?.label].filter(Boolean).join(' · ');
    for (const b of menu.querySelectorAll<HTMLElement>('[data-pal-set]')) {
      const on = b.dataset.palSet === pal;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const b of menu.querySelectorAll<HTMLElement>('[data-bg-set]')) {
      const on = b.dataset.bgSet === bg;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const b of menu.querySelectorAll<HTMLElement>('[data-theme-set]')) {
      const on = b.dataset.themeSet === theme;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };

  const open = () => {
    if (!user || menu) return;
    const u = user;
    menu = document.createElement('div');
    menu.className = 'pop';
    menu.id = 'acct-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Account');
    setHtml(menu, html`
      <section class="pm-view" data-view="main">
        <div class="pm-me">${raw(picMarkup(u))}<div><b>${u.name}</b><small>${roleOf(u)} · signed in</small></div></div>
        <nav class="pm-main" aria-label="Account">
          <button type="button" data-go="look">${icon('palette')}<span>Appearance<small data-look-sum></small></span>${icon('next')}</button>
          <button type="button" data-go="settings">${icon('gear')}<span>Settings<small>Profile, playback, subtitles${u.isAdmin ? ', server' : ''}</small></span>${icon('next')}</button>
        </nav>
        <button type="button" class="pm-out" data-signout>${icon('logout')}Sign out</button>
      </section>
      <section class="pm-view" data-view="look" hidden aria-label="Appearance">
        <div class="pm-sub"><button type="button" class="iconbtn" data-go="main" aria-label="Back">${icon('back')}</button><h2>Appearance</h2></div>
        <h3 class="pm-h">Light or dark</h3>
        <div class="seg3" role="radiogroup" aria-label="Theme">${THEMES.map(([k, l, i]) =>
          html`<button type="button" role="radio" aria-checked="false" data-theme-set="${k}">${icon(i)}${l}</button>`)}</div>
        <h3 class="pm-h">Colour theme</h3>
        <div class="palopts" role="radiogroup" aria-label="Colour theme">${PALETTES.map(p =>
          html`<button type="button" class="palopt" role="radio" aria-checked="false" data-pal-set="${p.id}" title="${p.label}"><span class="sw" aria-hidden="true" style="--s0:${p.swatch[0]};--s1:${p.swatch[1]};--s2:${p.swatch[2]}"><i></i><i></i></span><span class="pl">${p.label}</span></button>`)}</div>
        <h3 class="pm-h">Background</h3>
        <div class="seg2" role="radiogroup" aria-label="Page background">${BACKGROUND_CHOICES.map(id => {
          const b = BACKGROUNDS.find(x => x.id === id);
          return html`<button type="button" role="radio" aria-checked="false" data-bg-set="${id}"><span class="thumbbg" data-v="${id}" aria-hidden="true"></span><span>${b?.label ?? id}</span></button>`;
        })}</div>
      </section>
      <section class="pm-view" data-view="settings" hidden aria-label="Settings">
        <div class="pm-sub"><button type="button" class="iconbtn" data-go="main" aria-label="Back">${icon('back')}</button><h2>Settings</h2></div>
        <nav class="pm-links" aria-label="Settings">${SETTINGS.filter(l => !l.admin || u.isAdmin).map(l =>
          html`<a href="${l.href(u)}" target="_blank" rel="noopener">${icon(l.ic)}<span>${l.label}<small>${l.hint}</small></span>${icon('ext')}</a>`)}</nav>
      </section>`);
    document.body.append(menu);
    trigger.setAttribute('aria-expanded', 'true');
    sync();
    menu.querySelector<HTMLElement>('[data-go="look"]')?.focus();

    menu.addEventListener('click', e => {
      const t = e.target as Element;
      const go = t.closest<HTMLElement>('[data-go]');
      if (go && menu) {
        const to = go.dataset.go ?? 'main';
        const from = menu.querySelector<HTMLElement>('.pm-view:not([hidden])')?.dataset.view;
        for (const v of menu.querySelectorAll<HTMLElement>('.pm-view')) v.hidden = v.dataset.view !== to;
        // focus: into the panel, or back onto the row you came from
        (to === 'main' ? menu.querySelector<HTMLElement>(`[data-go="${from}"]`) : menu.querySelector<HTMLElement>(`[data-view="${to}"] [data-go="main"]`))?.focus();
        return;
      }
      const th = t.closest<HTMLElement>('[data-theme-set]');
      if (th) { setThemePref(th.dataset.themeSet as ThemePref); sync(); return; }
      const pl = t.closest<HTMLElement>('[data-pal-set]');
      if (pl) { setPalette(pl.dataset.palSet as PaletteId); sync(); return; }
      const bgb = t.closest<HTMLElement>('[data-bg-set]');
      if (bgb) { setBackgroundPref(bgb.dataset.bgSet as BackgroundId); sync(); return; }
      if (t.closest('[data-signout]')) { close(); onSignOut(); }
    });
    menu.addEventListener('keydown', e => {
      const g = (e.target as Element).closest<HTMLElement>('[role="radiogroup"]');
      if (g && ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        const r = radios(g);
        const i = r.indexOf(e.target as HTMLElement);
        if (i >= 0) {
          e.preventDefault();
          const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
          const n = r[(i + step + r.length) % r.length];
          n?.focus();
          n?.click();
        }
      }
      if (e.key === 'Tab' && menu) {
        const f = Array.from(menu.querySelectorAll<HTMLElement>('a[href], button, [tabindex="0"]')).filter(x => x.tabIndex >= 0 && x.getClientRects().length);
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    });
  };

  trigger.addEventListener('click', () => (menu ? close(true) : open()));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu) { e.preventDefault(); close(true); } });
  document.addEventListener('pointerdown', e => {
    if (menu && !menu.contains(e.target as Node) && !trigger.contains(e.target as Node)) close();
  });

  return {
    setUser(u) { user = u; close(); },
    close: () => close(),
  };
}
