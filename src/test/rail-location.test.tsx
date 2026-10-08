import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRailLocation } from "../hooks/useRailLocation";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.railLocation; });
describe("explicit geolocation consent and lifecycle", () => {
  it("requests high accuracy only on enable and clears the watch on stop", () => {
    const watchPosition = vi.fn().mockReturnValue(12), clearWatch = vi.fn();
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } });
    const { result } = renderHook(useRailLocation);
    expect(watchPosition).not.toHaveBeenCalled();
    act(() => result.current.start());
    expect(watchPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    act(() => watchPosition.mock.calls[0][0]({ coords: { longitude: 113, latitude: 28, accuracy: 15, speed: 60, heading: 180 }, timestamp: Date.now() }));
    expect(result.current.fix?.accuracy).toBe(15);
    act(() => result.current.stop());
    expect(clearWatch).toHaveBeenCalledWith(12);
    expect(result.current.fix).toBeNull();
    expect(result.current.samples).toEqual([]);
  });
  it("shows permission denial without an IP fallback", () => {
    const watchPosition = vi.fn().mockReturnValue(3), clearWatch = vi.fn();
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } });
    const { result } = renderHook(useRailLocation);
    act(() => result.current.start());
    act(() => watchPosition.mock.calls[0][1]({ code: 1, message: "denied" }));
    expect(result.current.enabled).toBe(false);
    expect(result.current.error).toContain("定位权限");
    expect(result.current.fix).toBeNull();
  });
  it("stops native Windows location when the component unmounts", () => {
    const start = vi.fn().mockResolvedValue(undefined), stop = vi.fn().mockResolvedValue(undefined), unsubscribe = vi.fn();
    window.railLocation = { start, stop, onUpdate: vi.fn().mockReturnValue(unsubscribe) };
    const { result, unmount } = renderHook(useRailLocation);
    act(() => result.current.start());
    expect(start).toHaveBeenCalledOnce();
    unmount();
    expect(stop).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("keeps only a short session buffer and ignores duplicate and out-of-order callbacks", () => {
    const watchPosition = vi.fn().mockReturnValue(9), clearWatch = vi.fn();
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } });
    const { result } = renderHook(useRailLocation);
    act(() => result.current.start());
    const now = Date.now();
    const deliver = (seconds: number) => act(() => watchPosition.mock.calls[0][0]({
      coords: { longitude: 113, latitude: 28, accuracy: 5, speed: null, heading: null }, timestamp: now + seconds * 1000,
    }));
    [0, 2, 4, 4, 3, 6, 8, 10, 12, 14].forEach(deliver);
    expect(result.current.samples.map(sample => sample.timestamp)).toEqual([0, 2, 4, 6, 8, 10, 12, 14].map(seconds => now + seconds * 1000));
    deliver(200);
    expect(result.current.samples.map(sample => sample.timestamp)).toEqual([now + 200000]);
    act(() => watchPosition.mock.calls[0][1]({ code: 3, message: "timeout" }));
    expect(result.current.samples).toEqual([]);
    expect(result.current.fix).toBeNull();
    deliver(202);
    expect(result.current.samples).toHaveLength(1);
    act(() => result.current.stop());
    expect(result.current.samples).toEqual([]);
  });
  it("clears samples while hidden and cannot revive an old watch after resuming", () => {
    const watchPosition = vi.fn().mockReturnValue(10), clearWatch = vi.fn();
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } });
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const { result, unmount } = renderHook(useRailLocation);
    act(() => result.current.start());
    const point = { coords: { longitude: 113, latitude: 28, accuracy: 5, speed: 80, heading: 0 }, timestamp: Date.now() };
    act(() => watchPosition.mock.calls[0][0](point));
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => watchPosition.mock.calls[0][0](point));
    expect(result.current.samples).toEqual([]);
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(watchPosition).toHaveBeenCalledTimes(2);
    act(() => watchPosition.mock.calls[0][0](point));
    expect(result.current.fix).toBeNull();
    act(() => watchPosition.mock.calls[1][0](point));
    expect(result.current.samples).toHaveLength(1);
    unmount();
    expect(clearWatch).toHaveBeenCalled();
  });
});
