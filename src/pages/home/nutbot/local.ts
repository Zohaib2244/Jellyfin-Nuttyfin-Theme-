/**
 * The scripted local brain: keyword / mood / genre / runtime parsing over the library (and Seerr for things you do
 * not have yet). No model, no network beyond the normal Backend calls. Replaced later by the helper service's LLM.
 */
import type { Backend } from '../../../api';
import type { SeerrResult, Title } from '../../../api/types';
import { parseDate, runtime } from '../../../lib/format';
import type { NutAnswer, NutBrain, Pick } from './brain';
import { MOODS, moodPicks, whyFor, type Mood } from './moods';

export interface Query {
  moods: Mood[];
  /** longest runtime in minutes */
  maxMin?: number;
  minMin?: number;
  kind?: 'movie' | 'series';
  /** "like Silo" */
  like?: string;
  newer: boolean;
  /** the words left after the recognised bits (used as a title / Seerr search) */
  rest: string;
}

const WORDS: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5 };
const num = (s: string): number => (s in WORDS ? (WORDS[s] as number) : parseFloat(s));

/** Pull the facts out of free text. Pure. */
export function parseQuery(raw: string): Query {
  let text = ` ${raw.toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ')} `;
  const q: Query = { moods: [], newer: false, rest: '' };

  // "under 2 hours", "less than 90 minutes", "under two hours", "in an hour", "no more than 1.5 h"
  const lim = /\b(?:under|less than|below|within|in|no more than|max(?:imum)?|up to|shorter than)\s+(\d+(?:\.\d+)?|one|two|three|four|five|an?|half an?)\s*(h|hrs?|hours?|m|mins?|minutes?)\b/.exec(text);
  if (lim) {
    const n = num((lim[1] as string).replace('half an', 'half').replace('half a', 'half'));
    q.maxMin = Math.round(/^h/.test(lim[2] as string) ? n * 60 : n);
    text = text.replace(lim[0], ' ');
  }
  const over = /\b(?:over|more than|at least|longer than)\s+(\d+(?:\.\d+)?|one|two|three)\s*(h|hrs?|hours?|m|mins?|minutes?)\b/.exec(text);
  if (over) {
    const n = num(over[1] as string);
    q.minMin = Math.round(/^h/.test(over[2] as string) ? n * 60 : n);
    text = text.replace(over[0], ' ');
  }
  if (/\b(long|epic|marathon)\b/.test(text) && q.minMin == null) q.minMin = 130;

  const like = /\b(?:like|similar to|as good as|more of|reminds? me of|fans? of)\s+(.+?)\s*$/.exec(text);
  // "I would like something funny" is a wish, not "like <title>"
  if (like && !/^(something|anything|some|a|an|to|it|that|this)\b/.test(like[1] as string)) { q.like = (like[1] as string).trim(); text = text.replace(like[0], ' '); }

  if (/\b(shows?|series|tv)\b/.test(text)) q.kind = 'series';
  else if (/\b(films?|movies?)\b/.test(text)) q.kind = 'movie';
  q.newer = /\b(new|newer|newest|recent|latest|just added)\b/.test(text);

  for (const m of MOODS) {
    if (m.re.test(text)) { q.moods.push(m); text = text.replace(m.re, ' '); }
  }

  q.rest = text
    .replace(/\b(i|me|my|we|us|want|wanna|would|like|to|watch|see|something|anything|some|a|an|the|please|can|you|show|find|give|got|have|do|any|for|tonight|today|that|is|are|with|and|but|of|in|on|it|what|whats|looking|need|suggest|recommend|film|films|movie|movies|shows?|series|tv|new|newer|newest|recent|latest|more|bit|little|really)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return q;
}

/** "funny, under 2 h" for the reply. */
export function describe(q: Query): string {
  const parts = q.moods.map(m => m.chip.toLowerCase());
  if (q.maxMin != null) parts.push(`under ${runtime(q.maxMin)}`);
  if (q.minMin != null) parts.push(`over ${runtime(q.minMin)}`);
  if (q.kind) parts.push(q.kind === 'movie' ? 'films' : 'shows');
  if (q.newer) parts.push('recently added');
  return parts.join(', ');
}

const pickOf = <T>(arr: readonly T[], salt: number): T => arr[salt % arr.length] as T;
const hashOf = (s: string): number => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

export class LocalBrain implements NutBrain {
  private lib: Promise<Title[]> | null = null;
  private seerrOk: Promise<boolean> | null = null;
  /** ids already offered, so "something else" gives something else */
  private readonly shown = new Set<string>();
  private last: Query | null = null;

  constructor(private readonly backend: Backend) {}

  /** Everything in the library once (films and shows, best rated first). */
  private library(): Promise<Title[]> {
    this.lib ??= this.backend.items({ limit: 600, sort: 'rating', descending: true }).then(r => r.items).catch(() => { this.lib = null; return []; });
    return this.lib;
  }
  private seerr(): Promise<boolean> {
    this.seerrOk ??= this.backend.seerr.available().catch(() => false);
    return this.seerrOk;
  }

  reset(): void { this.shown.clear(); this.last = null; }

  async ask(text: string): Promise<NutAnswer> {
    const clean = text.trim();
    const salt = hashOf(clean) + this.shown.size;
    if (/^\s*(hi|hello|hey|yo|hiya|good (morning|evening|afternoon))\b/i.test(clean) && clean.split(/\s+/).length <= 3) {
      return { reply: 'Hi! Tell me what you are in the mood for, like "funny but under 2 hours", "something scary" or "like Silo".', picks: [], quick: ['Something funny', 'Something short', 'Something cosy'] };
    }
    if (/^\s*(thanks|thank you|cheers|ta)\b/i.test(clean)) return { reply: 'Any time. Enjoy it!', picks: [] };

    let q = parseQuery(clean);
    const again = /\b(something else|another|different one|more)\b/i.test(clean) && this.last;
    const refine = /^\s*(shorter|something newer|funnier|not animated|less scary|just films|just shows)\b/i.test(clean) && this.last;
    if (again || refine) {
      q = { ...this.last as Query, ...(q.moods.length ? { moods: q.moods } : {}) };
      if (/shorter/i.test(clean)) q.maxMin = Math.min(q.maxMin ?? 120, 95);
      if (/newer/i.test(clean)) q.newer = true;
      if (/funnier/i.test(clean) && !q.moods.some(m => m.key === 'funny')) q.moods = [...q.moods, ...MOODS.filter(m => m.key === 'funny')];
      if (/just films/i.test(clean)) q.kind = 'movie';
      if (/just shows/i.test(clean)) q.kind = 'series';
    }
    this.last = q;
    const lib = await this.library();

    // 1. "like X"
    if (q.like) {
      const seed = findTitle(lib, q.like);
      if (seed) {
        const sims = (await this.backend.similar(seed.id, 12).catch(() => [])).filter(t => t.id !== seed.id);
        const fresh = sims.filter(t => !this.shown.has(t.id));
        const chosen = (fresh.length ? fresh : sims).slice(0, 4);
        chosen.forEach(t => this.shown.add(t.id));
        const picks: Pick[] = chosen.map(t => ({ kind: 'library', title: t, why: `Because you liked ${seed.name}. ${shared(t, seed)}` }));
        if (picks.length) return { reply: `If ${seed.name} is your thing, ${pickOf(['these should fit', 'try these', 'I would start with these'], salt)}.`, picks, quick: ['Something else', 'Shorter', 'Just films'] };
        return { reply: `I do not have much like ${seed.name} right now. Want me to look for more to request?`, picks: await this.requestable(seed.name, 3, new Set()), quick: ['Something funny', 'Something cosy'] };
      }
      const asked = await this.requestable(q.like, 3, new Set());
      return { reply: asked.length ? `I cannot find ${titleCase(q.like)} in the library, but I found ${asked.length === 1 ? 'one you can ask for' : 'some you can ask for'}.` : `I could not find anything called ${titleCase(q.like)}. Try another name?`, picks: asked, quick: ['Something funny', 'Something cosy'] };
    }

    // 2. moods / runtime / kind
    if (q.moods.length || q.maxMin != null || q.minMin != null || q.newer) {
      let pool = lib.filter(t => (!q.kind || t.kind === q.kind));
      if (q.maxMin != null) pool = pool.filter(t => t.kind === 'movie' ? t.runtimeMin > 0 && t.runtimeMin <= (q.maxMin as number) : (q.maxMin as number) >= 45);
      if (q.minMin != null) pool = pool.filter(t => t.kind === 'movie' && t.runtimeMin >= (q.minMin as number));
      for (const m of q.moods) pool = pool.filter(m.test);
      if (q.newer) pool = pool.filter(t => { const d = parseDate(t.added); return !!d && Date.now() - d.getTime() < 60 * 864e5; });
      const rank = (t: Title): number => q.moods.reduce((a, m) => a + m.score(t), 0) + (t.rating ?? 6) / 4 - (t.played ? 4 : 0) + (hashOf(t.id + this.shown.size) % 10) / 20;
      pool.sort((a, b) => rank(b) - rank(a));
      const fresh = pool.filter(t => !this.shown.has(t.id));
      const chosen = (fresh.length >= 2 ? fresh : pool).slice(0, 4);
      chosen.forEach(t => this.shown.add(t.id));
      const mood = q.moods[0];
      const picks: Pick[] = chosen.map(t => ({ kind: 'library', title: t, why: `${whyFor(t, mood)}.${t.kind === 'movie' && t.runtimeMin ? ` ${runtime(t.runtimeMin)}.` : ''}` }));
      if (picks.length >= 2) {
        const top = chosen[0] as Title;
        return {
          reply: `${pickOf(['Here are my picks', 'How about these', 'Good news, I have a few'], salt)} for ${describe(q) || 'tonight'}. ${top.name} is my favourite.`,
          picks, quick: ['Something else', 'Shorter', 'Something newer'],
        };
      }
      const requests = await this.requestable(q.rest || (mood?.chip ?? ''), 3, new Set());
      const all: Pick[] = [...picks, ...requests];
      if (all.length) return { reply: picks.length ? `I only have ${picks.length === 1 ? 'one' : 'a couple'} for ${describe(q)}. Here ${requests.length ? 'and a few you could request' : 'it is'}.` : `Nothing in the library fits ${describe(q)}, but you could ask for one of these.`, picks: all, quick: ['Something cosy', 'Something funny'] };
      return { reply: `I could not find anything for ${describe(q)}. Try loosening it a little, like a different mood or a longer time.`, picks: [], quick: ['Something cosy', 'Something funny', 'Something short'] };
    }

    // 3. a title
    const words = q.rest || clean;
    const direct = findTitles(lib, words, 3);
    const requests = await this.requestable(words, 3, new Set(direct.map(t => t.name.toLowerCase())));
    const picks: Pick[] = [
      ...direct.map((t): Pick => ({ kind: 'library', title: t, why: t.played ? 'You have watched this one. It is ready to watch again.' : 'In your library, ready to play.' })),
      ...requests,
    ];
    if (picks.length) {
      return { reply: direct.length ? (requests.length ? 'Found it. These are in your library, and there are a few more you could ask for.' : 'Found it in your library.') : 'Not in your library yet, but you can ask for it.', picks, quick: ['Something funny', 'Something cosy'] };
    }
    return { reply: pickOf(['Hmm, I did not catch a mood or a title there. Try "funny but short", "something scary" or "like Silo".', 'I am not sure what you mean. Tell me a mood, a runtime or a title you like.'], salt), picks: [], quick: ['Something funny', 'Something cosy', 'Something short'] };
  }

  /** Seerr results you do not have yet (movies and shows), shown as Request picks. */
  private async requestable(term: string, limit: number, skip: Set<string>): Promise<Pick[]> {
    if (!term.trim() || !(await this.seerr())) return [];
    const found: SeerrResult[] = await this.backend.seerr.search(term).catch(() => []);
    return found
      .filter(r => r.state !== 'available' && !skip.has(r.title.toLowerCase()))
      .slice(0, limit)
      .map((r): Pick => ({ kind: 'request', result: r, why: r.state ? 'Already asked for. It is on the way.' : 'Not in your library yet. You can ask for it.' }));
  }
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const titleCase = (s: string): string => s.replace(/\b\w/g, c => c.toUpperCase());

/** Best library title for a name: exact, then prefix, then substring. */
export function findTitle(lib: readonly Title[], name: string): Title | undefined {
  return findTitles(lib, name, 1)[0];
}
export function findTitles(lib: readonly Title[], name: string, limit: number): Title[] {
  const n = norm(name);
  if (n.length < 2) return [];
  const score = (t: Title): number => { const x = norm(t.name); return x === n ? 3 : x.startsWith(n) ? 2 : x.includes(n) ? 1 : 0; };
  return lib.map(t => ({ t, s: score(t) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s || (b.t.rating ?? 0) - (a.t.rating ?? 0)).slice(0, limit).map(x => x.t);
}

function shared(t: Title, seed: Title): string {
  const g = t.genres.find(x => seed.genres.includes(x));
  return g ? `Also ${g.toLowerCase()}.` : '';
}
