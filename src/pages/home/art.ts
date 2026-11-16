/** Artwork URLs and small markup helpers for Home tiles. Episodes borrow their show's artwork. */
import { imageUrl, tmdbImage } from '../../api';
import type { ImageTags, MediaItem, SeerrRequest, SeerrResult } from '../../api';
import { phAttrs } from '../../lib/dom';
import { esc, raw, type SafeHtml } from '../../lib/html';

type Kind = 'Primary' | 'Backdrop' | 'Logo' | 'Thumb';
const TAG: Record<Kind, keyof ImageTags> = { Primary: 'primary', Backdrop: 'backdrop', Logo: 'logo', Thumb: 'thumb' };

function url(id: string, kind: Kind, tags: ImageTags, w: number): string | undefined {
  const tag = tags[TAG[kind]];
  return tag ? imageUrl(id, kind, { maxWidth: w, tag, quality: 85 }) : undefined;
}

/** Poster (2:3). An episode shows its series poster. */
export function posterUrl(item: MediaItem | { id: string; imageTags: ImageTags }, w = 300): string | undefined {
  if ('kind' in item && item.kind === 'episode') return url(item.seriesId, 'Primary', item.seriesImageTags, w);
  return url(item.id, 'Primary', item.imageTags, w);
}

/** Wide backdrop. An episode shows its series backdrop. */
export function backdropUrl(item: MediaItem, w = 1280): string | undefined {
  if (item.kind === 'episode') return url(item.seriesId, 'Backdrop', item.seriesImageTags, w);
  return item.backdropCount > 0 ? url(item.id, 'Backdrop', item.imageTags, w) : undefined;
}

/** Title logo (transparent PNG), when the item has one. */
export function logoUrl(item: MediaItem, w = 600): string | undefined {
  if (item.kind === 'episode') return url(item.seriesId, 'Logo', item.seriesImageTags, w);
  return url(item.id, 'Logo', item.imageTags, w);
}

/** A 16:9 picture: an episode's own still, else a backdrop, else a landscape thumb. */
export function thumbUrl(item: MediaItem, w = 480): string | undefined {
  if (item.kind === 'episode') return url(item.id, 'Primary', item.imageTags, w) ?? backdropUrl(item, w) ?? url(item.seriesId, 'Thumb', item.seriesImageTags, w);
  return backdropUrl(item, w) ?? url(item.id, 'Thumb', item.imageTags, w) ?? url(item.id, 'Primary', item.imageTags, w);
}

/** Where "Play" and "Details" go. Details of an episode is its show. */
export const playPath = (item: { id: string }): string => `/watch/${encodeURIComponent(item.id)}`;
export const detailsPath = (item: MediaItem | { id: string }): string =>
  `/title/${encodeURIComponent('kind' in item && item.kind === 'episode' ? item.seriesId : item.id)}`;

/** <img> that lazy-loads and hides itself when it fails (the .ph gradient behind it shows through). */
export function img(src: string | undefined, cls = '', alt = ''): SafeHtml {
  return src ? raw(`<img${cls ? ` class="${esc(cls)}"` : ''} src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">`) : raw('');
}

/** Attribute string for a placeholder gradient seeded by `seed` (and labelled). */
export const ph = (seed: string, label = ''): SafeHtml => raw(phAttrs(seed, label));

export function seerrPoster(r: Pick<SeerrResult | SeerrRequest, 'posterPath'>, size: 'w185' | 'w342' | 'w500' = 'w342'): string | undefined {
  return tmdbImage(r.posterPath, size);
}
