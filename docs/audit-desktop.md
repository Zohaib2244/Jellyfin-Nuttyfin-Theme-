# Nuttyfin desktop audit (1440x900 and 1920x1080)

Date: 2026-11-21. Tree served by Vite on :5174, real Jellyfin 12.3 + Seerr, signed in as the owner test account, read-only (no favourite/watched/delete/request/approve confirmed, no playback started; Request sheet, Remove dialog and Report dialog opened and closed only).
Screenshots live in `/tmp/claude-1000/-home-nutmag2469/7e5aea1b-8289-4fc0-be7a-e51672e93cb8/scratchpad/audit-d/` (filename given per finding; `-1440` / `-1920` suffix = viewport). Probe scripts are in `.../audit-d/tools/`.

Scope covered: login + failed login, Home (4 tabs), Library (Movies, Shows, 4K, Collections, all four view modes, orders, A-Z, mix desk, empty result, search dropdown), Details (film, show, episode expand, box set, More menu, Trailer, Report, Remove steps 1+2, Read more), Requests (list, all filter chips, person filter, Report dialog), Discover (rails, genre tile, network + studio, Browse with sort/year/hide filters, title sheet, Request step 2 for a film and a show), Explore interactions (mood, short on time, calendar), account menu (Appearance, Settings), NutBot panel, Saved, bad routes, keyboard pass, console/network/timing pass, light mode plus Slate, Moss, Graphite (dark+light), Plum, Circuit, Berry.

Not verified: playback/player UI (read-only rule), Request confirm, NutBot sending a message (needs helper), YouTube trailer actually playing (embed blocked in the headless browser, so only the dialog shell was seen), non-admin accounts (only the Owner account exists for tests, so admin-only UI such as Remove/Settings links could not be compared), light-mode visual pass of Plum/Circuit/Berry/Slate light (contrast scanner only).

What passed: no horizontal overflow on any page at either size; all focus rings visible and every control at least 44px; tab arrow/Home/End keys work on all tab bars; Esc closes menu, trailer, search dropdown and sheets; empty-result state and bad-credentials/empty-field messages are clear and plain; all 8 palettes in dark mode scan clean for text contrast; no JS exceptions.

Totals: 7 bug, 19 ux, 12 polish (38 findings).

---

## Bugs

**1. bug - Details, dialogs opened from the More menu: focus is lost on close**
- Steps: open any film at `#/title/<id>`, click More, choose "Report a problem" (or "Remove..."), press Esc. Check `document.activeElement`.
- Wrong: focus drops to `<body>` (keyboard users restart from the top of the page). The Trailer dialog correctly returns focus to its button, and Esc on the More menu itself returns to More.
- Fix: the menu item is removed when the menu closes, so the dialog's "return focus" target is gone. Return focus to the More button (src/pages/details/dialogs.ts, src/pages/common/dialog.ts opener fallback).
- Screenshot: det-report-1440.png, det-remove1-1440.png

**2. bug - Report dialog: focus escapes the dialog**
- Steps: open Report a problem on a film, press Tab repeatedly (radio, textarea, Cancel, Send, then one more Tab).
- Wrong: after Send the focus lands on the page body, then comes back into the dialog at Close. The dialog is modal but the trap is not a loop.
- Fix: wrap Tab/Shift+Tab inside `openDialog` (src/pages/common/dialog.ts) or make the page behind `inert`.
- Screenshot: det-report-1440.png

**3. bug - Unknown route silently shows Home**
- Steps: go to `#/nope/zzz` (also `#/home/bogus`, `#/requests/bogus`).
- Wrong: no 404 page; the URL stays wrong and Home renders. `/title/<bad>` has a proper "We could not find that" page, so the pattern exists.
- Fix: add a catch-all route (src/routes.ts, src/router.ts matchRoute null branch) that reuses the not-found view; unknown `:tab` values should redirect to the base route.
- Screenshot: 404-1440.png

**4. bug - Player says "We could not reach the server" for a missing item**
- Steps: open `#/watch/doesnotexist123`.
- Wrong: Jellyfin answers 400/404, the page says "This will not play / We could not reach the server." with "Try again", which cannot help. Also logs a full ApiError stack to the console.
- Fix: map 400/404 on `item()` to "We could not find that" (same copy as Details) in src/pages/watch/index.ts; keep the network wording for real failures.
- Screenshot: watch-bad-1440.png

**5. bug - Requests count disagrees between four places**
- Steps: open Home (rail badge shows 18), then Requests (badge becomes 58, chip "On the way" 68, "All 149"), then Home > Newly Added ("On the way ... 61 open").
- Wrong: three different rules for "open requests": Home counts non-available/non-declined summary (src/pages/home/index.ts:165), Requests counts the user's own open requests (src/pages/requests/list.ts:172), the Newly Added tile counts again. The badge number changes when you change page.
- Fix: one shared helper for "open requests for me", used by badge, Newly Added tile and Requests; label what the number means.
- Screenshot: home-1440.png, req-requests-1440.png, new-1440.png

**6. bug - Shows library contradicts itself on new episodes**
- Steps: `#/shows`.
- Wrong: lede "1 with new episodes", group "New episodes 1", but the NutBot strip says "15 of your shows have new episodes" and the suggested mix button is "Try: New episodes 15" (all 15 shows).
- Fix: the NutBot/mix count uses a different predicate from the group; use the same lane predicate (src/pages/library/bot.ts vs filters.ts `laneOf`).
- Screenshot: lib-shows-1440.png

**7. bug - Browse: year range is not validated and gives mixed results**
- Steps: Discover > Browse all films; set From = 2025, press Tab; then To = 2020.
- Wrong: with From 2025 the grid is correct, but with To 2020 the grid shows 2021-2025 titles and the count still reads "Over 10,000 films". An impossible range is neither blocked nor explained.
- Fix: clamp or show a plain message ("The end year is before the start year") in src/pages/requests/browse.ts / browse-model.ts.
- Screenshot: req-browse-badrange.png

---

## UX

**8. ux - "Saved" rail item is a dead placeholder**
- Steps: click Saved (airplane icon) in the left rail.
- Wrong: only a toast "Saved is coming soon". The icon is also an airplane, which does not suggest "saved". A family user sees an unfinished feature in the main navigation.
- Fix: hide it until built, or build it (src/ui/shell/shell.ts:34, :134). If kept, use a bookmark/heart icon.
- Screenshot: saved-1440.png

**9. ux - Details (show): a one-item "Season 2" tab bar**
- Steps: open Silo.
- Wrong: an in-page tab bar with a single tab. Owner rule: no in-page tab bars; for one season it is also pointless.
- Fix: only render a season switcher when there are 2+ seasons, and as a select/menu rather than tabs (src/pages/details/views.ts).
- Screenshot: det-show-y1500.png

**10. ux - "Ask NutBot" floating button covers content**
- Steps: Home (Continue watching list, the 5th row's play button), Newly Added ("See all requests" link), Library A-Z rail bottom letters, Details "More like this" arrow buttons, Explore tile corners.
- Wrong: the fixed button sits on top of controls and clips link text; some controls are not clickable at that spot until you scroll.
- Fix: reserve bottom-right padding on pages (about 80px) or shift the page's right-edge controls; or collapse the FAB to a smaller size while scrolling.
- Screenshot: home-1440.png, new-1440.png, lib-order-az-1440.png, det-film-y1300.png

**11. ux - Continue Watching strip: 14 cards, 6 visible, no scroll cue**
- Steps: `#/home/continue`.
- Wrong: the carousel only has a thin scrollbar; no arrows (Details and Requests rails have them), no peeking card, and the header says "9 on the go, 5 up next" which does not explain the 14 cards.
- Fix: add Scroll back/forward buttons like other rails (`.hstrip` in src/pages/home/home.css:212) or wrap into a grid; make the count match the cards.
- Screenshot: continue-late.png

**12. ux - Light mode (Ember): white text on orange is below 4.5:1**
- Steps: switch to Light with Ember; check Library "Surprise me", Explore "Play", Discover "Search" (all ~3.3:1), rail/requests badge (3.3:1, 11px), tab counts "159/15" (3.4:1, 12px), Discover "· Available" 4.2:1.
- Wrong: small text on the accent fails WCAG AA.
- Fix: a darker accent-on-light token for fills with white text (src/styles/tokens.css/palettes.css), or dark text on the accent in light mode.
- Screenshot: th-light-ember-movies-1440.png, th-light-ember-discover-1440.png

**13. ux - Light mode (Moss, Graphite, Slate): tab counts and "Processing" are very faint**
- Steps: Light + Moss/Graphite; Library tab counts measure 2.7-2.8:1, Discover "· Processing" 2.7:1, "ORDER" label 3.5:1, "Everything. Press a switch..." 3.5:1, film "MP4 · H.264..." 3.5-3.75:1.
- Fix: darken `--muted`/accent text tokens for light variants of these palettes.
- Screenshot: th-light-graphite-movies-1440.png, th-light-moss-discover-1440.png

**14. ux - Jargon in Remove dialog and Audio & subtitles card**
- Steps: film > More > Remove... ; show > Audio & subtitles card.
- Wrong: step 1 talks about "Radarr", "qBittorrent" and "The Nuttyfin helper service is not running, so this is not available." (shown twice). The Audio card shows HEVC, "Dolby Digital Plus + Dolby Atmos 5.1", "has no hardware help for that". Owner rule: family-friendly plain language. (Admin-only dialog, but the helper-offline text is an internal status, not a user message.)
- Fix: hide unavailable options instead of explaining; reword ("This browser cannot play this video format directly, so the server converts it as you watch. It may stutter."). src/pages/details/remove.ts, playability.ts.
- Screenshot: det-remove1-1440.png, det-show-card-1440.png

**15. ux - Request step 2: confusing quality list with internal profile names**
- Steps: Discover > open a film > Request; open a show > Request.
- Wrong: Quality options include both "Standard (HD - 720p/1080p)" and "HD - 720p/1080p", then "Any, SD, HD-720p, HD-1080p, Ultra-HD"; shows add Sonarr profile names like "720p x265 (MeGusta > ELiTE)" and "1080p x265 (MeGusta > ELiTE)". A member cannot choose sensibly.
- Fix: show plain choices (Standard / Higher quality) and only show server profiles to admins (src/pages/requests/sheet.ts).
- Screenshot: req-step2-1440.png, req-step2-tv-1440.png

**16. ux - 4K Movies tab opens with the whole mix desk expanded**
- Steps: `#/movies?xtra=4k`.
- Wrong: unlike the other tabs, the full desk (about 480px of switches) is open and pushes the single result below the fold. The tab then looks like a filter panel.
- Fix: keep the desk collapsed for the 4K tab (src/pages/library/library.ts, desk open state derived from active keys).
- Screenshot: lib-4k-1440.png

**17. ux - Mood and Genre switches add together while the copy says they narrow**
- Steps: Library > desk; click Scary (32 films), then Western: count rises to 33.
- Wrong: filters.ts makes Mood and Genre one OR bucket, but the page text says "Press a switch to narrow it down", and other groups (Who, Time, Era) do narrow. Users will think it is broken when counts go up.
- Fix: label the bucket ("Mood or genre: any of these") or make them narrow like the rest.
- Screenshot: lib-desk-open-1440.png

**18. ux - Discover has two search boxes**
- Steps: `#/requests/discover`.
- Wrong: top-bar "Search films and shows" (library) and the page's "Search films and shows" (requests) have the same wording and sit about 150px apart.
- Fix: rename the page box ("Find something to request") and/or scope the top bar label to "Search the library".
- Screenshot: req-search-1440.png

**19. ux - Settings link "Requests settings" goes to a hard-coded plain-HTTP host**
- Steps: avatar menu > Settings.
- Wrong: opens `http://jellyseerr.avns.nut`: wrong product name (it is Seerr), http, and unreachable off the home network, while the Jellyfin links are same-origin `/jf/web/...`.
- Fix: use the same-origin `/seerr/` path or hide when not reachable (src/ui/shell/accountmenu.ts SETTINGS).
- Screenshot: menu-settings-1440.png

**20. ux - Report a problem copy is self-referential**
- Steps: film > More > Report a problem; Requests > Report a problem; film "About" card.
- Wrong: "It goes in your problems list.", "Log it so you remember to fix it.", "We add this for you: ... this browser". Owner rule bans self-referential helper text. Also three entry points on one film page (More menu, About card, Requests page).
- Fix: "Tell us what is wrong and we will look into it." and drop the auto-details line (or collapse it). src/pages/details/dialogs.ts, views.ts.
- Screenshot: det-report-1440.png, det-film-y1300.png

**21. ux - "Change anything and Nuttyfin remembers it for this title on this device."**
- Steps: film Audio & subtitles card.
- Wrong: helper line that explains the app to itself; takes a full row of the card.
- Fix: remove, or show only after a change as a toast ("Saved for this film").
- Screenshot: th-dark-graphite-film-1440.png

**22. ux - Requests page: native select and long rows at 1920**
- Steps: `#/requests` at 1920 wide.
- Wrong: rows stretch edge to edge (poster at far left, Open button at far right, 1200px of nothing between) and the "Asked by" control is an unstyled native select (does not follow palette, visible in light themes).
- Fix: cap list width (about 1100px) or put the action next to the stepper; style the select like the Details selects.
- Screenshot: w1920-requests.png, th-light-graphite-requests-1440.png

**23. ux - Newly Added: truncated meta and clipped "See all requests"**
- Steps: `#/home/new`.
- Wrong: every poster card meta is cut ("2018 · Action · 1 h 51 ...", "2026 · Adventure · 2 h..."); "See all requests" is clipped at the right edge of its tile; the banner tile is tall with an empty bottom third.
- Fix: drop genre from the meta line or allow two lines; tighten banner height; padding for the FAB (see 10).
- Screenshot: new-1440.png

**24. ux - Explore calendar day with nothing leaves a big empty panel**
- Steps: Explore > "Aired this week" > click Mon 16.
- Wrong: left panel shows one line ("Nothing new that day. A good night for a film."), the "Nothing new" label repeats it in teal, and the panel is about 450px tall with the right column holding two items.
- Fix: shrink the panel height to content or fill with "Earlier this week" items; remove the duplicate label.
- Screenshot: exp-cal-mon.png

**25. ux - Performance: Explore and Home load 130-160 requests**
- Steps: load `#/home/explore` cold (idle at 4.7s, 162 requests, two backdrops took 2.3s), `#/` (134 requests, idle 2.0s, Suggestions call 970ms). `/requests/discover` takes about 5.6s to finish when scrolled through. Library 136 requests.
- Wrong: nothing broke, but the Explore tab shows gradient placeholders for several seconds and the helper health check fails (see 36). All other pages first paint under 1.2s.
- Fix: lazy-load below-the-fold rails (images already lazy; data is not), request smaller backdrops (`maxWidth=480` is already used, so check server transcode time), cache `Suggestions`.
- Screenshot: explore-9s.png

**26. ux - NutBot appears in three places (Library strip, FAB, Explore "Ask NutBot")**
- Wrong: owner rules say NutBot is a floating button only and not a tile; Library shows a permanent NutBot strip with "Surprise me" and a mix suggestion on every Library tab, and Explore has an extra "Ask NutBot" button inside the mood tile. The library strip also pushes results down about 70px.
- Fix: confirm with owner; at minimum make the Library strip dismissible/collapsed.
- Screenshot: lib-movies-1440.png, nutbot-ask-1440.png

---

## Polish

**27. polish - Library A-Z: letter dividers are full poster tiles**
- Steps: Movies > A to Z.
- Wrong: each letter "#", "A", "B"... is a striped poster-size tile that takes a grid cell and leaves holes in the rows (one lone "2012" after "#").
- Fix: use full-width thin letter headings in the grid (src/pages/library/library.ts `.lettr`).
- Screenshot: lib-order-az-1440.png

**28. polish - Library empty result keeps the A-Z rail and a big "0 films"**
- Steps: desk > Western + In 4K + Everyone.
- Wrong: result text is good, but the A-Z rail still runs down the right side (pointless with no items) and the count glyph reads "0 films" next to chips.
- Screenshot: lib-empty-state-1440.png

**29. polish - Library header repeats itself three times**
- Steps: `#/movies`.
- Wrong: lede "159 films on the server · 95 you have not seen yet", NutBot line ("69 films you have not seen, under 2 hours"), then big "159 films Everything. Press a switch to narrow it down."
- Fix: drop the third line or the lede.
- Screenshot: lib-movies-1440.png

**30. polish - Collections view looks sparse and loads posters late**
- Steps: `#/movies?view=shelves` at 1440 then 1920.
- Wrong: at 1440 after 2.5s the first shelf still shows gradient placeholders and a faded 4th tile; at 1920 each shelf fills only about 60% width, so tiles look empty (owner rule).
- Fix: eager-load first shelf posters; use a wider poster size or a two-column layout on wide screens.
- Screenshot: lib-sets-1440.png, w1920-sets.png

**31. polish - Details (show): "On the server" tile holds one empty-looking row**
- Steps: open Silo, scroll to the bottom.
- Wrong: "Episodes on the server" with no size/format next to a red Remove... button; the film version shows file name/size/codec.
- Screenshot: det-show-y3100.png

**32. polish - Details (film): runtime shown twice, odd pixel-font spacing**
- Steps: open a film; also scroll to Director/Writers/Studios/Details.
- Wrong: "1 h 51 min" appears in the meta line and again under Play ("1 h 51 min · ends at 9:44 pm"). Small pixel-font labels have broken letter spacing ("Subt i t l es", "Wr i ters", "Stud ios", "Det a i l s") and are hard to read at 12px.
- Fix: use the body font for labels under about 14px.
- Screenshot: det-film-y1300.png, th-dark-graphite-film-1440.png

**33. polish - Remove dialog step 2 repeats "Are you sure?"**
- Steps: film > More > Remove... > Continue...
- Wrong: title "Are you sure?", then "This deletes X from the server.", then "Are you sure? The file is deleted for good." Button labels carry ellipses ("Remove...", "Continue...").
- Fix: title "Delete X?" and one warning line; drop ellipses. Still unconfirmed in test.
- Screenshot: det-remove2-1440.png

**34. polish - Brand name inconsistency**
- Steps: login page and top bar.
- Wrong: the wordmark is "NuttyFin" (login `aria-label="NuttyFin"`, `Nutty<em>Fin</em>`) while headings and copy say "Nuttyfin" ("Sign in to Nuttyfin"). Owner says the name is "Nuttyfin"; docs/DESIGN-RULES.md itself uses "NuttyFin" too.
- Fix: agree one spelling; adjust src/pages/login/index.ts, src/ui/shell/shell.ts, DESIGN-RULES.md.
- Screenshot: login-1440.png

**35. polish - Console noise: 502 `/nutfin-api/health` and 404 poster**
- Steps: open Explore, a Details page, or Requests with devtools open.
- Wrong: `GET /nutfin-api/health` 502 on Explore and Details (helper not running; harmless but an error line every visit), four 404s for `/jf/Items/56b3b78b.../Images/Primary?maxWidth=185` on Requests (an item whose poster is missing; check the placeholder shows), a YouTube iframe warning ("Allow attribute will take precedence over 'allowfullscreen'").
- Fix: skip the health probe quietly (or cache the failure), use a poster fallback without a request, drop `allowfullscreen` from the trailer iframe (src/pages/details/trailer.ts).
- Screenshot: req-requests-1440.png

**36. polish - Skip link behaviour**
- Steps: load `#/movies`, press Tab once, Enter.
- Wrong: the router focuses the page heading, so the first Tab does not reach "Skip to content"; activating it moved focus to the search box instead of main content (not fully verified which element received the first Tab).
- Fix: make the skip target the page's first control and keep it first in tab order.

**37. polish - Requests chips and Discover tiles inconsistent styling**
- Wrong: filter chips with 0 ("Waiting for a yes 0", "Declined 0") are shown at full strength; the "Removed" count pill is red while other counts are neutral; "FILM/SHOW" corner tags only on Discover.
- Fix: dim empty chips; keep count pills one colour.
- Screenshot: req-filter-pending-1440.png

**38. polish - Light-mode "Keep watching" and glass buttons**
- Steps: Light + Moss/Graphite, Home.
- Wrong: the "Details" glass button on the hero measures about 2.95:1; hero text sits on artwork so overall legibility depends on the poster.
- Screenshot: th-light-moss-home-1440.png

---

## Totals (final)

- bug: 7 (items 1-7)
- ux: 19 (items 8-26)
- polish: 12 (items 27-38)
- Total 38.
