/**
 * NutBot's remote brain: the helper service's CLI-backed model, behind the same `NutBrain` interface as the scripted local one.
 * It only ever wraps the local brain: when the helper is not installed, is busy or fails, this turn is answered locally and
 * the person never sees an error. Picks come back as ids; we turn them into real library titles / Seerr results here.
 */
import type { Backend } from '../../../api';
import type { NutbotPick, NutbotTurn } from '../../../api/desk-types';
import type { SeerrResult, Title } from '../../../api/types';
import type { NutAnswer, NutBrain, Pick } from './brain';

const BACKOFF_MS = 120_000;
const MAX_KEEP = 10;

export class RemoteBrain implements NutBrain {
  private turns: NutbotTurn[] = [];
  private downUntil = 0;

  constructor(private readonly backend: Backend, private readonly local: NutBrain, private readonly now: () => number = Date.now) {}

  reset(): void {
    this.turns = [];
    (this.local as { reset?: () => void }).reset?.();
  }

  async ask(text: string): Promise<NutAnswer> {
    if (this.now() < this.downUntil || !(await this.backend.helper.available())) return this.local.ask(text);
    const messages: NutbotTurn[] = [...this.turns, { role: 'user' as const, text }].slice(-MAX_KEEP);
    try {
      const r = await this.backend.helper.chat(messages, { hour: new Date().getHours() });
      const picks = await this.resolve(r.picks);
      this.turns = [...messages, { role: 'assistant' as const, text: r.reply }].slice(-MAX_KEEP);
      return { reply: r.reply, picks };
    } catch (e) {
      // 429 = the person is chatting fast: just answer this one locally. Anything else: leave the helper alone for a while.
      const status = (e as { status?: number } | null)?.status;
      if (status !== 429 && status !== 400) this.downUntil = this.now() + BACKOFF_MS;
      return this.local.ask(text);
    }
  }

  private async resolve(raw: readonly NutbotPick[]): Promise<Pick[]> {
    const libIds = raw.filter(p => p.kind === 'library' && p.id).map(p => p.id as string);
    const titles = new Map<string, Title>();
    if (libIds.length) {
      try { for (const t of (await this.backend.items({ ids: libIds, limit: libIds.length })).items) titles.set(t.id, t); } catch { /* picks without a title are dropped below */ }
    }
    const out = await Promise.all(raw.map(async (p): Promise<Pick | null> => {
      if (p.kind === 'library') {
        const t = p.id ? titles.get(p.id) : undefined;
        return t ? { kind: 'library', title: t, why: p.why } : null;
      }
      if (!p.tmdbId || !p.mediaType) return null;
      const d = await this.backend.seerr.detail(p.mediaType, p.tmdbId).catch(() => null);
      if (!d) return null;
      const result: SeerrResult = { tmdbId: d.tmdbId, mediaType: d.mediaType, title: d.title, year: d.year, overview: d.overview, posterPath: d.posterPath, state: d.state, partial: d.partial || undefined, jellyfinId: d.jellyfinId };
      return { kind: 'request', result, why: p.why };
    }));
    return out.filter((x): x is Pick => !!x);
  }
}
