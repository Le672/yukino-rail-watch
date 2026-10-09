import type { Station } from "./rail-tickets";

// These distinct telecodes are returned by official 12306 mobile station boards
// and left-ticket responses but absent from station_name.js (checked 2026-10-09).
// Names with embedded spaces distinguish the intercity service in the official API.
// Never replace a mainline code with one of these codes in a ticket query.
const supplements = [
  { code: "KBA", officialName: "惠州  北", name: "惠州北（城际）", anchor: "HUA", pinyin: "huizhoubei" },
  { code: "FXA", officialName: "佛山  西", name: "佛山西（城际）", anchor: "FOQ", pinyin: "foshanxi" },
  { code: "ZQA", officialName: "肇  庆", name: "肇庆（城际）", anchor: "ZVQ", pinyin: "zhaoqing" },
] as const;

export function officialStationCatalog(stations: Station[]): Station[] {
  const result = new Map(stations.map(station => [station.code, station]));
  for (const { anchor, ...supplement } of supplements) {
    const mainline = result.get(anchor);
    if (!mainline) continue;
    const existing = result.get(supplement.code);
    result.set(supplement.code, { ...existing, ...supplement, city: mainline.city, cityCode: mainline.cityCode });
  }
  return [...result.values()];
}
export function stationNames(stations: Station[]): Map<string, string> {
  return new Map(stations.flatMap(station => [[station.name, station.code], ...(station.officialName ? [[station.officialName, station.code]] : [])] as [string, string][]));
}
