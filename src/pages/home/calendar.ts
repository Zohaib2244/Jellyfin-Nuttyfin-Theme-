/** Turns the helper service's calendar entries into the Episode shape the On TV tile already draws. Pure. */
import type { CalendarEntry } from '../../api/desk-types';
import type { Episode } from '../../api/types';

/** Artwork cache tags are only needed to switch an image URL on; Jellyfin serves the picture whatever the tag says. */
const ART = { primary: 'cal', backdrop: 'cal', thumb: 'cal', logo: 'cal' };

/** Episodes only (film releases are not part of "On TV"). `missing` = not in the library yet; no series id = not in the library at all. */
export function calendarToEpisodes(entries: readonly CalendarEntry[]): Episode[] {
  const out: Episode[] = [];
  for (const e of entries) {
    if (e.kind !== 'episode') continue;
    const seriesId = e.jellyfin?.seriesId ?? '';
    out.push({
      kind: 'episode', id: e.jellyfin?.episodeId ?? `cal-${seriesId || e.title}-${e.season ?? 0}x${e.episode ?? 0}`, name: e.subtitle ?? '', overview: e.overview,
      imageTags: e.jellyfin?.episodeId ? { primary: 'cal' } : {}, backdropCount: 0, played: false, favourite: false, runtimeMin: 0,
      seriesId, seriesName: e.title, season: e.season ?? 0, episode: e.episode ?? 0, premiered: e.airs, missing: !e.inLibrary,
      seriesImageTags: seriesId ? ART : {},
    });
  }
  return out;
}
