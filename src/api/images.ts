/** Image URL builders. Images are same-origin `/jf/...` (anonymous GETs, so plain <img> works, no auth header). */
import type { ImageType } from './types';

export interface ImageOpts {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  /** cache tag from item.imageTags; gives strong browser caching */
  tag?: string;
  /** Backdrop/Thumb can have several images */
  index?: number;
}

export const JF_BASE = '/jf';

/** /jf/Items/{id}/Images/{type}[/{index}]?maxWidth=..&maxHeight=..&quality=..&tag=.. */
export function imageUrl(id: string, type: ImageType, opts: ImageOpts = {}): string {
  const path = `${JF_BASE}/Items/${encodeURIComponent(id)}/Images/${type}${opts.index != null ? `/${opts.index}` : ''}`;
  const q: string[] = [];
  if (opts.maxWidth) q.push(`maxWidth=${Math.round(opts.maxWidth)}`);
  if (opts.maxHeight) q.push(`maxHeight=${Math.round(opts.maxHeight)}`);
  q.push(`quality=${opts.quality ?? 90}`);
  if (opts.tag) q.push(`tag=${encodeURIComponent(opts.tag)}`);
  return `${path}?${q.join('&')}`;
}

/** Profile picture of a user. */
export function userImageUrl(userId: string, tag?: string, maxWidth = 96): string {
  return `${JF_BASE}/Users/${encodeURIComponent(userId)}/Images/Primary?maxWidth=${maxWidth}&quality=90${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`;
}

/** A person's photo (cast & crew). */
export function personImageUrl(personId: string, tag?: string, maxWidth = 160): string {
  return imageUrl(personId, 'Primary', { maxWidth, tag });
}

/** Seerr gives TMDB poster paths. These come from TMDB's CDN (the one non-same-origin image host). */
export function tmdbImage(path: string | undefined, size: 'w185' | 'w342' | 'w500' = 'w342'): string | undefined {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
}
