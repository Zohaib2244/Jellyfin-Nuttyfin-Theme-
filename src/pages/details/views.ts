/** Markup for the details page. Pure functions from plain data to SafeHtml; index.ts owns state, fetching and events. */
import { imageUrl, personImageUrl } from '../../api';
import { chapterImageUrl } from '../../api/images';
import type { AudioTrack, Chapter, Episode, MediaVersion, Person, Title } from '../../api/types';
import { phAttrs } from '../../lib/dom';
import { clock, runtime } from '../../lib/format';
import { html, raw, type SafeHtml } from '../../lib/html';
import { ic } from '../common/icons';
import { ticksToSeconds, watchPath } from '../common/watch';
import type { Assessment } from './playability';
import { codecName } from './playability';
import { epLabel, guestStars, type SeasonGroup } from './target';
import { externalLinks } from './trailer';

export interface Ctx {
  href(path: string): string;
}

const MIN = 600_000_000;
const gb = (bytes?: number): string => (bytes ? `${(bytes / 1e9).toFixed(bytes >= 10e9 ? 0 : 1)} GB` : '');
const initials = (n: string): string => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
const hm = (m: number): string => runtime(m);

/* ── pieces shared by hero and the panel ── */
export const audioShort = (a: AudioTrack | undefined): string =>
  a ? a.label.replace(/ - Default$/i, '').replace(/Dolby Digital\+/i, 'Dolby+').replace(/ - /g, ' · ') : 'No sound info';

export interface PlayState {
  version: MediaVersion | undefined;
  audio: AudioTrack | undefined;
  /** -1 = off */
  sub: number;
  remembered: boolean;
  versionsCount: number;
}

export function subLabel(v: MediaVersion | undefined, sub: number): string {
  if (sub < 0) return 'No subtitles';
  return v?.subtitles.find(s => s.index === sub)?.label ?? 'Subtitles';
}

export function chip(a: Assessment): SafeHtml {
  const icon = a.tone === 'ok' ? 'check' : a.tone === 'bad' ? 'warn' : 'info';
  return html`<span class="chip ${a.tone}">${ic(icon)}${a.badge}</span>`;
}

export function howLine(p: PlayState, a: Assessment): SafeHtml {
  const sum = [p.versionsCount > 1 ? p.version?.name : '', audioShort(p.audio), subLabel(p.version, p.sub)].filter(Boolean) as string[];
  return html`${chip(a)}
    <button class="howbtn" type="button" id="howBtn" aria-haspopup="dialog" aria-expanded="false" aria-controls="howPop" aria-label="How it plays: ${sum.join(', ')}. Change">
      ${ic(p.versionsCount > 1 ? 'layers' : 'chat')}<span class="sum">${sum.map((s, i) => html`${i ? html`<i aria-hidden="true">·</i>` : ''}${s}`)}</span>${p.remembered ? html`<span class="mem">${ic('check')}Your usual</span>` : ''}<span class="chg">Change${ic('down')}</span>
    </button>`;
}

export function howPanel(p: PlayState, a: Assessment, o: { owner: boolean; heading: string; hasChapters: boolean }): SafeHtml {
  const v = p.version;
  const multi = (p.versionsCount ?? 0) > 1;
  return html`<div class="wp" role="dialog" aria-modal="false" aria-labelledby="howH">
    <div class="wphead"><h2 id="howH">${ic('tv')}${o.heading}</h2><button class="iconbtn" type="button" data-howdone aria-label="Close">${ic('x')}</button></div>
    <div class="herechip"><span class="lbl">Will it play here?</span>${chip(a)}<p class="hint">${a.why}</p></div>
    ${multi ? html`<div><span class="lbl" id="verlbl">Version</span><div class="vseg" role="radiogroup" aria-labelledby="verlbl" id="verseg"></div></div>` : html`<div><span class="lbl">Version</span><span class="chip plain">${ic('layers')}${v?.name || 'The only copy'} · the only copy</span></div>`}
    <div class="two">
      <label><span class="lbl">Sound</span><span class="select"><select data-pick="audio" id="pickAudio" aria-label="Sound">${(v?.audio ?? []).map(t => html`<option value="${t.index}" ${t.index === p.audio?.index ? raw('selected') : ''}>${audioShort(t)}</option>`)}${v?.audio.length ? '' : html`<option value="-1">No sound info</option>`}</select>${ic('down')}</span></label>
      <label><span class="lbl">Subtitles</span><span class="select"><select data-pick="sub" id="pickSub" aria-label="Subtitles"><option value="-1" ${p.sub < 0 ? raw('selected') : ''}>Off</option>${(v?.subtitles ?? []).map(s => html`<option value="${s.index}" ${s.index === p.sub ? raw('selected') : ''}>${s.label}</option>`)}</select>${ic('down')}</span></label>
    </div>
    ${o.owner ? html`<details class="why"><summary>${ic('info')}Details for the owner</summary><div>${a.tech || 'No technical details'}</div></details>` : ''}
    ${o.hasChapters ? html`<button class="linkbtn" type="button" data-howchap>${ic('list')}Start from a chapter</button>` : ''}
    <p class="saved">${ic('check')}<span>${p.remembered ? 'Remembered for this title on this device.' : 'Change anything and NutFin remembers it for this title on this device.'}</span>${p.remembered ? html`<button class="linkbtn" type="button" data-howreset>Back to the usual</button>` : ''}</p>
  </div>`;
}

export function versionSeg(versions: readonly MediaVersion[], current: string | undefined, assessOf: (v: MediaVersion) => Assessment): SafeHtml {
  return html`${versions.map((v, i) => {
    const a = assessOf(v);
    return html`<button type="button" role="radio" aria-checked="${String(v.id === current)}" tabindex="${v.id === current || (!current && i === 0) ? 0 : -1}" data-ver="${v.id}"><span>${v.name || `Version ${i + 1}`}</span><small>${[gb(v.sizeBytes), a.level === 'direct' ? 'plays here' : a.mayStutter ? 'may stutter' : 'converted'].filter(Boolean).join(' · ')}</small></button>`;
  })}`;
}

/* ── hero ── */
export interface HeroModel {
  title: Title;
  /** series pages play an episode */
  target?: Episode | undefined;
  /** what Play opens: seconds, link, labels */
  playHref: string;
  startOverHref?: string | undefined;
  resume: { percent: number; remainingMin: number } | null;
  /** movie runtime or target runtime */
  runtimeMin: number;
  fav: boolean;
  watched: boolean;
  trailer: boolean;
  owner: boolean;
  clamp: boolean;
  seasonCount: number;
  episodeCount: number;
  versionsCount: number;
  endsAtText: string;
}

export function hero(m: HeroModel, c: Ctx): SafeHtml {
  const t = m.title;
  const series = t.kind === 'series';
  const backdrop = t.imageTags.backdrop ? imageUrl(t.id, 'Backdrop', { maxWidth: 1600, tag: t.imageTags.backdrop, index: 0 }) : null;
  const logo = t.imageTags.logo ? imageUrl(t.id, 'Logo', { maxWidth: 600, tag: t.imageTags.logo }) : null;
  const kick = series
    ? html`Show${m.seasonCount ? html` <span class="chip ok">${ic('check')}${m.seasonCount} ${m.seasonCount === 1 ? 'season' : 'seasons'} here</span>` : ''}${t.status === 'Continuing' ? html` <span class="chip num">${ic('clock')}Still coming out</span>` : ''}`
    : html`Movie <span class="chip ok">${ic('check')}In your library</span>${m.versionsCount > 1 ? html` <span class="chip plain">${ic('layers')}${m.versionsCount} versions</span>` : ''}`;
  const years = series ? `${t.year ?? ''}${t.endYear && t.endYear !== t.year ? ` to ${t.endYear}` : t.status === 'Continuing' ? ' to now' : ''}` : `${t.year ?? ''}`;
  const sizeText = series ? [m.seasonCount ? `${m.seasonCount} ${m.seasonCount === 1 ? 'season' : 'seasons'}` : '', m.episodeCount ? `${m.episodeCount} episodes` : ''].filter(Boolean).join(' · ') : (t.runtimeMin ? hm(t.runtimeMin) : '');
  const verb = m.resume ? 'Resume' : series && m.target && !m.target.played && !m.target.progress && m.target.season === 1 && m.target.episode === 1 ? 'Play' : 'Play';
  const sub = series && m.target ? html`<span class="sub">${epLabel(m.target)}${m.target.name ? ` · ${m.target.name}` : ''}</span>` : '';
  const primary = m.resume
    ? html`<div class="resume"><a class="btn primary big" id="playLink" href="${m.playHref}">${ic('play')}${verb}${sub}</a><div class="bar" aria-hidden="true"><i style="width:${Math.round(m.resume.percent)}%"></i></div></div>
        <span class="endsat"><b>${runtime(m.resume.remainingMin)} left</b> · ${m.endsAtText}</span>
        ${m.startOverHref ? html`<a class="btn sm ghost" id="startOver" href="${m.startOverHref}">${ic('restart')}Start ${series ? 'this episode ' : ''}over</a>` : ''}`
    : html`<a class="btn primary big" id="playLink" href="${m.playHref}">${ic('play')}${verb}${sub}</a>
        ${m.runtimeMin ? html`<span class="endsat"><b>${hm(m.runtimeMin)}</b> · ${m.endsAtText}</span>` : ''}`;
  return html`<section class="dh" aria-labelledby="ttl">
    <div class="bd ph" ${raw(phAttrs(`${t.id}bd`))}>${backdrop ? html`<img src="${backdrop}" alt="" fetchpriority="high">` : ''}</div>
    <div class="in">
      <div class="backrow"><button class="btn sm" type="button" data-back>${ic('back')}Back</button></div>
      <div class="dposter ph" ${raw(phAttrs(t.id, t.name))}><img src="${imageUrl(t.id, 'Primary', { maxWidth: 400, tag: t.imageTags.primary })}" alt=""></div>
      <div class="dmain">
        <div class="kicker">${kick}</div>
        <h1 class="ttl${logo ? ' haslogo' : ''}" id="ttl" tabindex="-1" data-autofocus>${logo ? html`<img class="logo" src="${logo}" alt="" aria-hidden="true">` : ''}<span class="txt">${t.name}</span></h1>
        <div class="facts">
          ${t.rating != null ? html`<span class="rate">${ic('star')}<span class="num">${t.rating.toFixed(1)}</span><span class="sr"> out of 10</span></span>` : ''}
          ${years ? html`<span>${years}</span>` : ''}${sizeText ? html`<span>${sizeText}</span>` : ''}
          ${t.certification ? html`<span class="rt">${t.certification}</span>` : ''}${t.genres.length ? html`<span>${t.genres.join(', ')}</span>` : ''}
        </div>
        ${t.tagline && !t.overview ? html`<p class="tagline">${t.tagline}</p>` : ''}
        ${t.overview ? html`<p class="tagline${m.clamp ? ' clamp' : ''}" id="tagline">${t.overview}</p><button class="morebtn" type="button" id="clampBtn" data-clamp aria-expanded="${String(!m.clamp)}" aria-controls="tagline" ${raw(m.clamp ? '' : '')}>${m.clamp ? 'Read more' : 'Show less'}</button>` : ''}
        <div class="playrow" id="playrow">${primary}</div>
        <div class="howline" id="howline"></div>
        <div class="howpop" id="howPop" hidden></div>
        <div class="acts2">
          ${m.trailer ? html`<button class="btn sm" type="button" data-trailer>${ic('trailer')}Trailer</button>` : ''}
          <button class="btn sm" type="button" data-fav aria-pressed="${String(m.fav)}">${ic(m.fav ? 'heartf' : 'heart')}<span>Favourite</span></button>
          <button class="btn sm" type="button" data-watched aria-pressed="${String(m.watched)}">${ic('checkc')}<span>${m.watched ? 'Watched' : 'Mark watched'}</span></button>
          <div class="morewrap">
            <button class="btn sm" type="button" id="moreBtn" aria-haspopup="menu" aria-expanded="false" aria-controls="moreMenu">${ic('dots')}More</button>
            <div class="menu" id="moreMenu" role="menu" aria-label="More" hidden>
              <button type="button" role="menuitem" data-report>${ic('flag')}Report a problem</button>
              ${m.owner ? html`<hr><div class="who">Only you see this</div><button type="button" role="menuitem" class="danger" data-remove>${ic('trash')}Remove...</button>` : ''}
            </div>
          </div>
        </div>
        <div id="banner" role="status"></div>
      </div>
    </div>
  </section>`;
}

/* ── chapters ── */
export function chaptersSection(id: string, chapters: readonly Chapter[], c: Ctx, o: { versionQuery: { audio?: number; sub?: number; version?: string } }): SafeHtml {
  if (!chapters.length) return html``;
  const t = (ticks: number): string => {
    const s = ticksToSeconds(ticks);
    return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  return html`<section class="section" id="chapters" aria-labelledby="h-ch">
    <div class="sechead"><h2 id="h-ch">Chapters<small>Jump straight to a scene</small></h2>${trnav('chaps')}</div>
    <div class="track chaps" id="chaps" tabindex="-1">${chapters.map((ch, i) => html`<a class="chap" href="${c.href(watchPath(id, { seconds: ticksToSeconds(ch.startTicks), ...o.versionQuery }))}" aria-label="Play from chapter ${i + 1}, ${ch.name}, ${t(ch.startTicks)}">
      <div class="th ph" ${raw(phAttrs(`${id}c${i}`))}>${ch.imageTag ? html`<img loading="lazy" src="${chapterImageUrl(id, ch.index, ch.imageTag, 400)}" alt="">` : ''}<span class="tm">${t(ch.startTicks)}</span></div>
      <b>${ch.name}</b><span class="n">${i === 0 ? 'From the start' : `${hm(Math.round(ch.startTicks / MIN))} in`}</span></a>`)}</div></section>`;
}

function trnav(target: string): SafeHtml {
  return html`<div class="trnav"><button class="iconbtn" type="button" data-scroll="${target}:-1" aria-label="Scroll back">${ic('back')}</button><button class="iconbtn" type="button" data-scroll="${target}:1" aria-label="Scroll forward">${ic('next')}</button></div>`;
}

/* ── seasons & episodes ── */
export function seasonTabs(groups: readonly SeasonGroup[], current: number): SafeHtml {
  return html`${groups.map(g => {
    const all = g.watched >= g.eps.length && g.eps.length > 0;
    const part = g.watched > 0 && !all;
    return html`<button type="button" role="tab" id="stab-${g.number}" aria-selected="${String(g.number === current)}" aria-controls="seasonpanel" tabindex="${g.number === current ? 0 : -1}" data-season="${g.number}">${g.number === 0 ? 'Specials' : `Season ${g.number}`}${all ? html` <span class="chip ok">${ic('check')}Watched</span>` : part ? html` <span class="chip num">${ic('play')}Watching</span>` : ''}</button>`;
  })}`;
}

export function epRow(e: Episode, i: number, o: { now: boolean; open: boolean; owner: boolean; guests: boolean }, c: Ctx): SafeHtml {
  const left = e.progress?.remainingMin;
  const side = e.progress ? html`<span class="left">${runtime(left ?? 0)} left</span>` : e.played ? html`<span class="watched">${ic('check')}Watched</span>` : e.runtimeMin ? html`<span>${e.runtimeMin} min</span>` : html``;
  const guests = (e.people ?? []).filter(p => p.type === 'GuestStar');
  const v = e.versions?.[0];
  const a = v?.audio.find(x => x.isDefault) ?? v?.audio[0];
  const tech = v ? [`${e.runtimeMin} min`, v.videoCodec ? codecName(v.videoCodec) : '', a ? audioShort(a) : '', v.subtitles.length ? `subtitles: ${[...new Set(v.subtitles.map(s => s.language ?? s.label))].slice(0, 4).join(', ')}` : ''].filter(Boolean).join(' · ') : `${e.runtimeMin} min`;
  return html`<div class="ep${o.now ? ' now' : ''}${o.open ? ' open' : ''}" style="--i:${Math.min(i, 12)}" data-ep="${e.id}">
    <a class="hit" href="${c.href(watchPath(e.id, { seconds: e.progress ? ticksToSeconds(e.progress.positionTicks) : undefined }))}" aria-label="${e.progress ? 'Resume' : 'Play'} season ${e.season} episode ${e.episode}, ${e.name}"></a>
    <div class="th ph" ${raw(phAttrs(`ep${e.id}`, `E${e.episode}`))}>${e.imageTags.primary ? html`<img loading="lazy" src="${imageUrl(e.id, 'Primary', { maxWidth: 480, tag: e.imageTags.primary })}" alt="">` : ''}${e.progress ? html`<span class="prog" aria-hidden="true"><i style="width:${e.progress.percent}%"></i></span>` : ''}<span class="pl">${ic('play')}</span></div>
    <div><h3><span>E${e.episode}</span>${e.name}</h3>${e.overview ? html`<p>${e.overview}</p>` : ''}</div>
    <div class="side">${side}<button class="btn sm ghost dtn" type="button" data-epopen="${e.id}" aria-expanded="${String(o.open)}" aria-controls="m${e.id}">${ic(o.open ? 'up' : 'down')}Details</button></div>
    <div class="more" id="m${e.id}" ${o.open ? '' : raw('hidden')}>
      <div>
        ${guests.length ? html`<span class="k">Guest stars</span><div class="gs">${guests.map(p => html`<span class="g"><span class="face ph" ${raw(phAttrs(p.name))}>${p.imageTag ? html`<img loading="lazy" src="${personImageUrl(p.id, p.imageTag, 80)}" alt="">` : ''}</span>${p.name}${p.role ? ` as ${p.role}` : ''}</span>`)}</div>` : o.guests ? '' : html`<span class="k">Loading details...</span>`}
        <div class="tech">${tech}${o.owner && v?.sizeBytes ? ` · ${gb(v.sizeBytes)}` : ''}</div>
      </div>
      <div class="btns"><button class="btn sm" type="button" data-epwatch="${e.id}" aria-pressed="${String(e.played)}">${ic('checkc')}${e.played ? 'Watched' : 'Mark watched'}</button></div>
    </div>
  </div>`;
}

export function episodesSection(o: { groups: readonly SeasonGroup[]; current: number; nextUp: Episode | undefined; owner: boolean; openEp: string | null; detailed: boolean }, c: Ctx): SafeHtml {
  const g = o.groups.find(x => x.number === o.current);
  const eps = g?.eps ?? [];
  const hasNext = !!o.nextUp && o.nextUp.season === o.current;
  const act = !g ? '' : g.watched >= eps.length && eps.length ? `You watched all of ${o.current === 0 ? 'the specials' : `season ${o.current}`}.` : hasNext && o.nextUp ? `Next up: episode ${o.nextUp.episode}.` : `${g.watched} of ${eps.length} watched.`;
  return html`<section class="section" id="episodes" aria-labelledby="h-eps">
    <div class="sechead"><h2 id="h-eps">Episodes<small>${o.groups.length} ${o.groups.length === 1 ? 'season' : 'seasons'} here</small></h2></div>
    <div class="seasontabs" role="tablist" aria-label="Seasons" id="seasontabs">${seasonTabs(o.groups, o.current)}</div>
    <div role="tabpanel" id="seasonpanel" aria-labelledby="stab-${o.current}" tabindex="-1">
      <div class="seasonacts">${hasNext ? html`<h3>More from Season ${o.current}</h3>` : ''}<span>${act}</span></div>
      <div class="eps" id="eps">${eps.map((e, i) => epRow(e, i, { now: o.nextUp?.id === e.id, open: o.openEp === e.id, owner: o.owner, guests: o.detailed }, c))}</div>
    </div></section>`;
}

/* ── people ── */
export function personCard(p: Person, crew: boolean, note?: string): SafeHtml {
  return html`<div class="person${crew ? ' crew' : ''}"><div class="face ph" ${raw(phAttrs(p.name))}><span class="ini" aria-hidden="true">${initials(p.name)}</span>${p.imageTag ? html`<img loading="lazy" src="${personImageUrl(p.id, p.imageTag, 220)}" alt="">` : ''}</div><b>${p.name}</b>${crew ? html`<em>${p.type}</em>` : p.role ? html`<span>as ${p.role}</span>` : ''}${note ? html`<em>${note}</em>` : ''}</div>`;
}

export function castSection(people: readonly Person[]): SafeHtml {
  const cast = people.filter(p => p.type === 'Actor').slice(0, 24);
  const crew = people.filter(p => ['Director', 'Writer', 'Producer', 'Composer'].includes(p.type)).slice(0, 10);
  if (!cast.length && !crew.length) return html``;
  return html`<section class="section" aria-labelledby="h-cast"><div class="sechead"><h2 id="h-cast">Cast &amp; crew</h2>${trnav('cast')}</div>
    <div class="track people" id="cast" role="list">${cast.map(p => html`<div role="listitem">${personCard(p, false)}</div>`)}${crew.map(p => html`<div role="listitem">${personCard(p, true)}</div>`)}</div></section>`;
}

export function guestSection(eps: readonly Episode[], season: number): SafeHtml {
  const guests = guestStars(eps);
  if (!guests.length) return html``;
  return html`<section class="section" aria-labelledby="h-guest"><div class="sechead"><h2 id="h-guest">Guest stars<small>${season === 0 ? 'Specials' : `Season ${season}`}</small></h2>${trnav('guests')}</div>
    <div class="track people" id="guests" role="list">${guests.slice(0, 24).map(g => html`<div role="listitem">${personCard(g.person, false, g.episodes.length > 2 ? `${g.episodes.length} episodes` : g.episodes.map(n => `E${n}`).join(', '))}</div>`)}</div></section>`;
}

/* ── about ── */
export interface AboutModel {
  title: Title;
  people: readonly Person[];
  versions: readonly MediaVersion[];
  owner: boolean;
  ownerName: string;
}

export function aboutSection(m: AboutModel): SafeHtml {
  const t = m.title;
  const by = (type: string): string[] => m.people.filter(p => p.type === type).map(p => p.name);
  const kv: Array<[string, string]> = [
    ['Director', by('Director').join(', ')], ['Writers', [...new Set(by('Writer'))].slice(0, 6).join(', ')],
    ['Studios', t.studios.join(', ')], ['Genres', t.genres.join(', ')],
    [t.kind === 'series' ? 'First aired' : 'Released', t.premiered ? new Date(t.premiered).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''],
    ['Rated', t.certification ?? ''],
  ];
  const rows = kv.filter(([, v]) => v);
  const links = externalLinks(t.providerIds, t.kind);
  const files = m.versions.map(v => ({ name: v.name || 'File', sz: gb(v.sizeBytes), meta: [v.container?.toUpperCase(), codecName(v.videoCodec), v.width && v.height ? `${v.width}x${v.height}` : ''].filter(Boolean).join(' · ') }));
  return html`<section class="section" aria-labelledby="h-about">
    <div class="sechead"><h2 id="h-about">About ${t.name}</h2></div>
    <div class="about">
      <div>
        ${t.tags?.length ? html`<div class="panel"><h3>Tags</h3><ul class="tags">${t.tags.map(x => html`<li>${x}</li>`)}</ul></div>` : ''}
        <div class="panel"><h3>Something wrong with it?</h3><div class="reportline"><span>${m.owner ? "Won't play, wrong subtitles, bad sound? Log it so you remember to fix it." : `Won't play, wrong subtitles, bad sound? Tell ${m.ownerName} in two taps.`}</span><button class="btn sm" type="button" data-report>${ic('flag')}Report a problem</button></div></div>
      </div>
      <div>
        <div class="panel"><h3>Details</h3>${rows.length ? html`<dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>` : html`<p class="note">Nothing more is known about this one yet.</p>`}
          ${links.length ? html`<div class="extlinks">${links.map(l => html`<a class="btn sm" href="${l.url}" target="_blank" rel="noopener noreferrer">${l.name}${ic('ext')}<span class="sr"> (opens in a new tab)</span></a>`)}</div>` : ''}</div>
      </div>
    </div>
    ${m.owner ? html`<div class="panel ownercard" aria-labelledby="h-own"><h3 id="h-own">${ic('server')}On the server <span class="chip">${ic('lock')}Only you see this</span></h3>
      <div class="oc"><ul class="files">${files.length ? files.map(f => html`<li><b>${f.name}</b><span class="sz">${f.sz}</span><code>${f.meta}</code></li>`) : html`<li><b>${t.kind === 'series' ? 'Episodes on the server' : 'No file details'}</b></li>`}</ul>
      <div><div class="ownfacts"><span>${ic('drive')}Removing here deletes the file from the media drive. Radarr, Sonarr and qBittorrent are not touched yet.</span></div>
      <div><button class="btn sm danger out" type="button" data-remove>${ic('trash')}Remove...</button></div></div></div></div>` : ''}</section>`;
}

export function footnote(): SafeHtml {
  return html`<aside class="foot" aria-labelledby="h-how"><div>${ic('server')}</div><div>
    <h3 id="h-how">How Remove works (only you see this)</h3>
    <p>For now, Remove asks Jellyfin to delete the title and its file. Removing it from Radarr or Sonarr, and deleting the release in qBittorrent, needs a small NutFin helper service on the server that holds those keys. Until that exists those choices are shown but switched off.</p>
  </div></aside>`;
}

/* ── more like this ── */
export function moreSection(items: readonly Title[], series: boolean, c: Ctx, current: Title): SafeHtml {
  if (!items.length) return html``;
  return html`<section class="section" aria-labelledby="h-more"><div class="sechead"><h2 id="h-more">More like this<small>${series ? 'Other shows here with the same feel' : 'Other films here you might like'}</small></h2>${trnav('more')}</div>
    <div class="track" id="more" role="list">${items.map(x => {
      const g = x.genres.find(z => current.genres.includes(z)) ?? x.genres[0] ?? '';
      return html`<a class="pc" role="listitem" href="${c.href(`/title/${x.id}`)}" aria-label="${x.name}${x.year ? `, ${x.year}` : ''}${g ? `, ${g}` : ''}"><div class="art ph" ${raw(phAttrs(x.id, x.name))}><img loading="lazy" src="${imageUrl(x.id, 'Primary', { maxWidth: 320, tag: x.imageTags.primary })}" alt=""></div><div class="t">${x.name}</div><div class="s">${[x.year, g].filter(Boolean).join(' · ')}</div></a>`;
    })}</div></section>`;
}

export const endsAtText = (remaining: number): string => `ends at ${clock(new Date(Date.now() + remaining * 60_000))}`;
