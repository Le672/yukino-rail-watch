import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRailLocation } from "../hooks/useRailLocation";

afterEach(() => { vi.unstubAllGlobals(); delete window.railLocation; });
describe("explicit geolocation consent and lifecycle", () => {
  it("requests high accuracy only on enable and clears the watch on stop", () => {
    const watchPosition = vi.fn().mockReturnValue(12), clearWatch = vi.fn();
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } });
    const { result } = renderHook(useRailLocation);
    expect(watchPosition).not.toHaveBeenCalled();
    act(() => result.current.start());
    expect(watchPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    act(() => watchPosition.mock.calls[0][0]({ coords: { longitude: 113, latitude: 28, accuracy: 15, speed: 60, heading: 180 }, timestamp: Date.now() }));
    expect(result.current.fix?.accuracy).toBe(15);
    act(() => result.current.stop());
    expect(clearWatch).toHaveBeenCalledWith(12);
    expect(result.current.fix).toBeNull();
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
});
