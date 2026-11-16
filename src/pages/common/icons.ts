/**
 * Icons used by the library and details pages. Names the shared sprite already has come from src/ui/icons.ts;
 * the rest (lifted from design/mockups/{library,details}.html) are inline SVG here, so the shared file stays untouched.
 */
import { raw, type SafeHtml } from '../../lib/html';
import { icon, type IconName } from '../../ui/icons';

const EXTRA = {
  star: `<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor" stroke="none"/>`,
  trailer: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9v6l5-3z" fill="currentColor"/>`,
  trash: `<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>`,
  dots: `<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>`,
  restart: `<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>`,
  ext: `<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>`,
  up: `<path d="M6 15l6-6 6 6"/>`,
  devices: `<rect x="2" y="4" width="14" height="10" rx="1.5"/><path d="M6 18h6M9 14v4"/><rect x="17" y="8" width="5" height="11" rx="1"/>`,
  sound: `<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>`,
  list: `<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>`,
  heartf: `<path d="M12 20s-7.5-4.6-9.2-9.3C1.6 7.3 3.8 4 7.2 4c2 0 3.6 1.1 4.8 2.8C13.2 5.1 14.8 4 16.8 4c3.4 0 5.6 3.3 4.4 6.7C19.5 15.4 12 20 12 20z" fill="currentColor"/>`,
  checkc: `<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>`,
  warn: `<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>`,
  drive: `<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13l2.5-8h9L19 13"/><circle cx="17" cy="16.5" r="1" fill="currentColor" stroke="none"/>`,
  share: `<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/>`,
  phone: `<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>`,
  sliders: `<path d="M5 4v6M5 14v6M12 4v3M12 11v9M19 4v9M19 17v3"/><rect x="3" y="10" width="4" height="4" rx="1"/><rect x="10" y="7" width="4" height="4" rx="1"/><rect x="17" y="13" width="4" height="4" rx="1"/>`,
  vposter: `<rect x="3" y="3" width="7.5" height="11" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="11" rx="1.5"/><path d="M3 18h7.5M13.5 18h7.5M3 21h5M13.5 21h5"/>`,
  vwall: `<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="8.5" height="7" rx="1.5"/><rect x="12.5" y="13" width="8.5" height="7" rx="1.5"/>`,
  vlist: `<rect x="3" y="4" width="4" height="6" rx="1"/><rect x="3" y="14" width="4" height="6" rx="1"/><path d="M10 6h11M10 9h7M10 16h11M10 19h7"/>`,
  vshelf: `<path d="M3 10.5h18M3 20.5h18"/><rect x="4" y="3" width="3.5" height="7.5" rx=".8"/><rect x="8.5" y="4.5" width="3.5" height="6" rx=".8"/><rect x="13" y="3" width="3.5" height="7.5" rx=".8"/><rect x="5" y="13" width="3.5" height="7.5" rx=".8"/><rect x="9.5" y="14.5" width="3.5" height="6" rx=".8"/>`,
  vprog: `<rect x="3" y="4" width="7" height="5" rx="1"/><path d="M13 5.5h8"/><path d="M13 8h3" stroke-width="3"/><rect x="3" y="14" width="7" height="5" rx="1"/><path d="M13 15.5h8"/><path d="M13 18h6" stroke-width="3"/>`,
  people: `<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>`,
  eyeoff: `<path d="M3 3l18 18"/><path d="M10.6 5.1A9.9 9.9 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.6 6.6C4.5 8 3 10 2 12c1 2.5 5 7 10 7 1.6 0 3.1-.4 4.4-1.1"/><path d="M9.9 10a3 3 0 0 0 4.2 4.2"/>`,
} as const;

export type XIconName = IconName | keyof typeof EXTRA;

/** Inline `<svg class="i">` (decorative). */
export function ic(name: XIconName, cls = ''): SafeHtml {
  if (name in EXTRA) {
    return raw(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${EXTRA[name as keyof typeof EXTRA]}</svg>`);
  }
  return icon(name as IconName, cls);
}
