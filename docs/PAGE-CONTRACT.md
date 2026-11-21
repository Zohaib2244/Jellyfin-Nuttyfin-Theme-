# Page contract

A page is a module that default-exports a `Page` (`src/pages/types.ts`). Routes live in `src/routes.ts`; each `load` is a lazy `import()`.
To replace a placeholder, rewrite the module the route points to and keep `export default page`.

```ts
const page: Page = {
  title: 'Movies',                       // fallback document title ("Movies · Nuttyfin")
  async render(ctx) {                    // once per visit; return the page element
    ctx.shell.setTabs(...);              // optional: fill the section-tabs slot in the top bar
    const data = await ctx.backend.items({ kind: 'movie' }, ctx.signal);
    ctx.onDispose(() => clearInterval(timer));   // cleanup when the person leaves
    return el;
  },
};
export default page;
```

## PageContext
| field | meaning |
|---|---|
| `backend` | the only way to reach servers (`Backend`: Jellyfin or demo). Never call `fetch`. |
| `router` | `navigate(path, {replace})`, `back()`, `href(path)`, `replaceQuery({...})` (filters in the URL without re-render), `current` |
| `shell` | `ShellHooks`, see below |
| `params` / `query` | route params (`#/title/:id` gives `{ id }`, `#/home/:tab?` gives `{ tab }`) and the hash query string |
| `signal` | aborted when the person navigates away; pass to `backend.items/search/...` |
| `user` | the signed-in `User` |
| `onDispose(fn)` | register cleanup for timers, listeners, observers |

## ShellHooks (what a page may ask of the shell)
- `setTabs({ label, tabs, selected, onSelect, panelId? })` (a tab may carry a small `count`; a page whose tabs are separate URLs, like Library, does `router.navigate` in `onSelect` and calls `selectTab` as its state changes) / `setTabs(null)`: section tabs in the top bar (keyboard-accessible tablist). The router empties the slot on every navigation, so set tabs at the start of `render`. `selectTab(id)` moves the selection without `onSelect`. `tabsSlot` is the raw element for anything fancier.
- `setTitle(text)`: `document.title` = "text · Nuttyfin".
- `setRequestsBadge(n)`: number on the Requests rail item.
- `setAmbient(url)` / `setWallImages(urls)`: feed the "Ambient colour" and "Poster wall" page backgrounds (picker entries appear once `wired: true` in `src/ui/shell/pagebg.ts`).
- `toast(msg, icon?)`, `focusSearch()`.

Pages never render navigation, search, or a different header. The only header is `.page-head` (base.css): an sr-only `h1` plus one `.page-sub` lede line and optional chips; the tabs in the top bar are the page title. The rail, top bar and the ONE search are the shell's.

## Rules the router gives you
- Not signed in: redirected to `#/login?next=...`. Login and `#/watch/:id` hide the whole shell (`chrome: 'none'` in the route).
- Old page stays visible until `render` resolves, then a View Transition (or CSS fade) swaps the content.
- After a swap, focus goes to `[data-autofocus]`/`[autofocus]`, else the first `h1`: give every page an `h1`.
- Back/forward restores scroll; new navigations start at the top. Lists that fill in late are fine (restore retries for ~1.5 s).
- A throw/reject in `render` shows a friendly "Something went wrong / Try again" page.

## Styling
Use tokens from `src/styles/tokens.css` and the classes in `base.css` (`.btn`, `.card`, `.chip`, `.prog`, `.ph`, `.page-h`, `.page-sub`, `.empty`). Per-page CSS: put a `*.css` next to the page and `import './x.css'` from the page module (it loads lazily with the page). Icons: `icon('name')` from `src/ui/icons.ts`. Markup: `html` from `src/lib/html.ts` (escapes; nest templates freely).
