import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyBoardDetail } from "../lib/rail-board";
import { visibleStopDetail } from "../lib/rail-stop-info";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("per-stop board data boundaries", () => {
  it("retains planned platforms while hiding stale or custom-time realtime states", () => {
    const now = Date.parse("2026-10-05T23:50:00+08:00");
    const detail = { ...emptyBoardDetail("TRAIN/2026-10-05/K123", "D", now), platform: "6站台", wicket: "A6", status: "late" as const,
      minutes: 3, checkIn: "checking" as const, sourceAt: now };
    expect(visibleStopDetail(detail, now, true)).toMatchObject({ status: "late", checkIn: "checking" });
    for (const value of [visibleStopDetail(detail, now + 121000, true), visibleStopDetail(detail, now, false),
      visibleStopDetail({ ...detail, sourceAt: now - 121000 }, now, true)]) {
      expect(value).toMatchObject({ platform: "6站台", wicket: "A6", status: "unknown", checkIn: "unknown", minutes: null });
    }
  });
  it("binds stop details to official station dates and train aliases without downloading each station's entire board", async () => {
    vi.resetModules();
    const at = Date.parse("2026-10-05T23:50:00+08:00"); vi.spyOn(Date, "now").mockReturnValue(at);
    const names = "@x|长沙南|CWQ|changshanan|x|1@x|广州南|IZQ|guangzhounan|x|1@x|深圳北|IOQ|shenzhenbei|x|1" +
      Array.from({ length: 101 }, (_, i) => `@x|站${i}|A${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}|station|x|0`).join("");
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("station_name.js")) return new Response(`var station_names='${names}';`);
      if (url.hostname === "search.12306.cn") return Response.json({ status: true, data: [{ date: "20261005", station_train_code: "K123", from_station: "长沙南", to_station: "深圳北", train_no: "TEST001" }] });
      if (url.pathname.endsWith("queryTrainInfo/query")) return Response.json({ status: true, data: { data: [
        { station_no: "1", station_name: "长沙南", station_train_code: "K123", arrive_day_diff: "0", arrive_time: "23:30", start_time: "23:30" },
        { station_no: "2", station_name: "广州南", station_train_code: "K124", arrive_day_diff: "0", arrive_time: "23:58", start_time: "00:04" },
        { station_no: "3", station_name: "深圳北", station_train_code: "K124", arrive_day_diff: "1", arrive_time: "00:40", start_time: "00:40" },
      ] } });
      if (url.pathname.endsWith("queryTrainDiagram")) return Response.json({ status: true, data: { running_list: [{ date: "20261005", flag: "1" }] } });
      if (url.pathname.endsWith("getExit")) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("trainDate")).toBe("20261006"); expect(body.get("stationTrainCode")).toBe("K124");
        expect(["IZQ", "IOQ"]).toContain(body.get("stationCode"));
        return Response.json({ status: true, data: { platform: "6站台", wicket: "A6,B6" } });
      }
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { onRequestGet } = await import("../../functions/api/rail");
    const request = (stops: string) => onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?mode=journey-board&train=K123&date=2026-10-05&stops=${stops}&realtime=0&station=OTHER`) });
    const response = await request("1,2"); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ source: "12306", train: "K123", date: "2026-10-05", rows: [
      { index: 1, station: "广州南", stationDate: "2026-10-06", train: "K124", detail: { direction: "D", platform: "6站台", status: "unknown" } },
      { index: 2, station: "深圳北", stationDate: "2026-10-06", train: "K124", detail: { direction: "A", platform: "6站台", status: "unknown" } },
    ] });
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("queryTrainDiagram"))).toHaveLength(1);
    expect(fetchMock.mock.calls.every(([input]) => new URL(String(input)).hostname.endsWith(".12306.cn"))).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("queryTrainByStation"))).toBe(false);
    expect((await request("999")).status).toBe(400); expect((await request("1,1")).status).toBe(400);
    expect((await request("0,1,2,3,4,5,6")).status).toBe(400);
  });
});
