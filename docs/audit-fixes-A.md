# Audit fixes, fixer A (shell, Home, Library, Login, router, tokens)

Branch `worktree-agent-a1cd85c75766d6d72`. Findings are named as in `docs/audit-desktop.md` (D-n) and `docs/audit-phone.md` (B-n, U-n, P-n). Commits are listed at the end. Verified in a real browser (Playwright, real Jellyfin read-only, demo mode for Favourites) at 1440x900, 1920x1080, 1150, 844x390 landscape, 390x844 and 360x640, dark and light (Ember, Graphite, Moss, Slate). `npm run typecheck && npm test && npm run build` pass (993 + 68 tests).

## Fixed

| Finding | Result |
|---|---|
| D-3 unknown route shows Home | Friendly 404 page (`src/pages/notfound`), also for an unknown `:tab` (`tabs` list on the route). Tests in `tests/favourites.test.ts`. |
| D-5, B-2, P-13 (badge part) one open-requests count | `src/state/openRequests.ts`: open = requested / approved / waiting / downloading / partly ready; not available, declined or removed; always the signed-in person's own requests. Used by the shell (keeps the badge fresh on every page), Home, Requests (`list.ts` call-site only) and Newly Added (`newly.ts` call-site only). Badge is now 65 on every page, "On the way" tile says "65 open". Test `tests/open-requests.test.ts`. |
| D-6 Shows count contradicts itself | NutBot's mix count and "Try:" use the same lane rule (`laneOf` + `passes`) as the group and lede. "1 of your shows has new episodes" everywhere. Test `tests/library-audit.test.ts`. NutBot lines also read right at 1 ("1 film", "is/are"). |
| D-8, U-5 "Saved" placeholder | Now "Favourites" (`#/favourites`, heart icon): films and shows hearted, Library poster grid, Films / Shows tabs only when both exist, empty state with a Library link. Rail, bottom bar, router, docs updated. |
| D-10, B-4 NutBot floating button covers content | Removed. "Ask NutBot" button in the top bar at every size, tooltip "Ask NutBot". |
| D-11 Continue strip has no scroll cue | Back / forward buttons (desktop) on Continue Watching, Picked for you, moods, Because you watched, Genre, New films; count now reads "14 to pick up: 9 half-watched, 5 up next". |
| D-12, D-13, U-22 (contrast) | Tokens: deeper accent / `accent-ink`, `muted`, `dim`, `num` (tab counts), `info`, `warn` in the light themes; slightly lighter `dim` in dark. `tests/contrast.test.ts` checks all 8 palettes x light/dark: text, muted, dim, num, accent, status colours on bg / panel / nested / raise and on their soft chips, plus accent-ink on accent (4.5:1; accent on the bare backdrop 3:1). Badge text on accent now uses `--accent-ink`. |
| D-16 4K tab opens with the desk expanded | Desk opens only for switches beyond the one that defines the tab. |
| D-17 Mood / Genre add up while copy says narrow | Every multi-pick group says "any of these" (Mood and Genre: "mood or genre: any of these"); the "Press a switch to narrow it down" line is gone. |
| D-19 hard-coded Seerr link | Derived from the page origin (`nuttyfin.avns.nut` -> `http://jellyseerr.avns.nut`, same scheme); hidden on localhost, IPs, one-word hosts. `/seerr/` on this origin only proxies Seerr's API, so it is not used as a page. Test `tests/shell-links.test.ts`. |
| D-23 Newly Added truncated meta, banner, clipped link | Genre dropped from the poster meta (year and runtime fit), banner is two rows (no empty third), no FAB over "See all requests". |
| D-24 empty Explore calendar day | One quiet line; the nearest busy day is shown underneath ("Latest" / "Next"); duplicate "Nothing new" label removed. |
| D-26 NutBot in three places | FAB gone; Library line is dismissible for the day and compact; Surprise me moved to the summary row. The contextual "Ask NutBot" in the mood tile is kept on purpose (it pre-fills a question for that mood). |
| D-27, U-10 letter dividers | Thin full-width heading rows. |
| D-28 empty result keeps the A to Z rail | Rail hidden for empty results, errors and lists under 20 titles. |
| D-29, U-6 repeated header lines | Lede says only what the count does not; the helper line is removed. |
| D-30 Collections sparse / late posters | First two shelves load eagerly, posters scale up to 200px, wider padding at 1700px+. |
| D-34 brand spelling | "Nuttyfin" everywhere (wordmark "Nutty" + accent "fin", aria-labels, docs). |
| D-35, P-14 console noise | Helper health probe is not repeated for ten minutes after a failure in this tab (test added). The other 404s / iframe warning are Fixer B's files. |
| D-36 skip link | First Tab on a fresh load reaches "Skip to content"; activating it focuses and scrolls to the page heading. |
| D-38 light-mode glass buttons | Glass button scrim .45 -> .66 alpha. |
| B-3 deep link leaves tab half off screen | Selected tab is centred in the strip on load (`tabs.ts`). |
| U-1 tab strip clips mid-word | Edge fade where more tabs hide; arrow keys and focus scroll the strip. |
| U-2 sticky chrome | Phones: tab strip scrolls away under the sticky bar. (Also fixes the Library summary bar hiding behind the tab row.) |
| U-3 landscape phone | Short screens keep the rail, search collapses to an icon, tabs keep the width; rail clock hidden. |
| U-7, U-8 Filters sheet | Button and sheet are both "Sort and filter"; "Shelves" removed from the look switch (Collections tab); equal-size grid buttons, no wrapped pill. |
| U-9 Wall view | Two columns on phones. |
| U-11 Newly Added switch | Removed; one fixed "last two months" rail. |
| U-12 Explore 26 rows | One row per show with count, range and a single Play to the next unwatched (`groupByShow`, tested). |
| U-13 Explore headers | "Why each one, in a line" removed; the count drops under the title on phones. |
| U-14 Continue rows truncate time left | Time left comes first in the line. |
| U-19 account menu on short phones | 44px theme buttons, bottom fade when the panel scrolls. |
| U-20 search panel unbounded | Max height from the visible viewport (follows the keyboard), scrolls inside, ends above the bottom bar. |
| U-24 performance (Library part) | `content-visibility: auto` on cards, async decoding; movies were already paged (60). |
| P-1, P-2 login | No card title/lede lines, centred compact landscape layout (Sign in on screen), scrim behind the wordmark, 44px Show / brand / checkbox targets, accent follows the colour theme in its always-dark scope. |
| P-3 44px targets at 360 | Top-bar icon buttons 44px; Explore day buttons 44px wide at 360. |
| P-9 NutBot subtitle | "Picks something to watch"; chip row fades at the edge. |
| P-10 Library NutBot tile in landscape | Buttons wrap under the text. |
| P-12 toast | Tap to dismiss. |

## Skipped or partly done

- D-25 (Explore / Home request volume): Home's badge now reuses the Newly Added request list (one Seerr fetch less); lazy-loading below-the-fold rails and caching Suggestions not done (risk to Home's still-first-paint rule, needs its own pass).
- U-10 "rail only after tapping a handle": done as "only while the list is moving or focused"; letters 12px, 44px hit area.
- P-11 (Details hero Play is a different orange): the colour is set in `details.css` (Fixer B's file).
- P-13 (Requests "Asked by" default to Me): `src/pages/requests/list.ts` is Fixer B's; the badge is already "mine" everywhere. Suggest B default the admin filter to the person.
- Home "Keep watching" hero in light themes keeps the (now deeper) light accent on its Resume button; it passes 4.5:1.
- Not in my lane (Fixer B): D-1, D-2, D-4, D-7, D-9, D-14, D-15, D-18, D-20, D-21, D-22, D-31, D-32, D-33, D-37; B-1, B-5, B-6, B-7, U-4, U-15, U-16, U-17, U-18, U-21, U-23, P-4 to P-8. B's `details.css` / `requests.css` have `#13100c` / small-text literals that I could not touch; `requests/browse.ts` measures `.top`'s height (still a real 58px box on phones).

## Not verified

Real iOS / Android keyboards and safe areas, a non-admin account, YouTube trailers, playback. The tab-strip move on phones (`placeTabs`) was checked by resizing 390 -> 1200 -> 390.

## Commits (oldest first)

contrast tokens + test; shell NutBot / Favourites / 404; open requests; tab strip + landscape; search / account menu; library; home; login; polish (toast, skip link, health probe, NutBot chips); phone tab strip scrolls away; Newly Added banner; docs.
