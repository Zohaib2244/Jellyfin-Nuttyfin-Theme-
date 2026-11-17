/** NuttyFin's acorn/play mark. NutBot is reserved for the assistant. */
import svg from '../assets/nuttyfin.svg?raw';
import { raw, type SafeHtml } from '../lib/html';

export function brandMark(size = 40): SafeHtml {
  const px = Math.max(16, Math.round(size));
  return raw(svg.replace('<svg ', `<svg class="brand-mark" width="${px}" height="${px}" aria-hidden="true" focusable="false" `));
}
