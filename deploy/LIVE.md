# Live deployment — 16 November 2026

Deployed by explicit owner request, replacing the default page at the existing Jellyfin hostnames.

- LAN: http://jellyfin.avns.nut/
- Public: https://jellyfin.avns.site/
- Original Jellyfin interface: `/web/` on those same hosts; direct port 8096 is unchanged.
- Frontend release: `/opt/docker/infra/caddy/data/nuttyfin/releases/20261116-194009-d19e2fe`.
- Current release link: `/opt/docker/infra/caddy/data/nuttyfin/current` (container path `/data/nuttyfin/current`).
- Helper: `/opt/nuttyfin/helper`, enabled system service `nuttyfin-helper.service`, listening on `192.168.1.24:8120`.
- Helper credentials: `/etc/nuttyfin-helper.env` (root-owned, group-readable by the service user); secrets are not in Git.
- Caddy: `/opt/docker/infra/caddy/Caddyfile`. Uses the existing `/data` mount; no Compose changes or container recreation.
- Configuration backup: `/opt/docker/infra/caddy/data/nuttyfin/backups/20261116-194009-d19e2fe/Caddyfile`.
- Applied routing: [Caddyfile.jellyfin](Caddyfile.jellyfin). It preserves raw Jellyfin endpoints for native clients, `/web/`, `/jf/*`, `/seerr/*` and `/nutfin-api/*`.
- No DNS or Cloudflare tunnel changes were needed: the existing Jellyfin hostname routes were reused.
- Real deletion remains disabled (`NUTFIN_ALLOW_DELETE=0`).

## Checks completed

All 304 app tests and 68 helper tests, typechecks and the production build passed. Verified production HTML and immutable assets, missing asset 404, prefixed and raw Jellyfin public info, original Jellyfin web client, Seerr status, unauthenticated helper rejection, and public HTTPS using public DNS resolution.

A real-account browser smoke test signed in through the production UI, loaded Home and Continue Watching, verified the Seerr cookie path `/seerr`, checked the authenticated helper and calendar endpoint, and got a real NutBot response from the service. Desktop 1440×900 and phone 390×844 screenshots were inspected; no horizontal phone overflow or browser runtime errors. The calendar returned no upcoming entries during the check.

No media was played, requested or deleted during deployment. Full playback through Caddy, Safari/iOS, TV clients and actual delete execution have not been tested in this deployment.

## Updating

Run the repository's typecheck, tests and build first. Copy `dist/` into a new timestamped folder under the releases directory, preserving the old release. Atomically replace the `current` symlink with a relative link to that folder. Static-only updates need no Caddy reload. Keep existing hashed assets available when updating so an already-open browser can finish loading its previous release.

Helper changes require copying the helper code and restarting only `nuttyfin-helper.service`. Keep `/etc/nuttyfin-helper.env` in place; never replace it with the empty example.

## Roll back to the original Jellyfin interface

Restore the saved Caddyfile **in place**, because Caddy bind-mounts the file. Replacing its inode can leave the container reading the old file.

```bash
sudo sh -c 'cat /opt/docker/infra/caddy/data/nuttyfin/backups/20261116-194009-d19e2fe/Caddyfile > /opt/docker/infra/caddy/Caddyfile'
docker exec caddy caddy validate --config /etc/caddyfile --adapter caddyfile
docker exec caddy caddy reload --config /etc/caddyfile --adapter caddyfile
```

The original Jellyfin web interface becomes the default again. The helper can be disabled independently with `sudo systemctl disable --now nuttyfin-helper.service`. Neither rollback step deletes media or changes Jellyfin's stored settings.
