// tests/focusRing.test.ts — keyboard focus has exactly one home: the
// focus block in src/styles/components.css. Any other stylesheet growing
// a :focus-visible rule re-opens the bespoke-rings era, so this pins the
// single-source rule from AGENTS.md.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// vitest runs from the repo root (same cwd assumption as vite.config.ts);
// import.meta.url is not a file: URL under the jsdom environment.
const stylesDir = path.resolve(process.cwd(), "src/styles");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    return entry.name.endsWith(".css") ? [full] : [];
  });
}

describe("focus ring home", () => {
  it("keeps :focus-visible inside components.css only", () => {
    const offenders = cssFiles(stylesDir)
      .filter((file) => readFileSync(file, "utf8").includes(":focus-visible"))
      .map((file) => path.relative(stylesDir, file).split(path.sep).join("/"));
    expect(offenders).toEqual(["components.css"]);
  });

  it("defines both utility classes plus the theme and forced-colors fallbacks", () => {
    const css = readFileSync(path.join(stylesDir, "components.css"), "utf8");
    expect(css).toContain(".focus-ring:focus-visible");
    expect(css).toContain(".focus-ring-inset:focus-visible");
    expect(css).toContain('[data-theme="light"] .focus-ring:focus-visible');
    expect(css).toContain("@media (forced-colors: active)");
  });
});
