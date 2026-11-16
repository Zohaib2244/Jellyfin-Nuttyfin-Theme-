import { describe, expect, it } from 'vitest';
import { ApiError, buildQuery, kindFromStatus } from '../src/api/http';
import { toSignInError } from '../src/api/jellyfin';
import { mediaState, requestState } from '../src/api/seerr';
import { isDemo } from '../src/api';

describe('buildQuery', () => {
  it('joins arrays with commas and skips empty values', () => {
    expect(buildQuery({ userId: 'u1', includeItemTypes: ['Movie', 'Series'], limit: 10, a: undefined, b: null, c: [], d: false }))
      .toBe('userId=u1&includeItemTypes=Movie,Series&limit=10&d=false');
  });
  it('encodes values', () => {
    expect(buildQuery({ searchTerm: 'spider man & co' })).toBe('searchTerm=spider%20man%20%26%20co');
  });
});

describe('error mapping', () => {
  it('classifies statuses', () => {
    expect([401, 403, 404, 502, 500, 400].map(kindFromStatus)).toEqual(['unauthorized', 'forbidden', 'not-found', 'server', 'server', 'client']);
  });
  it('turns sign-in failures into reasons the login page can explain', () => {
    expect(toSignInError(new ApiError(401, 'unauthorized', 'x')).reason).toBe('bad-credentials');
    expect(toSignInError(new ApiError(0, 'network', 'x')).reason).toBe('unreachable');
    expect(toSignInError(new ApiError(502, 'server', 'x')).reason).toBe('unreachable');
    expect(toSignInError(new ApiError(500, 'server', 'x')).reason).toBe('server-error');
    expect(toSignInError(new Error('boom')).reason).toBe('unknown');
  });
});

describe('seerr status mapping', () => {
  it('maps media and request status', () => {
    expect([2, 3, 4, 5, 1, undefined].map(mediaState)).toEqual(['requested', 'downloading', 'available', 'available', undefined, undefined]);
    expect(requestState(1)).toBe('requested');
    expect(requestState(2)).toBe('approved');
    expect(requestState(2, 3)).toBe('downloading');
    expect(requestState(2, 5)).toBe('available');
    expect(requestState(3, 5)).toBe('declined');
  });
});

describe('demo switch', () => {
  it('?demo=1 turns it on, ?demo=0 off', () => {
    expect(isDemo('?demo=1')).toBe(true);
    expect(isDemo('?demo=0')).toBe(false);
    expect(isDemo('')).toBe(false);
  });
});
