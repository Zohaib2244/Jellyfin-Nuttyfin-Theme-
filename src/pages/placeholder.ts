/** Shared by the Phase 1 placeholder pages. The real pages replace these modules; delete this helper then. */
import { html, raw, setHtml } from '../lib/html';

export function placeholderView(heading: string, detail: string, extra = ''): HTMLElement {
  const el = document.createElement('section');
  el.className = 'page';
  setHtml(el, html`<h1 class="page-h" data-autofocus>${heading}</h1><p class="page-sub">${detail}</p>${raw(extra)}`);
  return el;
}
