/** POST /nutfin-api/nutbot/chat: {messages, context} -> {reply, picks}. The brain is the claude/codex CLI (see nutbot/cli.ts). */
import { clean, CliError, HttpError, json, upstreamJson, type Ctx, type Res } from '../core.ts';
import type { RateLimiter } from '../ratelimit.ts';
import { libraryItems } from '../jellyfin.ts';
import { buildInvocation, extractReply } from '../nutbot/cli.ts';
import { parseModelReply, type RequestCandidate } from '../nutbot/parse.ts';
import { buildDigest, buildPrompt, SYSTEM_PROMPT, type Turn } from '../nutbot/prompt.ts';

const MAX_TURNS = 12;
const MAX_TEXT = 500;
const MAX_PARALLEL = 2;

export interface ChatPick { kind: 'library' | 'request'; id?: string; tmdbId?: number; mediaType?: 'movie' | 'tv'; title: string; why: string }

export function parseMessages(body: unknown): Turn[] {
  const b = body as { messages?: unknown } | null;
  if (!b || !Array.isArray(b.messages) || b.messages.length === 0 || b.messages.length > MAX_TURNS * 4) throw new HttpError(400, 'bad-request', 'messages must be a short list');
  const turns: Turn[] = [];
  for (const m of b.messages) {
    const t = m as { role?: unknown; text?: unknown };
    if ((t.role !== 'user' && t.role !== 'assistant') || typeof t.text !== 'string') throw new HttpError(400, 'bad-request', 'each message needs a role and text');
    if (t.text.length > MAX_TEXT * 4) throw new HttpError(400, 'too-long', 'That message is too long');
    turns.push({ role: t.role, text: t.text.slice(0, MAX_TEXT) });
  }
  if (turns[turns.length - 1]?.role !== 'user') throw new HttpError(400, 'bad-request', 'the last message must be from the person');
  return turns;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** A "request" idea only becomes a pick when Seerr really knows a film/show of that name that is not already in the library. */
export async function validateRequests(ctx: Ctx, list: readonly RequestCandidate[]): Promise<ChatPick[]> {
  if (!ctx.cfg.seerrKey) return [];
  const out: ChatPick[] = [];
  await Promise.all(list.map(async (c, idx) => {
    try {
      const r = await upstreamJson<{ results?: Array<{ id: number; mediaType: string; title?: string; name?: string; releaseDate?: string; firstAirDate?: string; mediaInfo?: { status?: number } }> }>(
        ctx.deps, 'seerr', `${ctx.cfg.seerrUrl}/api/v1/search?query=${encodeURIComponent(c.title)}&page=1`, { headers: { 'X-Api-Key': ctx.cfg.seerrKey }, timeoutMs: 8000 });
      const want = norm(c.title);
      const hit = (r?.results ?? []).find(h => {
        if (h.mediaType !== c.mediaType) return false;
        if (norm(h.title ?? h.name ?? '') !== want) return false;
        const y = Number((h.releaseDate ?? h.firstAirDate ?? '').slice(0, 4));
        return !c.year || !y || Math.abs(y - c.year) <= 1;
      });
      if (!hit || hit.mediaInfo?.status === 5) return;
      out[idx] = { kind: 'request', tmdbId: hit.id, mediaType: c.mediaType, title: clean(hit.title ?? hit.name ?? c.title, 100), why: c.why };
    } catch { /* an unverified idea is simply dropped */ }
  }));
  return out.filter(Boolean);
}

export class ChatService {
  private running = 0;
  private readonly limiter: RateLimiter;
  constructor(limiter: RateLimiter) { this.limiter = limiter; }

  async handle(ctx: Ctx): Promise<Res> {
    const turns = parseMessages(ctx.body);
    const wait = this.limiter.take(ctx.user.id, ctx.deps.now());
    if (wait > 0) throw new HttpError(429, 'rate-limited', 'NutBot needs a moment. Try again shortly.', { 'Retry-After': String(Math.ceil(wait / 1000)) });
    if (this.running >= MAX_PARALLEL) throw new HttpError(429, 'busy', 'NutBot is busy right now. Try again in a moment.');
    this.running++;
    try {
      const items = await ctx.cache.get(`digest:${ctx.user.id}`, 300_000, () =>
        libraryItems(ctx, ['Movie', 'Series'], ['Genres', 'RunTimeTicks', 'ProductionYear', 'CommunityRating', 'OfficialRating']));
      const { lines, total } = buildDigest(items, ctx.cfg.digestMax);
      const { prompt, ids } = buildPrompt({ name: ctx.user.name, turns, lines, total, maxChars: ctx.cfg.maxPromptChars });
      const titles = new Map(items.filter(i => ids.has(i.Id)).map(i => [i.Id, clean(i.Name, 100)] as const));
      let raw: string;
      try {
        raw = extractReply(ctx.cfg.cli, await ctx.deps.runCli(buildInvocation(ctx.cfg, SYSTEM_PROMPT, prompt)));
      } catch (e) {
        const kind = e instanceof CliError ? e.kind : 'failed';
        throw new HttpError(503, 'brain-unavailable', kind === 'timeout' ? 'NutBot took too long to think.' : kind === 'missing' ? 'NutBot\'s brain is not installed on the server.' : 'NutBot could not answer just now.');
      }
      const parsed = parseModelReply(raw, titles);
      if (!parsed.reply) throw new HttpError(503, 'brain-unavailable', 'NutBot had nothing to say.');
      const requests = await validateRequests(ctx, parsed.requests);
      const picks: ChatPick[] = [...parsed.library.map((p): ChatPick => ({ kind: 'library', id: p.id, title: p.title, why: p.why })), ...requests];
      return json(200, { reply: parsed.reply, picks });
    } finally { this.running--; }
  }
}
