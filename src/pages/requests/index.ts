/**
 * Requests page (#/requests): the full Seerr experience in Nuttyfin's own look.
 * Ask for something (search films and shows, open a sheet, pick seasons), follow your requests from "asked" to
 * "ready to watch", approve or decline when you are allowed to, and report a problem with something in the library.
 * Everything fails soft: when Seerr is not reachable the page says so in plain words and nothing else breaks.
 */
import type { Backend } from '../../api/backend';
import { explainRequestError } from '../../api/seerr-desk';
import type { RequestFilter, RequestScope, SeerrCapabilities, SeerrIssue } from '../../api/desk-types';
import type { SeerrQuota, SeerrRequest, SeerrResult } from '../../api/types';
import { html } from '../../lib/html';
import { icon } from '../../ui/icons';
import { nutbot } from '../../ui/nutbot';
import '../common/common.css';
import { closeAllDialogs } from '../common/dialog';
import { ic } from '../common/icons';
import type { Page, PageContext } from '../types';
import { FILTERS, isFilter, isOpen, quotaSummary, quotaText } from './model';
import { openProblemDialog } from './problems';
import { openRequestSheet } from './sheet';
import { askCard, issueRow, requestRow, skeletonGrid, skeletonRows } from './ui';
import './requests.css';

const PAGE_SIZE = 12;
const REFRESH_MS = 30_000;

const page: Page = {
  title: 'Requests',
  async render(ctx) {
    const root = document.createElement('div');
    root.className = 'page rq';
    const on = await ctx.backend.seerr.available();
    const caps = on ? await ctx.backend.seerr.capabilities() : null;
    if (!on || !caps) {
      root.innerHTML = offView().value;
      return root;
    }
    mount(root, ctx, caps);
    return root;
  },
};
export default page;

const offView = () => html`<h1 class="page-h" data-autofocus tabindex="-1">Requests</h1>
  <div class="card rq-off">${nutbot(56, 'sleepy')}<div><b>Requests are not available right now</b>
    <p>Everything else still works. Try again later. If you signed in with a Quick Connect code, sign in once with your password and requests will switch on.</p></div></div>`;

function mount(root: HTMLElement, ctx: PageContext, caps: SeerrCapabilities): void {
  const { backend, shell } = ctx;
  const seerr = backend.seerr;
  const canAll = caps.perms.manageRequests;

  const q0 = ctx.query;
  const st = {
    scope: (canAll && q0.get('scope') === 'all' ? 'all' : 'mine') as RequestScope,
    filter: (isFilter(q0.get('filter')) ? q0.get('filter') : 'all') as RequestFilter,
    kind: 'all' as 'all' | 'movie' | 'tv',
    query: (q0.get('q') ?? '').slice(0, 80),
    items: [] as SeerrRequest[],
    total: 0,
    skip: 0,
    mine: [] as SeerrRequest[],
    waitingAll: 0,
    quota: null as SeerrQuota | null,
    issues: [] as SeerrIssue[],
    results: [] as SeerrResult[],
    loading: false,
  };

  root.innerHTML = html`
    <header class="rq-head">
      <div><h1 class="page-h" data-autofocus tabindex="-1">Requests</h1>
        <p class="page-sub">Ask for films and shows that are not in the library yet, then follow them until they are ready to watch.</p></div>
      <p class="rq-quotas" id="rqquota" aria-label="Your request allowance"></p>
    </header>

    <section class="card rq-ask" aria-labelledby="rq-ask-h">
      <h2 class="rq-h" id="rq-ask-h">${icon('ask')}Ask for something<span class="cnt">Not in the library yet? Ask for it.</span></h2>
      <form class="rq-form" role="search" autocomplete="off">
        <label class="sr" for="rqq">Film or show to ask for</label>${icon('search')}
        <input id="rqq" type="search" maxlength="80" placeholder="Search for a film or show" value="${st.query}">
        <button class="btn primary sm" type="submit">${icon('search')}<span class="lbl">Search</span></button>
      </form>
      <div class="rq-kinds" role="group" aria-label="What to look for">
        <button type="button" class="rq-fchip" data-kind="all" aria-pressed="true">Films and shows</button>
        <button type="button" class="rq-fchip" data-kind="movie" aria-pressed="false">Films</button>
        <button type="button" class="rq-fchip" data-kind="tv" aria-pressed="false">Shows</button>
      </div>
      <div class="rq-res" id="rqres" aria-live="polite"></div>
    </section>

    <div class="rq-cols">
      <section class="card rq-list" aria-labelledby="rq-list-h" id="rqlist">
        <div class="rq-listhead">
          <h2 class="rq-h" id="rq-list-h">${icon('inbox')}<span id="rqlisttitle">Your requests</span><span class="cnt" id="rqlistcnt"></span></h2>
          ${canAll ? html`<div class="rq-seg" role="group" aria-label="Whose requests"><button type="button" data-scope="mine" aria-pressed="${st.scope === 'mine'}">Mine</button><button type="button" data-scope="all" aria-pressed="${st.scope === 'all'}">Everyone's</button></div>` : ''}
        </div>
        <div class="rq-filters" role="group" aria-label="Filter by progress">${FILTERS.map(f => html`<button type="button" class="rq-fchip" data-filter="${f.id}" aria-pressed="${st.filter === f.id}">${f.label}<span class="n" hidden></span></button>`)}</div>
        <div class="rq-items" id="rqitems" aria-live="polite"></div>
        <div class="rq-more" id="rqmore" hidden><button type="button" class="btn sm" id="rqmorebtn">Show more</button></div>
      </section>

      <div class="rq-side">
        <section class="card rq-how" aria-labelledby="rq-how-h"><h2 class="rq-h" id="rq-how-h">${icon('info')}How requests work</h2><div id="rqhow"></div>
          <p class="note">Ask for a film or show. Once approved it downloads, then lands in your library and in Newly Added.</p></section>
        <section class="card rq-probs" aria-labelledby="rq-pr-h"><h2 class="rq-h" id="rq-pr-h">${ic('flag')}Report a problem</h2>
          <p class="rq-prlead">Something wrong with a film or show that is already in the library? Tell us and we will take a look.</p>
          ${caps.perms.createIssues ? html`<button class="btn sm" type="button" id="rqreport">${ic('flag')}Report a problem</button>` : html`<p class="note">Your account cannot send problem reports. Tell the server owner directly.</p>`}
          <ul class="rq-issues" id="rqissues" aria-label="Your reports"></ul></section>
      </div>
    </div>`.value;

  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const res = $('#rqres');
  const itemsEl = $('#rqitems');
  const input = $<HTMLInputElement>('#rqq');
  const more = $('#rqmore');
  const now = (): Date => new Date();
  let alive = true;
  ctx.onDispose(() => { alive = false; closeAllDialogs(); });

  /* ── header: quota ── */
  const paintQuota = (): void => {
    const parts = [quotaText(st.quota?.movie, 'movie'), quotaText(st.quota?.tv, 'tv')].filter((x): x is string => !!x);
    $('#rqquota').innerHTML = parts.map(p => `<span class="chip ${/^No (film|show) requests left/.test(p) ? 'declined' : 'info'}">${icon('info').value}${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`).join('');
  };
  const loadQuota = async (): Promise<void> => { st.quota = await seerr.quota().catch(() => null); if (alive) paintQuota(); };

  /* ── search ── */
  let token = 0;
  let timer = 0;
  const msg = (text: string): string => `<p class="rq-quiet">${nutbot(34, 'look').value}<span>${text}</span></p>`;
  const grid = (list: readonly SeerrResult[], heading: string): string =>
    `<p class="rq-sub">${heading}</p><ul class="rq-grid">${list.map((r, i) => askCard(r, i).value).join('')}</ul>`;

  async function runSearch(): Promise<void> {
    const my = ++token;
    const text = input.value.trim();
    ctx.router.replaceQuery({ q: text || null });
    res.innerHTML = skeletonGrid(6);
    try {
      if (text.length < 2) {
        const list = (await seerr.discover(ctx.signal)).filter(r => st.kind === 'all' || r.mediaType === st.kind);
        if (my !== token) return;
        st.results = list;
        res.innerHTML = list.length ? grid(list.slice(0, 12), 'Popular right now. Tap one to ask for it.') : msg('Type a title above. If it is not in the library yet, you can ask for it.');
        return;
      }
      const list = (await seerr.search(text, ctx.signal)).filter(r => st.kind === 'all' || r.mediaType === st.kind);
      if (my !== token) return;
      st.results = list;
      const safe = text.replace(/[<>&"]/g, '');
      res.innerHTML = list.length ? grid(list.slice(0, 18), `${list.length > 18 ? 'Top 18 of ' : ''}${list.length} result${list.length === 1 ? '' : 's'} for "${safe}"`)
        : msg(`Nothing found for "${safe}". Check the spelling, or try a shorter name.`);
    } catch (e) {
      if (my !== token || ctx.signal.aborted) return;
      console.warn('Requests search failed', e);
      res.innerHTML = msg('The search did not work just now. Try again in a moment.');
    }
  }
  const sheetEnv = {
    backend, caps, quota: async () => { await loadQuota(); return st.quota; },
    onChanged: () => { void refreshAll(); },
    toast: (m: string) => shell.toast(m, 'check'),
    showMine: () => { st.scope = 'mine'; st.filter = 'all'; syncControls(); void loadList(true); $('#rqlist').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); },
  };

  /* ── your requests ── */
  const paintHow = (): void => {
    const n = (s: SeerrRequest['state']): number => st.mine.filter(r => r.state === s).length;
    const steps: Array<[string, string, number, 'ask' | 'check' | 'dl' | 'play']> = [
      ['You ask', 'Search above or tell NutBot.', n('requested'), 'ask'], ['It gets a yes', 'The server owner approves it.', n('approved'), 'check'],
      ['It downloads', 'Progress shows in your list.', n('downloading'), 'dl'], ['Ready to watch', 'It lands in Newly Added.', n('available'), 'play'],
    ];
    $('#rqhow').innerHTML = `<ol class="rq-how-steps">${steps.map(([t, h, c, ic2], i) => `<li class="${c ? 'has' : ''}">${icon(ic2).value}<b>${i + 1}. ${t}</b><small>${h}</small>${c ? `<span class="n" aria-label="${c} of yours here">${c}</span>` : ''}</li>`).join('')}</ol>`;
  };

  function paintList(): void {
    const rc = { caps, scope: st.scope, now: now() };
    $('#rqlisttitle').textContent = st.scope === 'all' ? "Everyone's requests" : 'Your requests';
    $('#rqlistcnt').textContent = st.total ? `${st.total} in all` : '';
    const waiting = $<HTMLElement>('[data-filter="waiting"] .n');
    if (st.scope === 'all' && st.waitingAll) { waiting.hidden = false; waiting.textContent = String(st.waitingAll); waiting.setAttribute('aria-label', `${st.waitingAll} waiting`); } else waiting.hidden = true;
    if (!st.items.length) {
      itemsEl.innerHTML = st.filter === 'all'
        ? (st.scope === 'mine' ? msg('Nothing asked for yet. Search above, and ask if it is not in the library.') : msg('Nobody has asked for anything yet.'))
        : msg('Nothing here with that filter. Try "All".');
    } else itemsEl.innerHTML = st.items.map(r => requestRow(r, rc).value).join('');
    more.hidden = st.skip >= st.total || !st.items.length;
    itemsEl.removeAttribute('aria-busy');
  }

  async function loadList(reset: boolean, keep = false): Promise<void> {
    if (st.loading) return;
    st.loading = true;
    if (reset && !keep) { itemsEl.innerHTML = skeletonRows(3); itemsEl.setAttribute('aria-busy', 'true'); }
    const take = keep ? Math.max(PAGE_SIZE, st.skip) : PAGE_SIZE;
    const skip = reset ? 0 : st.skip;
    try {
      const page = await seerr.requestsPage({ scope: st.scope, filter: st.filter, take, skip });
      if (!alive) return;
      st.items = reset ? page.items : [...st.items, ...page.items];
      st.total = page.total;
      st.skip = skip + take;
      paintList();
    } finally { st.loading = false; }
  }

  async function loadMine(): Promise<void> {
    const [mine, waiting] = await Promise.all([
      seerr.requestsPage({ scope: 'mine', filter: 'all', take: 50, skip: 0 }),
      canAll ? seerr.requestsPage({ scope: 'all', filter: 'waiting', take: 1, skip: 0 }) : Promise.resolve({ items: [], total: 0 }),
    ]);
    if (!alive) return;
    st.mine = mine.items;
    st.waitingAll = waiting.total;
    shell.setRequestsBadge(st.mine.filter(isOpen).length);
    paintHow();
    if (st.items.length || !st.loading) paintList();
  }

  async function loadIssues(): Promise<void> {
    if (!caps.perms.createIssues && !caps.perms.viewIssues) return;
    st.issues = await seerr.issues({ mine: true, take: 6 });
    if (!alive) return;
    $('#rqissues').innerHTML = st.issues.length ? st.issues.map(i => issueRow(i, now()).value).join('') : '<li class="rq-quiet none">No reports yet. That is a good sign.</li>';
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([loadList(true, true), loadMine(), loadQuota()]);
    if (st.results.length) void runSearch();
  }

  function syncControls(): void {
    root.querySelectorAll<HTMLElement>('[data-scope]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scope === st.scope)));
    root.querySelectorAll<HTMLElement>('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === st.filter)));
    root.querySelectorAll<HTMLElement>('[data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === st.kind)));
    ctx.router.replaceQuery({ scope: st.scope === 'all' ? 'all' : null, filter: st.filter === 'all' ? null : st.filter });
  }

  /* ── events ── */
  root.addEventListener('submit', e => { e.preventDefault(); window.clearTimeout(timer); void runSearch(); });
  input.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void runSearch(); }, 320); });

  root.addEventListener('click', e => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const open = t.closest<HTMLElement>('[data-open]');
    if (open) {
      const r = st.results.find(x => x.tmdbId === Number(open.dataset.open) && x.mediaType === (open.dataset.type === 'tv' ? 'tv' : 'movie'));
      openRequestSheet(sheetEnv, { tmdbId: Number(open.dataset.open), mediaType: open.dataset.type === 'tv' ? 'tv' : 'movie', title: r?.title });
      return;
    }
    const kind = t.closest<HTMLElement>('[data-kind]');
    if (kind) { st.kind = (kind.dataset.kind as 'all' | 'movie' | 'tv'); syncControls(); void runSearch(); return; }
    const scope = t.closest<HTMLElement>('[data-scope]');
    if (scope) { st.scope = scope.dataset.scope === 'all' ? 'all' : 'mine'; syncControls(); void loadList(true); return; }
    const filter = t.closest<HTMLElement>('[data-filter]');
    if (filter) { st.filter = filter.dataset.filter as RequestFilter; syncControls(); void loadList(true); return; }
    if (t.closest('#rqmorebtn')) { void loadList(false); return; }
    if (t.closest('#rqreport')) {
      openProblemDialog({ backend, ownerName: 'The server owner', isOwner: caps.perms.isAdmin, onSent: () => { void loadIssues(); } });
      return;
    }
    const act = t.closest<HTMLButtonElement>('[data-act]');
    if (act) void onAct(act);
  });

  async function onAct(btn: HTMLButtonElement): Promise<void> {
    const id = Number(btn.dataset.id);
    const kind = btn.dataset.act;
    const row = btn.closest<HTMLElement>('.rq-row');
    const title = row?.getAttribute('aria-label') ?? 'it';
    const box = btn.closest<HTMLElement>('.rq-btns');
    if (kind === 'cancel' && box) {
      // two steps in the page itself: no browser confirm box
      box.innerHTML = `<span class="rq-sure" role="group" aria-label="Cancel the request for ${title.replace(/"/g, '')}?"><span>Cancel this request?</span>
        <button class="btn sm danger" type="button" data-act="cancel-yes" data-id="${id}">Yes, cancel it</button><button class="btn sm" type="button" data-act="cancel-no" data-id="${id}">Keep it</button></span>`;
      box.querySelector<HTMLElement>('[data-act="cancel-no"]')?.focus();
      return;
    }
    if (kind === 'cancel-no') { paintList(); $(`.rq-row[data-req-id="${id}"] [data-act="cancel"]`)?.focus(); return; }
    box?.querySelectorAll('button').forEach(b => { b.disabled = true; });
    row?.setAttribute('aria-busy', 'true');
    try {
      if (kind === 'approve') await seerr.approveRequest(id);
      else if (kind === 'decline') await seerr.declineRequest(id);
      else if (kind === 'cancel-yes') await seerr.cancelRequest(id);
      shell.toast(kind === 'approve' ? `Approved ${title}` : kind === 'decline' ? `Declined ${title}` : `Cancelled the request for ${title}`, 'check');
      await refreshAll();
    } catch (err) {
      row?.removeAttribute('aria-busy');
      const info = explainRequestError(err);
      shell.toast(info.reason === 'permission' ? 'Your account is not allowed to do that.' : 'That did not work. Try again in a moment.', 'info');
      paintList();
    }
  }

  /* ── first paint and slow refresh (download percentages) ── */
  paintQuota();
  paintHow();
  void runSearch();
  void loadList(true);
  void loadMine();
  void loadIssues();
  void loadQuota();
  const poll = window.setInterval(() => {
    if (document.hidden || document.querySelector('.scrim')) return;
    void Promise.all([loadList(true, true), loadMine()]);
  }, REFRESH_MS);
  ctx.onDispose(() => window.clearInterval(poll));
}
