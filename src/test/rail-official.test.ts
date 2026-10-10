import { afterEach, describe, expect, it, vi } from "vitest";
import { locateJourney } from "../lib/train-position";
import { officialDelayTargets, parseOfficialDelay, parseOfficialJourney } from "../lib/rail-official";

const date = "2026-10-03", train = "G6003";
const at = (clock: string, day = 3) => Date.parse(`2026-10-${String(day).padStart(2, "0")}T${clock}:00+08:00`);
const rows = [
  { station_no: "01", station_name: "长沙南", station_train_code: train, station_telecode: "CWQ", arrive_day_diff: "0", arrive_time: "----", start_time: "10:00" },
  { station_no: "02", station_name: "广州南", station_train_code: train, station_telecode: "IZQ", arrive_day_diff: "0", arrive_time: "12:02", start_time: "12:06" },
  { station_no: "03", station_name: "深圳北", station_train_code: train, station_telecode: "IOQ", arrive_day_diff: "0", arrive_time: "12:35", start_time: "----" },
];
const payload = { status: true, data: { data: rows } };
const stations = "@x|长沙南|CWQ|changshanan|x|0@x|广州南|IZQ|guangzhounan|x|1@x|深圳北|IOQ|shenzhenbei|x|2" +
  Array.from({ length: 101 }, (_, i) => `@x|车站${i}|A${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}|station|x|0`).join("");
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("official timetable and three-hour delay interpretation", () => {
  it("uses official station numbers, keeps the origin date, and identifies Guangzhou South at 10:01", () => {
    const journey = parseOfficialJourney({ ...payload, data: { data: [rows[2], rows[0], rows[1]] } }, train, date);
    expect(journey.source).toBe("12306");
    expect(journey.model).toBeNull();
    expect(journey.stops[locateJourney(journey, at("10:01")).nextIndex!].station).toBe("广州南");
  });
  it("handles an overnight station dwell and subsequent arrival on the next day", () => {
    const overnight = [
      { ...rows[0], start_time: "23:00" },
      { ...rows[1], arrive_time: "23:58", start_time: "00:03" },
      { ...rows[2], arrive_day_diff: "1", arrive_time: "00:30" },
    ];
    const journey = parseOfficialJourney({ status: true, data: { data: overnight } }, train, date);
    expect(journey.stops[1].departureAt).toBe(at("00:03", 4));
    expect(locateJourney(journey, at("00:01", 4)).phase).toBe("stopped");
    expect(locateJourney(journey, at("00:04", 4)).nextIndex).toBe(2);
    const delay = parseOfficialDelay({ status: true, data: "G6003次列车到达深圳北站的预计时间为00:40。" }, journey.stops[2], at("23:50"));
    expect(delay).toMatchObject({ code: "DELAY_PREDICTION", minutes: 10 });
  });
  it("rejects missing station order, mismatched service/date, unknown reports and prefix train matches", () => {
    expect(() => parseOfficialJourney({ status: true, data: { data: [rows[0], rows[2]] } }, train, date)).toThrow(/站序/);
    expect(() => parseOfficialJourney({ ...payload, source: "12306", train, date: "2026-10-04" }, train, date)).toThrow(/日期/);
    const stop = parseOfficialJourney(payload, train, date).stops[1];
    for (const data of ["当前无正晚点信息", "G60030次列车到达广州南站的预计时间为12:12。", "G6003次列车到达广州站的预计时间为12:12。", "G6003次列车到达广州南站的预计时间为20:12。"]) {
      expect(parseOfficialDelay({ status: true, data }, stop, at("10:01"))).toBeNull();
    }
    expect(officialDelayTargets(parseOfficialJourney(payload, train, date), at("20:00"))).toEqual([]);
  });
});

function officialFetch() {
  return vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("station_name.js")) return new Response(`var station_names='${stations}';`);
    if (url.hostname === "search.12306.cn") return Response.json({ status: true, data: [{ date: "20261003", station_train_code: train, from_station: "长沙南", to_station: "深圳北", train_no: "TEST6003" }] });
    if (url.pathname.endsWith("queryTrainInfo/query")) return Response.json(payload);
    if (url.hostname === "hzfw.12306.cn" && url.pathname.endsWith("trainTime/query")) return Response.json({ status: true, data: `${train}次列车到达${url.searchParams.get("station_name")}站的预计时间为12:12。` });
    throw new Error(`Unexpected request: ${url}`);
  });
}
describe("official data gateway", () => {
  it("loads and caches the official timetable without querying any third party or ticket inventory", async () => {
    vi.resetModules(); const fetchMock = officialFetch(); vi.stubGlobal("fetch", fetchMock);
    const { onRequestGet } = await import("../../functions/api/rail");
    const request = () => onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?mode=journey&train=${train}&date=${date}`) });
    const first = await request(), body = await first.json();
    expect(first.status).toBe(200);
    expect(body).toMatchObject({ source: "12306", train, date });
    expect(body.data.data[1].station_telecode).toBe("IZQ");
    expect(parseOfficialJourney(body, train, date).stops).toHaveLength(3);
    await request();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([url]) => new URL(String(url)).hostname.endsWith(".12306.cn"))).toBe(true);
    const query = new URL(String(fetchMock.mock.calls[2][0]));
    expect(query.searchParams.get("leftTicketDTO.train_date")).toBe(date);
    expect(query.searchParams.get("leftTicketDTO.train_no")).toBe("TEST6003");
  });
  it("queries at most two official stations in range, coalesces refreshes, and preserves the report timestamp", async () => {
    vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(at("10:01"));
    const fetchMock = officialFetch(); vi.stubGlobal("fetch", fetchMock);
    const { onRequestGet } = await import("../../functions/api/rail");
    const request = () => onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?mode=delays&train=${train}&date=${date}`) });
    const [a, b] = await Promise.all([request(), request()]);
    const first = await a.json(), second = await b.json();
    expect(first.source).toBe("12306"); expect(first.checkedAt).toBe(second.checkedAt);
    expect(first.rows.find((row: { station: string }) => row.station === "广州南")).toMatchObject({ code: "DELAY_PREDICTION", minutes: 10 });
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("trainTime/query"))).toHaveLength(2);
    vi.advanceTimersByTime(30000);
    expect((await (await request()).json()).checkedAt).toBe(first.checkedAt);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("trainTime/query"))).toHaveLength(2);
  });
  it("returns an official error without RailGo fallback when the timetable cannot be read", async () => {
    vi.resetModules(); const normal = officialFetch();
    const fetchMock = vi.fn(async (input: URL | string) => String(input).includes("queryTrainInfo/query") ? Response.json({ status: false }) : normal(input));
    vi.stubGlobal("fetch", fetchMock);
    const { onRequestGet } = await import("../../functions/api/rail");
    const response = await onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?mode=journey&train=${train}&date=${date}`) });
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect((await response.json()).error).toContain("12306");
    expect(fetchMock.mock.calls.every(([input]) => new URL(String(input)).hostname.endsWith(".12306.cn"))).toBe(true);
  });
});
