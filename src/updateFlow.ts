// updateFlow.ts — the pure decision logic of the update UX, extracted so
// the once-per-version rule is testable (the same rule the backend stores
// in settings.announced_update_version).

import type { UpdateInfo } from "./bridge";

/**
 * Should the update modal appear automatically at startup?
 *
 * Rules (in order):
 *   1. no newer release → never
 *   2. the first-run advice dialog is up → defer (one modal surface; the
 *      advice wins — the update modal will show on a later launch)
 *   3. this version was already announced once → never again (the About
 *      dot is the standing signal)
 *   4. otherwise → show, and the caller marks the version as announced
 *
 * Manual checks from About ignore rule 3 by design — they open the modal
 * directly without consulting this function.
 */
export function shouldShowUpdateModal(
  info: UpdateInfo | null,
  adviceUp: boolean,
  announced: string | null,
): boolean {
  if (!info) return false;
  if (adviceUp) return false;
  if (announced && announced.toLowerCase() === info.version.toLowerCase()) {
    return false;
  }
  return true;
}
