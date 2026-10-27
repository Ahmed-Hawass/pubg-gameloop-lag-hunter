// tests/systemFormat.test.ts - the System display math: CPU name
// shortening, disk kind tags, and usage percents. Pure (no render),
// so the card layout can change without these moving.
import { describe, expect, it } from "vitest";
import { diskKindLabel, diskMeterTone, diskUsedPct, shortCpuName } from "../views/SystemView";

describe("shortCpuName", () => {
  it("strips trademarks and the clock suffix", () => {
    expect(shortCpuName("Intel(R) Core(TM) i7-6820HQ CPU @ 2.70GHz")).toBe(
      "Intel Core i7-6820HQ",
    );
  });

  it("leaves names without decoration alone", () => {
    expect(shortCpuName("AMD Ryzen 5 5600H with Radeon Graphics")).toBe(
      "AMD Ryzen 5 5600H with Radeon Graphics",
    );
  });

  it("collapses stray spacing", () => {
    expect(shortCpuName("Intel(R)  Core(TM)   i5")).toBe("Intel Core i5");
  });
});

describe("diskKindLabel", () => {
  it("names NVMe alone, bus plus media otherwise", () => {
    expect(diskKindLabel("SSD", "NVMe")).toBe("NVMe");
    expect(diskKindLabel("HDD", "SATA")).toBe("SATA HDD");
    expect(diskKindLabel("SSD", "SATA")).toBe("SATA SSD");
  });

  it("drops unknowns and dedupes repeats", () => {
    expect(diskKindLabel("", "SATA")).toBe("SATA");
    expect(diskKindLabel("Unspecified", "")).toBe("");
    expect(diskKindLabel("SSD", "SSD")).toBe("SSD");
  });
});

describe("diskUsedPct", () => {
  it("rounds the used share and clamps firmware edges", () => {
    expect(diskUsedPct(500, 286)).toBe(43);
    expect(diskUsedPct(500, 0)).toBe(100);
    expect(diskUsedPct(500, 500)).toBe(0);
    expect(diskUsedPct(100, 150)).toBe(0);
    expect(diskUsedPct(100, -5)).toBe(100);
  });

  it("reads unknown free and dead sizes as unknown", () => {
    expect(diskUsedPct(500, null)).toBeNull();
    expect(diskUsedPct(0, 0)).toBeNull();
  });
});

describe("diskMeterTone", () => {
  it("stays green until the critical-full threshold, then red", () => {
    expect(diskMeterTone(43)).toBe("ok");
    expect(diskMeterTone(89)).toBe("ok");
    expect(diskMeterTone(90)).toBe("crit");
    expect(diskMeterTone(100)).toBe("crit");
  });
});
