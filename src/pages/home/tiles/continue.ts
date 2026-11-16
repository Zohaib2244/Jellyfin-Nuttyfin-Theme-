/** Continue Watching tab: the full strip, Finish the season, Finish a collection, Leaving soon (only if there is data). */
import { runtime } from '../../../lib/format';
import { html } from '../../../lib/html';
import { icon } from '../../../ui/icons';
import { detailsPath, img, ph, playPath, posterUrl, thumbUrl } from '../art';
import { leftText, watchRows, type WatchRow } from '../model';
import type { SeasonProgress } from '../model';
import { loadInto, skRows, skStrip, tileHead, type TileDef } from '../tile';
import type { CollectionProgress, LeavingSoon } from '../../../api/types';

export const onTheGoTile: TileDef = {
  id: 'onthego', tab: 'continue', title: 'Continue watching', icon: 'clock', place: [1, 1, 12, 3], minH: 0,
  mount(host, ctx) {
    loadInto<WatchRow[]>(host, ctx, {
      head: tileHead('onthego', 'clock', 'Continue watching'),
      skeleton: skStrip(5),
      padCls: 'sx',
      async fetch() { return watchRows(await ctx.data.resume(), await ctx.data.nextUp().catch(() => [])); },
      render(rows) {
        if (!rows.length) return null;
        const going = rows.filter(r => r.kind === 'resume').length;
        return html`${tileHead('onthego', 'clock', 'Continue watching', { count: going ? `${going} on the go${rows.length > going ? `, ${rows.length - going} up next` : ''}` : `${rows.length} up next` })}
          <div class="hstrip">${rows.map((r, i) => html`<a class="og" href="#${playPath(r.item)}" aria-label="${r.kind === 'resume' ? 'Resume' : 'Play'} ${r.title}, ${r.sub}${r.percent ? `, ${r.percent}% watched` : ''}${leftText(r) ? `, ${leftText(r)}` : ''}">
            <span class="ogart ph" ${ph(r.item.id, r.title)}>${img(thumbUrl(r.item, 480))}${i === 0 ? html`<span class="first">Up first</span>` : r.kind === 'next' ? html`<span class="first next">Next</span>` : ''}<span class="pl">${icon('play')}</span>${r.percent != null ? html`<span class="bar"><i style="width:${r.percent}%"></i></span>` : ''}</span>
            <span><b>${r.title}</b><small>${r.sub}${leftText(r) ? ` · ${leftText(r)}` : ''}</small></span></a>`)}</div>`;
      },
      empty: html`${tileHead('onthego', 'clock', 'Continue watching')}<p class="quiet">Nothing half-watched and no shows waiting. Pick something in Explore and it will land here.</p>`,
    });
  },
};

export const finishTile: TileDef = {
  id: 'finish', tab: 'continue', title: 'Finish the season', icon: 'flag', place: [1, 4, 6, 5], minH: 0,
  mount(host, ctx) {
    loadInto<SeasonProgress[]>(host, ctx, {
      head: tileHead('finish', 'flag', 'Finish the season'),
      skeleton: skRows(3),
      fetch: () => ctx.data.seasonsInProgress(3),
      render(list) {
        if (!list.length) return null;
        const top = list[0] as SeasonProgress;
        return html`${tileHead('finish', 'flag', 'Finish the season')}
          <div class="fins">${list.map(f => {
    const left = f.of - f.seen;
    return html`<a class="fin2" href="#${playPath(f.next)}" aria-label="${f.seriesName}, season ${f.season}: ${left} episode${left === 1 ? '' : 's'} left, about ${runtime(f.leftMin)}. Play episode ${f.next.episode}">
              <span class="ph fp" ${ph(f.seriesId, f.seriesName)}>${img(posterUrl(f.next, 200))}</span>
              <span class="fw"><b>${f.seriesName}</b><small>Season ${f.season} · next is episode ${f.next.episode} · <em>${runtime(f.leftMin)}</em> left</small>
                <span class="eps" aria-hidden="true">${f.dots.map(d => html`<i class="${d}"></i>`)}</span></span>
              <span class="fr"><span class="left">${left === 1 ? '1 to go' : `${left} left`}</span><span class="minibtn go">${icon('play')}Episode ${f.next.episode}</span></span></a>`;
  })}</div>
          <p class="note fnote">${top.of - top.seen <= 2 ? html`<b>${top.seriesName}</b> is almost done. One sitting would finish it.` : 'Shows you have started, closest to done first.'}</p>`;
      },
      empty: html`${tileHead('finish', 'flag', 'Finish the season')}<p class="quiet">No season is half-watched. Start a show and it will show up here with how far you are.</p>`,
    });
  },
};

export const setsTile: TileDef = {
  id: 'sets', tab: 'continue', title: 'Finish a collection', icon: 'layers', place: [7, 4, 6, 5], minH: 0,
  mount(host, ctx) {
    loadInto<CollectionProgress[]>(host, ctx, {
      head: tileHead('sets', 'layers', 'Finish a collection'),
      skeleton: skRows(3),
      fetch: () => ctx.data.collectionsInProgress(),
      render(list) {
        if (!list.length) return null;
        return html`${tileHead('sets', 'layers', 'Finish a collection')}
          <div class="sets">${list.slice(0, 3).map(s => {
    const next = s.items.find(i => i.id === s.nextId);
    return html`<div class="set">
            <h3><span>${s.name}</span><small>${s.seen} of ${s.total} seen</small></h3>
            <div class="strip5">${s.items.map(i => html`<a class="sp ph ${i.played ? 'seen' : 'unseen'} ${i.id === s.nextId ? 'nextup' : ''}" ${ph(i.id, i.name)} href="#${detailsPath(i)}" aria-label="${i.name}${i.played ? ', seen' : i.id === s.nextId ? ', next to watch' : ''}">${img(posterUrl(i, 200))}</a>`)}</div>
            <div class="setnx">${next ? html`<small>Up next</small><b>${next.name}</b><a class="minibtn go" href="#${playPath(next)}">${icon('play')}Play</a>` : html`<small>All watched</small>`}</div>
          </div>`;
  })}</div>`;
      },
      empty: html`${tileHead('sets', 'layers', 'Finish a collection')}<p class="quiet">No box set started. Watch one film from a series and the rest lines up here.</p>`,
    });
  },
};

/** Only exists when the server knows something is leaving: the tile stays hidden otherwise. */
export const leavingTile: TileDef = {
  id: 'leaving', tab: 'continue', title: 'Leaving soon', icon: 'hourglass', place: [1, 9, 12, 2], minH: 0,
  mount(host, ctx) {
    const section = host.closest<HTMLElement>('.tile');
    if (section) section.dataset.absent = '';
    ctx.backend.leavingSoon().then(list => {
      if (ctx.signal.aborted || !list.length || !section) return;
      const day = new Date(list[0]?.leavesOn ?? '');
      const when = Number.isNaN(day.getTime()) ? 'soon' : day.toLocaleDateString('en-GB', { weekday: 'long' });
      host.innerHTML = html`<div class="pad lv">${tileHead('leaving', 'hourglass', 'Leaving soon')}
        <p class="note lvnote"><b class="when">${when}</b> These go to make room. Watch them first.</p>
        <div class="lvrows">${list.slice(0, 4).map((l: LeavingSoon) => html`<a class="row2 lvrow" href="#${detailsPath(l)}">
          <span class="ph" ${ph(l.id, l.name)}>${img(posterUrl(l, 200))}</span>
          <span class="w"><b>${l.name}</b><small><b class="warn">Leaves ${when}</b> · ${l.reason}</small></span>
          <span class="minibtn go">${icon('play')}Watch</span></a>`)}</div></div>`.value;
      delete section.dataset.absent;
    }).catch(() => { /* optional tile: stay hidden */ });
  },
};
