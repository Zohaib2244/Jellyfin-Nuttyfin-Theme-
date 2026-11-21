/**
 * THE one definition of "open requests", used by the rail badge, Home, the Requests page and the Newly Added chips so the
 * number never changes when you change page.
 *
 *   open  = a request that is still on its journey: requested (waiting for a yes), approved / waiting (for a release or
 *           a copy), downloading, or only partly ready. That is the Requests page's "Waiting for a yes" + "On the way"
 *           groups.
 *   NOT   = available (in the library), declined, or removed from the library.
 *   whose = the signed-in person's OWN requests, for members and for admins alike (an admin's badge is not
 *           "everyone's" number; the Requests page still lets an admin look at everyone's list).
 */
import type { Backend } from '../api';
import type { DeskRequest } from '../api/desk-types';
import { requestStage } from '../pages/requests/stage';

/** True while the request is waiting for a yes or on its way (the stage group does not depend on the title lookups). */
export function isOpenRequest(r: DeskRequest): boolean {
  const g = requestStage(r, null).group;
  return g === 'pending' || g === 'onway';
}

/** How many of `list` are open. With `mineId`, only that Seerr user's own requests count (a list that mixes people). */
export function countOpenRequests(list: readonly DeskRequest[], mineId?: number | null): number {
  let n = 0;
  for (const r of list) {
    if (mineId != null && r.requestedById != null && r.requestedById !== mineId) continue;
    if (isOpenRequest(r)) n++;
  }
  return n;
}

/** The signed-in person's own requests, fetched once and shared for a short while (badge, Home and the tiles all ask). */
const TTL_MS = 20_000;
const cache = new WeakMap<object, { at: number; p: Promise<DeskRequest[]> }>();

export function myRequests(backend: Backend, o: { fresh?: boolean } = {}): Promise<DeskRequest[]> {
  const hit = cache.get(backend);
  if (hit && !o.fresh && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = (async () => {
    try { return (await backend.seerr.allRequests({ scope: 'mine' })).items; } catch { return []; } // soft: nothing when Seerr is off
  })();
  cache.set(backend, { at: Date.now(), p });
  return p;
}

/** The number for the rail badge and the "open" chips. 0 when Seerr is off or nothing is open. */
export async function openRequestCount(backend: Backend, o: { fresh?: boolean } = {}): Promise<number> {
  return countOpenRequests(await myRequests(backend, o));
}
