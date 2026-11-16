/** PLACEHOLDER (Phase 1). The Requests agent replaces this module; keep `export default page`. */
import type { Page } from '../types';
import { placeholderView } from '../placeholder';

const page: Page = {
  title: 'Requests',
  async render(ctx) {
    const on = await ctx.backend.seerr.available();
    return placeholderView('Requests', on ? 'Requests placeholder. Seerr is connected.' : 'Requests placeholder. Requests are not available right now.');
  },
};
export default page;
