import { afterEach, describe, expect, it, vi } from "vitest";
import { boardRows, boardStatusText, emptyBoardDetail, parseBoardExit, parseBoardOperating, parseBoardRealtime, parseStationBoard } from "../lib/rail-board";

const station = { name: "广州南", code: "IZQ", pinyin: "guangzhounan" }, date = "2026-10-05";
const at = (clock: string, day = 5) => Date.parse(`2026-10-${String(day).padStart(2, "0")}T${clock}:00+08:00`);
const row = { station_train_code: "G6003", train_no: "6003NO", start_train_date: "20261005", station_train_date: "20261005", station_telecode: "IZQ",
  start_station_name: "长沙南", start_station_telecode: "CWQ", end_station_name: "深圳北", end_station_telecode: "IOQ", arrive_time: "10:00", start_time: "10:04", arrive_day_diff: "0", start_day_diff: "0", platform_no: "6或B6#6或A6#", jiaolu_train_style: "CR400AF" };
const payload = { status: true, data: [row] };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("station board service-day and status boundaries", () => {
  it("preserves origin day and midnight dwell, excludes terminal departures and wrong station/date records", () => {
    const overnight = { ...row, station_train_code: "K123", train_no: "K123NO", start_train_date: "20261004", arrive_day_diff: "1", start_day_diff: "2", arrive_time: "23:58", start_time: "00:04" };
    const terminal = { ...row, station_train_code: "G6004", train_no: "6004NO", end_station_name: station.name, end_station_telecode: "IZQ", start_time: "10:00" };
    const board = parseStationBoard({ status: true, data: [overnight, terminal, { ...row, station_telecode: "IOQ" }, { ...row, station_train_date: "20261004" }] }, station, date);
    expect(board.rows).toHaveLength(2);
    expect(board.rows[0]).toMatchObject({ originDate: "2026-10-04", arrivalAt: at("23:58"), departureAt: at("00:04", 6), dwellMinutes: 6 });
    expect(board.rows[1].departure).toBeNull();
    expect(boardRows(board, "D", "", false, at("09:00"))).toHaveLength(1);
    expect(boardRows(board, "A", "", false, at("09:00"))).toHaveLength(2);
    expect(() => parseStationBoard({ status: true, data: [{ ...row, station_train_date: "20251031" }] }, station, date)).toThrow(/日期/);
  });
  it("keeps missing service and check-in statuses unknown, and never uses platform_no as a platform", () => {
    const board = parseStationBoard(payload, station, date), train = board.rows[0];
    expect(train).not.toHaveProperty("platform");
    expect(parseBoardExit({ status: true, data: { wicket: "A6,B6" } })).toEqual({ platform: null, wicket: "A6,B6" });
    expect(parseBoardExit({ status: true, data: { platform: "23站台", wicket: "A23,B23" } }).platform).toBe("23站台");
    const live = (status: number, delay: number | null = null, updateTime = at("09:58")) => ({ status: 0, content: { status: 0, data: [{ currentStationCode: "IZQ", stationTrainCode: "G6003", updateTime, departTime: at("10:04"), status, delay }] } });
    expect(parseBoardRealtime(live(2), board, train, "D", at("09:58"))).toMatchObject({ checkIn: "checking", status: "unknown" });
    expect(parseBoardRealtime(live(1, 0), board, train, "D", at("09:58"))).toMatchObject({ checkIn: "waiting", status: "unknown" });
    expect(parseBoardRealtime(live(3), board, train, "A", at("09:58"))).toBeNull();
    expect(parseBoardRealtime(live(8), board, train, "D", at("09:58"))).toMatchObject({ status: "cancelled" });
    expect(parseBoardRealtime(live(4, 0, at("09:50")), board, train, "D", at("09:58"))).toBeNull();
    expect(boardStatusText({ ...emptyBoardDetail(train.id, "D"), ...parseBoardRealtime(live(4, -3), board, train, "D", at("09:58")) })).toBe("早点 3 分钟");
    expect(boardStatusText(emptyBoardDetail(train.id, "D"))).toBe("未提供");
    expect(parseBoardOperating({ status: true, data: { running_list: [{ date: "20261005", flag: "0" }] } }, date)).toBe(false);
    expect(parseBoardOperating({ status: true, data: { running_list: [{ date: "20261006", flag: "0" }] } }, date)).toBeNull();
  });
  it("rejects ambiguous train identities and supports a verified delay across midnight", () => {
    const board = parseStationBoard({ status: true, data: [{ ...row, arrive_time: "23:55", start_time: "23:59" }] }, station, date), train = board.rows[0];
    const item = { currentStationCode: "IZQ", stationTrainCode: train.train, fullTrainCode: train.trainNo, updateTime: at("23:50"), departTime: at("00:03", 6), status: 6, delay: 4 };
    expect(parseBoardRealtime({ status: 0, data: [item] }, board, train, "D", at("23:50"))).toMatchObject({ status: "late", minutes: 4, predicted: true });
    expect(parseBoardRealtime({ status: 0, data: [item, item] }, board, train, "D", at("23:50"))).toBeNull();
    expect(parseBoardRealtime({ status: 0, data: [{ ...item, fullTrainCode: "OTHER" }] }, board, train, "D", at("23:50"))).toBeNull();
  });
});

describe("official station board gateway", () => {
  it("coalesces the station snapshot, uses compact station-day dates, and enriches only validated rows", async () => {
    vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(at("09:50"));
    const names = `@x|广州南|IZQ|guangzhounan|x|1` + Array.from({ length: 101 }, (_, i) => `@x|站${i}|A${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}|station|x|0`).join("");
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("station_name.js")) return new Response(`var station_names='${names}';`);
      if (url.pathname.endsWith("queryTrainByStation")) { expect(new URLSearchParams(String(init?.body)).get("train_start_date")).toBe("20261005"); return Response.json(payload); }
      if (url.pathname.endsWith("getExit")) return Response.json({ status: true, data: { platform: "6站台", wicket: "A6,B6" } });
      if (url.pathname.endsWith("queryTrainDiagram")) return Response.json({ status: true, data: { running_list: [{ date: "20261005", flag: "1" }] } });
      if (url.pathname.endsWith("getBigScreenByStationCodeAndTrainDate")) return Response.json({ status: 0, content: { status: -1, message: "接口调用失败" } });
      if (url.pathname.endsWith("trainTime/query")) return Response.json({ status: true, data: "G6003次列车出发广州南站的预计时间为10:07。" });
      throw new Error(`unexpected upstream ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { onRequestGet } = await import("../../functions/api/rail");
    const request = (extra = "") => onRequestGet({ request: new Request(`https://cr.yukino.bond/api/rail?station=IZQ&date=${date}&${extra || "mode=board"}`) });
    const [first, second] = await Promise.all([request(), request()]);
    const board = await first.json(); expect(await second.json()).toEqual(board);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("queryTrainByStation"))).toHaveLength(1);
    const params = new URLSearchParams({ mode: "board-row", id: board.rows[0].id, direction: "D" });
    const detail = await (await request(String(params))).json();
    expect(detail).toMatchObject({ platform: "6站台", wicket: "A6,B6", status: "late", minutes: 3, checkIn: "unknown", predicted: true });
    expect((await request("mode=board-row&direction=D&id=OTHER%2F2026-10-05%2FG9999")).status).toBe(404);
    expect(fetchMock.mock.calls.every(([url]) => new URL(String(url)).hostname.endsWith(".12306.cn"))).toBe(true);
  });
});
