import { afterEach, describe, expect, it, vi } from "vitest";
import { matchRailGoModel } from "../lib/railgo";

const result = () => ({
  date: "2026-09-28", fromCode: "VNP", toCode: "AOH", checkedAt: "12306-check",
  trains: [{ code: "G547", departure: "06:18", trainsetModel: null as string | null }],
});
const row = {
  number: "G547", numberFull: ["G547"], fromStationTelecode: "VNP", toStationTelecode: "AOH",
  fromDepart: "06:18", rundays: ["20260928"], car: "CR400AF-BZ", carOwner: "北京动车段",
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("RailGo train model reference", () => {
  it("matches the travel date, station segment, train code and departure time", () => {
    const next = matchRailGoModel(result(), [{ ...row, number: "G548", numberFull: ["G547", "G548"] }], "model-check");
    expect(next.trains[0]).toMatchObject({ trainsetModel: "CR400AF-BZ", trainsetOwner: "北京动车段" });
    expect(next.checkedAt).toBe("12306-check");
    expect(next.modelCheckedAt).toBe("model-check");
  });

  it("keeps the model unknown for a different date, station, timetable or conflicting models", () => {
    for (const patch of [{ rundays: ["20260927"] }, { fromStationTelecode: "BJP" }, { fromDepart: "06:19" }]) {
      expect(matchRailGoModel(result(), [{ ...row, ...patch }], "now").trains[0].trainsetModel).toBeNull();
    }
    expect(matchRailGoModel(result(), [row, { ...row, car: "CR400BF" }], "now").trains[0].trainsetModel).toBeNull();
    expect(matchRailGoModel(result(), [row, { ...row, carOwner: "其他动车段" }], "now").trains[0]).toMatchObject({ trainsetModel: "CR400AF-BZ", trainsetOwner: null });
  });

  it("requests RailGo directly and caches a route instead of querying each train on every poll", async () => {
    vi.resetModules();
    const { enrichWithRailGo } = await import("../lib/railgo");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([row])));
    vi.stubGlobal("fetch", fetchMock);
    const first = await enrichWithRailGo(result());
    const second = await enrichWithRailGo(result());
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.hostname).toBe("data.railgo.zenglingkun.cn");
    expect(url.searchParams.get("date")).toBe("20260928");
    expect(url.searchParams.get("from")).toBe("VNP");
    expect(first.trains[0].trainsetModel).toBe("CR400AF-BZ");
    expect(second.modelCheckedAt).toBe(first.modelCheckedAt);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves 12306 results and backs off when the model service fails", async () => {
    vi.resetModules();
    const { enrichWithRailGo } = await import("../lib/railgo");
    const fetchMock = vi.fn().mockRejectedValue(new Error("unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const tickets = result();
    expect(await enrichWithRailGo(tickets)).toBe(tickets);
    expect(await enrichWithRailGo(tickets)).toBe(tickets);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
