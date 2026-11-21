/** Nuttyfin's mark: the "Sticker" play tile (owner's pick, 2026-11-21). Inline copies follow the colour theme; the favicon stays orange. NutBot is reserved for the assistant. */
import svg from '../assets/nuttyfin.svg?raw';
import { raw, type SafeHtml } from '../lib/html';

export function brandMark(size = 40): SafeHtml {
  const px = Math.max(16, Math.round(size));
  return raw(svg.replace(/#ff6b2b/g, 'var(--accent, #ff6b2b)').replace(/#3d3220/g, 'var(--line, #3d3220)').replace('<svg ', `<svg class="brand-mark" width="${px}" height="${px}" aria-hidden="true" focusable="false" `));
}
