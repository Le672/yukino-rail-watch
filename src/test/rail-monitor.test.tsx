import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRailMonitor, type Settings } from "../hooks/useRailMonitor";
vi.mock("../lib/rail-enrichment", () => ({ enrichTrainList: vi.fn().mockResolvedValue(undefined), mergeTrainDetails: (train: unknown) => train }));
const saved: Settings = { queryMode: "train", date: "2026-10-10", train: "G101", from: "", to: "", seat: "二等座", intervalMinutes: 1, enabled: false };
const answer = { checkedAt: "2026-10-10T01:00:00Z", date: saved.date, from: "北京南", to: "上海虹桥", trains: [] };
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T01:00:00Z")); vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ stations: [] })))); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("ticket monitor date and request lifecycle", () => {
  it("restores an expired date to China today without restarting the saved monitor", () => {
    localStorage.setItem("yukino-rail-monitor-v1", JSON.stringify({ ...saved, date: "2026-09-30", enabled: true }));
    const { result } = renderHook(() => useRailMonitor());
    expect(result.current.settings).toMatchObject({ date: saved.date, train: saved.train, enabled: false });
    expect(result.current.dateNotice).toContain("2026-09-30"); expect(result.current.dateRange).toEqual({ min: "2026-10-10", max: "2026-10-24" });
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).includes("mode=stations"))).toBe(true);
  });
  it("rejects historical/future/invalid dates before sending a query or requesting notifications", async () => {
    const requestPermission = vi.fn(); vi.stubGlobal("Notification", { permission: "default", requestPermission });
    const { result } = renderHook(() => useRailMonitor());
    for (const date of ["2026-10-09", "2026-10-25", "2026-02-30"]) {
      act(() => result.current.update({ ...saved, date }));
      await act(async () => { await result.current.runCheck(); await result.current.toggleMonitor(); });
      expect(result.current.error).toBeTruthy(); expect(result.current.settings.enabled).toBe(false);
    }
    expect(requestPermission).not.toHaveBeenCalled(); expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
  it("uses uncached POST and cancels an obsolete query without displaying its result", async () => {
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation((url) => String(url).includes("mode=stations") ? Promise.resolve(new Response('{"stations":[]}')) : new Promise(done => { resolve = done; }));
    const { result } = renderHook(() => useRailMonitor()); act(() => result.current.update(saved));
    let pending!: Promise<void>; act(() => { pending = result.current.runCheck(); });
    const options = vi.mocked(fetch).mock.calls[1][1]!;
    expect(options).toMatchObject({ method: "POST", cache: "no-store" });
    act(() => result.current.update({ train: "G102" })); expect(options.signal?.aborted).toBe(true);
    await act(async () => { resolve(new Response(JSON.stringify(answer))); await pending; });
    expect(result.current.result).toBeNull(); expect(result.current.error).toBeNull(); expect(result.current.checking).toBe(false);
  });
  it("stops an active monitor at China midnight instead of polling an expired date", async () => {
    vi.setSystemTime(new Date("2026-10-10T15:59:30Z"));
    vi.mocked(fetch).mockImplementation(async url => new Response(JSON.stringify(String(url).includes("mode=stations") ? { stations: [] } : answer)));
    localStorage.setItem("yukino-rail-monitor-v1", JSON.stringify({ ...saved, intervalMinutes: 60, enabled: true }));
    const { result } = renderHook(() => useRailMonitor()); await act(async () => {});
    expect(result.current.settings.enabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(result.current.settings.enabled).toBe(false); expect(result.current.dateRange.min).toBe("2026-10-11"); expect(result.current.error).toContain("已过期");
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => !String(url).includes("mode=stations"))).toHaveLength(1);
  });
  it("rolls back monitor state when the native configuration fails", async () => {
    const bridge = { stations: vi.fn().mockResolvedValue({ stations: [] }), getState: vi.fn().mockResolvedValue({ settings: saved, result: null, error: null, checking: false, version: "1.10.13" }), onUpdate: vi.fn().mockReturnValue(() => {}), configure: vi.fn().mockRejectedValue(new Error("无法保存监控设置")), checkNow: vi.fn() };
    const { result } = renderHook(() => useRailMonitor(bridge)); await act(async () => {});
    await act(async () => { await result.current.toggleMonitor(); });
    expect(result.current.settings.enabled).toBe(false); expect(result.current.error).toContain("无法保存"); expect(result.current.desktopVersion).toBe("1.10.13");
  });
});
