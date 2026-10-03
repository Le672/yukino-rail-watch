import { afterEach, describe, expect, it, vi } from "vitest";
import { railApiUrl } from "../lib/rail-api";
afterEach(() => vi.unstubAllGlobals());
describe("official gateway URLs", () => {
  it("refreshes previously cached station responses without removing daily caching or mutating callers", () => {
    const params = new URLSearchParams({ mode: "stations" });
    expect(railApiUrl(params)).toBe("/api/rail?mode=stations&schema=city-v1");
    expect(params.toString()).toBe("mode=stations");
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
    expect(railApiUrl(params)).toBe("https://www.yukino.bond/api/rail?mode=stations&schema=city-v1");
  });
  it("uses the local website gateway in browsers and the public gateway in both native platforms", () => {
    const params = new URLSearchParams({ mode: "journey", train: "G101", date: "2026-10-03" });
    expect(railApiUrl(params)).toBe(`/api/rail?${params}`);
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
    expect(railApiUrl(params)).toBe(`https://www.yukino.bond/api/rail?${params}`);
  });
});
