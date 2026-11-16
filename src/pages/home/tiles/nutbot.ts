/** NutBot tile: time-of-day greeting, a rotating one-liner and mood chips that open the chat. */
import type { Episode, MediaItem } from '../../../api/types';
import { clock, runtime } from '../../../lib/format';
import { html } from '../../../lib/html';
import { icon } from '../../../ui/icons';
import { nutbot, type NutBotMood } from '../../../ui/nutbot';
import { headline, lines, slotOf, type Facts, type Slot } from '../copy';
import { epLabel } from '../model';
import { MOODS } from '../nutbot/moods';
import { chatFor } from '../nutbot/session';
import type { HomeCtx, TileDef } from '../tile';

const FACE: Record<Slot, NutBotMood> = {
  early: 'look', breakfast: 'happy', morning: 'idle', weekend: 'happy', lunch: 'idle', afternoon: 'idle',
  school: 'happy', dinner: 'idle', evening: 'idle', friday: 'happy', late: 'sleepy', midnight: 'sleepy',
};

/** Facts for the one-liners, from whatever has loaded. Every part is optional. */
async function gatherFacts(ctx: HomeCtx): Promise<Partial<Facts>> {
  const now = ctx.now();
  const [resume, next, recent, sugg, reqs] = await Promise.allSettled([
    ctx.data.resume(), ctx.data.nextUp(), ctx.data.recent(7), ctx.data.suggestions(), ctx.data.myRequests(),
  ]);
  const f: Partial<Facts> = { name: ctx.user?.name ?? '', clock: clock(now) };
  if (resume.status === 'fulfilled') {
    const k: MediaItem | undefined = resume.value[0];
    if (k) {
      f.keep = k.kind === 'episode' ? k.seriesName : k.name;
      const left = k.progress?.remainingMin;
      if (left) { f.left = runtime(left); f.done = clock(new Date(now.getTime() + left * 60_000)); }
    }
  }
  if (next.status === 'fulfilled') {
    const e: Episode | undefined = next.value[0];
    if (e) { f.ep = `${e.seriesName} ${epLabel(e)}`; if (e.runtimeMin) f.epm = `${e.runtimeMin} minutes`; }
  }
  if (recent.status === 'fulfilled' && recent.value.length) {
    f.new1 = recent.value[0]?.name ?? '';
    f.new2 = recent.value[1]?.name ?? '';
    f.n = String(recent.value.length);
  }
  if (sugg.status === 'fulfilled' && sugg.value[0]) f.pick = sugg.value[0].name;
  if (reqs.status === 'fulfilled') f.ready = reqs.value.find(r => r.state === 'available')?.title ?? '';
  return f;
}

export const nutbotTile: TileDef = {
  id: 'nutbot', tab: 'home', title: 'NutBot', icon: 'bot', place: [1, 1, 5, 2], minH: 0,
  mount(host, ctx) {
    const slot = slotOf(ctx.now());
    const { chat, onChange } = chatFor(ctx);
    let facts: Partial<Facts> = { name: ctx.user?.name ?? '', clock: clock(ctx.now()) };
    let lineIdx = 0;
    let headIdx = 0;

    const paint = (): void => {
      const all = lines(slot, facts);
      const mood = FACE[slot];
      const talk = chat.talked;
      host.innerHTML = html`
        <div class="nbt">
          <button class="nbt-face" type="button" data-more aria-label="NutBot. Say something else">${nutbot(64, mood, 'nbt-bot')}${mood === 'sleepy' ? html`<span class="zz" aria-hidden="true">z</span>` : ''}</button>
          <div class="nbt-words">
            <h2 class="nbt-hi" id="h-nutbot">${headline(slot, facts, headIdx)}</h2>
            <p class="nbt-line">${all[lineIdx % all.length]}</p>
          </div>
          <button class="iconbtn nbt-more" type="button" data-more aria-label="NutBot, say something else">${icon('shuffle')}</button>
          <div class="nbt-chat">
            <p class="nbt-q" id="nbtQ">${talk ? 'We were chatting' : 'What are you in the mood for?'}</p>
            <div class="moodwrap">
              <button class="moodprev" type="button" aria-label="Previous moods" disabled>${icon('back')}</button>
              <div class="moods" role="group" aria-labelledby="nbtQ">
                <button class="mood say" type="button" data-open aria-label="${talk ? 'Back to our chat with NutBot' : 'Tell NutBot what you are in the mood for'}">${icon('chat')}${talk ? 'Back to our chat' : 'Tell NutBot'}</button>
                ${MOODS.map(m => html`<button class="mood" type="button" data-mood="${m.key}">${icon(m.icon)}${m.chip}</button>`)}
              </div>
              <button class="moodnext" type="button" aria-label="More moods"><span>More</span>${icon('next')}</button>
            </div>
          </div>
        </div>`.value;
      syncArrows();
    };

    const moods = (): HTMLElement | null => host.querySelector('.moods');
    function syncArrows(): void {
      const m = moods();
      if (!m) return;
      const prev = host.querySelector<HTMLButtonElement>('.moodprev');
      const next = host.querySelector<HTMLButtonElement>('.moodnext');
      const max = m.scrollWidth - m.clientWidth;
      if (prev) prev.disabled = m.scrollLeft <= 1;
      if (next) next.hidden = max <= 1 || m.scrollLeft >= max - 1;
    }

    host.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      const more = t.closest('[data-more]');
      if (more) {
        lineIdx++; headIdx += lineIdx % 2;
        const line = host.querySelector('.nbt-line');
        const h = host.querySelector('.nbt-hi');
        const all = lines(slot, facts);
        if (line) { line.textContent = all[lineIdx % all.length] ?? ''; line.classList.remove('swap'); void (line as HTMLElement).offsetWidth; line.classList.add('swap'); }
        if (h) h.textContent = headline(slot, facts, headIdx);
        return;
      }
      const open = t.closest<HTMLElement>('[data-open]');
      if (open) { chat.open({ trigger: open }); return; }
      const mood = t.closest<HTMLElement>('[data-mood]');
      if (mood) { const m = MOODS.find(x => x.key === mood.dataset.mood); if (m) chat.open({ ask: m.ask, trigger: mood }); return; }
      const step = t.closest<HTMLElement>('.moodprev, .moodnext');
      const mm = moods();
      if (step && mm) mm.scrollBy({ left: (step.classList.contains('moodprev') ? -1 : 1) * mm.clientWidth * 0.7, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    host.addEventListener('scroll', e => { if ((e.target as HTMLElement).classList?.contains('moods')) syncArrows(); }, true);
    const ro = new ResizeObserver(() => syncArrows());
    ro.observe(host);
    // The chat can start/reset while the tile is on screen: reword the chip, but do not steal focus.
    onChange(() => {
      // repainting replaces the chips: put keyboard focus back on the same one
      const a = document.activeElement as HTMLElement | null;
      const inside = !!a && host.contains(a);
      const sel = !inside ? '' : a?.dataset.mood ? `[data-mood="${a.dataset.mood}"]` : a?.hasAttribute('data-open') ? '[data-open]' : '';
      paint();
      if (sel) host.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
    });

    paint();
    void gatherFacts(ctx).then(f => {
      if (ctx.signal.aborted) return;
      facts = f;
      const all = lines(slot, facts);
      const line = host.querySelector('.nbt-line');
      const h = host.querySelector('.nbt-hi');
      if (line) line.textContent = all[lineIdx % all.length] ?? '';
      if (h) h.textContent = headline(slot, facts, headIdx);
    });
    return () => ro.disconnect();
  },
};


