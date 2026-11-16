/**
 * Per-visit data cache for Home. Several tiles need the same thing (resume feeds the hero AND the compact list),
 * so each call is made once and shared. A failed call is forgotten, so a tile's "Try again" really asks again.
 */
import type { Backend } from '../../api';
import type { CollectionProgress, Episode, MediaItem, SeerrRequest, Title } from '../../api/types';
import { calendarToEpisodes } from './calendar'; // phase5-7
import { limitConcurrency } from '../../lib/concurrency';
import { byClosestToDone, seasonProgress, startedCollections, type SeasonProgress } from './model';

export class HomeData {
  private readonly memo = new Map<string, Promise<unknown>>();
  private readonly episodeQueue = limitConcurrency(2);

  constructor(readonly backend: Backend) {}

  /** Memoised async call. Rejections are not kept. */
  get<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let p = this.memo.get(key) as Promise<T> | undefined;
    if (!p) {
      p = fn().catch((e: unknown) => { this.memo.delete(key); throw e; });
      this.memo.set(key, p);
    }
    return p;
  }

  forget(...keys: string[]): void { for (const k of keys) this.memo.delete(k); }

  /* ── Jellyfin ── */
  resume(): Promise<MediaItem[]> { return this.get('resume', () => this.backend.resume(20)); }
  nextUp(): Promise<Episode[]> { return this.get('nextUp', () => this.backend.nextUp(12)); }
  suggestions(): Promise<Title[]> { return this.get('suggestions', () => this.backend.suggestions(24)); }
  recent(days: number, kind?: 'movie' | 'series'): Promise<Title[]> {
    return this.get(`recent:${days}:${kind ?? ''}`, () => this.backend.recentlyAdded({ days, kind, limit: 60 }));
  }
  recentEpisodes(): Promise<Episode[]> { return this.get('recentEpisodes', () => this.backend.recentEpisodes({ days: 7, limit: 50 })); }
  /** The helper's Sonarr calendar when the helper is there (it knows shows that are not in the library yet), else Jellyfin's own list. */
  upcoming(): Promise<Episode[]> {
    return this.get('upcoming', async () => { // phase5-7
      const cal = calendarToEpisodes(await this.backend.helper.calendar(7));
      return cal.length ? cal : this.backend.upcoming({ days: 7, limit: 40 });
    });
  }
  /** Unwatched films, best rated first (one call: the runtime filter happens in the browser). */
  unplayedMovies(): Promise<Title[]> {
    return this.get('unplayedMovies', async () => (await this.backend.items({ kind: 'movie', played: false, sort: 'rating', descending: true, limit: 300 })).items);
  }
  /** The last few things you finished, newest first (seeds for "Because you watched"). */
  watched(): Promise<Title[]> {
    return this.get('watched', async () => (await this.backend.items({ played: true, sort: 'played', descending: true, limit: 8 })).items);
  }
  similar(id: string): Promise<Title[]> { return this.get(`similar:${id}`, () => this.backend.similar(id, 14)); }
  genreTop(genre: string): Promise<Title[]> {
    return this.get(`genre:${genre}`, async () => (await this.backend.items({ genres: [genre], sort: 'rating', descending: true, limit: 16 })).items);
  }
  boxsets(): Promise<CollectionProgress[]> { return this.get('boxsets', () => this.backend.boxsets(8)); }
  episodes(seriesId: string, seasonId?: string): Promise<Episode[]> {
    return this.get(`episodes:${seriesId}:${seasonId ?? ''}`, () => this.episodeQueue(() => this.backend.episodes(seriesId, seasonId)));
  }
  collectionsInProgress(): Promise<CollectionProgress[]> { return this.boxsets().then(startedCollections); }

  /** Seasons you have started but not finished, closest to done first (one episodes call per show, at most `limit`). */
  seasonsInProgress(limit = 4): Promise<SeasonProgress[]> {
    return this.get('seasons', async () => {
      const next = (await this.nextUp()).slice(0, 8);
      const out = await Promise.all(next.map(async e => {
        try { return seasonProgress(e, await this.episodes(e.seriesId, e.seasonId)); } catch { return null; }
      }));
      return out.filter((s): s is SeasonProgress => !!s).sort(byClosestToDone).slice(0, limit);
    });
  }

  /* ── Seerr (never rejects: fails soft to "off" / empty) ── */
  seerrOn(): Promise<boolean> { return this.get('seerrOn', () => this.backend.seerr.available().catch(() => false)); }
  /** The rail badge needs states, never thirty separate title lookups. */
  requestSummary(): Promise<SeerrRequest[]> {
    return this.get('requestSummary', async () => ((await this.seerrOn()) ? this.backend.seerr.requests({ mine: true, take: 30, includeTitles: false }).catch(() => []) : []));
  }
  myRequests(): Promise<SeerrRequest[]> {
    return this.get('myRequests', async () => ((await this.seerrOn()) ? this.backend.seerr.requests({ mine: true, take: 30 }).catch(() => []) : []));
  }
  allRequests(): Promise<SeerrRequest[]> {
    return this.get('allRequests', async () => ((await this.seerrOn()) ? this.backend.seerr.requests({ take: 30 }).catch(() => []) : []));
  }
}
