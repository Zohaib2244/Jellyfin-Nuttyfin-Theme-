import { defineConfig } from 'vite';

// Dev: the app talks to /jf (Jellyfin) and /seerr (Seerr) on its own origin, exactly like production behind Caddy.
const JELLYFIN = process.env.NUTFIN_JELLYFIN ?? 'http://192.168.1.24:8096';
const SEERR = process.env.NUTFIN_SEERR ?? 'http://192.168.1.24:5055';

export default defineConfig({
  server: {
    proxy: {
      '/jf': { target: JELLYFIN, changeOrigin: true, ws: true, rewrite: p => p.replace(/^\/jf/, '') },
      '/seerr': { target: SEERR, changeOrigin: true, rewrite: p => p.replace(/^\/seerr/, '') },
    },
  },
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
