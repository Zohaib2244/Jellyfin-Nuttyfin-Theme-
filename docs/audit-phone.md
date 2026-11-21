# Nuttyfin phone audit (21 November 2026)

Scope: the whole signed-in app and the login page on phones, against the live server read-only. Nothing was written to Jellyfin or Seerr (I opened the Request sheet and the Remove dialog and closed them without confirming; no favourite, watched, request or playback actions).

Method: Playwright Chromium mobile contexts (isMobile, hasTouch, deviceScaleFactor 2) at 390x844, 360x640 and 844x390 landscape, against the Vite dev server on :5174. I looked at the screenshots and also measured overflow, tap-target sizes, font sizes and contrast with scripts. Dark and light were checked, plus the Slate, Plum, Circuit and Graphite colour themes (Ember is the default).

Screenshots are in `/tmp/claude-1000/-home-nutmag2469/7e5aea1b-8289-4fc0-be7a-e51672e93cb8/scratchpad/audit-p/`. Filenames below are relative to that folder.

Not verified: real iOS/Android behaviour (a real on-screen keyboard, real safe-area insets, rubber-banding), the YouTube trailer (the embed is blocked in this sandbox, so only a black box rendered), the NutBot reply timing, the Seerr write paths, and the player (out of scope). The "keyboard open" cases are a simulation (the viewport shrunk to 420-430px high).

Overall: no horizontal page overflow on any page at 360 or 390 wide (`scrollWidth == innerWidth` everywhere), bottom bar and sheets respect `env(safe-area-inset-bottom)`, and the fixed bottom bar never hides the last item (main has 110px bottom padding). The problems are a handful of real bugs, several clipped or awkward spots, and a set of design-rule inconsistencies.

Counts: 7 bugs, 24 ux, 14 polish (45 findings).

Themes tested: Ember dark and light, Slate dark, Plum light, Circuit dark, Graphite light, on Home, Library, Details and Requests (`theme-*.png`). There were no theme-specific layout problems. The only palette-related finding is contrast (U-22).

---

## Bugs

### B-1  Request sheet, step 2: heading text is cut off behind the poster
- Where: Requests, Discover, any title, "Request", step 2 of 2. 390x844 and 360x640.
- Repro: `#/requests/discover`, tap a title (e.g. Steps), tap Request.
- Wrong: the header text starts under the poster thumbnail. It reads "TEP 2 OF 2", "equest Steps", "ilm · 2026" (first letter of each line lost). Step 1 is fine.
- Fix: the step-2 header grid/flex has no left offset for the poster (poster is out of flow or overlaps). Give the text block `min-width:0` and a column after the poster in `src/pages/requests/sheet.ts` plus `requests.css` (`.rq-dlg` head).
- Screenshots: `req-step2-phone.png`, `req-step2-small.png`.

### B-2  Rail "Requests" badge changes number depending on the page (18 vs 58)
- Where: bottom bar, all pages, 390x844.
- Repro: open Home (badge 18), open Library (18), open Requests (58). Go back to Home or Library: it is 18 again.
- Wrong: the same badge uses two different definitions of "open". Home sets it from `requestSummary()` (not available, not declined), Requests sets it from items asked by this user that are open. The number visibly jumps on every navigation.
- Fix: one function computing the count, called from both (`src/pages/home/index.ts:165`, `src/pages/requests/list.ts:172`). Better, compute it once in the shell.
- Screenshots: `home-390-s1.png` (18), `req-main-390.png` (58).

### B-3  Deep link or reload on a tab leaves the selected tab half off-screen
- Where: top-bar section tabs, Home "Newly Added", 390x844 (and 360).
- Repro: open `#/home/new` directly or reload it.
- Wrong: "Newly Added" is the selected tab but sits at x=315-432 on a 390px screen (`scrollLeft` stays 0). Tapping a tab scrolls it into view; loading it does not. The same happens for any selected tab past the fold.
- Fix: in `renderTabs`/`selectTab` (`src/ui/shell/tabs.ts`) call `scrollIntoView({inline:'center', block:'nearest'})` on the selected tab after render.
- Screenshots: `new-390-s0.png`, `tabs-phone-new.png`.

### B-4  Landscape phone: the floating NutBot button covers page content
- Where: any signed-in page, 844x390 (landscape gets the desktop layout because 844 > 760).
- Repro: rotate to landscape, open Home.
- Wrong: the 60px round button sits bottom-right, over the "Up next for you / All >" header and the first card of the hero rail, and over the corner of other tiles. There is no phone-style top-bar button here, so it cannot be avoided.
- Fix: use the phone layout (top-bar NutBot button) for short viewports too (`@media (max-width:760px), (max-height:500px)`), or at least give main bottom/right padding.
- Screenshots: `land-home.png`, `land-det.png`.

### B-5  Details "More" menu is shifted 6px off the left edge
- Where: Details (film), tap the "..." button. Measured at 390x844 only.
- Wrong: the menu's left edge is at x=-6, so its border and radius are clipped by the screen edge. The menu is 260px wide and positioned from the button, not clamped to the viewport.
- Fix: clamp left to `max(12px, ...)` in the menu positioning (`src/pages/details/index.ts` more-menu code, `.menu` rules in `details.css`).
- Screenshots: `det-more-menu2.png`.

### B-6  Season tab with the "Watching" pill breaks "Season 1" over two lines
- Where: Details of a multi-season show where the current season is not the selected one (e.g. Teenage Mutant Ninja Turtles), 390x844.
- Wrong: the tab reads "Season" / "1" on two lines with the pill beside it; the two tabs have different heights and the label looks broken. Also `.seasontabs` has `overflow: visible` and two tabs already fill the 358px row, so a show with 3+ seasons will probably wrap or push past the edge rather than scroll (not tested; no show in this library has more than 2 seasons).
- Fix: `white-space:nowrap` on the label, drop the pill to its own line or an icon-only dot, and make `.seasontabs` a horizontally scrolling strip (`details.css`).
- Screenshots: `det-seasons2.png`, `det-episode-expanded.png`.

### B-7  Some request rows stay on "Loading…" with no poster
- Where: Requests, All (13 rows after 9 seconds), also in Removed. 390x844.
- Repro: `#/requests`, scroll the list.
- Wrong: the title link shows "Loading…" permanently and the poster is a failed `/jf/Items/56b3b78b…/Images/Primary` request (404 in console, empty 48x72 box). The row is therefore untappable in practice (the link text is "Loading…") and looks unfinished.
- Fix: fall back to the Seerr title or a "Title unavailable" label and a placeholder poster when the lookup fails (`src/pages/requests/list.ts`, `ui.ts`).
- Screenshots: `req-main-390.png` (first rows), `req-broken-img.png`.

---

## UX

### U-1  Section tabs strip has no scroll affordance and clips mid-word
- Where: Home (4 tabs), Library (4 tabs), 390 and 360 wide.
- Wrong: the strip is wider than the screen (Home 420 vs 374 visible). The last tab shows as "Newly A", "Collectic" (at 360 "New"). The cut-off word is the only hint that it scrolls: no fade, no chevron, no peek of snap. On Home, a person on "Home" does not know there are more tabs than "Explore".
- Fix: add a right-edge mask-image fade on `.section-nav` when `scrollWidth > clientWidth`, and shrink tab padding so 4 tabs nearly fit (`shell.css` `.toptabs .section-nav`). Shorter labels ("Continue", "Newly added") would also fit.
- Screenshots: `tabs-phone-home.png`, `tabs-small-home.png`, `lib-movies-390.png`.

### U-2  Sticky chrome eats a lot of the small screens
- Where: all pages with section tabs, 390x844 and especially 360x640.
- Wrong: top bar (58) + tab row (49) = 108px fixed on top, plus the 72px bottom bar. That is 180px (21%) of 844 and 28% of 640, always on screen, though the tabs are rarely used mid-scroll. A Library page at 640 high shows about 2 rows of posters.
- Fix: hide the tab row on scroll down and bring it back on scroll up (translate the `.toptabs` row only), or let it scroll away with the page.
- Screenshots: `small-lib.png`, `small-home.png`.

### U-3  Landscape phone gets the desktop layout with squeezed tabs
- Where: any tabbed page, 844x390.
- Wrong: the tab strip shares the top row with a 220px search box and ends up 344px wide, so "Newly Added" becomes "New" and "Collections" becomes "Coll" with a hard clip; no scroll cue. The left rail drops its labels. The remaining viewport after the 67px top bar is only 320px.
- Fix: for `max-height:500px` use the phone layout (search as an icon, tabs on their own row or collapsed), see B-4.
- Screenshots: `land-home.png`, `land-lib.png`, `tabs-land-home.png`.

### U-4  Details hero is taller than the landscape screen
- Where: Details, 844x390.
- Wrong: the full-bleed hero fills the whole 390px-high viewport, so on a landscape phone the title is at the bottom edge and Play, the icon buttons and the overview are all below the fold. A person has to scroll before they can press Play.
- Fix: cap hero height (e.g. `max-height: 60dvh`) in landscape (`details.css`).
- Screenshots: `land-det.png`.

### U-5  "Saved" in the bottom bar does nothing
- Where: bottom bar, every page.
- Repro: tap Saved.
- Wrong: a toast says "Saved is coming soon" and the tab shows as pressed/dark. One of the four places (25% of the bar) is a dead end, and the owner's rule says tiles must never look empty; a nav item that does nothing is the same problem.
- Fix: hide the item until it exists, or make it a real (even if short) page. In `src/ui/shell/shell.ts` the `NAV` entry has no `href`.
- Screenshots: `toast-saved.png`.

### U-6  Library: count row text is truncated and is self-referential helper text
- Where: Library Movies and Shows, 390 and 360.
- Wrong: next to "159 films" the line "Everything. Press a switch to n..." is cut off mid-word, in all three themes. It is helper text that explains the page to itself (the owner's rule says no self-referential helper text), and when it is cut it explains nothing.
- Fix: remove it, or show it only when no filter is active and it fits; otherwise show the active-filter summary. In `library.ts` (count row) and `.lib .count` in `library.css`.
- Screenshots: `lib-wall.png`, `lib-tab-shows.png`, `theme-ember-dark-lib.png`.

### U-7  Library "Filters" button opens a sheet called "Mix your list"; sort and view modes exist only inside it
- Where: Library, 390x844.
- Wrong: the trigger says "Filters" but the sheet is titled "Mix your list" (two names for one thing). The sort and view-mode controls (Posters, Wall, List, Shelves, Just added, A to Z, Shortest, Best rated, Newest year) are hidden on phones (`.ctlrow {display:none}`), so someone looking for "sort by A to Z" will not look under "Filters". The same page on desktop shows them in the open.
- Fix: rename consistently ("Sort and filter"), or put a sort chip next to the button. `library.ts`, `library.css` (~line 258).
- Screenshots: `lib-filters-sheet.png`, `lib-movies-390.png`.

### U-8  Filters sheet: "Shelves" duplicates the Collections tab, and the segmented controls wrap into odd rows
- Where: Library, Filters sheet, "Look" and "Order" segmented controls, 390x844.
- Wrong: (a) "Shelves" is the Collections tab (`?view=shelves`), reachable by two routes, which the one-navigation-model rule forbids. (b) "Look" has 3 + 1 and "Order" has 3 + 2 options wrapped over two rows inside one rounded pill, so the second row looks orphaned and the selected highlight sits on the first row only.
- Fix: remove Shelves from "Look" (the tab covers it); make segmented controls horizontally scrollable or a 2-column grid of equal buttons. `library.ts` sheet markup, `library.css`.
- Screenshots: `lib-filters-sheet.png`.

### U-9  Library Wall view is one 360px-tall card per row (159 titles = a very long page)
- Where: Library, Look = Wall, 390x844.
- Wrong: `.v-wall` is forced to a single column (`library.css` ~line 270). Each card is about 360px tall, so scanning 159 titles takes roughly 12 screens more than Posters, and the A to Z rail floats beside it. The mode is the least useful one on a phone.
- Fix: two columns on phones (cards of about 170x100), or hide Wall under 500px.
- Screenshots: `lib-wall.png`.

### U-10  A to Z rail: 30px touch target and 11px letters; letter dividers take a whole poster cell
- Where: Library Posters/Wall/List, 390 and 360.
- Wrong: the rail is a 30px-wide slider (the letters are 11px), well under the 44px rule, and permanently takes 38px from a 390px page, so posters are only about 99px wide. When the order is A to Z, each letter header is a striped, empty-looking poster-sized cell with a big letter (e.g. "U", "W"), which leaves ragged rows and reads as an empty tile.
- Fix: widen the hit area (transparent padding to 44px) and show the rail only while scrolling or after tapping a handle; make letter headers a thin full-width row.
- Screenshots: `lib-movies-390.png`, `lib-az-blank-0.png`.

### U-11  Newly Added: "New films" has an in-page "This week | Last 2 months" switch
- Where: Home, Newly Added, 390x844.
- Wrong: DESIGN-RULES say no in-page tab bars or switch blocks. This is a two-button switch inside a tile that changes what the tile shows. Similar switches: Requests browse "Films | Shows" (U-17), Library Filters "Look/Order" are controls rather than navigation, but the first two behave like tabs.
- Fix: use one fixed range per tile ("Last 2 months", sorted newest first, with the "6 days ago" chips already on each card) and drop the switch.
- Screenshots: `new-390-s0.png`.

### U-12  Explore: "Aired this week" lists every episode, 26 near-identical rows
- Where: Home, Explore, 390x844. The page is 6,500-7,200px tall.
- Wrong: one show (Teenage Mutant Ninja Turtles) added 26 episodes, so the tile is 26 rows of "Teenage Mutant Ninja Turtl…" (title truncated on every row), each with its own Play button, pushing the rest of Explore (mood picks, etc.) far down.
- Fix: group episodes by show for the day ("Teenage Mutant Ninja Turtles · 26 new episodes · S4 E1 to E26", one Play), and cap the list with "See all".
- Screenshots: `explore-390-s2.png`, `explore-390-s4.png`.

### U-13  Explore: header labels wrap awkwardly and explain themselves
- Where: Home, Explore, 390x844.
- Wrong: "Picked for you  Why each one, in a line" is self-referential helper text. The mood tile header wraps into "What are you in the mood / for?" with the count `14 for "cosy"` squeezed on the right in two lines.
- Fix: drop the helper, put the count under the title on phones. `src/pages/home/tiles/*`.
- Screenshots: `explore-390-s0.png`.

### U-14  Home "Continue watching" rows truncate the useful bit
- Where: Home, 390x844.
- Wrong: meta lines are cut off: "Film · 2026 · 2 h 06 min l…", "S1 E1 · The Engram · 41 m…". The part that matters (time left) is the part that is cut.
- Fix: put "2 h 06 min left" on its own line or drop the year; allow two lines (`.lc .sub`).
- Screenshots: `home-390-s1.png`.

### U-15  Details: episode deep link lands behind the sticky bar and never names the episode
- Where: Details, open an episode (`#/title/<episodeId>`), 390x844.
- Wrong: the page opens already scrolled to the episode list (`scrollY` 1792) and the season tabs are half hidden under the top bar (no scroll offset). When scrolled to the top, the hero shows the show title with "S4 E1 · 23 min"; the episode's own title appears nowhere in the hero.
- Fix: give the scroll target `scroll-margin-top: 120px`; add the episode name to the hero meta line (plain "S4 E1 · Beyond the Known Universe").
- Screenshots: `det-episode-390.png`, `det-episode-top.png`.

### U-16  Details: duplicate runtime, nested card, helper text and a wall of keyword pills
- Where: Details (film), 390x844.
- Wrong: (a) "1 h 51 min" is shown in the meta line and again under Play. (b) "Audio & subtitles" is a card inside another card (double border, double padding, the inner card has 31px less width). (c) The footer "Change anything and Nuttyfin remembers it for this title on this device." is helper text about the app. (d) Raw keywords ("artificial intelligence (a.i.)", "race against time", "mind control") fill 3-4 rows of lowercase pills ahead of the credits.
- Fix: drop the repeated runtime when it matches the meta line; flatten the card; remove the footer sentence (or show it as a toast the first time); cap keyword pills at about 6 with a "More" toggle.
- Screenshots: `det-film-390.png`, `det-film-390-s1.png`, `det-film-390-s2.png`.

### U-17  Requests browse: "Films | Shows" switch, a back button and a stale lede
- Where: Requests, Discover, "Browse all films", 390x844.
- Wrong: a "< Discover" back button (the Discover tab is right above it and still selected, two ways to go back), a Films/Shows switch (65x40, 72x40) that duplicates "Browse all films / Browse all shows" on the previous screen, and the lede "Find films and shows that are not in the library yet..." repeated above a "Films" heading it does not match.
- Fix: keep only the Films/Shows switch (full height 44px) and drop the back button; set the lede from the active type.
- Screenshots: `req-browse-films.png`.

### U-18  Request title links are 28px tall
- Where: Requests list, 390 and 360.
- Wrong: the title in each row (`.rq-tlink`) is a 28px-high button (e.g. 160x28, 37x28 for "Lucy"). It is the only way to open the title sheet, the poster is not tappable. Below the 44px minimum.
- Fix: make the whole row (or at least poster + title) the tap target, or `min-height:44px` with padding on `.rq-tlink`.
- Screenshots: `req-main-390.png`.

### U-19  Account menu: Appearance does not fit a short phone, theme buttons are 40px
- Where: avatar, Appearance, 360x640 (and landscape 844x390: popover 300px high with 508px of content).
- Wrong: the popover is capped at `100dvh - top - 100px` so the "Background" choice is cut and needs an inner scroll with no cue (the "Dot grid" labels are clipped). The 8 colour-theme buttons are 165x40 (under 44).
- Fix: raise `.palopt` to `min-height:44px`; show the panel as a full-height bottom sheet on phones; or lay swatches out as 4 columns of round dots with names beneath.
- Screenshots: `acct-small-appearance.png`, `land-appearance.png`.

### U-20  Search results panel is not bounded by the visible height
- Where: search overlay, 390x430 simulated keyboard.
- Repro: open search, type "the", shrink the viewport to 430px high.
- Wrong: the results card keeps its content height (448px, 7 rows of 56px) with `overflow: visible` and no `max-height`, so it extends below the viewport and under the bottom bar, and the rows lower down cannot be reached without closing the keyboard. On a real phone the keyboard covers about 40% of the screen.
- Fix: `max-height: calc(100dvh - var(--top-h) - 16px)` with `overflow-y:auto` on `.qres` in `shell.css`; use `visualViewport` height when the keyboard is up.
- Screenshots: `search-kbd-sim.png`, `search-phone-results.png`.

### U-21  Remove dialog in landscape leaves about 100px to read the options
- Where: Details, More, Remove..., 844x390.
- Wrong: the title block and the sticky Cancel/Continue footer take about 75% of the 358px dialog, so only one option is visible at a time and the scroll area is tiny (content 783px). A person cannot see both choices and the warning text at once. The Request sheet has the same shape (358px dialog, 707px content) but copes better.
- Fix: in landscape, hide the poster and subtitle and put the actions in one row of the header; or make the dialog full-screen.
- Screenshots: `land-remove.png`, `land-req-sheet.png`.

### U-22  Small text and low contrast
- Where: Home, Explore, Library, Requests; Ember light theme.
- Wrong: text under 12px: "For you" labels (10.5px), "New" badges (10.5px), hero "up next" names (11px), weekday names (11px), "Film/Show" tags (11px), A to Z letters (11px), season progress "S2 · 0/10" (11px), "6 days ago" (11.5px). Contrast in Ember light: the active nav label ("Requests", 12.5px) and the white-on-orange badge ("58", 13px) measure about 3.3:1, below 4.5:1 for small text.
- Fix: floor body text at 12px (13px for labels people must read); darken `--accent` text and badge background in light themes a notch (`palettes.css`, `tokens.css`).
- Screenshots: `home-390-s1.png`, `req-main-390.png`, `theme-ember-light-req.png`.

### U-23  Remove dialog shows "helper service is not running" three times
- Where: Details, Remove..., 390x844.
- Wrong: two options and the info box each say "The Nuttyfin helper service is not running, so this is not available." It is correct, but it is repeated and gives the person nothing to do about it; two disabled-looking options take half the sheet. (When the helper is up this goes away, so it is only a problem in this state.)
- Fix: collapse to one banner at the top ("Radarr and qBittorrent options need the helper, which is offline") and show only the available option.
- Screenshots: `det-remove-dialog.png`.

### U-24  Page performance on a throttled phone (4x CPU)
- Where: Library, Requests, Explore, Show details, 390x844.
- Wrong: scroll frames averaged about 50ms on Library (8 frames over 50ms, worst 267ms), Requests (11 over 50ms), and 29ms on Explore (worst 183ms); Home and Show details were smooth (17ms). Library renders 159 posters in the DOM at once (1,560 nodes), Show details loads 185 images at once (every episode still, none lazy), and the Library list view is 10,873px tall. First content took about 0.65-1.7s.
- Fix: `loading="lazy"` plus `decoding="async"` on episode stills and posters below the fold; `content-visibility:auto` on list items; render the first 60 library items and append on scroll. Check the stagger observer in `motion-dom.ts` for rows scrolled quickly.
- Screenshots: n/a (measurements).

---

## Polish

### P-1  Login: landscape needs scrolling to reach "Sign in"; extra title labels
- Where: login, 844x390 and 390x844.
- Wrong: in landscape the form starts at y=110 of 390 and the Sign in button is below the fold (page height 695). The page carries a brand wordmark, headline "Your next good watch.", a lede, a "Sign in to Nuttyfin" heading and a helper line; the owner's rule says login has no added title labels. The wordmark sits over bright poster art ("SCREAM" behind "NuttyFin").
- Fix: in landscape, centre the card vertically and shrink spacing; trim the title and helper lines; add a dark scrim behind the wordmark.
- Screenshots: `login-land.png`, `login-390-initial.png`, `login-kbd-open-sim.png`.

### P-2  Login: small hit areas
- Where: login, all sizes.
- "Show password" is 49x40, the "NuttyFin" link is 161x41 and the checkbox is 18x18 (its label may cover it, but the box itself looks small). Raise to 44px.
- Screenshots: `login-360.png`.

### P-3  Top bar icon buttons are 40px wide at 360
- Where: any page at 360x640 (and the media rule at <=380px).
- Search and theme switch are 40x44. Calendar day buttons in Explore are 39x54 at 360. Make them 44.
- Screenshots: `small-home.png`, `home-home-explore-390-full.png`.

### P-4  "Technical details" summary and keyword rows are under 44px
- Where: Details, 390.
- `summary` "Technical details" is 131x40 (a text link). Raise to `min-height:44px`.
- Screenshots: `det-film-390-s2.png`.

### P-5  Report-a-problem dialog shows a raw machine string
- Where: Details, More, Report a problem, 390x844.
- "We add this for you: Pacific Rim: Uprising · Pacific Rim Uprising (2018) [BluRay] [1080p] [YTS.AM] · AAC · Stereo · subtitles no subtitles · this browser" in monospace is jargon and repeats the file name. Show "Pacific Rim: Uprising, this browser, English audio" in plain language.
- Screenshots: `det-report-dialog.png`.

### P-6  Trailer sheet and console warning
- Where: Details, trailer button.
- The sheet opens with a black 16:9 box until the embed loads (in this sandbox it never did, so I could not check the loaded state); the console logs "Allow attribute will take precedence over 'allowfullscreen'". Add a poster/spinner inside the box and remove the redundant attribute.
- Screenshots: `det-trailer.png`.

### P-7  Requests: filter chips with zero counts and the "Report a problem" button
- Where: Requests, 390.
- "Waiting for a yes 0" and "Declined 0" take 2 of the 7 chip slots in a strip that already scrolls. The "Report a problem" button below the filter does not say what it reports (requests? the app?). Hide empty chips (or dim them) and label the button.
- Screenshots: `req-main-390.png`, `req-chips-scrolled.png`.

### P-8  Browse filters sheet: footer button wording
- Where: Requests, browse, Filters sheet, 390.
- The footer reads "Show Over 10,000 films" (capital "O" mid-sentence). Use "Show 10,000+ films".
- Screenshots: `req-browse-filters.png`.

### P-9  NutBot sheet: subtitle truncates
- Where: NutBot chat, 390 and 360.
- The subtitle "Picks from your library, and what…" is cut at 390 and "and…" at 360. Shorten to "Picks something to watch". Also the suggestion chips clip at the right edge (they scroll, but there is no fade, see U-1).
- Screenshots: `bot-phone-open.png`, `bot-small-open.png`.

### P-10  Library NutBot tile wraps in a very narrow column in landscape
- Where: Library, 844x390.
- The greeting ("Evening, nutmag2469. 69 films you have not seen, under 2 hours.") wraps into a 5-line column left of the buttons. Let the buttons wrap under the text.
- Screenshots: `land-lib.png`.

### P-11  Details hero Play button is a different orange from the rest
- Where: Details, 390.
- The hero Play is a brighter orange (#ff6a2b) with dark text, while "Resume" on Home is the darker brand orange. Not a bug, but the two primary buttons look different. Use one token.
- Screenshots: `det-film-390.png`, `home-390-s0.png`.

### P-12  Toast sits over content and cannot be dismissed
- Where: any toast, 390.
- The toast (e.g. "Saved is coming soon") appears about 66px above the bottom bar over page content, lasts 3.5s and has no close or swipe. It does not cover the bar, so this is cosmetic.
- Screenshots: `toast-saved.png`.

### P-13  Requests "On the way" shows the open requests of everyone while the badge is yours
- Where: Requests, 390.
- The list shows "Asked by: Everyone (149)" and "On the way 68" while the badge says 58 (or 18 elsewhere). People will wonder which number is theirs. Default "Asked by" to "Me", or show "You (n)" first. Relates to B-2.
- Screenshots: `req-main-390.png`.

### P-14  Console noise on every page
- Where: all pages (dev).
- `GET /nutfin-api/health` returns 502 (helper not running) on every load, and the 404 poster in B-7. The 502 does not break anything but fills the console and Network tab; the first can be quietened by treating "helper unreachable" as a known state without a request on each navigation.
- Screenshots: n/a.

---

## Checked and fine (no finding)
- No horizontal page overflow on any page at 360, 390 or 844 wide; only intended scrollers scroll sideways (tab strip, request chips, rails).
- Bottom bar: four equal items, safe-area padding present, never covers the last item, badge placed correctly.
- Details dialogs and the Request sheet have sticky footers, safe-area padding, a visible handle and 44px+ buttons; the Filters sheet scrolls inside a fixed header and footer.
- Account menu opens within the screen at 360 and 390; Settings links are 48px rows.
- Dark and light, plus Slate, Plum, Circuit and Graphite, render consistently; only contrast (U-22) differs.
- Search results rows are 56px, with highlighted matches and a clear empty state.
