import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const date = "2026-10-04";
const stationText = "@sz|深圳|SZQ|shenzhen|sz|1|||@yy|岳阳|YYQ|yueyang|yy|2|||" + Array.from({ length: 110 }, (_, i) => `@${i}|站${i}|Z${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}|station|s|2|||`).join("");
const names = [{ station_train_code: "C206(深圳-岳阳)", train_no: "650000C20603" }, { station_train_code: "C206(深圳-岳阳)", train_no: "650000C20603" }];
function upstream(list = names, keyword: unknown = { status: true, data: [] }) {
  const fetchMock = vi.fn(async (input: string | URL, options?: RequestInit) => {
    const url = new URL(String(input)); expect(url.hostname.endsWith(".12306.cn")).toBe(true);
    if (url.pathname.endsWith("station_name.js")) return new Response(`var station_names='${stationText}';`);
    if (url.pathname.endsWith("train/search")) return Response.json(keyword);
    if (url.pathname.endsWith("getTrainName")) { expect(url.searchParams.get("date")).toBe(date); return Response.json({ status: true, data: list }); }
    if (url.pathname.endsWith("leftTicket/init")) return new Response("public", { headers: { "Set-Cookie": "PUBLIC_SESSION=test; Path=/" } });
    if (url.pathname.endsWith("leftTicket/queryA")) {
      const fields = Array<string>(56).fill(""); Object.assign(fields, { 2: "650000C20603", 3: "C206", 6: "SZQ", 7: "YYQ", 8: "21:00", 9: "09:00", 10: "12:00", 13: "20261004", 30: "有" });
      return Response.json({ data: { result: [fields.join("|")], map: {} } });
    }
    if (url.pathname.endsWith("getCarDetail")) {
      expect(Object.fromEntries(url.searchParams)).toEqual({ carCode: "", trainCode: "C206", runningDay: "20261004", reqType: "form" });
      return Response.json({ status: 0, httpCode: 200, content: { status: 0, data: { trainStyle: "CR200J1-C", carCode: "CR200J1-C-2001" } } });
    }
    if (url.pathname.endsWith("getDeptByTrainCode")) {
      expect(options?.method).toBe("POST"); expect(options?.body).toBe("");
      return Response.json({ status: 0, httpCode: 200, content: { status: 0, data: { bureauName: "广州局", deptName: "广州客运段", carInfo: { trainStyle: "CR200J1-C" } } } });
    }
    throw new Error(`Unexpected official request ${url.pathname}`);
  }); vi.stubGlobal("fetch", fetchMock); return fetchMock;
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-04T08:00:00+08:00")); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("official service list and model gateway", () => {
  it("finds a train omitted by keyword search using only the official date list", async () => {
    vi.resetModules(); const fetchMock = upstream();
    const { onRequestGet } = await import("../../functions/api/rail");
    const response = await onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?date=${date}&search=train&train=C206`) });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ source: "12306", from: "深圳", to: "岳阳", trains: [{ code: "C206", trainNo: "650000C20603", trainsetModel: null }] });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("getTrainName"))).toHaveLength(1);
  });
  it("returns 404 for prefix-only records and 400 for ambiguous exact services", async () => {
    for (const [list, status] of [
      [[{ station_train_code: "C2061(深圳-岳阳)", train_no: "65000C206103" }], 404],
      [[...names, { station_train_code: "C206(岳阳-深圳)", train_no: "650000C20604" }], 400],
    ] as const) {
      vi.resetModules(); upstream([...list]); const { onRequestGet } = await import("../../functions/api/rail");
      const response = await onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?date=${date}&search=train&train=C206`) });
      expect(response.status).toBe(status);
    }
  });
  it("coalesces official model requests, exposes metadata only, and does not fetch third-party ownership", async () => {
    vi.resetModules(); const fetchMock = upstream();
    const { onRequestGet } = await import("../../functions/api/rail");
    const request = () => onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?mode=equipment&date=${date}&train=C206`) });
    const [a, b] = await Promise.all([request(), request()]);
    expect(a.status).toBe(200); const payload = await a.json();
    expect(payload).toMatchObject({ train: "C206", date, source: "12306", model: "CR200J1-C", owner: null, operator: "广州局 · 广州客运段", scope: "dated" });
    expect(await b.json()).toEqual(payload);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("getCarDetail"))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("station_name.js"))).toBe(false);
    expect(payload).not.toHaveProperty("carInfo"); expect(payload).not.toHaveProperty("coachPicList");
  });
  it("rejects invalid model lookups before making any request", async () => {
    vi.resetModules(); const fetchMock = upstream(); const { onRequestGet } = await import("../../functions/api/rail");
    for (const query of ["train=C206&date=2026-02-30", `train=C206/evil&date=${date}`]) {
      expect((await onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?mode=equipment&${query}`) })).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("honors an official rate-limit response instead of issuing alternative queries", async () => {
    vi.resetModules(); const normal = upstream();
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => String(input).includes("train/search") ? new Response("busy", { status: 429 }) : normal(input)));
    const { onRequestGet } = await import("../../functions/api/rail");
    const response = await onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?mode=equipment&date=${date}&train=C206`) });
    expect(response.status).toBe(503); expect(normal.mock.calls.some(([url]) => String(url).includes("getTrainName"))).toBe(false);
  });
});
