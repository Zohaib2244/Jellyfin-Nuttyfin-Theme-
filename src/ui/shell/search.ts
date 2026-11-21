/**
 * THE one global search (top bar). Combobox pattern: input[role=combobox] + listbox of options, aria-activedescendant,
 * ArrowUp/Down, Enter opens, Escape closes. Debounced calls to backend.search; superseded searches are aborted.
 * `/` focuses it from anywhere (unless you are typing in a field). On phones it collapses to an icon (qOpen / qClose).
 */
import type { Backend, Title } from '../../api';
import { imageUrl } from '../../api';
import { esc, html, raw, setHtml } from '../../lib/html';
import { phAttrs } from '../../lib/dom';
import { icon } from '../icons';

const DEBOUNCE_MS = 220;

export interface SearchController {
  focus(): void;
  close(): void;
}

function highlight(name: string, q: string): string {
  const i = name.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return esc(name);
  return `${esc(name.slice(0, i))}<mark>${esc(name.slice(i, i + q.length))}</mark>${esc(name.slice(i + q.length))}`;
}

export function mountSearch(top: HTMLElement, backend: Backend, navigate: (path: string) => void): SearchController {
  const form = top.querySelector<HTMLFormElement>('#tsearch') as HTMLFormElement;
  const input = form.querySelector<HTMLInputElement>('#q') as HTMLInputElement;
  const panel = form.querySelector<HTMLElement>('#qres') as HTMLElement;
  const openBtn = top.querySelector<HTMLButtonElement>('#qOpen') as HTMLButtonElement;
  const closeBtn = form.querySelector<HTMLButtonElement>('#qClose') as HTMLButtonElement;

  let results: Title[] = [];
  let active = -1;
  let timer: number | undefined;
  let controller: AbortController | null = null;
  let seq = 0;

  const listbox = () => panel.querySelector<HTMLElement>('[role="listbox"]');
  const options = () => Array.from(panel.querySelectorAll<HTMLElement>('[role="option"]'));

  // the visible height (a phone keyboard shrinks it) bounds the results panel, which scrolls inside it
  const fit = () => document.documentElement.style.setProperty('--vvh', `${Math.round(window.visualViewport?.height ?? window.innerHeight)}px`);
  window.visualViewport?.addEventListener('resize', fit);
  fit();

  function setOpen(open: boolean) {
    if (open) fit();
    panel.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (!open) { input.removeAttribute('aria-activedescendant'); active = -1; }
  }

  function setActive(i: number) {
    const opts = options();
    active = opts.length ? (i + opts.length) % opts.length : -1;
    opts.forEach((o, n) => o.setAttribute('aria-selected', String(n === active)));
    const cur = opts[active];
    if (cur) { input.setAttribute('aria-activedescendant', cur.id); cur.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  }

  function note(text: string) {
    setHtml(panel, html`<div class="qnote" role="status">${text}</div>`);
    setOpen(true);
  }

  function show(q: string) {
    if (!results.length) { note(`Nothing found for “${q}”. Try fewer letters.`); return; }
    const rows = results.map((t, i) => {
      const meta = `${t.kind === 'series' ? 'Show' : 'Film'}${t.year ? ` · ${t.year}` : ''}`;
      const img = t.imageTags.primary ? raw(`<img src="${imageUrl(t.id, 'Primary', { maxWidth: 96, tag: t.imageTags.primary })}" alt="" loading="lazy">`) : '';
      return html`<a role="option" id="qo-${i}" aria-selected="false" href="#/title/${t.id}" data-id="${t.id}">
        <span class="ph" ${raw(phAttrs(t.id))}>${img}</span>
        <span><b>${raw(highlight(t.name, q))}</b><small>${meta}</small></span></a>`;
    });
    setHtml(panel, html`<div role="listbox" id="qlist" aria-label="Search results">${rows}</div><span class="sr" role="status">${results.length} result${results.length === 1 ? '' : 's'}</span>`);
    setOpen(true);
    setActive(-1);
  }

  async function run(q: string) {
    controller?.abort();
    controller = new AbortController();
    const mine = ++seq;
    note('Searching…');
    try {
      const found = await backend.search(q, 8, controller.signal);
      if (mine !== seq) return;
      results = found;
      show(q);
    } catch (e) {
      if (mine !== seq || (e instanceof DOMException && e.name === 'AbortError')) return;
      note('Search is not available right now.');
    }
  }

  function close() {
    clearTimeout(timer);
    controller?.abort();
    seq++;
    setOpen(false);
  }

  function endPhoneSearch() {
    top.classList.remove('searching');
    openBtn.setAttribute('aria-expanded', 'false');
  }

  function choose(id: string) {
    close();
    input.value = '';
    input.blur();
    endPhoneSearch();
    navigate(`/title/${id}`);
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { close(); return; }
    timer = window.setTimeout(() => void run(q), DEBOUNCE_MS);
  });

  input.addEventListener('keydown', e => {
    switch (e.key) {
      case 'ArrowDown': if (!panel.hidden && options().length) { e.preventDefault(); setActive(active + 1); } break;
      case 'ArrowUp': if (!panel.hidden && options().length) { e.preventDefault(); setActive(active < 0 ? -1 : active - 1); } break;
      case 'Enter': {
        e.preventDefault();
        const o = options()[active] ?? options()[0];
        const id = o?.dataset.id;
        if (id) choose(id);
        break;
      }
      case 'Escape':
        if (!panel.hidden) { e.preventDefault(); close(); }
        else if (input.value) { e.preventDefault(); input.value = ''; }
        else { input.blur(); endPhoneSearch(); }
        break;
    }
  });

  form.addEventListener('submit', e => e.preventDefault());
  // keep input focus while pressing an option, then navigate on click
  panel.addEventListener('mousedown', e => e.preventDefault());
  panel.addEventListener('click', e => {
    const o = (e.target as Element).closest<HTMLElement>('[role="option"]');
    if (o?.dataset.id) { e.preventDefault(); choose(o.dataset.id); }
  });
  form.addEventListener('focusout', e => {
    const next = e.relatedTarget as Node | null;
    if (!next || !form.contains(next)) close();
  });
  input.addEventListener('focus', () => { if (results.length && input.value.trim() && panel.hidden && panel.childElementCount) setOpen(true); });

  openBtn.addEventListener('click', () => {
    top.classList.add('searching');
    openBtn.setAttribute('aria-expanded', 'true');
    input.focus();
  });
  closeBtn.addEventListener('click', () => { close(); input.value = ''; endPhoneSearch(); openBtn.focus(); });

  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (getComputedStyle(top).display === 'none') return; // chrome hidden (login/player)
    e.preventDefault();
    controller_focus();
  });

  function controller_focus() {
    if (getComputedStyle(form).display === 'none') openBtn.click(); else input.focus();
    input.select();
  }

  setOpen(false);
  return { focus: controller_focus, close: () => { close(); endPhoneSearch(); } };
}

/** Markup of the search area (kept here so shell.ts stays small). */
export function searchMarkup() {
  return html`
  <form class="tsearch" id="tsearch" role="search" autocomplete="off">
    ${icon('search')}
    <label class="sr" for="q">Search films and shows</label>
    <input id="q" type="search" placeholder="Search" role="combobox" aria-expanded="false" aria-controls="qres" aria-autocomplete="list" enterkeyhint="search" autocapitalize="none" spellcheck="false">
    <kbd aria-hidden="true">/</kbd>
    <button class="iconbtn tclose" type="button" id="qClose" aria-label="Close search">${icon('x')}</button>
    <div class="qres" id="qres" hidden></div>
  </form>
  <button class="iconbtn tsbtn" type="button" id="qOpen" aria-label="Search" aria-expanded="false">${icon('search')}</button>`;
}
