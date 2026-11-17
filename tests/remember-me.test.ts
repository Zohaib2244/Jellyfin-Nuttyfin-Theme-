import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session, type StoredSession } from '../src/api/auth';
import { DemoBackend } from '../src/api/demo';
import { store, tabStore } from '../src/lib/storage';

const saved: StoredSession = { token: 'test-token', userId: 'u1', userName: 'Sam', isAdmin: false };
function clear() {
  for (const storage of [store, tabStore]) for (const key of ['session', 'rememberMe', 'demoUser']) storage.remove(key);
}
beforeEach(clear);
afterEach(() => { vi.unstubAllGlobals(); clear(); });

describe('Remember me', () => {
  it('preserves existing persistent sign-ins and defaults to checked', () => {
    store.set('session', saved);
    expect(session.remembered()).toBe(true);
    expect(session.load()).toEqual(saved);
  });

  it('keeps a remembered sign-in in persistent storage only', () => {
    tabStore.set('session', saved);
    session.setRemembered(true); session.save(saved);
    expect(store.get('session', null)).toEqual(saved);
    expect(tabStore.has('session')).toBe(false);
    expect(session.load()).toEqual(saved);
  });

  it('keeps an unchecked sign-in in browser-session storage and removes old persistent credentials', () => {
    store.set('session', saved);
    session.setRemembered(false); session.save(saved);
    expect(store.has('session')).toBe(false);
    expect(tabStore.get('session', null)).toEqual(saved);
    expect(session.load()).toEqual(saved);
    // A new browser session has no sessionStorage from this sign-in.
    tabStore.remove('session');
    expect(session.load()).toBeNull();
  });

  it('clears both storage locations on sign-out', () => {
    store.set('session', saved); tabStore.set('session', saved);
    session.clear();
    expect(store.has('session')).toBe(false);
    expect(tabStore.has('session')).toBe(false);
    expect(session.load()).toBeNull();
  });

  it('handles blocked browser-session storage without persisting the token', () => {
    vi.stubGlobal('sessionStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } });
    session.setRemembered(false); session.save(saved);
    expect(session.load()).toEqual(saved);
    expect(store.has('session')).toBe(false);
  });

  it('applies the same choice in demo mode', async () => {
    session.setRemembered(false);
    const backend = new DemoBackend(); await backend.signIn('Sam');
    expect(store.has('demoUser')).toBe(false);
    expect(new DemoBackend().currentUser()?.name).toBe('Sam');
    tabStore.remove('demoUser');
    expect(new DemoBackend().currentUser()).toBeNull();
  });
});
