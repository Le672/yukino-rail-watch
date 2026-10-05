import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import L from "leaflet";
import { RailMap } from "../components/RailMap";
import { locateJourney, parseJourney, parseRailwayMap } from "../lib/train-position";
import { gcjToWgs84 } from "../lib/rail-gps";
import { k123, k123Map } from "./fixtures/conventional-position";
describe("full map layer controls", () => {
  it("switches 2D to satellite with visible provider credits and keeps map controls", () => {
    const view = render(<RailMap journey={null} route={null} position={null} fix={null} match={null} gpsEnabled={false} />);
    expect(screen.getByRole("button", { name: "2D 地图" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "高德地图" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "2D 地图来源" })).toHaveValue("amap");
    fireEvent.click(screen.getByRole("button", { name: "卫星图" }));
    expect(screen.getByRole("link", { name: "Sentinel-2 cloudless" })).toBeInTheDocument();
    expect(screen.getByText(/10 米分辨率/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "放大一级" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2D 地图" }));
    expect(screen.getByRole("link", { name: "高德地图" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "2D 地图来源" }), { target: { value: "osm" } });
    expect(screen.getByRole("link", { name: "OpenStreetMap contributors" })).toBeInTheDocument();
    view.unmount();
  });
  it("shows conventional stops and centers the first GPS fix without drawing an invented track", () => {
    // jsdom supports SVG elements but has no real canvas context.
    const original = { canvas: L.Browser.canvas, svg: L.Browser.svg };
    Object.assign(L.Browser, { canvas: false, svg: true });
    const now = Date.parse("2026-09-30T09:36:00+08:00");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const setView = vi.spyOn(L.Map.prototype, "setView");
    const polyline = vi.spyOn(L, "polyline");
    const circleMarker = vi.spyOn(L, "circleMarker");
    const journey = parseJourney(k123, "K123", "2026-09-29", now);
    const stations = parseRailwayMap(k123Map, journey).stations.map(point => point ? gcjToWgs84(point) : null);
    const props = { journey, stations, route: null, position: locateJourney(journey, now), match: null, gpsEnabled: true };
    const fix = { latitude: 32.26, longitude: 111.59, accuracy: 20, speed: 20, heading: 270, timestamp: now };
    try {
      const view = render(<RailMap {...props} fix={fix} />);
      expect(screen.getByText(/已显示 4 \/ 4 个停靠站/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "全程" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "当前位置" })).toHaveAttribute("aria-pressed", "true");
      expect(setView).toHaveBeenCalledWith([32.257632050264384, 111.59570871340325], expect.any(Number), expect.objectContaining({ animate: false }));
      expect(polyline).not.toHaveBeenCalled();
      const tooltips = circleMarker.mock.results.map(result => (result.value as L.CircleMarker).getTooltip()?.getContent()).filter(Boolean) as HTMLElement[];
      expect(tooltips.some(element => element.textContent === "下一停靠站：十堰（时刻表）")).toBe(true);
      expect(tooltips.some(element => element.textContent?.includes("设备实时位置"))).toBe(true);
      // Changing the basemap redraws the very same GPS fix, rather than moving the device or double-converting it.
      fireEvent.click(screen.getByRole("button", { name: "卫星图" }));
      const satelliteGps = circleMarker.mock.results.map(result => result.value as L.CircleMarker).filter(marker =>
        (marker.getTooltip()?.getContent() as HTMLElement)?.textContent?.includes("设备实时位置")).at(-1)!;
      expect(satelliteGps.getLatLng()).toMatchObject({ lat: 32.26, lng: 111.59 });
      fireEvent.click(screen.getByRole("button", { name: "2D 地图" }));
      const domesticGps = circleMarker.mock.results.map(result => result.value as L.CircleMarker).filter(marker =>
        (marker.getTooltip()?.getContent() as HTMLElement)?.textContent?.includes("设备实时位置")).at(-1)!;
      expect(domesticGps.getLatLng()).toMatchObject({ lat: 32.257632050264384, lng: 111.59570871340325 });
      expect(fix).toMatchObject({ latitude: 32.26, longitude: 111.59 });
      fireEvent.click(screen.getByRole("button", { name: "全程" }));
      setView.mockClear();
      view.rerender(<RailMap {...props} fix={{ ...fix, latitude: 32.261, timestamp: now + 1000 }} />);
      expect(setView).not.toHaveBeenCalled();
      view.rerender(<RailMap {...props} fix={{ ...fix, timestamp: now - 31000 }} />);
      expect(screen.getByRole("button", { name: "当前位置" })).toBeDisabled();
      view.unmount();
    } finally {
      Object.assign(L.Browser, original);
      clock.mockRestore(); setView.mockRestore(); polyline.mockRestore(); circleMarker.mockRestore();
    }
  });
  it("retains the physical center and zoom when changing coordinate systems, without fitting the route again", () => {
    const original = { canvas: L.Browser.canvas, svg: L.Browser.svg };
    Object.assign(L.Browser, { canvas: false, svg: true });
    const mapFactory = vi.spyOn(L, "map"), fitBounds = vi.spyOn(L.Map.prototype, "fitBounds");
    const journey = parseJourney(k123, "K123", "2026-09-29");
    const stations = parseRailwayMap(k123Map, journey).stations.map(point => point ? gcjToWgs84(point) : null);
    const view = render(<RailMap journey={journey} stations={stations} route={null} position={null} fix={null} match={null} gpsEnabled={false} />);
    try {
      const instance = mapFactory.mock.results.at(-1)!.value as L.Map;
      instance.setView([22.986266927096015, 113.27432368730659], 15, { animate: false });
      const fits = fitBounds.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "卫星图" }));
      expect(instance.getCenter().lat).toBeCloseTo(22.989, 6);
      expect(instance.getCenter().lng).toBeCloseTo(113.269, 6);
      expect(instance.getZoom()).toBe(15);
      fireEvent.click(screen.getByRole("button", { name: "2D 地图" }));
      expect(instance.getCenter().lat).toBeCloseTo(22.986266927096015, 6);
      expect(instance.getCenter().lng).toBeCloseTo(113.27432368730659, 6);
      expect(instance.getZoom()).toBe(15);
      expect(fitBounds).toHaveBeenCalledTimes(fits);
    } finally { view.unmount(); Object.assign(L.Browser, original); mapFactory.mockRestore(); fitBounds.mockRestore(); }
  });
  it("reports blocked or stalled tile requests and lets the user retry or choose the backup", () => {
    vi.useFakeTimers();
    const factory = vi.spyOn(L, "tileLayer");
    const view = render(<RailMap journey={null} route={null} position={null} fix={null} match={null} gpsEnabled={false} />);
    try {
      const layer = factory.mock.results.at(-1)!.value as L.TileLayer;
      act(() => { layer.fire("loading"); vi.advanceTimersByTime(15000); });
      expect(screen.getByRole("status")).toHaveTextContent(/高德地图.*超时/);
      fireEvent.click(screen.getByRole("button", { name: "重试底图" }));
      expect(screen.queryByRole("status")).toBeNull();
      const retried = factory.mock.results.at(-1)!.value as L.TileLayer;
      act(() => { retried.fire("tileerror"); retried.fire("tileerror"); });
      fireEvent.click(screen.getByRole("button", { name: "使用备用 2D" }));
      expect(screen.getByRole("combobox", { name: "2D 地图来源" })).toHaveValue("osm");
      expect(screen.getByRole("link", { name: "OpenStreetMap contributors" })).toBeInTheDocument();
      expect(screen.queryByRole("status")).toBeNull();
    } finally { view.unmount(); factory.mockRestore(); vi.useRealTimers(); }
  });
});
