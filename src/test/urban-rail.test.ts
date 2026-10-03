import { describe, expect, it, vi } from "vitest";
import { UrbanRailPlanner, loadUrbanRail } from "../lib/urban-rail";
import type { UrbanNetwork, UrbanMode } from "../lib/urban-rail-types";
import { DEFAULT_TRANSFER, makeTrip, timedLeg, sortTrips, tripFare, tripRailFare, searchTransfers } from "../lib/rail-transfer";
import { DEFAULT_TRAIN_FILTERS } from "../lib/rail-tickets";
import type { Station, Train } from "../lib/rail-tickets";
const base: UrbanNetwork = { schema: 1, source: "OpenStreetMap", updatedAt: "2026-10-03", sourceDate: "2026-10-03", anchors: [], excluded: 0, stops: [
  { id: "a", name: "起点", area: "测试网络", lat: 30, lon: 120 }, { id: "b", name: "换线", area: "测试网络", lat: 30, lon: 120.01 },
  { id: "c", name: "终点", area: "测试网络", lat: 30, lon: 120.02 }, { id: "far", name: "换线", area: "另一城市", lat: 31, lon: 121 },
], lines: [ { id: "1", name: "一号线", mode: "subway", stops: ["a", "b"], bidirectional: false }, { id: "2", name: "二号线", mode: "tram", stops: ["b", "c"], bidirectional: true } ] };
const date = "2026-10-06";
describe("optional urban rail routing", () => {
  it("keeps rail transit off by default, supports every rail mode and charges for changing lines", () => {
    expect(DEFAULT_TRANSFER.allowUrban).toBe(false);
    for (const mode of ["subway", "light_rail", "tram", "monorail", "maglev", "suburban", "funicular", "people_mover"] as UrbanMode[]) {
      const p = new UrbanRailPlanner({ ...base, lines: base.lines.map(line => ({ ...line, mode })) });
      const route = p.route(p.findStation("起点")!, p.findStation("终点")!)!;
      expect(route.rides).toHaveLength(2); expect(route.rides[0].mode).toBe(mode); expect(route.transferMinutes).toBeGreaterThan(0); expect(route.waitingMinutes).toBeGreaterThan(0);
      expect(route.fare).toBeNull(); expect(route.operationVerified).toBe(false);
      expect(p.route(p.findStation("终点")!, p.findStation("起点")!)).toBeNull();
    }
  });
  it("does not connect identical names in different cities or guess a railway station with ambiguous coordinates", () => {
    const p = new UrbanRailPlanner({ ...base, anchors: [{ name: "铁路站", lat: 30, lon: 120 }, { name: "铁路站", lat: 32, lon: 121 }] });
    expect(() => p.findStation("换线")).toThrow(/名称重复/);
    expect(p.hasAccess({ name: "铁路站", code: "ABC", pinyin: "" })).toBe(false);
    expect(p.route(p.findStation("起点")!, p.findStation("另一城市 · 换线（轨道）")!)).toBeNull();
  });
  it("retains national railway priority unless explicitly changed, and never presents railway subtotal as a complete fare", () => {
    const a: Station = { name: "甲", code: "AAA", pinyin: "" }, b: Station = { name: "乙", code: "BBB", pinyin: "" };
    const train: Train = { code: "G1", trainNo: "N1", from: a.name, to: b.name, fromCode: a.code, toCode: b.code, departure: "10:00", arrival: "11:00", duration: "01:00", saleStatus: "Y", trainsetModel: "CR400AF", seats: [{ label: "二等座", value: "有", available: true, price: 50 }] };
    const leg = timedLeg(train, date)!, rail = makeTrip([leg], [], { ...DEFAULT_TRANSFER, date })!;
    const p = new UrbanRailPlanner(base), route = p.route(p.findStation("起点")!, p.findStation("终点")!)!;
    const mixed = { ...rail, id: "mixed", duration: 10, access: { from: a, to: b, kind: "urban" as const, minimum: 30, note: route.note, urban: route } };
    expect(tripRailFare(mixed, "任意席别")).toBe(50); expect(tripFare(mixed, "任意席别")).toBeNull();
    expect(sortTrips([mixed, rail], { ...DEFAULT_TRAIN_FILTERS, sort: "duration" })[0].id).toBe(rail.id);
    expect(sortTrips([mixed, rail], { ...DEFAULT_TRAIN_FILTERS, sort: "duration" }, false, false)[0].id).toBe("mixed");
    const only = { ...mixed, id: "only", legs: [], access: undefined, urbanOnly: route };
    expect(sortTrips([only], { ...DEFAULT_TRAIN_FILTERS, model: "CR400AF" }, true)).toHaveLength(0);
    expect(sortTrips([only], { ...DEFAULT_TRAIN_FILTERS, availableOnly: true })).toHaveLength(0);
  });
  it.each([["北京南", "北京西", "北京"], ["广州南", "广州东", "广州"], ["长沙南", "长沙", "长沙"], ["重庆北", "重庆西", "重庆"], ["上海虹桥", "上海", "上海"], ["沈阳北", "沈阳南", "沈阳"]])("routes the bundled national network from %s to %s", async (from, to, city) => {
    const p = await loadUrbanRail();
    const route = p.route({ name: from, code: from, city, pinyin: "" }, { name: to, code: to, city, pinyin: "" });
    expect(route).not.toBeNull(); expect(route!.rides.every(ride => ride.stops.length >= 2)).toBe(true); expect(route!.minutes).toBeGreaterThan(0);
  });
  it("finds a local urban-only route without issuing railway or third-party trip queries", async () => {
    const p = await loadUrbanRail();
    const from = p.stations().find(s => s.pinyin === "天安门东" && s.city?.includes("北京"))!, to = p.stations().find(s => s.pinyin === "王府井" && s.city?.includes("北京"))!;
    expect(from).toBeDefined(); expect(to).toBeDefined();
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await searchTransfers({ ...DEFAULT_TRANSFER, date, from: from.name, to: to.name, earliest: "10:00", allowUrban: true }, [], new AbortController().signal, vi.fn());
      expect(result.trips[0].urbanOnly?.rides.length).toBeGreaterThan(0); expect(result.queryCount).toBe(0); expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("assembles rail + urban + rail with official telecodes and rejects connections shorter than travel plus boarding reserve", async () => {
    const points: Station[] = [
      { name: "测试出发", code: "UAQ", city: "测试甲", pinyin: "" }, { name: "北京南", code: "VNP", city: "北京", pinyin: "" },
      { name: "北京西", code: "BXP", city: "北京", pinyin: "" }, { name: "测试到达", code: "UBQ", city: "测试乙", pinyin: "" },
    ];
    const first: Train = { code: "G101", trainNo: "URBANFIRST", from: "测试出发", to: "北京南", fromCode: "UAQ", toCode: "VNP", departure: "10:00", arrival: "11:00", duration: "01:00", saleStatus: "Y", trainsetModel: "CR400AF", seats: [{ label: "二等座", value: "有", available: true, price: 50 }] };
    const second = (code: string, departure: string, arrival: string): Train => ({ ...first, code, trainNo: code, from: "北京西", to: "测试到达", fromCode: "BXP", toCode: "UBQ", departure, arrival, trainsetModel: "CR400BF", seats: [{ label: "二等座", value: "有", available: true, price: 40 }] });
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input), "https://cr.yukino.bond"); expect(url.pathname).toBe("/api/rail");
      const key = `${url.searchParams.get("from")}/${url.searchParams.get("to")}`;
      return Response.json({ source: "12306", checkedAt: new Date().toISOString(), trains: key === "UAQ/VNP" ? [first] : key === "BXP/UBQ" && url.searchParams.get("date") === date ? [second("G201", "11:30", "12:30"), second("G202", "13:00", "14:00")] : [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await searchTransfers({ ...DEFAULT_TRANSFER, date, from: "测试出发", to: "测试到达", via: "北京南", allowCity: false, allowUrban: true }, points, new AbortController().signal, vi.fn());
      expect(result.trips).toHaveLength(1); expect(result.trips[0].legs.map(leg => leg.code)).toEqual(["G101", "G202"]);
      expect(result.trips[0].connections[0]).toMatchObject({ kind: "urban", from: { code: "VNP" }, to: { code: "BXP" } });
      expect(tripRailFare(result.trips[0], "二等座")).toBe(90); expect(tripFare(result.trips[0], "二等座")).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
});
