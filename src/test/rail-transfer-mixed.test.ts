import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TRANSFER, searchTransfers, tripFare, tripRailFare } from "../lib/rail-transfer";
import { officialStationCatalog } from "../lib/rail-official-stations";
import type { Station, Train } from "../lib/rail-tickets";

const date = "2026-10-10";
const station = (name: string, code: string, city: string): Station => ({ name, code, city, pinyin: "" });
const source = station("肇庆东", "FCQ", "肇庆"), south = station("广州南", "IZQ", "广州"), panyu = station("番禺", "PYA", "广州");
const xintang = station("广州新塘", "XWQ", "广州"), north = station("惠州北", "HUA", "惠州");
const points = officialStationCatalog([source, south, panyu, xintang, north]);
let now = Date.parse("2026-10-09T08:00:00+08:00");
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now += 60000); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const clock = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
function train(code: string, from: Station, to: Station, departure: string, arrival: string, day = date): Train {
  const duration = (clock(arrival) - clock(departure) + 1440) % 1440;
  return { code, trainNo: code, date: day, originDate: day, from: from.name, to: to.name, fromCode: from.code, toCode: to.code, departure, arrival,
    duration: `${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`, saleStatus: "Y", trainsetModel: "CRH6A",
    seats: [{ label: "二等座", value: "有", available: true, price: 50 }] };
}
function routes(values: Train[]) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input), "https://cr.yukino.bond"), q = url.searchParams;
    expect(url.pathname).toBe("/api/rail");
    return Response.json({ source: "12306", checkedAt: new Date().toISOString(), trains: values.filter(t => t.fromCode === q.get("from") && t.toCode === q.get("to") && t.date === q.get("date")) });
  });
  vi.stubGlobal("fetch", fetchMock); return fetchMock;
}
const settings = { ...DEFAULT_TRANSFER, date, from: source.name, to: north.name, via: south.name, via2: xintang.name, maxChanges: 2 as const, allowUrban: true, allowCity: false, stationGroupEndpoints: false };

describe("physical via stations and mixed middle journeys", () => {
  it("finds Guangzhou South → metro 7 → Yufengwei → metro 13 → Xintang without a middle railway train", async () => {
    routes([train("G8101", source, south, "08:00", "09:00"), train("G8102", xintang, north, "10:00", "11:00"), train("G8103", xintang, north, "13:00", "14:00")]);
    const result = await searchTransfers(settings, points, new AbortController().signal, vi.fn());
    expect(result.trips).toHaveLength(1);
    const trip = result.trips[0];
    expect(trip.legs.map(t => t.code)).toEqual(["G8101", "G8103"]);
    expect(trip.connections[0]).toMatchObject({ kind: "urban", from: { code: "IZQ" }, to: { code: "XWQ" } });
    expect(trip.connections[0].urban!.rides.map(ride => [ride.from, ride.to])).toEqual([["广州南站", "裕丰围"], ["裕丰围", "新塘"]]);
    expect(trip.connections[0].minimum).toBe(trip.connections[0].urban!.minutes + settings.minimum);
    expect(tripRailFare(trip, "二等座")).toBe(100); expect(tripFare(trip, "二等座")).toBeNull();
  });
  it("keeps metro optional and never creates it when the user switches it off", async () => {
    routes([train("G8201", source, south, "08:00", "09:00"), train("G8202", xintang, north, "13:00", "14:00")]);
    const result = await searchTransfers({ ...settings, allowUrban: false }, points, new AbortController().signal, vi.fn());
    expect(result.trips).toHaveLength(0); expect(result.urban).toBeUndefined();
  });
  it("keeps a Panyu → intercity Huizhou North alternative separate and counts directional walks at both ends", async () => {
    const intercity = points.find(s => s.code === "KBA")!;
    const fetchMock = routes([train("G8301", source, south, "08:00", "09:00"), train("C8302", panyu, intercity, "09:24", "11:54"), train("C8303", panyu, intercity, "09:25", "11:55")]);
    const result = await searchTransfers({ ...settings, allowUrban: false, stationGroupEndpoints: true }, points, new AbortController().signal, vi.fn());
    expect(result.trips).toHaveLength(0); expect(result.omittedVia).toBe(xintang.name);
    expect(result.alternatives).toHaveLength(1);
    const trip = result.alternatives![0];
    expect(trip.legs.map(t => [t.fromCode, t.toCode])).toEqual([["FCQ", "IZQ"], ["PYA", "KBA"]]);
    expect(trip.connections[0]).toMatchObject({ kind: "walk", minimum: 25 });
    expect(trip.egress).toMatchObject({ kind: "walk", minimum: 35, from: { code: "KBA" }, to: { code: "HUA" } });
    expect(trip.duration).toBe(270); expect(tripFare(trip, "二等座")).toBe(100);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("from=PYA&to=KBA"))).toBe(true);
  });
  it("rejects a Guangzhou North/Baiyun detour which skips mandatory Xintang even though all three stations share a city", async () => {
    const gb = station("广州北", "GBQ", "广州"), by = station("广州白云", "GBA", "广州");
    routes([train("G8401", source, south, "08:00", "09:00"), train("G8402", south, gb, "09:30", "10:00"), train("G8403", by, north, "12:00", "13:00")]);
    const result = await searchTransfers({ ...settings, allowUrban: false, allowCity: true }, [...points, gb, by], new AbortController().signal, vi.fn());
    expect(result.trips).toHaveLength(0);
    expect(result.alternatives).toHaveLength(0);
  });
  it("also joins two explicitly named Beijing railway stations by metro", async () => {
    const a = station("全国测试起点", "MAA", "甲城"), b = station("北京南", "VNP", "北京"), c = station("北京西", "BXP", "北京"), d = station("全国测试终点", "MBB", "乙城");
    routes([train("G8501", a, b, "08:00", "09:00"), train("G8502", c, d, "12:00", "13:00")]);
    const result = await searchTransfers({ ...settings, from: a.name, to: d.name, via: b.name, via2: c.name }, [a, b, c, d], new AbortController().signal, vi.fn());
    expect(result.trips).toHaveLength(1); expect(result.trips[0].connections[0]).toMatchObject({ kind: "urban", from: { code: "VNP" }, to: { code: "BXP" } });
  });
  it("queries the next calendar day after a metro bridge crossing midnight", async () => {
    const tomorrow = "2026-10-11";
    const fetchMock = routes([train("G8601", source, south, "22:00", "23:00"), train("G8602", xintang, north, "02:00", "03:00", tomorrow)]);
    const result = await searchTransfers(settings, points, new AbortController().signal, vi.fn());
    expect(result.trips).toHaveLength(1); expect(result.trips[0].legs[1].date).toBe(tomorrow);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("date=2026-10-11"))).toBe(true);
  });
});
