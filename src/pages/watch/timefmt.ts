/** Time text for the player. Pure. */

/** 75 -> "1:15", 3725 -> "1:02:05". Negative, NaN and Infinity become 0:00. */
export function fmt(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}

/** For screen readers: 3725 -> "1 hour 2 minutes 5 seconds". */
export function spoken(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  const parts = [h && `${h} hour${h > 1 ? 's' : ''}`, m && `${m} minute${m > 1 ? 's' : ''}`, (x || (!h && !m)) && `${x} second${x !== 1 ? 's' : ''}`];
  return parts.filter(Boolean).join(' ');
}

/** "45 min" or "1 h 05 min" (rounded up, at least 1 min). */
export function leftText(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** "12:34" / "1:02:03" / "754" / "754.5" -> seconds, or null. */
export function parseTime(v: string | null | undefined): number | null {
  if (v == null || v.trim() === '') return null;
  const t = v.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(':').map(Number);
  if (parts.length > 3 || parts.some(n => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((a, b) => a * 60 + b, 0);
}
