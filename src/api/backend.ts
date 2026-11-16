/**
 * The ONE seam between the UI and the servers. Pages talk to a `Backend` and never call fetch themselves.
 * Implementations: jellyfin.ts (real), demo.ts (fixtures from design/catalog.json). Pick with createBackend() (index.ts).
 */
import type {
  Episode, ItemsQuery, LibraryView, MediaItem, Paged, PlaybackInfo, PlaybackReport, QuickConnectSession, Season,
  SeerrQuota, SeerrRequest, SeerrResult, Title, User,
} from './types';

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
export interface SeerrApi {
  /** Cheap check (cached after the first call). Never rejects. */
  available(): Promise<boolean>;
  search(query: string, signal?: AbortSignal): Promise<SeerrResult[]>;
  request(input: { mediaType: 'movie' | 'tv'; tmdbId: number; seasons?: number[] }): Promise<SeerrRequest>;
  requests(opts?: { mine?: boolean; take?: number }): Promise<SeerrRequest[]>;
  quota(): Promise<SeerrQuota | null>;
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

  /* ── playback ── */
  playbackInfo(id: string, opts?: { versionId?: string; audioIndex?: number; subtitleIndex?: number; startTicks?: number }): Promise<PlaybackInfo>;
  reportStart(r: PlaybackReport): Promise<void>;
  reportProgress(r: PlaybackReport): Promise<void>;
  reportStopped(r: PlaybackReport): Promise<void>;

  /* ── user actions (writes: only from the app's own UI code paths) ── */
  setPlayed(id: string, played: boolean): Promise<void>;
  setFavourite(id: string, favourite: boolean): Promise<void>;

  readonly seerr: SeerrApi;
}

/** Thrown by signIn / quick connect with a reason the UI can explain. */
export class SignInError extends Error {
  constructor(readonly reason: SignInFailure, message?: string) {
    super(message ?? reason);
    this.name = 'SignInError';
  }
}
