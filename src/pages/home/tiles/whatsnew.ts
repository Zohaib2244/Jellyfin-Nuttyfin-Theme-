/** New this week: a big count, the newest names, and a slowly drifting collage of the new posters. */
import type { Title } from '../../../api/types';
import { parseDate, relativeTime } from '../../../lib/format';
import { html, type SafeHtml } from '../../../lib/html';
import { icon } from '../../../ui/icons';
import { detailsPath, img, ph, posterUrl } from '../art';
import { loadInto, skArt, tileHead, type TileDef } from '../tile';

const HEAD = tileHead('new', 'spark', 'New this week');

export const whatsNewTile: TileDef = {
  id: 'new', tab: 'home', title: 'New this week', icon: 'spark', place: [1, 6, 7, 7], minH: 380,
  mount(host, ctx) {
    loadInto<{ list: Title[]; week: boolean }>(host, ctx, {
      head: HEAD,
      skeleton: skArt(),
      bare: true,
      async fetch() {
        const week = await ctx.data.recent(7);
        if (week.length) return { list: week, week: true };
        return { list: await ctx.data.recent(60), week: false };
      },
      render: ({ list, week }) => (list.length ? view(list, week, ctx.now()) : null),
      empty: html`<p class="quiet">Nothing new has arrived lately. Newly Added will fill up as films and shows land.</p>`,
    });
  },
};

function view(list: Title[], week: boolean, now: Date): SafeHtml {
  const n = list.length;
  // enough posters to fill 3 / 5 / 7 drifting columns, repeating when the library is small
  const pool = list.filter(t => posterUrl(t));
  const base = pool.length ? pool : list;
  const col = (c: number): Title[] => [0, 1, 2, 3].map(j => base[(c * 2 + j * 3) % base.length] as Title);
  const poster = (t: Title, dup: boolean): SafeHtml => html`<a class="pst ph" ${ph(t.id, t.name)} href="#${detailsPath(t)}" ${dup ? html`tabindex="-1" aria-hidden="true"` : html`aria-label="${t.name}${t.added ? `, added ${relativeTime(t.added, now).toLowerCase()}` : ''}"`}>${isFresh(t, now) ? html`<span class="pday">New</span>` : ''}${img(posterUrl(t, 300))}</a>`;
  const names = list.slice(0, 3).map(t => t.name);
  const newest = names.length === 1 ? html`<b>${names[0]}</b>` : names.length === 2 ? html`<b>${names[0]}</b> and <b>${names[1]}</b>` : html`<b>${names[0]}</b>, <b>${names[1]}</b> and <b>${names[2]}</b>`;
  return html`
    <div class="nw">
      <div class="txt">
        ${tileHead('new', 'spark', week ? 'New this week' : 'New lately')}
        <div class="lead"><div class="big">${n}</div><div class="sub">new ${n === 1 ? 'film or show' : 'films and shows'}</div>
          <p class="newest">Newest: ${newest}.</p></div>
        <ul class="nwl">${list.slice(0, 5).map(t => html`<li><a href="#${detailsPath(t)}"><span class="ph" ${ph(t.id, t.name)}>${img(posterUrl(t, 120))}</span><span><b>${t.name}</b><small>${[t.kind === 'series' ? 'Show' : 'Film', t.added ? relativeTime(t.added, now) : ''].filter(Boolean).join(' · ')}</small></span></a></li>`)}</ul>
        <button class="btn sm" type="button" data-tab-link="new">See what's new ${icon('next')}</button>
      </div>
      <div class="coll" role="group" aria-label="${week ? 'New this week' : 'New lately'}">
        ${[0, 1, 2, 3, 4, 5, 6].map(c => html`<div class="col"><div class="strip" style="--dur:${30 + c * 6}s">${col(c).map(t => poster(t, c >= 3))}</div></div>`)}
      </div>
    </div>`;
}

const isFresh = (t: Title, now: Date): boolean => { const d = parseDate(t.added); return !!d && now.getTime() - d.getTime() < 36 * 36e5; };
