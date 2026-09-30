import { describe, expect, it } from "vitest";
import { applyMtrLivery, mtrLiveryModel, MTR_MODEL } from "../lib/mtr-vibrant";
import { matchRailGoModel } from "../lib/railgo";
import services from "../data/mtr-vibrant-services.json";

const context = { date: "2026-09-30", fromCode: "IOQ", toCode: "XJA" };
const train = (code: string, trainsetModel: string | null = "CRH380A", trainsetOwner: string | null = null) => ({ code, trainsetModel, trainsetOwner, departure: "14:23" });

describe("MTR Vibrant Express identification", () => {
  it("covers all 77 explicitly marked services in both MTR timetable editions", () => {
    const codes = services.groups.flatMap(group => group.trains);
    expect(codes).toHaveLength(77);
    expect(new Set(codes).size).toBe(77);
    for (const group of services.groups) for (const code of group.trains) for (const date of ["2026-09-30", "2026-10-11"]) {
      const corridor = Number(code.slice(1)) % 2 ? group.corridor : [...group.corridor].reverse();
      expect(mtrLiveryModel(train(code), { date, fromCode: corridor[0], toCode: corridor.at(-1) })).toBe(MTR_MODEL);
    }
  });

  it("keeps unmarked, historical, reversed and unrelated services unchanged", () => {
    for (const code of ["G6585", "G5679", "G5680", "G5865", "G5866", "G5603", "G2949", "G5833"]) {
      expect(mtrLiveryModel(train(code), context)).toBe("CRH380A");
    }
    for (const patch of [{date:"2026-06-30"}, {date:"bad"}, {fromCode:"XJA",toCode:"IOQ"}, {fromCode:"VNP"}, {fromCode:"IOQ",toCode:"IOQ"}]) {
      expect(mtrLiveryModel(train("G5621"), { ...context, ...patch })).toBe("CRH380A");
    }
    expect(mtrLiveryModel(train("G5821"), context)).toBe("CRH380A");
  });

  it("uses confirmed operator evidence beyond the snapshot and preserves explicit coupling", () => {
    for (const owner of ["港铁公司", "港鐵公司", "MTR", "MTR Corporation Limited", "石岗车厂"]) {
      expect(mtrLiveryModel(train("G9999", "CRH380A", owner), {date:"2026-06-30"})).toBe(MTR_MODEL);
    }
    expect(mtrLiveryModel(train("G5621", "CRH380A 重联", "港铁公司"), context)).toBe(MTR_MODEL + " 重联");
  });

  it("respects live replacement models, non-MTR owners and conflicting evidence", () => {
    expect(mtrLiveryModel(train("G5621", "CRH3C"), context)).toBe("CRH3C");
    expect(mtrLiveryModel(train("G5621", "CRH380A", "广州动车段"), context)).toBe("CRH380A");
    const result = {...context,trains:[train("G5621")]};
    const row = {number:"G5621",fromStationTelecode:"IOQ",toStationTelecode:"XJA",fromDepart:"14:23",rundays:["20260930"],car:"CRH380A",carOwner:"港铁公司"};
    expect(matchRailGoModel(result,[row],"now").trains[0].trainsetModel).toBe(MTR_MODEL);
    expect(matchRailGoModel(result,[row,{...row,car:"CRH3C"}],"now").trains[0].trainsetModel).toBe("CRH380A");
    expect(matchRailGoModel(result,[row,{...row,carOwner:"广州动车段"}],"now").trains[0].trainsetModel).toBe("CRH380A");
    expect(matchRailGoModel(result,[{...row,car:"",carOwner:"广州动车段"}],"now").trains[0].trainsetModel).toBe("CRH380A");
    expect(matchRailGoModel(result,[{...row,car:"",carOwner:""}],"now").trains[0].trainsetModel).toBe(MTR_MODEL);
  });

  it("fills only confirmed returned services and retains result metadata", () => {
    const result = {...context,checkedAt:"12306",trains:[train("G5621",null),train("G5603",null)]};
    expect(applyMtrLivery(result)).toMatchObject({checkedAt:"12306",trains:[{trainsetModel:MTR_MODEL},{trainsetModel:null}]});
    expect(applyMtrLivery({...context,trains:[train("G5603")]}).trains[0].trainsetModel).toBe("CRH380A");
  });
});
