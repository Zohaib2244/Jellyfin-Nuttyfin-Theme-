/** Response shapes of the helper's JSON API. The SPA has matching types in src/api/desk-types.ts; keep them in step. */

export type DeleteMode = 'jellyfin-only' | 'arr-and-files' | 'arr-and-files-and-torrent';

export interface DeletePlanModeInfo {
  /** bytes that would really come back on the drive */
  freedBytes: number;
  /** library bytes removed from the library but still on disk because something else links to them */
  keptBytes: number;
  steps: string[];
}

export interface DeletePlan {
  jellyfinId: string;
  title: string;
  kind: 'movie' | 'series';
  arr: { app: 'radarr' | 'sonarr'; id: number; title: string; path: string } | null;
  files: { count: number; bytes: number };
  torrents: Array<{ hash: string; name: string; state: string; seeding: boolean; ratio: number; sizeBytes: number; sharedFiles: number }>;
  hardlinked: boolean;
  modes: Record<DeleteMode, DeletePlanModeInfo>;
  notes: string[];
  /** false when the files could not be measured (the numbers are then 0) */
  measured: boolean;
  deleteEnabled: boolean;
}

export interface DeleteStepResult { step: 'torrent' | 'arr' | 'jellyfin'; label: string; status: 'done' | 'failed' | 'skipped' | 'dry-run'; detail?: string }
export interface DeleteResult { dryRun: boolean; mode: DeleteMode; ok: boolean; steps: DeleteStepResult[]; freedBytes?: number }
