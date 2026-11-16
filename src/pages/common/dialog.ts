/**
 * Modal dialog / bottom sheet used by the library and details pages.
 * Contract: the page behind goes inert, focus moves into the dialog (autofocus element, else the dialog),
 * Tab is trapped, Esc closes, and focus returns to whatever opened it. On phones CSS turns it into a bottom sheet.
 */
import type { SafeHtml } from '../../lib/html';
import { icon } from '../../ui/icons';
import './common.css';
import './dialog.css';

export interface DialogOptions {
  /** accessible name */
  label: string;
  /** extra class on .dialog: 'wide', 'video' */
  className?: string;
  /** extra class on the backdrop (.scrim), so a page can style the whole dialog tree */
  scrimClass?: string;
  /** hide the corner close button (the dialog supplies its own) */
  noClose?: boolean;
  /** Called after the dialog has closed and focus has moved back. */
  onClose?: () => void;
  /** Return false to veto closing (e.g. while a delete is running). */
  canClose?: () => boolean;
}

export interface DialogHandle {
  readonly el: HTMLElement;
  /** The element to put content in. */
  readonly body: HTMLElement;
  close(): void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
const open: DialogHandle[] = [];

export function openDialog(content: SafeHtml | HTMLElement, opts: DialogOptions): DialogHandle {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const scrim = document.createElement('div');
  scrim.className = `scrim ${opts.scrimClass ?? ''}`.trim();
  const dlg = document.createElement('div');
  dlg.className = `dialog ${opts.className ?? ''}`.trim();
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-label', opts.label);
  dlg.tabIndex = -1;
  const body = document.createElement('div');
  body.className = 'dbody';
  if (content instanceof HTMLElement) body.append(content); else body.innerHTML = content.value;
  dlg.innerHTML = `<div class="grab" aria-hidden="true"></div>${opts.noClose ? '' : `<button class="iconbtn x" type="button" data-close aria-label="Close">${icon('x').value}</button>`}`;
  dlg.append(body);
  scrim.append(dlg);
  document.body.append(scrim);

  const inerted: HTMLElement[] = [];
  for (const child of Array.from(document.body.children)) {
    if (child instanceof HTMLElement && child !== scrim && !child.classList.contains('toasts') && !child.inert) { child.inert = true; inerted.push(child); }
  }

  let closed = false;
  const handle: DialogHandle = {
    el: dlg,
    body,
    close() {
      if (closed || opts.canClose?.() === false) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      for (const el of inerted) el.inert = false;
      const i = open.indexOf(handle);
      if (i >= 0) open.splice(i, 1);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      opts.onClose?.();
    },
  };
  open.push(handle);

  function onKey(e: KeyboardEvent): void {
    if (open[open.length - 1] !== handle) return; // only the top-most dialog reacts
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); handle.close(); return; }
    if (e.key !== 'Tab') return;
    const items = Array.from(dlg.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(x => x.getClientRects().length > 0);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dlg)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey, true);

  scrim.addEventListener('mousedown', e => { if (e.target === scrim) handle.close(); });
  dlg.addEventListener('click', e => {
    if (e.target instanceof Element && e.target.closest('[data-close]')) handle.close();
  });

  const first = dlg.querySelector<HTMLElement>('[data-autofocus], [autofocus]') ?? dlg;
  first.focus({ preventScroll: true });
  return handle;
}

/** Close every open dialog (a page calls this from onDispose so a dialog never outlives its page). */
export function closeAllDialogs(): void {
  for (const d of [...open]) d.close();
}
