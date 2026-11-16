/**
 * NutBot's line above the library: a time-of-day remark plus one suggested mix ("Try: Everyone + Under 90 min").
 * Copy lifted from design/mockups/library.html (trimmed to what the real data can back up); light accent only.
 */
import { html, type SafeHtml } from '../../lib/html';
import type { LibKind } from './filters';

export interface BotCtx {
  name: string;
  /** how many titles the suggested mix matches */
  n: number;
  /** newest title and when it arrived ("this morning", "3 days ago") */
  newest?: { t: string; when: string };
  /** the film or show they are partway through */
  resume?: { t: string; pct: number; left: string; by: string };
}

export interface Slot {
  k: string;
  label: string;
  from: number;
  to: number;
  weekend?: boolean;
  friday?: boolean;
  /** "group:key" pairs to switch on */
  mix: Record<LibKind, string[]>;
  lines: Record<LibKind, Array<(c: BotCtx) => SafeHtml>>;
}

const b = (s: string | number): SafeHtml => html`<b>${s}</b>`;
const finish = (c: BotCtx): SafeHtml => c.resume
  ? html`Pick up ${b(c.resume.t)}: ${c.resume.pct}% done, ${c.resume.left} left, finished by ${c.resume.by}.`
  : html`Fresh start. Nothing is half-watched.`;
const fresh = (c: BotCtx): SafeHtml => c.newest ? html`New: ${b(c.newest.t)}, arrived ${c.newest.when}.` : html`Plenty to pick from.`;

export const SLOTS: Slot[] = [
  { k: 'early', label: 'Early morning', from: 5, to: 7, mix: { movies: ['len:90', 'mood:laugh'], shows: ['xtra:air'] }, lines: {
    movies: [c => html`Up before the sun, ${c.name}? Something short: ${b(c.n)} to try.`, c => c.resume ? html`Quiet house. A good time to finish ${b(c.resume.t)}, only ${c.resume.left} left.` : html`Quiet house. Good time for something nobody else wants to watch.`],
    shows: [c => html`Early start. One episode, then coffee, ${c.name}.`, c => finish(c)] } },
  { k: 'breakfast', label: 'Breakfast', from: 7, to: 9, mix: { movies: ['who:all', 'len:90'], shows: ['who:all'] }, lines: {
    movies: [c => html`Breakfast telly? ${b(c.n)} family films are under 90 minutes.`, c => fresh(c)],
    shows: [c => html`Cereal and a cartoon? ${b(c.n)} shows are fine for the whole table.`, c => fresh(c)] } },
  { k: 'late-morning', label: 'Late morning', from: 9, to: 12, mix: { movies: ['seen:not'], shows: ['where:watching'] }, lines: {
    movies: [c => html`A slow morning. ${b(c.n)} films you have not seen yet.`, c => fresh(c)],
    shows: [c => html`A slow morning. ${b(c.n)} shows are waiting for you to pick them up.`, c => finish(c)] } },
  { k: 'lunch', label: 'Lunch', from: 12, to: 14, mix: { movies: ['len:90', 'mood:laugh'], shows: ['where:watching'] }, lines: {
    movies: [c => html`Eating at your desk? Short and funny: ${b(c.n)} to try.`, c => fresh(c)],
    shows: [c => html`One episode fits in a lunch break. ${b(c.n)} shows to pick from.`, c => finish(c)] } },
  { k: 'afternoon', label: 'Afternoon', from: 14, to: 15.5, mix: { movies: ['mood:adv', 'seen:not'], shows: ['where:not'] }, lines: {
    movies: [c => html`Rainy afternoon? Pick a big adventure: ${b(c.n)} you have not seen.`, c => finish(c)],
    shows: [c => html`Something new to start? ${b(c.n)} shows have every episode ready.`, c => fresh(c)] } },
  { k: 'school', label: 'After school', from: 15.5, to: 17.5, mix: { movies: ['who:all', 'len:120'], shows: ['who:all'] }, lines: {
    movies: [c => html`School is out! ${b(c.n)} films that are fine for everyone.`, c => fresh(c)],
    shows: [c => html`Snack and a cartoon. ${b(c.n)} shows for all ages.`, c => fresh(c)] } },
  { k: 'dinner', label: 'Dinner', from: 17.5, to: 19, mix: { movies: ['who:all', 'len:120'], shows: ['who:all'] }, lines: {
    movies: [c => html`Dinner on the sofa? ${b(c.n)} family films finish in under 2 hours.`, c => fresh(c)],
    shows: [c => html`Something for the whole table: ${b(c.n)} shows for all ages.`, c => fresh(c)] } },
  { k: 'evening', label: 'Evening', from: 19, to: 21.5, mix: { movies: ['seen:not', 'len:120'], shows: ['where:new'] }, lines: {
    movies: [c => html`Evening, ${c.name}. ${b(c.n)} films you have not seen, under 2 hours.`, c => finish(c), c => fresh(c)],
    shows: [c => html`Evening, ${c.name}. ${b(c.n)} of your shows have new episodes.`, c => finish(c)] } },
  { k: 'late', label: 'Late night', from: 21.5, to: 24, mix: { movies: ['who:adult', 'mood:thrill'], shows: ['who:adult'] }, lines: {
    movies: [c => html`Late one? Edge of your seat: ${b(c.n)} thrillers for grown-ups.`, c => html`Kids in bed. ${b(c.n)} to choose from.`],
    shows: [c => html`One more episode? I will not tell. ${b(c.n)} grown-up shows here.`, c => finish(c)] } },
  { k: 'midnight', label: 'After midnight', from: 0, to: 5, mix: { movies: ['len:90', 'mood:laugh'], shows: ['xtra:air'] }, lines: {
    movies: [c => html`It is very late, ${c.name}. Something short: ${b(c.n)} to try.`, c => html`Cannot sleep? A comedy is kinder than a horror right now.`],
    shows: [c => html`Still up? It will all still be here tomorrow. Just saying.`, c => finish(c)] } },
  { k: 'weekend', label: 'Weekend morning', from: 7, to: 11, weekend: true, mix: { movies: ['who:all', 'mood:adv'], shows: ['who:all'] }, lines: {
    movies: [c => html`Weekend! Pancakes and ${b(c.n)} family adventures.`, c => fresh(c)],
    shows: [c => html`Weekend! Saturday cartoons: ${b(c.n)} shows for everyone.`, c => finish(c)] } },
  { k: 'friday', label: 'Friday night', from: 18, to: 24, friday: true, mix: { movies: ['seen:not', 'mood:adv'], shows: ['where:not'] }, lines: {
    movies: [c => html`Friday night! Something big: ${b(c.n)} adventures you have not seen.`, c => fresh(c)],
    shows: [c => html`Friday night. Start something new: ${b(c.n)} shows nobody has begun.`, c => fresh(c)] } },
];

export function slotAt(d: Date): Slot {
  const h = d.getHours() + d.getMinutes() / 60;
  const wd = d.getDay();
  const byKey = (k: string): Slot => SLOTS.find(s => s.k === k) as Slot;
  if (wd === 5 && h >= 18) return byKey('friday');
  if ((wd === 0 || wd === 6) && h >= 7 && h < 11) return byKey('weekend');
  return SLOTS.find(s => !s.weekend && !s.friday && h >= s.from && h < s.to) ?? byKey('evening');
}
