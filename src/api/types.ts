/**
 * Small normalised shapes the UI works with. Jellyfin's BaseItemDto / Seerr JSON are converted ONCE at the edge
 * (normalise.ts, seerr.ts); pages never see raw server JSON.
 */

export type ImageType = 'Primary' | 'Backdrop' | 'Logo' | 'Thumb' | 'Banner';

/** Cache tags per image kind. A missing key means the item has no such image (don't render an <img> for it). */
export interface ImageTags {
  primary?: string;
  backdrop?: string;
  logo?: string;
  thumb?: string;
}

/** Resume position. `percent` is 0-100. */
export interface Progress {
  positionTicks: number;
  percent: number;
  /** minutes left, rounded up */
  remainingMin: number;
}

interface MediaBase {
  id: string;
  name: string;
  overview?: string;
  imageTags: ImageTags;
  /** Backdrop images available (index 0..n-1 for imageUrl type 'Backdrop'). */
  backdropCount: number;
  played: boolean;
  favourite: boolean;
  /** Present only when partly watched. */
  progress?: Progress;
  /** Whole-title runtime; for a series this is 0 (use episodes). */
  runtimeMin: number;
  /** ISO date the item was added to the library. */
  added?: string;
}

export interface Title extends MediaBase {
  kind: 'movie' | 'series';
  year?: number;
  endYear?: number;
  genres: string[];
  /** Community rating 0-10 (TMDB style) */
  rating?: number;
  /** Rotten-tomatoes style 0-100 */
  criticRating?: number;
  /** "PG-13", "TV-MA" ... */
  certification?: string;
  tagline?: string;
  is4k: boolean;
  premiered?: string;
  /** Series only: 'Continuing' | 'Ended' */
  status?: string;
  studios: string[];
  /** Series only: episodes not yet watched */
  unplayedCount?: number;
  seasonCount?: number;
  /** Detail calls only */
  people?: Person[];
  /** Detail calls only: one entry per file/version */
  versions?: MediaVersion[];
}

export interface Episode extends MediaBase {
  kind: 'episode';
  seriesId: string;
  seriesName: string;
  seasonId?: string;
  season: number;
  episode: number;
  /** Set for double episodes (S01E01-E02) */
  episodeEnd?: number;
  premiered?: string;
  /** Not in the library (Jellyfin "virtual"/missing episode) */
  missing: boolean;
  /** The parent series' artwork, for hero/backdrop use */
  seriesImageTags: ImageTags;
}

export type MediaItem = Title | Episode;

export interface Season {
  id: string;
  seriesId: string;
  name: string;
  /** 0 = Specials */
  number: number;
  episodeCount?: number;
  imageTags: ImageTags;
  played: boolean;
  unplayedCount?: number;
}

export interface Person {
  id: string;
  name: string;
  /** character for actors */
  role?: string;
  /** 'Actor' | 'Director' | 'Writer' | ... */
  type: string;
  imageTag?: string;
}

export interface AudioTrack {
  index: number;
  language?: string;
  codec?: string;
  channels?: number;
  /** "English - Dolby Digital - 5.1 - Default" */
  label: string;
  isDefault: boolean;
}

export interface SubtitleTrack {
  index: number;
  language?: string;
  codec?: string;
  label: string;
  isDefault: boolean;
  isForced: boolean;
  isExternal: boolean;
}

/** One playable file of a title. */
export interface MediaVersion {
  id: string;
  name: string;
  container?: string;
  width?: number;
  height?: number;
  is4k: boolean;
  videoCodec?: string;
  bitrate?: number;
  sizeBytes?: number;
  audio: AudioTrack[];
  subtitles: SubtitleTrack[];
}

/** How the server proposes to play something in this browser. */
export interface PlaybackInfo {
  itemId: string;
  mediaSourceId: string;
  playSessionId?: string;
  /** Absolute-path URL for <video src> (direct) or hls.js (transcode). Empty in demo mode. */
  url: string;
  method: 'direct' | 'directStream' | 'transcode' | 'unavailable';
  /** Plain-language badge text: "Plays perfectly here" / "Will be converted" */
  badge: string;
  isHls: boolean;
  version: MediaVersion;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
  startPositionTicks: number;
}

export interface PlaybackReport {
  itemId: string;
  mediaSourceId: string;
  playSessionId?: string;
  positionTicks: number;
  isPaused?: boolean;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
}

export interface User {
  id: string;
  name: string;
  isAdmin: boolean;
  /** Profile picture cache tag (use userImageUrl) */
  avatarTag?: string;
}

export interface QuickConnectSession {
  secret: string;
  /** 6-digit code the person types into an already-signed-in Jellyfin app */
  code: string;
}

export interface LibraryView {
  id: string;
  name: string;
  /** 'movies' | 'tvshows' | ... */
  collection: string;
}

export type SortKey = 'name' | 'added' | 'rating' | 'year' | 'runtime' | 'played' | 'random';

export interface ItemsQuery {
  kind?: 'movie' | 'series' | 'episode';
  search?: string;
  genres?: string[];
  years?: number[];
  sort?: SortKey;
  descending?: boolean;
  start?: number;
  limit?: number;
  parentId?: string;
  played?: boolean;
  favourite?: boolean;
  /** Only things with watch progress (Continue watching style) */
  resumable?: boolean;
  ids?: string[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  start: number;
}

/* ── Seerr ── */
export type RequestState = 'requested' | 'approved' | 'downloading' | 'available' | 'declined';

export interface SeerrResult {
  /** TMDB id */
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year?: number;
  overview?: string;
  /** TMDB poster path ("/abc.jpg"); build a URL with tmdbImage() */
  posterPath?: string;
  /** Already requested / available, if Seerr knows */
  state?: RequestState;
}

export interface SeerrRequest {
  id: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year?: number;
  posterPath?: string;
  state: RequestState;
  requestedBy: string;
  createdAt: string;
  /** TV: requested season numbers */
  seasons?: number[];
  /** home: download progress 0-100 while state is 'downloading' (when Seerr/Radarr/Sonarr report it) */
  progress?: number;
}

export interface SeerrQuota {
  movie: QuotaLine;
  tv: QuotaLine;
}
export interface QuotaLine {
  /** null = unlimited */
  limit: number | null;
  used: number;
  remaining: number | null;
  days: number | null;
}

// ── home: begin ──
/** One film inside a box set. */
export interface CollectionItem {
  id: string;
  name: string;
  played: boolean;
  imageTags: ImageTags;
  year?: number;
}

/** A box set ("collection") with how much of it you have watched. `items` are in release order. */
export interface CollectionProgress {
  id: string;
  name: string;
  imageTags: ImageTags;
  total: number;
  seen: number;
  items: CollectionItem[];
  /** First unwatched film, in release order. */
  nextId?: string;
}

/** Something the server will remove soon (Jellyfin does not know this itself; the helper service will). */
export interface LeavingSoon {
  id: string;
  name: string;
  kind: 'movie' | 'series';
  imageTags: ImageTags;
  /** ISO date it goes */
  leavesOn: string;
  /** plain-language reason, e.g. "Makes room on the movies drive" */
  reason: string;
}
// ── home: end ──
