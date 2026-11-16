/**
 * Player page: #/watch/:id?t=<seconds>&audio=<stream>&sub=<stream|-1>&version=<source id>. The shell is hidden (chrome: none).
 * This module is the conductor: it asks the server how to play (playback.ts), attaches the stream (direct, or HLS via hls.ts), keeps
 * the chrome (controls.ts) painted, switches tracks (subs.ts), skips (segments.ts), previews (trickplay.ts), reports (report.ts).
 */
import { imageUrl } from '../../api';
import { ApiError } from '../../api/http';
import { trickplayUrl } from '../../api/playback';
import type { Backend } from '../../api/backend';
import type { Episode, MediaItem, MediaSegment, PlaybackInfo, PlaybackReport, TrickplayInfo } from '../../api/types';
import { clock } from '../../lib/format';
import { html } from '../../lib/html';
import { store } from '../../lib/storage';
import type { Page, PageContext } from '../types';
import './watch.css';
import { PlayerUI, type Menus, type PeekInfo } from './controls';
import { startHls, type HlsHandle } from './hls';
import { keyAction, percentOf, SPEEDS, stepSpeed } from './keys';
import { conversionNote, jellyfinWebUrl, mediaErrorText, openSession, playMethodOf, startingTracks, startSeconds, type SessionChoice } from './playback';
import type { Quality } from './profile';
import { Reporter } from './report';
import { creditsStart, segmentAt, segmentLeft, skipLabel, skipTarget } from './segments';
import { DEFAULT_SUBSTYLE, friendlyLabel, initialSubtitle, subtitleChoices, subtitleHint, subtitleSwitch, TrackManager, type SubStyle } from './subs';
import { chapterAt, chapterTicks, preloadSheets, tileAt, tileStyle } from './trickplay';
import { clamp, leftText, parseTime, spoken } from './timefmt';

const UPNEXT_SECS = 12;
const QUALITY_LABEL: Record<Quality, { label: string; hint: string }> = {
  auto: { label: 'Best for this screen', hint: 'Recommended. Plays as it is when it can' },
  original: { label: 'Original quality', hint: 'Uses the most data' },
  saver: { label: 'Data saver', hint: 'About 720p. Good on slow Wi-Fi or mobile data' },
};

class Player {
  readonly ui: PlayerUI;
  private readonly video: HTMLVideoElement;
  private readonly tracks: TrackManager;
  private item: MediaItem | null = null;
  private info: PlaybackInfo | null = null;
  private hls: HlsHandle | null = null;
  private reporter: Reporter | null = null;
  private segments: MediaSegment[] = [];
  private next: Episode | null = null;
  private trickplay: TrickplayInfo | null = null;
  private choice: SessionChoice;
  private subStyle: SubStyle;
  private id: string;
  private generation = 0;
  private startAt = 0;
  private reachedPlaying = false;
  private triedConverted = false;
  private lastSubOn = -1;
  private upDismissed = false;
  private upLeft = UPNEXT_SECS;
  private upStamp = 0;
  private ended = false;
  private creditsAt = Infinity;
  private pauseTimer: number | undefined;
  private lastPaint = 0;
  private raf = 0;
  private disposed = false;
  private readonly off: Array<() => void> = [];

  constructor(private readonly ctx: PageContext, private readonly backend: Backend) {
    this.id = ctx.params.id ?? '';
    const q = ctx.query;
    const num = (k: string): number | undefined => { const v = q.get(k); return v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined; };
    this.choice = {
      version: q.get('version') || undefined,
      audio: num('audio'),
      sub: num('sub') ?? -1,
      quality: store.get<Quality>('player.quality', 'auto'),
      start: 0,
    };
    this.subStyle = { ...DEFAULT_SUBSTYLE, ...store.get<Partial<SubStyle>>('player.subStyle', {}) };
    this.ui = new PlayerUI({
      toggle: () => this.toggle(), seekBy: (d, how) => this.seekBy(d, how), seekTo: t => this.seekTo(t), mute: () => this.toggleMute(),
      setVolume: v => this.setVolume(v), skip: () => this.skip(), next: () => this.playNext(), watchCredits: () => this.watchCredits(),
      pip: () => void this.togglePip(), fullscreen: () => void this.toggleFullscreen(), back: () => this.goBack(),
      choose: (k, v) => void this.choose(k, v), subStyle: (s, b) => this.setSubStyle(s, b), retry: () => void this.retry(),
      startOver: () => { this.seekTo(0); this.ui.hideResume(); this.ui.announce('Starting from the beginning'); },
      again: () => { this.ui.showEnd(null); this.ended = false; this.upDismissed = false; this.seekTo(0); void this.video.play().catch(() => undefined); },
      peek: t => this.peekFor(t), duration: () => this.duration,
    });
    this.video = this.ui.video;
    this.tracks = new TrackManager(this.video, text => this.ui.setCue(text));
    this.ui.setSubStyle(this.subStyle.size, this.subStyle.box);
    this.video.volume = clamp(store.get<number>('player.volume', 0.8), 0, 1);
    this.video.muted = store.get<boolean>('player.muted', false);
    this.video.playbackRate = clamp(store.get<number>('player.speed', 1), 0.25, 4);
    this.ui.paintVolume(this.video.volume, this.video.muted);
    if (!document.pictureInPictureEnabled) this.ui.pipButton.hidden = true;
    this.bindVideo();
    this.bindGlobal();
  }

  /* ───────── helpers ───────── */
  private get duration(): number { const d = this.video.duration; return Number.isFinite(d) && d > 0 ? d : (this.item?.runtimeMin ?? 0) * 60; }
  private get position(): number { return this.video.currentTime || 0; }
  private get token(): string { return this.backend.mediaAuth().token; }
  private on<K extends keyof HTMLVideoElementEventMap>(k: K, fn: (e: HTMLVideoElementEventMap[K]) => void): void {
    this.video.addEventListener(k, fn);
    this.off.push(() => this.video.removeEventListener(k, fn));
  }
  private listen<K extends keyof DocumentEventMap>(t: Document, k: K, fn: (e: DocumentEventMap[K]) => void): void { t.addEventListener(k, fn); this.off.push(() => t.removeEventListener(k, fn)); }

  private snapshot(): PlaybackReport {
    const info = this.info;
    return {
      itemId: this.id, mediaSourceId: info?.mediaSourceId ?? '', playSessionId: info?.playSessionId,
      positionTicks: (this.ended ? this.duration : this.position) * 1e7, isPaused: this.video.paused,
      audioStreamIndex: info?.audioStreamIndex, subtitleStreamIndex: this.choice.sub >= 0 ? this.choice.sub : undefined,
      playMethod: info ? playMethodOf(info) : undefined, volume: this.video.volume * 100, isMuted: this.video.muted,
    };
  }

  /* ───────── start / load ───────── */
  async start(): Promise<void> {
    const my = ++this.generation;
    this.ui.setBusy(true);
    this.ui.showError(null); this.ui.showEnd(null);
    try {
      this.item = await this.backend.item(this.id);
    } catch (e) {
      if (my !== this.generation || this.disposed) return;
      this.fail(e instanceof ApiError && e.kind === 'not-found' ? 'We could not find this title.' : 'We could not reach the server.', undefined, e);
      return;
    }
    if (my !== this.generation || this.disposed) return;
    const item = this.item;
    this.paintMeta(item);
    this.ctx.shell.setTitle(item.kind === 'episode' ? `${item.seriesName} S${item.season}E${item.episode}` : item.name);
    const t = parseTime(this.ctx.query.get('t'));
    this.startAt = startSeconds(t, item);
    const picks = startingTracks(item, this.choice.version, this.choice.audio, this.choice.sub);
    this.choice = { ...this.choice, audio: picks.audio, sub: picks.sub, start: this.startAt };
    this.lastSubOn = picks.sub;
    this.ui.setHasNext(false);
    this.trickplay = null;
    this.next = null;
    this.segments = [];
    this.ui.setTicks([]);
    void this.loadSidecars(item, my);
    await this.load(this.startAt, my);
    if (this.startAt > 30 && !this.ended) this.ui.showResume(this.startAt);
  }

  /** Markers, next episode: nice to have, never block playback. */
  private async loadSidecars(item: MediaItem, my: number): Promise<void> {
    const seg = this.backend.segments(item.id, this.ctx.signal).then(s => { if (my === this.generation) { this.segments = s; this.creditsAt = creditsStart(s, this.duration); } });
    const nxt = item.kind === 'episode' ? this.backend.episodes(item.seriesId).then(eps => {
      if (my !== this.generation) return;
      const sorted = [...eps].filter(e => !e.missing).sort((a, b) => a.season - b.season || a.episode - b.episode);
      const i = sorted.findIndex(e => e.id === item.id);
      this.next = i >= 0 ? sorted[i + 1] ?? null : null;
      this.ui.setHasNext(!!this.next);
    }).catch(() => undefined) : Promise.resolve();
    await Promise.all([seg, nxt]);
  }

  private async load(at: number, my = this.generation): Promise<void> {
    const item = this.item;
    if (!item) return;
    this.ui.setBusy(true);
    this.ui.showError(null);
    this.reachedPlaying = false;
    await this.teardown(false);
    let info: PlaybackInfo;
    try {
      info = await openSession(this.backend, this.id, { ...this.choice, start: at }, item);
    } catch (e) {
      if (my !== this.generation || this.disposed) return;
      this.fail(e instanceof ApiError && e.kind === 'not-found' ? 'This title has no file that can be played.' : e instanceof ApiError && e.kind === 'network' ? 'We could not reach the server.' : 'The server could not prepare this video.', undefined, e);
      return;
    }
    if (my !== this.generation || this.disposed) return;
    if (info.method === 'unavailable' || !info.url) { this.fail('This file cannot be played in this browser, and the server could not convert it.', undefined, new Error('PlaybackInfo: no usable stream')); return; }
    this.info = info;
    this.choice.version = info.mediaSourceId;
    this.choice.audio = info.audioStreamIndex ?? this.choice.audio;
    this.trickplay = item.trickplay?.[info.mediaSourceId] ?? Object.values(item.trickplay ?? {})[0] ?? null;
    this.ui.setTicks(chapterTicks(item.chapters ?? [], this.duration));
    if (this.trickplay) preloadSheets([trickplayUrl(item.id, info.mediaSourceId, this.trickplay.width, 0, this.token)]);
    this.ui.note(conversionNote(info));
    this.paintMenus();
    this.reporter = new Reporter({ backend: this.backend, snapshot: () => this.snapshot() });
    // subtitles: a text track now, or burned into the picture by the server
    if (info.subtitleBurnedIn) this.tracks.clear(); else this.tracks.show(item.id, info.version, this.choice.sub, this.token);
    await this.attach(info, at, my);
  }

  private async attach(info: PlaybackInfo, at: number, my: number): Promise<void> {
    const v = this.video;
    const ready = (): void => {
      if (my !== this.generation) return;
      this.paintAll(true);
      v.playbackRate = clamp(store.get<number>('player.speed', 1), 0.25, 4);
      void v.play().catch((e: unknown) => {
        // the browser blocks sound before the first tap on a freshly opened tab: wait for a press instead of failing
        if (e instanceof DOMException && e.name === 'NotAllowedError') { this.ui.setBusy(false); this.ui.setPlaying(false, true); this.showPauseSoon(); }
      });
    };
    if (info.isHls) {
      this.hls = await startHls({
        url: info.url, video: v, startSeconds: at, authHeader: this.backend.mediaAuth().header,
        onFatal: msg => { if (my === this.generation) this.fail(msg, info, new Error(msg)); },
        onReady: ready,
      });
    } else {
      v.src = info.url;
      const onMeta = (): void => { if (at > 0.5 && Math.abs(v.currentTime - at) > 1) v.currentTime = at; ready(); };
      v.addEventListener('loadedmetadata', onMeta, { once: true });
    }
  }

  /** Stop what is playing now. `final`: the whole page is closing (report Stopped). */
  private async teardown(final: boolean, unload = false): Promise<void> {
    const old = this.info; const reporter = this.reporter;
    this.hls?.destroy(); this.hls = null;
    this.tracks.clear();
    if (final || old) { /* detach below */ }
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    if (reporter) {
      // the position is read before the source is gone
      this.reporter = null;
      await reporter.stop({ unload, positionTicks: this.stoppedTicks });
    } else if (old?.playSessionId && old.method !== 'direct') {
      void this.backend.stopTranscode(old.playSessionId, { unload });
    }
    this.info = null;
  }

  private stoppedTicks = 0;
  private rememberPosition(): void { this.stoppedTicks = Math.round((this.ended ? this.duration : this.position) * 1e7); }

  /** Everything the page does when it closes. */
  async dispose(unload = false): Promise<void> {
    if (this.disposed) return;
    this.rememberPosition();
    this.disposed = true;
    this.generation++;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.pauseTimer);
    for (const f of this.off.splice(0)) f();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if (document.pictureInPictureElement === this.video) void document.exitPictureInPicture().catch(() => undefined);
    this.ui.destroy();
    document.documentElement.classList.remove('pl-lock');
    await this.teardown(true, unload);
  }

  /* ───────── video events ───────── */
  private bindVideo(): void {
    this.on('playing', () => {
      this.ui.setBusy(false); this.ui.setPlaying(true, !this.reachedPlaying);
      if (!this.reachedPlaying) { this.reachedPlaying = true; this.reporter?.start(); this.ui.showHintOnce(this.startAt > 30 ? 6800 : 1400); }
      else this.reporter?.event('play');
      this.upStamp = performance.now();
      this.startLoop();
    });
    this.on('pause', () => {
      if (this.video.ended || this.disposed || !this.reachedPlaying) return;
      this.ui.setPlaying(false); this.reporter?.event('pause'); this.showPauseSoon(); this.paintAll(true);
    });
    this.on('waiting', () => this.ui.setBusy(true));
    this.on('canplay', () => this.ui.setBusy(false));
    this.on('seeked', () => { this.ui.setBusy(false); this.reporter?.event('seek'); this.paintAll(true); });
    this.on('seeking', () => this.paintAll(true));
    this.on('timeupdate', () => this.paintAll());
    this.on('progress', () => this.paintAll());
    this.on('durationchange', () => { this.creditsAt = creditsStart(this.segments, this.duration); this.ui.setTicks(chapterTicks(this.item?.chapters ?? [], this.duration)); this.paintAll(true); });
    this.on('ended', () => this.finish());
    this.on('volumechange', () => { store.set('player.volume', this.video.volume); store.set('player.muted', this.video.muted); this.ui.paintVolume(this.video.volume, this.video.muted); });
    this.on('ratechange', () => { if (this.video.playbackRate !== 1 || store.has('player.speed')) store.set('player.speed', this.video.playbackRate); this.paintMenus(); });
    this.on('error', () => void this.onVideoError());
  }

  private bindGlobal(): void {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement | null)?.closest?.('input[type="text"], textarea')) return;
      const facts = this.ui.focusFacts();
      const a = keyAction({ key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, sheetOpen: this.ui.isSheetOpen, ...facts });
      if (!a) { if (e.key === 'Tab') this.ui.wake(); return; }
      if (a === 'escape') {
        if (this.ui.isSheetOpen) { this.ui.closeSheet(); e.preventDefault(); } else if (document.fullscreenElement) { /* the browser leaves full screen itself */ } else if (this.ui.controlsVisible && !this.video.paused) { this.ui.hide(); e.preventDefault(); }
        return;
      }
      e.preventDefault();
      const pct = percentOf(a);
      if (pct != null) { this.seekTo(this.duration * pct / 100); this.ui.wake(); return; }
      switch (a) {
        case 'toggle': this.toggle(); break;
        case 'back10': this.seekBy(-10, 'key'); break;
        case 'fwd10': this.seekBy(10, 'key'); break;
        case 'volUp': this.setVolume(this.video.volume + 0.1, true); break;
        case 'volDown': this.setVolume(this.video.volume - 0.1, true); break;
        case 'fullscreen': void this.toggleFullscreen(); break;
        case 'mute': this.toggleMute(); break;
        case 'subtitles': this.toggleSubs(); break;
        case 'skip': this.skip(); break;
        case 'next': if (this.next) this.playNext(); break;
        case 'pip': void this.togglePip(); break;
        case 'speedUp': case 'speedDown': { const s = stepSpeed(this.video.playbackRate, a === 'speedUp' ? 1 : -1); this.video.playbackRate = s; this.ui.flash('ff', `${s}×`); this.ui.announce(`Speed ${s}`); break; }
        case 'chapterPrev': case 'chapterNext': this.chapterStep(a === 'chapterNext' ? 1 : -1); break;
      }
      this.ui.wake();
    };
    this.listen(document, 'keydown', onKey);
    const closing = (): void => { this.rememberPosition(); void this.reporter?.stop({ unload: true, positionTicks: this.stoppedTicks }); if (this.info?.playSessionId && this.info.method !== 'direct') void this.backend.stopTranscode(this.info.playSessionId, { unload: true }); };
    window.addEventListener('pagehide', closing);
    this.off.push(() => window.removeEventListener('pagehide', closing));
    window.addEventListener('beforeunload', closing);
    this.off.push(() => window.removeEventListener('beforeunload', closing));
  }

  /* ───────── painting ───────── */
  private startLoop(): void {
    cancelAnimationFrame(this.raf);
    const step = (now: number): void => {
      if (this.disposed || this.video.paused) return;
      if (now - this.lastPaint > 90) { this.lastPaint = now; this.paintAll(); }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private bufferedEnd(): number {
    const b = this.video.buffered; const t = this.position;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i);
    return t;
  }

  private paintAll(force = false): void {
    if (this.disposed) return;
    if (!force && performance.now() - this.lastPaint < 60 && !this.video.paused) return;
    this.lastPaint = performance.now();
    const t = this.position, d = this.duration;
    if (!this.ui.isScrubbing) this.ui.paintTime(t, d, this.bufferedEnd());
    this.ui.setCredits(t >= this.creditsAt && !this.ended);
    // skip intro / recap / credits
    const seg = segmentAt(this.segments, t);
    // "Skip credits" and the Up next card would sit on top of each other: the card wins while it is showing
    const hide = !seg || this.ended || (seg.type === 'Outro' && this.upNextActive());
    this.ui.setSkip(hide || !seg ? null : skipLabel(seg.type), seg ? segmentLeft(seg, t) : 1);
    this.paintUpNext();
    if (this.ui.pauseVisible) this.paintEnds();
  }

  private paintMeta(item: MediaItem): void {
    if (item.kind === 'episode') this.ui.setMeta(item.seriesName, item.name, `S${item.season} · E${item.episode}`);
    else this.ui.setMeta(item.name, '', [item.kind === 'movie' ? item.year : '', item.certification].filter(Boolean).join(' · '));
  }

  private upNextActive(): boolean {
    return !!this.next && this.position >= this.creditsAt && !this.upDismissed && !this.ended && this.duration > 0;
  }

  private paintUpNext(): void {
    const n = this.next;
    const show = this.upNextActive();
    if (!show || !n) { this.ui.setUpNext(null, 0, UPNEXT_SECS, false); this.upLeft = UPNEXT_SECS; return; }
    const now = performance.now();
    if (!this.video.paused) this.upLeft = Math.max(0, this.upLeft - (now - this.upStamp) / 1000);
    this.upStamp = now;
    this.ui.setUpNext({
      id: n.id, title: `E${n.episode} · ${n.name}`, sub: n.runtimeMin ? `${n.runtimeMin} min` : `Season ${n.season}`,
      img: n.imageTags.primary ? imageUrl(n.id, 'Primary', { maxWidth: 480, tag: n.imageTags.primary }) : undefined,
    }, this.upLeft, UPNEXT_SECS, !this.video.paused);
    if (this.upLeft <= 0 && !this.video.paused) { this.upDismissed = true; this.playNext(); }
  }

  private showPauseSoon(): void {
    window.clearTimeout(this.pauseTimer);
    this.pauseTimer = window.setTimeout(() => {
      const it = this.item; if (!it || !this.video.paused || this.ended) return;
      const ep = it.kind === 'episode';
      this.ui.showPause({
        title: it.name,
        meta: ep ? `${it.seriesName} · Season ${it.season}, Episode ${it.episode}` : [it.kind === 'movie' ? it.year : '', it.certification, it.runtimeMin ? leftText(it.runtimeMin * 60) : ''].filter(Boolean).join(' · '),
        synopsis: it.overview,
      });
      this.paintEnds();
    }, 500);
  }

  private paintEnds(): void {
    const left = (this.duration - this.position) / (this.video.playbackRate || 1);
    this.ui.setEnds(html`<b>${leftText(left)}</b> left · Ends at <b>${clock(new Date(Date.now() + left * 1000))}</b>`);
  }

  private paintMenus(): void {
    const item = this.item; const info = this.info; if (!item) return;
    const v = info?.version ?? item.versions?.[0];
    const versions = (info?.versions?.length ? info.versions : item.versions ?? []);
    const m: Menus = {
      audio: (v?.audio ?? []).map(a => ({ value: String(a.index), label: friendlyLabel(a.label) })),
      audioNow: String(this.choice.audio ?? ''),
      subs: [{ value: '-1', label: 'Off' }, ...subtitleChoices(v).map(s => ({ value: String(s.index), label: friendlyLabel(s.label), hint: subtitleHint(s) }))],
      subsNow: String(this.choice.sub),
      speeds: SPEEDS.map(s => ({ value: String(s), label: s === 1 ? 'Normal' : `${s}×` })),
      speedNow: String(this.video.playbackRate),
      quality: (Object.keys(QUALITY_LABEL) as Quality[]).map(q => ({ value: q, label: QUALITY_LABEL[q].label, hint: QUALITY_LABEL[q].hint })),
      qualityNow: this.choice.quality,
      qualityNote: info && info.method !== 'direct' ? (conversionNote(info) ?? 'The server is preparing this for your browser.') : 'Playing straight from the server, nothing is being converted.',
      versions: versions.map(x => ({ value: x.id, label: x.name.replace(/\.[a-z0-9]{2,4}$/i, '') || `${x.height ?? ''}p`, hint: [x.height ? `${x.height}p` : '', x.videoCodec?.toUpperCase()].filter(Boolean).join(' · ') })),
      versionNow: this.choice.version ?? '',
      subSize: this.subStyle.size, subBox: this.subStyle.box,
    };
    this.ui.setMenus(m);
  }

  /* ───────── actions ───────── */
  private toggle(): void {
    if (this.ended) { this.ui.showEnd(null); this.ended = false; this.seekTo(0); }
    if (this.video.paused) void this.video.play().catch(() => undefined); else this.video.pause();
  }

  private seekTo(t: number): void {
    const d = this.duration;
    this.video.currentTime = clamp(t, 0, d > 0 ? d - 0.5 : t);
    if (this.ended) { this.ended = false; this.ui.showEnd(null); }
    if (this.video.currentTime < this.creditsAt - 1) { this.upDismissed = false; this.upLeft = UPNEXT_SECS; }
    this.paintAll(true);
    this.ui.announce(spoken(this.video.currentTime));
  }

  private seekBy(d: number, how?: 'tap' | 'key'): void {
    this.seekTo(this.position + d);
    if (how !== 'tap') this.ui.flash(d < 0 ? 'rw' : 'ff', `${Math.abs(d)} seconds`);
    this.ui.wake();
  }

  private chapterStep(dir: 1 | -1): void {
    const ch = this.item?.chapters ?? []; if (!ch.length) return;
    const i = chapterAt(ch, this.position);
    const target = dir > 0 ? ch[i + 1] : (this.position - (ch[i]?.startTicks ?? 0) / 1e7 > 3 ? ch[i] : ch[i - 1]);
    if (target) this.seekTo(target.startTicks / 1e7);
  }

  private setVolume(v: number, show = false): void {
    const nv = clamp(Math.round(v * 10) / 10, 0, 1);
    this.video.volume = nv; this.video.muted = nv === 0;
    if (show) this.ui.flash(nv === 0 ? 'mute' : nv < 0.5 ? 'vollow' : 'vol', nv === 0 ? 'Muted' : `${Math.round(nv * 100)}%`);
  }

  private toggleMute(): void {
    this.video.muted = !this.video.muted;
    if (!this.video.muted && this.video.volume === 0) this.video.volume = 0.6;
    this.ui.flash(this.video.muted ? 'mute' : 'vol', this.video.muted ? 'Muted' : 'Sound on');
    this.ui.announce(this.video.muted ? 'Muted' : 'Sound on');
  }

  private skip(): void {
    const seg = segmentAt(this.segments, this.position); if (!seg) return;
    this.seekTo(skipTarget(seg, this.duration));
    this.ui.announce(`${skipLabel(seg.type).replace('Skip', 'Skipped')}`);
  }

  private watchCredits(): void { this.upDismissed = true; this.ui.setUpNext(null, 0, UPNEXT_SECS, false); this.ui.announce('Watching the credits'); }

  private toggleSubs(): void {
    const v = this.info?.version ?? this.item?.versions?.[0];
    if (!v?.subtitles.length) { this.ui.flash('cc', 'No subtitles in this file'); return; }
    if (this.choice.sub >= 0) { void this.choose('sub', '-1'); return; }
    const pick = this.lastSubOn >= 0 && v.subtitles.some(s => s.index === this.lastSubOn) ? this.lastSubOn : (subtitleChoices(v)[0]?.index ?? -1);
    void this.choose('sub', String(pick));
  }

  private setSubStyle(size: number, box: boolean): void {
    this.subStyle = { size, box };
    store.set('player.subStyle', this.subStyle);
    this.ui.setSubStyle(size, box);
  }

  private async choose(kind: 'audio' | 'sub' | 'speed' | 'quality' | 'version', value: string): Promise<void> {
    const v = this.info?.version ?? this.item?.versions?.[0];
    if (kind === 'speed') { this.video.playbackRate = Number(value); this.ui.announce(`Speed ${value === '1' ? 'normal' : `${value} times`}`); return; }
    const at = this.position;
    if (kind === 'sub' && v) {
      const next = Number(value);
      const how = subtitleSwitch(v, this.choice.sub, next, !!this.info?.subtitleBurnedIn);
      if (how === 'none') return;
      this.choice.sub = next; if (next >= 0) this.lastSubOn = next;
      const label = next < 0 ? 'Off' : (v.subtitles.find(s => s.index === next)?.label ?? 'On');
      this.ui.announce(`Subtitles: ${label}`); this.ui.flash('cc', next < 0 ? 'Subtitles off' : `Subtitles: ${label}`);
      if (how === 'track' && this.item) { this.tracks.show(this.item.id, v, next, this.token); this.paintMenus(); }
      else await this.reload(at);
      return;
    }
    if (kind === 'audio') {
      const next = Number(value);
      if (next === this.choice.audio) return;
      this.choice.audio = next;
      this.ui.announce(`Now hearing ${v?.audio.find(a => a.index === next)?.label ?? 'another track'}`);
      await this.reload(at);
      return;
    }
    if (kind === 'quality') {
      if (value === this.choice.quality) return;
      this.choice.quality = value as Quality; store.set('player.quality', value);
      await this.reload(at);
      return;
    }
    if (kind === 'version') {
      if (value === this.choice.version) return;
      const nv = (this.info?.versions ?? this.item?.versions ?? []).find(x => x.id === value);
      this.choice.version = value;
      this.choice.audio = nv ? (nv.audio.find(a => a.isDefault) ?? nv.audio[0])?.index : undefined;
      this.choice.sub = nv ? initialSubtitle(nv, this.choice.sub) : -1;
      await this.reload(at);
    }
  }

  /** A new session at the same place (sound, quality, version or picture subtitles changed). */
  private async reload(at: number): Promise<void> {
    const wasPaused = this.video.paused;
    this.upDismissed = this.upDismissed && at >= this.creditsAt;
    this.generation++;
    await this.load(at, this.generation);
    if (wasPaused) this.video.pause();
  }

  private async retry(): Promise<void> {
    this.triedConverted = false;
    this.ui.showError(null);
    if (!this.item) { await this.start(); return; }
    this.generation++;
    await this.load(this.position > 5 ? this.position : this.startAt, this.generation);
  }

  private async onVideoError(): Promise<void> {
    if (this.disposed || !this.video.src && !this.hls) return;
    const code = this.video.error?.code;
    const info = this.info;
    // the file could not be played as it is: let the server convert it, once
    if (info?.method === 'direct' && !this.triedConverted) {
      this.triedConverted = true;
      this.choice.noDirectPlay = true;
      this.generation++;
      await this.load(this.position > 1 ? this.position : this.startAt, this.generation);
      return;
    }
    this.fail(mediaErrorText(code), info ?? undefined, new Error(`MediaError ${code ?? '?'} ${this.video.error?.message ?? ''}`));
  }

  private fail(why: string, info?: PlaybackInfo, err?: unknown): void {
    console.error('player:', why, err);
    const detail = err instanceof Error ? err.message : undefined;
    this.ui.showError({ title: 'This will not play', why, detail: detail && /MediaError|PlaybackInfo|failed/i.test(detail) ? detail : undefined, jellyfinUrl: jellyfinWebUrl(this.id) });
    void info;
  }

  private finish(): void {
    this.ended = true;
    this.ui.setPlaying(false, true);
    this.reporter?.event('pause');
    if (this.next && !this.upDismissed) { this.playNext(); return; }
    const it = this.item;
    this.ui.showEnd({
      kicker: it?.kind === 'episode' ? "You're all caught up" : 'The end',
      title: it?.kind === 'episode' ? `${it.seriesName}, season ${it.season}` : it?.name ?? '',
      hasNext: !!this.next,
    });
  }

  /** In place, so full screen survives: report this one finished, then start the next. */
  private playNext(): void {
    const n = this.next; if (!n) return;
    this.upDismissed = true;
    this.ui.setUpNext(null, 0, UPNEXT_SECS, false);
    this.ui.announce(`Now playing episode ${n.episode}, ${n.name}`);
    this.rememberPosition();
    const old = this.reporter; this.reporter = null;
    const finished = this.stoppedTicks;
    void old?.stop({ positionTicks: finished });
    this.generation++;
    this.id = n.id; this.item = null; this.info = null; this.ended = false; this.upDismissed = false; this.upLeft = UPNEXT_SECS; this.creditsAt = Infinity;
    this.choice = { ...this.choice, version: undefined, audio: undefined, sub: -1, noDirectPlay: undefined };
    this.triedConverted = false;
    this.video.pause();
    try { history.replaceState(null, '', `#/watch/${encodeURIComponent(n.id)}`); } catch { /* the address bar is cosmetic */ }
    this.ctx.query.delete('t');
    void this.start();
  }

  private goBack(): void {
    const it = this.item;
    if (history.length > 1) this.ctx.router.back();
    else this.ctx.router.navigate(it ? `/title/${it.kind === 'episode' ? it.seriesId : it.id}` : '/');
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.ui.fsTarget.requestFullscreen();
    } catch { this.ui.flash('full', 'Full screen is not available here'); }
  }

  private async togglePip(): Promise<void> {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await this.video.requestPictureInPicture();
    } catch { this.ui.flash('pip', 'Small window is not available here'); }
  }

  /* ───────── seek-bar preview ───────── */
  private peekFor(t: number): PeekInfo {
    const out: PeekInfo = {};
    const ch = this.item?.chapters ?? [];
    const ci = chapterAt(ch, t);
    if (ci >= 0 && ch[ci]) out.chapter = ch[ci]?.name;
    const tp = this.trickplay; const info = this.info; const item = this.item;
    if (tp && info && item) {
      const tile = tileAt(tp, t);
      const url = trickplayUrl(item.id, info.mediaSourceId, tp.width, tile.sheet, this.token);
      out.style = tileStyle(tp, tile, url, 192) as unknown as Partial<CSSStyleDeclaration>;
      out.aspect = tp.width / tp.height;
      const sheets = Math.ceil(tp.thumbnailCount / (tp.tileWidth * tp.tileHeight));
      preloadSheets([tile.sheet + 1, tile.sheet - 1].filter(s => s >= 0 && s < sheets).map(s => trickplayUrl(item.id, info.mediaSourceId, tp.width, s, this.token)));
    }
    return out;
  }
}

const page: Page = {
  title: 'Watch',
  render(ctx) {
    const player = new Player(ctx, ctx.backend);
    document.documentElement.classList.add('pl-lock');
    ctx.onDispose(() => { void player.dispose(); });
    // start once the element is on the page (a <video> only plays when attached)
    const go = (): void => { if (player.ui.root.isConnected) void player.start(); else requestAnimationFrame(go); };
    queueMicrotask(go);
    return player.ui.root;
  },
};
export default page;
