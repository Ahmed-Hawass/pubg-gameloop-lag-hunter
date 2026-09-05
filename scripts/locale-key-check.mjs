// locale-key-check.mjs — structural comparison of en/ar locale keys.
// Run with: node scripts/locale-key-check.mjs  (uses the installed TS via a
// tiny transpile-to-temp approach). Exit 1 on any drift.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function loadLocale(file) {
  const src = require("node:fs").readFileSync(file, "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dir = mkdtempSync(join(tmpdir(), "lh-locale-"));
  const out = join(dir, "locale.cjs");
  writeFileSync(out, js);
  return { mod: require(out), dir };
}

function flatKeys(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      keys.push(...flatKeys(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

const { mod: enMod } = loadLocale("src/locales/en.ts");
const { mod: arMod } = loadLocale("src/locales/ar.ts");
const en = flatKeys(enMod.en);
const ar = flatKeys(arMod.ar);

const missingInAr = en.filter((k) => !ar.includes(k));
const extraInAr = ar.filter((k) => !en.includes(k));

if (missingInAr.length || extraInAr.length) {
  if (missingInAr.length) console.error("MISSING in ar:", missingInAr.join(", "));
  if (extraInAr.length) console.error("EXTRA in ar:", extraInAr.join(", "));
  process.exit(1);
}
console.log(`OK: ${en.length} keys match 1:1 between en and ar`);
