import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { useRailPageNavigation } from "../hooks/useRailPageNavigation";
import { railFeatureFromLocation, railFeatureUrl, railPositionFromLocation, RAIL_FEATURE_PATHS } from "../lib/rail-navigation";
import type { RailFeature } from "../lib/rail-navigation";
import App from "../Rail";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Controller() {
  const [feature, setFeature] = useState<RailFeature>(railFeatureFromLocation);
  const select = useRailPageNavigation(setFeature);
  return <><output>{feature}</output>{(Object.keys(RAIL_FEATURE_PATHS) as RailFeature[]).map(item => <button key={item} onClick={() => select(item)}>{item}</button>)}</>;
}
describe("rail subdomain feature URLs", () => {
  it("keeps a board train's origin date in a reloadable live link and rejects malformed selections", () => {
    const location = { hostname: "cr.yukino.bond", pathname: "/arrivalinfo", search: "?station=IZQ&date=2026-10-05", hash: "" } as Location;
    const link = railFeatureUrl("position", location, { train: "K123", date: "2026-10-04", autoQuery: true });
    expect(link).toBe("/live?station=IZQ&date=2026-10-04&train=K123");
    expect(railPositionFromLocation({ pathname: "/live", search: link.slice(link.indexOf("?")) })).toEqual({ train: "K123", date: "2026-10-04", autoQuery: true });
    expect(railPositionFromLocation({ pathname: "/live", search: "?train=K123&date=2026-02-30" })).toEqual({ train: "" });
    expect(railFeatureUrl("board", { ...location, pathname: "/live", search: "?station=IZQ&date=2026-10-04&train=K123" } as Location)).toBe("/arrivalinfo?station=IZQ");
  });
  it("maps the four stable paths and canonicalizes legacy query links", () => {
    for (const [feature, pathname] of Object.entries(RAIL_FEATURE_PATHS)) {
      expect(railFeatureFromLocation({ pathname, search: "?view=tickets" })).toBe(feature);
      expect(railFeatureUrl(feature as RailFeature, { hostname: "cr.yukino.bond", pathname: "/cr", search: "?view=board&station=IZQ", hash: "" } as Location)).toBe(`${pathname}?station=IZQ`);
    }
    expect(railFeatureFromLocation({ pathname: "/cr", search: "?view=board" })).toBe("board");
  });
  it("synchronizes browser back/forward with the selected feature", () => {
    window.history.replaceState({}, "", "/cr?view=position"); render(<Controller />);
    expect(screen.getByRole("status")).toHaveTextContent("position");
    fireEvent.click(screen.getByRole("button", { name: "transfer" })); expect(window.location.search).toBe("?view=transfer");
    act(() => { window.history.replaceState({}, "", "/cr?view=position"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(screen.getByRole("status")).toHaveTextContent("position");
  });
  it("preserves ticket form state when changing feature and returning", async () => {
    localStorage.clear(); vi.stubGlobal("scrollTo", vi.fn()); vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
    window.history.replaceState({}, "", "/cr"); render(<App />);
    await screen.findByRole("heading", { name: /余票提醒/ }, { timeout: 10000 });
    fireEvent.change(await screen.findByLabelText("车次"), { target: { value: "G1039" } });
    const stationRequests = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("mode=stations")).length;
    fireEvent.click(screen.getByRole("button", { name: "列车位置与下一站" })); await screen.findByLabelText("定位车次");
    fireEvent.click(screen.getByRole("button", { name: "余票查询与监控" }));
    expect(screen.getByLabelText("车次")).toHaveValue("G1039"); expect(window.location.search).toBe("");
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("mode=stations"))).toHaveLength(stationRequests);
  }, 15000);
});
