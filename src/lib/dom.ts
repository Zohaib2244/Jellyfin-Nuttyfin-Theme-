/** Tiny DOM helpers: $ / $$, event delegation, placeholder gradients. */

export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function $$<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/**
 * Event delegation. One listener on `root`, handler runs for the nearest ancestor of the event target that
 * matches `selector` (and sits inside root). Returns an unsubscribe function.
 *   const off = on(list, 'click', '[data-id]', (e, btn) => open(btn.dataset.id));
 */
export function on<K extends keyof HTMLElementEventMap, T extends HTMLElement = HTMLElement>(
  root: HTMLElement | Document,
  type: K,
  selector: string,
  handler: (event: HTMLElementEventMap[K], match: T) => void,
  options?: AddEventListenerOptions,
): () => void {
  const listener = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const match = target.closest<T>(selector);
    if (match && root.contains(match)) handler(event as HTMLElementEventMap[K], match);
  };
  root.addEventListener(type, listener, options);
  return () => root.removeEventListener(type, listener, options);
}

/** Stable hue (0-359) from a string, for placeholder gradients. */
export function hue(seed: string): number {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** Attribute string for `.ph` placeholders: html`<div class="ph" ${phAttrs(id, name)}>` (use raw()). */
export function phAttrs(seed: string, label = ''): string {
  const h = hue(seed);
  const t = label ? ` data-t="${label.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`)}"` : '';
  return `style="--h:${h};--h2:${(h + 55) % 360}"${t}`;
}

/** Hide an <img> that fails to load so the .ph gradient behind it shows (one capturing listener for the page). */
export function installImageFallback(root: Document = document): void {
  root.addEventListener('error', e => {
    const t = e.target;
    if (t instanceof HTMLImageElement) t.classList.add('broken');
  }, true);
}
