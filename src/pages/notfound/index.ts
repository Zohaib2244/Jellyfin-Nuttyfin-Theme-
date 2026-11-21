/** A friendly "no such page" for any address the router does not know (typed wrong, an old link). Never silently shows Home. */
import './notfound.css';
import { html, setHtml } from '../../lib/html';
import { nutbot } from '../../ui/nutbot';
import type { Page } from '../types';

const page: Page = {
  title: 'Page not found',
  render(ctx) {
    const el = document.createElement('section');
    el.className = 'page nf404';
    setHtml(el, html`<div class="nf404-card">
      ${nutbot(88, 'sleepy')}
      <div>
        <h1 class="page-h" data-autofocus tabindex="-1">We could not find that page</h1>
        <p class="page-sub">The link may be old, or there may be a typing slip in the address.</p>
        <div class="acts">
          <a class="btn primary" href="${ctx.router.href('/')}">Home</a>
          <a class="btn" href="${ctx.router.href('/movies')}">Library</a>
        </div>
      </div>
    </div>`);
    return el;
  },
};
export default page;
