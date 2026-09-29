import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import L from "leaflet";
import { RailMap } from "../components/RailMap";
import { locateJourney, parseJourney, parseRailwayMap } from "../lib/train-position";
import { gcjToWgs84 } from "../lib/rail-gps";
import { k123, k123Map } from "./fixtures/conventional-position";
describe("full map layer controls", () => {
  it("switches 2D to satellite with visible provider credits and keeps map controls", () => {
    render(<RailMap journey={null} route={null} position={null} fix={null} match={null} gpsEnabled={false} />);
    expect(screen.getByRole("button", { name: "2D 地图" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: "OpenStreetMap contributors" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "卫星图" }));
    expect(screen.getByRole("link", { name: "Sentinel-2 cloudless" })).toBeInTheDocument();
    expect(screen.getByText(/10 米分辨率/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "放大一级" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2D 地图" }));
    expect(screen.getByRole("link", { name: "OpenStreetMap contributors" })).toBeInTheDocument();
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
      expect(setView).toHaveBeenCalledWith([32.26, 111.59], expect.any(Number), expect.objectContaining({ animate: false }));
      expect(polyline).not.toHaveBeenCalled();
      const tooltips = circleMarker.mock.results.map(result => (result.value as L.CircleMarker).getTooltip()?.getContent()).filter(Boolean) as HTMLElement[];
      expect(tooltips.some(element => element.textContent === "下一停靠站：十堰（时刻表）")).toBe(true);
      expect(tooltips.some(element => element.textContent?.includes("设备实时位置"))).toBe(true);
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
});
