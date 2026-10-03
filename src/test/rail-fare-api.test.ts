import { afterEach, describe, expect, it, vi } from "vitest";
const date = "2026-10-04";
const stationText = "@x|广州南|IZQ|guangzhounan|gzn|0|1502|广州|||@x|长沙南|CWQ|changshanan|csn|1|1407|长沙|||" +
  Array.from({ length: 105 }, (_, i) => `@x|车站${i}|Z${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}|station|s|2|||`).join("");
function row(encoded = "") {
  const f = Array<string>(56).fill("");
  Object.assign(f, { 2: "TRAIN101", 3: "G101", 6: "IZQ", 7: "CWQ", 8: "09:00", 9: "12:00", 10: "03:00", 11: "Y", 13: "20261004", 16: "01", 17: "05", 30: "有", 31: "2", 35: "OM", 39: encoded });
  return f.join("|");
}
function mock(encoded = "", additionalRows: string[] = []) {
  const fetchMock = vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    expect(url.hostname.endsWith(".12306.cn")).toBe(true);
    if (url.pathname.endsWith("station_name.js")) return new Response(`var station_names='${stationText}';`);
    if (url.pathname.endsWith("leftTicket/init")) return new Response("public page", { headers: { "Set-Cookie": "PUBLIC_SESSION=test; Path=/" } });
    if (url.pathname.endsWith("leftTicket/queryA")) return Response.json({ data: { result: [row(encoded), ...additionalRows], map: { IZQ: "广州南", CWQ: "长沙南", GBA: "广州白云", CSQ: "长沙" } } });
    if (url.pathname.endsWith("queryTicketPrice")) return Response.json({ status: true, data: { O: "¥320.5", M: "¥510.0", train_no: "TRAIN101" } });
    if (url.pathname.endsWith("zzzcx/query")) return Response.json({ status: true, data: { flag: true, middleStations: [{ station_name: "长沙", station_telecode: "CWQ" }, { station_name: "无效", station_telecode: "XXX" }] } });
    throw new Error(`Unexpected official request: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock); return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());
describe("official ticket price and transfer node gateway", () => {
  it("shares initialization across concurrent distinct ticket routes", async () => {
    vi.resetModules(); const fetchMock = mock();
    const { onRequestGet } = await import("../../functions/api/rail");
    const responses = await Promise.all([date, "2026-10-05"].map(day => onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?date=${day}&from=IZQ&to=CWQ&search=route`) })));
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("leftTicket/init"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("leftTicket/queryA"))).toHaveLength(2);
  });
  it("rejects same-city alternative station rows instead of treating different telecodes as the requested route", async () => {
    vi.resetModules();
    const wrong = row("O032050001M051000002").split("|");
    Object.assign(wrong, { 2: "OTHERTRAIN", 3: "T8312", 6: "GBA", 7: "CSQ" });
    mock("O032050001M051000002", [wrong.join("|")]);
    const { onRequestGet } = await import("../../functions/api/rail");
    const data = await (await onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?date=${date}&from=IZQ&to=CWQ&search=route`) })).json();
    expect(data.trains.map((train: { code: string }) => train.code)).toEqual(["G101"]);
    const fare = await onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?mode=fare&date=${date}&from=IZQ&to=CWQ&train=T8312`) });
    expect(fare.status).toBe(404);
  });
  it("reuses encoded prices without extra pricing requests and exposes only public train metadata", async () => {
    vi.resetModules(); const fetchMock = mock("O032050001M051000002");
    const { onRequestGet } = await import("../../functions/api/rail");
    const response = await onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?date=${date}&from=广州南&to=长沙南&search=route`) });
    const data = await response.json();
    expect(response.status).toBe(200); expect(data.trains[0]).toMatchObject({ date, fromCode: "IZQ", toCode: "CWQ", originDate: date, fareStatus: "available" });
    expect(data.trains[0].seats.find((s: { label: string }) => s.label === "二等座").price).toBe(320.5);
    const fare = await (await onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?mode=fare&date=${date}&from=IZQ&to=CWQ&train=G101`) })).json();
    expect(fare.source).toBe("12306"); expect(fare.prices["二等座"].price).toBe(320.5);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("queryTicketPrice"))).toHaveLength(0);
    expect(JSON.stringify(data)).not.toContain("secretStr");
  });
  it("uses verified exact train/station sequence parameters for official fallback prices and caches them", async () => {
    vi.resetModules(); const fetchMock = mock();
    const { onRequestGet } = await import("../../functions/api/rail");
    const request = () => onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?mode=fare&date=${date}&from=IZQ&to=CWQ&train=G101`) });
    const [a, b] = await Promise.all([request(), request()]);
    expect((await a.json()).prices["二等座"].price).toBe(320.5); expect(b.status).toBe(200);
    const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes("queryTicketPrice"));
    expect(calls).toHaveLength(1);
    const url = new URL(String(calls[0][0]));
    expect(Object.fromEntries(url.searchParams)).toEqual({ train_no: "TRAIN101", from_station_no: "01", to_station_no: "05", seat_types: "OM", train_date: date });
    const wrong = await onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?mode=fare&date=${date}&from=IZQ&to=CWQ&train=G10`) });
    expect(wrong.status).toBe(404);
  });
  it("resolves recommended city-like labels by their official station code and retains official city metadata", async () => {
    vi.resetModules(); mock(); const { onRequestGet } = await import("../../functions/api/rail");
    const response = await onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?mode=hubs&date=${date}&from=IZQ&to=CWQ`) });
    expect(response.status).toBe(200);
    expect((await response.json()).hubs).toEqual([{ name: "长沙南", code: "CWQ", pinyin: "changshanan", city: "长沙", cityCode: "1407" }]);
  });
});
