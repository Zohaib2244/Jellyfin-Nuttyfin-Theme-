/** Reads the model's answer defensively: it should be one JSON object, but we accept fenced or chatty output, and we drop anything that does not check out. */
import { sanitize } from './prompt.ts';

export interface LibraryPick { kind: 'library'; id: string; title: string; why: string }
export interface RequestCandidate { kind: 'request'; title: string; year?: number; mediaType: 'movie' | 'tv'; why: string }
export interface Parsed { reply: string; library: LibraryPick[]; requests: RequestCandidate[] }

const MAX_PICKS = 4;

function findObject(text: string): unknown {
  const t = text.trim();
  const attempts = [t, t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')];
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) attempts.push(t.slice(a, b + 1));
  for (const s of attempts) { try { const v = JSON.parse(s); if (v && typeof v === 'object') return v; } catch { /* try the next shape */ } }
  return null;
}

/** `titles` maps a library id to its title (only ids from the digest are allowed). */
export function parseModelReply(text: string, titles: ReadonlyMap<string, string>): Parsed {
  const o = findObject(text) as { reply?: unknown; picks?: unknown } | null;
  if (!o || typeof o.reply !== 'string') {
    // Not the JSON we asked for: keep the words (without picks) so the person still gets an answer.
    return { reply: sanitize(text, 600), library: [], requests: [] };
  }
  const library: LibraryPick[] = [];
  const requests: RequestCandidate[] = [];
  const seen = new Set<string>();
  for (const p of Array.isArray(o.picks) ? o.picks : []) {
    if (library.length + requests.length >= MAX_PICKS || !p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const why = sanitize(r['why'], 120);
    if (r['kind'] === 'library' && typeof r['id'] === 'string' && titles.has(r['id']) && !seen.has(r['id'])) {
      seen.add(r['id']);
      library.push({ kind: 'library', id: r['id'], title: titles.get(r['id']) as string, why });
    } else if (r['kind'] === 'request' && typeof r['title'] === 'string' && r['title'].trim() && (r['mediaType'] === 'movie' || r['mediaType'] === 'tv')) {
      const year = typeof r['year'] === 'number' && r['year'] > 1880 && r['year'] < 2100 ? Math.round(r['year']) : undefined;
      requests.push({ kind: 'request', title: sanitize(r['title'], 100), year, mediaType: r['mediaType'], why });
    }
  }
  return { reply: sanitize(o.reply, 600), library, requests };
}
