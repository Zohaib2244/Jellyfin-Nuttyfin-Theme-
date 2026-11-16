/** Avatar menu: who you are, "Page look" (theme + background), Sign out. A small dialog under the avatar. */
import type { User } from '../../api';
import { userImageUrl } from '../../api';
import { esc, html, raw, setHtml } from '../../lib/html';
import { getBackgroundPref, getThemePref, setBackgroundPref, setThemePref, type ThemePref } from '../../state/prefs';
import { icon } from '../icons';
import { BACKGROUNDS, type BackgroundId } from './pagebg';

const THEMES: ReadonlyArray<[ThemePref, string, 'auto' | 'sunsm' | 'moonsm']> = [
  ['auto', 'Auto', 'auto'], ['light', 'Light', 'sunsm'], ['dark', 'Dark', 'moonsm'],
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
    menu.remove();
    menu = null;
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) trigger.focus();
  };

  const radios = (group: HTMLElement) => Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
  const sync = () => {
    if (!menu) return;
    const theme = getThemePref();
    const bg = getBackgroundPref();
    for (const b of menu.querySelectorAll<HTMLElement>('[data-theme-set]')) {
      const on = b.dataset.themeSet === theme;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const b of menu.querySelectorAll<HTMLElement>('[data-bg-set]')) {
      const on = b.dataset.bgSet === bg;
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
      <div class="pm-me">${raw(picMarkup(u))}<div><b>${u.name}</b><small>${roleOf(u)} · signed in</small></div></div>
      <details class="nf-disclosure">
        <summary>${icon('palette')}<span style="flex:1">Page look</span></summary>
        <div class="nf-body">
          <h3 class="pm-h" style="margin-top:0">Light or dark</h3>
          <div class="seg3" role="radiogroup" aria-label="Theme">${THEMES.map(([k, l, i]) =>
            html`<button type="button" role="radio" aria-checked="false" data-theme-set="${k}">${icon(i)}${l}</button>`)}</div>
          <h3 class="pm-h">Background</h3>
          <div class="bgopts" role="radiogroup" aria-label="Page background">${BACKGROUNDS.filter(b => b.wired).map(b =>
            html`<button type="button" class="bgopt" role="radio" aria-checked="false" data-bg-set="${b.id}"><span class="thumbbg" data-v="${b.id}" aria-hidden="true"></span><span>${b.label}<small>${b.hint}</small></span></button>`)}</div>
        </div>
      </details>
      <button type="button" class="pm-out" data-signout>${icon('logout')}Sign out</button>`);
    document.body.append(menu);
    trigger.setAttribute('aria-expanded', 'true');
    sync();
    menu.querySelector<HTMLElement>('summary')?.focus();

    menu.addEventListener('click', e => {
      const t = e.target as Element;
      const th = t.closest<HTMLElement>('[data-theme-set]');
      if (th) { setThemePref(th.dataset.themeSet as ThemePref); sync(); return; }
      const bg = t.closest<HTMLElement>('[data-bg-set]');
      if (bg) { setBackgroundPref(bg.dataset.bgSet as BackgroundId); sync(); return; }
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
        const f = Array.from(menu.querySelectorAll<HTMLElement>('summary, button, [tabindex="0"]')).filter(x => x.tabIndex >= 0 && x.getClientRects().length);
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
