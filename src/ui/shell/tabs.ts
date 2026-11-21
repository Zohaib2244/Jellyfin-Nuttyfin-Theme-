/** Section tabs (WAI-ARIA tabs, automatic activation) rendered into the top bar's slot. */
import type { TabsSpec } from '../../pages/types';
import { esc } from '../../lib/html';

export interface TabsController {
  select(id: string): void;
  destroy(): void;
}

export function renderTabs(slot: HTMLElement, spec: TabsSpec): TabsController {
  const nav = document.createElement('div');
  nav.className = 'section-nav';
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', spec.label);
  nav.innerHTML = spec.tabs.map(t =>
    `<button type="button" role="tab" id="tab-${esc(t.id)}" data-tab="${esc(t.id)}" aria-selected="false" tabindex="-1"${spec.panelId ? ` aria-controls="${esc(spec.panelId)}"` : ''}>${esc(t.label)}${t.count != null ? ` <small class="tab-n">${t.count}</small>` : ''}</button>`,
  ).join('') + '<span class="tab-ind" aria-hidden="true"></span>';
  slot.replaceChildren(nav);

  const buttons = () => Array.from(nav.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const ind = nav.querySelector<HTMLElement>('.tab-ind') as HTMLElement;

  const paint = (id: string, scroll: boolean) => {
    for (const b of buttons()) {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) {
        ind.style.width = `${b.offsetWidth}px`;
        ind.style.transform = `translateX(${b.offsetLeft}px)`;
        if (scroll) b.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      }
    }
  };

  let selected = spec.selected;
  paint(selected, false);
  const ro = new ResizeObserver(() => paint(selected, false));
  ro.observe(nav);
  void document.fonts?.ready.then(() => paint(selected, false));

  const pick = (id: string, focus: boolean) => {
    if (id === selected) return;
    selected = id;
    paint(id, true);
    if (focus) nav.querySelector<HTMLElement>(`[data-tab="${CSS.escape(id)}"]`)?.focus();
    spec.onSelect(id);
  };

  nav.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[role="tab"]');
    if (b?.dataset.tab) pick(b.dataset.tab, false);
  });
  nav.addEventListener('keydown', e => {
    const list = buttons();
    const i = list.findIndex(b => b === document.activeElement);
    if (i < 0) return;
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = list.length - 1;
    if (n < 0) return;
    e.preventDefault();
    const id = list[n]?.dataset.tab;
    if (id) pick(id, true);
  });

  return {
    select(id) { selected = id; paint(id, true); },
    destroy() { ro.disconnect(); },
  };
}
