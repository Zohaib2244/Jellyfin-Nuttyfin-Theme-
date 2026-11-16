import { describe, expect, it } from 'vitest';
import { matchRoute, splitHash } from '../src/router';
import { routes } from '../src/routes';

const m = (hash: string) => matchRoute(routes, hash);

describe('splitHash', () => {
  it('handles empty, bare and query hashes', () => {
    expect(splitHash('').path).toBe('/');
    expect(splitHash('#').path).toBe('/');
    expect(splitHash('#/movies/').path).toBe('/movies');
    const s = splitHash('#/movies?genre=Action&sort=year');
    expect(s.path).toBe('/movies');
    expect(s.query.get('genre')).toBe('Action');
  });
});

describe('matchRoute', () => {
  it('matches the fixed routes', () => {
    expect(m('')?.name).toBe('home');
    expect(m('#/')?.name).toBe('home');
    expect(m('#/movies')?.name).toBe('movies');
    expect(m('#/shows')?.name).toBe('shows');
    expect(m('#/requests')?.name).toBe('requests');
    expect(m('#/login')?.name).toBe('login');
  });
  it('captures params and decodes them', () => {
    expect(m('#/title/abc123')?.params).toEqual({ id: 'abc123' });
    expect(m('#/watch/a%20b')?.params).toEqual({ id: 'a b' });
  });
  it('supports the optional home tab', () => {
    expect(m('#/home')?.params).toEqual({});
    expect(m('#/home/explore')?.params).toEqual({ tab: 'explore' });
  });
  it('exposes the query string and rail highlight', () => {
    const r = m('#/movies?genre=Action');
    expect(r?.query.get('genre')).toBe('Action');
    expect(r?.route.nav).toBe('movies');
    expect(m('#/title/x')?.route.nav).toBeUndefined();
  });
  it('knows which routes hide the shell and which skip the sign-in guard', () => {
    expect(m('#/watch/x')?.route.chrome).toBe('none');
    expect(m('#/login')?.route.chrome).toBe('none');
    expect(m('#/login')?.route.auth).toBe(false);
    expect(m('#/movies')?.route.auth).toBeUndefined();
  });
  it('rejects unknown paths, missing params and extra segments', () => {
    expect(m('#/nope')).toBeNull();
    expect(m('#/title')).toBeNull();
    expect(m('#/title/a/b')).toBeNull();
    expect(m('#/movies/extra')).toBeNull();
  });
});
