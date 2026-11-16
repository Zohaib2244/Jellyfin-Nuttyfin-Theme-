/**
 * `html` tagged template: every interpolated value is HTML-escaped unless it is already SafeHtml
 * (the result of another html`` or raw()). Arrays are flattened. null / undefined / false render nothing.
 *
 *   const rows = items.map(i => html`<li>${i.name}</li>`);          // SafeHtml
 *   setHtml(el, html`<ul>${rows}</ul>`);                           // rows are NOT double-escaped
 *   html`<p>${userText}</p>`                                       // userText is escaped
 *
 * html`` returns a SafeHtml (an object whose toString() is the markup) rather than a bare string, so nested
 * templates are never double-escaped. Use String(x), `${x}` or x.value when you need the plain string.
 * raw(str) is the escape hatch for markup you already trust (e.g. an SVG string from icons.ts).
 */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string { return this.value; }
}

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for use in element content or a quoted attribute. */
export function esc(v: unknown): string {
  return String(v).replace(/[&<>"']/g, c => ENT[c] ?? c);
}

/** Mark a string as trusted markup. Never pass user-controlled text. */
export function raw(markup: string): SafeHtml {
  return new SafeHtml(markup);
}

function part(v: unknown): string {
  if (v == null || v === false || v === true) return '';
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) out += part(values[i]) + (strings[i + 1] ?? '');
  return new SafeHtml(out);
}

/** Replace an element's children with a template. */
export function setHtml(el: Element, content: SafeHtml): void {
  el.innerHTML = content.value;
}

/** Build the first element of a template (leading/trailing whitespace is ignored). */
export function el<T extends HTMLElement = HTMLElement>(content: SafeHtml): T {
  const t = document.createElement('template');
  t.innerHTML = content.value.trim();
  const first = t.content.firstElementChild;
  if (!first) throw new Error('html template produced no element');
  return first as T;
}
