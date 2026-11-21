# Nuttyfin design preferences
- Web client only. Each person signs in with their own administrator-created Jellyfin account. No profile chooser, quick switching, shared Home profile, or TV/kids controls.
- Retain the conversational NutBot tile; do not add a second NutBot pick tile.
- Home contains essentials; organise additional widgets under Continue Watching, Recommendations, Requests, and Stats.
- No hover glows, pointer-following spotlights, or lifting cards.
- Login is its own opaque page with moving artwork and no added title labels.
- Keep the established warm palette and typography. Use compact accessible disclosure, tab, and menu patterns.
- Short on time and the weekly calendar (On TV this week) now live in the Explore tab, not Home. Mood navigation must have visible, keyboard-accessible controls and no overlapping buttons.
- The Newly Added tab (renamed from "New films" 2026-11-16) is its own tab and is the What's-new page (whats-new.html just redirects to home.html#new): summary hero, recently added with filters, on the way. Tabs: Home, Continue Watching, Explore (was Recommendations), Newly Added, Requests. No Stats tab.
- Navigation: left icon rail (Home/Movies/Shows/Requests/Saved) on desktop; section tabs sit in the top bar beside search; phones use the bottom tab bar.
- Section tabs share one row with the date and Arrange (no separate date row); the tab bar scrolls sideways on phones.
- Home = NutBot + Next episode beside the Keep watching hero, which holds the recommendations (a rail that swaps the hero); then New this week beside a compact Continue watching list (all in-progress items, "See all" opens the tab); No separate Picked for you or full Continue watching strip on Home.
- Every tile belongs to exactly one tab; never show the same tile in two tabs.
- Tiles must never look empty: give them enough real content (or richer rows) to fill their space at every width.

- Home and Continue Watching use static artwork and loading placeholders: no continuously moving backdrops, poster collages, or blinking mascots on these two tabs. Preserve their layout while prioritising smooth scrolling and clicks.

- NuttyFin must use a separate retro play-button identity, with no nut/acorn imagery and no NutBot mascot in the branding. Owner is choosing among variations. NutBot remains the assistant only. Login includes Remember me, with persistent or browser-session sign-in according to the checkbox.

- Keep the current bento-board identity when simplifying Home. Avoid replacing it with a generic streaming hero/shelf theme; show layout prototypes for selection before implementation.

## Owner update — 21 November 2026 (replaces earlier lines where they conflict)
- Home: the Keep watching hero (with its "Up next for you" rail) is the ONLY full-width tile, on top. Below it: New this week on the left; compact Continue watching above Next episode on the right.
- No Arrange button / layout editing. No date row on Home: the clock sits at the bottom of the left rail.
- Next episode tile: show name, S·E · episode title · runtime, Play + Details. No description. Use the show's backdrop (episode stills often have the title burnt in).
- NutBot is not a Home tile any more: a floating "Ask NutBot" button (bottom-right, every signed-in page except the player) opens the chat.
- Requests is no longer a Home tab; it is only the Requests page in the left rail. Home tabs: Home, Continue Watching, Explore, Newly Added.
- Page background: one still, tilted, very faint poster wall (an optimised variant of the New this week collage). No background picker; Page look keeps only Light/Dark/Auto. The "no moving collages" rule still holds: the wall never moves.
- Account menu holds Settings links to Jellyfin's own pages (profile, playback, subtitles, Quick Connect, all settings; owner: server dashboard and Seerr settings).
- Sign-in page: no Pause button; the poster wall shows at once and each poster fades in as it loads (small, cached images).
- Details: full-bleed, tall banner; hero holds only title/logo, one meta line, Play/Resume and a few icon buttons; overview, playability, audio/subtitles and credits sit below the banner.
- (21 Nov, later) Brand mark = the "Sticker" play tile (design/icon-variations/round-3/sticker.svg); inline copies follow the colour theme, favicon stays orange.
- Colour themes: AVN Hub's eight packs (Ember default, Slate, Moss, Plum, Reef, Berry, Circuit, Graphite), each with light and dark, picked in the account menu next to Light/Dark/Auto.
- Background: a choice of two — Dot grid (default) or Scrolling posters (the tilted wall, drifting slowly; stops under reduced motion). This replaces the "still wall only" line above.
