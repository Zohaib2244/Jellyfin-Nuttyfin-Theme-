/** PLACEHOLDER (Phase 1). The Details agent replaces this module; keep `export default page`. */
import type { Page } from '../types';
import { placeholderView } from '../placeholder';

const page: Page = {
  title: 'Title',
  async render(ctx) {
    const item = await ctx.backend.item(ctx.params.id ?? '').catch(() => null);
    if (item) ctx.shell.setTitle(item.name);
    return placeholderView(item?.name ?? 'Title not found', `Details placeholder for ${ctx.params.id ?? ''}.`);
  },
};
export default page;
