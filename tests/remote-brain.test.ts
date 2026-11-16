import { describe, expect, it, vi } from 'vitest';
import type { Backend } from '../src/api';
import { ApiError } from '../src/api';
import type { HelperApi, NutbotReply } from '../src/api/desk-types';
import type { NutAnswer, NutBrain } from '../src/pages/home/nutbot/brain';
import { RemoteBrain } from '../src/pages/home/nutbot/remote';

const title = (id: string, name: string) => ({ kind: 'movie', id, name, imageTags: {}, genres: [] }) as never;
const localAnswer: NutAnswer = { reply: 'local answer', picks: [] };

function setup(over: Partial<HelperApi> = {}, items: unknown[] = []) {
  const local: NutBrain & { reset: () => void } = { ask: vi.fn(async () => localAnswer), reset: vi.fn() };
  const helper: HelperApi = {
    available: async () => true, health: async () => null, calendar: async () => [], deletePlan: async () => { throw new Error('x'); }, deleteExecute: async () => { throw new Error('x'); },
    chat: vi.fn(async (): Promise<NutbotReply> => ({ reply: 'remote answer', picks: [] })), ...over,
  };
  const detail = vi.fn(async (_t: string, id: number) => (id === 5 ? { tmdbId: 5, mediaType: 'movie', title: 'Dune', year: 2021, partial: false, seasons: [], genres: [] } : null));
  const backend = { helper, items: vi.fn(async () => ({ items, total: 0, start: 0 })), seerr: { detail } } as unknown as Backend;
  let now = 1000;
  const brain = new RemoteBrain(backend, local, () => now);
  return { brain, local, helper, tick: (ms: number) => { now += ms; } };
}

describe('RemoteBrain', () => {
  it('uses the helper and turns picks into real library titles and Seerr results', async () => {
    const s = setup({
      chat: vi.fn(async () => ({ reply: 'Try these', picks: [
        { kind: 'library' as const, id: 'a', title: 'Silo', why: 'part-way' }, { kind: 'library' as const, id: 'gone', title: 'Gone', why: 'x' },
        { kind: 'request' as const, tmdbId: 5, mediaType: 'movie' as const, title: 'Dune', why: 'epic' }, { kind: 'request' as const, tmdbId: 6, mediaType: 'tv' as const, title: 'Nope', why: 'x' },
      ] })),
    }, [title('a', 'Silo')]);
    const a = await s.brain.ask('space');
    expect(a.reply).toBe('Try these');
    expect(a.picks.map(p => (p.kind === 'library' ? p.title.name : p.result.title))).toEqual(['Silo', 'Dune']); // the unknown id and the unverifiable show are dropped
    expect(s.local.ask).not.toHaveBeenCalled();
  });

  it('sends the conversation so far, and forgets it on reset', async () => {
    const s = setup();
    await s.brain.ask('first');
    await s.brain.ask('second');
    const calls = (s.helper.chat as ReturnType<typeof vi.fn>).mock.calls as Array<[Array<{ role: string; text: string }>]>;
    expect(calls[1]?.[0].map(m => `${m.role}:${m.text}`)).toEqual(['user:first', 'assistant:remote answer', 'user:second']);
    s.brain.reset();
    await s.brain.ask('fresh');
    expect(calls[2]?.[0]).toHaveLength(1);
    expect(s.local.reset).toHaveBeenCalled();
  });

  it('no helper: answers locally without calling it', async () => {
    const s = setup({ available: async () => false });
    expect((await s.brain.ask('hi')).reply).toBe('local answer');
    expect(s.helper.chat).not.toHaveBeenCalled();
  });

  it('helper failure: this turn is answered locally and the helper is left alone for a while', async () => {
    const s = setup({ chat: vi.fn(async () => { throw new ApiError(503, 'server', 'down'); }) });
    expect((await s.brain.ask('one')).reply).toBe('local answer');
    expect((await s.brain.ask('two')).reply).toBe('local answer');
    expect(s.helper.chat).toHaveBeenCalledTimes(1); // backed off
    s.tick(121_000);
    await s.brain.ask('three');
    expect(s.helper.chat).toHaveBeenCalledTimes(2);
  });

  it('rate limited (429): local answer, but the helper is tried again right away next time', async () => {
    const s = setup({ chat: vi.fn(async () => { throw new ApiError(429, 'client', 'slow down'); }) });
    await s.brain.ask('a');
    await s.brain.ask('b');
    expect(s.helper.chat).toHaveBeenCalledTimes(2);
  });
});
