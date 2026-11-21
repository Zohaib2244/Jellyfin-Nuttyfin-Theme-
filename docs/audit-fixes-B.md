# Audit fixes, lane B (Details, Requests / Discover / Browse / Request sheet, shared dialogs, player error text)

Branch `worktree-agent-a462d448c0b6eee1e`. Findings: `D-n` = docs/audit-desktop.md, `B-n`/`U-n`/`P-n` = docs/audit-phone.md.
Commits (short names): **dlg** 4cb0c9c, **report** 22cd7a8, **details** ba1cc48, **remove** 4f80900, **sheet** 069c555, **list** 71847af, **browse** f62fb6f, **player** 841dd57, **pad** 94d1bd5.

## Fixed
| Finding | Result |
|---|---|
| D-1 focus lost after Esc on a dialog opened from the More menu | fixed (dlg). Focus returns to the More button; checked by keyboard for Report, Remove step 1 and 2 (and the About-card Report button returns to itself). |
| D-2 Report dialog Tab is not a loop | fixed (dlg). Root cause: `[href]` matched the SVG `<use href>` inside the Send icon, so the "last control" was never focused. Now `a[href]`, one stop per radio group; Tab and Shift+Tab verified to stay inside Report, Remove 1, Remove 2. |
| D-4 player says "could not reach the server" for a missing item | fixed (player). 400/404 -> "We could not find that", only Back, no stack trace; unit test. |
| D-7 Browse year range | fixed (browse). No silent swap (that left the inputs showing a range that was not applied). A plain message appears, the list stays as it was, inputs are marked invalid; unit test. |
| D-9 / B-6 one-item season tab bar, "Season 1" wrapping | fixed (details). One season = plain "Season N" heading. 2+ seasons keep real tabs, now a one-line strip that scrolls sideways, nowrap labels, selected tab scrolled into view. |
| D-14 / U-23 jargon in Remove dialog and Audio card | fixed (remove, details). "Delete from the library", "Also remove from the downloader", "Also delete the downloaded copy"; Radarr/Sonarr/qBittorrent only in small muted details lines; unavailable options are left out (one line says only the library copy can be removed). Audio card: no codec names or "hardware help"; the file name row is owner-only. Unit test for `plainText`. |
| D-15 Request step 2 quality list | fixed (sheet). "Standard" once, friendly labels (HD 1080p, Ultra HD (4K), smaller files...), no release-group tags; admins get a small "Server profile: ..." line. Unit tests. |
| D-18 two search boxes | fixed on my side (sheet/browse): page box is "Find something to request". The top-bar label belongs to lane A. |
| D-20 / P-5 Report copy and machine string | fixed (report). "Pick the closest one and we will look into it."; the "We add this for you" line is gone (details still ride along in the message). |
| D-21 "Change anything and Nuttyfin remembers..." | fixed (details). Removed; a short toast "Saved for this film." appears after a real change. |
| D-22 Requests native select, wide rows | fixed (list). Styled select with chevron and hover; rows capped at 1100px. |
| D-31 show "On the server" tile | fixed (details): "10 episodes in 1 season on the server". |
| D-32 runtime twice, pixel-font labels | fixed (details). Film runtime not repeated under Play; labels under 14px use the body font (also dialog labels, request sheet labels). |
| D-33 Remove step 2 repeats "Are you sure?" | fixed (remove). Title "Delete X?", one warning line, no ellipses (also the menu items). |
| D-35 console noise (trailer, poster 404) | fixed for the trailer `allowfullscreen` warning (details + sheet) and the poster 404 (no Jellyfin poster request while a row is still loading its TMDB poster). The `/nutfin-api/health` 502 is skipped, see below. |
| D-37 Requests chips | fixed (list): empty chips dimmed, "Removed" pill no longer red. "FILM/SHOW" corner tags are kept (they help on mixed Discover rails). |
| D-12 / D-13 light contrast, local parts | fixed locally (details, list): small mono text on Details and the status words on Discover tiles are mixed toward the text colour (`--num-ink`, `color-mix`), tag text 12px. Global accent/muted tokens are lane A's. |
| D-10 NutBot button covers page content (Details "More like this", Requests) | fixed on my pages (pad): bottom padding on `.dt .wrap` and `.rq`. |
| B-1 Request sheet step 2 heading under the poster | fixed (sheet). A fixed 72px poster rule beat the 52px phone column. |
| B-5 More menu 6px off-screen | fixed (details): menu anchored to the button row on phones, never past the gutter (measured 16..296 of 390). |
| B-7 / U-18 request rows "Loading..." / untappable / 28px | fixed (list). Rows show the kind ("Film") while loading and "Film, name not available" when the lookup fails; failed lookups are retried on refresh; poster and title are 44px tappable and always open the sheet. Could not keep the row stuck on "Loading..." in my runs (titles arrive in ~3 s), simulated a failing lookup instead and checked the fallback. |
| U-4 Details hero taller than the landscape screen | fixed (details): hero is content-height under 520px tall; Play is on the first screen at 844x390. |
| U-15 episode deep link | fixed (details): lands on the Episodes heading (first rows) or the row with room under the bar; episode "S4 E1 · Name" is in the hero meta line. |
| U-16 duplicate runtime, nested card, helper text, keyword wall | fixed (details): all four. Keywords: genres plus 3, the rest behind "9 more tags". |
| U-17 browse switch, back button, stale lede | fixed (browse): back button removed (the Discover tab does it), 44px Films/Shows, lede follows the view. |
| U-21 Remove dialog landscape | fixed (remove): no poster/lead and a one-row footer under 520px tall. |
| U-22 small text (my pages) | fixed: Film/Show tags 12px, labels 13.5px+ in Details and dialogs, status words readable on light. Other screens' small text is lane A's/Home's. |
| U-24 show details images | partly: stills were already `loading="lazy"` (43 of 163 loaded at first paint); added `decoding="async"`. |
| P-4 "Technical details" 40px | fixed (details): 44px. |
| P-6 trailer black box / warning | fixed (report): spinner behind the iframe, no redundant `allowfullscreen`. Embed itself still cannot load in the sandbox. |
| P-7 chips with zero, unclear Report button | fixed (list): dimmed, button reads "Report a problem with a film or show". |
| P-8 "Show Over 10,000 films" | fixed (browse): "Show 10,000+ films". |
| P-13 Requests shows everyone while the badge is yours | fixed (list): admins start on their own requests (if any); `person=all` is the explicit Everyone. The badge number itself is lane A's. |

## Skipped
- D-35 / P-14 `/nutfin-api/health` 502 on every load: the probe lives in `src/api/helper.ts`, outside both lanes; the request failing is the intended "helper is not deployed" signal. Suggest caching the failed probe in `sessionStorage` for a few minutes.
- P-11 hero Play colour: in Light the Details banner is deliberately a forced-dark scope (artwork behind it), so it uses the dark accent. In dark both buttons are identical (`rgb(255,107,43)`).
- D-12/D-13 global tokens (white on orange 3.3:1, tab counts, "ORDER" labels), D-38, U-22 rail/badge: lane A.

## Not mine (lane A or Home/Library/shell)
D-3, D-5, D-6, D-8, D-11, D-16, D-17, D-19, D-23..D-30, D-34, D-36, B-2, B-3, B-4, U-1..U-3, U-5..U-14, U-19, U-20, P-1..P-3, P-9, P-10, P-12.

## Not verified
Remove with a live helper (offline in this environment; checked against a mocked plan response in the browser, nothing sent), YouTube trailer actually playing, Request confirm and Remove confirm (never clicked), real iOS/Android keyboards, non-admin accounts (only the owner exists).
