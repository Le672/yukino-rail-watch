import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { officialStationCatalog, stationNames } from "../lib/rail-official-stations";
import { findStation, stationVariants, transferLink } from "../lib/rail-station-groups";

beforeEach(() => { vi.resetModules(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-09T08:00:00+08:00")); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("official intercity telecodes missing from the web station file", () => {
  it("preserves distinct high-speed and intercity codes, city metadata, names and physical transfer buffers", () => {
    const points = officialStationCatalog([{ name: "惠州北", code: "HUA", city: "惠州", cityCode: "1512", pinyin: "huizhoubei" }]);
    const rail = points[0], intercity = findStation(points, "惠州北（城际）")!;
    expect(intercity).toMatchObject({ code: "KBA", officialName: "惠州  北", city: "惠州", cityCode: "1512" });
    expect(stationNames(points).get("惠州  北")).toBe("KBA");
    expect(stationNames(points).get("惠州北")).toBe("HUA");
    expect(stationVariants(rail, points).map(s => s.code)).toEqual(["HUA", "KBA"]);
    expect(transferLink(rail, intercity, 20)).toMatchObject({ kind: "walk", minimum: 25 });
    expect(transferLink(intercity, rail, 20)).toMatchObject({ kind: "walk", minimum: 35 });
    expect(officialStationCatalog(points)).toEqual(points);
  });
  it("accepts a Panyu/KBA ticket request and still rejects other city-station rows returned by the official API", async () => {
    const main = "@pya|番禺|PYA|panyu|py|0@hzb|惠州北|HUA|huizhoubei|hzb|1";
    const all = main + Array.from({ length: 105 }, (_, i) => `@x|站${i}|Z${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}|station|s|2`).join("");
    const row = Array<string>(56).fill("");
    Object.assign(row, { 2: "6t000C470503", 3: "C4705", 6: "PYA", 7: "KBA", 8: "14:52", 9: "17:42", 10: "02:50", 11: "Y", 13: "20261009", 26: "有", 35: "O", 39: "O006900001" });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = new URL(String(input)); expect(url.hostname).toBe("kyfw.12306.cn");
      if (url.pathname.endsWith("station_name.js")) return new Response(all);
      if (url.pathname.endsWith("leftTicket/init")) return new Response("var CLeftTicketUrl = 'leftTicket/queryG';", { headers: { "Set-Cookie": "TEST_SESSION=value; Path=/" } });
      expect(url.searchParams.get("leftTicketDTO.to_station")).toBe("KBA");
      const unrelated = row.slice(); unrelated[7] = "HUA";
      return Response.json({ data: { result: [row.join("|"), unrelated.join("|")], map: { KBA: "惠州  北" } } });
    }));
    const { onRequestPost } = await import("../../functions/api/rail");
    const res = await onRequestPost({ request: new Request("https://cr.yukino.bond/api/rail?date=2026-10-09&from=PYA&to=KBA&search=route", { method: "POST" }) });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.trains).toHaveLength(1); expect(payload.trains[0]).toMatchObject({ fromCode: "PYA", toCode: "KBA", to: "惠州北（城际）", code: "C4705" });
    expect(payload.trains[0].seats.find((s: { label: string }) => s.label === "无座")).toMatchObject({ available: true, price: 69 });
  });
});
