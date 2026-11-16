/**
 * BaseItemDto (Jellyfin) -> Title / Episode / Season / Person / MediaVersion.
 * Only the fields NutFin uses are typed here. Everything is optional because Jellyfin omits empty values.
 */
import { ticksToMinutes } from '../lib/format';
import type {
  AudioTrack, Episode, ImageTags, MediaItem, MediaVersion, Person, Progress, Season, SubtitleTrack, Title,
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
}

const is4kSize = (w?: number, h?: number): boolean => (w ?? 0) >= 3000 || (h ?? 0) >= 2000;

function tags(dto: BaseItemDto): ImageTags {
  const t = dto.ImageTags ?? {};
  const out: ImageTags = {};
  if (t.Primary) out.primary = t.Primary;
  if (t.Logo) out.logo = t.Logo;
  if (t.Thumb) out.thumb = t.Thumb;
  const backdrop = dto.BackdropImageTags?.[0] ?? dto.ParentBackdropImageTags?.[0];
  if (backdrop) out.backdrop = backdrop;
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
    audio: streams.filter(s => s.Type === 'Audio').map(normaliseAudio),
    subtitles: streams.filter(s => s.Type === 'Subtitle').map(normaliseSubtitle),
  };
}

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

