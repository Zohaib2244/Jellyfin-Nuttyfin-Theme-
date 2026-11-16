# Nuttyfin plan

## Architecture
- **Static SPA** (Vite + TS) served by Caddy. Same-origin proxying: `/jf/*` → Jellyfin :8096, `/seerr/*` → Seerr :5055, later `/nutfin-api/*` → helper service. No CORS, no keys in the browser.
- **Auth:** `POST /jf/Users/AuthenticateByName` with header `Authorization: MediaBrowser Client="Nuttyfin", Device="<browser>", DeviceId="<uuid in localStorage>", Version="0.1.0"` (+ `Token="..."` once signed in). Keep AccessToken + UserId in localStorage. 401 on any call → sign out. Quick Connect as a second login method. After a Jellyfin sign-in, also `POST /seerr/api/v1/auth/jellyfin {username,password}` (sets Seerr's session cookie); if Seerr fails, request features degrade to hidden/disabled, nothing else breaks.
- **Backend interface** (`src/api/backend.ts`): resume, nextUp, latest, items(query), item(id), similar, seasons/episodes, people, search, playbackInfo, report progress, set played/favourite, images; Seerr: search, request, requests list, quota, issues. `jellyfin.ts` real, `demo.ts` fixtures.
- **Models** (`src/api/types.ts`): normalise `BaseItemDto` into small `Title`/`Episode`/`Person` shapes once, at the edge. UI only sees these.
- **Routing:** hash router (`#/`, `#/home/<tab>`, `#/movies`, `#/shows`, `#/title/<id>`, `#/watch/<id>`, `#/requests`, `#/login`). Page = module exporting `render(ctx): HTMLElement | Promise<HTMLElement>` plus optional `dispose`.
- **Look:** tokens + base CSS lifted from `design/mockups/home.html` into `src/styles/` (tokens.css, base.css, shell.css, one css per page/tile). Themes light/dark/auto, page backgrounds (default "Projector beam").
- **Player:** `<video>` + custom minimal controls from `design/mockups/player.html`; direct play when the browser can, else HLS via hls.js from Jellyfin's transcode; progress reporting (`/Sessions/Playing`, `/Progress`, `/Stopped`), audio/subtitle switching, trickplay thumbs, skip-intro from MediaSegments, next-episode.
- **Helper service (phase 6, separate small server):** NutBot chat brain, smart delete (Jellyfin-only vs Radarr/Sonarr + torrent), "On TV this week" from Sonarr calendar. Holds the Radarr/Sonarr/qBittorrent keys. Not part of the SPA.
- **Server constraints:** Haswell i5-4590T, H.264 hardware only, no HEVC hardware decode → prefer direct play, request H.264 ≤1080p transcode profile when needed, show a plain-language "Plays perfectly here / Will be converted" badge.

## Layout of work (so two agents never collide)
- `src/api/**`, `src/lib/**`, `src/state/**`, `src/router.ts`, `src/main.ts`, `src/ui/shell/**`, `src/styles/{tokens,base,shell}.css`: foundation
- `src/pages/home/**` (+ tiles): Home and its tabs
- `src/pages/library/**`, `src/pages/details/**`, `src/pages/search/**`
- `src/pages/watch/**`: player
- `src/pages/requests/**`: Seerr requests
- `deploy/**`: drafts only

## Phases (done = typechecks, tests pass, built, looked at in a browser at desktop and phone width)
1. **Foundation:** scaffold, Backend interface + demo backend + Jellyfin client skeleton, auth/login page, app shell (left rail, top bar with ONE search, section tabs slot, avatar menu, theme switch, page background), router, global styles, `html` helper, unit tests for auth header/URL builders/models.
2. **Home** on real data: Keep watching hero (+recommendations rail), Next episode, compact Continue watching, New this week, tabs (Home, Continue Watching, Explore, Newly Added, Requests), Short on time, mood nav, Arrange mode.
3. **Library** (Movies, Shows) + **Search** + **Details** page (audio/subtitle pickers, versions, cast & crew, seasons/episodes, more like this, favourite/watched).
4. **Player.**
5. **Requests** (Seerr search/request/quota/issues/status).
6. **Helper service** (NutBot, smart delete, calendar).
7. **Deploy draft** (Caddy block for nutfin.avns.nut / .avns.site, build output, README) + optional Android TV wrapper.

Test account: the owner will provide `NUTFIN_TEST_USER` / `NUTFIN_TEST_PASS` for real-server checks; until then use `?demo=1`.
