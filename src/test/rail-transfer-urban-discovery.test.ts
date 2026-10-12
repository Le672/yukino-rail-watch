import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TRANSFER, hasUrban, searchTransfers } from "../lib/rail-transfer";
import { UrbanRailPlanner, loadUrbanRail } from "../lib/urban-rail";
import { candidateHubs } from "../lib/rail-station-groups";
import type { UrbanNetwork } from "../lib/urban-rail-types";
import type { Station, Train } from "../lib/rail-tickets";

vi.mock("../lib/urban-rail", async original => ({ ...await original<typeof import("../lib/urban-rail")>(), loadUrbanRail: vi.fn() }));
const date = "2026-10-13";
let tick = Date.parse("2026-10-12T08:00:00+08:00");
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(tick += 60000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const station = (name: string, code: string, city = name): Station => ({ name, code, city, pinyin: "" });
const at = (name: string, lat: number, lon: number) => ({ id: name, name, lat, lon, area: "测试轨道网络" });
function network(stops: UrbanNetwork["stops"], lines: UrbanNetwork["lines"]): UrbanNetwork {
  return { schema: 1, source: "OpenStreetMap", sourceDate: "2026-10-03", updatedAt: "2026-10-03", excluded: 0,
    stops, lines, anchors: stops.map(stop => ({ name: stop.name, lat: stop.lat, lon: stop.lon })) };
}
const line = (id: string, stops: string[], bidirectional = true) => ({ id, name: `${id}线`, mode: "subway" as const, stops, bidirectional, duration: 10, interval: 4 });
function train(code: string, from: Station, to: Station, departure: string, arrival: string): Train {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const duration = minutes(arrival) - minutes(departure);
  return { code, trainNo: code, date, originDate: date, from: from.name, to: to.name, fromCode: from.code, toCode: to.code,
    departure, arrival, duration: `${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`,
    saleStatus: "Y", trainsetModel: null, seats: [{ label: "二等座", value: "有", available: true, price: 50 }] };
}
function official(values: Train[], hubs: Station[] = []) {
  const mock = vi.fn(async (input: string | URL) => {
    const query = new URL(String(input), "https://cr.yukino.bond").searchParams;
    if (query.get("mode") === "hubs") return Response.json({ source: "12306", hubs });
    return Response.json({ source: "12306", checkedAt: new Date().toISOString(), trains: values.filter(t => t.fromCode === query.get("from") && t.toCode === query.get("to") && t.date === query.get("date")) });
  });
  vi.stubGlobal("fetch", mock); return mock;
}
const settings = { ...DEFAULT_TRANSFER, date, allowUrban: true, allowCity: false, stationGroupEndpoints: false, hubLimit: 32 };

describe("urban access, egress and interchange discovery", () => {
  it("keeps an onward railway hub ahead of many closer minor metro-connected railway stops", async () => {
    const start = station("起点枢纽", "EF1", "甲城"), end = station("远端壬", "EF2", "乙城");
    const minor = Array.from({ length: 15 }, (_, i) => station(`街区节点${i}`, `F${i}`, "甲城"));
    const hub = station("甲城北", "EF3", "甲城");
    const stops = [at(start.name, 30, 120), ...[...minor, hub].map((s, i) => at(s.name, 30, 120.015 + i * .015))];
    vi.mocked(loadUrbanRail).mockResolvedValue(new UrbanRailPlanner(network(stops, [line("市域衔接", stops.map(s => s.id))])));
    official([train("G9601", hub, end, "10:00", "11:00")]);
    const result = await searchTransfers({ ...settings, from: start.name, to: end.name }, [start, end, ...minor, hub], new AbortController().signal, vi.fn());
    expect(result.urban?.coverage?.from.reachable).toBeGreaterThan(8);
    expect(result.trips.some(trip => trip.access?.to.code === hub.code && trip.legs[0].code === "G9601")).toBe(true);
  });
  it("finds a useful third origin gateway instead of stopping after the closest two", async () => {
    const start = station("端点甲", "EAA"), end = station("远端乙", "EAB");
    const gateways = [station("接驳一", "EA1"), station("接驳二", "EA2"), station("可乘枢纽", "EA3")];
    vi.mocked(loadUrbanRail).mockResolvedValue(new UrbanRailPlanner(network([at(start.name, 30, 120), ...gateways.map((s, i) => at(s.name, 30, 120.02 + i * .02))], [line("通达", [start.name, ...gateways.map(s => s.name)])])));
    official([train("G9101", gateways[2], end, "10:00", "11:00")]);
    const result = await searchTransfers({ ...settings, from: start.name, to: end.name }, [start, end, ...gateways], new AbortController().signal, vi.fn());
    expect(result.trips.some(trip => trip.legs[0]?.code === "G9101" && trip.access?.to.code === "EA3")).toBe(true);
    expect(result.urban?.coverage?.from).toMatchObject({ reachable: 3, selected: 3 });
  });

  it("uses incoming metro reachability for a terminal which has no outgoing service", async () => {
    const start = station("远端丙", "EB1"), hub = station("到达枢纽", "EB2"), end = station("终点丁", "EB3");
    vi.mocked(loadUrbanRail).mockResolvedValue(new UrbanRailPlanner(network([at(hub.name, 30, 120), at(end.name, 30, 120.03)], [line("单向", [hub.name, end.name], false)])));
    official([train("G9201", start, hub, "10:00", "11:00")]);
    const result = await searchTransfers({ ...settings, from: start.name, to: end.name }, [start, hub, end], new AbortController().signal, vi.fn());
    expect(result.trips[0].egress?.urban?.rides[0].stops).toEqual([hub.name, end.name]);
    expect(result.trips[0].egress?.minimum).toBeGreaterThan(0);
  });

  it("discovers a cross-city metro departure hub outside the selected national railway candidates, and publishes before exhausting the budget", async () => {
    const start = station("远程出发甲", "EC1"), arrival = station("轨道到站", "EC2"), departure = station("跨城换乘枢纽", "EC3"), end = station("远程目的乙", "EC4");
    const decoys = Array.from({ length: 70 }, (_, i) => station(`候选${i}`, `D${i}`, start.city));
    const railway = [start, arrival, departure, end, ...decoys];
    expect(candidateHubs(start, end, railway, [arrival], true).slice(0, 32).some(s => s.code === departure.code)).toBe(false);
    vi.mocked(loadUrbanRail).mockResolvedValue(new UrbanRailPlanner(network([at(arrival.name, 30, 120), at(departure.name, 30, 120.05)], [line("跨城", [arrival.name, departure.name])])));
    official([train("G9301", start, arrival, "10:00", "11:00"), train("G9302", departure, end, "13:00", "14:00")], [arrival]);
    const partial = vi.fn();
    const result = await searchTransfers({ ...settings, from: start.name, to: end.name }, railway, new AbortController().signal, vi.fn(), partial);
    const trip = result.trips.find(t => t.legs.map(l => l.code).join() === "G9301,G9302")!;
    expect(trip).toBeDefined(); expect(trip.connections[0].kind).toBe("urban");
    expect(result.hubs.some(s => s.code === departure.code)).toBe(false);
    expect(partial.mock.calls[0][0].queryCount).toBeLessThan(result.queryCount);
    expect(result.queryCount).toBeLessThanOrEqual(32 * 8);
  });

  it("keeps a railway arrival usable even when it is also an origin metro gateway on a different itinerary", async () => {
    const start = station("端点戊", "ED1"), arrival = station("中间甲", "ED2"), departure = station("中间乙", "ED3"), end = station("远端己", "ED4");
    vi.mocked(loadUrbanRail).mockResolvedValue(new UrbanRailPlanner(network([at(start.name, 30, 120), at(arrival.name, 30, 120.02), at(departure.name, 30, 120.04)], [line("环接", [start.name, arrival.name, departure.name])])));
    official([train("G9401", start, arrival, "08:00", "09:00"), train("G9402", departure, end, "11:00", "12:00")], [arrival]);
    const result = await searchTransfers({ ...settings, from: start.name, to: end.name, earliest: "08:00" }, [start, arrival, departure, end], new AbortController().signal, vi.fn());
    expect(result.trips.some(t => t.legs.map(l => l.code).join() === "G9401,G9402" && hasUrban(t))).toBe(true);
  });

  it("can use metro at both automatic interchanges in a three-train journey", async () => {
    const start = station("远端庚", "EE1"), a = station("到站甲", "EE2"), b = station("出站甲", "EE3"), c = station("到站乙", "EE4"), d = station("出站乙", "EE5"), end = station("远端辛", "EE6");
    vi.mocked(loadUrbanRail).mockResolvedValue(new UrbanRailPlanner(network([at(a.name, 30, 120), at(b.name, 30, 120.02), at(c.name, 31, 121), at(d.name, 31, 121.02)], [line("首接", [a.name, b.name]), line("尾接", [c.name, d.name])])));
    official([train("G9501", start, a, "08:00", "09:00"), train("G9502", b, c, "10:30", "11:30"), train("G9503", d, end, "13:00", "14:00")], [a, c]);
    const result = await searchTransfers({ ...settings, from: start.name, to: end.name, maxChanges: 2 }, [start, a, b, c, d, end], new AbortController().signal, vi.fn());
    expect(result.trips.some(trip => trip.legs.map(leg => leg.code).join() === "G9501,G9502,G9503" && trip.connections.every(link => link.kind === "urban"))).toBe(true);
  });
});
