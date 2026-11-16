# Deployment

**Live since 16 November 2026:** Nuttyfin is deployed at the existing Jellyfin addresses by explicit owner request. See [LIVE.md](LIVE.md) for the installed paths, checks, update procedure and rollback. [Caddyfile.jellyfin](Caddyfile.jellyfin) is the applied routing pattern.

The instructions below describe the original alternative: a separate Nuttyfin hostname. Do not apply those steps over the live deployment.

# Deploying Nuttyfin (by hand, in this order)

Everything in this folder is a **draft**. Nothing here has been applied, and the agent that wrote it never touched
`/opt/docker`, Caddy, systemd or dnsmasq. You apply it, step by step, and every step has a check and an undo.

| File | What it is | Goes to |
|---|---|---|
| `Caddyfile.nuttyfin` | the `nuttyfin.avns.nut` block (and a commented public one) | appended to `/opt/docker/infra/caddy/Caddyfile` |
| `nuttyfin-helper.service` | hardened systemd unit for the helper | `/etc/systemd/system/` |
| `dnsmasq.nuttyfin.conf` | the one DNS line | `/opt/docker/infra/dnsmasq/dnsmasq.conf` |
| `../helper/.env.example` | helper settings template | copied to `/etc/nuttyfin-helper.env` and filled in |

What ends up running: Caddy serves the built app from disk and proxies three paths on the same hostname:
`/jf/*` to Jellyfin :8096, `/seerr/*` to Seerr :5055, `/nutfin-api/*` to the helper on the host :8120.
The helper is optional: without it the app works and simply hides NutBot's remote brain, the real On TV calendar and the smart Remove options.

Run the commands from the repo checkout (`~/dev/nutfin` or a worktree of it) unless a step says otherwise.

## 0. Before you start (2 minutes)
- Nobody is mid-playback or mid-upload: step 5 recreates the Caddy container, which drops every site for a second or two (see "Avoiding that" in step 5).
- Node 22.6 or newer on the host (`node -v`; this box has 24).
- `claude` works as nutmag2469: `claude -p "say hi" --model haiku` prints a reply.

## 1. Build and test
```bash
npm ci
npm run typecheck && npm test && npm run build      # also runs the helper's own tests
ls dist/index.html dist/assets | head
```

## 2. Put the app where Caddy can see it
A new folder per release, plus a `current` symlink, so a deploy is one atomic switch and a rollback is one command.
```bash
STAMP=$(date +%Y%m%d-%H%M%S)
sudo mkdir -p /opt/docker/infra/nuttyfin/releases
sudo rsync -a --delete dist/ /opt/docker/infra/nuttyfin/releases/$STAMP/
sudo ln -sfn releases/$STAMP /opt/docker/infra/nuttyfin/current        # relative link: works inside the container too
sudo chown -R root:root /opt/docker/infra/nuttyfin
ls -l /opt/docker/infra/nuttyfin/current
```
Undo later: `sudo ln -sfn releases/<older-stamp> /opt/docker/infra/nuttyfin/current` (no restart needed).

## 3. Install the helper (host service)
```bash
# 3a. the code (no dependencies to install)
sudo mkdir -p /opt/nuttyfin
sudo rsync -a --delete --exclude node_modules --exclude test helper/ /opt/nuttyfin/helper/

# 3b. its settings: copy the template, fill in the keys, lock it down
sudo install -m 640 -o root -g nutmag2469 helper/.env.example /etc/nuttyfin-helper.env
sudo nano /etc/nuttyfin-helper.env
```
In the file you need: the Sonarr and Radarr API keys (Settings > General, or `<ApiKey>` in
`/opt/docker/media-stack/{sonarr,radarr}/config/config.xml`), the Seerr API key (Seerr > Settings > General), and the
qBittorrent Web UI user and password (the same ones Radarr's download client uses). Leave `NUTFIN_ALLOW_DELETE=0`.
`NUTFIN_HELPER_HOST` must be `192.168.1.24` (Caddy reaches the host through that address).

```bash
# 3c. the service
sudo cp deploy/nuttyfin-helper.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nuttyfin-helper
systemctl status nuttyfin-helper --no-pager | head -8
curl -s -o /dev/null -w "%{http_code}\n" http://192.168.1.24:8120/nutfin-api/health      # 401: it is alive and wants a Jellyfin token
```
If NutBot later answers "could not answer" and `journalctl -u nuttyfin-helper -n 30` shows a permission error, the unit's
`ReadWritePaths=` needs the folder the claude CLI complained about (the unit was syntax-checked with
`systemd-analyze verify` and scores 1.5 "OK" in `systemd-analyze security`, but it was not started under the sandbox).
Undo: `sudo systemctl disable --now nuttyfin-helper && sudo rm /etc/systemd/system/nuttyfin-helper.service && sudo systemctl daemon-reload`.

## 4. The DNS name
```bash
sudo cp /opt/docker/infra/dnsmasq/dnsmasq.conf /opt/docker/infra/dnsmasq/dnsmasq.conf.bak-$(date +%F)-nuttyfin
echo 'address=/nuttyfin.avns.nut/192.168.1.24' | sudo tee -a /opt/docker/infra/dnsmasq/dnsmasq.conf
(cd /opt/docker/infra/dnsmasq && docker compose restart)
getent hosts nuttyfin.avns.nut        # 192.168.1.24
```
(`add-service` would also do this line, but it writes a plain reverse proxy block into Caddy, which is not what we want, so do the DNS line by hand.)

## 5. Caddy
```bash
cd /opt/docker/infra/caddy
sudo cp Caddyfile Caddyfile.bak-$(date +%F)-nuttyfin
sudo cp docker-compose.yml docker-compose.yml.bak-$(date +%F)-nuttyfin

# 5a. one new volume line (under the other two) so the app folder is visible in the container
sudo sed -i 's|      - ./config:/config|      - ./config:/config\n      - /opt/docker/infra/nuttyfin:/srv/nuttyfin:ro|' docker-compose.yml
grep -n nuttyfin docker-compose.yml

# 5b. the site block
cat ~/dev/nutfin/deploy/Caddyfile.nuttyfin | sudo tee -a Caddyfile >/dev/null

# 5c. check before you change anything live (the new volume is not mounted yet, so this only checks syntax)
docker exec caddy caddy validate --config /etc/caddyfile --adapter caddyfile
```
`caddy validate` has to say `Valid configuration`. Then pick one:

- **Recreate (needed once, because of the new volume):** `docker compose up -d caddy`. Every site blinks for about a second. Do it when nobody is watching or uploading.
- **No volume change:** a running container cannot gain a volume. If you would rather not recreate Caddy, put the `releases/` folder and `current` link under a folder Caddy already mounts (for example `/opt/docker/infra/caddy/data/nuttyfin/`), skip step 5a, and change the two `root * /srv/nuttyfin/current` lines to `root * /data/nuttyfin/current`. Then `docker exec caddy caddy reload --config /etc/caddyfile --adapter caddyfile` is enough and nothing blinks.

Undo: `sudo cp Caddyfile.bak-<date>-nuttyfin Caddyfile && sudo cp docker-compose.yml.bak-<date>-nuttyfin docker-compose.yml && docker compose up -d caddy`.

## 6. Check it works
```bash
H=http://nuttyfin.avns.nut
curl -sI $H/ | head -5                                   # 200, Cache-Control: no-cache
curl -sI $H/some/deep/link | grep -i -E "HTTP|cache"     # 200 + no-cache: SPA fallback works
A=$(curl -s $H/ | grep -o '/assets/[^"]*\.js' | head -1)
curl -sI $H$A | grep -i -E "HTTP|cache-control|content-type"   # immutable, a year
curl -sI $H/assets/nope-123.js | head -1                 # 404 (NOT index.html)
curl -s $H/jf/System/Info/Public | head -c 200; echo     # Jellyfin's public info through the proxy
curl -s $H/seerr/api/v1/status; echo                     # {"version":"3.5.1",...}
curl -s -o /dev/null -w "%{http_code}\n" $H/nutfin-api/health      # 401: the helper answers through Caddy
```
In a browser on `http://nuttyfin.avns.nut` (a normal and a private window):
1. Sign in with your own account. Home loads with artwork (images come from `/jf/Items/...`).
2. Play something for a minute. Open dev tools > Network, filter `WS`: there should be a `/jf/socket` entry in state 101 (the websocket works through the prefix).
3. Requests page: it loads your list, the search works, an "Ask for it" sheet opens. Cookies tab: the Seerr cookie `connect.sid` shows **Path `/seerr`** and is not sent on `/jf/...` requests.
4. NutBot chat answers (helper) and Home > Explore > On TV this week fills from the real Sonarr calendar.
5. As owner, open a title > More > Remove: the dialog shows what is on the drive. Choose **Preview only**; nothing is deleted.

**Streaming checks:** start a transcode (play something the browser cannot direct play) and let it run past two minutes. If playback stalls at exactly 120 s or 150 s, a timeout in the Caddy block is the cause: raise it in `Caddyfile.nuttyfin`. Jellyfin's `TranscodingUrl` and `DirectStreamUrl` are root-relative (`/videos/...`), so the player has to prefix them with `/jf`; if video plays on `jellyfin.avns.nut` but not here, look at that first (the Vite dev proxy uses the same `/jf` layout, so it shows up in development too).

## Seerr behind `/seerr`: what was checked, what the risk is, what the fix does
Findings from the real server (Seerr 3.5.1, read-only):
- Sign-in answers `Set-Cookie: connect.sid=...; Path=/; Expires=<30 days>; HttpOnly; SameSite=Lax`. No `Secure`, no `Domain`.
- The app only uses Seerr's JSON API (`/api/v1/...`). Those answers carry no redirects, and the one root-relative field we ever saw (`avatar: "/avatarproxy/..."`) is not used. Posters come straight from TMDB's CDN, not through Seerr.
- Seerr's CSRF protection is off by default, so `connect.sid` is the only cookie involved.

What goes wrong without a fix: it works, but `Path=/` makes the browser attach the Seerr session cookie to **every** request on the host, including `/jf/*` (Jellyfin) and `/nutfin-api/*` (the helper). Nothing there reads it, but the cookie is exposed to code that should never see it, and it would clash with any other app on the hostname that also uses `connect.sid`.

The fix is in the Caddy block, `header_down Set-Cookie "(?i)Path=/(;|$)" "Path=/seerr$1"`: it rewrites only the `Path=/` attribute of cookies coming back from Seerr, to `Path=/seerr`. The browser then sends the cookie only to `/seerr/...`, which is the only place Seerr needs it. The pattern was run against the real header and three variants (attribute in the middle, at the end, other paths left alone) and behaves; Caddy itself was not run, so use check 3 above to see it live (`Path=/seerr` in the cookie list, and `curl -si -X POST ... /seerr/api/v1/auth/jellyfin` shows it in the response header).
Public site only: Cloudflare terminates TLS and talks plain HTTP to Caddy, so Seerr does not mark the cookie `Secure`. For a same-origin session cookie that works; if you want it marked, add one more line in the `.site` block: `header_down Set-Cookie "$" "; Secure"` (appends to every cookie from Seerr).
Jellyfin has no cookies in this setup (token header only), so `/jf` needs nothing.

## Optional: public `nuttyfin.avns.site`
Read the caution in the commented block of `Caddyfile.nuttyfin` first. Short version: the app's only login is Jellyfin's, the same posture as `jellyfin.avns.site`; your rule says an `avns.site` host without its own login gets a Cloudflare Access app first (owner only). To publish: create the Access app, add the tunnel hostname and DNS entry for `nuttyfin.avns.site` by hand (not with `add-service --public`), uncomment the block, validate and reload.

## Updating later
```bash
npm run typecheck && npm test && npm run build
STAMP=$(date +%Y%m%d-%H%M%S); sudo rsync -a --delete dist/ /opt/docker/infra/nuttyfin/releases/$STAMP/
sudo ln -sfn releases/$STAMP /opt/docker/infra/nuttyfin/current              # live immediately, no restart
sudo rsync -a --delete --exclude node_modules --exclude test helper/ /opt/nuttyfin/helper/ && sudo systemctl restart nuttyfin-helper   # only if the helper changed
ls -1t /opt/docker/infra/nuttyfin/releases | tail -n +6 | sed 's|^|/opt/docker/infra/nuttyfin/releases/|' | xargs -r sudo rm -rf   # keep the last five
```

## Turning real deleting on (later, on purpose)
The helper refuses real deletes while `NUTFIN_ALLOW_DELETE` is anything but `1`; plans and **Preview only** always work.
Try the whole flow in Preview first on a title you do not care about. To allow real deletes: set `NUTFIN_ALLOW_DELETE=1` in `/etc/nuttyfin-helper.env`, `sudo systemctl restart nuttyfin-helper`. Set it back to `0` when you are done.
