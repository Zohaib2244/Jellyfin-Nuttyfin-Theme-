/**
 * Home and its tabs: #/home/:tab? with tabs Home, Continue Watching, Explore, Newly Added, Requests.
 * The tab lives in the URL and in the shell's tab bar (animated indicator). Switching tabs does NOT re-render the
 * page: each tab's tiles are built the first time it is opened and then just shown / hidden, so nothing leaks
 * between tabs and coming back is instant. Every tile loads its own data (see tile.ts).
 */
import './home.css';
import { clock } from '../../lib/format';
import { html } from '../../lib/html';
import { icon } from '../../ui/icons';
import type { Page } from '../types';
import { initArrange, type Arrange } from './arrange';
import { HomeData } from './data';
import { TAB_LABEL, type HomeCtx, type HomeTab, type TileDef } from './tile';
import { TABS, assertUniqueTiles, isTab, TILES, tilesOf } from './tiles';

const urlOf = (tab: HomeTab): string => (tab === 'home' ? '#/' : `#/home/${tab}`);
const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmtDate = (d: Date): string => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

const page: Page = {
  title: 'Home',
  render(pc) {
    assertUniqueTiles();
    let tab: HomeTab = isTab(pc.params.tab) ? pc.params.tab : 'home';

    const root = document.createElement('div');
    root.className = 'page home';
    root.innerHTML = html`
      <h1 class="sr" id="home-h1" data-autofocus tabindex="-1">${TAB_LABEL[tab]}</h1>
      <div class="boardbar">
        <p class="hint" id="homeHint"></p>
        <button class="btn sm ghost arrbtn" type="button" id="arrBtn" aria-label="Arrange this tab">${icon('grid')}<span class="lbl">Arrange</span></button>
      </div>
      <div class="arrbar" id="arrbar" role="region" aria-label="Arrange this tab" hidden></div>
      <section class="board" id="home-panel" role="tabpanel" aria-labelledby="tab-${tab}" tabindex="-1" data-tab="${tab}"></section>`.value;
    const board = root.querySelector('#home-panel') as HTMLElement;
    const h1 = root.querySelector('#home-h1') as HTMLElement;
    const hint = root.querySelector('#homeHint') as HTMLElement;

    const data = new HomeData(pc.backend);
    const ctx: HomeCtx = {
      backend: pc.backend, router: pc.router, shell: pc.shell, user: pc.user, signal: pc.signal, data,
      onDispose: pc.onDispose, now: () => new Date(),
      goTab: t => select(t, { focus: true }),
    };

    /* ── date row ── */
    const paintHint = (): void => { const d = new Date(); hint.innerHTML = `<b>${fmtDate(d)}</b> · ${clock(d)}`; };
    paintHint();
    const tick = window.setInterval(paintHint, 30_000);
    pc.onDispose(() => window.clearInterval(tick));

    /* ── tiles: built per tab on first visit ── */
    const sections = new Map<string, HTMLElement>();
    const cleanups: Array<() => void> = [];
    const built = new Set<HomeTab>();
    let arrange: Arrange | null = null;

    function buildTab(t: HomeTab): void {
      if (built.has(t)) return;
      built.add(t);
      for (const def of tilesOf(t)) {
        const sec = document.createElement('section');
        sec.className = `tile t-${def.id}${def.cls ? ` ${def.cls}` : ''}`;
        sec.dataset.id = def.id;
        sec.dataset.tab = def.tab;
        sec.setAttribute('aria-label', def.title);
        sec.style.setProperty('--gc', `${def.place[0]} / span ${def.place[2]}`);
        sec.style.setProperty('--gr', `${def.place[1]} / span ${def.place[3]}`);
        sec.style.setProperty('--c', String(def.place[2]));
        sec.style.setProperty('--r', String(def.place[3]));
        if (def.minH) sec.style.setProperty('--minh', `${def.minH}px`);
        sec.hidden = def.tab !== tab;
        const tin = document.createElement('div');
        tin.className = 'tin';
        sec.append(tin);
        board.append(sec);
        sections.set(def.id, sec);
        safeMount(def, tin);
      }
      arrange?.refresh();
    }

    function safeMount(def: TileDef, tin: HTMLElement): void {
      try {
        const off = def.mount(tin, ctx);
        if (typeof off === 'function') cleanups.push(off);
      } catch (e) {
        // One broken tile must never break the page.
        console.error(`Tile ${def.id} failed to start`, e);
        tin.innerHTML = '<div class="pad"><p class="quiet">This one could not start. Reload the page to try again.</p></div>';
      }
    }

    /* ── tabs ── */
    let token = 0;
    function select(next: HomeTab, o: { focus?: boolean; fromTabs?: boolean; replaceUrl?: boolean } = {}): void {
      if (next === tab) { if (o.focus) document.getElementById(`tab-${next}`)?.focus(); return; }
      if (arrange?.active) arrange.stop();
      tab = next;
      const my = ++token;
      // keep the URL in step without going through the router (which would rebuild the whole page)
      const hash = urlOf(next);
      if (location.hash !== hash) history.replaceState(history.state, '', hash);
      board.dataset.tab = next;
      board.setAttribute('aria-labelledby', `tab-${next}`);
      h1.textContent = TAB_LABEL[next];
      pc.shell.setTitle(next === 'home' ? 'Home' : TAB_LABEL[next]);
      if (!o.fromTabs) pc.shell.selectTab(next);
      if (o.focus) document.getElementById(`tab-${next}`)?.focus({ preventScroll: true });

      const swap = (): void => {
        if (my !== token) return;
        board.classList.remove('tab-out');
        buildTab(next);
        for (const t of board.querySelectorAll<HTMLElement>('.tile')) t.hidden = t.dataset.tab !== next;
        arrange?.refresh();
        if (!reduced()) {
          const visible = board.querySelectorAll<HTMLElement>('.tile:not([hidden])');
          visible.forEach(t => t.classList.remove('tab-in'));
          void board.offsetWidth;
          visible.forEach((t, i) => {
            t.style.setProperty('--k', String(Math.min(i, 8)));
            t.classList.add('tab-in');
            t.addEventListener('animationend', () => t.classList.remove('tab-in'), { once: true });
          });
        }
        const bar = root.querySelector<HTMLElement>('.boardbar');
        if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
      };
      swap();
    }

    pc.shell.setTabs({
      label: 'Home sections', tabs: TABS, selected: tab, panelId: 'home-panel',
      onSelect: id => { if (isTab(id)) select(id, { fromTabs: true }); },
    });
    pc.shell.setTitle(tab === 'home' ? 'Home' : TAB_LABEL[tab]);

    // "See all" and similar links inside tiles
    root.addEventListener('click', e => {
      const dismiss = (e.target as Element).closest<HTMLElement>('[data-dismiss-tile]');
      if (dismiss?.dataset.dismissTile) {
        arrange?.hideTile(dismiss.dataset.dismissTile);
        return;
      }
      const b = (e.target as Element).closest<HTMLElement>('[data-tab-link]');
      const id = b?.dataset.tabLink;
      if (b && isTab(id)) { e.preventDefault(); select(id, { focus: true }); }
    });
    // typed/linked hash while this page is open (the router ignores these when the page is already showing that hash)
    const onHash = (): void => {
      const m = /^#\/home\/([a-z]+)$/.exec(location.hash);
      const want: HomeTab | null = m && isTab(m[1]) ? m[1] : (location.hash === '#/' || location.hash === '' || location.hash === '#/home') ? 'home' : null;
      if (want && want !== tab) select(want);
    };
    window.addEventListener('hashchange', onHash);
    pc.onDispose(() => {
      window.removeEventListener('hashchange', onHash);
      cleanups.splice(0).forEach(fn => { try { fn(); } catch (err) { console.error(err); } });
      arrange?.destroy();
    });

    /* ── Arrange ── */
    arrange = initArrange({
      root, board, userId: pc.user?.id ?? 'anon', currentTab: () => tab, defs: TILES,
    });

    buildTab(tab);
    arrange.refresh();

    // the Requests badge in the rail: how many of your requests are still open (soft: nothing if Seerr is off)
    void data.requestSummary().then(list => { if (!pc.signal.aborted) pc.shell.setRequestsBadge(list.filter(r => r.state !== 'available' && r.state !== 'declined').length); });
    return root;
  },
};
export default page;
