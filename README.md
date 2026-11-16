# Nuttyfin

A family-friendly web client for a Jellyfin server, with Seerr requests built in, an optional helper service
(NutBot's brain, the On TV calendar, a smart "remove everything properly" dialog) and a player tuned for a small home server.
Static single-page app: Vite + TypeScript, no UI framework. Product name is "Nuttyfin".

Working rules for people and agents: [`AGENTS.md`](AGENTS.md). Design rules: [`docs/DESIGN-RULES.md`](docs/DESIGN-RULES.md).
Plan and phases: [`PLAN.md`](PLAN.md). How a page is written: [`docs/PAGE-CONTRACT.md`](docs/PAGE-CONTRACT.md).

## Run it
```bash
npm install
npm run dev                  # http://localhost:5174, proxies /jf (Jellyfin), /seerr (Seerr), /nutfin-api (helper)
# no server at hand? add ?demo=1 to the address: fixtures from design/catalog.json, any login works,
# and a simulated helper (NutBot brain, calendar, Remove with plan and preview).
# demo extras: &member=1 signs in as an ordinary member, &nohelper=1 pretends the helper is not installed
npm run helper               # optional: the helper service on :8120 (needs its env file, see helper/.env.example)
```
Server addresses come from `NUTFIN_JELLYFIN`, `NUTFIN_SEERR`, `NUTFIN_HELPER` (see `vite.config.ts`).

## Test and build
```bash
npm run typecheck && npm test && npm run build     # the helper's typecheck and tests are included
```
Real-server checks use `NUTFIN_TEST_USER` / `NUTFIN_TEST_PASS` from the environment and only ever read.

## Deploy
Drafts only, applied by hand: [`deploy/README.md`](deploy/README.md) (Caddy block, systemd unit, DNS line, ordered steps, rollback).

## Architecture in 20 lines
1. The browser loads one static bundle (`dist/`). Everything is same-origin through the reverse proxy:
   `/jf/*` Jellyfin, `/seerr/*` Seerr, `/nutfin-api/*` the helper. No CORS, no API keys in the browser.
2. The UI never calls `fetch`. It talks to the `Backend` interface (`src/api/backend.ts`): `jellyfin.ts` (real) or `demo.ts`.
3. Raw server JSON becomes small shapes once, at the edge (`normalise.ts`, `seerr.ts`, `seerr-desk.ts`); pages only see those.
4. Sign-in is Jellyfin's (password or Quick Connect); the token lives in localStorage. After a password sign-in the same
   credentials open a Seerr session, and requests simply hide themselves if that fails.
5. Pages are modules with `render(ctx)` registered in `src/routes.ts`; the shell (rail, top bar, one search) is not the pages' business.
6. Home has five tabs of self-loading tiles. Library, Details, Requests and the Player are their own pages.
7. Requests (`src/pages/requests`): search, an "Ask for it" sheet with season picker, a status flow, approve and decline for
   owners, problem reports. Permissions, 4K and quality choices come from Seerr itself and are hidden when Seerr does not offer them.
8. The helper (`helper/`, Node, no dependencies) is a separate small server. Every call carries the person's Jellyfin token;
   the helper checks it with Jellyfin, learns who is an administrator, and caches that for a minute.
9. Helper routes: `GET /health`, `GET /calendar` (Sonarr and Radarr joined to the library), `POST /nutbot/chat`
   (shells out to the `claude` or `codex` CLI with tools off, a trimmed environment and a timeout), `POST /delete/plan` and
   `POST /delete/execute` (owner only).
10. Smart delete works out hardlinks from real file data: deleting only the library copy frees nothing while a torrent still
    holds the second link. Execute is a dry run unless asked otherwise AND the helper has `NUTFIN_ALLOW_DELETE=1`; it runs
    torrent, then Radarr/Sonarr, then Jellyfin, and stops at the first failure.
11. The SPA treats the helper as optional (`src/api/helper.ts`): no helper means the local NutBot brain, Jellyfin's own
    upcoming list, and a Remove dialog limited to "from Jellyfin only".
12. Looks: tokens in `src/styles/tokens.css` (light, dark, auto), self-hosted fonts, inline SVG icons, phones first.
