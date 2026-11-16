/** NutBot mascot (lifted from design/mockups/home.html). Decorative SVG; pair with visible text for meaning. */
import { raw, type SafeHtml } from '../lib/html';

export type NutBotMood = 'idle' | 'happy' | 'look' | 'sleepy';

const EYES: Record<NutBotMood, string> = {
  idle: '<rect x="20" y="25" width="8" height="13" rx="2"/><rect x="36" y="25" width="8" height="13" rx="2"/>',
  happy: '<path d="M19 34q5-8 10 0M35 34q5-8 10 0" fill="none" stroke="#3fe0f0" stroke-width="3.5" stroke-linecap="round"/>',
  look: '<rect x="22" y="26" width="8" height="12" rx="2"/><rect x="38" y="26" width="8" height="12" rx="2"/>',
  sleepy: '<rect x="20" y="31" width="8" height="4" rx="2"/><rect x="36" y="31" width="8" height="4" rx="2"/>',
};

let uid = 0;

/** idle blinks, sleepy dozes (see .nb in base.css). `cls` adds classes, e.g. 'hop'. */
export function nutbot(size = 48, mood: NutBotMood = 'idle', cls = ''): SafeHtml {
  const gid = `nbg${++uid}`;
  const motion = mood === 'idle' ? 'blink' : mood === 'sleepy' ? 'doze' : '';
  return raw(`<svg class="nb ${cls} ${motion}" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eae4da"/><stop offset=".55" stop-color="#cdc7bb"/><stop offset="1" stop-color="#bcb6aa"/></linearGradient></defs>
    <rect x="3" y="21" width="5" height="14" rx="1.5" fill="#c4bdb0" stroke="#9c907e" stroke-width="1.5"/>
    <rect x="56" y="21" width="5" height="14" rx="1.5" fill="#c4bdb0" stroke="#9c907e" stroke-width="1.5"/>
    <rect x="7" y="8" width="50" height="46" rx="11" fill="url(#${gid})" stroke="#9c907e" stroke-width="2.5"/>
    <rect x="13" y="14" width="38" height="30" rx="6" fill="#040302" stroke="#504840" stroke-width="2"/>
    <g class="eyes" fill="#3fe0f0" style="filter:drop-shadow(0 0 2px #00b4c8)">${EYES[mood]}</g>
    <rect x="14" y="48" width="7" height="2.5" rx="1" fill="#9c907e"/><rect x="23" y="48" width="7" height="2.5" rx="1" fill="#9c907e"/>
    <circle cx="49" cy="49" r="2.2" fill="#00b4c8"/>
  </svg>`);
}
