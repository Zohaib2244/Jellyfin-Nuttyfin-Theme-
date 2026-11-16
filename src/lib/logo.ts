/** Title logos are transparent PNGs; some are near-black and vanish on our dark artwork. Mean luminance of the opaque pixels, 0..1 (undefined if unreadable). */
export function logoLuminance(img: HTMLImageElement): number | undefined {
  try {
    const w = 48, h = Math.max(1, Math.round(48 * (img.naturalHeight / Math.max(1, img.naturalWidth))));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); if (!g) return undefined;
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]! / 255; if (a < 0.4) continue; sum += (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255; n++; }
    return n > 20 ? sum / n : undefined;
  } catch { return undefined; }
}

/** Calls `bad(img)` for every `img.logo` under `root` that fails to load or is too dark to read on dark artwork (now and later). */
export function watchLogos(root: HTMLElement, bad: (img: HTMLImageElement) => void, opts: { signal?: AbortSignal } = {}): void {
  const check = (img: HTMLImageElement): void => { if (!img.naturalWidth) return; const l = logoLuminance(img); if (l !== undefined && l < 0.24) bad(img); };
  root.addEventListener('load', e => { const t = e.target; if (t instanceof HTMLImageElement && t.classList.contains('logo')) check(t); }, { capture: true, signal: opts.signal });
  root.addEventListener('error', e => { const t = e.target; if (t instanceof HTMLImageElement && t.classList.contains('logo')) bad(t); }, { capture: true, signal: opts.signal });
  root.querySelectorAll<HTMLImageElement>('img.logo').forEach(i => { if (i.complete) check(i); });
}
