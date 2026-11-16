/** Login: opaque page, moving artwork, username + password, Quick Connect as the second way in. */
import './login.css';
import { imageUrl, SignInError, type SignInFailure } from '../../api';
import { html, raw, setHtml } from '../../lib/html';
import { store } from '../../lib/storage';
import type { Page, PageContext } from '../types';
import { ARTWORK } from './artwork';

/** Plain-language message for each failure (exported for tests). */
export function friendlyError(reason: SignInFailure): string {
  switch (reason) {
    case 'bad-credentials': return 'That username or password is not right. Check them and try again.';
    case 'unreachable': return 'Cannot reach the server right now. Check your connection and try again in a minute.';
    case 'server-error': return 'The server had a problem. Please try again in a moment.';
    default: return 'Something went wrong. Please try again.';
  }
}

const COLUMNS = 7;
const PER_COLUMN = 8;

function artMarkup(): string {
  let out = '';
  for (let c = 0; c < COLUMNS; c++) {
    const ids = Array.from({ length: PER_COLUMN }, (_, i) => ARTWORK[(c * PER_COLUMN + i) % ARTWORK.length] as string);
    out += `<div class="lg-col">${[...ids, ...ids].map((id, i) => `<img alt="" src="${imageUrl(id, 'Primary', { maxWidth: 260, quality: 60 })}"${i >= PER_COLUMN ? ' loading="lazy"' : ''}>`).join('')}</div>`;
  }
  return out;
}

const page: Page = {
  title: 'Sign in',
  render(ctx: PageContext): HTMLElement {
    const root = document.createElement('div');
    root.className = 'lg';
    setHtml(root, html`
      <a class="lg-brand" href="#/login" aria-label="NutFin">Nut<em>Fin</em></a>
      <div class="lg-art" id="lgArt" aria-hidden="true">${raw(artMarkup())}</div>
      <div class="lg-shade"></div>
      <section class="lg-content" aria-labelledby="lgH">
        <div class="lg-copy"><h1 id="lgH" data-autofocus tabindex="-1">Your next good watch.</h1><p>Pick up where you left off. Find something worth staying in for.</p></div>
        <div class="lg-card">
          <h2>Sign in to NutFin</h2>
          <p class="lg-lede">Use the account your server owner created for you.</p>
          <form id="lgForm" novalidate>
            <label for="lgUser">Username</label>
            <input id="lgUser" name="username" autocomplete="username" required placeholder="Your username" autocapitalize="none" spellcheck="false">
            <label for="lgPass">Password</label>
            <div class="lg-pw"><input id="lgPass" name="password" type="password" autocomplete="current-password" required placeholder="Your password"><button type="button" id="lgShow" aria-label="Show password" aria-pressed="false">Show</button></div>
            <button class="lg-go" type="submit">Sign in</button>
            <p class="lg-notice" id="lgNotice" role="alert"></p>
          </form>
          <div id="lgQcSlot"></div>
          <details class="lg-help"><summary>Need help signing in?</summary><div>Your server owner manages accounts and passwords.</div></details>
        </div>
      </section>
      <div class="lg-status" id="lgStatus" role="status"><span></span>Loading artwork</div>
      <button class="lg-motion" id="lgMotion" type="button" aria-pressed="false">Pause background</button>`);

    const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s) as T;
    const form = $<HTMLFormElement>('#lgForm');
    const user = $<HTMLInputElement>('#lgUser');
    const pass = $<HTMLInputElement>('#lgPass');
    const notice = $('#lgNotice');
    const go = form.querySelector<HTMLButtonElement>('.lg-go') as HTMLButtonElement;
    const next = ctx.query.get('next');
    const destination = next && next.startsWith('/') && !next.startsWith('/login') ? next : '/';

    user.value = store.get<string>('lastUser', '');
    if (user.value) setTimeout(() => pass.focus(), 0);
    else setTimeout(() => user.focus(), 0);

    const finish = (name: string) => {
      store.set('lastUser', name); // remembered silently (no checkbox); the session itself is kept by the backend
      pass.value = '';
      ctx.router.navigate(destination, { replace: true });
    };

    /* username + password */
    $('#lgShow').addEventListener('click', e => {
      const b = e.currentTarget as HTMLButtonElement;
      const show = pass.type === 'password';
      pass.type = show ? 'text' : 'password';
      b.textContent = show ? 'Hide' : 'Show';
      b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      b.setAttribute('aria-pressed', String(show));
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const name = user.value.trim();
      if (!name || !pass.value) {
        notice.textContent = !name ? 'Enter your username.' : 'Enter your password.';
        (!name ? user : pass).focus();
        return;
      }
      notice.textContent = '';
      go.disabled = true;
      go.textContent = 'Signing in…';
      form.setAttribute('aria-busy', 'true');
      try {
        await ctx.backend.signIn(name, pass.value);
        finish(name);
      } catch (err) {
        const reason = err instanceof SignInError ? err.reason : 'unknown';
        notice.textContent = friendlyError(reason);
        go.disabled = false;
        go.textContent = 'Sign in';
        form.removeAttribute('aria-busy');
        if (reason === 'bad-credentials') pass.select();
      }
    });

    /* Quick Connect (second option, only when the server has it on) */
    const qcSlot = $('#lgQcSlot');
    let qcTimer: number | undefined;
    let qcRun = 0;
    const stopQc = () => { clearTimeout(qcTimer); qcRun++; };
    let gone = false;
    ctx.onDispose(() => { gone = true; stopQc(); });

    const showQcButton = () => {
      setHtml(qcSlot, html`<button class="lg-alt" type="button" id="lgQc">Sign in with Quick Connect</button>`);
      $('#lgQc').addEventListener('click', () => void startQc());
    };
    const startQc = async () => {
      const run = ++qcRun;
      setHtml(qcSlot, html`<div class="lg-qc" role="status"><p>Getting a code…</p></div>`);
      try {
        const session = await ctx.backend.quickConnect.start();
        if (run !== qcRun) return;
        setHtml(qcSlot, html`<div class="lg-qc">
          <p>On a device where you are already signed in to Jellyfin, open Settings, then Quick Connect, and enter this code.</p>
          <span class="lg-code" aria-label="Code ${session.code.split('').join(' ')}">${session.code}</span>
          <p role="status">Waiting for you to approve it…</p>
          <button type="button" id="lgQcCancel">Cancel</button></div>`);
        $('#lgQcCancel').addEventListener('click', () => { stopQc(); showQcButton(); $('#lgQc').focus(); });
        const started = Date.now();
        const poll = async () => {
          if (run !== qcRun) return;
          if (Date.now() - started > 5 * 60_000) { notice.textContent = 'That code expired. Start Quick Connect again.'; showQcButton(); return; }
          try {
            const u = await ctx.backend.quickConnect.poll(session);
            if (run !== qcRun) return;
            if (u) { finish(u.name); return; }
          } catch (err) {
            if (run !== qcRun) return;
            notice.textContent = friendlyError(err instanceof SignInError ? err.reason : 'unknown');
            showQcButton();
            return;
          }
          qcTimer = window.setTimeout(() => void poll(), 3000);
        };
        qcTimer = window.setTimeout(() => void poll(), 3000);
      } catch (err) {
        if (run !== qcRun) return;
        notice.textContent = friendlyError(err instanceof SignInError ? err.reason : 'unknown');
        showQcButton();
      }
    };
    void ctx.backend.quickConnect.enabled().then(on => { if (on && !gone) showQcButton(); });

    /* artwork + motion */
    const art = $('#lgArt');
    const status = $('#lgStatus');
    const imgs = Array.from(art.querySelectorAll<HTMLImageElement>('img'));
    let settled = 0;
    let loaded = 0;
    const settle = (img: HTMLImageElement) => {
      settled++;
      if (img.naturalWidth) { loaded++; img.classList.add('ready'); }
      if (loaded >= 10 || settled === imgs.length) { art.classList.add('ready'); status.hidden = true; }
      if (settled === imgs.length && !loaded) { status.hidden = false; status.textContent = 'Artwork unavailable. You can still sign in.'; }
    };
    for (const img of imgs) {
      if (img.complete) settle(img);
      else { img.addEventListener('load', () => settle(img), { once: true }); img.addEventListener('error', () => settle(img), { once: true }); }
    }
    $('#lgMotion').addEventListener('click', e => {
      const b = e.currentTarget as HTMLButtonElement;
      const paused = root.classList.toggle('paused');
      b.textContent = paused ? 'Play background' : 'Pause background';
      b.setAttribute('aria-pressed', String(paused));
    });

    return root;
  },
};

export default page;
