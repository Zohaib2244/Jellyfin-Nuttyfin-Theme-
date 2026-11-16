# Nuttyfin: working rules

Nuttyfin is a family-friendly web client for the owner's Jellyfin 12.3 server (http://192.168.1.24:8096) with Seerr (http://192.168.1.24:5055) requests built in. Static single-page app: Vite + TypeScript, no UI framework.

Read first: `PLAN.md` (architecture, phases), `docs/DESIGN-RULES.md` (owner's standing design rules, binding), `design/mockups/*.html` (the approved look; copy CSS and markup from here, do not redesign).

## Hard rules
- This is a LIVE homelab. Never touch Caddy/docker/systemd, never restart services, never write to /mnt/*, never deploy. Draft infra changes as files under `deploy/` for the owner to apply by hand.
- Never modify the Jellyfin server's data. Read-only API calls are fine; any write (favourite, played state, playback reports, requests) only through the app's own UI code paths and only when testing with the owner's test account.
- No secrets in the repo or in logs. Credentials come from env vars (`NUTFIN_TEST_USER`, `NUTFIN_TEST_PASS`) for tests only.
- Commit locally on `main` in small commits per finished step. Never push. Commit message ends with the Co-Authored-By line the harness gives you.
- Max 2 agents in parallel on this repo; each owns separate directories (see PLAN.md).

## Code rules
- TypeScript strict. No `any` unless commented why. No framework: small modules, `html` tagged template helper (auto-escapes), event delegation, one `render(ctx)` per page.
- Everything talks to the server through `src/api/backend.ts` (`Backend` interface). Two implementations: `jellyfin` (real) and `demo` (fixtures from `design/catalog.json`, enabled with `?demo=1` or when `localStorage.nutfin.demo=1`). UI never calls `fetch` directly.
- Same-origin only: `/jf/*` is Jellyfin, `/seerr/*` is Seerr (Vite proxy in dev, Caddy in prod).
- Accessibility is part of done: real buttons/links, 44px targets, visible focus, `prefers-reduced-motion` respected, labels on controls, keyboard-operable tabs/menus/dialogs.
- Icons are inline SVG only (unicode glyphs render as boxes on this setup). Fonts are self-hosted via @fontsource (no Google Fonts requests).
- Phones matter: every screen must work at 360px wide with no horizontal page scroll.
- Verify before saying done: `npm run typecheck && npm test && npm run build`, plus a real-browser check (Playwright is installed at /home/nutmag2469/.local/share/playwright-kit, chromium under ~/.cache/ms-playwright) at 1440x900 and 390x844 with screenshots you actually look at. Report what you did NOT verify.
