/** Formatting helpers for runtime, clock times and relative dates. All pure (pass `now` for tests). */

const TICKS_PER_MINUTE = 600_000_000;

export function ticksToMinutes(ticks: number | null | undefined): number {
  return ticks ? ticks / TICKS_PER_MINUTE : 0;
}

export function minutesToTicks(minutes: number): number {
  return Math.round(minutes * TICKS_PER_MINUTE);
}

/** 100 -> "1 h 40 min", 45 -> "45 min", 125 -> "2 h 05 min", 120 -> "2 h". */
export function runtime(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${String(rest).padStart(2, '0')} min`;
}

/** "9:18 pm" (12-hour, lower-case, no locale surprises). */
export function clock(d: Date): string {
  const h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
}

/** "ends at 9:18 pm" if you press play now and watch `remainingMinutes`. */
export function endsAt(remainingMinutes: number, now: Date = new Date()): string {
  return `ends at ${clock(new Date(now.getTime() + remainingMinutes * 60_000))}`;
}

/** "Just now", "12 min ago", "3 h ago", "Yesterday", "4 days ago", "Last week", "3 weeks ago", "1 month ago", "2 years ago". */
export function relativeTime(from: Date | string | number, now: Date = new Date()): string {
  const t = from instanceof Date ? from.getTime() : new Date(from).getTime();
  if (Number.isNaN(t)) return '';
  const diff = now.getTime() - t;
  if (diff < 0) return 'Just now';
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  if (days < 31) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) {
    const months = Math.max(1, Math.round(days / 30));
    return `${months} month${months > 1 ? 's' : ''} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years > 1 ? 's' : ''} ago`;
}

/** Jellyfin dates look like "2026-11-15T09:44:19.4178445Z"; fractional seconds can exceed JS precision. Returns null if unparsable. */
export function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isNaN(d.getTime()) ? null : d;
}
