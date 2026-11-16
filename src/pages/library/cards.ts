/** Card / row markup for the library views. Pure string building (html`` escapes), no DOM access, no fetching. */
import { imageUrl } from '../../api';
import type { Collection, Episode, ImageTags, Season, Title } from '../../api/types';
import { phAttrs } from '../../lib/dom';
import { runtime } from '../../lib/format';
import { html, raw, type SafeHtml } from '../../lib/html';
import { ic } from '../common/icons';
import { ticksToSeconds, watchPath } from '../common/watch';
import { laneOf, type Lane, type ViewId } from './filters';

export interface CardCtx {
  /** '#/title/abc' style links */
  href(path: string): string;
  /** seasons per series id (shows only) */
  seasons: ReadonlyMap<string, Season[]>;
  /** next episode to watch per series id (shows only) */
  nextUp: ReadonlyMap<string, Episode>;
  now: number;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const DAY = 864e5;

export function isNew(t: Title, now: number): boolean {
  const d = t.added ? Date.parse(t.added.replace(/(\.\d{3})\d+/, '$1')) : NaN;
  return Number.isFinite(d) && now - d < 14 * DAY;
}

/** Wall view wants a landscape picture; titles without a backdrop fall back to their poster. */
function pic(t: { id: string; imageTags: ImageTags }, kind: 'Primary' | 'Backdrop', w: number): string {
  if (kind === 'Backdrop' && t.imageTags.backdrop) return imageUrl(t.id, 'Backdrop', { maxWidth: w, tag: t.imageTags.backdrop, index: 0 });
  if (kind === 'Backdrop' && t.imageTags.thumb) return imageUrl(t.id, 'Thumb', { maxWidth: w, tag: t.imageTags.thumb });
  return imageUrl(t.id, 'Primary', { maxWidth: kind === 'Backdrop' ? Math.round(w / 2) : w, tag: t.imageTags.primary });
}

const cert = (t: Title): string => t.certification ?? 'Not rated';

export function cardMeta(t: Title, cx: CardCtx): string {
  if (t.kind === 'series') {
    const n = t.seasonCount ?? cx.seasons.get(t.id)?.length ?? 0;
    const lane = laneOf(t, cx.now);
    const left = t.unplayedCount ?? 0;
    return `${n ? plural(n, 'season') + ' · ' : ''}${lane === 'not' ? 'not started' : lane === 'done' ? (t.status === 'Continuing' ? 'caught up' : 'finished') : `${left} to go`}`;
  }
  return `${t.year ?? ''}${t.year && t.runtimeMin ? ' · ' : ''}${t.runtimeMin ? runtime(t.runtimeMin) : ''}`;
}

/** One bar per season: ticks for short seasons, a fill for long ones. Watched = episodes minus unplayed. */
export function seasonStrip(t: Title, cx: CardCtx, labels: boolean): SafeHtml {
  const seasons = (cx.seasons.get(t.id) ?? []).filter(s => s.number > 0 && (s.episodeCount ?? 0) > 0);
  if (!seasons.length) return html``;
  const rows = seasons.map(s => {
    const eps = s.episodeCount ?? 0;
    const w = Math.max(0, Math.min(eps, eps - (s.unplayedCount ?? eps)));
    return { s, eps, w };
  });
  const here = rows.find(r => r.w < r.eps)?.s.number;
  const total = rows.reduce((a, r) => a + r.eps, 0);
  const done = rows.reduce((a, r) => a + r.w, 0);
  const cells = rows.map(({ s, eps, w }) => {
    const isHere = s.number === here;
    const bar = eps > 14
      ? html`<span class="bar fill"><b style="width:${(w / eps) * 100}%"></b></span>`
      : html`<span class="bar">${Array.from({ length: eps }, (_, e) => html`<i class="${e < w ? 'w' : isHere && e === w ? 'cur' : ''}"></i>`)}</span>`;
    const label = isHere || rows.length <= 3 ? `S${s.number} · ${w}/${eps}` : w >= eps ? `S${s.number} done` : `S${s.number}`;
    return html`<div class="ssn${isHere ? ' here' : ''}" style="--eps:${eps}">${bar}${labels ? html`<small>${label}</small>` : ''}</div>`;
  });
  return html`<div class="seasons" role="img" aria-label="${t.name}: ${done} of ${total} episodes watched">${cells}</div>`;
}

export function cardHTML(t: Title, view: ViewId, cx: CardCtx): SafeHtml {
  const isShow = t.kind === 'series';
  const lane = isShow ? laneOf(t, cx.now) : null;
  const wall = view === 'wall';
  const seenTxt = isShow ? '' : t.played ? ', seen' : t.progress ? `, ${Math.round(t.progress.percent)}% watched` : '';
  const fresh = isNew(t, cx.now);
  const next = isShow ? cx.nextUp.get(t.id) : undefined;
  const right = isShow
    ? html`<span class="mini">${lane === 'done' ? 'All watched' : lane === 'not' ? 'Not started' : `${t.unplayedCount ?? 0} left`}</span>
        ${next ? html`<a class="btn sm${lane !== 'not' ? ' primary' : ''}" href="${cx.href(watchPath(next.id))}">${ic('play')}S${next.season} E${next.episode}</a>` : ''}`
    : html`${t.rating != null ? html`<span class="rt">${t.rating.toFixed(1)}</span>` : ''}
        ${t.progress ? html`<span class="mini"><span class="mp"><i style="width:${t.progress.percent}%"></i></span>${runtime(t.progress.remainingMin)} left</span>` : t.played ? html`<span class="chip ok">${ic('check')}Seen</span>` : ''}
        <a class="btn sm" href="${cx.href(watchPath(t.id, { seconds: t.progress ? ticksToSeconds(t.progress.positionTicks) : undefined }))}">${ic('play')}${t.progress ? 'Resume' : 'Play'}</a>`;
  const strip = isShow ? seasonStrip(t, cx, view === 'list') : html``;
  return html`<a class="hit" href="${cx.href(`/title/${t.id}`)}" aria-label="${t.name}${t.year ? `, ${t.year}` : ''}${seenTxt}">
    <span class="art ph" ${raw(phAttrs(t.id, t.name))}><img src="${pic(t, wall ? 'Backdrop' : 'Primary', wall ? 640 : 400)}" alt="" loading="lazy">
      ${fresh || (isShow && lane === 'new') ? html`<span class="bdg l">${fresh ? html`<i>New</i>` : ''}${isShow && lane === 'new' ? html`<i>New episodes</i>` : ''}</span>` : ''}
      ${t.is4k || (!isShow && t.played) ? html`<span class="bdg r">${t.is4k ? html`<i class="k">4K</i>` : ''}${!isShow && t.played ? html`<i class="s" title="Seen">${ic('check')}</i>` : ''}</span>` : ''}
      ${!isShow && t.progress ? html`<span class="pbar"><i style="width:${t.progress.percent}%"></i></span>` : ''}
    </span>
    <span class="cap"><b>${t.name}</b><small>${view === 'list' && !isShow ? `${t.year ?? ''} · ${cert(t)} · ${runtime(t.runtimeMin)} · ${t.genres.slice(0, 3).join(', ')}` : cardMeta(t, cx)}</small>
      ${view === 'list' && t.overview ? html`<span class="ov">${t.overview}</span>` : ''}
      ${isShow && view !== 'wall' ? strip : ''}
    </span>
  </a>${isShow && wall ? seasonStrip(t, cx, false) : ''}<div class="lr">${right}</div>`;
}

export const LANES: ReadonlyArray<[Lane, string, 'bell' | 'play' | 'spark' | 'check', string]> = [
  ['new', 'New episodes', 'bell', 'Something new came out since you last watched.'],
  ['watching', 'Watching', 'play', 'Pick up where you left off.'],
  ['not', 'Not started', 'spark', 'On the server, waiting for you.'],
  ['done', 'Finished', 'check', 'All caught up. Shows still coming out move back up when a new episode lands.'],
];

/** Progress-board card for one show. */
export function showCardHTML(t: Title, cx: CardCtx): SafeHtml {
  const lane = laneOf(t, cx.now);
  const next = cx.nextUp.get(t.id);
  const total = t.episodeCount ?? 0;
  const chip = {
    new: html`<span class="chip hot">${ic('bell')}New episodes</span>`,
    watching: html`<span class="chip num">${t.unplayedCount ?? 0} to go</span>`,
    not: html`<span class="chip mute">${total ? plural(total, 'episode') : 'Not started'}</span>`,
    done: html`<span class="chip ok">${ic('check')}${t.status === 'Continuing' ? 'Caught up' : 'Finished'}</span>`,
  }[lane];
  const line = lane === 'done'
    ? (t.status === 'Continuing' ? 'You are caught up. A new episode shows up here when it lands.' : 'You watched every episode. Fancy it again?')
    : next
      ? html`${lane === 'not' ? 'Starts at' : 'Next'}: <b>Season ${next.season}, Episode ${next.episode}</b>${next.name ? ` · ${next.name}` : ''}${next.runtimeMin ? ` · ${next.runtimeMin} min` : ''}`
      : html`${total ? plural(total, 'episode') : 'Episodes'} on the server, none watched yet.`;
  const act = lane === 'done' || lane === 'not' || !next
    ? html`<a class="btn sm${lane === 'not' ? ' primary' : ''}" href="${cx.href(`/title/${t.id}`)}">${ic('play')}${lane === 'done' ? 'Watch again' : 'Start'}</a>`
    : html`<a class="btn sm primary" href="${cx.href(watchPath(next.id))}">${ic('play')}Play S${next.season} E${next.episode}</a>`;
  const still = next?.imageTags.primary ? imageUrl(next.id, 'Primary', { maxWidth: 480, tag: next.imageTags.primary }) : pic(t, 'Backdrop', 480);
  const logo = t.imageTags.logo ? imageUrl(t.id, 'Logo', { maxWidth: 360, tag: t.imageTags.logo }) : null;
  return html`<a class="th ph${logo ? ' haslogo' : ''}" href="${cx.href(`/title/${t.id}`)}" aria-label="${t.name} details" ${raw(phAttrs(t.id))}>
      <img src="${still}" alt="" loading="lazy">${logo ? html`<img class="lg" src="${logo}" alt="" loading="lazy">` : ''}<span class="ph-t">${t.name}</span></a>
    <div class="bd">
      <div class="tt"><h3><a href="${cx.href(`/title/${t.id}`)}">${t.name}</a></h3>${chip}</div>
      <p class="nx">${line}</p>
      ${seasonStrip(t, cx, true)}
      <div class="acts">${act}<a class="btn sm ghost" href="${cx.href(`/title/${t.id}`)}">Episodes</a></div>
    </div>`;
}

/** A shelf for one collection. Films outside the current mix are dimmed (they stay in the set's order). */
export function shelfHTML(set: Collection, cx: CardCtx, inMix: (t: Title) => boolean): SafeHtml {
  const seen = set.items.filter(m => m.played).length;
  const next = set.items.find(m => !m.played);
  return html`<header><h2>${set.name}</h2>
      <span class="meta"><b>${plural(set.items.length, 'film')}</b> · ${seen} seen</span>
      <span class="sprog" role="img" aria-label="${seen} of ${set.items.length} seen"><i style="width:${(seen / set.items.length) * 100}%"></i></span>
      ${next ? html`<a class="btn sm" href="${cx.href(watchPath(next.id))}">${ic('play')}Next in order: ${next.name}</a>` : html`<span class="chip ok">${ic('check')}All seen</span>`}</header>
    <div class="row">${set.items.map((m, i) => {
      const dim = !inMix(m);
      return html`<div class="lc${m.played ? ' seen' : ''}"${dim ? raw(' style="opacity:.4"') : ''}><a class="hit" href="${cx.href(`/title/${m.id}`)}" aria-label="${i + 1}. ${m.name}${m.year ? `, ${m.year}` : ''}${m.played ? ', seen' : ''}${dim ? ', outside your mix' : ''}">
        <span class="art ph" ${raw(phAttrs(m.id, m.name))}><img src="${pic(m, 'Primary', 300)}" alt="" loading="lazy"><span class="num">${i + 1}</span>
        ${m.played ? html`<span class="bdg r"><i class="s">${ic('check')}</i></span>` : ''}${m.progress ? html`<span class="pbar"><i style="width:${m.progress.percent}%"></i></span>` : ''}</span>
        <span class="cap"><b>${m.name}</b><small>${m.year ?? ''}${m.runtimeMin ? ` · ${runtime(m.runtimeMin)}` : ''}</small></span></a></div>`;
    })}</div>`;
}
