/**
 * NutBot from anywhere: the top-bar button opens the same chat Home used to host in a tile.
 * One chat per signed-in person, kept for the whole visit (it is not tied to a page).
 */
import type { Backend, User } from '../../../api';
import { HomeData } from '../data';
import type { HomeCtx } from '../tile';
import { createChat, type ChatHandle } from './chat';
import { LocalBrain } from './local';
import { RemoteBrain } from './remote';

let current: { userId: string; chat: ChatHandle } | null = null;

export function openNutBot(backend: Backend, user: User | null, trigger: HTMLElement | null, ask?: string): void {
  const uid = user?.id ?? 'anon';
  if (current && current.userId !== uid) { current.chat.destroy(); current = null; }
  if (!current) {
    const ac = new AbortController();
    // Only backend, data and user are used by the chat; the rest of HomeCtx is page plumbing it never touches.
    const ctx = {
      backend, user, data: new HomeData(backend), signal: ac.signal,
      onDispose: () => {}, now: () => new Date(), goTab: () => {},
    } as unknown as HomeCtx;
    current = { userId: uid, chat: createChat(ctx, new RemoteBrain(backend, new LocalBrain(backend))) };
  }
  current.chat.open({ trigger, ask });
}

/** Signed out: drop the chat so the next person starts fresh. */
export function closeNutBot(): void { current?.chat.destroy(); current = null; }
