import { describe, expect, it } from 'vitest';
import { imageUrl, personImageUrl, tmdbImage, userImageUrl } from '../src/api/images';

describe('imageUrl', () => {
  it('builds /jf/Items/{id}/Images/{type} with width, quality and tag', () => {
    expect(imageUrl('abc', 'Primary', { maxWidth: 300, tag: 't1' })).toBe('/jf/Items/abc/Images/Primary?maxWidth=300&quality=90&tag=t1');
  });
  it('supports height, quality and a backdrop index', () => {
    expect(imageUrl('abc', 'Backdrop', { maxWidth: 1280, maxHeight: 720, quality: 70, index: 1 })).toBe('/jf/Items/abc/Images/Backdrop/1?maxWidth=1280&maxHeight=720&quality=70');
  });
  it('works with no options and rounds sizes', () => {
    expect(imageUrl('x', 'Logo')).toBe('/jf/Items/x/Images/Logo?quality=90');
    expect(imageUrl('x', 'Thumb', { maxWidth: 299.6 })).toBe('/jf/Items/x/Images/Thumb?maxWidth=300&quality=90');
  });
  it('encodes ids and tags', () => {
    expect(imageUrl('a/b', 'Primary', { tag: 'a b' })).toBe('/jf/Items/a%2Fb/Images/Primary?quality=90&tag=a%20b');
  });
  it('builds user, person and TMDB urls', () => {
    expect(userImageUrl('u1', 'tg')).toBe('/jf/Users/u1/Images/Primary?maxWidth=96&quality=90&tag=tg');
    expect(personImageUrl('p1', 'tg')).toBe('/jf/Items/p1/Images/Primary?maxWidth=160&quality=90&tag=tg');
    expect(tmdbImage('/abc.jpg')).toBe('https://image.tmdb.org/t/p/w342/abc.jpg');
    expect(tmdbImage(undefined)).toBeUndefined();
  });
});
