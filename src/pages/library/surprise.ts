/** "Surprise me": NutBot picks one title from the current mix, with a short slot-machine reel (skipped for reduced motion). */
import { imageUrl } from '../../api';
import type { Backend } from '../../api/backend';
import type { ItemsQuery, Title } from '../../api/types';
import { hue, phAttrs } from '../../lib/dom';
import { clock, runtime } from '../../lib/format';
import { html, raw } from '../../lib/html';
import { nutbot } from '../../ui/nutbot';
import { openDialog, type DialogHandle } from '../common/dialog';
import { ic } from '../common/icons';
import { ticksToSeconds, watchPath } from '../common/watch';
import { laneOf, type LibKind } from './filters';

export interface SurpriseInput {
  backend: Backend;
  kind: LibKind;
  /** the current mix, as a Jellyfin query (paging fields are ignored) */
  query: ItemsQuery;
  href(path: string): string;
  /** where focus goes when the dialog closes if the opener vanished */
  signal: AbortSignal;
  toast(msg: string): void;
  announce(msg: string): void;
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

async function draw(i: SurpriseInput): Promise<{ pool: Title[]; fresh: boolean; total: number }> {
  const base: ItemsQuery = { ...i.query, start: 0, limit: 16, sort: 'random', descending: false };
  // films you have not seen come first; fall back to the whole mix when there are none (unless the mix already says)
  if (i.kind === 'movies' && base.played === undefined && !base.resumable) {
    const fresh = await i.backend.items({ ...base, played: false }, i.signal);
    if (fresh.items.length) return { pool: fresh.items, fresh: true, total: fresh.total };
  }
  const all = await i.backend.items(base, i.signal);
  if (i.kind === 'shows') {
    const going = all.items.filter(t => laneOf(t) !== 'done');
    if (going.length) return { pool: going, fresh: true, total: all.total };
  }
  return { pool: all.items, fresh: false, total: all.total };
}

export async function openSurprise(i: SurpriseInput): Promise<void> {
  const { pool, fresh, total } = await draw(i).catch(() => ({ pool: [] as Title[], fresh: false, total: 0 }));
  const pick = pool[0];
  if (!pick) { i.toast('Nothing in your mix to pick from. Clear a switch first.'); return; }
  show(i, pool, fresh, total, null);
}

function show(i: SurpriseInput, pool: Title[], fresh: boolean, total: number, previous: DialogHandle | null): void {
  previous?.close();
  const pick = pool[0] as Title;
  const isShow = pick.kind === 'series';
  const play = isShow
    ? html`<a class="btn primary" href="${i.href(`/title/${pick.id}`)}">${ic('play')}${(pick.unplayedCount ?? 0) < (pick.episodeCount ?? 0) ? 'Pick up where you left off' : 'Start episode 1'}</a>`
    : html`<a class="btn primary" href="${i.href(watchPath(pick.id, { seconds: pick.progress ? ticksToSeconds(pick.progress.positionTicks) : undefined }))}">${ic('play')}${pick.progress ? 'Resume' : 'Play'}</a>`;
  const why = isShow
    ? ((pick.unplayedCount ?? 0) < (pick.episodeCount ?? 0) ? `You are ${(pick.episodeCount ?? 0) - (pick.unplayedCount ?? 0)} episodes in.` : `Not started yet${pick.episodeCount ? `: ${pick.episodeCount} episodes ready` : ''}.`)
    : `${pick.runtimeMin <= 95 ? 'Short and easy.' : pick.runtimeMin > 140 ? 'A long one, so get comfy.' : 'Nice length for tonight.'} ${runtime(pick.runtimeMin)}, done by about ${clock(new Date(Date.now() + pick.runtimeMin * 60_000))}.`;
  const backdrop = pick.imageTags.backdrop ? imageUrl(pick.id, 'Backdrop', { maxWidth: 1280, tag: pick.imageTags.backdrop, index: 0 }) : imageUrl(pick.id, 'Primary', { maxWidth: 800, tag: pick.imageTags.primary });
  const rolling = !reduced() && pool.length > 1;
  const body = html`<button class="iconbtn x" type="button" data-close aria-label="Close">${ic('x')}</button>
    <div class="bdp ph" ${raw(phAttrs(pick.id))}><img src="${backdrop}" alt="">${rolling ? html`<div class="reel" aria-hidden="true"></div>` : ''}</div>
    <div class="in">
      <div class="pst ph" ${raw(phAttrs(pick.id, pick.name))}><img src="${imageUrl(pick.id, 'Primary', { maxWidth: 400, tag: pick.imageTags.primary })}" alt=""></div>
      <div>
        <div class="say">${nutbot(40, 'happy')}<span>Picked from ${total} ${isShow ? (total === 1 ? 'show' : 'shows') : (total === 1 ? 'film' : 'films')} in your mix${fresh ? (isShow ? ' you have not finished' : ' you have not seen') : ''}.</span></div>
        <h2 id="supt" data-autofocus tabindex="-1">${pick.name}</h2>
        <p class="meta">${[pick.year, pick.certification ?? 'Not rated', pick.genres.slice(0, 3).join(', '), pick.rating != null ? pick.rating.toFixed(1) : ''].filter(Boolean).join(' · ')}</p>
        <p class="ov2">${why}</p>
        <div class="acts">${play}<a class="btn" href="${i.href(`/title/${pick.id}`)}">Details</a>${pool.length > 1 ? html`<button class="btn ghost" type="button" data-again>${ic('shuffle')}Another one</button>` : ''}</div>
      </div>
    </div>`;
  const dlg = openDialog(body, { label: `NutBot picked ${pick.name}`, scrimClass: `lib-sup${rolling ? ' rolling' : ''}`, noClose: true });
  i.announce(`NutBot picked ${pick.name}.`);
  dlg.el.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('[data-again]')) {
      // rotate through the draw, then ask the server for a new one when it is used up
      const rest = pool.slice(1);
      if (rest.length) show(i, rest, fresh, total, dlg);
      else void draw(i).then(r => { if (r.pool.length) show(i, r.pool, r.fresh, r.total, dlg); });
    }
  });
  if (rolling) void reel(dlg, pool);
}

async function reel(dlg: DialogHandle, pool: Title[]): Promise<void> {
  const box = dlg.el.querySelector<HTMLElement>('.reel');
  const scrim = dlg.el.closest<HTMLElement>('.scrim');
  if (!box || !scrim) return;
  const cells = [0, 1, 2].map(() => { const d = document.createElement('div'); d.className = 'ph'; box.append(d); return d; });
  const sample = (): Title => pool[Math.floor(Math.random() * pool.length)] as Title;
  for (let n = 0; n < 8 && dlg.el.isConnected; n++) {
    cells.forEach(c => {
      const t = sample();
      c.style.setProperty('--h', String(hue(t.id)));
      c.style.setProperty('--h2', String((hue(t.id) + 55) % 360));
      c.innerHTML = `<img src="${imageUrl(t.id, 'Primary', { maxWidth: 200, tag: t.imageTags.primary })}" alt="">`;
    });
    await sleep(70 + n * 18);
  }
  await sleep(220);
  box.remove();
  scrim.classList.remove('rolling');
}
