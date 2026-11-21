/** What the Favourites page shows: which kind, and the one line under the tabs. Pure (unit-tested). */
export type FavTab = 'films' | 'shows';

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * With both kinds the asked-for tab wins (default Films). With only one kind that kind is shown whatever the link said,
 * so nobody lands on an empty tab while there is something to see.
 */
export function favouriteView(films: number, shows: number, asked: FavTab): { tab: FavTab; lede: string } {
  const tab: FavTab = films && shows ? asked : shows ? 'shows' : 'films';
  if (!films && !shows) return { tab, lede: 'The films and shows you have hearted.' };
  if (films && shows) return { tab, lede: `<b>${plural(tab === 'films' ? films : shows, tab === 'films' ? 'film' : 'show')}</b> you have hearted` };
  return { tab, lede: `<b>${plural(films || shows, films ? 'film' : 'show')}</b> you have hearted` };
}
