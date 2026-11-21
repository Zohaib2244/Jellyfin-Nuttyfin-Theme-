/** Compact "Continue watching" list on Home: every in-progress item, thin progress bars, time left. */
import { html, type SafeHtml } from '../../../lib/html';
import { icon } from '../../../ui/icons';
import { img, ph, playPath, thumbUrl } from '../art';
import { leftText, watchRows, type WatchRow } from '../model';
import { loadInto, skRows, tileHead, type TileDef } from '../tile';

export const cwMiniTile: TileDef = {
  id: 'cwmini', tab: 'home', title: 'Continue watching', icon: 'clock', place: [8, 6, 5, 4], minH: 0,
  mount(host, ctx) {
    loadInto<WatchRow[]>(host, ctx, {
      head: tileHead('cwmini', 'clock', 'Continue watching'),
      skeleton: skRows(4),
      padCls: 'cwm',
      async fetch() {
        const resume = await ctx.data.resume();
        // Only in-progress items. If nothing is in progress, offer the next episodes so the list is useful.
        const rows = watchRows(resume, []);
        return rows.length ? rows : watchRows([], await ctx.data.nextUp());
      },
      render(rows) {
        if (!rows.length) return null;
        const inProgress = rows.some(r => r.kind === 'resume');
        return html`${tileHead('cwmini', 'clock', inProgress ? 'Continue watching' : 'Up next', { count: `${rows.length} ${inProgress ? 'on the go' : 'waiting'}`, more: { label: 'See all', tab: 'continue' } })}
          <ol class="cwl">${rows.map((r, i) => row(r, i))}</ol>`;
      },
      empty: html`<p class="quiet">Nothing half-watched. Start something and it will wait for you here.</p>`,
    });
  },
};

function row(r: WatchRow, i: number): SafeHtml {
  const left = leftText(r);
  return html`<li><a class="cwr${i === 0 ? ' first' : ''}" href="#${playPath(r.item)}" aria-label="${r.kind === 'resume' ? 'Resume' : 'Play'} ${r.title}, ${r.sub}${r.percent ? `, ${r.percent}% watched` : ''}${left ? `, ${left}` : ''}">
    <span class="ph" ${ph(r.item.id, r.title)}>${img(thumbUrl(r.item, 320))}</span>
    <span class="w"><b><span class="tt">${r.title}</span>${i === 0 ? html`<span class="first">Up first</span>` : ''}</b><small>${left ? html`<em>${left}</em> · ` : ''}${r.sub}</small>
      ${r.percent != null ? html`<span class="bar" aria-hidden="true"><i style="width:${r.percent}%"></i></span>` : ''}</span>
    <span class="go" aria-hidden="true">${icon('play')}</span></a></li>`;
}
