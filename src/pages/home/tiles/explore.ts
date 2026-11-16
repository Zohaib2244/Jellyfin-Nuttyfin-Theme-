/** Explore tab: picks, mood navigation, short on time, On TV this week, "Because you watched", genre rows. */
import type { Episode, MediaItem, Title } from '../../../api/types';
import { clock, runtime } from '../../../lib/format';
import { html, raw, type SafeHtml } from '../../../lib/html';
import { icon } from '../../../ui/icons';
import { nutbot } from '../../../ui/nutbot';
import { slotOf } from '../copy';
import { detailsPath, img, ph, playPath, posterUrl, thumbUrl } from '../art';
import { bestFits, buildWeek, epLabel, firstBusyDay, startOfDay, type FitCandidate, type Week } from '../model';
import { MOODS, moodPicks, whyFor } from '../nutbot/moods';
import { chatFor } from '../nutbot/session';
import { loadInto, quiet, skPosters, skRows, skStrip, tileHead, type TileDef } from '../tile';

/* ── helpers ── */
const metaOf = (t: Title): string => [t.kind === 'series' ? 'Show' : 'Film', t.year, t.kind === 'movie' && t.runtimeMin ? runtime(t.runtimeMin) : ''].filter(Boolean).join(' · ');

/** Poster cards in a horizontal strip. `why` adds a one-line reason under each. */
function posterStrip(list: readonly Title[], why?: (t: Title) => string): SafeHtml {
  return html`<div class="hstrip pstrip">${list.map(t => html`<a class="nli" href="#${detailsPath(t)}" aria-label="${t.name}, ${metaOf(t)}${why ? `. ${why(t)}` : ''}">
    <span class="pst ph" ${ph(t.id, t.name)}>${img(posterUrl(t, 300))}</span>
    <span><b>${t.name}</b><small>${metaOf(t)}</small></span>${why ? html`<span class="whyl">${why(t)}</span>` : ''}</a>`)}</div>`;
}

/** A row of single-choice chips (visible, keyboard-friendly: Tab to the group, arrows move, Enter/Space picks). */
function chips(name: string, items: ReadonlyArray<{ key: string; label: string; icon?: Parameters<typeof icon>[0] }>, selected: string): SafeHtml {
  return html`<div class="mchips" role="radiogroup" aria-label="${name}">${items.map(c => html`<button class="mood" type="button" role="radio" aria-checked="${String(c.key === selected)}" tabindex="${c.key === selected ? 0 : -1}" data-pick="${c.key}">${c.icon ? icon(c.icon) : ''}${c.label}</button>`)}</div>`;
}

/** Arrow keys inside a radiogroup move the selection (and the click handler does the rest). */
function radioKeys(root: HTMLElement, sel: string, signal: AbortSignal): void {
  root.addEventListener('keydown', e => {
    const t = e.target as HTMLElement;
    const group = t.closest('[role="radiogroup"]');
    if (!group || !t.matches(sel)) return;
    const all = Array.from(group.querySelectorAll<HTMLElement>(sel));
    const i = all.indexOf(t);
    let n = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % all.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + all.length) % all.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = all.length - 1;
    if (n < 0) return;
    e.preventDefault();
    all[n]?.click();
  }, { signal });
}

/* ── Picked for you ── */
export const recsTile: TileDef = {
  id: 'recs', tab: 'explore', title: 'Picked for you', icon: 'bot', place: [1, 1, 12, 4], minH: 0,
  mount(host, ctx) {
    loadInto<Title[]>(host, ctx, {
      head: tileHead('recs', 'bot', 'Picked for you'),
      skeleton: skStrip(5),
      padCls: 'sx',
      fetch: async () => (await ctx.data.suggestions()).slice(0, 12),
      render(list) {
        if (!list.length) return null;
        return html`${tileHead('recs', 'bot', 'Picked for you', { count: 'Why each one, in a line' })}
          <div class="hstrip" role="list" aria-labelledby="h-recs">${list.map(t => html`<div class="rc" role="listitem">
            <a class="rcart ph" ${ph(t.id, t.name)} href="#${detailsPath(t)}" aria-label="${t.name}, ${metaOf(t)}. ${whyFor(t)}">${img(thumbUrl(t, 480))}<span class="src">${icon('bot')}For you</span></a>
            <span><b>${t.name}</b><small>${metaOf(t)}</small></span>
            <p class="why">${whyFor(t)}${t.overview ? `. ${t.overview}` : ''}</p>
            <div class="rcacts"><a class="btn primary sm" href="#${playPath(t)}" aria-label="Play ${t.name}">${icon('play')}Play</a><a class="btn sm" href="#${detailsPath(t)}" aria-label="Details for ${t.name}">Details</a></div>
          </div>`)}</div>`;
      },
      empty: html`${tileHead('recs', 'bot', 'Picked for you')}${quiet('No picks yet. Watch a few things and I will start guessing.')}`,
    });
  },
};

/* ── Mood navigation ── */
const MOOD_CHIPS = MOODS.filter(m => ['cosy', 'funny', 'scary', 'kids', 'action', 'mind', 'feel', 'short', 'space', 'mystery', 'true', 'romance'].includes(m.key));

export const moodTile: TileDef = {
  id: 'mood', tab: 'explore', title: 'What are you in the mood for?', icon: 'smile', place: [1, 5, 12, 4], minH: 0,
  mount(host, ctx) {
    let sel = 'cosy';
    const library = (): Promise<Title[]> => ctx.data.get('library', async () => (await ctx.backend.items({ limit: 600, sort: 'rating', descending: true })).items);
    loadInto<Title[]>(host, ctx, {
      head: tileHead('mood', 'smile', 'What are you in the mood for?'),
      skeleton: skStrip(6),
      padCls: 'mood-t',
      fetch: library,
      render(lib) {
        if (!lib.length) return null;
        return paint(lib);
      },
      empty: html`${tileHead('mood', 'smile', 'What are you in the mood for?')}${quiet('The library looks empty right now, so there is nothing to browse yet.')}`,
      after(el, lib) {
        const ac = new AbortController();
        el.addEventListener('click', e => {
          const t = e.target as HTMLElement;
          const b = t.closest<HTMLElement>('[data-pick]');
          if (b?.dataset.pick) {
            sel = b.dataset.pick;
            const wrap = el.querySelector('.pad') as HTMLElement;
            wrap.innerHTML = paint(lib).value;
            wrap.querySelector<HTMLElement>(`[data-pick="${sel}"]`)?.focus({ preventScroll: true });
          } else if (t.closest('[data-ask-bot]')) {
            chatFor(ctx).chat.open({ ask: MOODS.find(m => m.key === sel)?.ask, trigger: t.closest('button') });
          }
        }, { signal: ac.signal });
        radioKeys(el, '[data-pick]', ac.signal);
        return () => ac.abort();
      },
    });
    function paint(lib: Title[]): SafeHtml {
      const mood = MOODS.find(m => m.key === sel) ?? (MOODS[0] as (typeof MOODS)[number]);
      const picks = moodPicks(lib, mood, 14);
      return html`${tileHead('mood', 'smile', 'What are you in the mood for?', { count: picks.length ? `${picks.length} for "${mood.chip.toLowerCase()}"` : '' })}
        <div class="moodrow">${chips('Mood', MOOD_CHIPS.map(m => ({ key: m.key, label: m.chip, icon: m.icon })), sel)}
          <button class="btn sm" type="button" data-ask-bot>${icon('chat')}Ask NutBot</button></div>
        ${picks.length ? posterStrip(picks, t => `${whyFor(t, mood)}`) : quiet(`Nothing in the library fits "${mood.chip.toLowerCase()}" yet. Try another mood.`)}`;
    }
  },
};

/* ── Short on time ── */
const BUDGETS = [15, 45, 90] as const;

export const shortTile: TileDef = {
  id: 'short', tab: 'explore', title: 'Short on time', icon: 'timer', place: [1, 9, 5, 5], minH: 0,
  mount(host, ctx) {
    const slot = slotOf(ctx.now());
    let budget: number = (['breakfast', 'lunch', 'school', 'early'] as string[]).includes(slot) ? 15 : (['late', 'midnight', 'morning'] as string[]).includes(slot) ? 45 : 90;
    const cands = async (): Promise<FitCandidate[]> => {
      const [movies, resume, next] = await Promise.all([ctx.data.unplayedMovies(), ctx.data.resume(), ctx.data.nextUp().catch(() => [] as Episode[])]);
      const out: FitCandidate[] = movies.filter(m => !m.progress).map(item => ({ item, minutes: item.runtimeMin, note: '' }));
      for (const r of resume) if (r.progress && r.progress.remainingMin > 0) out.push({ item: r as Title | Episode, minutes: r.progress.remainingMin, note: 'finish' });
      for (const e of next) if (e.runtimeMin) out.push({ item: e, minutes: e.runtimeMin, note: 'next' });
      return out;
    };
    loadInto<FitCandidate[]>(host, ctx, {
      head: tileHead('short', 'timer', 'Short on time'),
      skeleton: skRows(3),
      padCls: 'sht',
      fetch: cands,
      render: all => paint(all),
      after(el, all) {
        const ac = new AbortController();
        el.addEventListener('click', e => {
          const b = (e.target as Element).closest<HTMLElement>('[data-budget]');
          if (!b) return;
          budget = Number(b.dataset.budget);
          const wrap = el.querySelector('.pad') as HTMLElement;
          wrap.innerHTML = paint(all).value;
          wrap.querySelector<HTMLElement>(`[data-budget="${budget}"]`)?.focus({ preventScroll: true });
        }, { signal: ac.signal });
        radioKeys(el, '[data-budget]', ac.signal);
        return () => ac.abort();
      },
    });
    function paint(all: FitCandidate[]): SafeHtml {
      const now = ctx.now();
      const fits = bestFits(all, budget).slice(0, 4);
      const [f, ...rest] = fits;
      const seg = html`<div class="seg" role="radiogroup" aria-label="How long have you got?">${BUDGETS.map(v => html`<button type="button" role="radio" aria-checked="${String(v === budget)}" tabindex="${v === budget ? 0 : -1}" data-budget="${v}">${v} min</button>`)}</div>`;
      const label = (c: FitCandidate): string => {
        const it = c.item as MediaItem;
        const name = it.kind === 'episode' ? `${it.seriesName} ${epLabel(it)}` : it.name;
        return name;
      };
      const sub = (c: FitCandidate): string => `${c.note === 'finish' ? `${runtime(c.minutes)} left` : runtime(c.minutes)} · ends ${clock(new Date(now.getTime() + c.minutes * 60_000)).replace(' ', '')}`;
      const art = (c: FitCandidate, wide: boolean): string | undefined => (wide ? thumbUrl(c.item as MediaItem, 720) : posterUrl(c.item as MediaItem, 200));
      return html`${tileHead('short', 'timer', 'Short on time', { count: `done by ${clock(new Date(now.getTime() + budget * 60_000))}` })}
        ${seg}
        ${f ? html`<a class="shf ph" ${ph((f.item as MediaItem).id, label(f))} href="#${playPath(f.item)}" aria-label="Play ${label(f)}. ${sub(f)}">
          ${img(art(f, true))}
          <span class="shf-t"><span class="pill">Best fit${budget - f.minutes > 0 ? ` · ${budget - f.minutes} min spare` : ''}</span><b>${label(f)}</b><small>${sub(f)}</small>
          <small class="why">${f.note === 'finish' ? 'You are already part-way through. Finish it.' : f.note === 'next' ? 'The next episode, ready to go.' : whyFor(f.item as Title)}</small></span>
          <span class="pl">${icon('play')}</span></a>` : quiet(`Nothing in the library runs under ${budget} minutes. Try a longer time.`)}
        <div class="shortl">${rest.map(c => html`<a class="row2" href="#${playPath(c.item)}" aria-label="Play ${label(c)}. ${sub(c)}">
          <span class="ph" ${ph((c.item as MediaItem).id, label(c))}>${img(art(c, false))}</span>
          <span class="w"><b>${label(c)}</b><small>${sub(c)}${c.note === 'finish' ? ' · finish it' : ''}</small></span><span class="go">${icon('play')}</span></a>`)}</div>`;
    }
  },
};

/* ── On TV this week ── */
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const tvTile: TileDef = {
  id: 'tv', tab: 'explore', title: 'On TV this week', icon: 'cal', place: [6, 9, 7, 5], minH: 0,
  mount(host, ctx) {
    const head = tileHead('tv', 'cal', 'On TV this week');
    let week: Week;
    let sel = 0;
    loadInto<Week>(host, ctx, {
      head,
      skeleton: skRows(3),
      padCls: 'tv',
      async fetch() {
        // Jellyfin's /Shows/Upcoming only knows shows you follow; when it has nothing, show what arrived this week instead.
        const upcoming = await ctx.data.upcoming().catch(() => [] as Episode[]);
        const hasWeek = buildWeek(upcoming, [], ctx.now().getTime()).mode === 'upcoming';
        const recent = hasWeek ? [] : await ctx.data.recentEpisodes();
        week = buildWeek(upcoming, recent, ctx.now().getTime());
        sel = firstBusyDay(week, ctx.now().getTime());
        return week;
      },
      render: w => paint(w),
      after(el, w) {
        const ac = new AbortController();
        el.addEventListener('click', e => {
          const b = (e.target as Element).closest<HTMLElement>('[data-day]');
          if (!b) return;
          sel = Number(b.dataset.day);
          const wrap = el.querySelector('.pad') as HTMLElement;
          wrap.innerHTML = paint(w).value;
          wrap.querySelector<HTMLElement>(`.day[data-day="${sel}"]`)?.focus({ preventScroll: true });
        }, { signal: ac.signal });
        return () => ac.abort();
      },
    });

    function paint(w: Week): SafeHtml {
      const now = ctx.now();
      const today = startOfDay(now.getTime());
      const aired = w.mode === 'aired';
      const title = aired ? 'Aired this week' : 'On TV this week';
      const day = w.days[sel] ?? (w.days[0] as Week['days'][number]);
      const dd = new Date(day.day);
      const others = w.days.map((d, i) => ({ d, i })).filter(x => x.i !== sel && x.d.episodes.length);
      const when = (e: Episode): SafeHtml => {
        if (aired) return html`${icon('check')}Added ${new Date(e.added ?? e.premiered ?? day.day).toLocaleDateString('en-GB', { weekday: 'long' })}`;
        return e.missing ? html`${icon('clock')}Not here yet · airs ${DAY_LONG[dd.getDay()]}` : html`${icon('check')}Arrived and ready`;
      };
      const item = (e: Episode): SafeHtml => html`<div class="tvi">
        <a class="still ph" ${ph(e.seriesId, e.seriesName)} href="#${detailsPath(e)}" aria-label="${e.seriesName}, ${epLabel(e)}${e.name ? `, ${e.name}` : ''}. Details">${img(thumbUrl(e, 360))}${!e.missing ? html`<span class="pl" aria-hidden="true">${icon('play')}</span>` : ''}</a>
        <div class="w">
          <p class="t1"><b>${e.seriesName}</b>${e.episode === 1 ? html`<span class="tg premiere">${e.season === 1 ? 'Premiere' : 'New season'}</span>` : ''}</p>
          <p class="t2"><em>${epLabel(e)}</em>${e.name ? ` · ${e.name}` : ''}</p>
          ${e.overview ? html`<p class="syn">${e.overview}</p>` : ''}
          <p class="t3">${when(e)}</p>
        </div>
        ${!e.missing ? html`<a class="minibtn go" href="#${playPath(e)}" aria-label="Play ${e.seriesName} ${epLabel(e)}">${icon('play')}Play</a>` : ''}
      </div>`;
      return html`${tileHead('tv', 'cal', title, { count: `${w.total} ${aired ? 'arrived' : 'new episode' + (w.total === 1 ? '' : 's')}` })}
        <div class="days" role="group" aria-label="Pick a day">${w.days.map((d, i) => {
    const dt = new Date(d.day);
    const isToday = d.day === today;
    const c = d.episodes.length;
    return html`<button type="button" class="day ${c ? 'has' : ''} ${isToday ? 'today' : ''}" data-day="${i}" aria-pressed="${String(i === sel)}" aria-label="${isToday ? 'Today, ' : ''}${DAY_LONG[dt.getDay()]} ${dt.getDate()}${c ? `, ${c} ${aired ? 'arrived' : 'new'} episode${c > 1 ? 's' : ''}` : ', nothing new'}"><span>${isToday ? 'Today' : DAY_SHORT[dt.getDay()]}</span><b>${dt.getDate()}</b><i class="pips" aria-hidden="true">${raw('<s></s>'.repeat(Math.min(c, 3)))}</i></button>`;
  })}</div>
        <div class="tvb"><div class="tvday ${day.episodes.length <= 2 ? 'roomy' : ''}">
          <p class="tvh"><b>${day.day === today ? 'Today' : DAY_LONG[dd.getDay()]}</b> · ${dd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}<span>${day.episodes.length ? `${day.episodes.length} ${aired ? 'arrived' : 'new'}` : 'Nothing new'}</span></p>
          ${day.episodes.length ? day.episodes.map(item) : html`<p class="quiet">${nutbot(34, 'look')}<span>Nothing new that day. A good night for a film.</span></p>`}
        </div>
        ${others.length ? html`<div class="tvweek"><p class="tvh"><b>${aired ? 'Earlier this week' : 'Rest of the week'}</b></p>
          <ul>${others.map(({ d, i }) => { const dt = new Date(d.day); return html`<li><button type="button" class="wk" data-day="${i}" aria-label="Show ${DAY_LONG[dt.getDay()]}: ${d.episodes.map(e => e.seriesName).join(', ')}">
            <span class="wd">${DAY_SHORT[dt.getDay()]}<b>${dt.getDate()}</b></span><span class="wn">${d.episodes.slice(0, 2).map(e => html`<span>${e.seriesName}</span>`)}</span><span class="wc">${d.episodes.length}</span></button></li>`; })}</ul></div>` : ''}
        </div>`;
    }
  },
};

/* ── Because you watched ── */
export const becauseTile: TileDef = {
  id: 'because', tab: 'explore', title: 'Because you watched', icon: 'eye', place: [1, 14, 12, 4], minH: 0,
  mount(host, ctx) {
    interface D { seeds: Title[]; sel: string; list: Title[] }
    let seedKey = '';
    loadInto<D>(host, ctx, {
      head: tileHead('because', 'eye', 'Because you watched'),
      skeleton: skPosters(7),
      padCls: 'sx',
      async fetch() {
        const seeds = (await ctx.data.watched().catch(() => [] as Title[])).slice(0, 4);
        if (!seeds.length) return { seeds, sel: '', list: (await ctx.data.unplayedMovies()).slice(0, 12) };
        seedKey = seedKey || (seeds[0] as Title).id;
        return { seeds, sel: seedKey, list: await ctx.data.similar(seedKey) };
      },
      render: d => paint(d),
      after(el) {
        const ac = new AbortController();
        el.addEventListener('click', async e => {
          const b = (e.target as Element).closest<HTMLElement>('[data-pick]');
          if (!b?.dataset.pick) return;
          seedKey = b.dataset.pick;
          const seeds = (await ctx.data.watched()).slice(0, 4);
          const list = await ctx.data.similar(seedKey).catch(() => [] as Title[]);
          if (ctx.signal.aborted) return;
          const wrap = el.querySelector('.pad') as HTMLElement;
          wrap.innerHTML = paint({ seeds, sel: seedKey, list }).value;
          wrap.querySelector<HTMLElement>(`[data-pick="${seedKey}"]`)?.focus({ preventScroll: true });
        }, { signal: ac.signal });
        radioKeys(el, '[data-pick]', ac.signal);
        return () => ac.abort();
      },
    });
    function paint(d: D): SafeHtml {
      if (!d.seeds.length) {
        return html`${tileHead('because', 'eye', 'Top rated here', { count: 'Watch something and this turns personal' })}${posterStrip(d.list)}`;
      }
      const seed = d.seeds.find(s => s.id === d.sel) ?? (d.seeds[0] as Title);
      return html`${tileHead('because', 'eye', `Because you watched ${seed.name}`)}
        ${d.seeds.length > 1 ? chips('Watched recently', d.seeds.map(s => ({ key: s.id, label: s.name })), seed.id) : ''}
        ${d.list.length ? posterStrip(d.list, t => `Like ${seed.name}${t.genres[0] ? `, also ${t.genres[0].toLowerCase()}` : ''}`) : quiet(`Nothing else here is much like ${seed.name} yet.`)}`;
    }
  },
};

/* ── Genre rows ── */
export const genresTile: TileDef = {
  id: 'genres', tab: 'explore', title: 'Top in a genre', icon: 'layers', place: [1, 18, 12, 4], minH: 0,
  mount(host, ctx) {
    interface D { genres: string[]; sel: string; list: Title[] }
    let sel = '';
    loadInto<D>(host, ctx, {
      head: tileHead('genres', 'layers', 'Top in a genre'),
      skeleton: skPosters(7),
      padCls: 'sx',
      async fetch() {
        // genres you lean towards: most common among your picks and what you watched, padded with the usual suspects
        const [sugg, watched] = await Promise.all([ctx.data.suggestions().catch(() => [] as Title[]), ctx.data.watched().catch(() => [] as Title[])]);
        const count = new Map<string, number>();
        for (const t of [...sugg, ...watched]) for (const g of t.genres) count.set(g, (count.get(g) ?? 0) + 1);
        const genres = [...count.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, 5);
        for (const g of ['Comedy', 'Action', 'Drama', 'Adventure', 'Animation']) if (genres.length < 5 && !genres.includes(g)) genres.push(g);
        sel = sel || (genres[0] as string);
        return { genres, sel, list: await ctx.data.genreTop(sel) };
      },
      render: d => paint(d),
      after(el, d0) {
        const ac = new AbortController();
        el.addEventListener('click', async e => {
          const b = (e.target as Element).closest<HTMLElement>('[data-pick]');
          if (!b?.dataset.pick) return;
          sel = b.dataset.pick;
          const list = await ctx.data.genreTop(sel).catch(() => [] as Title[]);
          if (ctx.signal.aborted) return;
          const wrap = el.querySelector('.pad') as HTMLElement;
          wrap.innerHTML = paint({ genres: d0.genres, sel, list }).value;
          wrap.querySelector<HTMLElement>(`[data-pick="${CSS.escape(sel)}"]`)?.focus({ preventScroll: true });
        }, { signal: ac.signal });
        radioKeys(el, '[data-pick]', ac.signal);
        return () => ac.abort();
      },
    });
    function paint(d: D): SafeHtml {
      return html`${tileHead('genres', 'layers', `Best of ${d.sel.toLowerCase()}`, { count: d.list.length ? `${d.list.length} titles, best rated first` : '' })}
        ${chips('Genre', d.genres.map(g => ({ key: g, label: g })), d.sel)}
        ${d.list.length ? posterStrip(d.list.sort((a, b) => Number(a.played) - Number(b.played) || (b.rating ?? 0) - (a.rating ?? 0)), t => (t.played ? 'You have seen this one' : t.rating ? `Rated ${t.rating.toFixed(1)}` : '')) : quiet(`Nothing under ${d.sel} yet.`)}`;
    }
  },
};

