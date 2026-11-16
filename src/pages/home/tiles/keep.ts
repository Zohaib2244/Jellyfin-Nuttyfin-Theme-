/** Keep watching hero: the thing you were in the middle of, with an "Up next for you" rail that swaps the hero. */
import type { MediaItem, Title } from '../../../api/types';
import { clock, runtime } from '../../../lib/format';
import { html, type SafeHtml } from '../../../lib/html';
import { icon } from '../../../ui/icons';
import { watchLogos } from '../../../lib/logo';
import { backdropUrl, detailsPath, img, logoUrl, ph, playPath, thumbUrl } from '../art';
import { epLabel, leftText, watchRows, type WatchRow } from '../model';
import { whyFor } from '../nutbot/moods';
import { loadInto, skArt, tileHead, type TileDef } from '../tile';

interface HeroData { base: WatchRow | null; recs: Title[] }

export const keepTile: TileDef = {
  id: 'keep', tab: 'home', title: 'Keep watching', icon: 'clock', place: [6, 1, 7, 5], minH: 560, cls: 'onimg',
  mount(host, ctx) {
    let rec = -1; // -1 = the thing you were watching, else an index into the picks
    let recommendations: Promise<Title[]> | null = null;
    let busy = new Set<string>();
    loadInto<HeroData>(host, ctx, {
      head: tileHead('keep', 'clock', 'Keep watching'),
      skeleton: skArt(),
      bare: true,
      async fetch() {
        recommendations = ctx.data.suggestions().catch(() => [] as Title[]);
        const resume = await ctx.data.resume();
        const rows = watchRows(resume, []);
        const base = rows[0] ?? null;
        busy = new Set(rows.map(r => (r.item.kind === 'episode' ? r.item.seriesId : r.item.id)));
        // Resume is usable immediately. Optional recommendations must not hold the Play button hostage.
        const recs = base ? [] : (await recommendations).filter(t => !busy.has(t.id)).slice(0, 3);
        return { base, recs };
      },
      render(d) {
        if (!d.base && !d.recs.length) return null;
        if (!d.base) rec = 0;
        return paint(d, rec, ctx.now());
      },
      empty: html`<p class="quiet">Nothing to pick up yet. Start something from Explore and it will wait for you here.</p>`,
      after(el, d) {
        const ac = new AbortController();
        const sig = { signal: ac.signal };
        const ambient = (): void => { const cur = rec >= 0 ? d.recs[rec] : d.base?.item; ctx.shell.setAmbient((cur && backdropUrl(cur, 1280)) ?? null); };
        ambient();
        // a show with no logo image: its name is shown as text instead
        watchLogos(el, img => img.closest('.ktitle')?.classList.add('nologo'), sig);
        el.addEventListener('click', e => {
          const b = (e.target as Element).closest<HTMLElement>('[data-hero]');
          if (!b) return;
          const want = Number(b.dataset.hero);
          rec = want === rec ? -1 : want;
          if (rec < 0 && !d.base) rec = 0;
          el.innerHTML = paint(d, rec, ctx.now()).value;
          el.querySelector<HTMLElement>(`[data-hero="${rec}"]`)?.focus({ preventScroll: true });
          ambient();
        }, sig);
        if (d.base) void recommendations?.then(list => {
          if (ac.signal.aborted || ctx.signal.aborted) return;
          d.recs = list.filter(t => !busy.has(t.id)).slice(0, 3);
          if (d.recs.length) el.innerHTML = paint(d, rec, ctx.now()).value;
        });
        return () => { ac.abort(); ctx.shell.setAmbient(null); };
      },
    });
  },
};

function paint(d: HeroData, rec: number, now: Date): SafeHtml {
  const base = d.base;
  const pick = rec >= 0 ? d.recs[rec] : undefined;
  const cur: MediaItem = (pick ?? base?.item) as MediaItem;
  const logo = logoUrl(cur, 600);
  const title = cur.kind === 'episode' ? cur.seriesName : cur.name;
  const body = pick ? recBody(pick, base, now) : resumeBody(base as WatchRow, now);
  return html`
    <div class="t-keep-in">
      <div class="art ph" ${ph(cur.id, title)}>${img(backdropUrl(cur, 1280), 'kb')}</div>
      <div class="shade"></div>
      <div class="kwrap">
        <div class="kc">
          <h2 class="tl" id="h-keep">${pick ? html`${icon('bot')}Recommended for you` : html`${icon('clock')}Keep watching`}</h2>
          <div class="body kswap">
            <div class="ktitle${logo ? '' : ' nologo'}">${img(logo, 'logo')}<h3 class="ttext">${title}</h3></div>
            ${body}
          </div>
        </div>
        ${d.recs.length ? html`<div class="krec" role="group" aria-labelledby="krecH">
          <div class="krh"><h4 id="krecH">Up next for you</h4><button class="linkbtn" type="button" data-tab-link="explore" aria-label="See all recommendations in Explore">All${icon('next')}</button></div>
          ${d.recs.map((x, i) => html`<button type="button" class="kth ph" ${ph(x.id, x.name)} data-hero="${i}" aria-pressed="${String(rec === i)}" aria-label="Show recommendation: ${x.name}${x.runtimeMin ? `, ${runtime(x.runtimeMin)}` : ''}">
            ${img(thumbUrl(x, 400))}<span class="kt">${icon('bot')}For you</span><span class="nm">${x.name}</span></button>`)}
        </div>` : ''}
      </div>
    </div>`;
}

function resumeBody(base: WatchRow, now: Date): SafeHtml {
  const it = base.item;
  const meta = it.kind === 'episode'
    ? html`<b>Show</b> · ${epLabel(it)}${it.name ? ` · ${it.name}` : ''}`
    : html`<b>${it.kind === 'series' ? 'Show' : 'Film'}</b> · ${[it.year, it.genres[0]].filter(Boolean).join(' · ')}`;
  const left = base.leftMin;
  return html`
    <p class="kmeta">${meta}</p>
    <div class="kprog"><div class="prog" role="progressbar" aria-label="Watched" aria-valuenow="${base.percent ?? 0}" aria-valuemin="0" aria-valuemax="100"><i style="width:${base.percent ?? 0}%"></i></div><span>${leftText(base)}</span></div>
    <div class="kacts"><a class="btn primary" href="#${playPath(it)}">${icon('play')}Resume</a><a class="btn glass sm" href="#${detailsPath(it)}">Details</a></div>
    ${left ? html`<p class="kmeta kfin">Finishes around <b>${clock(new Date(now.getTime() + left * 60_000))}</b> if you start now.</p>` : ''}`;
}

function recBody(t: Title, base: WatchRow | null, now: Date): SafeHtml {
  const meta = html`<b>${t.kind === 'series' ? 'Show' : 'Film'}</b> · ${[t.year, t.genres[0], t.kind === 'movie' && t.runtimeMin ? runtime(t.runtimeMin) : ''].filter(Boolean).join(' · ')}`;
  return html`
    <p class="kmeta">${meta}</p>
    <p class="kwhy">${icon('bot')}<span>${whyFor(t)}.</span></p>
    ${t.overview ? html`<p class="kov">${t.overview}</p>` : ''}
    <div class="kacts"><a class="btn primary" href="#${playPath(t)}">${icon('play')}Play</a><a class="btn glass sm" href="#${detailsPath(t)}">Details</a>
      ${base ? html`<button class="btn glass sm" type="button" data-hero="-1">${icon('back')}Back to ${base.title}</button>` : ''}</div>
    ${t.kind === 'movie' && t.runtimeMin ? html`<p class="kmeta kfin">Done by <b>${clock(new Date(now.getTime() + t.runtimeMin * 60_000))}</b> if you start now.</p>` : ''}`;
}
