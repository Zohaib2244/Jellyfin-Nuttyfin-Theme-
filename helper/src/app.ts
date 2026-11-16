/**
 * The whole API as one function: Req -> Res. server.ts adapts it to node:http, tests call it directly with fake upstreams.
 * Every route (health included) first checks the caller's Jellyfin token; admin-only routes then check isAdministrator.
 */
import { Authenticator, requireAdmin } from './auth.ts';
import { TtlCache } from './cache.ts';
import type { Config } from './config.ts';
import { clean, HttpError, json, type Ctx, type Deps, type Req, type Res } from './core.ts';
import { RateLimiter } from './ratelimit.ts';
import { calendar } from './routes/calendar.ts';
import { deleteExecute, deletePlan } from './routes/delete.ts';
import { ChatService } from './routes/nutbot.ts';

export const VERSION = '0.1.0';
const PREFIX = '/nutfin-api';

export function createApp(cfg: Config, deps: Deps): (req: Req) => Promise<Res> {
  const auth = new Authenticator(cfg, deps);
  const cache = new TtlCache(() => deps.now());
  const chat = new ChatService(new RateLimiter(cfg.chatPerMin));

  type Handler = (ctx: Ctx) => Promise<Res>;
  const routes: Record<string, { method: 'GET' | 'POST'; admin?: boolean; run: Handler }> = {
    '/health': {
      method: 'GET',
      run: async () => json(200, {
        ok: true, version: VERSION,
        features: { calendar: !!cfg.sonarrKey, nutbot: true, delete: !!(cfg.radarrKey || cfg.sonarrKey), deleteEnabled: cfg.allowDelete },
      }),
    },
    '/calendar': { method: 'GET', run: calendar },
    '/nutbot/chat': { method: 'POST', run: ctx => chat.handle(ctx) },
    '/delete/plan': { method: 'POST', admin: true, run: deletePlan },
    '/delete/execute': { method: 'POST', admin: true, run: deleteExecute },
  };

  return async function handle(req: Req): Promise<Res> {
    try {
      if (!req.path.startsWith(`${PREFIX}/`)) throw new HttpError(404, 'not-found', 'Not found');
      const route = routes[req.path.slice(PREFIX.length).replace(/\/+$/, '')];
      if (!route) throw new HttpError(404, 'not-found', 'Not found');
      if (req.method !== route.method) throw new HttpError(405, 'method-not-allowed', 'Wrong method', { Allow: route.method });
      const user = await auth.authenticate(req.headers);
      if (route.admin) requireAdmin(user);
      return await route.run({ cfg, deps, cache, user, query: req.query, body: req.body });
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.code, message: e.message }, headers: e.headers };
      console.error('helper: unexpected error:', clean((e as Error)?.message ?? e, 300));
      return json(500, { error: 'internal', message: 'Something went wrong in the helper' });
    }
  };
}
