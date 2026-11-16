/**
 * BaseItemDto (Jellyfin) -> Title / Episode / Season / Person / MediaVersion.
 * Only the fields Nuttyfin uses are typed here. Everything is optional because Jellyfin omits empty values.
 */
import { ticksToMinutes } from '../lib/format';
import type { CollectionProgress } from './types'; // home
import type {
  AudioTrack, Chapter, Episode, ImageTags, MediaItem, MediaVersion, Person, Progress, Season, SubtitleTrack, Title,
} from './types';

export interface MediaStreamDto {
  Index?: number;
  Type?: string; // Video | Audio | Subtitle
  Codec?: string;
  Language?: string;
  DisplayTitle?: string;
  Title?: string;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsExternal?: boolean;
  Channels?: number;
  Width?: number;
  Height?: number;
  BitRate?: number;
}

export interface MediaSourceDto {
  Id?: string;
  Name?: string;
  Container?: string;
  Size?: number;
  Bitrate?: number;
  MediaStreams?: MediaStreamDto[];
}

export interface PersonDto {
  Id?: string;
  Name?: string;
  Role?: string;
  Type?: string;
  PrimaryImageTag?: string;
}

export interface BaseItemDto {
  Id: string;
  Name?: string;
  Type?: string; // Movie | Series | Episode | Season | ...
  Overview?: string;
  Taglines?: string[];
  Genres?: string[];
  ProductionYear?: number;
  EndDate?: string;
  PremiereDate?: string;
  DateCreated?: string;
  CommunityRating?: number;
  CriticRating?: number;
  OfficialRating?: string;
  RunTimeTicks?: number;
  Status?: string;
  Width?: number;
  Height?: number;
  ChildCount?: number;
  LocationType?: string; // FileSystem | Virtual
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentBackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentLogoImageTag?: string;
  ParentThumbImageTag?: string;
  SeriesPrimaryImageTag?: string;
  SeriesId?: string;
  SeriesName?: string;
  SeasonId?: string;
  IndexNumber?: number;
  IndexNumberEnd?: number;
  ParentIndexNumber?: number;
  UserData?: {
    PlaybackPositionTicks?: number;
    PlayedPercentage?: number;
    UnplayedItemCount?: number;
    IsFavorite?: boolean;
    Played?: boolean;
  };
  Studios?: { Name?: string }[];
  People?: PersonDto[];
  MediaSources?: MediaSourceDto[];
  // ── library/details: begin ──
  ProviderIds?: Record<string, string | null>;
  Tags?: string[];
  RemoteTrailers?: { Url?: string; Name?: string }[];
  Chapters?: { StartPositionTicks?: number; Name?: string; ImageTag?: string }[];
  RecursiveItemCount?: number;
  DateLastMediaAdded?: string;
  // ── library/details: end ──
}

const is4kSize = (w?: number, h?: number): boolean => (w ?? 0) >= 3000 || (h ?? 0) >= 2000;

function tags(dto: BaseItemDto): ImageTags {
  const t = dto.ImageTags ?? {};
  const out: ImageTags = {};
  if (t.Primary) out.primary = t.Primary;
  if (t.Logo) out.logo = t.Logo;
  if (t.Thumb) out.thumb = t.Thumb;
  // an episode's own backdrop only; the series' backdrop lives in Episode.seriesImageTags (it belongs to the series id)
  if (dto.BackdropImageTags?.[0]) out.backdrop = dto.BackdropImageTags[0];
  return out;
}

function progress(dto: BaseItemDto, runtimeMin: number): Progress | undefined {
  const ud = dto.UserData;
  const pos = ud?.PlaybackPositionTicks ?? 0;
  if (!pos || ud?.Played) return undefined;
  const posMin = ticksToMinutes(pos);
  const percent = runtimeMin > 0 ? (posMin / runtimeMin) * 100 : (ud?.PlayedPercentage ?? 0);
  return {
    positionTicks: pos,
    percent: Math.min(100, Math.max(0, Math.round(percent * 10) / 10)),
    remainingMin: Math.max(0, Math.ceil(runtimeMin - posMin)),
  };
}

function normaliseAudio(s: MediaStreamDto): AudioTrack {
  return {
    index: s.Index ?? 0,
    language: s.Language,
    codec: s.Codec,
    channels: s.Channels,
    label: s.DisplayTitle || s.Title || s.Language || `Track ${s.Index ?? 0}`,
    isDefault: !!s.IsDefault,
  };
}

function normaliseSubtitle(s: MediaStreamDto): SubtitleTrack {
  return {
    index: s.Index ?? 0,
    language: s.Language,
    codec: s.Codec,
    label: s.DisplayTitle || s.Title || s.Language || `Subtitle ${s.Index ?? 0}`,
    isDefault: !!s.IsDefault,
    isForced: !!s.IsForced,
    isExternal: !!s.IsExternal,
  };
}

export function normaliseVersion(src: MediaSourceDto): MediaVersion {
  const streams = src.MediaStreams ?? [];
  const video = streams.find(s => s.Type === 'Video');
  return {
    id: src.Id ?? '',
    name: src.Name ?? '',
    container: src.Container,
    width: video?.Width,
    height: video?.Height,
    is4k: is4kSize(video?.Width, video?.Height),
    videoCodec: video?.Codec,
    bitrate: src.Bitrate,
    sizeBytes: src.Size,
    audio: streams.filter(s => s.Type === 'Audio').map(normaliseAudio).map(a => ({ ...a, label: dropUndefined(a.label) })),
    subtitles: nameUnlabelled(streams.filter(s => s.Type === 'Subtitle').map(normaliseSubtitle)),
  };
}

// ── phase4: begin ──
/** Jellyfin writes "Undefined - Default - SUBRIP" for tracks with no language tag. */
export const dropUndefined = (label: string): string => label.replace(/^(undefined|unknown)( - )?/i, '');

/** Tracks without a language (a file can carry 40 of them) become "Subtitles 1 · default", "Subtitles 2 · hearing impaired". */
export function nameUnlabelled(subs: SubtitleTrack[]): SubtitleTrack[] {
  let n = 0;
  return subs.map(s => {
    if (!/^(undefined|unknown)\b/i.test(s.label) && s.language && !/^und$/i.test(s.language)) return s;
    n += 1;
    const rest = dropUndefined(s.label);
    const bits = [`Subtitles ${n}`];
    if (/hearing impaired|sdh/i.test(rest)) bits.push('hearing impaired');
    if (s.isForced || /forced/i.test(rest)) bits.push('forced');
    if (s.isDefault) bits.push('default');
    if (s.isExternal) bits.push('external');
    return { ...s, language: undefined, label: bits.join(' · ') };
  });
}
// ── phase4: end ──

// ── library/details: begin ──
export function normaliseChapters(list: BaseItemDto['Chapters']): Chapter[] {
  return (list ?? []).map((c, i): Chapter => ({
    index: i, name: c.Name || `Chapter ${i + 1}`, startTicks: c.StartPositionTicks ?? 0, imageTag: c.ImageTag || undefined,
  }));
}

/** Detail-only fields shared by Titles and Episodes. Empty collections are left off so list calls stay small. */
function detailExtras(dto: BaseItemDto): Pick<Title, 'chapters' | 'providerIds' | 'tags' | 'remoteTrailers'> {
  const out: Pick<Title, 'chapters' | 'providerIds' | 'tags' | 'remoteTrailers'> = {};
  if (dto.Chapters?.length) out.chapters = normaliseChapters(dto.Chapters);
  const ids: Record<string, string> = {};
  for (const [k, v] of Object.entries(dto.ProviderIds ?? {})) if (v) ids[k] = v;
  if (Object.keys(ids).length) out.providerIds = ids;
  if (dto.Tags?.length) out.tags = dto.Tags;
  const trailers = (dto.RemoteTrailers ?? []).filter(t => !!t.Url).map(t => ({ url: t.Url as string, name: t.Name || undefined }));
  if (trailers.length) out.remoteTrailers = trailers;
  return out;
}
// ── library/details: end ──

export function normalisePerson(p: PersonDto): Person {
  return { id: p.Id ?? '', name: p.Name ?? '', role: p.Role || undefined, type: p.Type ?? 'Actor', imageTag: p.PrimaryImageTag };
}

function normaliseTitle(dto: BaseItemDto): Title {
  const runtimeMin = Math.round(ticksToMinutes(dto.RunTimeTicks));
  const versions = dto.MediaSources?.map(normaliseVersion);
  const is4k = is4kSize(dto.Width, dto.Height) || !!versions?.some(v => v.is4k);
  const kind = dto.Type === 'Series' ? 'series' : 'movie';
  const t: Title = {
    kind,
    id: dto.Id,
    name: dto.Name ?? '',
    overview: dto.Overview || undefined,
    tagline: dto.Taglines?.[0] || undefined,
    imageTags: tags(dto),
    backdropCount: dto.BackdropImageTags?.length ?? 0,
    played: !!dto.UserData?.Played,
    favourite: !!dto.UserData?.IsFavorite,
    runtimeMin,
    added: dto.DateCreated,
    year: dto.ProductionYear,
    endYear: dto.EndDate ? new Date(dto.EndDate).getUTCFullYear() : undefined,
    genres: dto.Genres ?? [],
    rating: dto.CommunityRating,
    criticRating: dto.CriticRating,
    certification: dto.OfficialRating,
    is4k,
    premiered: dto.PremiereDate,
    status: dto.Status,
    studios: (dto.Studios ?? []).map(s => s.Name ?? '').filter(Boolean),
  };
  const prog = progress(dto, runtimeMin);
  if (prog) t.progress = prog;
  if (kind === 'series') {
    t.unplayedCount = dto.UserData?.UnplayedItemCount;
    t.seasonCount = dto.ChildCount;
  }
  if (dto.People) t.people = dto.People.map(normalisePerson);
  if (versions) t.versions = versions;
  // ── library/details: begin ──
  Object.assign(t, detailExtras(dto));
  if (dto.Type && dto.Type !== 'Movie' && dto.Type !== 'Series') t.rawType = dto.Type;
  if (dto.Type === 'Season') { t.seriesId = dto.SeriesId; t.seasonNumber = dto.IndexNumber; }
  if (kind === 'series') {
    t.episodeCount = dto.RecursiveItemCount;
    t.lastEpisodeAdded = dto.DateLastMediaAdded;
  }
  // ── library/details: end ──
  return t;
}

function normaliseEpisode(dto: BaseItemDto): Episode {
  const runtimeMin = Math.round(ticksToMinutes(dto.RunTimeTicks));
  const seriesTags: ImageTags = {};
  if (dto.SeriesPrimaryImageTag) seriesTags.primary = dto.SeriesPrimaryImageTag;
  if (dto.ParentLogoImageTag) seriesTags.logo = dto.ParentLogoImageTag;
  if (dto.ParentThumbImageTag) seriesTags.thumb = dto.ParentThumbImageTag;
  if (dto.ParentBackdropImageTags?.[0]) seriesTags.backdrop = dto.ParentBackdropImageTags[0];
  const e: Episode = {
    kind: 'episode',
    id: dto.Id,
    name: dto.Name ?? '',
    overview: dto.Overview || undefined,
    imageTags: tags(dto),
    backdropCount: dto.ParentBackdropImageTags?.length ?? 0,
    played: !!dto.UserData?.Played,
    favourite: !!dto.UserData?.IsFavorite,
    runtimeMin,
    added: dto.DateCreated,
    seriesId: dto.SeriesId ?? '',
    seriesName: dto.SeriesName ?? '',
    seasonId: dto.SeasonId,
    season: dto.ParentIndexNumber ?? 0,
    episode: dto.IndexNumber ?? 0,
    episodeEnd: dto.IndexNumberEnd && dto.IndexNumberEnd !== dto.IndexNumber ? dto.IndexNumberEnd : undefined,
    premiered: dto.PremiereDate,
    missing: dto.LocationType === 'Virtual',
    seriesImageTags: seriesTags,
  };
  const prog = progress(dto, runtimeMin);
  if (prog) e.progress = prog;
  // ── library/details: begin ──
  if (dto.People) e.people = dto.People.map(normalisePerson);
  if (dto.MediaSources) e.versions = dto.MediaSources.map(normaliseVersion);
  Object.assign(e, detailExtras(dto));
  // ── library/details: end ──
  return e;
}

/** Movie | Series | Episode. Anything else (Season, BoxSet...) is treated as a movie-like Title. */
export function normaliseItem(dto: BaseItemDto): MediaItem {
  return dto.Type === 'Episode' ? normaliseEpisode(dto) : normaliseTitle(dto);
}

export function normaliseSeason(dto: BaseItemDto): Season {
  return {
    id: dto.Id,
    seriesId: dto.SeriesId ?? '',
    name: dto.Name ?? '',
    number: dto.IndexNumber ?? 0,
    episodeCount: dto.ChildCount,
    imageTags: tags(dto),
    played: !!dto.UserData?.Played,
    unplayedCount: dto.UserData?.UnplayedItemCount,
  };
}


// ── home: begin ──
/** A box set plus its films (any order in) -> progress. Films are put in release order; `nextId` is the first unwatched. */
export function normaliseCollection(set: BaseItemDto, children: BaseItemDto[]): CollectionProgress {
  const films = children
    .filter(c => c.Type === undefined || c.Type === 'Movie')
    .map(c => ({ id: c.Id, name: c.Name ?? '', played: !!c.UserData?.Played, imageTags: tags(c), year: c.ProductionYear, at: c.PremiereDate ?? '' }))
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.at.localeCompare(b.at) || a.name.localeCompare(b.name));
  const items = films.map(({ at: _at, ...f }) => f);
  const next = items.find(f => !f.played);
  return { id: set.Id, name: set.Name ?? '', imageTags: tags(set), total: items.length, seen: items.filter(f => f.played).length, items, nextId: next?.id };
}

/** Keep items whose `added` date lies within the last `days` days (undated items are dropped). */
export function withinDays<T extends { added?: string }>(list: readonly T[], days: number, now: number = Date.now()): T[] {
  const cutoff = now - days * 864e5;
  return list.filter(i => {
    const t = i.added ? new Date(i.added.replace(/(\.\d{3})\d+/, '$1')).getTime() : NaN;
    return Number.isFinite(t) && t >= cutoff;
  });
}
// ── home: end ──

// ── phase4: begin ──
/** Best matches first: name starts with the text, then a word starts with it, then it appears anywhere. Server order within a group. */
export function rankSearch<T extends { name: string }>(list: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  const score = (name: string): number => {
    const full = name.toLowerCase();
    const n = full.replace(/^(the|a|an) /, '');
    if (n.startsWith(q) || full.startsWith(q)) return 0;
    if (n.split(/[^\p{L}\p{N}]+/u).some(w => w.startsWith(q))) return 1;
    return 2;
  };
  return list.map((t, i) => ({ t, i, s: score(t.name) })).sort((a, b) => a.s - b.s || a.i - b.i).map(x => x.t);
}
// ── phase4: end ──
