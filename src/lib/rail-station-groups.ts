import type { Station } from "./rail-tickets";
import { cityStations, cityTransferReserve, nationalHubRanking, sameOfficialCity } from "./rail-national-network";
import type { UrbanRoute } from "./urban-rail-types";
export type TransferLink = { from: Station; to: Station; kind: "same" | "walk" | "city" | "urban"; minimum: number; note: string; urban?: UrbanRoute };
// Infrastructure relationships, not timetable aliases. Keep both official telecodes in every query.
export const WALK_GROUPS = [
  { names: ["广州南", "番禺"], minutes: [25, 35], note: "广州南地下城际番禺站，按指引出闸换乘；进入高铁需预留安检、检票时间。" },
  { names: ["广州新塘", "新塘南"], minutes: [20, 30], note: "国铁新塘枢纽与城际新塘南衔接，按现场指引换乘并重新检票。" },
  { names: ["虎门", "虎门北"], minutes: [25, 35], note: "高铁虎门与穗深城际虎门北处于同一综合枢纽，仍需出闸及进站。" },
  { names: ["广州北", "花都"], minutes: [20, 30], note: "广州北与城际花都站通过枢纽换乘通道衔接，按现场指引出闸、步行并重新检票。" },
  { names: ["肇庆东", "鼎湖东"], minutes: [20, 30], note: "高铁肇庆东与城际鼎湖东经综合体连廊衔接，需出闸、步行并重新进站。" },
  { names: ["惠州", "小金口"], minutes: [20, 30], note: "普铁惠州与城际小金口为相邻站群，需出站沿现场指引步行，返回国铁预留安检检票时间。" },
  { names: ["东莞东", "常平东"], minutes: [30, 40], note: "两站需站外沿道路步行并过路口，不能按同站通道换乘；预留步行、安检和检票时间。" },
] as const;
export function findStation(stations: Station[], input: string) {
  const value = input.trim();
  return stations.find(s => s.name === value || s.code === value) || (value === "新塘" ? stations.find(s => s.name === "广州新塘") : undefined);
}
export function stationVariants(station: Station, stations: Station[]) {
  const group = WALK_GROUPS.find(g => g.names.some(name => name === station.name));
  return group ? group.names.flatMap(name => stations.filter(s => s.name === name)) : [station];
}
export function interchangeVariants(station: Station, stations: Station[], allowCity: boolean) {
  const result = new Map(stationVariants(station, stations).map(s => [s.code, s]));
  if (allowCity) for (const member of cityStations(station, stations)) result.set(member.code, member);
  return [...result.values()];
}
export function transferLink(from: Station, to: Station, minimum: number, allowCity = false, cityMinutes = 90): TransferLink | null {
  if (from.code === to.code) return { from, to, kind: "same", minimum, note: "同站换乘，预留换站台和检票时间；便捷通道是否开放以现场为准。" };
  const group = WALK_GROUPS.find(g => g.names.some(n => n === from.name) && g.names.some(n => n === to.name));
  if (group) return { from, to, kind: "walk", minimum: Math.max(minimum, group.minutes[group.names[0] === from.name ? 0 : 1]), note: group.note };
  if (allowCity && sameOfficialCity(from, to)) {
    const reserve = cityTransferReserve(from, to, cityMinutes);
    return { from, to, kind: "city", minimum: Math.max(minimum, reserve.minutes), note: `${from.city}同城异站：需自行安排地铁、公交或打车，交通费用另计；官方同城标识不代表相邻或有换乘通道。${reserve.outlying ? "含未核实城区范围的车站，保守预留至少 180 分钟。" : ""}预留时间为规划值，地面交通路线与路况需另行确认。` };
  }
  return null;
}
export function candidateHubs(from: Station, to: Station, stations: Station[], official: Station[], allowCity: boolean) {
  const national = nationalHubRanking(from, to, stations), anchors = new Set(national.hubs.map(s => s.code));
  const direct = new Set(official.map(s => s.code));
  const recommended = new Set(official.flatMap(hub => interchangeVariants(hub, stations, allowCity)).map(s => s.code));
  const endpointCity = (s: Station) => sameOfficialCity(s, from) || sameOfficialCity(s, to);
  const priority = (s: Station) => (direct.has(s.code) ? 100000 : 0) + (recommended.has(s.code) ? 40000 : 0) +
    (endpointCity(s) ? 50000 : 0) + (anchors.has(s.code) ? 10000 : 0) - national.rank(s);
  // Every official station remains eligible nationwide. Corridors rank candidates; they never assert a service exists.
  return stations.filter(s => s.code !== from.code && s.code !== to.code).sort((a, b) => priority(b) - priority(a) || a.name.localeCompare(b.name, "zh-CN"));
}
