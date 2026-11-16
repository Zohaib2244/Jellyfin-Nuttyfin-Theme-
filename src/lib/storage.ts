/**
 * localStorage wrapper that never throws (private windows, blocked storage, quota). Values are JSON.
 * If storage is unusable, reads fall back to an in-memory map so the app still works for the page's lifetime.
 * Keys are namespaced "nutfin.<name>".
 */
const PREFIX = 'nutfin.';
const memory = new Map<string, string>();

function backing(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readRaw(key: string): string | null {
  const full = PREFIX + key;
  try {
    const s = backing();
    if (s) return s.getItem(full);
  } catch { /* fall through to memory */ }
  return memory.get(full) ?? null;
}

function writeRaw(key: string, value: string): void {
  const full = PREFIX + key;
  memory.set(full, value);
  try { backing()?.setItem(full, value); } catch { /* memory copy still holds it */ }
}

export const store = {
  get<T>(key: string, fallback: T): T {
    const v = readRaw(key);
    if (v == null) return fallback;
    try { return JSON.parse(v) as T; } catch { return fallback; }
  },
  set<T>(key: string, value: T): void {
    try { writeRaw(key, JSON.stringify(value)); } catch { /* unserialisable: ignore */ }
  },
  remove(key: string): void {
    const full = PREFIX + key;
    memory.delete(full);
    try { backing()?.removeItem(full); } catch { /* ignore */ }
  },
  has(key: string): boolean {
    return readRaw(key) != null;
  },
};
