/** Next episode: the next unwatched episode of a show you follow, with a season progress strip. Never empty. */
import type { Episode, Title } from '../../../api/types';
import { runtime } from '../../../lib/format';
import { html, type SafeHtml } from '../../../lib/html';
import { icon } from '../../../ui/icons';
import { backdropUrl, detailsPath, img, ph, playPath, thumbUrl } from '../art';
import { epLabel } from '../model';
import { whyFor } from '../nutbot/moods';
import { loadInto, skArt, tileHead, type TileDef } from '../tile';

interface NextData {
  ep: Episode | null;
  /** the season's episodes, if they could be fetched (for the dots and "Then ...") */
  season: Episode[];
  /** shown instead when there is no next episode to offer */
  fallback: Title | null;
}

export const nextTile: TileDef = {
  id: 'next', tab: 'home', title: 'Next episode', icon: 'tv', place: [1, 3, 5, 3], minH: 320, cls: 'onimg',
  mount(host, ctx) {
    loadInto<NextData>(host, ctx, {
      head: tileHead('next', 'tv', 'Next episode'),
      skeleton: skArt(),
      bare: true,
      async fetch() {
        const [next, resume] = await Promise.all([ctx.data.nextUp(), ctx.data.resume()]);
        // Skip the show the hero is already resuming: the hero covers it.
        const busy = new Set(resume.map(r => (r.kind === 'episode' ? r.seriesId : r.id)));
        const ep = next.find(e => !busy.has(e.seriesId)) ?? next[0] ?? null;
        if (!ep) {
          const sugg = await ctx.data.suggestions().catch(() => [] as Title[]);
          return { ep: null, season: [], fallback: sugg.find(t => !busy.has(t.id)) ?? null };
        }
        const season = await ctx.data.episodes(ep.seriesId, ep.seasonId).catch(() => [] as Episode[]);
        return { ep, season, fallback: null };
      },
      render(d) {
        if (d.ep) return episode(d.ep, d.season);
        if (d.fallback) return start(d.fallback);
        return null;
      },
      empty: html`<p class="quiet">Nothing queued. When you start a show, its next episode waits here.</p>`,
    });
  },
};

function episode(e: Episode, season: Episode[]): SafeHtml {
  const eps = season.filter(x => !x.missing && x.season === e.season);
  const idx = eps.findIndex(x => x.id === e.id);
  const after = idx >= 0 ? eps[idx + 1] : undefined;
  const prev = idx > 0 ? eps[idx - 1] : undefined;
  const lead = prev?.played ? `You finished episode ${prev.episode}.` : e.episode === 1 ? 'A fresh start.' : '';
  return html`
    <div class="art ph" ${ph(e.id, e.seriesName)}>${img(thumbUrl(e, 800))}</div>
    <div class="shade"></div>
    <div class="nx">
      <h2 class="tl" id="h-next">${icon('tv')}Next episode</h2>
      <div>
        <div class="eyebrow">${e.seriesName.toUpperCase()} · SEASON ${e.season} · EPISODE ${e.episode}</div>
        <h3>${e.name || epLabel(e)}</h3>
        ${e.overview ? html`<p class="ov">${e.overview}</p>` : ''}
        <p>${[e.runtimeMin ? runtime(e.runtimeMin) : '', lead].filter(Boolean).join(' · ')}</p>
        <div class="row">
          <a class="btn primary sm" href="#${playPath(e)}">${icon('play')}Play episode ${e.episode}</a>
          <a class="btn glass sm" href="#${detailsPath(e)}">Details</a>
          ${after ? html`<span class="then"><span>Then<b>${after.name}</b></span><span class="ph" ${ph(after.id)}>${img(thumbUrl(after, 300))}</span></span>` : ''}
        </div>
        ${eps.length > 1 ? html`<div class="epdots" role="img" aria-label="Season ${e.season}: ${eps.filter(x => x.played).length} of ${eps.length} watched">${eps.map(x => html`<i class="${x.played ? 'w' : x.id === e.id ? 'n' : ''}"></i>`)}</div>` : ''}
      </div>
    </div>`;
}

/** No episode to offer: a fresh recommendation instead, so the tile is never blank. */
function start(t: Title): SafeHtml {
  return html`
    <div class="art ph" ${ph(t.id, t.name)}>${img(backdropUrl(t, 800))}</div>
    <div class="shade"></div>
    <div class="nx">
      <h2 class="tl" id="h-next">${icon('tv')}Start something new</h2>
      <div>
        <div class="eyebrow">${(t.kind === 'series' ? 'SHOW' : 'FILM')} · ${[t.year, t.genres[0]?.toUpperCase()].filter(Boolean).join(' · ')}</div>
        <h3>${t.name}</h3>
        ${t.overview ? html`<p class="ov">${t.overview}</p>` : ''}
        <p>${whyFor(t)}.${t.kind === 'movie' && t.runtimeMin ? ` ${runtime(t.runtimeMin)}.` : ''}</p>
        <div class="row"><a class="btn primary sm" href="#${playPath(t)}">${icon('play')}Play</a><a class="btn glass sm" href="#${detailsPath(t)}">Details</a></div>
      </div>
    </div>`;
}
