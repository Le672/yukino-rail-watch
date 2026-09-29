import { describe, expect, it } from "vitest";
import { readRailSpeed } from "../lib/rail-speed";
import type { LocationFix } from "../lib/rail-gps";

const now = Date.parse("2026-09-29T10:01:00+08:00");
function fix(seconds: number, northMetres = 0, speed: number | null = null, accuracy = 5): LocationFix {
  return { longitude: 113, latitude: 25 + northMetres / 6371000 * 180 / Math.PI,
    accuracy, speed, heading: 0, timestamp: now + seconds * 1000 };
}
describe("current device speed and short GPS speed estimation", () => {
  it("converts device current m/s into km/h without a timetable or a previous point", () => {
    expect(readRailSpeed([fix(0, 0, 300 / 3.6)], now)).toMatchObject({ kmh: 300, source: "device", timestamp: now, sampleSeconds: null });
  });
  it("keeps a reported zero speed as zero", () => {
    expect(readRailSpeed([fix(0, 0, 0)], now).kmh).toBe(0);
  });
  it("reports the latest acceleration and deceleration rather than averaging past speed", () => {
    const speeding = [fix(-4, -280, 60), fix(-2, -150, 70), fix(0, 0, 80)];
    expect(readRailSpeed(speeding, now).kmh).toBe(288);
    expect(readRailSpeed([fix(-4, -280, 80), fix(-2, -130, 70), fix(0, 0, 60)], now).kmh).toBe(216);
  });
  it("estimates high-speed motion from the recent GPS samples when device speed is null", () => {
    const samples = [-6, -4, -2, 0].map(t => fix(t, t * 250 / 3.6));
    const reading = readRailSpeed(samples, now);
    expect(reading.source).toBe("position");
    expect(reading.kmh).toBeCloseTo(250, 4);
    expect(reading.sampleSeconds).toBe(6);
    expect(reading.uncertaintyKmh).toBe(6);
  });
  it("uses at most the last eight seconds, so distant history cannot become interval average speed", () => {
    const recent = [-6, -4, -2, 0].map(t => fix(t, t * 200 / 3.6));
    expect(readRailSpeed([fix(-100, -10000), ...recent], now).kmh).toBeCloseTo(200, 4);
  });
  it("waits for enough samples instead of manufacturing speed from one displacement", () => {
    expect(readRailSpeed([fix(-2, -150), fix(0)], now).kmh).toBeNull();
    expect(readRailSpeed([fix(-1, -50), fix(-.5, -25), fix(0)], now).kmh).toBeNull();
  });
  it("hides stale, future, invalid, and coarse fixes", () => {
    expect(readRailSpeed([fix(-11, 0, 80)], now).reason).toContain("10 秒");
    expect(readRailSpeed([fix(2, 0, 80)], now).kmh).toBeNull();
    expect(readRailSpeed([{ ...fix(0, 0, 80), latitude: NaN }], now).kmh).toBeNull();
    expect(readRailSpeed([fix(0, 0, 80, 101)], now).kmh).toBeNull();
    expect(readRailSpeed([fix(0, 0, -1)], now).kmh).toBeNull();
    expect(readRailSpeed([fix(0, 0, 1000)], now).kmh).toBeNull();
  });
  it("rejects location teleporting even with a seemingly valid device speed", () => {
    expect(readRailSpeed([fix(-2, -2000, 80), fix(0, 0, 80)], now).reason).toContain("异常跳跃");
  });
  it("rejects extreme reported speed steps", () => {
    expect(readRailSpeed([fix(-1, -80, 10), fix(0, 0, 80)], now).reason).toContain("突变");
  });
  it("does not turn stationary GPS noise into a moving train", () => {
    expect(readRailSpeed([fix(-6, 3), fix(-4, -2), fix(-2, 2), fix(0)], now).kmh).toBeNull();
  });
  it("rejects gaps, duplicate timestamps, and positions whose error dominates speed", () => {
    expect(readRailSpeed([fix(-8, -400), fix(-6, -300), fix(0)], now).kmh).toBeNull();
    expect(readRailSpeed([fix(-2, -100), fix(0), fix(0)], now).kmh).toBeNull();
    expect(readRailSpeed([-4, -2, 0].map(t => fix(t, t * 30, null, 60)), now).kmh).toBeNull();
  });
});
