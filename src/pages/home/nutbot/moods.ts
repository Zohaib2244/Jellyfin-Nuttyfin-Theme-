/**
 * Moods: how a wish ("something cosy") maps onto Jellyfin genres, certificates and runtime.
 * Shared by the NutBot tile's chips, the Explore mood navigation and the local NutBot brain, so they always agree.
 */
import type { Title } from '../../../api/types';
import type { IconName } from '../../../ui/icons';

export interface Mood {
  key: string;
  /** chip label */
  chip: string;
  icon: IconName;
  /** what the chip "says" to NutBot */
  ask: string;
  /** words in free text that mean this mood */
  re: RegExp;
  /** can this title be offered for the mood at all? */
  test(t: Title): boolean;
  /** higher = better fit among those that pass */
  score(t: Title): number;
  /** short reasons to show under a pick; rotated */
  why: readonly string[];
}

const lc = (s: string): string => s.toLowerCase();
export const has = (t: Title, ...genres: string[]): boolean => {
  const g = t.genres.map(lc);
  return genres.some(x => g.includes(lc(x)));
};
const KID_CERT = new Set(['G', 'PG', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TP', 'U']);
export const isKidFriendly = (t: Title): boolean => !!t.certification && KID_CERT.has(t.certification.toUpperCase());
const rating = (t: Title): number => t.rating ?? 6;
const SCARY = ['Horror', 'Thriller', 'War', 'Crime'];

export const MOODS: readonly Mood[] = [
  { key: 'cosy', chip: 'Cosy', icon: 'mug', ask: 'Something cosy', re: /\bcos(y|ie|ier)\b|\bcozy|\bwarm\b|comfort|snug|gentle|\bchill(ed)? ?out|\brelax/,
    test: t => !has(t, ...SCARY) && (has(t, 'Family', 'Animation', 'Romance') || (has(t, 'Comedy') && isKidFriendly(t))),
    score: t => (has(t, 'Family') ? 2 : 0) + (has(t, 'Comedy') ? 1 : 0) + (has(t, 'Animation') ? 1 : 0) + (rating(t) >= 7 ? 1 : 0),
    why: ['Warm and gentle', 'A proper blanket pick', 'Easy and kind', 'Cosy from start to finish'] },
  { key: 'funny', chip: 'Funny', icon: 'smile', ask: 'Something funny', re: /funn(y|ier)|laugh|comed|silly|hilarious|giggl|light.?hearted/,
    test: t => has(t, 'Comedy'), score: t => 3 + (rating(t) >= 7 ? 1 : 0) - (has(t, 'Drama') ? 1 : 0),
    why: ['Properly funny', 'Lots of laughs', 'Silly in the best way', 'Gets a laugh from everyone'] },
  { key: 'scary', chip: 'Scary', icon: 'ghost', ask: 'Something scary', re: /scar(y|ier|e me)|horror|creepy|frighten|terrif|jump.?scare/,
    test: t => has(t, 'Horror'), score: t => 3 + (has(t, 'Thriller') ? 1 : 0) + (has(t, 'Mystery') ? 0.5 : 0) - (has(t, 'Comedy') ? 2 : 0),
    why: ['Genuinely tense', 'Keep the lights on', 'Jumpy in a good way', 'Creepy and clever'] },
  { key: 'kids', chip: 'For the kids', icon: 'users', ask: 'Something we can all watch with the kids', re: /\bkids?\b|child|family|little ones|all of us|whole house|grandparents/,
    test: t => (isKidFriendly(t) && !has(t, 'Horror')) || has(t, 'Kids', 'Family'),
    score: t => (has(t, 'Family') ? 2 : 0) + (has(t, 'Animation') ? 1 : 0) + (isKidFriendly(t) ? 1 : 0),
    why: ['Fine for all ages', 'Everyone on the sofa will like it', 'Safe for little ones', 'Grown-ups enjoy it too'] },
  { key: 'action', chip: 'Action', icon: 'bolt', ask: 'Some action', re: /\baction|explosion|fights?\b|chases?\b|exciting|adrenaline|heist|big and loud/,
    test: t => has(t, 'Action', 'Action & Adventure'), score: t => 3 + (rating(t) >= 7 ? 1 : 0) - (has(t, 'Horror') ? 1 : 0),
    why: ['Big and loud', 'Non-stop action', 'Great on a big screen', 'Seatbelts on'] },
  { key: 'mind', chip: 'Mind-bending', icon: 'spiral', ask: 'Something mind-bending', re: /mind|twist|brain|clever|puzzl|confus|trippy|make me think/,
    test: t => (has(t, 'Science Fiction', 'Sci-Fi & Fantasy') && has(t, 'Mystery', 'Thriller', 'Drama')) || (has(t, 'Mystery') && has(t, 'Thriller')),
    score: t => 3 + (rating(t) >= 7.5 ? 1.5 : 0), why: ['Will mess with your head', 'Pay attention to this one', 'Twisty and clever', 'You will talk about it after'] },
  { key: 'feel', chip: 'Feel-good', icon: 'sunsm', ask: 'Something feel-good', re: /feel.?good|happy|uplift|cheer|pick me up|wholesome|bad day|sad day/,
    test: t => has(t, 'Comedy', 'Family', 'Animation', 'Romance', 'Music') && !has(t, 'Horror', 'Thriller', 'Crime', 'War') && rating(t) >= 6.5,
    score: t => rating(t) + (has(t, 'Family') ? 1 : 0), why: ['Leaves you smiling', 'A happy ending, promise', 'Pure good mood', 'Lifts any day'] },
  { key: 'short', chip: 'Something short', icon: 'timer', ask: 'Something short', re: /\bshort|\bquick|not (too )?long|before bed|bedtime|lunch.?break/,
    test: t => t.kind === 'movie' && t.runtimeMin > 0 && t.runtimeMin <= 95, score: t => (100 - t.runtimeMin) / 18 + rating(t) / 5,
    why: ['Short and sweet', 'Over before you know it', 'Fits in a gap', 'Nice and short'] },
  { key: 'space', chip: 'Space', icon: 'rocket', ask: 'Something set in space', re: /\bspace\b|planets?\b|astronaut|\bstars\b|galaxy|\baliens\b|sci.?fi|science fiction/,
    test: t => has(t, 'Science Fiction', 'Sci-Fi & Fantasy'), score: t => 2 + (rating(t) >= 7 ? 1.5 : 0),
    why: ['Out among the stars', 'Big sci-fi feelings', 'A long way from home'] },
  { key: 'true', chip: 'True story', icon: 'info', ask: 'A true story', re: /true story|real (life|story|events)|biopic|based on|historical|documentar/,
    test: t => has(t, 'History', 'Documentary', 'War'), score: t => 2 + (has(t, 'Documentary') ? 1 : 0), why: ['Based on real events', 'It really happened', 'A true story'] },
  { key: 'mystery', chip: 'Whodunnit', icon: 'eye', ask: 'A good whodunnit', re: /myster|whodunn?it|detective|murder/,
    test: t => has(t, 'Mystery', 'Crime'), score: t => 2 + (has(t, 'Mystery') ? 1 : 0) - (has(t, 'Horror') ? 1.5 : 0), why: ['A proper whodunnit', 'Guess along from the sofa', 'Clues everywhere'] },
  { key: 'romance', chip: 'Date night', icon: 'heart', ask: 'Something for date night', re: /roman|date night|love story/,
    test: t => has(t, 'Romance'), score: t => 2 + (rating(t) >= 7 ? 1 : 0), why: ['Good for two', 'Fun to watch together', 'A little bit romantic'] },
  { key: 'fantasy', chip: 'Fantasy', icon: 'spark', ask: 'Something with magic', re: /fantasy|magic|wizard|dragon/,
    test: t => has(t, 'Fantasy', 'Sci-Fi & Fantasy'), score: t => 2 + (rating(t) >= 7 ? 1 : 0), why: ['A little bit of magic', 'Another world entirely', 'Escape for a while'] },
];

export const MOOD_BY_KEY: ReadonlyMap<string, Mood> = new Map(MOODS.map(m => [m.key, m]));

/** Titles that fit `mood`, best first. Unwatched ones lead (you can watch them fresh), then by score and rating. */
export function moodPicks(titles: readonly Title[], mood: Mood, limit = 12): Title[] {
  return titles.filter(t => mood.test(t))
    .sort((a, b) => Number(a.played) - Number(b.played) || mood.score(b) - mood.score(a) || rating(b) - rating(a))
    .slice(0, limit);
}

/** A stable (per title) reason for a pick. */
export function whyFor(t: Title, mood?: Mood): string {
  let h = 0;
  for (const c of t.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  if (mood) return mood.why[h % mood.why.length] as string;
  if (rating(t) >= 8) return `Rated ${rating(t).toFixed(1)}, one of the best here`;
  const g = t.genres[0];
  return g ? `Matches your taste for ${g.toLowerCase()}` : 'Picked for you';
}
