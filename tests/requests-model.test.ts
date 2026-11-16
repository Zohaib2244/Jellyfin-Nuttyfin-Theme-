import { describe, expect, it } from 'vitest';
import type { SeerrCapabilities, SeerrDetail } from '../src/api/desk-types';
import { permsFrom } from '../src/api/seerr-desk';
import type { SeerrRequest } from '../src/api/types';
import {
  askLabel, blockedReason, canCancel, canDecide, cannotRequest, flowSteps, isOpen, quotaLeft, quotaSummary, quotaText, requestableSeasons, seasonsText, seasonsToAsk,
  statusLine,
} from '../src/pages/requests/model';

const caps = (mask: number, over: Partial<SeerrCapabilities> = {}): SeerrCapabilities => ({
  userId: 7, perms: permsFrom(mask), fourK: { movie: false, tv: false }, profiles: {}, specials: false, partialRequests: true, ...over,
});
const req = (o: Partial<SeerrRequest> = {}): SeerrRequest => ({
  id: 1, tmdbId: 1, mediaType: 'movie', title: 'X', state: 'requested', requestedBy: 'Mia', requestedById: 7, createdAt: '2026-11-01T00:00:00Z', ...o,
});
const show = (states: Array<SeerrDetail['seasons'][number]['state']>, o: Partial<SeerrDetail> = {}): SeerrDetail => ({
  tmdbId: 5, mediaType: 'tv', title: 'S', genres: [], partial: false,
  seasons: states.map((state, i) => ({ number: i + 1, name: `Season ${i + 1}`, episodes: 8, state })), ...o,
});

describe('quota wording', () => {
  it('says how many are left and for how long', () => {
    expect(quotaText({ limit: 5, used: 3, remaining: 2, days: 7 }, 'movie')).toBe('2 film requests left this week');
    expect(quotaText({ limit: 2, used: 1, remaining: 1, days: 7 }, 'tv')).toBe('1 show request left this week');
    expect(quotaText({ limit: 10, used: 4, remaining: 6, days: 30 }, 'movie')).toBe('6 film requests left this month');
    expect(quotaText({ limit: 3, used: 3, remaining: 0, days: 1 }, 'tv')).toBe('No show requests left today');
    expect(quotaText({ limit: 4, used: 1, remaining: 3, days: 14 }, 'movie')).toBe('3 film requests left in any 14 days');
  });
  it('unlimited and unknown', () => {
    expect(quotaText({ limit: null, used: 9, remaining: null, days: null }, 'movie')).toBe('No limit on film requests');
    expect(quotaText(null, 'movie')).toBeNull();
    expect(quotaLeft({ movie: { limit: null, used: 0, remaining: null, days: null }, tv: { limit: 2, used: 2, remaining: 0, days: 7 } }, 'movie')).toBeNull();
    expect(quotaLeft({ movie: { limit: null, used: 0, remaining: null, days: null }, tv: { limit: 2, used: 2, remaining: 0, days: 7 } }, 'tv')).toBe(0);
    expect(quotaSummary(null)).toBe('');
    expect(quotaSummary({ movie: { limit: 5, used: 2, remaining: 3, days: 7 }, tv: { limit: null, used: 0, remaining: null, days: null } })).toBe('3 film requests left this week · No limit on show requests');
  });
});

describe('status flow', () => {
  it('walks Asked, Approved, Downloading with percent, Ready', () => {
    expect(flowSteps({ state: 'requested' })?.map(s => s.status)).toEqual(['now', 'todo', 'todo', 'todo']);
    expect(flowSteps({ state: 'approved' })?.map(s => s.status)).toEqual(['done', 'now', 'todo', 'todo']);
    const dl = flowSteps({ state: 'downloading', progress: 64 });
    expect(dl?.map(s => s.label)).toEqual(['Asked', 'Approved', 'Downloading 64%', 'Ready to watch']);
    expect(dl?.map(s => s.status)).toEqual(['done', 'done', 'now', 'todo']);
    expect(flowSteps({ state: 'downloading' })?.[2]?.label).toBe('Downloading');
    expect(flowSteps({ state: 'available' })?.map(s => s.status)).toEqual(['done', 'done', 'done', 'done']);
    expect(flowSteps({ state: 'declined' })).toBeNull();
  });
  it('plain sentences', () => {
    expect(statusLine({ state: 'requested', mediaType: 'movie' })).toMatch(/Waiting for the server owner/);
    expect(statusLine({ state: 'downloading', progress: 41, mediaType: 'tv' })).toBe('Downloading, 41% done.');
    expect(statusLine({ state: 'available', mediaType: 'tv', partial: true })).toMatch(/Some of it is ready/);
    expect(statusLine({ state: 'approved', failed: true, mediaType: 'movie' })).toMatch(/could not be sent/);
    expect(statusLine({ state: 'declined', mediaType: 'movie' })).toMatch(/said no/);
  });
  it('open requests are the unfinished, undeclined ones', () => {
    expect(['requested', 'approved', 'downloading', 'available', 'declined'].map(s => isOpen({ state: s as SeerrRequest['state'] }))).toEqual([true, true, true, false, false]);
  });
});

describe('seasons text', () => {
  it('reads naturally', () => {
    expect(seasonsText(undefined)).toBe('');
    expect(seasonsText([2])).toBe('Season 2');
    expect(seasonsText([2, 1])).toBe('Seasons 1 and 2');
    expect(seasonsText([4, 1, 2])).toBe('Seasons 1, 2 and 4');
    expect(seasonsText([0])).toBe('Specials');
  });
});

describe('who may do what', () => {
  const REQUEST = 32;
  it('members cancel only their own waiting request', () => {
    const me = caps(REQUEST);
    expect(canCancel(req(), me)).toBe(true);
    expect(canCancel(req({ state: 'approved' }), me)).toBe(false);
    expect(canCancel(req({ requestedById: 8 }), me)).toBe(false);
    expect(canDecide(req(), me)).toBe(false);
  });
  it('managers cancel and decide anything waiting', () => {
    const admin = caps(2);
    expect(canCancel(req({ requestedById: 8, state: 'approved' }), admin)).toBe(true);
    expect(canDecide(req({ requestedById: 8 }), admin)).toBe(true);
    expect(canDecide(req({ state: 'approved' }), admin)).toBe(false);
    expect(canCancel(req({ state: 'available' }), admin)).toBe(false); // finished: nothing to cancel
    expect(canCancel(req(), null)).toBe(false);
  });
  it('permission text', () => {
    expect(cannotRequest(caps(REQUEST), 'movie')).toBeNull();
    expect(cannotRequest(caps(0), 'tv')).toMatch(/not allowed to ask for shows/);
    expect(cannotRequest(caps(262_144), 'tv')).toMatch(/shows/); // film-only permission
    expect(cannotRequest(null, 'movie')).toMatch(/not available/);
  });
});

describe('seasons you can still ask for', () => {
  it('skips seasons that are in the library or already asked for', () => {
    const d = show(['available', 'approved', undefined, undefined]);
    expect(requestableSeasons(d, false).map(s => s.number)).toEqual([3, 4]);
    expect(seasonsToAsk(d, false, 'all', new Set())).toEqual([3, 4]);
    expect(seasonsToAsk(d, false, 'pick', new Set([4]))).toEqual([4]);
    expect(seasonsToAsk(d, false, 'pick', new Set())).toEqual([]);
  });
  it('a clean show is asked for whole', () => {
    expect(seasonsToAsk(show([undefined, undefined]), false, 'all', new Set())).toBe('all');
  });
  it('specials only when allowed', () => {
    const d = { seasons: [{ number: 0, name: 'Specials', episodes: 3 }, { number: 1, name: 'Season 1', episodes: 8 }] };
    expect(requestableSeasons(d, false).map(s => s.number)).toEqual([1]);
    expect(requestableSeasons(d, true).map(s => s.number)).toEqual([0, 1]);
  });
  it('button words', () => {
    expect(askLabel('movie', 'all')).toBe('Ask for this film');
    expect(askLabel('tv', 'all')).toBe('Ask for the whole show');
    expect(askLabel('tv', [])).toBe('Pick a season');
    expect(askLabel('tv', [2])).toBe('Ask for 1 season');
    expect(askLabel('tv', [2, 3])).toBe('Ask for 2 seasons');
  });
});

describe('blocked reasons', () => {
  const film = (o: Partial<SeerrDetail> = {}): SeerrDetail => ({ tmdbId: 1, mediaType: 'movie', title: 'F', genres: [], partial: false, seasons: [], ...o });
  it('free to ask', () => { expect(blockedReason(film(), caps(32), 3)).toBeNull(); expect(blockedReason(film(), caps(32), null)).toBeNull(); });
  it('already there or already asked', () => {
    expect(blockedReason(film({ state: 'available', jellyfinId: 'a' }), caps(32), null)?.text).toMatch(/already in the library/);
    expect(blockedReason(film({ state: 'requested' }), caps(32), null)?.text).toMatch(/already asked/);
  });
  it('no permission or no quota', () => {
    expect(blockedReason(film(), caps(0), null)).toMatchObject({ tone: 'bad' });
    expect(blockedReason(film(), caps(32), 0)).toMatchObject({ tone: 'bad', text: expect.stringMatching(/used up/) });
  });
  it('show with nothing left to ask', () => {
    expect(blockedReason(show(['available', 'approved']), caps(32), null)?.text).toMatch(/Every season/);
    expect(blockedReason(show(['available', undefined]), caps(32), null)).toBeNull();
  });
});
