/** Backend selection. Real Jellyfin by default; demo with ?demo=1 (remembered) or localStorage nutfin.demo. */
import { store } from '../lib/storage';
import type { Backend } from './backend';

export type { Backend, SeerrApi, QuickConnectApi } from './backend';
export { SignInError } from './backend';
export type { SignInFailure, BackendMode } from './backend';
export { ApiError } from './http';
export { imageUrl, userImageUrl, personImageUrl, tmdbImage } from './images';
export * from './types';
export * from './desk-types'; // phase5-7

/** ?demo=1 turns demo on (and remembers it); ?demo=0 turns it off. Otherwise the remembered value decides. */
export function isDemo(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  const q = new URLSearchParams(search).get('demo');
  if (q === '1') { store.set('demo', true); return true; }
  if (q === '0') { store.remove('demo'); return false; }
  const v = store.get<unknown>('demo', false);
  return v === true || v === 1 || v === '1';
}

/** The demo module (and its catalog JSON) is only downloaded when demo mode is on. */
export async function createBackend(): Promise<Backend> {
  if (isDemo()) {
    const { DemoBackend } = await import('./demo');
    return new DemoBackend();
  }
  const { JellyfinBackend } = await import('./jellyfin');
  return new JellyfinBackend();
}
