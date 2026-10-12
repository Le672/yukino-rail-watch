import { describe, expect, it } from "vitest";
import { UrbanRailPlanner } from "../lib/urban-rail";
import type { UrbanNetwork } from "../lib/urban-rail-types";
import type { Station } from "../lib/rail-tickets";

const station = (name: string, code: string): Station => ({ name, code, pinyin: "" });
const directed: UrbanNetwork = {
  schema: 1, source: "OpenStreetMap", sourceDate: "2026-10-03", updatedAt: "2026-10-03", excluded: 0,
  anchors: [{ name: "铁路甲", lat: 30, lon: 120 }, { name: "铁路乙", lat: 30, lon: 120.1 }],
  stops: [
    { id: "a", name: "起点", lat: 30, lon: 120, area: "甲城" },
    { id: "b", name: "换线", lat: 30, lon: 120.05, area: "甲城" },
    { id: "c", name: "终点", lat: 30, lon: 120.1, area: "乙城" },
  ],
  lines: [
    { id: "one", name: "一号线", mode: "subway", stops: ["a", "b"], bidirectional: false, interval: 4 },
    { id: "two", name: "二号线", mode: "subway", stops: ["b", "c"], bidirectional: false, interval: 8 },
  ],
};

describe("reachable railway gateways", () => {
  it("finds arrival gateways in the actual direction and keeps the forward station sequence and transfer costs", () => {
    const planner = new UrbanRailPlanner(directed), railway = [station("铁路甲", "AAA"), station("铁路乙", "BBB")];
    const to = planner.findStation("终点")!;
    expect(planner.gateways(to, railway, 8, "from")).toHaveLength(0);
    const incoming = planner.gateways(to, railway, 8, "to");
    expect(incoming.map(gateway => gateway.station.code)).toContain("AAA");
    const route = incoming.find(gateway => gateway.station.code === "AAA")!.route;
    const independent = new UrbanRailPlanner(directed).route(railway[0], to)!;
    expect(route).toEqual(independent);
    expect(route.rides.map(ride => ride.stops)).toEqual([["起点", "换线"], ["换线", "终点"]]);
    expect(route.transferMinutes).toBe(5);
  });

  it("does not let 28 nearby disconnected railway anchors hide a reachable hub more than 80 km away", () => {
    const decoys = Array.from({ length: 28 }, (_, i) => ({ id: `decoy${i}`, name: `孤立站${i}`, lat: 30.025 + i * .006, lon: 120.03, area: "测试" }));
    const network: UrbanNetwork = { ...directed,
      anchors: [{ name: "远端铁路枢纽", lat: 30, lon: 121.2 }, ...decoys.map(stop => ({ name: stop.name, lat: stop.lat, lon: stop.lon }))],
      stops: [directed.stops[0], ...[.4, .8, 1.2].map((lon, i) => ({ id: `far${i}`, name: `通达站${i}`, lat: 30, lon: 120 + lon, area: "跨城网络" })), ...decoys],
      lines: [{ id: "regional", name: "跨城轨道", mode: "suburban", stops: ["a", "far0", "far1", "far2"], bidirectional: true, duration: 75 }],
    };
    const planner = new UrbanRailPlanner(network);
    const railway = [...decoys.map((stop, i) => station(stop.name, `D${i}`)), station("远端铁路枢纽", "FAR")];
    const gateways = planner.gateways(planner.findStation("起点")!, railway, 8);
    expect(gateways.map(gateway => gateway.station.code)).toEqual(["FAR"]);
    expect(gateways[0].route.rides[0].stops).toEqual(["起点", "通达站0", "通达站1", "通达站2"]);
    expect(gateways[0].route.minutes).toBeLessThan(180);
    expect(planner.gateways(planner.findStation("起点")!, railway, 8, "from", undefined, 30)).toHaveLength(0);
  });

  it("honours cancellation even when gateway routes are already cached", () => {
    const planner = new UrbanRailPlanner(directed), railway = [station("铁路乙", "BBB")], from = planner.findStation("起点")!;
    expect(planner.gateways(from, railway)).toHaveLength(1);
    const abort = new AbortController(); abort.abort();
    expect(() => planner.gateways(from, railway, 8, "from", abort.signal)).toThrow();
  });
});
