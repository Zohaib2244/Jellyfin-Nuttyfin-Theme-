/** Requests tab (compact): ask for something, your recent requests with their status flow, how it works. */
import type { SeerrQuota, SeerrRequest, SeerrResult } from '../../../api/types';
import { html, type SafeHtml } from '../../../lib/html';
import { icon } from '../../../ui/icons';
import { byRequestState } from '../model';
import { flowSummary, mountRequestSearch, requestRow } from '../requestsPanel';
import { loadInto, quiet, skRows, tileHead, type TileDef } from '../tile';

const OFF = html`<p class="quiet">Requests are not available right now. Everything else works as usual. Try again later, or sign in again with your password.</p>`;

export const reqAskTile: TileDef = {
  id: 'reqask', tab: 'requests', title: 'Ask for something', icon: 'ask', place: [1, 1, 12, 5], minH: 0,
  mount(host, ctx) {
    host.innerHTML = `<div class="pad ra"></div>`;
    const pad = host.firstElementChild as HTMLElement;
    pad.innerHTML = `${tileHead('reqask', 'ask', 'Ask for something', { count: 'Not in the library yet? Ask for it.' }).value}<div class="ra-body"></div>`;
    const body = pad.querySelector('.ra-body') as HTMLElement;
    let off = (): void => {};
    void ctx.data.seerrOn().then(on => {
      if (ctx.signal.aborted) return;
      if (!on) { body.innerHTML = OFF.value; return; }
      off = mountRequestSearch(body, {
        backend: ctx.backend, signal: ctx.signal,
        onRequested: r => {
          ctx.data.forget('myRequests', 'allRequests');
          ctx.shell.toast(`Asked for ${r.title || 'it'}`, 'check');
          host.dispatchEvent(new CustomEvent('requests:changed', { bubbles: true }));
        },
      }, {
        // "Popular with the house": what other people asked for lately (only the ones not available yet make sense to ask for)
        idle: async (): Promise<SeerrResult[]> => (await ctx.data.allRequests()).map((r): SeerrResult => ({ tmdbId: r.tmdbId, mediaType: r.mediaType, title: r.title, year: r.year, posterPath: r.posterPath, state: r.state === 'declined' ? undefined : r.state })).filter(r => r.title).slice(0, 10),
        idleTitle: 'Asked for lately in the house',
      });
    });
    return () => off();
  },
};

export const reqMineTile: TileDef = {
  id: 'reqmine', tab: 'requests', title: 'Your requests', icon: 'inbox', place: [1, 6, 7, 4], minH: 0,
  mount(host, ctx) {
    interface D { list: SeerrRequest[]; on: boolean; quota: SeerrQuota | null }
    const paint = (d: D): SafeHtml | null => {
      if (!d.on) return html`${tileHead('reqmine', 'inbox', 'Your requests')}${OFF}`;
      if (!d.list.length) return null;
      const open = d.list.filter(r => r.state !== 'available' && r.state !== 'declined').length;
      return html`${tileHead('reqmine', 'inbox', 'Your requests', { count: open ? `${open} still open` : 'all done' })}
        <div class="rlist">${d.list.slice(0, 5).map(r => requestRow(r, ctx.now()))}</div>
        ${quotaLine(d.quota)}`;
    };
    const load = (): void => loadInto<D>(host, ctx, {
      head: tileHead('reqmine', 'inbox', 'Your requests'),
      skeleton: skRows(4),
      padCls: 'rq',
      async fetch() {
        const [on, list, quota] = await Promise.all([ctx.data.seerrOn(), ctx.data.myRequests(), ctx.backend.seerr.quota().catch(() => null)]);
        return { on, list: [...list].sort(byRequestState), quota };
      },
      render: paint,
      empty: html`${tileHead('reqmine', 'inbox', 'Your requests')}${quiet('Nothing asked for yet. Search above, and ask if it is not in the library.')}`,
    });
    load();
    // Refresh after a request made in the search tile.
    const onChanged = (): void => { ctx.data.forget('myRequests'); load(); };
    document.addEventListener('requests:changed', onChanged);
    ctx.onDispose(() => document.removeEventListener('requests:changed', onChanged));
  },
};

function quotaLine(q: SeerrQuota | null): SafeHtml | string {
  if (!q) return '';
  const part = (name: string, l: SeerrQuota['movie']): string => (l.limit == null ? '' : `${l.remaining ?? 0} of ${l.limit} ${name}${l.days ? ` per ${l.days === 7 ? 'week' : `${l.days} days`}` : ''}`);
  const parts = [part('films', q.movie), part('shows', q.tv)].filter(Boolean);
  return parts.length ? html`<p class="note qnote">${icon('info')}You can still ask for ${parts.join(' and ')}.</p>` : '';
}

export const reqFlowTile: TileDef = {
  id: 'reqflow', tab: 'requests', title: 'How requests work', icon: 'info', place: [8, 6, 5, 4], minH: 0,
  mount(host, ctx) {
    const load = (): void => loadInto<SeerrRequest[]>(host, ctx, {
      head: tileHead('reqflow', 'info', 'How requests work'),
      skeleton: skRows(4),
      padCls: 'rf',
      fetch: () => ctx.data.myRequests(),
      render: list => html`${tileHead('reqflow', 'info', 'How requests work', { count: list.length ? 'Your requests at each step' : '' })}${flowSummary(list)}
        <p class="note">Ask for a film or show. Once approved it downloads, then lands in your library and in Newly Added.</p>`,
    });
    load();
    const onChanged = (): void => load();
    document.addEventListener('requests:changed', onChanged);
    ctx.onDispose(() => document.removeEventListener('requests:changed', onChanged));
  },
};
