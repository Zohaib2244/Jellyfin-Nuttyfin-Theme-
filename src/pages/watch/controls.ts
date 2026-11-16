/**
 * The player's chrome: markup, auto-hiding controls, seek bar with trickplay preview and chapter ticks, volume, touch gestures,
 * the settings sheet, and the moment cards (skip, up next, pause, end, error). It owns no playback state: it paints what index.ts
 * tells it and reports what the person did through `UIHost`.
 */
import { esc, html, raw, setHtml } from '../../lib/html';
import { store } from '../../lib/storage';
import { ic, spriteMarkup, type PlIcon } from './icons';
import { clamp, fmt, spoken } from './timefmt';

export interface MenuChoice { value: string; label: string; hint?: string }
export interface Menus {
  audio: MenuChoice[];
  audioNow: string;
  subs: MenuChoice[];
  subsNow: string;
  speeds: MenuChoice[];
  speedNow: string;
  quality: MenuChoice[];
  qualityNow: string;
  qualityNote: string;
  versions: MenuChoice[];
  versionNow: string;
  subSize: number;
  subBox: boolean;
}

export interface PeekInfo {
  /** applied to the thumbnail div (trickplay tile) */
  style?: Partial<CSSStyleDeclaration>;
  /** width / height of the tile */
  aspect?: number;
  chapter?: string;
}

export interface UIHost {
  toggle(): void;
  seekBy(delta: number, how?: 'tap' | 'key'): void;
  seekTo(seconds: number): void;
  mute(): void;
  setVolume(v: number): void;
  skip(): void;
  next(): void;
  watchCredits(): void;
  pip(): void;
  fullscreen(): void;
  back(): void;
  choose(kind: 'audio' | 'sub' | 'speed' | 'quality' | 'version', value: string): void;
  subStyle(size: number, box: boolean): void;
  retry(): void;
  startOver(): void;
  again(): void;
  peek(seconds: number): PeekInfo;
  /** duration in seconds (0 while unknown) */
  duration(): number;
}

/** Two taps this close on the same side are a double-tap (seek); a lone tap on a side waits this long before toggling the controls. */
const DOUBLE_TAP_MS = 380;
const RM = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const SMALL = (): boolean => matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)').matches;
const TOUCHY = (): boolean => matchMedia('(hover: none) and (pointer: coarse)').matches;

export class PlayerUI {
  readonly root: HTMLElement;
  readonly video: HTMLVideoElement;
  private readonly $ = <T extends HTMLElement = HTMLElement>(sel: string): T => this.root.querySelector<T>(sel) as T;
  private hideTimer: number | undefined;
  private tapTimer: number | undefined;
  private lastTap = { t: 0, side: '' };
  private tapChain = { side: '', n: 0, t: 0 };
  private resumeTimer: number | undefined;
  private hintTimer: number | undefined;
  private noteTimer: number | undefined;
  private sheetOpener: Element | null = null;
  private scrubbing = false;
  private overBar = false;
  private paused = false;
  private ended = false;
  private remTotal = false;
  private sheetOpen = false;
  private errorOpen = false;
  private flashEl!: HTMLElement;
  private lastCue = '';
  private upBuilt = '';
  private pausedCard = false;

  constructor(private readonly host: UIHost) {
    const root = document.createElement('main');
    root.className = 'pl';
    root.dataset.ui = 'on';
    root.dataset.state = 'loading';
    root.dataset.busy = 'on';
    root.setAttribute('aria-label', 'Video player');
    setHtml(root, this.markup());
    this.root = root;
    this.video = this.$('video');
    this.flashEl = this.$('.pl-flash');
    this.wire();
  }

  /* ───────── markup ───────── */
  private markup(): ReturnType<typeof html> {
    return html`${raw(spriteMarkup())}
      <div class="pl-frame" id="plFrame">
        <video playsinline preload="auto" aria-label="Video"></video>
        <div class="pl-vig" aria-hidden="true"></div>
        <div class="pl-dim" aria-hidden="true"></div>
        <p class="pl-subs" aria-hidden="true"></p>
        <div class="pl-rip l" aria-hidden="true"><span>${ic('rw')}<em></em></span></div>
        <div class="pl-rip r" aria-hidden="true"><span>${ic('ff')}<em></em></span></div>
        <div class="pl-flash" aria-hidden="true">${ic('play')}<span class="t"></span></div>
        <div class="pl-spin" aria-hidden="true"></div>
        <div class="pl-center pl-ui">
          <button class="pl-ibtn rw" type="button" data-act="rw" aria-label="Back 10 seconds">${ic('rw')}</button>
          <button class="pl-ibtn play" type="button" data-act="toggle" aria-label="Pause">${ic('pause')}</button>
          <button class="pl-ibtn ff" type="button" data-act="ff" aria-label="Forward 10 seconds">${ic('ff')}</button>
        </div>
      </div>
      <div class="pl-scrim top pl-ui" aria-hidden="true"></div>
      <div class="pl-scrim bot pl-ui" aria-hidden="true"></div>
      <header class="pl-top pl-ui">
        <button class="pl-ibtn back" type="button" data-act="back" aria-label="Back" data-tip="Back">${ic('back')}</button>
        <div class="pl-ttl"></div>
      </header>
      <div class="pl-toast hint" role="status"></div>
      <div class="pl-toast resume" role="status"></div>
      <div class="pl-toast note" role="status"></div>
      <section class="pl-pause" aria-hidden="true"></section>
      <button class="pl-pill pl-skip" type="button" data-act="skip" tabindex="-1"><span class="lbl">Skip intro</span>${ic('skipnext')}<i class="left" aria-hidden="true"></i></button>
      <section class="pl-up pl-card" aria-label="Up next"></section>
      <div class="pl-bar pl-ui">
        <div class="pl-seekrow">
          <span class="pl-time el" aria-hidden="true">0:00</span>
          <div class="pl-scrub" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div class="pl-track"><i class="buf"></i><i class="hov"></i><i class="fill"></i><span class="ticks"></span><span class="pl-knob"></span></div>
            <div class="pl-peek" aria-hidden="true"><div class="thumb"><div></div></div><span class="pt">0:00</span><span class="ch"></span></div>
          </div>
          <button class="pl-time rem" type="button" aria-label="Show total length instead">-0:00</button>
        </div>
        <div class="pl-ctlrow">
          <div class="pl-ctl-l">
            <button class="pl-ibtn play" type="button" data-act="toggle" aria-label="Pause" data-tip="Pause (Space)">${ic('pause')}</button>
            <button class="pl-ibtn rw" type="button" data-act="rw" aria-label="Back 10 seconds" data-tip="Back 10 s (J)">${ic('rw')}</button>
            <button class="pl-ibtn ff" type="button" data-act="ff" aria-label="Forward 10 seconds" data-tip="Forward 10 s (L)">${ic('ff')}</button>
            <div class="pl-vol">
              <button class="pl-ibtn" type="button" data-act="mute" aria-label="Mute" data-tip="Mute (M)">${ic('vol')}</button>
              <input type="range" class="volr" min="0" max="100" step="1" value="80" aria-label="Volume">
            </div>
          </div>
          <div class="pl-ctl-r">
            <button class="pl-ibtn nextbtn" type="button" data-act="next" aria-label="Next episode" data-tip="Next episode (Shift N)" hidden>${ic('skipnext')}</button>
            <button class="pl-ibtn morebtn" type="button" data-act="sheet" aria-haspopup="dialog" aria-expanded="false" aria-label="Audio, subtitles and more" data-tip="Audio, subtitles &amp; more (C)">${ic('cc')}</button>
            <button class="pl-ibtn pipbtn" type="button" data-act="pip" aria-label="Picture in picture" data-tip="Picture in picture (P)">${ic('pip')}</button>
            <button class="pl-ibtn fsbtn" type="button" data-act="fs" aria-label="Full screen" data-tip="Full screen (F)">${ic('full')}</button>
          </div>
        </div>
      </div>
      <section class="pl-end" aria-live="polite"></section>
      <section class="pl-error" role="alert"></section>
      <div class="pl-veil"></div>
      <div class="pl-sheet pl-card" role="dialog" aria-modal="true" aria-label="Audio, subtitles and more" hidden>
        <span class="grab" aria-hidden="true"></span>
        <div class="hd">
          <div class="pl-tabs" role="tablist" aria-label="Player settings">
            <button class="pl-tab" type="button" role="tab" id="pl-tab-av" aria-controls="pl-pn-av" aria-selected="true">Audio &amp; subtitles</button>
            <button class="pl-tab" type="button" role="tab" id="pl-tab-sp" aria-controls="pl-pn-sp" aria-selected="false" tabindex="-1">Speed</button>
            <button class="pl-tab" type="button" role="tab" id="pl-tab-q" aria-controls="pl-pn-q" aria-selected="false" tabindex="-1">Quality</button>
          </div>
          <button class="pl-ibtn" type="button" data-act="closesheet" aria-label="Close">${ic('x')}</button>
        </div>
        <div class="body">
          <div class="pl-panel" role="tabpanel" id="pl-pn-av" aria-labelledby="pl-tab-av" tabindex="-1"></div>
          <div class="pl-panel" role="tabpanel" id="pl-pn-sp" aria-labelledby="pl-tab-sp" tabindex="-1" hidden></div>
          <div class="pl-panel" role="tabpanel" id="pl-pn-q" aria-labelledby="pl-tab-q" tabindex="-1" hidden></div>
        </div>
      </div>
      <div class="pl-sr" id="plLive" aria-live="polite"></div>`;
  }

  /* ───────── wiring ───────── */
  private wire(): void {
    const root = this.root;
    const act: Record<string, () => void> = {
      toggle: () => this.host.toggle(), rw: () => this.host.seekBy(-10), ff: () => this.host.seekBy(10), mute: () => this.host.mute(),
      next: () => this.host.next(), skip: () => this.host.skip(), pip: () => this.host.pip(), fs: () => this.host.fullscreen(), back: () => this.host.back(),
      sheet: () => (this.sheetOpen ? this.closeSheet() : this.openSheet()), closesheet: () => this.closeSheet(),
      playnext: () => this.host.next(), credits: () => this.host.watchCredits(), retry: () => this.host.retry(), startover: () => this.host.startOver(), again: () => this.host.again(),
    };
    root.addEventListener('click', e => {
      const b = (e.target as Element).closest<HTMLElement>('[data-act]');
      if (!b || !root.contains(b)) return;
      const f = act[b.dataset.act ?? ''];
      if (f) { e.stopPropagation(); f(); }
    });

    /* chrome visibility */
    // our own distance check: the first move into the page has movementX 0, and sub-pixel jitter should not keep the controls up
    let lx = -1; let ly = -1;
    root.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      if (lx < 0 || Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) >= 3) { this.wake(); lx = e.clientX; ly = e.clientY; }
    });
    root.addEventListener('pointerleave', () => { if (!this.paused && !this.sheetOpen && !this.scrubbing) { window.clearTimeout(this.hideTimer); this.hideTimer = window.setTimeout(() => this.setUI(false), 800); } });
    const bar = this.$('.pl-bar');
    bar.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { this.overBar = true; this.wake(); } });
    bar.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { this.overBar = false; this.wake(); } });
    root.addEventListener('focusin', () => this.wake());

    /* taps and clicks on the picture */
    const frame = this.$('#plFrame');
    frame.addEventListener('click', e => this.onFrameClick(e as MouseEvent));
    root.addEventListener('click', e => {
      const t = e.target as Element;
      if (t !== root && !t.classList.contains('pl-scrim')) return;
      if (this.uiOn && !this.paused) { window.clearTimeout(this.hideTimer); this.setUI(false); } else this.wake();
    });

    this.wireScrub();
    this.wireVolume();
    this.wireSheet();
    document.addEventListener('fullscreenchange', this.onFs);
  }

  destroy(): void {
    window.clearTimeout(this.hideTimer); window.clearTimeout(this.tapTimer); window.clearTimeout(this.resumeTimer);
    window.clearTimeout(this.hintTimer); window.clearTimeout(this.noteTimer);
    document.removeEventListener('fullscreenchange', this.onFs);
  }

  private get uiOn(): boolean { return this.root.dataset.ui === 'on'; }
  private setUI(on: boolean): void { this.root.dataset.ui = on ? 'on' : 'off'; }

  /** Show the controls; they hide again after ~3 s of playing (never while paused on a phone, with a sheet open, or while dragging). */
  wake(): void {
    this.setUI(true);
    window.clearTimeout(this.hideTimer);
    if (this.sheetOpen || this.scrubbing || this.overBar || this.ended || this.errorOpen) return;
    if (this.paused && SMALL()) return;
    this.hideTimer = window.setTimeout(() => { if (!this.sheetOpen && !this.scrubbing && !this.overBar) this.setUI(false); }, this.paused ? 5000 : 3000);
  }

  private onFrameClick(e: MouseEvent): void {
    if ((e.target as Element).closest('button')) return;
    const frame = this.$('#plFrame');
    const touch = (e as PointerEvent).pointerType ? (e as PointerEvent).pointerType !== 'mouse' : TOUCHY();
    const r = frame.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const side = x < 0.4 ? 'l' : x > 0.6 ? 'r' : 'c';
    const now = performance.now();
    if (this.sheetOpen) { this.closeSheet(); return; }
    if (touch) {
      const chained = this.tapChain.side === side && now - this.tapChain.t < 900 && side !== 'c';
      if ((now - this.lastTap.t < DOUBLE_TAP_MS && side === this.lastTap.side && side !== 'c') || chained) {
        window.clearTimeout(this.tapTimer);
        this.ripple(side as 'l' | 'r');
        this.host.seekBy(side === 'l' ? -10 : 10, 'tap');
        this.lastTap = { t: now, side };
        return;
      }
      this.lastTap = { t: now, side };
      window.clearTimeout(this.tapTimer);
      this.tapTimer = window.setTimeout(() => { if (this.uiOn) { window.clearTimeout(this.hideTimer); this.setUI(false); } else this.wake(); }, side === 'c' ? 0 : DOUBLE_TAP_MS);
    } else {
      // mouse: click plays or pauses, double-click goes full screen
      if (e.detail === 2) { window.clearTimeout(this.tapTimer); this.host.toggle(); this.host.fullscreen(); return; }
      window.clearTimeout(this.tapTimer);
      this.tapTimer = window.setTimeout(() => this.host.toggle(), 0);
    }
  }

  private ripple(side: 'l' | 'r'): void {
    const el = this.$(side === 'l' ? '.pl-rip.l' : '.pl-rip.r');
    const now = performance.now();
    if (this.tapChain.side === side && now - this.tapChain.t < 900) this.tapChain.n++; else this.tapChain = { side, n: 1, t: now };
    this.tapChain.t = now;
    (el.querySelector('em') as HTMLElement).textContent = `${this.tapChain.n * 10} seconds`;
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  }

  /** The centre glyph that confirms a keyboard or tap action, then fades. */
  flash(icon: PlIcon, text = ''): void {
    const f = this.flashEl;
    (f.querySelector('use') as SVGUseElement).setAttribute('href', `#pl-${icon}`);
    (f.querySelector('.t') as HTMLElement).textContent = text;
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  }

  announce(msg: string): void {
    const live = this.$('#plLive');
    live.textContent = '';
    requestAnimationFrame(() => { live.textContent = msg; });
  }

  /* ───────── scrubber ───────── */
  private wireScrub(): void {
    const scrub = this.$('.pl-scrub');
    const peek = this.$('.pl-peek');
    const dur = (): number => this.host.duration();
    const xToT = (clientX: number): number => { const r = scrub.getBoundingClientRect(); return clamp((clientX - r.left) / r.width, 0, 1) * dur(); };
    const showPeek = (t: number): void => {
      const d = dur(); if (!d) return;
      const r = scrub.getBoundingClientRect();
      const pw = 192;
      peek.style.left = `${clamp((t / d) * r.width, pw / 2 - 8, r.width - pw / 2 + 8)}px`;
      (this.$('.hov') as HTMLElement).style.width = `${((t / d) * 100).toFixed(2)}%`;
      const info = this.host.peek(t);
      const thumb = peek.querySelector('.thumb > div') as HTMLElement;
      thumb.removeAttribute('style');
      if (info.style) Object.assign(thumb.style, info.style);
      const wrap = peek.querySelector('.thumb') as HTMLElement;
      wrap.style.display = info.style ? '' : 'none';
      wrap.style.aspectRatio = String(info.aspect ?? 16 / 9);
      (peek.querySelector('.pt') as HTMLElement).textContent = fmt(t);
      (peek.querySelector('.ch') as HTMLElement).textContent = info.chapter ?? '';
      peek.classList.add('on');
    };
    scrub.addEventListener('pointermove', e => {
      if (this.scrubbing) { const t = xToT(e.clientX); this.paintTime(t, dur(), this.bufEnd); showPeek(t); }
      else if (e.pointerType === 'mouse') showPeek(xToT(e.clientX));
    });
    scrub.addEventListener('pointerleave', () => { if (!this.scrubbing) peek.classList.remove('on'); });
    scrub.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      this.scrubbing = true; scrub.classList.add('drag'); scrub.setPointerCapture(e.pointerId);
      const t = xToT(e.clientX); this.paintTime(t, dur(), this.bufEnd); showPeek(t); this.wake();
    });
    const end = (e: PointerEvent): void => {
      if (!this.scrubbing) return;
      this.scrubbing = false; scrub.classList.remove('drag');
      this.host.seekTo(xToT(e.clientX));
      if (e.pointerType !== 'mouse') peek.classList.remove('on');
      this.wake();
    };
    scrub.addEventListener('pointerup', end);
    scrub.addEventListener('pointercancel', () => { this.scrubbing = false; scrub.classList.remove('drag'); peek.classList.remove('on'); });
    let keyPeek: number | undefined;
    scrub.addEventListener('keydown', e => {
      const map: Record<string, number> = { Home: -Infinity, End: Infinity, PageUp: 60, PageDown: -60, ArrowLeft: -10, ArrowRight: 10 };
      if (!(e.key in map)) return;
      e.preventDefault(); e.stopPropagation();
      const d = map[e.key] as number;
      const cur = Number(scrub.getAttribute('aria-valuenow') ?? 0);
      const t = d === -Infinity ? 0 : d === Infinity ? dur() - 1 : cur + d;
      this.host.seekTo(clamp(t, 0, Math.max(0, dur() - 0.5)));
      showPeek(clamp(t, 0, dur()));
      window.clearTimeout(keyPeek); keyPeek = window.setTimeout(() => peek.classList.remove('on'), 1200);
      this.wake();
    });
    this.$('.rem').addEventListener('click', () => {
      this.remTotal = !this.remTotal;
      this.$('.rem').setAttribute('aria-label', this.remTotal ? 'Show time left instead' : 'Show total length instead');
      this.paintTime(this.curT, dur(), this.bufEnd);
    });
  }

  private curT = 0;
  private bufEnd = 0;

  /** Paint the clock and bars. `buffered` = seconds buffered up to. */
  paintTime(t: number, duration: number, buffered: number): void {
    this.curT = t; this.bufEnd = buffered;
    const f = duration ? clamp(t / duration, 0, 1) : 0;
    const pct = `${(f * 100).toFixed(3)}%`;
    (this.$('.fill') as HTMLElement).style.width = pct;
    (this.$('.pl-knob') as HTMLElement).style.left = pct;
    (this.$('.buf') as HTMLElement).style.width = `${duration ? clamp(buffered / duration, 0, 1) * 100 : 0}%`;
    this.$('.el').textContent = fmt(t);
    this.$('.rem').textContent = this.remTotal ? fmt(duration) : `-${fmt(Math.max(0, duration - t))}`;
    const s = this.$('.pl-scrub');
    s.setAttribute('aria-valuemax', String(Math.round(duration)));
    s.setAttribute('aria-valuenow', String(Math.round(t)));
    s.setAttribute('aria-valuetext', `${spoken(t)} of ${spoken(duration)}`);
  }

  /** Chapter tick marks on the bar (fractions 0-1). */
  setTicks(fractions: number[]): void {
    setHtml(this.$('.ticks'), html`${fractions.map(f => raw(`<i class="tick" style="left:${(f * 100).toFixed(2)}%"></i>`))}`);
  }

  get isScrubbing(): boolean { return this.scrubbing; }

  /* ───────── volume ───────── */
  private wireVolume(): void {
    const r = this.$<HTMLInputElement>('.volr');
    r.addEventListener('input', () => this.host.setVolume(Number(r.value) / 100));
  }

  paintVolume(v: number, muted: boolean): void {
    const shown = muted ? 0 : v;
    const r = this.$<HTMLInputElement>('.volr');
    r.value = String(Math.round(shown * 100));
    r.style.setProperty('--v', `${Math.round(shown * 100)}%`);
    r.setAttribute('aria-valuetext', muted ? 'Muted' : `${Math.round(shown * 100)} percent`);
    const b = this.$('[data-act="mute"]');
    (b.querySelector('use') as SVGUseElement).setAttribute('href', `#pl-${muted || shown === 0 ? 'mute' : shown < 0.5 ? 'vollow' : 'vol'}`);
    b.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    b.dataset.tip = muted ? 'Unmute (M)' : 'Mute (M)';
  }

  /* ───────── state paints ───────── */
  setBusy(on: boolean): void { this.root.dataset.busy = on ? 'on' : 'off'; }

  setPlaying(on: boolean, silent = false): void {
    this.paused = !on;
    this.root.dataset.state = on ? 'playing' : 'paused';
    for (const b of Array.from(this.root.querySelectorAll<HTMLElement>('[data-act="toggle"]'))) {
      b.setAttribute('aria-label', on ? 'Pause' : 'Play');
      (b.querySelector('use') as SVGUseElement).setAttribute('href', on ? '#pl-pause' : '#pl-play');
      if (b.dataset.tip !== undefined) b.dataset.tip = on ? 'Pause (Space)' : 'Play (Space)';
    }
    if (on) this.hidePause();
    if (!silent) { this.flash(on ? 'play' : 'pause'); this.announce(on ? 'Playing' : 'Paused'); }
    this.wake();
  }

  setCredits(on: boolean): void { this.root.classList.toggle('pl-credits', on); }

  setMeta(show: string, line: string, sx = ''): void {
    setHtml(this.$('.pl-ttl'), html`<span class="show">${show}</span><span class="ep">${sx ? html`<span class="sx">${sx}</span> ` : ''}${line}</span>`);
  }

  setHasNext(has: boolean): void { this.$('.nextbtn').hidden = !has; }

  setCue(text: string): void {
    if (text === this.lastCue) return;
    this.lastCue = text;
    const el = this.$('.pl-subs');
    if (text) setHtml(el, html`<span>${text}</span>`); else el.replaceChildren();
  }

  setSubStyle(size: number, box: boolean): void {
    const el = this.$('.pl-subs');
    el.style.setProperty('--pl-subsz', String(size));
    el.classList.toggle('box', box);
  }

  setSkip(label: string | null, left = 1): void {
    const s = this.$('.pl-skip');
    const on = label != null;
    s.classList.toggle('on', on);
    s.tabIndex = on ? 0 : -1;
    if (on) {
      const l = s.querySelector('.lbl') as HTMLElement;
      if (l.textContent !== label) l.textContent = label;
      s.style.setProperty('--w', `${(left * 100).toFixed(2)}%`);
    }
  }

  get skipVisible(): boolean { return this.$('.pl-skip').classList.contains('on'); }

  /* up next */
  private upSecs = 0;
  setUpNext(info: { id: string; title: string; sub: string; img?: string } | null, secsLeft: number, total: number, playing: boolean): void {
    const un = this.$('.pl-up');
    this.root.classList.toggle('has-up', !!info);
    if (!info) { un.classList.remove('on'); this.upBuilt = ''; return; }
    if (this.upBuilt !== info.id) {
      setHtml(un, html`<div class="row"><div class="th">${info.img ? raw(`<img src="${esc(info.img)}" alt="">`) : ''}</div>
        <div><p class="pl-k">Up next</p><h3>${info.title}</h3><p class="rt">${info.sub} · <span class="upc">Starts in ${Math.ceil(total)} s</span></p></div></div>
        <div class="acts"><button class="pl-btn primary grow" type="button" data-act="playnext"><span class="pl-ring"><svg class="ring" viewBox="0 0 28 28" aria-hidden="true"><circle class="bgc" cx="14" cy="14" r="12"/><circle class="fgc" cx="14" cy="14" r="12" pathLength="1"/></svg>${ic('play')}</span>Play now</button>
        <button class="pl-btn" type="button" data-act="credits">Watch credits</button></div>`);
      this.upBuilt = info.id;
      this.announce(`Up next: ${info.title}, in ${Math.ceil(total)} seconds`);
    }
    un.classList.add('on');
    (un.querySelector('.fgc') as SVGElement | null)?.style.setProperty('stroke-dashoffset', String(1 - clamp(secsLeft / total, 0, 1)));
    const secs = Math.ceil(secsLeft);
    const c = un.querySelector('.upc') as HTMLElement | null;
    if (c && this.upSecs !== secs + (playing ? 0 : 1000)) { this.upSecs = secs + (playing ? 0 : 1000); c.textContent = playing ? `Starts in ${secs} s` : 'Paused'; }
  }

  /* pause card */
  showPause(info: { title: string; meta: string; synopsis?: string }): void {
    const pc = this.$('.pl-pause');
    setHtml(pc, html`<p class="pl-k">Paused</p><h2>${info.title}</h2><p class="meta">${info.meta}</p>${info.synopsis ? html`<p class="syn">${info.synopsis}</p>` : ''}<p class="ends"></p>`);
    pc.classList.add('on'); this.pausedCard = true;
  }
  setEnds(text: ReturnType<typeof html>): void { if (this.pausedCard) setHtml(this.$('.pl-pause .ends'), text); }
  hidePause(): void { this.$('.pl-pause').classList.remove('on'); this.pausedCard = false; }
  get pauseVisible(): boolean { return this.pausedCard; }

  /* toasts */
  showResume(t: number): void {
    const r = this.$('.pl-toast.resume');
    setHtml(r, html`<span>Picked up at ${fmt(t)}</span><span class="dot" aria-hidden="true"></span><button type="button" data-act="startover">Start from the beginning</button>`);
    r.classList.add('on'); window.clearTimeout(this.resumeTimer);
    this.resumeTimer = window.setTimeout(() => r.classList.remove('on'), 6000);
  }
  hideResume(): void { this.$('.pl-toast.resume').classList.remove('on'); }

  showHintOnce(delay = 1400): void {
    if (TOUCHY() || store.get('player.hintSeen', false)) return;
    store.set('player.hintSeen', true);
    const h = this.$('.pl-toast.hint');
    setHtml(h, html`<span><kbd>Space</kbd>Pause</span><span class="dot" aria-hidden="true"></span><span><kbd>←</kbd><kbd>→</kbd>10 seconds</span><span class="dot" aria-hidden="true"></span><span><kbd>F</kbd>Full screen</span><span class="dot" aria-hidden="true"></span><span><kbd>C</kbd>Subtitles</span>`);
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => { h.classList.add('on'); this.hintTimer = window.setTimeout(() => h.classList.remove('on'), 6000); }, delay);
  }

  /** One calm line, e.g. "Converting for this browser". */
  note(text: string | null, ms = 7000): void {
    const n = this.$('.pl-toast.note');
    window.clearTimeout(this.noteTimer);
    if (!text) { n.classList.remove('on'); return; }
    n.textContent = text;
    n.classList.add('on');
    this.noteTimer = window.setTimeout(() => n.classList.remove('on'), ms);
  }

  /* end card + error panel */
  showEnd(info: { kicker: string; title: string; hasNext?: boolean } | null): void {
    const ec = this.$('.pl-end');
    this.ended = !!info;
    if (!info) { ec.classList.remove('on'); return; }
    setHtml(ec, html`<div><p class="pl-k">${info.kicker}</p><h2>${info.title}</h2><div class="acts">${info.hasNext ? html`<button class="pl-btn primary" type="button" data-act="playnext">${ic('skipnext')}Next episode</button>` : ''}<button class="pl-btn" type="button" data-act="again">${ic('restart')}Watch again</button><button class="pl-btn${info.hasNext ? '' : ' primary'}" type="button" data-act="back">${ic('back')}Back</button></div></div>`);
    ec.classList.add('on'); this.hidePause(); this.setUpNext(null, 0, 1, false);
    window.setTimeout(() => (ec.querySelector('.primary') as HTMLElement | null)?.focus({ preventScroll: true }), 50);
  }

  showError(info: { title: string; why: string; detail?: string; jellyfinUrl: string } | null): void {
    const er = this.$('.pl-error');
    this.errorOpen = !!info;
    this.root.classList.toggle('pl-failed', !!info);
    if (!info) { er.classList.remove('on'); return; }
    setHtml(er, html`<div><span class="warn">${ic('warn')}</span><h2>${info.title}</h2><p class="why">${info.why}</p>
      <div class="acts"><button class="pl-btn primary" type="button" data-act="retry">${ic('restart')}Try again</button>
      <a class="pl-btn" href="${info.jellyfinUrl}" target="_blank" rel="noopener">${ic('ext')}Open in Jellyfin</a>
      <button class="pl-btn" type="button" data-act="back">${ic('back')}Back</button></div>
      ${info.detail ? html`<details><summary>Details</summary><p class="detail">${info.detail}</p></details>` : ''}</div>`);
    er.classList.add('on'); this.setBusy(false); this.setUI(true); this.hidePause();
    window.setTimeout(() => (er.querySelector('.primary') as HTMLElement | null)?.focus({ preventScroll: true }), 50);
  }

  /* fullscreen */
  private readonly onFs = (): void => {
    const on = !!document.fullscreenElement;
    const b = this.$('.fsbtn');
    (b.querySelector('use') as SVGUseElement).setAttribute('href', on ? '#pl-unfull' : '#pl-full');
    b.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    b.dataset.tip = on ? 'Exit full screen (F)' : 'Full screen (F)';
  };

  /* ───────── settings sheet ───────── */
  private menus: Menus | null = null;

  setMenus(m: Menus): void {
    this.menus = m;
    const opt = (name: string, o: MenuChoice, cur: string): ReturnType<typeof html> =>
      html`<label class="pl-opt"><input type="radio" name="${name}" value="${o.value}" ${o.value === cur ? raw('checked') : ''}><span class="tx"><b>${o.label}</b>${o.hint ? html`<small>${o.hint}</small>` : ''}</span>${raw('<svg class="i ck" aria-hidden="true"><use href="#pl-check"/></svg>')}</label>`;
    const chip = (name: string, value: string, label: string, cur: string): ReturnType<typeof html> =>
      html`<label class="pl-chip"><input type="radio" name="${name}" value="${value}" ${value === cur ? raw('checked') : ''}><span>${label}</span></label>`;
    const keepOpen = this.root.querySelector('.pl-disc[open]') !== null;
    setHtml(this.$('#pl-pn-av'), html`<div class="pl-cols">
        <fieldset><legend>Language you hear</legend>${m.audio.length ? m.audio.map(o => opt('audio', o, m.audioNow)) : html`<p class="pl-note">This file has one soundtrack.</p>`}</fieldset>
        <fieldset><legend>Subtitles</legend>${m.subs.map(o => opt('sub', o, m.subsNow))}</fieldset>
      </div>
      <details class="pl-disc" ${keepOpen ? raw('open') : ''}><summary>How subtitles look ${ic('down')}</summary>
        <div class="inner">
          <div role="radiogroup" aria-label="Subtitle size"><span>Size</span><div class="pl-seg">${[[0.85, 'Smaller'], [1, 'Standard'], [1.25, 'Larger']].map(([v, l]) => chip('subsz', String(v), String(l), String(m.subSize)))}</div></div>
          <div role="radiogroup" aria-label="Subtitle background"><span>Background</span><div class="pl-seg">${chip('subbox', '0', 'Soft shadow', m.subBox ? '1' : '0')}${chip('subbox', '1', 'Dark box', m.subBox ? '1' : '0')}</div></div>
        </div>
      </details>`);
    setHtml(this.$('#pl-pn-sp'), html`<fieldset><legend>Playback speed</legend><div class="pl-seg">${m.speeds.map(o => chip('speed', o.value, o.label, m.speedNow))}</div></fieldset><p class="pl-note">Voices keep their natural pitch at every speed.</p>`);
    setHtml(this.$('#pl-pn-q'), html`${m.versions.length > 1 ? html`<fieldset style="margin-bottom:18px"><legend>Version</legend>${m.versions.map(o => opt('version', o, m.versionNow))}</fieldset>` : ''}
      <fieldset><legend>Quality</legend>${m.quality.map(o => opt('quality', o, m.qualityNow))}</fieldset><p class="pl-note">${m.qualityNote}</p>`);
  }

  private wireSheet(): void {
    const sheet = this.$('.pl-sheet');
    this.$('.pl-veil').addEventListener('click', () => this.closeSheet());
    sheet.addEventListener('change', e => {
      const t = e.target as HTMLInputElement;
      const kind = t.name === 'sub' || t.name === 'audio' || t.name === 'speed' || t.name === 'quality' || t.name === 'version' ? t.name : null;
      if (kind) { this.host.choose(kind, t.value); return; }
      if (t.name === 'subsz' || t.name === 'subbox') {
        const size = Number((sheet.querySelector('input[name="subsz"]:checked') as HTMLInputElement | null)?.value ?? 1);
        const box = (sheet.querySelector('input[name="subbox"]:checked') as HTMLInputElement | null)?.value === '1';
        this.host.subStyle(size, box);
      }
    });
    const tabs = Array.from(sheet.querySelectorAll<HTMLElement>('.pl-tab'));
    const select = (id: string, focus = false): void => {
      for (const t of tabs) {
        const on = t.id === id;
        t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
        (this.root.querySelector(`#${t.getAttribute('aria-controls')}`) as HTMLElement).hidden = !on;
      }
      if (focus) (this.root.querySelector(`#${id}`) as HTMLElement).focus();
    };
    this.selectTab = select;
    sheet.querySelector('.pl-tabs')?.addEventListener('click', e => { const t = (e.target as Element).closest<HTMLElement>('.pl-tab'); if (t) select(t.id); });
    sheet.querySelector('.pl-tabs')?.addEventListener('keydown', e => {
      const ev = e as KeyboardEvent;
      const i = tabs.indexOf(document.activeElement as HTMLElement); if (i < 0) return;
      let j: number | null = null;
      if (ev.key === 'ArrowRight') j = (i + 1) % tabs.length;
      if (ev.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
      if (ev.key === 'Home') j = 0;
      if (ev.key === 'End') j = tabs.length - 1;
      if (j !== null) { ev.preventDefault(); select((tabs[j] as HTMLElement).id, true); }
    });
    sheet.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeSheet(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(sheet.querySelectorAll<HTMLInputElement | HTMLElement>('button, summary, input')).filter(x => x.getClientRects().length && !(x as HTMLInputElement).disabled && ((x as HTMLInputElement).type !== 'radio' || (x as HTMLInputElement).checked));
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); (f.at(-1) as HTMLElement).focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); (f[0] as HTMLElement).focus(); }
    });
  }

  private selectTab: (id: string, focus?: boolean) => void = () => undefined;

  get isSheetOpen(): boolean { return this.sheetOpen; }

  openSheet(tab?: 'av' | 'sp' | 'q'): void {
    if (this.sheetOpen) return;
    const sheet = this.$('.pl-sheet');
    this.sheetOpener = document.activeElement;
    this.hideResume();
    if (tab) this.selectTab(`pl-tab-${tab}`);
    sheet.hidden = false;
    requestAnimationFrame(() => { sheet.classList.add('on'); this.$('.pl-veil').classList.add('on'); });
    this.sheetOpen = true;
    this.$('.morebtn').setAttribute('aria-expanded', 'true');
    this.wake();
    window.setTimeout(() => (sheet.querySelector('.pl-tab[aria-selected="true"]') as HTMLElement).focus({ preventScroll: true }), 30);
  }

  closeSheet(): void {
    if (!this.sheetOpen) return;
    const sheet = this.$('.pl-sheet');
    sheet.classList.remove('on'); this.$('.pl-veil').classList.remove('on');
    this.sheetOpen = false;
    this.$('.morebtn').setAttribute('aria-expanded', 'false');
    window.setTimeout(() => { if (!this.sheetOpen) sheet.hidden = true; }, RM() ? 180 : 320);
    ((this.sheetOpener && document.contains(this.sheetOpener) ? this.sheetOpener : this.$('.morebtn')) as HTMLElement).focus({ preventScroll: true });
    this.wake();
  }

  /** Facts the keyboard handler needs. */
  focusFacts(): { onControl: boolean; onSlider: boolean } {
    const a = document.activeElement as HTMLElement | null;
    const tag = a?.tagName;
    return { onControl: tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY', onSlider: a?.getAttribute('role') === 'slider' || (a as HTMLInputElement | null)?.type === 'range' };
  }

  get pipButton(): HTMLElement { return this.$('.pipbtn'); }
  get fsTarget(): HTMLElement { return this.root; }
  hide(): void { window.clearTimeout(this.hideTimer); this.setUI(false); }
  get controlsVisible(): boolean { return this.uiOn; }
}
