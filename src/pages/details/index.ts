/**
 * Details page (#/title/:id). Movies, series, seasons and episodes all land here:
 *   movie    -> hero, chapters, cast, about, more like this
 *   series   -> hero (Next Up as the Play button), season tabs + episodes, cast, guest stars, about, more like this
 *   episode  -> the series page with that episode selected, opened and playing as the Play button
 *   season   -> redirected to the series page on that season
 *   box set  -> a small list of its films
 * Follows design/mockups/details.html. Play/Resume only navigate to #/watch/<id>?t=..&audio=..&sub=..&version=..
 * (the player is built elsewhere); nothing here plays media.
 */
import { watchLogos } from '../../lib/logo';
import { ApiError, imageUrl } from '../../api';
import type { Episode, MediaItem, MediaVersion, Season, Title } from '../../api/types';
import { html, raw, setHtml } from '../../lib/html';
import { store } from '../../lib/storage';
import { nutbot } from '../../ui/nutbot';
import type { Page, PageContext } from '../types';
import '../common/common.css';
import { closeAllDialogs, openDialog, type DialogHandle } from '../common/dialog';
import { ic } from '../common/icons';
import { ticksToSeconds, watchPath, type WatchChoice } from '../common/watch';
import './details.css';
import { openRemove, openReport, openTrailer } from './dialogs';
import { assess, bestVersion, browserCanPlay, defaultAudio, defaultSubtitle, type Assessment } from './playability';
import { groupSeasons, pickTarget, validPrefs, type PlayPrefs } from './target';
import { pickTrailer } from './trailer';
import {
  aboutSection, castSection, chaptersSection, endsAtText, episodesSection, footnote, guestSection, hero, howLine, howPanel,
  moreSection, playExtra, playRow, versionSeg, subLabel, audioShort, favTip, watchedTip, type HeroModel, type PlayState,
} from './views';

const OWNER_NAME = 'the owner';
const RM = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const PHONE = (): boolean => matchMedia('(max-width: 760px)').matches;

const page: Page = {
  title: 'Title',
  render,
};
export default page;

async function render(ctx: PageContext): Promise<HTMLElement> {
  const { backend, router } = ctx;
  const id = ctx.params.id ?? '';
  let item: MediaItem;
  try {
    item = await backend.item(id);
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'unauthorized') throw e;
    if (e instanceof ApiError && e.kind !== 'not-found' && e.kind !== 'client') throw e; // server/network trouble: the router's retry page
    return lostView(ctx);
  }

  // season links go to the series on that season
  if (item.kind !== 'episode' && item.rawType === 'Season' && item.seriesId) {
    const q = item.seasonNumber != null ? `?season=${item.seasonNumber}` : '';
    router.navigate(`/title/${item.seriesId}${q}`, { replace: true });
    return stub();
  }
  if (item.kind !== 'episode' && item.rawType === 'BoxSet') return collectionView(ctx, item);

  const focusEp = item.kind === 'episode' ? item : null;
  const main: Title = focusEp ? ((await backend.item(focusEp.seriesId).catch(() => null)) as Title | null) ?? seriesStub(focusEp) : (item as Title);
  const isSeries = main.kind === 'series';
  const owner = !!ctx.user?.isAdmin;

  /* ── data ── */
  const [similar, seasons, allEps] = await Promise.all([
    backend.similar(main.id, 14).catch(() => [] as Title[]),
    isSeries ? backend.seasons(main.id).catch(() => [] as Season[]) : Promise.resolve([] as Season[]),
    isSeries ? backend.episodes(main.id).catch(() => [] as Episode[]) : Promise.resolve([] as Episode[]),
  ]);
  let eps: Episode[] = allEps;
  let target: Episode | undefined = isSeries ? (focusEp ?? pickTarget(eps)) : undefined;
  // the file that Play opens: the movie itself, or the Next Up / chosen episode (its full record has the files)
  let playItem: Title | Episode | undefined = isSeries ? (target ? ((await backend.item(target.id).catch(() => null)) as Episode | null) ?? target : undefined) : main;
  const detailed = new Set<number>();

  const groups = (): ReturnType<typeof groupSeasons> => groupSeasons(eps);
  const startSeason = Number(ctx.query.get('season'));
  const firstGroups = groups();
  let season = firstGroups.some(g => g.number === startSeason) && ctx.query.has('season') ? startSeason : (target?.season ?? firstGroups[0]?.number ?? 1);
  let openEp: string | null = focusEp?.id ?? null;

  /* ── play choices ── */
  const versions = (): readonly MediaVersion[] => playItem?.versions ?? [];
  const audioOf = (v: MediaVersion): ReturnType<typeof defaultAudio> => defaultAudio(v);
  const prefKey = `${ctx.user?.id ?? 'anon'}:${main.id}`;
  const touched = { ver: false, audio: false, sub: false };
  let verId: string | undefined;
  let audioIdx = -1;
  let subIdx = -1;
  let remembered = false;

  function applyDefaults(): void {
    const v = bestVersion(versions(), audioOf, browserCanPlay) ?? versions()[0];
    verId = v?.id;
    audioIdx = defaultAudio(v)?.index ?? -1;
    subIdx = defaultSubtitle(v, defaultAudio(v));
    touched.ver = touched.audio = touched.sub = false;
    remembered = false;
  }
  function loadPrefs(): void {
    applyDefaults();
    const saved = validPrefs(store.get<Record<string, PlayPrefs>>('playprefs', {})[prefKey], versions());
    if (!saved) return;
    verId = saved.ver;
    audioIdx = saved.audio;
    subIdx = saved.sub;
    touched.ver = touched.audio = touched.sub = true;
    remembered = true;
  }
  function savePrefs(): void {
    const all = store.get<Record<string, PlayPrefs>>('playprefs', {});
    const v0 = bestVersion(versions(), audioOf, browserCanPlay) ?? versions()[0];
    const same = verId === v0?.id && audioIdx === (defaultAudio(v0)?.index ?? -1) && subIdx === defaultSubtitle(v0, defaultAudio(v0));
    if (same) delete all[prefKey]; else all[prefKey] = { ver: verId, audio: audioIdx, sub: subIdx };
    store.set('playprefs', all);
    remembered = !same;
  }
  loadPrefs();

  const curVersion = (): MediaVersion | undefined => versions().find(v => v.id === verId) ?? versions()[0];
  const curAudio = (): ReturnType<typeof defaultAudio> => curVersion()?.audio.find(a => a.index === audioIdx) ?? defaultAudio(curVersion());
  const assessment = (v = curVersion()): Assessment => assess(v, v === curVersion() ? curAudio() : defaultAudio(v), browserCanPlay);
  const playState = (): PlayState => ({ version: curVersion(), audio: curAudio(), sub: subIdx, remembered, versionsCount: versions().length });

  const resumeSource = (): Title | Episode | undefined => (isSeries ? target : main);
  const resumeProgress = (): { positionTicks: number; percent: number; remainingMin: number } | undefined => resumeSource()?.progress;

  /** Everything the person chose (or the browser's best pick when it differs from the server's first file) rides along. */
  function playChoice(fromStart: boolean): WatchChoice {
    const prog = resumeProgress();
    const first = versions()[0];
    const choice: WatchChoice = {};
    if (!fromStart && prog) choice.seconds = ticksToSeconds(prog.positionTicks);
    if (touched.audio && audioIdx >= 0) choice.audio = audioIdx;
    if (touched.sub) choice.sub = subIdx;
    if (verId && (touched.ver || (first && verId !== first.id))) choice.version = verId;
    return choice;
  }
  const playId = (): string => (isSeries ? (target?.id ?? main.id) : main.id);
  const playPath = (fromStart = false): string => watchPath(playId(), playChoice(fromStart));

  /* ── state ── */
  const S = { fav: main.favourite, watched: main.played, clamp: true };
  const trailer = pickTrailer(main.remoteTrailers);
  const cx = { href: (p: string): string => router.href(p) };

  /* ── DOM ── */
  const root = document.createElement('div');
  root.className = 'page dt';
  // the banner spans the whole page width (rail to window edge); 100vw would include the scrollbar
  const setVw = (): void => root.style.setProperty('--vw', `${document.documentElement.clientWidth}px`);
  setVw();
  const vwObs = new ResizeObserver(setVw);
  vwObs.observe(document.documentElement);
  ctx.onDispose(() => vwObs.disconnect());
  const poster = imageUrl(main.id, 'Backdrop', { maxWidth: 1280, tag: main.imageTags.backdrop, index: 0 });
  ctx.shell.setTitle(main.name);
  ctx.shell.setAmbient(main.imageTags.backdrop ? poster : null);

  function heroModel(): HeroModel {
    const prog = resumeProgress();
    const runtimeMin = isSeries ? (target?.runtimeMin ?? 0) : main.runtimeMin;
    const remaining = prog ? prog.remainingMin : runtimeMin;
    return {
      title: main, target, playHref: cx.href(playPath()), startOverHref: prog ? cx.href(playPath(true)) : undefined,
      resume: prog ? { percent: prog.percent, remainingMin: prog.remainingMin } : null,
      runtimeMin, fav: S.fav, watched: S.watched, trailer: !!trailer, owner, clamp: S.clamp,
      seasonCount: groups().filter(g => g.number > 0).length || main.seasonCount || 0,
      episodeCount: eps.filter(e => !e.missing).length || main.episodeCount || 0,
      versionsCount: isSeries ? 0 : versions().length, endsAtText: endsAtText(remaining),
    };
  }

  const body = html`<div id="heroHost"></div><div class="wrap" id="below"></div>`;
  setHtml(root, body);
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => root.querySelector<T>(sel) as T;

  const live = document.createElement('div');
  live.className = 'sr';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  root.append(live);
  const say = (m: string): void => { live.textContent = ''; setTimeout(() => { live.textContent = m; }, 30); };

  function paintHero(): void {
    q('#heroHost').innerHTML = hero(heroModel(), cx).value;
    paintHow();
    wireHero();
  }

  /** The play row and the how-it-plays line change together whenever a choice or the target changes. */
  function paintPlay(): void {
    const m = heroModel();
    const tmp = document.createElement('div');
    tmp.innerHTML = playRow(m).value;
    q('#playrow').innerHTML = tmp.innerHTML;
    q('#playextra').innerHTML = playExtra(m).value;
    paintHow();
  }

  function paintHow(): void {
    const a = assessment();
    q('#howline').innerHTML = howLine(playState(), a).value;
    if (howOpen()) renderHowPanel();
  }

  function renderHowPanel(): void {
    const a = assessment();
    const pop = howRoot();
    const heading = isSeries && target ? `How it plays · S${target.season} E${target.episode}` : 'How it plays';
    const activeId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
    const hadFocus = pop.contains(document.activeElement);
    pop.innerHTML = howPanel(playState(), a, { owner, heading, hasChapters: !isSeries && !!main.chapters?.length }).value;
    const seg = pop.querySelector<HTMLElement>('#verseg');
    if (seg) seg.innerHTML = versionSeg(versions(), verId, v => assess(v, defaultAudio(v), browserCanPlay)).value;
    if (hadFocus && activeId) pop.querySelector<HTMLElement>(`#${CSS.escape(activeId)}`)?.focus();
  }

  /* ── below the hero ── */
  function paintBelow(): void {
    const parts = [] as Array<ReturnType<typeof html>>;
    if (isSeries) {
      parts.push(groups().length
        ? episodesSection({ groups: groups(), current: season, nextUp: target && !target.played ? target : target, owner, openEp, detailed: detailed.has(season) }, cx)
        : html`<section class="section"><div class="sechead"><h2>Episodes</h2></div><p class="status">No episodes in the library yet.</p></section>`);
    } else if (main.chapters?.length) {
      parts.push(chaptersSection(main.id, main.chapters, cx, { versionQuery: { ...(touched.audio ? { audio: audioIdx } : {}), ...(touched.sub ? { sub: subIdx } : {}), ...(verId && touched.ver ? { version: verId } : {}) } }));
    }
    parts.push(castSection(main.people ?? []));
    if (isSeries) parts.push(guestSection(groups().find(g => g.number === season)?.eps ?? [], season));
    parts.push(aboutSection({ title: main, people: main.people ?? [], versions: isSeries ? [] : versions(), owner, ownerName: OWNER_NAME }));
    parts.push(moreSection(similar, isSeries, cx, main));
    if (owner) parts.push(footnote());
    q('#below').innerHTML = parts.map(p => p.value).join('');
  }

  function paintEpisodes(): void {
    // only the episodes section changes on a season switch or a watched toggle; keep the page where it is
    const sec = q('#episodes');
    if (!sec) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = episodesSection({ groups: groups(), current: season, nextUp: target, owner, openEp, detailed: detailed.has(season) }, cx).value;
    const fresh = tmp.firstElementChild;
    if (fresh) sec.replaceWith(fresh);
    const guestHost = root.querySelector('#h-guest')?.closest('section');
    const g = guestSection(groups().find(x => x.number === season)?.eps ?? [], season).value;
    if (guestHost) { const t = document.createElement('div'); t.innerHTML = g; if (t.firstElementChild) guestHost.replaceWith(t.firstElementChild); else guestHost.remove(); }
    else if (g) { const t = document.createElement('div'); t.innerHTML = g; const anchor = root.querySelector('#h-cast')?.closest('section'); if (anchor && t.firstElementChild) anchor.after(t.firstElementChild); }
  }

  async function ensureDetail(n: number): Promise<void> {
    if (detailed.has(n)) return;
    const seasonId = groups().find(g => g.number === n)?.eps[0]?.seasonId ?? seasons.find(s => s.number === n)?.id;
    if (!seasonId) { detailed.add(n); return; }
    try {
      const full = await backend.episodeDetails(main.id, seasonId, ctx.signal);
      const byId = new Map(full.map(e => [e.id, e]));
      eps = eps.map(e => { const f = byId.get(e.id); return f ? { ...f, played: e.played, ...(e.progress ? { progress: e.progress } : {}) } : e; });
      detailed.add(n);
      if (season === n) paintEpisodes();
    } catch (e) {
      if (ctx.signal.aborted) return;
      console.error(e);
      detailed.add(n); // do not retry in a loop; the rows just stay light
    }
  }

  /* ── events ── */
  function wireHero(): void {
    const ttl = q('.ttl');
    watchLogos(ttl, () => ttl.classList.remove('haslogo'));
    const tag = root.querySelector<HTMLElement>('#tagline');
    if (tag && S.clamp) {
      const ro = new ResizeObserver(() => {
        if (S.clamp && tag.scrollHeight <= tag.clientHeight + 1) root.querySelector<HTMLElement>('#clampBtn')?.setAttribute('hidden', '');
        else root.querySelector<HTMLElement>('#clampBtn')?.removeAttribute('hidden');
      });
      ro.observe(tag);
      ctx.onDispose(() => ro.disconnect());
    }
  }

  const toast = (m: string, icon: 'check' | 'info' = 'check'): void => ctx.shell.toast(m, icon);

  async function toggleFav(): Promise<void> {
    const next = !S.fav;
    S.fav = next;
    syncActs();
    try { await backend.setFavourite(main.id, next); toast(next ? `${main.name} is in your favourites.` : 'Removed from favourites.'); }
    catch { S.fav = !next; syncActs(); toast('Could not save that. Try again.', 'info'); }
  }

  async function toggleWatched(): Promise<void> {
    const next = !S.watched;
    const prev = { watched: S.watched, progress: main.progress, eps };
    S.watched = next;
    main.played = next;
    if (next) main.progress = undefined as never;
    if (isSeries) {
      eps = eps.map(e => ({ ...e, played: next, ...(next ? { progress: undefined as never } : {}) }));
      target = pickTarget(eps);
    }
    syncActs();
    paintPlay();
    if (isSeries) paintEpisodes();
    try { await backend.setPlayed(main.id, next); toast(next ? 'Marked as watched.' : 'Marked as not watched.'); }
    catch { S.watched = prev.watched; main.played = prev.watched; if (prev.progress) main.progress = prev.progress; eps = prev.eps; if (isSeries) target = pickTarget(eps); syncActs(); paintPlay(); if (isSeries) paintEpisodes(); toast('Could not save that. Try again.', 'info'); }
  }

  async function toggleEpWatched(epId: string): Promise<void> {
    const e = eps.find(x => x.id === epId);
    if (!e) return;
    const next = !e.played;
    const before = eps;
    eps = eps.map(x => (x.id === epId ? { ...x, played: next, ...(next ? { progress: undefined as never } : {}) } : x));
    const oldTarget = target;
    if (!focusEp) target = pickTarget(eps);
    paintEpisodes();
    try {
      await backend.setPlayed(epId, next);
      if (target?.id !== oldTarget?.id && target) { playItem = ((await backend.item(target.id).catch(() => null)) as Episode | null) ?? target; loadPrefs(); }
      paintPlay();
      say(next ? 'Marked as watched.' : 'Marked as not watched.');
    } catch { eps = before; target = oldTarget; paintEpisodes(); paintPlay(); toast('Could not save that. Try again.', 'info'); }
  }

  function syncActs(): void {
    const fav = q('[data-fav]');
    fav.setAttribute('aria-pressed', String(S.fav));
    fav.dataset.tip = favTip(S.fav);
    fav.innerHTML = ic(S.fav ? 'heartf' : 'heart').value;
    const w = q('[data-watched]');
    w.setAttribute('aria-pressed', String(S.watched));
    w.dataset.tip = watchedTip(S.watched);
  }

  /* menu */
  const menu = (): HTMLElement => q('#moreMenu');
  function openMenu(): void {
    menu().hidden = false;
    q('#moreBtn').setAttribute('aria-expanded', 'true');
    menu().querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }
  function closeMenu(refocus: boolean): void {
    if (menu().hidden) return;
    menu().hidden = true;
    q('#moreBtn').setAttribute('aria-expanded', 'false');
    if (refocus) q('#moreBtn').focus();
  }

  /* how it plays: a popover on wide screens, a real modal sheet on phones */
  let howDlg: DialogHandle | null = null;
  const howRoot = (): HTMLElement => howDlg?.body ?? q('#howPop');
  const howOpen = (): boolean => !!howDlg || !q('#howPop').hidden;
  function openHow(): void {
    q('#howBtn').setAttribute('aria-expanded', 'true');
    if (PHONE()) {
      howDlg = openDialog(document.createElement('div'), { label: 'How it plays', noClose: true, onClose: () => { howDlg = null; q('#howBtn').setAttribute('aria-expanded', 'false'); } });
      howDlg.el.classList.add('dt', 'howsheet');
      howDlg.el.addEventListener('click', onClick);
      howDlg.el.addEventListener('change', onChange);
      howDlg.el.addEventListener('keydown', onKey);
      renderHowPanel();
      howDlg.body.querySelector<HTMLElement>('#pickAudio, [data-howdone]')?.focus();
      return;
    }
    const pop = q('#howPop');
    pop.hidden = false;
    renderHowPanel();
    pop.querySelector<HTMLElement>('#verseg [aria-checked="true"], #pickAudio, [data-howdone]')?.focus();
    pop.scrollIntoView({ block: 'nearest', behavior: RM() ? 'auto' : 'smooth' });
  }
  function closeHow(refocus = true): void {
    if (howDlg) { howDlg.close(); return; }
    const pop = q('#howPop');
    if (pop.hidden) return;
    pop.hidden = true;
    q('#howBtn').setAttribute('aria-expanded', 'false');
    if (refocus) q('#howBtn').focus();
  }

  function pickVersion(vid: string): void {
    if (vid === verId) return;
    verId = vid;
    const v = curVersion();
    if (!v?.audio.some(a => a.index === audioIdx)) { audioIdx = defaultAudio(v)?.index ?? -1; touched.audio = false; }
    if (subIdx >= 0 && !v?.subtitles.some(s => s.index === subIdx)) { subIdx = defaultSubtitle(v, curAudio()); touched.sub = false; }
    touched.ver = true;
    savePrefs();
    paintPlay();
    say(`Version ${v?.name ?? ''}. ${assessment().badge}.`);
  }

  function onChange(e: Event): void {
    const t = e.target;
    if (!(t instanceof HTMLSelectElement)) return;
    if (t.dataset.pick === 'audio') { audioIdx = Number(t.value); touched.audio = true; }
    else if (t.dataset.pick === 'sub') { subIdx = Number(t.value); touched.sub = true; }
    else return;
    savePrefs();
    paintPlay();
    say(`${audioShort(curAudio())}, ${subLabel(curVersion(), subIdx)}.`);
  }

  function reportDialog(): void {
    const v = curVersion();
    const what = isSeries && target ? `${main.name}, season ${target.season} episode ${target.episode}` : main.name;
    const attach = [what, v?.name, audioShort(curAudio()), `subtitles ${subLabel(v, subIdx).toLowerCase()}`, 'this browser'].filter(Boolean).join(' · ');
    openReport({ backend, item: main, what, attach, isOwner: owner, ownerName: OWNER_NAME });
  }

  function onClick(e: Event): void {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const has = (sel: string): HTMLElement | null => t.closest<HTMLElement>(sel);

    if (has('[data-back]')) { if (history.length > 1) router.back(); else router.navigate(isSeries ? '/shows' : '/movies'); return; }
    const clamp = has('[data-clamp]');
    if (clamp) {
      S.clamp = !S.clamp;
      q('#tagline').classList.toggle('clamp', S.clamp);
      clamp.textContent = S.clamp ? 'Read more' : 'Show less';
      clamp.setAttribute('aria-expanded', String(!S.clamp));
      return;
    }
    if (has('[data-fav]')) { void toggleFav(); return; }
    if (has('[data-watched]')) { void toggleWatched(); return; }
    if (has('[data-trailer]') && trailer) { openTrailer(main.name, trailer); return; }
    if (has('#moreBtn')) { if (menu().hidden) openMenu(); else closeMenu(true); return; }
    if (has('[data-report]')) { closeMenu(false); reportDialog(); return; }
    if (has('[data-remove]')) {
      closeMenu(false);
      if (!owner) return;
      openRemove({ backend, item: main, isSeries, onRemoved: () => router.navigate(isSeries ? '/shows' : '/movies', { replace: true }) });
      return;
    }
    if (has('#howBtn')) { if (!howOpen()) openHow(); else closeHow(); return; }
    if (has('[data-howdone]')) { closeHow(); return; }
    if (has('[data-howchap]')) { closeHow(false); const ch = root.querySelector<HTMLElement>('#chapters'); ch?.scrollIntoView({ block: 'start', behavior: RM() ? 'auto' : 'smooth' }); root.querySelector<HTMLElement>('#chaps a')?.focus({ preventScroll: true }); return; }
    if (has('[data-howreset]')) {
      const all = store.get<Record<string, PlayPrefs>>('playprefs', {});
      delete all[prefKey];
      store.set('playprefs', all);
      applyDefaults();
      paintPlay();
      say('Back to the usual.');
      return;
    }
    const ver = has('[data-ver]');
    if (ver) { pickVersion(ver.dataset.ver ?? ''); return; }

    const tab = has('[data-season]');
    if (tab) { selectSeason(Number(tab.dataset.season), false); return; }
    const open = has('[data-epopen]');
    if (open) {
      const epId = open.dataset.epopen ?? '';
      openEp = openEp === epId ? null : epId;
      const row = root.querySelector<HTMLElement>(`.ep[data-ep="${CSS.escape(epId)}"]`);
      const nowOpen = openEp === epId;
      row?.classList.toggle('open', nowOpen);
      open.setAttribute('aria-expanded', String(nowOpen));
      open.innerHTML = `${ic(nowOpen ? 'up' : 'down').value}Details`;
      const more = row?.querySelector<HTMLElement>('.more');
      if (more) more.hidden = !nowOpen;
      return;
    }
    const w = has('[data-epwatch]');
    if (w) { void toggleEpWatched(w.dataset.epwatch ?? ''); return; }
    const sc = has('[data-scroll]');
    if (sc) {
      const [id2, dir] = (sc.dataset.scroll ?? '').split(':');
      const track = root.querySelector<HTMLElement>(`#${CSS.escape(id2 ?? '')}`);
      track?.scrollBy({ left: Number(dir) * track.clientWidth * 0.8, behavior: RM() ? 'auto' : 'smooth' });
      return;
    }
    if (!t.closest('.morewrap')) closeMenu(false);
    if (!t.closest('#howPop') && !t.closest('#howline') && howOpen() && !howDlg) closeHow(false);
  }

  function selectSeason(n: number, focus: boolean): void {
    if (n === season) return;
    season = n;
    router.replaceQuery({ season: String(n) });
    paintEpisodes();
    if (focus) root.querySelector<HTMLElement>(`#stab-${n}`)?.focus();
    void ensureDetail(n);
  }

  function onKey(e: KeyboardEvent): void {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (e.key === 'Escape') {
      if (!menu().hidden) { e.preventDefault(); closeMenu(true); return; }
      if (howOpen() && !howDlg) { e.preventDefault(); closeHow(true); return; }
    }
    // menu: arrows move between items
    if (t.closest('#moreMenu') && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const items = Array.from(menu().querySelectorAll<HTMLElement>('[role="menuitem"]'));
      const i = items.indexOf(t as HTMLElement);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
      return;
    }
    if (t.closest('#moreMenu') && e.key === 'Tab') { closeMenu(false); return; }
    // season tabs
    const tab = t.closest<HTMLElement>('#seasontabs [role="tab"]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const tabs = Array.from(root.querySelectorAll<HTMLElement>('#seasontabs [role="tab"]'));
      const i = tabs.indexOf(tab);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      const n = Number(tabs[next]?.dataset.season);
      selectSeason(n, true);
      return;
    }
    // version radio group
    const radio = t.closest<HTMLElement>('#verseg [role="radio"]');
    if (radio && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const rs = Array.from(howRoot().querySelectorAll<HTMLElement>('#verseg [role="radio"]'));
      const i = rs.indexOf(radio);
      const next = rs[(i + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1) + rs.length) % rs.length];
      if (next) { pickVersion(next.dataset.ver ?? ''); howRoot().querySelector<HTMLElement>(`#verseg [data-ver="${CSS.escape(next.dataset.ver ?? '')}"]`)?.focus(); }
      return;
    }
  }

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('keydown', onKey);
  // Esc closes the popover / menu wherever focus happens to be (it can be on the page after a mouse click)
  const onDocKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.scrim')) return;
    if (!menu().hidden) closeMenu(true);
    else if (howOpen() && !howDlg) closeHow(true);
  };
  document.addEventListener('keydown', onDocKey);
  ctx.onDispose(() => { document.removeEventListener('keydown', onDocKey); closeAllDialogs(); });

  /* ── go ── */
  paintHero();
  paintBelow();
  if (isSeries) {
    void ensureDetail(season).then(() => {
      if (focusEp) root.querySelector(`.ep[data-ep="${CSS.escape(focusEp.id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'auto' });
    });
  }
  return root;
}

/* ── odd cases ── */
const stub = (): HTMLElement => {
  const d = document.createElement('section');
  d.className = 'page';
  return d;
};

function lostView(ctx: PageContext): HTMLElement {
  ctx.shell.setTitle('Not found');
  const d = document.createElement('section');
  d.className = 'page dt';
  setHtml(d, html`<div class="lost">${nutbot(72, 'look')}<h1 class="page-h" data-autofocus>We could not find that</h1><p>It may have been removed, or the link is old.</p>
    <p><a class="btn primary" href="${ctx.router.href('/movies')}">${ic('film')}Movies</a> <a class="btn" href="${ctx.router.href('/shows')}">${ic('tv')}Shows</a></p></div>`);
  return d;
}

/** An episode whose series record could not be read: enough to show the page. */
function seriesStub(e: Episode): Title {
  return {
    kind: 'series', id: e.seriesId, name: e.seriesName, imageTags: e.seriesImageTags, backdropCount: e.backdropCount, played: false, favourite: false,
    runtimeMin: 0, genres: [], is4k: false, studios: [],
  };
}

async function collectionView(ctx: PageContext, set: Title): Promise<HTMLElement> {
  const kids = await ctx.backend.items({ parentId: set.id, sort: 'year', descending: false, limit: 100 }, ctx.signal).catch(() => ({ items: [] as Title[], total: 0, start: 0 }));
  ctx.shell.setTitle(set.name);
  const d = document.createElement('section');
  d.className = 'page dt';
  setHtml(d, html`<div class="wrap"><button class="btn sm" type="button" data-back>${ic('back')}Back</button>
    <h1 class="page-h" data-autofocus style="margin-top:14px">${set.name}</h1><p class="page-sub">${kids.total} ${kids.total === 1 ? 'film' : 'films'} in this collection.</p>
    <div class="track" role="list">${kids.items.map(x => html`<a class="pc" role="listitem" href="${ctx.router.href(`/title/${x.id}`)}"><div class="art ph"><img loading="lazy" src="${imageUrl(x.id, 'Primary', { maxWidth: 320, tag: x.imageTags.primary })}" alt=""></div><div class="t">${x.name}</div><div class="s">${x.year ?? ''}</div></a>`)}</div></div>`);
  d.addEventListener('click', e => { if (e.target instanceof Element && e.target.closest('[data-back]')) history.back(); });
  void raw;
  return d;
}
