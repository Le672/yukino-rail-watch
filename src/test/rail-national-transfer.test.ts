import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateHubs, interchangeVariants, stationVariants, transferLink } from "../lib/rail-station-groups";
import { nationalHubRanking, sameOfficialCity } from "../lib/rail-national-network";
import { DEFAULT_TRANSFER, searchTransfers, tripFare } from "../lib/rail-transfer";
import type { Station, Train } from "../lib/rail-tickets";
const s = (name: string, code: string, city: string, cityCode: string): Station => ({ name, code, city, cityCode, pinyin: "" });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("nationwide station interchange", () => {
  it.each([
    ["北京南", "VNP", "北京西", "BXP", "北京", "0357"],
    ["上海虹桥", "AOH", "上海", "SHH", "上海", "0712"],
    ["武汉", "WHN", "武昌", "WCN", "武汉", "1314"],
    ["成都东", "ICW", "成都南", "CNW", "成都", "1707"],
    ["兰州西", "LAJ", "兰州", "LZJ", "兰州", "2102"],
    ["哈尔滨西", "VAB", "哈尔滨", "HBB", "哈尔滨", "0034"],
    ["乌鲁木齐", "WAR", "乌鲁木齐南", "WMR", "乌鲁木齐", "2403"],
    ["厦门北", "XKS", "厦门", "XMS", "厦门", "1010"],
  ])("keeps %s and %s as separate stations and requires ground transport", (name, code, paired, pairedCode, city, cityCode) => {
    const a = s(name, code, city, cityCode), b = s(paired, pairedCode, city, cityCode);
    expect(transferLink(a, b, 20, true, 110)).toMatchObject({ kind: "city", minimum: 110, from: { code }, to: { code: pairedCode } });
    expect(transferLink(a, b, 20, false)).toBeNull();
    expect(stationVariants(a, [a, b])).toEqual([a]);
    expect(interchangeVariants(a, [a, b], true)).toEqual([a, b]);
  });
  it("does not merge similarly named stations, different official cities or conflicting city codes", () => {
    const a = s("朝阳", "CYD", "朝阳", "0223"), b = s("朝阳镇", "CZL", "朝阳", "0115");
    expect(sameOfficialCity(a, b)).toBe(false);
    expect(transferLink(a, b, 20, true)).toBeNull();
    expect(transferLink(s("北京南", "VNP", "北京", "0357"), s("天津南", "TIP", "天津", "0359"), 20, true)).toBeNull();
    expect(transferLink({ name: "无城市甲", code: "AAA", pinyin: "" }, { name: "无城市乙", code: "BBB", pinyin: "" }, 20, true)).toBeNull();
  });
  it("does not apply a ninety-minute urban allowance to distant Beijing suburban stops", () => {
    expect(transferLink(s("北京南", "VNP", "北京", "0357"), s("黑山寺", "HVP", "北京", "0357"), 20, true, 90)).toMatchObject({ kind: "city", minimum: 180 });
    expect(transferLink(s("北京南", "VNP", "北京", "0357"), s("清河", "QIP", "北京", "0357"), 20, true, 90)).toMatchObject({ kind: "city", minimum: 90 });
  });
  it("retains stations from the northeast, northwest, Tibet, Hainan and arbitrary towns even when official recommendations exist", () => {
    const from = s("福州", "FZS", "福州", "1004"), to = s("成都东", "ICW", "成都", "1707");
    const everywhere = [s("哈尔滨西", "VAB", "哈尔滨", "0034"), s("乌鲁木齐", "WAR", "乌鲁木齐", "2403"), s("拉萨", "LSO", "拉萨", "2702"), s("海口东", "HMQ", "海口", "2501"), s("小镇", "ZZZ", "未列入干线的小镇", "9999")];
    const official = s("武汉", "WHN", "武汉", "1314"), all = [from, to, official, ...everywhere];
    const hubs = candidateHubs(from, to, all, [official], true);
    expect(new Set(hubs.map(h => h.code))).toEqual(new Set([official, ...everywhere].map(h => h.code)));
    expect(hubs[0]).toEqual(official);
  });
  it("ranks a northern east-west corridor without relying on Guangdong or Hunan", () => {
    const nodes = [s("北京南", "VNP", "北京", "0357"), s("石家庄", "SJP", "石家庄", "0307"), s("太原南", "TNV", "太原", "0407"), s("西安北", "EAY", "西安", "2001"), s("兰州西", "LAJ", "兰州", "2102"), s("青岛北", "QHK", "青岛", "0610"), s("成都东", "ICW", "成都", "1707")];
    const ranking = nationalHubRanking(nodes[5], nodes[4], nodes);
    expect(ranking.rank(nodes[2])).toBeLessThan(ranking.rank(nodes[6]));
  });
});

describe("nationwide actual-leg assembly", () => {
  it("stops an unavailable official service without claiming that no connections exist", async () => {
    const from = s("失败起点", "FAA", "甲城", "8001"), to = s("失败终点", "FBB", "乙城", "8002");
    const all = [from, to, ...Array.from({ length: 75 }, (_, i) => s(`失败节点${i}`, `F${String(i).padStart(2, "0")}`, `城市${i}`, `${i + 1000}`))];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => new URL(String(input), "https://cr.yukino.bond").searchParams.get("mode") === "hubs" ? Response.json({ source: "12306", hubs: [] }) : Response.json({ error: "官方暂不可用" }, { status: 502 })));
    const result = await searchTransfers({ ...DEFAULT_TRANSFER, date: "2026-10-09", from: from.name, to: to.name }, all, new AbortController().signal, vi.fn());
    expect(result.queryCount).toBeGreaterThanOrEqual(8);
    expect(result.queryCount).toBeLessThanOrEqual(10);
    expect(result.serviceUnavailable).toBe(true);
    expect(result.warnings.join(" ")).toContain("本次已停止继续请求");
    expect(result.warnings.join(" ")).toContain("暂无方案不代表没有可行中转");
  });
  it("automatically finds a northeast high-speed to suburban trip with a same-city station change", async () => {
    const date = "2026-10-07", origin = s("沈阳北", "SBT", "沈阳", "0205"), south = s("北京南", "VNP", "北京", "0357"), north = s("清河", "QIP", "北京", "0357"), destination = s("古北口", "GKP", "北京", "0357");
    const all = [origin, south, north, destination];
    const make = (code: string, a: Station, b: Station, departure: string, arrival: string, duration: string, price: number): Train => ({ code, trainNo: code, date, originDate: date, from: a.name, to: b.name, fromCode: a.code, toCode: b.code, departure, arrival, duration, saleStatus: "Y", trainsetModel: null, seats: [{ label: "二等座", value: "有", available: true, price }] });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = new URL(String(input), "https://cr.yukino.bond"), key = `${url.searchParams.get("from")}/${url.searchParams.get("to")}`;
      if (url.searchParams.get("mode") === "hubs") return Response.json({ source: "12306", hubs: [] });
      const trains = key === "SBT/VNP" ? [make("G980", origin, south, "07:00", "10:00", "03:00", 200)] : key === "QIP/GKP" ? [make("S503", north, destination, "11:40", "13:30", "01:50", 12)] : [];
      return Response.json({ source: "12306", trains, checkedAt: new Date().toISOString() });
    }));
    const result = await searchTransfers({ ...DEFAULT_TRANSFER, date, from: origin.name, to: destination.name }, all, new AbortController().signal, vi.fn());
    expect(result.trips).toHaveLength(1);
    expect(result.trips[0].connections[0]).toMatchObject({ kind: "city", minimum: 90, from: { code: "VNP" }, to: { code: "QIP" } });
    expect(result.trips[0].legs.map(l => l.code)).toEqual(["G980", "S503"]);
    expect(tripFare(result.trips[0], "任意席别")).toBe(212);
  });
  it("reports incomplete nationwide coverage and checks previously omitted candidates when the scope is expanded", async () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 180000);
    const from = s("起点", "AAA", "甲城", "8001"), to = s("终点", "BBB", "乙城", "8002");
    const extra = Array.from({ length: 75 }, (_, i) => s(`城市${String(i).padStart(2, "0")}`, `N${String(i).padStart(2, "0")}`, `城市${i}`, `${i + 1000}`));
    const all = [from, to, ...extra];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => new URL(String(input), "https://cr.yukino.bond").searchParams.get("mode") === "hubs" ? Response.json({ source: "12306", hubs: [] }) : Response.json({ source: "12306", trains: [], checkedAt: new Date().toISOString() })));
    const settings = { ...DEFAULT_TRANSFER, date: "2026-10-08", from: from.name, to: to.name };
    const limited = await searchTransfers(settings, all, new AbortController().signal, vi.fn());
    expect(limited.hubs).toHaveLength(64); expect(limited.candidateCount).toBe(75);
    expect(limited.warnings.join(" ")).toContain("64 / 75");
    const expanded = await searchTransfers({ ...settings, hubLimit: 128 }, all, new AbortController().signal, vi.fn());
    expect(expanded.hubs).toHaveLength(75);
    expect(expanded.warnings.some(w => w.includes("全国候选站"))).toBe(false);
  });
});
