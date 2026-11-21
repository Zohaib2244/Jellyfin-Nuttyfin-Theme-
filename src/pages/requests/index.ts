/**
 * Requests page: two tabs in the top bar.
 *   #/requests           "Requests": follow requests from asked to ready to watch (admins: everyone's, with Approve/Decline)
 *   #/requests/discover  "Discover": Seerr's rails, genres and search; every title opens a details sheet first
 * Everything fails soft: when Seerr is not reachable the page says so in plain words and nothing else breaks.
 */
import type { SeerrCapabilities, SeerrQuota } from '../../api';
import { html } from '../../lib/html';
import { nutbot } from '../../ui/nutbot';
import '../common/common.css';
import { closeAllDialogs } from '../common/dialog';
import type { Page, PageContext } from '../types';
import { mountDiscover, type DiscoverPanel } from './discover';
import { mountList, type ListPanel } from './list';
import { quotaText } from './model';
import { openTitleSheet, type SheetEnv } from './sheet';
import './requests.css';

type TabId = 'requests' | 'discover';
const TABS = [{ id: 'requests', label: 'Requests' }, { id: 'discover', label: 'Discover' }] as const;
const SUB: Record<TabId, string> = {
  requests: 'Follow what has been asked for, from the first yes to ready to watch.',
  discover: 'Find films and shows that are not in the library yet, and request them.',
};

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
  let tab: TabId = ctx.params.tab === 'discover' ? 'discover' : 'requests';
  let query = new URLSearchParams(ctx.query);
  let quota: SeerrQuota | null = null;

  root.innerHTML = html`
    <header class="rq-head">
      <div><h1 class="page-h" data-autofocus tabindex="-1" id="rqh1">Requests</h1><p class="page-sub" id="rqsub"></p></div>
      <p class="rq-quotas" id="rqquota" aria-label="Your request allowance"></p>
    </header>
    <div id="rq-panel" role="tabpanel"></div>`.value;
  const panel = root.querySelector<HTMLElement>('#rq-panel') as HTMLElement;

  /** Tab and filters live in the URL without going through the router (which would rebuild the page). */
  const writeUrl = (): void => {
    const s = query.toString();
    const hash = `#/requests${tab === 'discover' ? '/discover' : ''}${s ? `?${s}` : ''}`;
    if (location.hash !== hash) history.replaceState(history.state, '', hash);
  };
  const setQuery = (q: Record<string, string | null>): void => {
    for (const [k, v] of Object.entries(q)) { if (v == null || v === '') query.delete(k); else query.set(k, v); }
    writeUrl();
  };

  const loadQuota = async (): Promise<SeerrQuota | null> => {
    quota = await ctx.backend.seerr.quota().catch(() => null);
    const parts = [quotaText(quota?.movie, 'movie'), quotaText(quota?.tv, 'tv')].filter((x): x is string => !!x && !x.startsWith('No limit'));
    const el = root.querySelector<HTMLElement>('#rqquota');
    if (el) el.innerHTML = parts.map(p => html`<span class="chip ${/^No (film|show) requests left/.test(p) ? 'declined' : 'info'}">${p}</span>`.value).join('');
    return quota;
  };

  let current: ListPanel | DiscoverPanel | null = null;
  const sheetEnv: SheetEnv = {
    backend: ctx.backend, caps,
    quota: loadQuota,
    onChanged: () => { void loadQuota(); current?.refresh(); },
    toast: m => ctx.shell.toast(m, 'check'),
    showMine: () => { select('requests', true); },
  };
  const open = (t: { tmdbId: number; mediaType: 'movie' | 'tv'; title?: string }): void => { openTitleSheet(sheetEnv, t); };

  function select(next: TabId, fromCode = false): void {
    if (next === tab && current) {
      // "Discover" while browsing: back to Discover's front page
      if (next === 'discover' && /[?&]type=/.test(location.hash)) ctx.router.navigate('/requests/discover');
      return;
    }
    current?.dispose();
    closeAllDialogs();
    tab = next;
    query = new URLSearchParams(); // filters belong to the tab they were set on
    writeUrl();
    show();
    if (fromCode) ctx.shell.selectTab(next);
  }

  function show(): void {
    (root.querySelector('#rqsub') as HTMLElement).textContent = SUB[tab];
    panel.setAttribute('aria-labelledby', `tab-${tab}`);
    panel.dataset.tab = tab;
    panel.innerHTML = '';
    const box = document.createElement('div');
    panel.append(box);
    const pctx: PageContext = { ...ctx, query };
    current = tab === 'discover'
      ? mountDiscover(box, { ctx: pctx, open, setQuery })
      : mountList(box, { ctx: pctx, caps, open, setQuery });
    if (!(tab === 'discover' && /[?&]type=/.test(location.hash))) ctx.shell.setTitle(tab === 'discover' ? 'Discover · Requests' : 'Requests'); // Browse names itself
  }

  ctx.shell.setTabs({ label: 'Requests sections', tabs: TABS, selected: tab, panelId: 'rq-panel', onSelect: id => { if (id === 'requests' || id === 'discover') select(id); } });
  show();
  void loadQuota();
  ctx.onDispose(() => { current?.dispose(); closeAllDialogs(); });
}
