// version.ts — semantic version comparison for the update check.
// The repo tags plain x.y.z releases (no prereleases so far), so numeric
// component comparison is the whole job. Text comparison is the bug this
// replaces: "1.10.0" < "1.2.0" as strings, and any older tag with a longer
// name would show as "update available".

/** Parse "1.2.3" into numeric components; missing parts count as 0. */
function parts(v: string): number[] {
  return v
    .split(".")
    .map((p) => {
      const n = Number.parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/**
 * Compare two version strings.
 * Returns >0 when `remote` is newer than `local`, 0 when equal, <0 when older.
 * Non-numeric components compare as 0 — malformed input can never suggest
 * an update that isn't there.
 */
export function compareVersions(remote: string, local: string): number {
  const a = parts(remote);
  const b = parts(local);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** True when the remote release tag is strictly newer than the running app. */
export function isNewerRelease(remote: string, local: string): boolean {
  if (!remote || !local) return false;
  return compareVersions(remote, local) > 0;
}
