/**
 * Favourites (#/favourites): the films and shows this person has hearted, in the Library's poster grid.
 * Films | Shows tabs in the top bar appear only when both exist; with only one kind that kind is simply shown.
 */
import type { Title } from '../../api/types';
import { html, setHtml } from '../../lib/html';
import { nutbot } from '../../ui/nutbot';
import { ic } from '../common/icons';
import '../common/common.css';
import '../library/library.css';
import { cardHTML, type CardCtx } from '../library/cards';
import type { Page, PageContext } from '../types';
import { favouriteView, type FavTab } from './model';

const LIMIT = 500;

const page: Page = {
  title: 'Favourites',
  async render(ctx: PageContext): Promise<HTMLElement> {
    const { backend, router } = ctx;
    const [films, shows] = await Promise.all([
      backend.items({ kind: 'movie', favourite: true, sort: 'name', descending: false, limit: LIMIT }, ctx.signal).then(r => r.items).catch(() => [] as Title[]),
      backend.items({ kind: 'series', favourite: true, sort: 'name', descending: false, limit: LIMIT }, ctx.signal).then(r => r.items).catch(() => [] as Title[]),
    ]);

    const root = document.createElement('section');
    root.className = 'page lib fav';
    setHtml(root, html`
      <header class="page-head">
        <h1 class="sr" id="favTitle" data-autofocus tabindex="-1">Favourites</h1>
        <p class="page-sub" id="favLede"></p>
      </header>
      <div class="resw norail"><div class="res v-posters" id="favRes" role="list" aria-label="Favourites"></div></div>`);
    const res = root.querySelector<HTMLElement>('#favRes') as HTMLElement;
    const lede = root.querySelector<HTMLElement>('#favLede') as HTMLElement;
    const cx: CardCtx = { href: p => router.href(p), seasons: new Map(), nextUp: new Map(), now: Date.now() };

    let want: FavTab = ctx.params.tab === 'shows' ? 'shows' : 'films';
    const paint = (): void => {
      const v = favouriteView(films.length, shows.length, want);
      const list = v.tab === 'shows' ? shows : films;
      lede.innerHTML = v.lede;
      if (!list.length) {
        res.className = 'res';
        res.removeAttribute('role');
        res.innerHTML = html`<div class="lempty">${nutbot(64, 'look')}<div>
          <h2>Nothing here yet</h2>
          <p>Tap the heart on any film or show and it shows up here.</p>
          <div class="acts"><a class="btn sm primary" href="${router.href('/movies')}">${ic('film')}Open the Library</a></div>
        </div></div>`.value;
        return;
      }
      res.className = 'res v-posters';
      res.setAttribute('role', 'list');
      res.innerHTML = list.map(t => html`<div class="lc${t.played && t.kind === 'movie' ? ' seen' : ''}" role="listitem" data-id="${t.id}">${cardHTML(t, 'posters', cx)}</div>`.value).join('');
    };

    if (films.length && shows.length) {
      const tabs = [{ id: 'films', label: 'Films', count: films.length }, { id: 'shows', label: 'Shows', count: shows.length }];
      ctx.shell.setTabs({
        label: 'Favourites sections', tabs, selected: want, panelId: 'favRes',
        onSelect: id => {
          want = id === 'shows' ? 'shows' : 'films';
          const hash = want === 'shows' ? '#/favourites/shows' : '#/favourites';
          if (location.hash !== hash) history.replaceState(history.state, '', hash);
          ctx.shell.setTitle(want === 'shows' ? 'Favourite shows' : 'Favourite films');
          paint();
        },
      });
    }
    paint();
    return root;
  },
};
export default page;
