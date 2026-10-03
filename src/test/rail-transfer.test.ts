import { afterEach, describe, expect, it, vi } from "vitest";
import { intercityFares, parseEncodedFares, parsePriceResponse } from "../lib/rail-fares";
import { DEFAULT_TRAIN_FILTERS, seatScore, sortTrains, trainPrice } from "../lib/rail-tickets";
import type { Train, Station } from "../lib/rail-tickets";
import { DEFAULT_TRANSFER, makeTrip, searchTransfers, sortTrips, timedLeg, tripFare, tripSeats } from "../lib/rail-transfer";
import { transferLink } from "../lib/rail-station-groups";
const date = "2026-10-04";
const station = (name: string, code: string, city = "广州"): Station => ({ name, code, city, pinyin: "", cityCode: "1502" });
const a = station("深圳北", "IOQ", "深圳"), b = station("广州南", "IZQ"), c = station("番禺", "PYA"), d = station("西平西", "XPH", "东莞"), e = station("东莞西", "WGQ", "东莞");
const stations = [a, b, c, d, e];
function train(code: string, from: Station, to: Station, departure: string, arrival: string, duration: string, price = 50, count = "有"): Train {
  return { code, trainNo: `N${code}`, from: from.name, to: to.name, fromCode: from.code, toCode: to.code, departure, arrival, duration, saleStatus: "Y", trainsetModel: "CRH6A", date, originDate: date,
    seats: [{ label: "二等座", value: count, available: count === "有" || Number(count) > 0, price }] };
}
const block = (code: string, price: number, flag = "0") => code + String(Math.round(price * 10)).padStart(5, "0") + flag + "001";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });
describe("official fares and journey ordering", () => {
  it("decodes official fare tenths and the standing-seat marker, rejecting malformed or zero prices", () => {
    expect(parseEncodedFares(block("9", 150) + block("O", 65.5) + block("1", 28, "3"))).toMatchObject({ "商务座": { price: 150 }, "二等座": { price: 65.5 }, "无座": { price: 28 } });
    for (const input of ["O0130", "not-a-fare", block("O", 0), 130]) expect(parseEncodedFares(input)).toEqual({});
    expect(parsePriceResponse({ A9: "¥150.0", O: "¥65.5", WZ: "¥28", A3: "--", train_no: "TEST", M: 35 })).toMatchObject({ "商务座": { price: 150 }, "二等座": { price: 65.5 }, "无座": { price: 28 } });
  });
  it("sorts prices with unknowns last and does not treat a partial minimum as an exact fare", () => {
    const cheap = train("C1", a, b, "10:00", "11:00", "01:00", 30), expensive = train("C2", a, b, "09:00", "10:00", "01:00", 90), unknown = { ...cheap, code: "C3", seats: [{ ...cheap.seats[0], price: undefined }] };
    expect(sortTrains([unknown, expensive, cheap], { ...DEFAULT_TRAIN_FILTERS, sort: "price" }).map(t => t.code)).toEqual(["C1", "C2", "C3"]);
    expect(trainPrice({ ...cheap, seats: [...cheap.seats, { label: "硬座", value: "有", available: true }] }, "任意席别")).toBeNull();
    expect(seatScore(unknown, "任意席别")).toBeGreaterThan(seatScore(train("C4", a, b, "09:00", "10:00", "01:00", 30, "12"), "任意席别"));
  });
  it("binds official O fares only to verified non-reserved C/S availability, never a normal standing ticket", () => {
    const seats = [{ label: "无座", value: "有", available: true }], price = { "二等座": { price: 31 } };
    expect(intercityFares(seats, price, "C4741", "O")["无座"].price).toBe(31);
    expect(intercityFares(seats, price, "S7901", "O")["无座"].price).toBe(31);
    expect(intercityFares(seats, price, "G1", "O")).not.toHaveProperty("无座");
    expect(intercityFares([...seats, { label: "二等座", value: "无", available: false }], price, "C1", "O")).not.toHaveProperty("无座");
  });
  it("sorts arrival by the actual travel day instead of the clock alone", () => {
    const overnight = train("K1", a, b, "23:00", "01:00", "02:00"), today = train("G1", a, b, "08:00", "10:00", "02:00");
    expect(sortTrains([overnight, today], { ...DEFAULT_TRAIN_FILTERS, sort: "arrival" })[0].code).toBe("G1");
  });
});
describe("physical stations and time-feasible connections", () => {
  it("keeps the two telecodes and applies directional walk buffers; never calls arbitrary city stations same-station", () => {
    expect(transferLink(b, c, 10)).toMatchObject({ kind: "walk", minimum: 25, from: { code: "IZQ" }, to: { code: "PYA" } });
    expect(transferLink(c, b, 10)?.minimum).toBe(35);
    expect(transferLink(b, station("广州东", "GGQ"), 20, true)).toBeNull();
    const south = station("长沙南", "CWQ", "长沙"), central = station("长沙", "CSQ", "长沙");
    expect(transferLink(south, central, 20)).toBeNull();
    expect(transferLink(south, central, 20, true, 90)).toMatchObject({ kind: "city", minimum: 90 });
  });
  it("uses boarding date plus duration across midnight and rejects mismatched arrival clocks", () => {
    const leg = timedLeg({ ...train("K1", a, b, "23:00", "01:00", "02:00"), originDate: "2026-10-03" }, date)!;
    expect(leg.date).toBe(date); expect(leg.originDate).toBe("2026-10-03");
    expect(new Date(leg.arrivalAt + 8 * 3600000).toISOString().slice(0, 16)).toBe("2026-10-05T01:00");
    expect(timedLeg({ ...leg, arrival: "02:00" }, date)).toBeNull();
  });
  it("rejects missed trains, insufficient walk time, repeated physical trains and route cycles", () => {
    const first = timedLeg(train("G1", a, b, "09:00", "10:00", "01:00"), date)!, link = transferLink(b, c, 20)!;
    const second = timedLeg(train("C2", c, d, "10:24", "11:00", "00:36"), date)!;
    expect(makeTrip([first, second], [link], DEFAULT_TRANSFER)).toBeNull();
    expect(makeTrip([first, { ...second, departureAt: second.departureAt - 3600000 }], [link], DEFAULT_TRANSFER)).toBeNull();
    const feasible = timedLeg(train("C2", c, d, "10:25", "11:00", "00:35"), date)!;
    expect(makeTrip([first, feasible], [link], { ...DEFAULT_TRANSFER, date })).not.toBeNull();
    expect(makeTrip([first, { ...feasible, trainNo: first.trainNo }], [link], { ...DEFAULT_TRANSFER, date })).toBeNull();
    expect(makeTrip([first, timedLeg(train("C3", c, a, "10:25", "11:00", "00:35"), date)!], [link], { ...DEFAULT_TRANSFER, date })).toBeNull();
  });
  it("orders by summed fares and the bottleneck ticket quantity, with exact model filters", () => {
    const first = timedLeg(train("G1", a, b, "09:00", "10:00", "01:00", 80, "10"), date)!;
    const second = timedLeg(train("C2", c, d, "10:25", "11:00", "00:35", 20, "3"), date)!;
    const trip = makeTrip([first, second], [transferLink(b, c, 20)!], { ...DEFAULT_TRANSFER, date })!;
    expect(tripFare(trip, "任意席别")).toBe(100); expect(tripSeats(trip, "任意席别")).toBe(3);
    const other = { ...trip, id: "other", legs: [first, { ...second, trainsetModel: "CR400AF", seats: [{ ...second.seats[0], price: 10, value: "1" }] }] };
    expect(sortTrips([trip, other], { ...DEFAULT_TRAIN_FILTERS, sort: "price" })[0].id).toBe("other");
    expect(sortTrips([other, trip], { ...DEFAULT_TRAIN_FILTERS, sort: "seats" })[0].id).toBe(trip.id);
    expect(sortTrips([trip, other], { ...DEFAULT_TRAIN_FILTERS, model: "CR400AF" })).toEqual([other]);
    expect(sortTrips([trip, other], { ...DEFAULT_TRAIN_FILTERS, model: "CR400AF" }, true)).toEqual([]);
  });
});
function mockRoutes(routes: (url: URL) => Train[]) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input), "https://cr.yukino.bond");
    expect(url.pathname).toBe("/api/rail");
    if (url.searchParams.get("mode") === "hubs") return Response.json({ source: "12306", hubs: [b] });
    return Response.json({ source: "12306", checkedAt: new Date().toISOString(), trains: routes(url).map(t => ({ ...t, date: url.searchParams.get("date")! })) });
  });
  vi.stubGlobal("fetch", fetchMock); return fetchMock;
}
describe("official multi-leg search", () => {
  it("finds Guangzhou South to Panyu without treating their station codes as interchangeable", async () => {
    const fetchMock = mockRoutes(url => {
      const key = `${url.searchParams.get("from")}/${url.searchParams.get("to")}`;
      return key === "IOQ/IZQ" ? [train("G1", a, b, "09:00", "10:00", "01:00", 80)] : key === "PYA/XPH" ? [train("C2", c, d, "10:25", "11:00", "00:35", 20)] : [];
    });
    const result = await searchTransfers({ ...DEFAULT_TRANSFER, date, from: a.name, to: d.name, via: b.name }, stations, new AbortController().signal, vi.fn());
    expect(result.trips).toHaveLength(1); expect(result.trips[0].connections[0].kind).toBe("walk");
    expect(result.trips[0].legs.map(l => [l.fromCode, l.toCode])).toEqual([["IOQ", "IZQ"], ["PYA", "XPH"]]);
    expect(tripFare(result.trips[0], "任意席别")).toBe(100);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("railgo"))).toBe(true);
  });
  it("queries the next boarding date and assembles three actual train legs", async () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 60000);
    const fetchMock = mockRoutes(url => {
      const key = `${url.searchParams.get("from")}/${url.searchParams.get("to")}/${url.searchParams.get("date")}`;
      if (key === "IOQ/IZQ/2026-10-04") return [train("G1", a, b, "22:00", "23:15", "01:15")];
      if (key === "PYA/WGQ/2026-10-05") return [train("C2", c, e, "00:00", "01:00", "01:00")];
      if (key === "WGQ/XPH/2026-10-05") return [train("C3", e, d, "01:20", "01:35", "00:15")];
      return [];
    });
    const result = await searchTransfers({ ...DEFAULT_TRANSFER, date, from: a.name, to: d.name, via: b.name, via2: e.name, maxChanges: 2 }, stations, new AbortController().signal, vi.fn());
    expect(result.trips).toHaveLength(1);
    expect(result.trips[0].legs.map(l => l.date)).toEqual([date, "2026-10-05", "2026-10-05"]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("date=2026-10-05"))).toBe(true);
  });
  it("retains partial-failure warnings instead of asserting there are no routes and honours cancellation", async () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 120000);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "12306 暂不可用" }, { status: 502 })));
    const result = await searchTransfers({ ...DEFAULT_TRANSFER, date, from: a.name, to: d.name, via: b.name }, stations, new AbortController().signal, vi.fn());
    expect(result.trips).toHaveLength(0); expect(result.warnings.join(" ")).toMatch(/不代表没有可行中转/);
    const controller = new AbortController(); controller.abort();
    await expect(searchTransfers({ ...DEFAULT_TRANSFER, date, from: a.name, to: d.name, via: b.name }, stations, controller.signal, vi.fn())).rejects.toThrow();
  });
});
