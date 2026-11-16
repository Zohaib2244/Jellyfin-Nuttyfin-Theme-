/**
 * Arrange mode: reorder and hide the tiles of the current tab, saved per person in localStorage.
 * Every action has a plain button (Move earlier / Move later / Hide / Add back / Reset layout), so it works with a
 * keyboard and a screen reader; dragging a tile by its handle is an extra. Until someone arranges a tab, it keeps
 * the designed placement; once they do, tiles flow in their order using their own sizes.
 */
import { html } from '../../lib/html';
import { store } from '../../lib/storage';
import { icon } from '../../ui/icons';
import { nutbot } from '../../ui/nutbot';
import type { HomeTab, TileDef } from './tile';

export interface SavedLayout { order: string[]; hidden: string[] }
type AllLayouts = Partial<Record<HomeTab, SavedLayout>>;

/** Saved layout merged with the tiles that exist now: unknown ids dropped, new tiles appended, no duplicates. */
export function resolveLayout(defaultIds: readonly string[], saved: SavedLayout | undefined): SavedLayout {
  if (!saved) return { order: [...defaultIds], hidden: [] };
  const known = new Set(defaultIds);
  const order = [...new Set(saved.order.filter(id => known.has(id)))];
  for (const id of defaultIds) if (!order.includes(id)) order.push(id);
  return { order, hidden: [...new Set(saved.hidden.filter(id => known.has(id)))] };
}

/** Move `id` one step earlier/later among the VISIBLE tiles (hidden ones keep their place). */
export function moveTile(order: readonly string[], hidden: readonly string[], id: string, dir: -1 | 1): string[] {
  const out = [...order];
  const vis = out.filter(x => !hidden.includes(x));
  const at = vis.indexOf(id);
  const to = vis[at + dir];
  if (at < 0 || to === undefined) return out;
  const i = out.indexOf(id);
  const j = out.indexOf(to);
  out[i] = to;
  out[j] = id;
  return out;
}

export interface Arrange {
  readonly active: boolean;
  start(): void;
  stop(): void;
  /** re-apply the saved layout of the current tab (after a tab switch or when tiles were added) */
  refresh(): void;
  /** Dismiss a tile using the same saved layout as Arrange's Hide action. */
  hideTile(id: string): void;
  destroy(): void;
}

export interface ArrangeOpts {
  root: HTMLElement;
  board: HTMLElement;
  userId: string;
  currentTab(): HomeTab;
  defs: readonly TileDef[];
}

const KEY = (user: string): string => `home.layout.${user}`;
const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initArrange(o: ArrangeOpts): Arrange {
  const btn = o.root.querySelector('#arrBtn') as HTMLButtonElement;
  const bar = o.root.querySelector('#arrbar') as HTMLElement;
  const live = document.createElement('div');
  live.className = 'sr';
  live.setAttribute('aria-live', 'polite');
  o.root.append(live);
  const say = (m: string): void => { live.textContent = ''; window.setTimeout(() => { live.textContent = m; }, 30); };

  let active = false;
  const defaultIds = (tab: HomeTab): string[] => o.defs.filter(d => d.tab === tab).map(d => d.id);
  const all = (): AllLayouts => store.get<AllLayouts>(KEY(o.userId), {});
  const saveTab = (tab: HomeTab, l: SavedLayout | null): void => {
    const a = all();
    if (l) a[tab] = l; else delete a[tab];
    if (Object.keys(a).length) store.set(KEY(o.userId), a); else store.remove(KEY(o.userId));
  };
  const tiles = (tab: HomeTab): HTMLElement[] => Array.from(o.board.querySelectorAll<HTMLElement>(`.tile[data-tab="${tab}"]`));
  const def = (id: string): TileDef | undefined => o.defs.find(d => d.id === id);

  /** Put the saved order into the DOM and mark hidden tiles. */
  function apply(): void {
    const tab = o.currentTab();
    const saved = all()[tab];
    const custom = !!saved;
    o.board.classList.toggle('custom', custom);
    const layout = resolveLayout(defaultIds(tab), saved);
    const byId = new Map(tiles(tab).map(t => [t.dataset.id as string, t] as const));
    for (const id of layout.order) { const t = byId.get(id); if (t) o.board.append(t); }
    for (const [id, t] of byId) { if (layout.hidden.includes(id)) t.dataset.off = ''; else delete t.dataset.off; }
    if (active) { decorate(); renderBar(); }
  }

  /* ── overlay controls on each tile ── */
  function decorate(): void {
    const tab = o.currentTab();
    const layout = resolveLayout(defaultIds(tab), all()[tab]);
    const vis = layout.order.filter(id => !layout.hidden.includes(id));
    for (const t of tiles(tab)) {
      t.querySelector('.ctl')?.remove();
      const id = t.dataset.id as string;
      const d = def(id);
      if (!d || layout.hidden.includes(id)) continue;
      const i = vis.indexOf(id);
      const ctl = document.createElement('div');
      ctl.className = 'ctl';
      ctl.innerHTML = html`<div class="nm"><span class="grip" data-grip title="Drag to move" aria-hidden="true">${icon('grip', 'grip')}</span><span>${d.title}</span></div>
        <div class="row">
          <button class="iconbtn" type="button" data-act="prev" aria-label="Move ${d.title} earlier" ${i <= 0 ? 'disabled' : ''}>${icon('back')}</button>
          <button class="iconbtn" type="button" data-act="next" aria-label="Move ${d.title} later" ${i >= vis.length - 1 ? 'disabled' : ''}>${icon('next')}</button>
          <button class="iconbtn" type="button" data-act="hide" aria-label="Hide ${d.title}">${icon('eyeoff')}</button>
        </div>`.value;
      t.append(ctl);
      (t.querySelector('.tin') as HTMLElement | null)?.setAttribute('inert', '');
    }
  }

  function undecorate(): void {
    for (const t of o.board.querySelectorAll<HTMLElement>('.tile')) {
      t.querySelector('.ctl')?.remove();
      t.querySelector('.tin')?.removeAttribute('inert');
    }
  }

  function renderBar(): void {
    const tab = o.currentTab();
    const layout = resolveLayout(defaultIds(tab), all()[tab]);
    bar.innerHTML = html`
      <div class="msg">${nutbot(40, 'look')}<div><b>Arrange this tab</b>Use each tile's arrows to move it, or drag by the handle. Hide what you do not need.<span class="ph-note">On a phone, tiles stack in one column.</span></div></div>
      <div class="acts"><button class="btn sm" type="button" data-bar="reset">${icon('undo')}Reset layout</button><button class="btn sm primary" type="button" data-bar="done">${icon('check')}Done</button></div>
      <div class="tray"><span>Hidden tiles</span>${layout.hidden.length
    ? layout.hidden.map(id => html`<button type="button" data-show="${id}" aria-label="Add back ${def(id)?.title ?? id}">${icon('plus')}${def(id)?.title ?? id}</button>`)
    : html`<span class="none">Nothing hidden.</span>`}</div>`.value;
  }

  /* ── changes ── */
  function commit(next: SavedLayout, why: string, flipFrom?: Map<HTMLElement, DOMRect>): void {
    const tab = o.currentTab();
    saveTab(tab, next);
    const before = flipFrom ?? snapshot();
    apply();
    animate(before);
    say(why);
  }

  const snapshot = (): Map<HTMLElement, DOMRect> => new Map(tiles(o.currentTab()).filter(t => !t.hidden && !('off' in t.dataset)).map(t => [t, t.getBoundingClientRect()] as const));

  function animate(first: Map<HTMLElement, DOMRect>): void {
    if (reduced()) return;
    for (const [t, a] of first) {
      if (!t.isConnected || t.hidden) continue;
      const b = t.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      t.getAnimations().forEach(x => x.cancel());
      t.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  }

  const current = (): SavedLayout => resolveLayout(defaultIds(o.currentTab()), all()[o.currentTab()]);

  function onAct(id: string, act: string): void {
    const l = current();
    const name = def(id)?.title ?? id;
    if (act === 'hide') {
      commit({ order: l.order, hidden: [...l.hidden, id] }, `${name} hidden. You can add it back from the tray.`);
      (bar.querySelector(`[data-show="${id}"]`) as HTMLElement | null)?.focus();
      return;
    }
    const dir = act === 'prev' ? -1 : 1;
    const order = moveTile(l.order, l.hidden, id, dir);
    if (order.join() === l.order.join()) return;
    commit({ order, hidden: l.hidden }, `${name} moved ${dir < 0 ? 'earlier' : 'later'}.`);
    // the button may have been re-rendered: keep keyboard focus on the same action
    const t = tiles(o.currentTab()).find(x => x.dataset.id === id);
    const again = t?.querySelector<HTMLElement>(`[data-act="${act}"]:not(:disabled)`) ?? t?.querySelector<HTMLElement>('[data-act]:not(:disabled)');
    again?.focus();
  }

  const onClick = (e: Event): void => {
    const t = e.target as HTMLElement;
    const a = t.closest<HTMLElement>('[data-act]');
    if (a) { const tile = a.closest<HTMLElement>('.tile'); if (tile?.dataset.id) onAct(tile.dataset.id, a.dataset.act as string); return; }
    const show = t.closest<HTMLElement>('[data-show]');
    if (show?.dataset.show) {
      const l = current();
      commit({ order: l.order, hidden: l.hidden.filter(x => x !== show.dataset.show) }, `${def(show.dataset.show)?.title ?? 'Tile'} added back.`);
      return;
    }
    const b = t.closest<HTMLElement>('[data-bar]');
    if (b?.dataset.bar === 'done') stop();
    if (b?.dataset.bar === 'reset') { reset(); }
  };
  o.root.addEventListener('click', onClick);

  function reset(): void {
    const before = snapshot();
    saveTab(o.currentTab(), null);
    for (const t of tiles(o.currentTab())) delete t.dataset.off;
    apply();
    animate(before);
    say('Layout reset to the original.');
  }

  /* ── drag by the handle (pointer): swap places with the tile under the pointer ── */
  let drag: { id: string; el: HTMLElement } | null = null;
  const onDown = (e: PointerEvent): void => {
    const grip = (e.target as HTMLElement).closest('[data-grip]');
    const tile = grip?.closest<HTMLElement>('.tile');
    if (!active || !grip || !tile?.dataset.id) return;
    drag = { id: tile.dataset.id, el: tile };
    tile.classList.add('lifted');
    tile.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: PointerEvent): void => {
    if (!drag) return;
    const over = document.elementsFromPoint(e.clientX, e.clientY).map(x => x.closest<HTMLElement>('.tile')).find(t => t && t !== drag?.el && t.dataset.tab === o.currentTab() && !t.hidden && !('off' in t.dataset));
    if (!over?.dataset.id) return;
    const l = current();
    const vis = l.order.filter(x => !l.hidden.includes(x));
    const dir = vis.indexOf(over.dataset.id) < vis.indexOf(drag.id) ? -1 : 1;
    const order = moveTile(l.order, l.hidden, drag.id, dir);
    if (order.join() === l.order.join()) return;
    commit({ order, hidden: l.hidden }, '');
  };
  const onUp = (): void => { if (drag) { drag.el.classList.remove('lifted'); say(`${def(drag.id)?.title ?? 'Tile'} moved.`); drag = null; } };
  o.board.addEventListener('pointerdown', onDown);
  o.board.addEventListener('pointermove', onMove);
  o.board.addEventListener('pointerup', onUp);
  o.board.addEventListener('pointercancel', onUp);

  function start(): void {
    if (active) return;
    active = true;
    document.body.classList.add('arranging');
    o.board.classList.add('arr');
    bar.hidden = false;
    btn.hidden = true;
    apply();
    decorate();
    renderBar();
    (bar.querySelector('[data-bar="done"]') as HTMLElement | null)?.focus({ preventScroll: true });
    say('Arrange mode on. Use the arrows on each tile to move it.');
  }
  function stop(): void {
    if (!active) return;
    active = false;
    document.body.classList.remove('arranging');
    o.board.classList.remove('arr');
    bar.hidden = true;
    btn.hidden = false;
    undecorate();
    say('Layout saved.');
    btn.focus({ preventScroll: true });
  }
  btn.addEventListener('click', start);

  return {
    get active() { return active; },
    start, stop,
    refresh() { apply(); },
    hideTile(id) {
      if (!defaultIds(o.currentTab()).includes(id)) return;
      onAct(id, 'hide');
      btn.focus({ preventScroll: true });
    },
    destroy() {
      o.root.removeEventListener('click', onClick);
      btn.removeEventListener('click', start);
      o.board.removeEventListener('pointerdown', onDown);
      o.board.removeEventListener('pointermove', onMove);
      o.board.removeEventListener('pointerup', onUp);
      o.board.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('arranging');
    },
  };
}
