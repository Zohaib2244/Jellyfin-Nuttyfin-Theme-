/** Trailer links: YouTube ids and the privacy-friendly embed URL. Pure. */
import type { RemoteTrailer } from '../../api/types';

/** The 11-character id from youtube.com/watch?v=, youtu.be/, /embed/, /shorts/ links; null for anything else. */
export function youtubeId(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = /^\/(?:embed|shorts|v)\/([^/?]+)/.exec(u.pathname); id = m?.[1] ?? null; }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export const embedUrl = (id: string): string => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`;

/** The trailer to offer: the first one that is a YouTube link (embeddable); otherwise the first link as an outside link. */
export function pickTrailer(list: readonly RemoteTrailer[] | undefined): { id: string | null; url: string; name?: string } | null {
  if (!list?.length) return null;
  for (const t of list) { const id = youtubeId(t.url); if (id) return { id, url: t.url, ...(t.name ? { name: t.name } : {}) }; }
  const t = list[0] as RemoteTrailer;
  return /^https?:/i.test(t.url) ? { id: null, url: t.url, ...(t.name ? { name: t.name } : {}) } : null;
}

/** IMDb / TMDB links from Jellyfin's ProviderIds. */
export function externalLinks(ids: Record<string, string> | undefined, kind: 'movie' | 'series'): Array<{ name: string; url: string }> {
  const out: Array<{ name: string; url: string }> = [];
  if (ids?.Imdb && /^tt\d+$/.test(ids.Imdb)) out.push({ name: 'IMDb', url: `https://www.imdb.com/title/${ids.Imdb}/` });
  if (ids?.Tmdb && /^\d+$/.test(ids.Tmdb)) out.push({ name: 'TMDB', url: `https://www.themoviedb.org/${kind === 'movie' ? 'movie' : 'tv'}/${ids.Tmdb}` });
  return out;
}
