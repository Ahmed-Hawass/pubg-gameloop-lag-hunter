// updateFlow.test.ts — the once-per-version rule, as tests.
// The bug class this guards: a nagging modal (showing every launch) or a
// silent miss (never showing a new version).

import { describe, expect, it } from "vitest";
import { shouldShowUpdateModal } from "../updateFlow";
import type { UpdateInfo } from "../bridge";

const info: UpdateInfo = {
  version: "1.3.0",
  notes: "fixed the startup freeze",
  asset_url: "https://github.com/x/y/releases/download/v1.3.0/pubg-gameloop-lag-hunter-1.3.0.exe",
  asset_name: "pubg-gameloop-lag-hunter-1.3.0.exe",
  sums_url: "https://github.com/x/y/releases/download/v1.3.0/SHA256SUMS.txt",
};

describe("shouldShowUpdateModal", () => {
  it("shows for a fresh version", () => {
    expect(shouldShowUpdateModal(info, false, null)).toBe(true);
  });

  it("never shows without a newer release", () => {
    expect(shouldShowUpdateModal(null, false, null)).toBe(false);
  });

  it("defers while the first-run advice is up (one modal surface)", () => {
    expect(shouldShowUpdateModal(info, true, null)).toBe(false);
  });

  it("does not show again for an already-announced version", () => {
    expect(shouldShowUpdateModal(info, false, "1.3.0")).toBe(false);
  });

  it("shows again when the NEXT version lands (skip is per-version)", () => {
    expect(shouldShowUpdateModal(info, false, "1.2.9")).toBe(true);
  });

  it("matches announced versions case-insensitively", () => {
    expect(shouldShowUpdateModal(info, false, "1.3.0")).toBe(false);
  });
});
