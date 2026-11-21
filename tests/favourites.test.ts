import { describe, expect, it } from 'vitest';
import { favouriteView } from '../src/pages/favourites/model';
import { matchRoute } from '../src/router';
import { notFoundRoute, routes } from '../src/routes';

describe('favouriteView', () => {
  it('shows the asked-for tab when both kinds exist', () => {
    expect(favouriteView(3, 2, 'shows').tab).toBe('shows');
    expect(favouriteView(3, 2, 'films').lede).toContain('3 films');
    expect(favouriteView(3, 1, 'shows').lede).toContain('1 show<');
  });
  it('shows whichever kind exists when there is only one', () => {
    expect(favouriteView(0, 4, 'films').tab).toBe('shows');
    expect(favouriteView(5, 0, 'shows').tab).toBe('films');
  });
  it('is calm when nothing is hearted yet', () => {
    expect(favouriteView(0, 0, 'films').lede).not.toContain('<b>');
  });
});

describe('Favourites and unknown routes', () => {
  it('is a real route with its own rail item', () => {
    expect(matchRoute(routes, '#/favourites')?.route.nav).toBe('favourites');
    expect(matchRoute(routes, '#/favourites/shows')?.params).toEqual({ tab: 'shows' });
    expect(routes.some(r => r.nav === ('saved' as never))).toBe(false);
  });
  it('an unknown tab is an unknown page (the router shows the friendly 404, not Home)', () => {
    expect(matchRoute(routes, '#/favourites/nope')).toBeNull();
    expect(matchRoute(routes, '#/home/bogus')).toBeNull();
    expect(matchRoute(routes, '#/requests/bogus')).toBeNull();
    expect(matchRoute(routes, '#/nope/zzz')).toBeNull();
    expect(notFoundRoute.name).toBe('notfound');
  });
  it('known tabs still match', () => {
    expect(matchRoute(routes, '#/home/explore')?.name).toBe('home');
    expect(matchRoute(routes, '#/home/requests')?.name).toBe('home'); // old link, forwarded by the page
    expect(matchRoute(routes, '#/requests/discover')?.name).toBe('requests');
  });
});
