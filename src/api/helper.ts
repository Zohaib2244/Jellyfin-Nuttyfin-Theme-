/**
 * Client for the optional Nuttyfin helper service (helper/, served at /nutfin-api). Every method degrades silently:
 * when the service is not deployed `available()` is false, `calendar()` is [] and `chat()` rejects so the caller can
 * use its local brain. Sends the person's own Jellyfin token; the helper checks it with Jellyfin before doing anything.
 * Feature detection looks for JSON `{ ok: true }`: a static host answers unknown paths with index.html, which does not count.
 */
import { currentAuthHeader } from './auth';
import type {
  CalendarEntry, DeleteMode, DeletePlan, DeleteResult, HelperApi, HelperHealth, NutbotReply, NutbotTurn,
} from './desk-types';
import { createHttp, type Http } from './http';

export const HELPER_BASE = '/nutfin-api';
const RECHECK_MS = 60_000;

export class HelperClient implements HelperApi {
  private readonly http: Http;
  private probed: { at: number; value: Promise<HelperHealth | null> } | null = null;

  constructor(getToken: () => string | null) {
    this.http = createHttp({ base: HELPER_BASE, headers: () => ({ Authorization: currentAuthHeader(getToken() ?? undefined) }) });
  }

  /** Forget the cached health (after sign-out / sign-in). */
  reset(): void { this.probed = null; }

  health(): Promise<HelperHealth | null> {
    const now = Date.now();
    if (!this.probed || now - this.probed.at > RECHECK_MS) {
      const value = this.http<HelperHealth>('/health', { timeoutMs: 4000 })
        .then(h => (h && h.ok === true ? h : null))
        .catch(() => null);
      this.probed = { at: now, value };
    }
    return this.probed.value;
  }

  async available(): Promise<boolean> { return (await this.health()) !== null; }

  async calendar(days = 7): Promise<CalendarEntry[]> {
    if (!(await this.available())) return [];
    try {
      const r = await this.http<{ entries?: CalendarEntry[] }>('/calendar', { query: { days }, timeoutMs: 15_000 });
      return Array.isArray(r?.entries) ? r.entries : [];
    } catch { return []; }
  }

  async chat(messages: NutbotTurn[], context: Record<string, unknown>, signal?: AbortSignal): Promise<NutbotReply> {
    const r = await this.http<NutbotReply>('/nutbot/chat', { method: 'POST', body: { messages, context }, signal, timeoutMs: 40_000 });
    if (!r || typeof r.reply !== 'string') throw new Error('NutBot helper gave no reply');
    return { reply: r.reply, picks: Array.isArray(r.picks) ? r.picks : [] };
  }

  deletePlan(jellyfinId: string): Promise<DeletePlan> {
    return this.http<DeletePlan>('/delete/plan', { method: 'POST', body: { jellyfinId }, timeoutMs: 60_000 });
  }

  deleteExecute(input: { jellyfinId: string; mode: DeleteMode; confirm: string; dryRun?: boolean }): Promise<DeleteResult> {
    return this.http<DeleteResult>('/delete/execute', { method: 'POST', body: input, timeoutMs: 120_000 });
  }
}
