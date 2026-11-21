/** Newly Added tab: what's new summary, new films rail, new shows, "On the way" (Seerr requests that are coming). */
import type { DeskRequest, TitleFacts } from '../../../api/desk-types';
import type { Episode, Title } from '../../../api/types';
import { parseDate, relativeTime } from '../../../lib/format';
import { html, type SafeHtml } from '../../../lib/html';
import { store } from '../../../lib/storage';
import { icon } from '../../../ui/icons';
import { nutbot } from '../../../ui/nutbot';
import { detailsPath, img, ph, posterUrl, seerrPoster, thumbUrl } from '../art';
import { buildWeek, comingRows, epLabel, freshSince, nextLastSeen, seenGate, showNewBanner, type ComingRow, type Fresh } from '../model';
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

/* ── "new since your last visit" banner: only exists when something IS new ── */
interface HeroData extends Fresh { recent: Title[]; asked: number; fetchedAt: number }

export const newHeroTile: TileDef = {
  id: 'newhero', tab: 'new', title: "What's new", icon: 'spark', place: [1, 1, 12, 3], minH: 0,
  mount(host, ctx) {
    // absent until we know something is new, so "all caught up" never flashes a banner and leaves no gap
    ctx.setPresent('newhero', false);
    const markSeen = (fetchedAt: number): void => store.set(LAST_SEEN, nextLastSeen(store.get<number>(LAST_SEEN, 0), fetchedAt));
    loadInto<HeroData>(host, ctx, {
      head: tileHead('newhero', 'spark', "What's new"),
      skeleton: skRows(3),
      padCls: 'nh',
      async fetch() {
        const fetchedAt = ctx.now().getTime();
        const [recent, reqs] = await Promise.all([ctx.data.latest(), ctx.data.myDeskRequests()]);
        const f = freshSince(recent, store.get<number>(LAST_SEEN, 0), fetchedAt);
        const freshIds = new Set(f.fresh.map(t => t.id));
        return { ...f, recent, fetchedAt, asked: reqs.filter(r => r.jellyfinId && freshIds.has(r.jellyfinId)).length };
      },
      render(d) {
        if (!showNewBanner(d)) {
          // nothing new: nothing unseen is skipped by moving the last visit up to this look
          markSeen(d.fetchedAt);
          return null;
        }
        ctx.setPresent('newhero', true);
        return paint(d, ctx.user?.name ?? '');
      },
      after(el, d) {
        // The last visit moves up only once the banner has really been on screen for a moment, so a refresh (or a
        // quick tab switch) before that keeps the news for next time.
        const gate = seenGate(() => markSeen(d.fetchedAt));
        const io = typeof IntersectionObserver === 'undefined' ? null
          : new IntersectionObserver(es => gate.visible(es.some(e => e.isIntersecting && e.intersectionRatio >= 0.5)), { threshold: [0, 0.5] });
        io?.observe(el);
        if (!io) gate.visible(true);
        const ac = new AbortController();
        el.addEventListener('click', e => {
          if (!(e.target as Element).closest('[data-hero-dismiss]')) return;
          markSeen(d.fetchedAt);
          ctx.setPresent('newhero', false);
          document.getElementById('home-panel')?.focus({ preventScroll: true });
        }, { signal: ac.signal });
        return () => { ac.abort(); io?.disconnect(); gate.dispose(); };
      },
    });

    function paint(d: HeroData, name: string): SafeHtml {
      const now = ctx.now();
      const n = d.fresh.length;
      const films = d.fresh.filter(t => t.kind === 'movie').length;
      const newestFilm = d.fresh.find(t => t.kind === 'movie' && t.runtimeMin);
      const since = d.first ? 'Added in the last week' : `Added since your last visit, ${relativeTime(new Date(d.since), now).toLowerCase()}`;
      const heading = d.first ? `${WORDS[n] ?? n} new ${n === 1 ? 'arrival' : 'arrivals'} this week${name ? `, ${name}` : ''}` : `${WORDS[n] ?? n} new ${n === 1 ? 'thing' : 'things'} since you were last here${name ? `, ${name}` : ''}`;
      const fan = d.fresh.filter(t => posterUrl(t)).slice(0, 5);
      return html`<button class="iconbtn nh-dismiss" type="button" data-hero-dismiss aria-label="Dismiss: I have seen what is new" title="Dismiss">${icon('x')}</button><div class="nhl">
          <p class="nhwho">${icon('spark')}${since}</p>
          <h2 class="nhh" id="h-newhero">${heading}</h2>
          <p class="nhchips"><span class="nhc">${icon('film')}${films} ${films === 1 ? 'film' : 'films'}</span><span class="nhc">${icon('tv')}${n - films} ${n - films === 1 ? 'show' : 'shows'}</span>${d.asked ? html`<span class="nhc">${icon('ask')}${d.asked} you asked for</span>` : ''}</p>
          ${newestFilm ? html`<p class="nhbot">${nutbot(40, 'happy')}<span class="bubble">${newestFilm.name} is ${runtime(newestFilm.runtimeMin)}. Start now and you are done by ${clock(new Date(now.getTime() + newestFilm.runtimeMin * 60_000))}.</span></p>` : ''}
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
      empty: html`${quiet('No new shows lately. A new series will appear here when it lands.')}`,
    });
  },
};

/* ── on the way: this person's own open requests, with the Requests page's honest stages ── */
const SHOW = 4;
const factKey = (r: Pick<DeskRequest, 'mediaType' | 'tmdbId'>): string => `${r.mediaType}:${r.tmdbId}`;
const PILL_ICON = { downloading: 'dl', approved: 'clock', requested: 'hourglass', available: 'layers' } as const;

export const comingTile: TileDef = {
  id: 'coming', tab: 'new', title: 'On the way', icon: 'dl', place: [9, 8, 4, 4], minH: 0,
  mount(host, ctx) {
    interface D { rows: ComingRow[]; total: number; eps: Episode[]; on: boolean }
    loadInto<D>(host, ctx, {
      head: tileHead('coming', 'dl', 'On the way'),
      skeleton: skRows(4),
      padCls: 'cm',
      async fetch() {
        const now = ctx.now();
        const [on, list, upcoming] = await Promise.all([ctx.data.seerrOn(), ctx.data.myDeskRequests(), ctx.data.upcoming().catch(() => [] as Episode[])]);
        const seerr = ctx.backend.seerr;
        const facts = new Map<string, TitleFacts | null>();
        for (const r of list) facts.set(factKey(r), seerr.cachedFacts(r.mediaType, r.tmdbId));
        const factsOf = (r: DeskRequest): TitleFacts | null => facts.get(factKey(r)) ?? null;
        let rows = comingRows(list, factsOf, now);
        // Release dates and titles for the rows on show only: at most one (cached) Seerr lookup per shown row.
        const asked = new Set<string>();
        for (let round = 0; round < 2; round++) {
          const need = rows.slice(0, SHOW).map(x => x.r).filter(r => !factsOf(r) && !asked.has(factKey(r)));
          if (!need.length) break;
          await Promise.all(need.map(async r => {
            asked.add(factKey(r));
            facts.set(factKey(r), await seerr.titleFacts(r.mediaType, r.tmdbId, ctx.signal).catch(() => null));
          }));
          rows = comingRows(list, factsOf, now);
        }
        const shown = rows.slice(0, SHOW).map(x => {
          const f = factsOf(x.r);
          return f ? { ...x, r: { ...x.r, title: x.r.title || f.title, posterPath: x.r.posterPath ?? f.posterPath, year: x.r.year ?? f.year } } : x;
        });
        const week = buildWeek(upcoming, [], now.getTime());
        const eps = week.mode === 'upcoming' ? week.days.flatMap(d => d.episodes).filter(e => new Date(e.premiered ?? 0).getTime() > now.getTime()).slice(0, 3) : [];
        return { rows: shown, total: rows.length, eps, on };
      },
      render(d) {
        const more = d.total > d.rows.length ? `${d.total} open` : '';
        const head = html`<h2 class="tl" id="h-coming">${icon('dl')}On the way${more ? html`<span class="cnt">${more}</span>` : ''}<span class="more"><a class="linkbtn" href="#/requests">See all requests${icon('next')}</a></span></h2>`;
        if (!d.on) return html`${head}${quiet('Requests are not available right now. Films and shows you ask for will show up here.')}`;
        const room = SHOW - d.rows.length;
        const eps = room >= 2 && d.eps.length ? html`<h3 class="cmh">New episodes later this week</h3>
          <ul class="cml">${d.eps.slice(0, room - 1).map(e => html`<li><a class="cmr ep" href="#${detailsPath(e)}" aria-label="${e.seriesName}, ${epLabel(e)}, ${dayName(e)}">
            <span class="ph" ${ph(e.seriesId, e.seriesName)}>${img(posterUrl(e, 200))}</span>
            <span class="w"><b>${e.seriesName}</b><small>${epLabel(e)} · ${dayName(e)}</small></span>${icon('cal')}</a></li>`)}</ul>` : '';
        if (!d.rows.length) {
          return html`${head}<div class="cmempty">${nutbot(44, 'look')}<p><b>Nothing on the way</b><span>Ask for a film or show and you can follow it here until it lands.</span></p>
            <a class="btn sm" href="#/requests/discover">${icon('search')}Find something on Discover</a></div>${eps}`;
        }
        return html`${head}<ul class="cml">${d.rows.map(x => row(x))}</ul>${eps}`;
      },
    });

    function row(x: ComingRow): SafeHtml {
      const r = x.r;
      const name = r.title || (r.mediaType === 'tv' ? 'A show you asked for' : 'A film you asked for');
      const pct = x.stage.id === 'downloading' ? x.stage.percent : undefined;
      return html`<li><a class="cmr ${x.pill.cls}" href="#/requests?show=${x.stage.group === 'pending' ? 'pending' : 'onway'}" aria-label="${name}: ${x.line}">
        <span class="ph" ${ph(`tmdb${r.tmdbId}`, name)}>${img(seerrPoster(r, 'w185'))}</span>
        <span class="w"><b>${name}</b><small>${x.line}</small>
          ${pct != null ? html`<span class="prog" role="progressbar" aria-label="${name} downloaded" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></span>` : ''}</span>
        <span class="chip ${x.pill.cls}" aria-hidden="true">${icon(PILL_ICON[x.pill.cls])}${x.pill.text}</span></a></li>`;
    }
  },
};

const dayName = (e: Episode): string => new Date(e.premiered ?? 0).toLocaleDateString('en-GB', { weekday: 'long' });
