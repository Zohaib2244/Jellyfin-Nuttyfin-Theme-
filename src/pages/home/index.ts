/** PLACEHOLDER (Phase 1). The Home agent replaces this module; keep `export default page`. */
import type { Page } from '../types';
import { placeholderView } from '../placeholder';

const TABS = [
  { id: 'home', label: 'Home' }, { id: 'continue', label: 'Continue Watching' }, { id: 'explore', label: 'Explore' },
  { id: 'new', label: 'New films' }, { id: 'requests', label: 'Requests' },
] as const;

const page: Page = {
  title: 'Home',
  render(ctx) {
    const current = TABS.find(t => t.id === ctx.params.tab)?.id ?? 'home';
    ctx.shell.setTabs({
      label: 'Home sections', tabs: TABS, selected: current,
      onSelect: id => ctx.router.navigate(id === 'home' ? '/' : `/home/${id}`),
    });
    const name = TABS.find(t => t.id === current)?.label ?? 'Home';
    return placeholderView(name === 'Home' ? `Hi ${ctx.user?.name ?? ''}` : name, `Home placeholder. Tab: ${current}. The section tabs above come from ctx.shell.setTabs.`);
  },
};
export default page;
