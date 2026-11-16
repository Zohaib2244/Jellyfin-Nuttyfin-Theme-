/** Newly Added tab: what's new summary, new films rail, new shows, "On the way" (Seerr requests that are coming). */
import type { Episode, SeerrRequest, Title } from '../../../api/types';
import { parseDate, relativeTime } from '../../../lib/format';
import { html, type SafeHtml } from '../../../lib/html';
import { store } from '../../../lib/storage';
import { icon } from '../../../ui/icons';
import { nutbot } from '../../../ui/nutbot';
import { detailsPath, img, ph, playPath, posterUrl, seerrPoster, thumbUrl } from '../art';
import { buildWeek, epLabel, requestLabel } from '../model';
import { flowDots, statusChip } from '../requestsPanel';
import { loadInto, quiet, skPosters, skRows, skStrip, tileHead, type TileDef } from '../tile';
import { clock, runtime } from '../../../lib/format';

const LAST_SEEN = 'home.lastSeen';
const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const ago = (t: Title, now: Date): string => (t.added ? relativeTime(t.added, now) : '');
const badge = (t: Title, now: Date): SafeHtml => {
  const d = parseDate(t.added);
  if (!d) return html``;
  const days = (now.getTime() - d.getTime()) / 864e5;
  return html`<span class="pday${days > 7 ? ' old' : ''}">${days < 1.5 ? 'New' : ago(t, now)}</span>`;
};

/* ── summary hero ── */
export const newHeroTile: TileDef = {
  id: 'newhero', tab: 'new', title: "What's new", icon: 'spark', place: [1, 1, 12, 3], minH: 0,
  mount(host, ctx) {
    interface D { fresh: Title[]; recent: Title[]; asked: number; coming: number; since: number; first: boolean }
    // Leaving Home counts as having seen what is new; "Mark all as seen" does it right now.
    ctx.onDispose(() => store.set(LAST_SEEN, Date.now()));
    loadInto<D>(host, ctx, {
      head: tileHead('newhero', 'spark', "What's new"),
      skeleton: skRows(3),
      padCls: 'nh',
      async fetch() {
        const stored = store.get<number>(LAST_SEEN, 0);
        const since = stored || ctx.now().getTime() - 7 * 864e5;
        const [recent, reqs] = await Promise.all([ctx.data.recent(60), ctx.data.myRequests()]);
        const fresh = recent.filter(t => { const d = parseDate(t.added); return !!d && d.getTime() > since; });
        return { fresh, recent, asked: reqs.filter(r => r.state === 'available').length, coming: reqs.filter(r => r.state === 'downloading' || r.state === 'approved').length, since, first: !stored };
      },
      render(d) {
        if (!d.recent.length) return null;
        const name = ctx.user?.name ?? '';
        return paint(d, name);
      },
      empty: html`${tileHead('newhero', 'spark', "What's new")}${quiet('Nothing has been added lately. When films and shows land, this page tells you.')}`,
      after(el, d) {
        const ac = new AbortController();
        el.addEventListener('click', e => {
          if (!(e.target as Element).closest('[data-seen]')) return;
          store.set(LAST_SEEN, ctx.now().getTime());
          const wrap = el.querySelector('.pad') as HTMLElement;
          wrap.innerHTML = paint({ ...d, fresh: [], first: false, since: ctx.now().getTime() }, ctx.user?.name ?? '').value;
          wrap.querySelector<HTMLElement>('.nhh')?.setAttribute('tabindex', '-1');
          wrap.querySelector<HTMLElement>('.nhh')?.focus({ preventScroll: true });
          ctx.shell.toast('All caught up', 'check');
        }, { signal: ac.signal });
        return () => ac.abort();
      },
    });

    function paint(d: { fresh: Title[]; recent: Title[]; asked: number; coming: number; since: number; first: boolean }, name: string): SafeHtml {
      const now = ctx.now();
      const list = d.fresh.length ? d.fresh : d.recent.filter(t => { const x = parseDate(t.added); return !!x && now.getTime() - x.getTime() < 7 * 864e5; });
      const n = d.fresh.length;
      const films = d.fresh.filter(t => t.kind === 'movie').length;
      const newestFilm = (d.fresh.length ? d.fresh : d.recent).find(t => t.kind === 'movie' && t.runtimeMin);
      const since = d.first ? 'Added in the last week' : `Added since your last visit, ${relativeTime(new Date(d.since), now).toLowerCase()}`;
      const heading = n ? `${WORDS[n] ?? n} new ${n === 1 ? 'thing' : 'things'} since you were last here${name ? `, ${name}` : ''}` : `You are all caught up${name ? `, ${name}` : ''}`;
      const fan = (d.fresh.length ? d.fresh : d.recent).filter(t => posterUrl(t)).slice(0, 5);
      return html`<div class="nhl">
          <p class="nhwho">${icon('spark')}${n ? since : 'Nothing added since your last visit. Here is the last week.'}</p>
          <h2 class="nhh" id="h-newhero">${heading}</h2>
          <p class="nhchips"><span class="nhc">${icon('film')}${films} ${films === 1 ? 'film' : 'films'}</span><span class="nhc">${icon('tv')}${n - films} ${n - films === 1 ? 'show' : 'shows'}</span><span class="nhc">${icon('ask')}${d.asked} you asked for</span><span class="nhc">${icon('dl')}${d.coming} almost here</span></p>
          ${newestFilm ? html`<p class="nhbot">${nutbot(40, 'happy')}<span class="bubble">${newestFilm.name} is ${runtime(newestFilm.runtimeMin)}. Start now and you are done by ${clock(new Date(now.getTime() + newestFilm.runtimeMin * 60_000))}.</span></p>` : ''}
          <div class="row">${list[0] ? html`<a class="btn primary sm" href="#${playPath(list[0])}">${icon('spark')}Start with the newest</a>` : ''}${n ? html`<button class="btn sm" type="button" data-seen>${icon('check')}Mark all as seen</button>` : ''}</div>
        </div>
        <div class="nhfan" aria-hidden="true">${fan.map(t => html`<span class="ph" ${ph(t.id, t.name)}>${img(posterUrl(t, 300))}</span>`)}</div>`;
    }
  },
};

/* ── new films ── */
export const newFilmsTile: TileDef = {
  id: 'newfilms', tab: 'new', title: 'New films', icon: 'film', place: [1, 4, 12, 4], minH: 0,
  mount(host, ctx) {
    let f: 'week' | 'all' = 'all';
    loadInto<Title[]>(host, ctx, {
      head: tileHead('newfilms', 'film', 'New films'),
      skeleton: skPosters(7),
      padCls: 'nl',
      fetch: () => ctx.data.recent(60, 'movie'),
      render: all => paint(all),
      after(el, all) {
        const ac = new AbortController();
        el.addEventListener('click', e => {
          const b = (e.target as Element).closest<HTMLElement>('[data-nlf]');
          if (!b) return;
          f = b.dataset.nlf === 'week' ? 'week' : 'all';
          const wrap = el.querySelector('.pad') as HTMLElement;
          wrap.innerHTML = paint(all).value;
          wrap.querySelector<HTMLElement>(`[data-nlf="${f}"]`)?.focus({ preventScroll: true });
        }, { signal: ac.signal });
        el.addEventListener('keydown', e => {
          const t = e.target as HTMLElement;
          if (!t.matches('[data-nlf]') || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
          e.preventDefault();
          (t.parentElement?.querySelector<HTMLElement>(`[data-nlf]:not([data-nlf="${t.dataset.nlf}"])`))?.click();
        }, { signal: ac.signal });
        return () => ac.abort();
      },
    });
    function paint(all: Title[]): SafeHtml {
      const now = ctx.now();
      const list = all.filter(t => { const d = parseDate(t.added); return !!d && now.getTime() - d.getTime() <= (f === 'week' ? 7 : 60) * 864e5; }).slice(0, 14);
      return html`<div class="nlhead">${tileHead('newfilms', 'film', 'New films', { count: `${list.length} ${f === 'week' ? 'added this week' : 'in the last two months'}` })}
          <div class="seg" role="radiogroup" aria-label="Show">${(['week', 'all'] as const).map(k => html`<button type="button" role="radio" aria-checked="${String(k === f)}" tabindex="${k === f ? 0 : -1}" data-nlf="${k}">${k === 'week' ? 'This week' : 'Last 2 months'}</button>`)}</div></div>
        ${list.length ? html`<div class="nlrail">${list.map(t => html`<a class="nli" href="#${detailsPath(t)}" aria-label="${t.name}, film, ${t.year ?? ''}, added ${ago(t, now).toLowerCase()}">
          <span class="pst ph" ${ph(t.id, t.name)}>${badge(t, now)}${img(posterUrl(t, 300))}</span>
          <span><b>${t.name}</b><small>${[t.year, t.genres[0], t.runtimeMin ? runtime(t.runtimeMin) : ''].filter(Boolean).join(' · ')}</small></span></a>`)}</div>` : quiet('No new films in that time.')}
        <div class="nlfoot"><span>Newest first</span><a class="linkbtn" href="#/movies">Browse all movies${icon('next')}</a></div>`;
    }
  },
};

/* ── new shows ── */
export const newShowsTile: TileDef = {
  id: 'newshows', tab: 'new', title: 'New shows', icon: 'tv', place: [1, 8, 8, 4], minH: 0,
  mount(host, ctx) {
    loadInto<Title[]>(host, ctx, {
      head: tileHead('newshows', 'tv', 'New shows'),
      skeleton: skStrip(3),
      padCls: 'nl',
      fetch: () => ctx.data.recent(60, 'series'),
      render(list) {
        const now = ctx.now();
        const shows = list.slice(0, 4);
        if (!shows.length) return null;
        return html`${tileHead('newshows', 'tv', 'New shows', { count: `${shows.length} in the last two months` })}
          <div class="nsgrid">${shows.map(t => html`<a class="nsc ph" ${ph(t.id, t.name)} href="#${detailsPath(t)}" aria-label="${t.name}, show, ${t.year ?? ''}, added ${ago(t, now).toLowerCase()}">
            ${img(thumbUrl(t, 500))}<span class="nsshade"></span>${badge(t, now)}
            <span class="nst"><b>${t.name}</b><small>${[t.year, t.genres[0], t.seasonCount ? `${t.seasonCount} season${t.seasonCount > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</small></span></a>`)}</div>
          <div class="nlfoot"><span>Newest first</span><a class="linkbtn" href="#/shows">Browse all shows${icon('next')}</a></div>`;
      },
      empty: html`${tileHead('newshows', 'tv', 'New shows')}${quiet('No new shows lately. A new series will appear here when it lands.')}`,
    });
  },
};

/* ── on the way ── */
export const comingTile: TileDef = {
  id: 'coming', tab: 'new', title: 'On the way', icon: 'dl', place: [9, 8, 4, 4], minH: 0,
  mount(host, ctx) {
    interface D { reqs: SeerrRequest[]; eps: Episode[]; on: boolean }
    loadInto<D>(host, ctx, {
      head: tileHead('coming', 'dl', 'On the way'),
      skeleton: skRows(4),
      padCls: 'cm',
      async fetch() {
        const [reqs, upcoming, on] = await Promise.all([ctx.data.myRequests(), ctx.data.upcoming().catch(() => [] as Episode[]), ctx.data.seerrOn()]);
        const week = buildWeek(upcoming, [], ctx.now().getTime());
        const eps = week.mode === 'upcoming' ? week.days.flatMap(d => d.episodes).filter(e => new Date(e.premiered ?? 0).getTime() > ctx.now().getTime()).slice(0, 2) : [];
        const order = ['downloading', 'approved', 'requested'];
        const coming = reqs.filter(r => order.includes(r.state)).sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state)).slice(0, 3);
        return { reqs: coming, eps, on };
      },
      render(d) {
        return html`${tileHead('coming', 'dl', 'On the way')}
          <p class="sub">Films and shows arriving</p>
          ${d.reqs.length ? d.reqs.map(r => html`<div class="row2"><span class="ph" ${ph(`tmdb${r.tmdbId}`, r.title)}>${img(seerrPoster(r, 'w185'))}</span>
            <span class="w"><b>${r.title || 'Requested title'}</b><small>${r.state === 'downloading' ? (r.progress != null ? `Processing · ${r.progress}%` : 'Processing') : r.state === 'approved' ? 'Approved · starts soon' : requestLabel(r.state).label}</small>
              ${r.state === 'downloading' && r.progress != null ? html`<span class="prog" role="progressbar" aria-label="${r.title} downloaded" aria-valuenow="${r.progress}" aria-valuemin="0" aria-valuemax="100"><i style="width:${r.progress}%"></i></span>` : flowDots(r.state)}</span>
            <span class="cs">${statusChip(r.state)}</span></div>`)
    : quiet(d.on ? 'Nothing downloading right now. Ask for something in Requests.' : 'Requests are not available right now.')}
          ${d.eps.length ? html`<p class="sub">New episodes later this week</p>${d.eps.map(e => html`<a class="row2" href="#${detailsPath(e)}"><span class="ph" ${ph(e.seriesId, e.seriesName)}>${img(posterUrl(e, 200))}</span>
            <span class="w"><b>${e.seriesName}</b><small>${epLabel(e)} · ${new Date(e.premiered ?? 0).toLocaleDateString('en-GB', { weekday: 'long' })}</small></span>${icon('cal')}</a>`)}` : ''}`;
      },
    });
  },
};
