/** One NutBot chat per Home visit, shared by every tile that can open it. */
import type { HomeCtx } from '../tile';
import { LocalBrain } from './local';
import { createChat, type ChatHandle } from './chat';

const sessions = new WeakMap<object, { chat: ChatHandle; listeners: Set<() => void> }>();

/** The chat for this visit (created on first use, removed when the page is left). */
export function chatFor(ctx: HomeCtx): { chat: ChatHandle; onChange(fn: () => void): void } {
  let s = sessions.get(ctx.data);
  if (!s) {
    const listeners = new Set<() => void>();
    // The brain is the only thing that changes when the helper service's LLM arrives.
    const chat = createChat(ctx, new LocalBrain(ctx.backend), () => listeners.forEach(fn => fn()));
    s = { chat, listeners };
    sessions.set(ctx.data, s);
    ctx.onDispose(() => { chat.destroy(); sessions.delete(ctx.data); });
  }
  const live = s;
  return { chat: live.chat, onChange: fn => { live.listeners.add(fn); } };
}
