/**
 * The "Requests" tab. Admins (manage permission) see everyone's requests with who asked, a person filter and
 * Approve / Decline on the pending ones; members see only their own. Rows are grouped by where they are on the
 * journey (stage.ts), with filter chips that carry counts.
 * Title, artwork and release dates load lazily per row as it scrolls into view (one cached lookup per title).
 */
import { explainRequestError } from '../../api/seerr-desk';
import type { DeskRequest, SeerrCapabilities, SeerrIssue, TitleFacts } from '../../api/desk-types';
import { html } from '../../lib/html';
import { nutbot } from '../../ui/nutbot';
import { ic } from '../common/icons';
import type { PageContext } from '../types';
import { countOpenRequests } from '../../state/openRequests';
import { openProblemDialog } from './problems';
import { GROUPS, requestStage, type Stage, type StageGroup } from './stage';
import { issueRow, requestRow, skeletonRows } from './ui';

type Filter = 'all' | StageGroup;
const FIRST = 8;
const REFRESH_MS = 30_000;

export interface ListEnv {
  ctx: PageContext;
  caps: SeerrCapabilities;
  open(t: { tmdbId: number; mediaType: 'movie' | 'tv'; title?: string }): void;
  setQuery(q: Record<string, string | null>): void;
}

export interface ListPanel { refresh(): Promise<void>; dispose(): void }

export function mountList(el: HTMLElement, env: ListEnv): ListPanel {
  const { ctx, caps } = env;
  const seerr = ctx.backend.seerr;
  const admin = caps.perms.manageRequests;
  const q0 = ctx.query;
  const st = {
    filter: (GROUPS.some(g => g.id === q0.get('show')) ? q0.get('show') : 'all') as Filter,
    person: admin ? (q0.get('person') ?? '') : '',
    items: [] as DeskRequest[],
    facts: new Map<string, TitleFacts | null>(),
    expanded: new Set<StageGroup>(),
    issues: [] as SeerrIssue[],
    loaded: false,
  };
  let alive = true;
  const key = (r: Pick<DeskRequest, 'mediaType' | 'tmdbId'>): string => `${r.mediaType}:${r.tmdbId}`;

  el.innerHTML = html`
    <div class="rq-tools">
      <div class="rq-filters" role="group" aria-label="Show requests that are">
        ${[{ id: 'all', label: 'All' }, ...GROUPS].map(f => html`<button type="button" class="rq-fchip" data-filter="${f.id}" aria-pressed="${st.filter === f.id}">${f.label}<span class="n" aria-hidden="true"></span><span class="sr nsr"></span></button>`)}
      </div>
      <div class="rq-toolside">
        ${admin ? html`<label class="rq-person"><span class="lbl">Asked by</span><select id="rqperson"><option value="">Everyone</option></select></label>` : ''}
        ${caps.perms.createIssues ? html`<button class="btn sm ghost" type="button" id="rqreport">${ic('flag')}Report a problem</button>` : ''}
      </div>
    </div>
    <div id="rqgroups" aria-live="polite">${skeletonRows(4)}</div>
    <section class="rq-probs" id="rqprobs" hidden aria-labelledby="rq-pr-h"><h2 class="rq-gh" id="rq-pr-h">Your problem reports</h2><ul class="rq-issues" id="rqissues"></ul></section>`.value;

  const groupsEl = el.querySelector<HTMLElement>('#rqgroups') as HTMLElement;
  const personSel = el.querySelector<HTMLSelectElement>('#rqperson');

  const stageOf = (r: DeskRequest, now: Date): Stage => requestStage(r, st.facts.get(key(r)) ?? null, now);
  const visible = (): DeskRequest[] => st.items.filter(r => !st.person || String(r.requestedById ?? r.requestedBy) === st.person);

  function paintCounts(list: DeskRequest[], stages: Map<number, Stage>): void {
    const n: Record<Filter, number> = { all: list.length, pending: 0, onway: 0, added: 0, removed: 0, declined: 0 };
    for (const r of list) n[(stages.get(r.id) as Stage).group]++;
    el.querySelectorAll<HTMLElement>('[data-filter]').forEach(b => {
      const f = b.dataset.filter as Filter;
      b.setAttribute('aria-pressed', String(st.filter === f));
      const badge = b.querySelector<HTMLElement>('.n') as HTMLElement;
      badge.textContent = String(n[f]);
      badge.classList.toggle('hot', f === 'pending' && admin && n[f] > 0);
      (b.querySelector('.nsr') as HTMLElement).textContent = `, ${n[f]}`;
    });
  }

  function paintPeople(): void {
    if (!personSel) return;
    const people = new Map<string, string>();
    for (const r of st.items) {
      const id = String(r.requestedById ?? r.requestedBy);
      if (!people.has(id)) people.set(id, r.requestedById === caps.userId ? `${r.requestedBy || 'Me'} (you)` : r.requestedBy || 'Someone');
    }
    const opts = [...people].sort((a, b) => a[1].localeCompare(b[1]));
    personSel.innerHTML = html`<option value="">Everyone (${st.items.length})</option>${opts.map(([id, name]) => html`<option value="${id}">${name} (${st.items.filter(r => String(r.requestedById ?? r.requestedBy) === id).length})</option>`)}`.value;
    personSel.value = people.has(st.person) ? st.person : '';
  }

  function paint(): void {
    const now = new Date();
    const list = visible();
    const stages = new Map(list.map(r => [r.id, stageOf(r, now)] as const));
    paintCounts(list, stages);
    const focusKey = document.activeElement instanceof HTMLElement && groupsEl.contains(document.activeElement)
      ? { id: document.activeElement.closest<HTMLElement>('[data-req-id]')?.dataset.reqId, sel: document.activeElement.dataset.act ? `[data-act="${document.activeElement.dataset.act}"]` : '.rq-tlink' }
      : null;
    if (!list.length) {
      groupsEl.innerHTML = quiet(st.items.length ? 'Nobody matches that filter.' : admin ? 'Nobody has asked for anything yet. Find something on the Discover tab.' : 'You have not asked for anything yet. Find something on the Discover tab and press Request.');
      return;
    }
    const rc = { caps, showWho: admin && !st.person, now };
    const groups = GROUPS.filter(g => st.filter === 'all' || st.filter === g.id);
    groupsEl.innerHTML = groups.map(g => {
      let rows = list.filter(r => stages.get(r.id)?.group === g.id);
      if (g.id === 'added' || g.id === 'removed' || g.id === 'declined') rows = rows.sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
      if (g.id === 'pending') rows = rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest question first
      if (!rows.length) return st.filter === 'all' ? '' : quiet(g.empty);
      const limit = st.filter === 'all' && !st.expanded.has(g.id) ? FIRST : rows.length;
      const shown = rows.slice(0, limit);
      return html`<section class="rq-group" aria-labelledby="rqg-${g.id}">
        <h2 class="rq-gh" id="rqg-${g.id}">${g.id === 'added' ? 'Added recently' : g.label}<span class="cnt">${rows.length}</span></h2>
        <ul class="rq-rows">${shown.map(r => requestRow(r, stages.get(r.id) as Stage, { ...rc, loading: !r.title && !st.facts.has(key(r)) }))}</ul>
        ${rows.length > limit ? html`<button type="button" class="btn sm ghost rq-more" data-more="${g.id}">Show all ${rows.length}</button>` : ''}
      </section>`.value;
    }).join('') || quiet('Nothing here.');
    groupsEl.removeAttribute('aria-busy');
    if (focusKey?.id) groupsEl.querySelector<HTMLElement>(`[data-req-id="${focusKey.id}"] ${focusKey.sel}`)?.focus({ preventScroll: true });
    observe();
  }

  const quiet = (text: string): string => `<p class="rq-quiet">${nutbot(34, 'look').value}<span>${text.replace(/[<>&]/g, '')}</span></p>`;

  /* ── lazy title facts: only rows near the screen ask for them ── */
  let pending = new Set<string>();
  let paintQueued = 0;
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const row = e.target as HTMLElement;
      const r = st.items.find(x => String(x.id) === row.dataset.reqId);
      if (r) void loadFacts(r);
    }
  }, { rootMargin: '300px 0px' });

  function observe(): void {
    io.disconnect();
    groupsEl.querySelectorAll<HTMLElement>('[data-req-id]').forEach(row => {
      const r = st.items.find(x => String(x.id) === row.dataset.reqId);
      if (r && !st.facts.has(key(r))) io.observe(row);
    });
  }

  async function loadFacts(r: DeskRequest): Promise<void> {
    const k = key(r);
    if (st.facts.has(k) || pending.has(k)) return;
    pending.add(k);
    const f = await seerr.titleFacts(r.mediaType, r.tmdbId, ctx.signal).catch(() => null);
    pending.delete(k);
    if (!alive) return;
    st.facts.set(k, f);
    if (f) for (const x of st.items) if (key(x) === k) { x.title ||= f.title; x.year ??= f.year; x.posterPath ??= f.posterPath; }
    // many rows land together: paint once per frame
    if (!paintQueued) paintQueued = requestAnimationFrame(() => { paintQueued = 0; if (alive) paint(); });
  }

  async function load(): Promise<void> {
    const res = await seerr.allRequests({ scope: admin ? 'all' : 'mine' });
    if (!alive) return;
    // a member only ever sees their own, even if Seerr would answer with more
    st.items = admin ? res.items : res.items.filter(r => r.requestedById == null || r.requestedById === caps.userId);
    for (const r of st.items) {
      const k = key(r);
      if (!st.facts.has(k)) { const c = seerr.cachedFacts(r.mediaType, r.tmdbId); if (c) st.facts.set(k, c); }
    }
    st.loaded = true;
    paintPeople();
    paint();
    ctx.shell.setRequestsBadge(countOpenRequests(st.items, caps.userId));
  }

  async function loadIssues(): Promise<void> {
    if (!caps.perms.createIssues && !caps.perms.viewIssues) return;
    st.issues = await seerr.issues({ mine: true, take: 6 });
    if (!alive) return;
    const box = el.querySelector<HTMLElement>('#rqprobs') as HTMLElement;
    box.hidden = !st.issues.length;
    (el.querySelector('#rqissues') as HTMLElement).innerHTML = st.issues.map(i => issueRow(i, new Date()).value).join('');
  }

  /* ── events ── */
  el.addEventListener('click', e => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const f = t.closest<HTMLElement>('[data-filter]');
    if (f) { st.filter = f.dataset.filter as Filter; env.setQuery({ show: st.filter === 'all' ? null : st.filter }); paint(); return; }
    const more = t.closest<HTMLElement>('[data-more]');
    if (more) {
      const g = more.dataset.more as StageGroup;
      st.expanded.add(g);
      const count = groupsEl.querySelectorAll(`#rqg-${g} ~ .rq-rows > li`).length;
      paint();
      groupsEl.querySelectorAll<HTMLElement>(`#rqg-${g} ~ .rq-rows > li .rq-tlink`)[count]?.focus();
      return;
    }
    const open = t.closest<HTMLElement>('[data-open]');
    if (open) { env.open({ tmdbId: Number(open.dataset.open), mediaType: open.dataset.type === 'tv' ? 'tv' : 'movie', title: open.dataset.title || undefined }); return; }
    if (t.closest('#rqreport')) { openProblemDialog({ backend: ctx.backend, ownerName: 'The server owner', isOwner: caps.perms.isAdmin, onSent: () => { void loadIssues(); } }); return; }
    const act = t.closest<HTMLButtonElement>('[data-act]');
    if (act) void decide(act);
  });
  personSel?.addEventListener('change', () => { st.person = personSel.value; env.setQuery({ person: st.person || null }); paint(); });

  async function decide(btn: HTMLButtonElement): Promise<void> {
    const id = Number(btn.dataset.id);
    const yes = btn.dataset.act === 'approve';
    const r = st.items.find(x => x.id === id);
    if (!r || !admin) return;
    const row = btn.closest<HTMLElement>('.rq-row');
    row?.querySelectorAll('button').forEach(b => { b.disabled = true; });
    row?.setAttribute('aria-busy', 'true');
    const name = r.title || 'it';
    try {
      if (yes) await seerr.approveRequest(id); else await seerr.declineRequest(id);
      ctx.shell.toast(yes ? `Approved ${name}` : `Declined ${name}`, 'check');
      await load();
    } catch (err) {
      row?.removeAttribute('aria-busy');
      row?.querySelectorAll('button').forEach(b => { b.disabled = false; });
      ctx.shell.toast(explainRequestError(err).reason === 'permission' ? 'Your account is not allowed to do that.' : 'That did not work. Try again in a moment.', 'info');
    }
  }

  /* ── first load and a slow refresh while something is downloading ── */
  groupsEl.setAttribute('aria-busy', 'true');
  void load();
  void loadIssues();
  const poll = window.setInterval(() => {
    if (document.hidden || document.querySelector('.scrim') || !st.items.some(r => r.downloads.length || r.requestStatus === 1)) return;
    void load();
  }, REFRESH_MS);

  return {
    refresh: load,
    dispose() { alive = false; io.disconnect(); window.clearInterval(poll); if (paintQueued) cancelAnimationFrame(paintQueued); pending = new Set(); },
  };
}
