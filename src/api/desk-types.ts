/**
 * Types for the full Requests page ("the desk") and the helper service (phase 5-7). Kept out of types.ts so the
 * shared file only gets a handful of marked additions.
 */
import type { IssueKind, RequestState, SeerrRequest } from './types';

/* ── Seerr desk ── */
export interface SeerrPerms {
  isAdmin: boolean;
  /** may send requests at all */
  request: boolean;
  requestMovie: boolean;
  requestTv: boolean;
  request4k: boolean;
  /** may choose a quality profile */
  advanced: boolean;
  /** may approve / decline / cancel other people's requests */
  manageRequests: boolean;
  createIssues: boolean;
  viewIssues: boolean;
  manageIssues: boolean;
}

export interface QualityProfile { id: number; name: string }

export interface SeerrCapabilities {
  /** Seerr's own user id (not the Jellyfin id) */
  userId: number;
  perms: SeerrPerms;
  /** 4K requests are switched on in Seerr AND this person may use them */
  fourK: { movie: boolean; tv: boolean };
  /** Present only when this person may choose a quality (Seerr "advanced requests") */
  profiles: { movie?: { list: QualityProfile[]; defaultId?: number }; tv?: { list: QualityProfile[]; defaultId?: number } };
  /** Season 0 (specials) can be requested */
  specials: boolean;
  /** Seerr lets people pick seasons (when false a show is always asked for whole) */
  partialRequests: boolean;
}

export interface SeasonInfo {
  number: number;
  name: string;
  episodes: number;
  airDate?: string;
  /** requested / approved / downloading / available when Seerr knows; undefined = not asked for yet */
  state?: RequestState;
}

/** Everything the "Ask for it" sheet shows about one film or show. */
export interface SeerrDetail {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year?: number;
  overview?: string;
  tagline?: string;
  posterPath?: string;
  backdropPath?: string;
  /** 0-10 */
  rating?: number;
  runtimeMin?: number;
  genres: string[];
  state?: RequestState;
  /** Some seasons are in the library, not all */
  partial: boolean;
  /** Item id in Jellyfin when it is in the library */
  jellyfinId?: string;
  seasons: SeasonInfo[];
  /** Open request of the signed-in person for this title, if any (so it can be cancelled) */
  myRequestId?: number;
}

export type RequestScope = 'mine' | 'all';
/** What the filter chips mean: waiting = not approved yet, onway = approved/downloading, ready = in the library. */
export type RequestFilter = 'all' | 'waiting' | 'onway' | 'ready' | 'declined';

export interface RequestsPage { items: SeerrRequest[]; total: number }

export type IssueStatus = 'open' | 'resolved';
export interface SeerrIssue {
  id: number;
  kind: IssueKind;
  status: IssueStatus;
  message: string;
  createdAt: string;
  createdBy: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath?: string;
  jellyfinId?: string;
  /** replies from the owner */
  replies: number;
}

export type RequestFailureReason = 'permission' | 'quota' | 'duplicate' | 'no-seasons' | 'blocked' | 'unavailable' | 'unknown';
export interface RequestFailureInfo { reason: RequestFailureReason; message: string }

export interface DeskRequestInput {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  /** TV: season numbers, or 'all' */
  seasons?: number[] | 'all';
  is4k?: boolean;
  profileId?: number;
}

/** What the Requests page needs on top of the basic SeerrApi. Every method fails soft unless it says it throws. */
export interface SeerrDeskApi {
  /** Permissions, 4K, quality profiles. null when Seerr is not available. */
  capabilities(): Promise<SeerrCapabilities | null>;
  /** One film/show with season states. null when Seerr does not know it. */
  detail(mediaType: 'movie' | 'tv', tmdbId: number, signal?: AbortSignal): Promise<SeerrDetail | null>;
  /** "Popular right now" for the empty search box. */
  discover(signal?: AbortSignal): Promise<import('./types').SeerrResult[]>;
  /** A page of requests with server-side paging. */
  requestsPage(opts: { scope: RequestScope; filter: RequestFilter; take: number; skip: number }): Promise<RequestsPage>;
  /** Throws ApiError (use explainRequestError). */
  createRequest(input: DeskRequestInput): Promise<SeerrRequest>;
  /** Cancel (own pending, or anyone's with the manage permission). Throws ApiError. */
  cancelRequest(id: number): Promise<void>;
  /** Admin: say yes / no. Throw ApiError. */
  approveRequest(id: number): Promise<void>;
  declineRequest(id: number): Promise<void>;
  /** Problem reports ("issues") of this person, newest first. */
  issues(opts?: { mine?: boolean; take?: number }): Promise<SeerrIssue[]>;
}

/* ── Helper service ── */
export interface HelperHealth { ok: boolean; version: string; features: { calendar: boolean; nutbot: boolean; delete: boolean; deleteEnabled: boolean } }

export interface CalendarEntry {
  kind: 'episode' | 'movie';
  /** ISO timestamp the thing airs / is released */
  airs: string;
  title: string;
  /** episode name or release type */
  subtitle?: string;
  season?: number;
  episode?: number;
  /** Jellyfin ids for artwork, present when the show/film is in the library */
  jellyfin?: { seriesId?: string; episodeId?: string; movieId?: string };
  /** Jellyfin has the file already */
  inLibrary: boolean;
  /** Sonarr/Radarr has it downloaded */
  downloaded: boolean;
  overview?: string;
}

export interface NutbotPick { kind: 'library' | 'request'; id?: string; tmdbId?: number; mediaType?: 'movie' | 'tv'; title: string; why: string }
export interface NutbotReply { reply: string; picks: NutbotPick[] }
export interface NutbotTurn { role: 'user' | 'assistant'; text: string }

export type DeleteMode = 'jellyfin-only' | 'arr-and-files' | 'arr-and-files-and-torrent';

export interface DeletePlanModeInfo {
  /** bytes that would really come back on the drive */
  freedBytes: number;
  /** bytes of library files that are removed from the library but stay on disk because something else still links to them */
  keptBytes: number;
  steps: string[];
}

export interface DeletePlan {
  jellyfinId: string;
  title: string;
  kind: 'movie' | 'series';
  /** Radarr/Sonarr entry, when one matches */
  arr: { app: 'radarr' | 'sonarr'; id: number; title: string; path: string } | null;
  files: { count: number; bytes: number };
  torrents: Array<{ hash: string; name: string; state: string; seeding: boolean; ratio: number; sizeBytes: number; sharedFiles: number }>;
  /** the library file(s) are hardlinked to a torrent that is still around */
  hardlinked: boolean;
  modes: Record<DeleteMode, DeletePlanModeInfo>;
  /** plain-language notes ("The torrent is still seeding...") */
  notes: string[];
  /** false when the helper could not read the media drive (the numbers are then 0) */
  measured: boolean;
  deleteEnabled: boolean;
}

export interface DeleteStepResult { step: 'torrent' | 'arr' | 'jellyfin'; label: string; status: 'done' | 'failed' | 'skipped' | 'dry-run'; detail?: string }
export interface DeleteResult { dryRun: boolean; mode: DeleteMode; ok: boolean; steps: DeleteStepResult[]; freedBytes?: number }

/** The helper service client. Everything degrades silently: `available()` is false when the service is not there. */
export interface HelperApi {
  available(): Promise<boolean>;
  health(): Promise<HelperHealth | null>;
  /** "On TV this week". [] when the helper or Sonarr is unavailable. */
  calendar(days?: number): Promise<CalendarEntry[]>;
  /** Remote NutBot brain. Rejects when the CLI is unavailable so the caller can fall back to the local brain. */
  chat(messages: NutbotTurn[], context: Record<string, unknown>, signal?: AbortSignal): Promise<NutbotReply>;
  /** Admin only. */
  deletePlan(jellyfinId: string): Promise<DeletePlan>;
  deleteExecute(input: { jellyfinId: string; mode: DeleteMode; confirm: string; dryRun?: boolean }): Promise<DeleteResult>;
}
