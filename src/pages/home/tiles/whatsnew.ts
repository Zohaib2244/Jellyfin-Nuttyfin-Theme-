/**
 * Recently added: the newest additions whatever their date (so the tile is never empty in a quiet week), as a list
 * on the left and a still, tilted collage of their posters on the right. "See all" opens the Newly Added tab.
 */
import type { Title } from '../../../api/types';
import { parseDate, relativeTime } from '../../../lib/format';
import { html, type SafeHtml } from '../../../lib/html';
import { detailsPath, img, ph, posterUrl } from '../art';
import { loadInto, skArt, tileHead, type TileDef } from '../tile';

const TITLE = 'Recently added';
/** rows in the list: as many as fit the tall desktop tile (CSS hides the last ones on phones) */
const ROWS = 9;

export const whatsNewTile: TileDef = {
  id: 'new', tab: 'home', title: TITLE, icon: 'spark', place: [1, 6, 7, 7], minH: 380,
  mount(host, ctx) {
    loadInto<Title[]>(host, ctx, {
      head: tileHead('new', 'spark', TITLE),
      skeleton: skArt(),
      bare: true,
      fetch: () => ctx.data.latest(),
      render: list => (list.length ? view(list, ctx.now()) : null),
      empty: html`<p class="quiet">The library is empty for now. New films and shows will show up here as they land.</p>`,
    });
  },
};

function view(list: Title[], now: Date): SafeHtml {
  // enough posters to fill 3 / 5 / 7 columns, repeating when the library is small
  const pool = list.filter(t => posterUrl(t));
  const base = pool.length ? pool : list;
  const col = (c: number): Title[] => [0, 1, 2, 3, 4, 5, 6].map(j => base[(c * 2 + j * 3) % base.length] as Title);
  const poster = (t: Title): SafeHtml => html`<span class="pst ph" ${ph(t.id, t.name)}>${isFresh(t, now) ? html`<span class="pday">New</span>` : ''}${img(posterUrl(t, 300))}</span>`;
  const when = (t: Title): string => (t.added ? relativeTime(t.added, now) : '');
  return html`
    <div class="nw">
      <div class="txt">
        ${tileHead('new', 'spark', TITLE, { more: { label: 'See all', tab: 'new' } })}
        <ul class="nwl" aria-label="Newest first">${list.slice(0, ROWS).map(t => html`<li><a href="#${detailsPath(t)}" aria-label="${t.name}, ${t.kind === 'series' ? 'show' : 'film'}${t.added ? `, added ${when(t).toLowerCase()}` : ''}"><span class="ph" ${ph(t.id, t.name)}>${img(posterUrl(t, 120))}</span><span><b>${t.name}</b><small>${[t.kind === 'series' ? 'Show' : 'Film', when(t)].filter(Boolean).join(' · ')}</small></span></a></li>`)}</ul>
      </div>
      <div class="coll" aria-hidden="true">
        ${[0, 1, 2, 3, 4, 5, 6].map(c => html`<div class="col"><div class="strip">${col(c).map(poster)}</div></div>`)}
      </div>
    </div>`;
}

const isFresh = (t: Title, now: Date): boolean => { const d = parseDate(t.added); return !!d && now.getTime() - d.getTime() < 36 * 36e5; };
