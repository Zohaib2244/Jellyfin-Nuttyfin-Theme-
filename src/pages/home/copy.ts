/** Time-of-day greeting and NutBot's one-liners. Pure: pass the clock and the facts in. */

export type Slot = 'early' | 'breakfast' | 'morning' | 'weekend' | 'lunch' | 'afternoon' | 'school' | 'dinner' | 'evening' | 'friday' | 'late' | 'midnight';

export function slotOf(d: Date): Slot {
  const h = d.getHours(), wd = d.getDay(), wk = wd === 0 || wd === 6;
  if (h < 5) return 'midnight';
  if (h < 7) return 'early';
  if (wk && h < 12) return 'weekend';
  if (h < 10) return 'breakfast';
  if (h < 12) return 'morning';
  if (h < 14) return 'lunch';
  if (h < 16) return 'afternoon';
  if (h < 18) return wk ? 'afternoon' : 'school';
  if (wd === 5 && h < 23) return 'friday';
  if (h < 20) return 'dinner';
  if (h < 23) return 'evening';
  return 'late';
}

/** Facts the lines can mention. A line that uses a fact that is empty right now is skipped. */
export interface Facts {
  name: string;
  /** the title in the hero, e.g. "Silo" */
  keep: string;
  /** "45 min" or "1 h 20 min" */
  left: string;
  /** clock time you would finish if you pressed play now */
  done: string;
  /** "Silo S2 E3" */
  ep: string;
  epm: string;
  new1: string;
  new2: string;
  /** how many new things this week, as text */
  n: string;
  /** something you requested that is ready */
  ready: string;
  pick: string;
  clock: string;
}

const COPY: Record<Slot, { H: string[]; L: string[] }> = {
  early: { H: ['Up early, {name}', 'Morning, early bird', 'Early start, {name}'],
    L: ['The house is quiet. {keep} has {left} left if you want a head start.', 'Too early for a film? {ep} is about {epm}.', '{new1} came in recently. It will wait for you.', 'Headphones might be kind at this hour.'] },
  breakfast: { H: ['Good morning, {name}', 'Breakfast time, {name}', 'Morning, {name}'],
    L: ['Something short with your cereal? Short on time lives in Explore.', '{n} new things came in this week. {new1} is the newest.', 'You stopped {keep} with {left} to go. Tonight, maybe?', '{ready} is ready. Saving it for later?'] },
  morning: { H: ['Morning, {name}', 'Hi {name}. Quiet one?', 'Hello, {name}'],
    L: ['Working from the sofa? {ep} makes a good break.', 'A slow morning suits {pick}.', '{new1} and {new2} both arrived recently.', '{keep} has {left} left. You could finish before lunch.'] },
  weekend: { H: ['Happy weekend, {name}', 'No alarms today, {name}', 'Weekend mode, {name}'],
    L: ['Pancakes and {pick}? It is a lazy-morning kind of pick.', 'Nothing to rush. {keep} has {left} to go.', '{n} new things this week. {new1} is top of the pile.', '{ep} is waiting whenever you are.'] },
  lunch: { H: ['Lunch break, {name}?', 'Hi {name}. Hungry?', 'Good afternoon, {name}'],
    L: ['Got half an hour? One episode of {ep} fits.', 'Eat and watch: short picks are waiting in Explore.', '{keep} would take {left}. Maybe save it for tonight.', '{ready} finished downloading. It is ready when you are.'] },
  afternoon: { H: ['Good afternoon, {name}', 'Afternoon, {name}', 'Hey {name}'],
    L: ['A slow afternoon? {keep} has {left} left.', '{pick} would be a good escape.', '{new1} is new and nobody has opened it yet.', '{ep} is next whenever you want it.'] },
  school: { H: ['Welcome home, {name}', 'Hi {name}. Snack time', 'Hey {name}'],
    L: ['{n} new things came in. {new2} is one of them.', 'Back early? {keep} is right where you left it.', '{ep} is waiting. You stopped right before it.', 'Not sure what to watch? Try the mood chips below.'] },
  dinner: { H: ['Dinner time, {name}', 'Good evening, {name}', 'Evening, {name}'],
    L: ['Something everyone can watch while eating? Try {pick}.', 'Start {keep} after dinner and you are done by {done}.', '{ep} is waiting. You stopped right before it.', '{new1} is new this week.'] },
  evening: { H: ['Good evening, {name}', 'Evening, {name}', 'Hi {name}. Feet up?'],
    L: ['Pick up {keep}? {left} left, done by {done}.', '{ep} is next. About {epm}.', 'Not sure? {pick} is my pick for tonight.', '{ready} is ready. Tonight is the night.'] },
  friday: { H: ['It is Friday, {name}', 'Movie night, {name}?', 'Friday at last, {name}'],
    L: ['Popcorn ready? {pick} is a good start.', 'No school tomorrow, so a long one is fine: {keep} has {left} left.', '{new1} came in this week. Friday-night material.', '{ep} is next, if you want an easy one.'] },
  late: { H: ['Still up, {name}?', 'Late one, {name}', 'Night owl mode, {name}'],
    L: ['It is late. One more of {ep}, then bed?', '{keep} would take {left}. That is a {done} finish.', 'I will keep your place. Everything will still be here tomorrow.', 'Something light before sleep? Try Short on time in Explore.'] },
  midnight: { H: ['It is after midnight, {name}', 'Cannot sleep, {name}?', 'Very late, {name}'],
    L: ['It is {clock}. No judging, but {keep} would end at {done}.', 'Short ones only at this hour. Try Short on time in Explore.', 'Everything is saved. {keep} will be right here in the morning.', 'Tomorrow-you says thanks for stopping here.'] },
};

/** Fill {tokens}; null when any token has no value, so the caller can skip that line. */
export function fill(s: string, facts: Partial<Facts>): string | null {
  let ok = true;
  const out = s.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = facts[k as keyof Facts];
    if (!v) ok = false;
    return v ?? '';
  });
  return ok ? out : null;
}

/** Headline for `slot`, rotated by `n`. Always returns something (falls back to "Hi {name}"). */
export function headline(slot: Slot, facts: Partial<Facts>, n = 0): string {
  const H = COPY[slot].H;
  for (let i = 0; i < H.length; i++) {
    const out = fill(H[(n + i) % H.length] as string, facts);
    if (out) return out;
  }
  return facts.name ? `Hi ${facts.name}` : 'Hi there';
}

/** All lines that make sense right now, in order. Never empty. */
export function lines(slot: Slot, facts: Partial<Facts>): string[] {
  const out = COPY[slot].L.map(l => fill(l, facts)).filter((l): l is string => !!l);
  return out.length ? out : ['Tell me what you are in the mood for, or pick a mood below.'];
}
