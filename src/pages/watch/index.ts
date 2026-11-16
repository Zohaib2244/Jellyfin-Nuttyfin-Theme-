/** PLACEHOLDER (Phase 1). The Player agent replaces this module; keep `export default page`. The route hides the shell (chrome: none). */
import type { Page } from '../types';
import { html } from '../../lib/html';
import { placeholderView } from '../placeholder';

const page: Page = {
  title: 'Watch',
  render(ctx) {
    const v = placeholderView('Player', `Player placeholder for ${ctx.params.id ?? ''}. The shell is hidden on this route.`, html`<p><a class="btn" href="#/title/${ctx.params.id ?? ''}">Back</a></p>`.value);
    v.style.padding = '28px';
    return v;
  },
};
export default page;
