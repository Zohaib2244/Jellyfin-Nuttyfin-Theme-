/** Jellyfin auth header, device identity and the stored session. Pure builders are unit-tested. */
import { store, tabStore } from '../lib/storage';

export const CLIENT_NAME = 'Nuttyfin';
export const CLIENT_VERSION = '0.1.0';

export interface AuthHeaderParts {
  client: string;
  device: string;
  deviceId: string;
  version: string;
  token?: string;
}

function q(v: string): string {
  // header values are quoted strings: strip quotes/control chars rather than escaping
  return v.replace(/["\\\r\n]/g, '');
}

/** MediaBrowser Client="Nuttyfin", Device="Chrome", DeviceId="...", Version="0.1.0"[, Token="..."] */
export function buildAuthHeader(p: AuthHeaderParts): string {
  const base = `MediaBrowser Client="${q(p.client)}", Device="${q(p.device)}", DeviceId="${q(p.deviceId)}", Version="${q(p.version)}"`;
  return p.token ? `${base}, Token="${q(p.token)}"` : base;
}

/** "Chrome", "Firefox", "Safari", "Edge" or "Browser". Shown in Jellyfin's dashboard device list. */
export function detectDeviceName(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

/** Stable per-browser id (created once, kept in localStorage). */
export function getDeviceId(): string {
  let id = store.get<string>('deviceId', '');
  if (!id) {
    id = uuid();
    store.set('deviceId', id);
  }
  return id;
}

export function currentAuthHeader(token?: string): string {
  return buildAuthHeader({
    client: CLIENT_NAME,
    device: detectDeviceName(typeof navigator === 'undefined' ? '' : navigator.userAgent),
    deviceId: getDeviceId(),
    version: CLIENT_VERSION,
    token,
  });
}

/** What we keep between visits. */
export interface StoredSession {
  token: string;
  userId: string;
  userName: string;
  isAdmin: boolean;
  avatarTag?: string;
}

export const session = {
  load(): StoredSession | null {
    const s = tabStore.get<StoredSession | null>('session', null) ?? store.get<StoredSession | null>('session', null);
    return s && typeof s.token === 'string' && typeof s.userId === 'string' ? s : null;
  },
  remembered(): boolean { return store.get<boolean>('rememberMe', true); },
  setRemembered(value: boolean): void { store.set('rememberMe', value); },
  save(s: StoredSession): void {
    store.remove('session'); tabStore.remove('session');
    (store.get<boolean>('rememberMe', true) ? store : tabStore).set('session', s);
  },
  clear(): void { store.remove('session'); tabStore.remove('session'); },
};
