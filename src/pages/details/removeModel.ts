/** Pure wording and choices for the smart Remove dialog (no DOM). The numbers come from the helper's delete plan. */
import type { DeleteMode, DeletePlan } from '../../api/desk-types';

/** "0 GB", "850 MB", "6.4 GB", "1.2 TB" (binary units, one decimal from 1 GB up). */
export function fmtBytes(n: number): string {
  const b = Math.max(0, n);
  if (b < 1024 ** 2 / 2) return b < 1024 ? '0 GB' : `${Math.round(b / 1024)} KB`;
  if (b < 1024 ** 3 * 0.95) return `${Math.round(b / 1024 ** 2)} MB`;
  if (b < 1024 ** 4) return `${(b / 1024 ** 3).toFixed(b < 10 * 1024 ** 3 ? 1 : 0).replace(/\.0$/, '')} GB`;
  return `${(b / 1024 ** 4).toFixed(1).replace(/\.0$/, '')} TB`;
}

export interface Choice { arr: boolean; torrent: boolean }

export const modeOf = (c: Choice): DeleteMode => (!c.arr ? 'jellyfin-only' : c.torrent ? 'arr-and-files-and-torrent' : 'arr-and-files');

/** Can the person tick "also remove the torrent"? Only when one shares the files. */
export const hasTorrent = (p: DeletePlan): boolean => p.torrents.length > 0;

/** Why a mode gives back what it gives back, in plain words. */
export function freedSentence(p: DeletePlan, mode: DeleteMode): string {
  const m = p.modes[mode];
  if (!p.measured) return 'The helper could not measure the drive, so it cannot say how much space comes back.';
  if (m.freedBytes > 0 && m.keptBytes === 0) return `About ${fmtBytes(m.freedBytes)} comes back on the drive.`;
  if (m.freedBytes > 0) return `About ${fmtBytes(m.freedBytes)} comes back. ${fmtBytes(m.keptBytes)} stays because another copy of the file exists elsewhere.`;
  const seeding = p.torrents.some(t => t.seeding);
  const holds = mode !== 'arr-and-files-and-torrent' && p.torrents.length > 0;
  if (holds) return seeding ? 'Frees 0 GB because the torrent is still seeding and keeps the file.' : 'Frees 0 GB because a finished torrent still keeps the file.';
  return 'Frees 0 GB because another copy of the file exists elsewhere.';
}

/** One line for the option title: "(frees 6.4 GB)" / "(frees 0 GB)". */
export const freesTag = (p: DeletePlan, mode: DeleteMode): string => (p.measured ? `frees ${fmtBytes(p.modes[mode].freedBytes)}` : '');

/** Notes worth a warning colour: the plain "this will not free space" case. */
export const showsNoSpace = (p: DeletePlan, mode: DeleteMode): boolean => p.measured && p.modes[mode].freedBytes === 0;

/** What a finished step list says, for the final screen. */
export function outcomeText(r: { ok: boolean; steps: Array<{ label: string; status: string; detail?: string }> }): { title: string; detail: string } {
  if (r.ok) return { title: 'Done', detail: '' };
  const bad = r.steps.find(s => s.status === 'failed');
  const left = r.steps.filter(s => s.status === 'skipped').length;
  return {
    title: 'It stopped part-way',
    detail: `${bad ? `"${bad.label}" did not work${bad.detail ? ` (${bad.detail})` : ''}.` : 'A step did not work.'}${left ? ` The ${left === 1 ? 'step after it was' : `${left} steps after it were`} not run.` : ''}`,
  };
}
