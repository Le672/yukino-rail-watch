import { afterEach, describe, expect, it, vi } from "vitest";
import { inferHistoricalEquipment, modelFromUnit, parseHistoricalUnits, readEquipmentHistory } from "../lib/rail-equipment-history";
import type { EquipmentObservation } from "../lib/rail-equipment-history";
import { equipmentFields, equipmentLabel, equipmentTitle } from "../lib/rail-equipment";

const now = Date.parse("2026-10-18T10:00:00+08:00"), date = "2026-10-18", train = "G3762";
const observation = (day: string, model = "CRH380A"): EquipmentObservation => ({ train, date: day, model, source: "rail.re" });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("historical model inference", () => {
  it("decodes full known unit identities, including suffixes, MTR and coupling; refuses unknown generations", () => {
    expect(modelFromUnit("CR400AFS1103")).toBe("CR400AF-S");
    expect(modelFromUnit("CR400AF-BZ-2249")).toBe("CR400AF-BZ");
    expect(modelFromUnit("CRH380A0254")).toBe("CRH380A(港铁动感号)");
    expect(modelFromUnit("CR400AFS1103+CR400AFS1104")).toBe("CR400AF-S");
    expect(modelFromUnit("CR400AFS1103+CR400AF2249")).toBe("CR400AF-S+CR400AF");
    for (const unit of ["CR400AFZZ1103", "CRH380A", "G3762", "CR400AFS1103+unknown", "CR400AF999999"]) expect(modelFromUnit(unit)).toBeNull();
  });
  it("requires exact service identity, valid dates and unit numbers", () => {
    expect(parseHistoricalUnits([
      { train_no: "G3762/G3763", date: "2026-10-16 20:54", emu_no: "CRH380A2810" },
      { train_no: "G37620", date: "2026-10-16", emu_no: "CR400AFS1103" },
      { train_no: train, date: "2026-02-30", emu_no: "CR400AFS1103" },
    ], train)).toEqual([observation("2026-10-16")]);
  });
  it("uses the latest run after a fleet change rather than the older majority; counts days, not duplicate sets", () => {
    const result = inferHistoricalEquipment([observation("2026-10-16"), observation("2026-10-16"), ...[4,5,6,8].map(n => observation(`2026-10-0${n}`, "CR400AF-S"))], train, date, now);
    expect(result).toMatchObject({ model: "CRH380A", history: { lastSeen: "2026-10-16", samples: 1, changed: true, confidence: "limited" } });
  });
  it("rejects future, same-day, stale and other-service records, including when reviewing a past date", () => {
    expect(inferHistoricalEquipment([observation(date), observation("2026-10-19"), observation("2026-09-01"), { ...observation("2026-10-16"), train: "G3763" }], train, date, now)).toBeNull();
    expect(inferHistoricalEquipment([observation("2026-10-06"), observation("2026-10-08")], train, "2026-10-07", now)).toMatchObject({ history: { lastSeen: "2026-10-06" } });
  });
  it("does not hide conflicting models on the latest operating day by using an older assignment", () => {
    expect(inferHistoricalEquipment([observation("2026-10-16"), observation("2026-10-16", "CR400AF-S"), observation("2026-10-14")], train, date, now)).toBeNull();
    expect(inferHistoricalEquipment([observation("2026-10-16"), observation("2026-10-14")], train, date, now)?.history.confidence).toBe("recent");
  });
  it("keeps evidence and uncertainty visible through ticket/live/desktop shared formatting", () => {
    const inferred = inferHistoricalEquipment([observation("2026-10-16")], train, date, now)!;
    const fields = equipmentFields({ ...inferred, date, source: "rail.re", scope: "inferred", number: null, operator: null, owner: null, checkedAt: now });
    expect(equipmentLabel(fields)).toContain("历史推断车型：CRH380A · 最近记录 2026-10-16");
    expect(equipmentTitle(fields)).toContain("非 2026-10-18 已确认配车");
    expect(equipmentTitle(fields)).toContain("1 个开行日");
    expect(readEquipmentHistory(inferred.history, train, date, now)).toEqual(inferred.history);
    expect(readEquipmentHistory({ ...inferred.history, lastSeen: date }, train, date, now)).toBeNull();
  });
  it("uses gateway historical evidence before third-party current reference data, then upgrades to official data on refresh", async () => {
    vi.resetModules(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
    const inferred = inferHistoricalEquipment([observation("2026-10-16")], train, date, now)!;
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ...inferred, date, train, source: "rail.re", scope: "inferred", checkedAt: now }))
      .mockResolvedValueOnce(Response.json({ model: "CR400AF-S", date, train, source: "12306", scope: "dated", checkedAt: now + 11 * 60000 }));
    vi.stubGlobal("fetch", fetchMock);
    const { loadTrainEquipment } = await import("../lib/rail-equipment");
    expect(await loadTrainEquipment(train, date)).toMatchObject({ model: "CRH380A", scope: "inferred", history: inferred.history, number: null });
    vi.setSystemTime(now + 11 * 60000);
    expect(await loadTrainEquipment(train, date)).toMatchObject({ model: "CR400AF-S", source: "12306", scope: "dated" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
