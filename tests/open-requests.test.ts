import { describe, expect, it } from 'vitest';
import type { DeskRequest } from '../src/api/desk-types';
import { countOpenRequests, isOpenRequest } from '../src/state/openRequests';

const req = (o: Partial<DeskRequest>): DeskRequest => ({
  id: 1, tmdbId: 1, mediaType: 'movie', title: 'T', state: 'approved', requestedBy: 'me', requestedById: 7, createdAt: '2026-11-01T00:00:00Z',
  requestStatus: 2, mediaStatus: 3, downloads: [], ...o,
});

describe('open requests (the one definition)', () => {
  it('requested, approved/waiting, downloading and partly ready are open', () => {
    expect(isOpenRequest(req({ requestStatus: 1, mediaStatus: 2, state: 'requested' }))).toBe(true);
    expect(isOpenRequest(req({}))).toBe(true);
    expect(isOpenRequest(req({ downloads: [{ percent: 10 }], state: 'downloading' }))).toBe(true);
    expect(isOpenRequest(req({ mediaStatus: 4 }))).toBe(true);
    expect(isOpenRequest(req({ requestStatus: 4 }))).toBe(true); // could not be sent: still waiting for the owner
  });
  it('available, declined and removed are not open', () => {
    expect(isOpenRequest(req({ requestStatus: 5, mediaStatus: 5, state: 'available' }))).toBe(false);
    expect(isOpenRequest(req({ requestStatus: 3, mediaStatus: 1, state: 'declined' }))).toBe(false);
    expect(isOpenRequest(req({ requestStatus: 5, mediaStatus: 7 }))).toBe(false); // added, then removed from the library
    expect(isOpenRequest(req({ requestStatus: 2, mediaStatus: 7 }))).toBe(false); // approved, media deleted, nothing downloading
  });
  it('counts only the signed-in person when the list mixes people (an admin sees everyone, the badge is theirs)', () => {
    const list = [req({ id: 1, requestedById: 7 }), req({ id: 2, requestedById: 9 }), req({ id: 3, requestedById: 7, requestStatus: 3, mediaStatus: 1 }), req({ id: 4, requestedById: 7, requestStatus: 1 })];
    expect(countOpenRequests(list, 7)).toBe(2);
    expect(countOpenRequests(list, 9)).toBe(1);
    expect(countOpenRequests(list)).toBe(3); // a list that is already "mine"
  });
});
