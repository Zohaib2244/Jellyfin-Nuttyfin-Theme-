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
