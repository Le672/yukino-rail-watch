import { afterEach, describe, expect, it, vi } from "vitest";
import { equipmentLabel, parseOfficialEquipment } from "../lib/rail-equipment";
import { mtrLiveryModel } from "../lib/mtr-vibrant";
import { parseOfficialTrainNames } from "../lib/rail-official";

const date = "2026-10-04", at = Date.parse("2026-10-03T23:00:00Z");
const envelope = (data: unknown) => ({ httpCode: 200, status: 0, content: { status: 0, data } });
const car = envelope({ trainStyle: "CR400AF-A", carCode: "CR400AF-A-2194", coachPicList: [{ pictureUrl: "unused.png" }] });
const duty = envelope({ bureauName: "广州局", deptName: "长沙客运段", carInfo: { trainStyle: "CR400AF" } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("official equipment priority and identity", () => {
  it("prefers the dated model and distinguishes passenger duty from vehicle ownership", () => {
    const equipment = parseOfficialEquipment(car, duty, date, at);
    expect(equipment).toMatchObject({ model: "CR400AF-A", number: "CR400AF-A-2194", source: "12306", scope: "dated", date,
      owner: null, operator: "广州局 · 长沙客运段", checkedAt: at });
    expect(equipment).not.toHaveProperty("coachPicList");
    expect(equipmentLabel({ trainsetModel: equipment.model, trainOperator: equipment.operator })).toBe("车型：CR400AF-A · 担当 广州局 · 长沙客运段");
  });
  it("marks undated records as references and rejects unsuccessful service envelopes", () => {
    expect(parseOfficialEquipment({ ...car, status: -1 }, duty, date, at)).toMatchObject({ model: "CR400AF", scope: "reference", number: null });
    expect(parseOfficialEquipment(null, { ...duty, content: { status: -1, data: duty.content.data } }, date, at).model).toBeNull();
    expect(parseOfficialEquipment(envelope({ trainStyle: "未知" }), null, date, at).model).toBeNull();
  });
  it("never calls RailGo to fill ownership when an official model exists; caches by origin date", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(String(input), "https://cr.yukino.bond");
      expect(url.pathname).toBe("/api/rail"); expect(url.searchParams.get("mode")).toBe("equipment");
      return Response.json({ ...parseOfficialEquipment(car, duty, url.searchParams.get("date")!, at), train: "G6003" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { loadTrainEquipment } = await import("../lib/rail-equipment");
    const [a, b] = await Promise.all([loadTrainEquipment("G6003", date), loadTrainEquipment("G6003", date)]);
    expect(a).toBe(b); expect(a.model).toBe("CR400AF-A"); expect(fetchMock).toHaveBeenCalledTimes(1);
    await loadTrainEquipment("G6003", "2026-10-05"); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not apply an official response to a different service/date, or send invalid inputs", async () => {
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ...parseOfficialEquipment(car, duty, "2026-10-05", at), train: "G6003" }));
    vi.stubGlobal("fetch", fetchMock);
    const { getOfficialEquipment } = await import("../lib/rail-equipment");
    expect(await getOfficialEquipment("G6003", date)).toBeNull();
    expect(await getOfficialEquipment("G6003", date)).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getOfficialEquipment("G6003/evil", date)).toBeNull();
    expect(await getOfficialEquipment("G6003", "2026-02-30")).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("uses third-party equipment only for a missing model and labels it as a reference", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input), "https://cr.yukino.bond");
      if (url.pathname === "/api/rail") return Response.json({ ...parseOfficialEquipment(null, envelope({ bureauName: "广州局" }), date, at), train: "C206" });
      expect(url.hostname).toBe("data.railgo.zenglingkun.cn");
      return Response.json({ numberFull: ["C206"], rundays: ["20261004"], car: "CR200J1-C", carOwner: "长沙车辆段", timetable: "ignored" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { loadTrainEquipment } = await import("../lib/rail-equipment");
    expect(await loadTrainEquipment("C206", date)).toMatchObject({ model: "CR200J1-C", source: "RailGo", scope: "reference", operator: "广州局", owner: "长沙车辆段" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("uses the origin date and keeps equipment metadata when merging a cross-day rail leg", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(String(input), "https://cr.yukino.bond");
      expect(url.searchParams.get("date")).toBe(date);
      return Response.json({ ...parseOfficialEquipment(car, duty, date, at), train: "G6003" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { enrichTrainDetails, mergeTrainDetails } = await import("../lib/rail-enrichment");
    const train = { code: "G6003", trainNo: "TEST6003", date: "2026-10-05", originDate: date, from: "广州南", to: "深圳北", fromCode: "IZQ", toCode: "IOQ", departure: "00:01", arrival: "00:40", duration: "00:39", saleStatus: "Y", seats: [{ label: "二等座", value: "有", available: true, price: 10 }], trainsetModel: null };
    const next = mergeTrainDetails(train, await enrichTrainDetails(train, train.date));
    expect(next).toMatchObject({ date: "2026-10-05", originDate: date, trainsetDate: date, trainsetModel: "CR400AF-A", trainsetSource: "12306", trainOperator: "广州局 · 长沙客运段" });
    expect(next.seats).toEqual(train.seats);
  });
  it("uses actual official train numbers before a published MTR timetable assumption", () => {
    const train = { code: "G6581", trainsetModel: "CRH380A" }, context = { date, fromCode: "IZQ", toCode: "XJA" };
    expect(mtrLiveryModel({ ...train, trainsetNumber: "CRH380A-0254" }, context)).toBe("CRH380A(港铁动感号)");
    expect(mtrLiveryModel({ ...train, trainsetNumber: "CRH380A-2808" }, context)).toBe("CRH380A");
  });
  it("deduplicates exact official service records without expanding prefixes or inventing codes", () => {
    const names = parseOfficialTrainNames({ status: true, data: [
      { station_train_code: "C206(深圳-岳阳)", train_no: "650000C20603" },
      { station_train_code: "C206(深圳-岳阳)", train_no: "650000C20603" },
      { station_train_code: "C2061(深圳-长沙)", train_no: "65000C206103" },
      { station_train_code: "1461(北京-上海)", train_no: "240000146100" },
      { station_train_code: "broken", train_no: "C206" },
    ] });
    expect(names.get("C206")).toEqual([{ from: "深圳", to: "岳阳", trainNo: "650000C20603" }]);
    expect(names.has("C20")).toBe(false); expect(names.has("1461")).toBe(true);
  });
});
