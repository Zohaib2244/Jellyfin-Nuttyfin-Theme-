/** PLACEHOLDER (Phase 1). The Library agent replaces this module; keep `export default page`. */
import type { Page } from '../types';
import { placeholderView } from '../placeholder';

const page: Page = {
  title: 'Movies',
  async render(ctx) {
    const r = await ctx.backend.items({ kind: 'movie', limit: 1 }, ctx.signal).catch(() => null);
    return placeholderView('Movies', r ? `Library placeholder. ${r.total} in the library.` : 'Library placeholder. The library could not be read.');
  },
};
export default page;
