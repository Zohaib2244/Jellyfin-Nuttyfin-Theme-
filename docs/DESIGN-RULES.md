# Nuttyfin design preferences
- Web client only. Each person signs in with their own administrator-created Jellyfin account. No profile chooser, quick switching, shared Home profile, or TV/kids controls.
- Retain the conversational NutBot tile; do not add a second NutBot pick tile.
- Home contains essentials; organise additional widgets under Continue Watching, Recommendations, Requests, and Stats.
- No hover glows, pointer-following spotlights, or lifting cards.
- Login is its own opaque page with moving artwork and no added title labels.
- Keep the established warm palette and typography. Use compact accessible disclosure, tab, and menu patterns.
- Short on time and the weekly calendar (On TV this week) now live in the Explore tab, not Home. Mood navigation must have visible, keyboard-accessible controls and no overlapping buttons.
- The Newly Added tab (renamed from "New films" 2026-11-16) is its own tab and is the What's-new page (whats-new.html just redirects to home.html#new): summary hero, recently added with filters, on the way. Tabs: Home, Continue Watching, Explore (was Recommendations), Newly Added, Requests. No Stats tab.
- Navigation: left icon rail (Home/Library/Requests/Favourites) on desktop; section tabs sit in the top bar beside search; phones use the bottom tab bar (the same four items).
- Section tabs share one row with the date and Arrange (no separate date row); the tab bar scrolls sideways on phones.
- Home = NutBot + Next episode beside the Keep watching hero, which holds the recommendations (a rail that swaps the hero); then New this week beside a compact Continue watching list (all in-progress items, "See all" opens the tab); No separate Picked for you or full Continue watching strip on Home.
- Every tile belongs to exactly one tab; never show the same tile in two tabs.
- Tiles must never look empty: give them enough real content (or richer rows) to fill their space at every width.

- Home and Continue Watching use static artwork and loading placeholders: no continuously moving backdrops, poster collages, or blinking mascots on these two tabs. Preserve their layout while prioritising smooth scrolling and clicks.

- Nuttyfin (one spelling everywhere, wordmark "Nutty" + accent "fin") must use a separate retro play-button identity, with no nut/acorn imagery and no NutBot mascot in the branding. Owner is choosing among variations. NutBot remains the assistant only. Login includes Remember me, with persistent or browser-session sign-in according to the checkbox.

- Keep the current bento-board identity when simplifying Home. Avoid replacing it with a generic streaming hero/shelf theme; show layout prototypes for selection before implementation.

## Owner update — 21 November 2026 (replaces earlier lines where they conflict)
- Home: the Keep watching hero (with its "Up next for you" rail) is the ONLY full-width tile, on top. Below it: New this week on the left; compact Continue watching above Next episode on the right.
- No Arrange button / layout editing. No date row on Home: the clock sits at the bottom of the left rail.
- Next episode tile: show name, S·E · episode title · runtime, Play + Details. No description. Use the show's backdrop (episode stills often have the title burnt in).
- NutBot is not a Home tile any more: an "Ask NutBot" button in the top bar (next to the theme switch, every size, every signed-in page except the player) opens the chat. (Superseded 21 Nov, audit round: the floating bottom-right button is gone; it covered content on desktop and landscape phones.)
- Requests is no longer a Home tab; it is only the Requests page in the left rail. Home tabs: Home, Continue Watching, Explore, Newly Added.
- Page background: one still, tilted, very faint poster wall (an optimised variant of the New this week collage). No background picker; Page look keeps only Light/Dark/Auto. The "no moving collages" rule still holds: the wall never moves.
- Account menu holds Settings links to Jellyfin's own pages (profile, playback, subtitles, Quick Connect, all settings; owner: server dashboard and Seerr settings).
- Sign-in page: no Pause button; the poster wall shows at once and each poster fades in as it loads (small, cached images).
- Details: full-bleed, tall banner; hero holds only title/logo, one meta line, Play/Resume and a few icon buttons; overview, playability, audio/subtitles and credits sit below the banner.
- (21 Nov, later) Brand mark = the "Sticker" play tile (design/icon-variations/round-3/sticker.svg); inline copies follow the colour theme, favicon stays orange.
- Colour themes: AVN Hub's eight packs (Ember default, Slate, Moss, Plum, Reef, Berry, Circuit, Graphite), each with light and dark, picked in the account menu next to Light/Dark/Auto.
- Background: a choice of two — Dot grid (default) or Scrolling posters (the tilted wall, drifting slowly; stops under reduced motion). This replaces the "still wall only" line above.

## Owner update — 21 November 2026 (round 4)
- Home: "New this week" is now "Recently added": always the newest additions whatever their date (never empty unless the library is), a list of up to 9 (small poster, name, "Film/Show · 6 days ago") beside the still tilted collage, no big count; "See all" opens Newly Added.
- Newly Added banner shows ONLY when something was added since the last visit (first visit: the last 7 days); when nothing is new it is not rendered and the tiles below move up. The last visit is stored only after the banner has been on screen for a moment (a refresh before that keeps the news); the X marks it as seen until something new arrives.
- Newly Added "On the way": the person's own open requests with the Requests page's stages (one plain status line, a pill in the Requests chip colours, a progress bar only for a real download), "See all requests" to #/requests, an empty state that links to Discover.

## Owner update — 21 November 2026 (one navigation model)
- Rail = places (Home, Library, Requests, Favourites; "Saved" was a placeholder and is now Favourites, `#/favourites`: the person's hearted films and shows in the Library's poster grid, Films | Shows tabs in the top bar only when both exist, friendly empty state). Top-bar tabs = the sections of a place (Library: Movies, Shows, 4K Movies, Collections). No in-page tab bars, switch blocks or duplicate Movies/Shows links anywhere; Movies and Shows are reached only through Library.
- Page header: the tab names the page, so the h1 is screen-reader only and the visible header is one `.page-head` lede line (optional chips on the right). Home has none.
## Motion (21 November 2026)
Owner: "the website is missing some much needed animations": add them everywhere, but keep them purposeful. Code: `src/styles/motion.css` (the look), `src/lib/motion.ts` (pure helpers, unit-tested), `src/lib/motion-dom.ts` (one MutationObserver; no per-item timers, no markup changes in pages).
- Allowed: transform and opacity (plus tiny colour fades on small controls). Not allowed: glows, pointer-following effects, lifting cards, animated box-shadow/filter/layout, anything that loops. Home and Continue Watching stay still after their first paint.
- Durations come from `--d-*` / `--ease-*` in tokens.css; nothing over 400ms; list stagger is 20ms per item for the first 12 visible items, whole entrance under 450ms.
- Everything sits inside `prefers-reduced-motion: no-preference` in motion.css and is skipped in JS otherwise, so reduced motion gets instant, identical end states.
- What exists: page enter (View Transition, 12px rise; list items inside only fade while the page rises), thin route progress line after 150ms, list stagger (`data-enter` is stamped once on NEW, on-screen items of `.lc .sc .ep .pc .chap .person .rq-row .rq-tile .rq-gtile .rc .nli` and search results, never replayed on filter/view/season re-renders), image fade-in on `.ph`/`.pic` pictures, skeleton to content and tab-panel fades, press scale .97 on buttons/tabs/cards, heart pop, watched check draw, badge bump, progress bars grow from 0, request steppers fill in sequence, dialog/sheet/menu/NutBot open and close, rail indicator that slides between items, colour cross-fade on theme or palette change (`html.theme-switching` for ~300ms).
- Adding a list: add its item selector to `ITEM_SEL` in motion-dom.ts (give items `data-id` or a link so repeats are recognised). Opt out with `data-no-enter` on a container. A new overlay that is removed from the DOM: call `leave(el)` from `src/lib/motion.ts` and style `[data-leaving]`; one toggled with `[hidden]`: add it to the allow-discrete rule in motion.css. A forward-filling entrance (`animation-fill-mode: both`) swallows an exit transition, so use `backwards`.
- Never hide content to animate it: images wait at opacity 0 only while loading, with a timeout and an off-screen skip; nothing animated is `aria-hidden` or delays focus.

## Audit round (21 November 2026, fixer A)
- Unknown addresses (a typo, an unknown `:tab`) show a friendly 404 ("We could not find that page", NutBot sleepy, Home / Library). They never silently render Home.
- Every colour theme (8 palettes x light/dark) meets WCAG AA: 4.5:1 for text and counts, `accent-ink` on `accent` too (3:1 for the accent on the bare page backdrop, which only carries large/UI marks). `tests/contrast.test.ts` reads tokens.css + palettes.css; run it after touching a colour. Light themes therefore use deeper accents than the dark ones.
- Section-tab strips (top bar): the selected tab is scrolled into view on load, a soft edge fade shows where more tabs hide, and arrow keys / focus scroll the strip. On phones the strip sits under the sticky top bar and scrolls away with the page; on short landscape screens (height <= 500px) search collapses to an icon and the slim left rail stays.
- Home strips with many cards (Continue Watching, Picked for you, moods, New films) have back / forward buttons on desktop. A show with several new episodes is ONE row ("26 new episodes", one Play to the next unwatched). Newly Added has no in-page switch: new films are one fixed "last two months, newest first" rail.
- Library: "Shelves" is the Collections tab, not a look. The phone sheet is "Sort and filter". NutBot's Library line can be put away for the day. The A to Z handle shows on phones only while the list is moving. A letter heading is a thin full-width row, never a poster-sized cell.
