/**
 * The ONE seam between the UI and the servers. Pages talk to a `Backend` and never call fetch themselves.
 * Implementations: jellyfin.ts (real), demo.ts (fixtures from design/catalog.json). Pick with createBackend() (index.ts).
 */
import type {
  Collection, Episode, GenreCount, IssueKind, ItemsQuery, LibraryView, MediaItem, Paged, PlaybackInfo, PlaybackReport, QuickConnectSession, Season,
  SeerrQuota, SeerrRequest, SeerrResult, Title, User,
} from './types';

import type { CollectionProgress, LeavingSoon } from './types'; // home
import type { HelperApi, SeerrDeskApi } from './desk-types'; // phase5-7

export type BackendMode = 'jellyfin' | 'demo';

/** Why a sign-in failed, in terms the login page can turn into plain language. */
export type SignInFailure = 'bad-credentials' | 'unreachable' | 'server-error' | 'unknown';

export interface QuickConnectApi {
  /** Is Quick Connect switched on on the server? */
  enabled(): Promise<boolean>;
  /** Ask for a code. Show `code` to the person; they approve it in an already-signed-in Jellyfin app. */
  start(): Promise<QuickConnectSession>;
  /** null = not approved yet (keep polling every ~3 s); a User = signed in (session is stored). */
  poll(session: QuickConnectSession): Promise<User | null>;
}

/** Seerr requests. Every method fails soft: if Seerr is down or the session is missing, `available()` is false
 *  and the lists are empty, so the rest of the app is unaffected. Hide request UI when `available()` is false. */
export interface SeerrApi extends SeerrDeskApi { // phase5-7: SeerrDeskApi = the full Requests page
  /** Cheap check (cached after the first call). Never rejects. */
  available(): Promise<boolean>;
  search(query: string, signal?: AbortSignal): Promise<SeerrResult[]>;
  request(input: { mediaType: 'movie' | 'tv'; tmdbId: number; seasons?: number[] }): Promise<SeerrRequest>;
  requests(opts?: { mine?: boolean; take?: number }): Promise<SeerrRequest[]>;
  quota(): Promise<SeerrQuota | null>;
  // ── library/details: begin ──
  /** "Report a problem". Resolves true when Seerr took it, false when Seerr is unavailable or does not know the title. Never rejects. */
  reportIssue(input: { mediaType: 'movie' | 'tv'; tmdbId: number; kind: IssueKind; message: string }): Promise<boolean>;
  // ── library/details: end ──
}

export interface Backend {
  readonly mode: BackendMode;

  /* ── auth ── */
  /** The signed-in user, or null. Synchronous (restored from storage on startup). */
  currentUser(): User | null;
  /** Rejects with ApiError / SignInError. Stores the session. In demo mode any credentials work. */
  signIn(username: string, password: string): Promise<User>;
  signOut(): Promise<void>;
  /** Fires on sign-in, sign-out and a 401 on any call. Returns an unsubscribe function. */
  onAuthChange(cb: (user: User | null) => void): () => void;
  readonly quickConnect: QuickConnectApi;

  /* ── browsing (read-only) ── */
  views(): Promise<LibraryView[]>;
  /** Partly-watched films and episodes, most recent first. */
  resume(limit?: number): Promise<MediaItem[]>;
  /** The next unwatched episode of each series you follow. */
  nextUp(limit?: number): Promise<Episode[]>;
  /** Recently added films and shows. */
  latest(opts?: { kind?: 'movie' | 'series'; limit?: number }): Promise<Title[]>;
  items(query: ItemsQuery, signal?: AbortSignal): Promise<Paged<Title>>;
  /** Full detail (people, versions). Movies/series come back as Title, episodes as Episode. */
  item(id: string): Promise<MediaItem>;
  similar(id: string, limit?: number): Promise<Title[]>;
  seasons(seriesId: string): Promise<Season[]>;
  /** All episodes of a series, or of one season. */
  episodes(seriesId: string, seasonId?: string): Promise<Episode[]>;
  /** Title search for the top-bar combobox. Pass a signal to cancel superseded searches. */
  search(query: string, limit?: number, signal?: AbortSignal): Promise<Title[]>;

  // ── home: begin ──
  /** Personalised picks (Jellyfin /Items/Suggestions): films and shows, never episodes. */
  suggestions(limit?: number): Promise<Title[]>;
  /** Films/shows added to the library within the last `days` days (default 14), newest first. */
  recentlyAdded(opts?: { kind?: 'movie' | 'series'; days?: number; limit?: number }): Promise<Title[]>;
  /** Episodes added to the library within the last `days` days, newest first ("Aired this week" fallback). */
  recentEpisodes(opts?: { days?: number; limit?: number }): Promise<Episode[]>;
  /** Episodes of shows you follow that air in the next `days` days (Jellyfin /Shows/Upcoming), soonest first. Air date is Episode.premiered. */
  upcoming(opts?: { days?: number; limit?: number }): Promise<Episode[]>;
  /** Box sets with watch progress, most-finished-but-not-done first is left to the UI. */
  boxsets(limit?: number): Promise<CollectionProgress[]>;
  /** Titles the server will remove soon. Usually []: Jellyfin does not know, the helper service (phase 6) will. */
  leavingSoon(): Promise<LeavingSoon[]>;
  // ── home: end ──

  /* ── playback ── */
  playbackInfo(id: string, opts?: { versionId?: string; audioIndex?: number; subtitleIndex?: number; startTicks?: number }): Promise<PlaybackInfo>;
  reportStart(r: PlaybackReport): Promise<void>;
  reportProgress(r: PlaybackReport): Promise<void>;
  reportStopped(r: PlaybackReport): Promise<void>;

  /* ── user actions (writes: only from the app's own UI code paths) ── */
  setPlayed(id: string, played: boolean): Promise<void>;
  setFavourite(id: string, favourite: boolean): Promise<void>;

  readonly seerr: SeerrApi;
  // ── phase5-7: begin ──
  /** The optional helper service (NutBot brain, smart delete, calendar). Feature-detect with helper.available(); it never throws. */
  readonly helper: HelperApi;
  // ── phase5-7: end ──

  // ── library/details: begin ──
  /** Genres in use with how many titles of `kind` have each (for the Genre switches). */
  genres(kind: 'movie' | 'series', signal?: AbortSignal): Promise<GenreCount[]>;
  /** Every season of every series in one call (episode counts + unplayed counts for the progress board). */
  allSeasons(signal?: AbortSignal): Promise<Season[]>;
  /** Box sets with their films in order (Shelves by collection). */
  collections(signal?: AbortSignal): Promise<Collection[]>;
  /** One season's episodes with cast (incl. guest stars) and files: for the episode "Details" panels and guest-star row. */
  episodeDetails(seriesId: string, seasonId: string, signal?: AbortSignal): Promise<Episode[]>;
  /** Owner only. Removes the item from Jellyfin (the library entry and its file). Radarr/Sonarr/torrents are NOT touched. */
  deleteFromJellyfin(id: string): Promise<void>;
  // ── library/details: end ──
}

/** Thrown by signIn / quick connect with a reason the UI can explain. */
export class SignInError extends Error {
  constructor(readonly reason: SignInFailure, message?: string) {
    super(message ?? reason);
    this.name = 'SignInError';
  }
}
