import { afterEach, describe, expect, it, vi } from "vitest";

const response = { success: true, data: { numberFull: ["G6003"], rundays: ["20260929"], timetable: [
  { station: "长沙南", stationTelecode: "CWQ", day: 0, arrive: "10:00", depart: "10:00" },
  { station: "广州南", stationTelecode: "IZQ", day: 0, arrive: "12:02", depart: "12:06" },
] } };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("position data dates and caching", () => {
  it("coalesces requests, preserves the fetched timestamp and sends an explicit origin date", async () => {
    vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-29T02:01:00Z"));
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response)); vi.stubGlobal("fetch", fetchMock);
    const { loadJourney } = await import("../lib/rail-position-data");
    const [a, b] = await Promise.all([loadJourney("G6003", "2026-09-29"), loadJourney("G6003", "2026-09-29")]);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(a.checkedAt).toBe(b.checkedAt);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.hostname).toBe("rg-api.zenglingkun.cn"); expect(url.searchParams.get("date")).toBe("20260929");
    vi.advanceTimersByTime(60000);
    const cached = await loadJourney("G6003", "2026-09-29");
    expect(cached.checkedAt).toBe(a.checkedAt); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not turn an unavailable response into a guessed timetable", async () => {
    vi.resetModules(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: false, data: null })));
    const { loadJourney } = await import("../lib/rail-position-data");
    await expect(loadJourney("G6003", "2026-09-29")).rejects.toThrow(/暂未返回/);
  });
  it("does not send malformed dates or train codes upstream", async () => {
    vi.resetModules(); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const { loadJourney, loadDelays } = await import("../lib/rail-position-data");
    await expect(loadJourney("G6003", "2026-02-30")).rejects.toThrow(/有效/);
    await expect(loadDelays("G6003/evil", "2026-09-29")).rejects.toThrow(/有效/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
