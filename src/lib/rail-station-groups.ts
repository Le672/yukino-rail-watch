import type { Station } from "./rail-tickets";
export type TransferLink = { from: Station; to: Station; kind: "same" | "walk" | "city"; minimum: number; note: string };
// Infrastructure relationships, not timetable aliases. Keep both official telecodes in every query.
export const WALK_GROUPS = [
  { names: ["广州南", "番禺"], minutes: [25, 35], note: "广州南地下城际番禺站，按指引出闸换乘；进入高铁需预留安检、检票时间。" },
  { names: ["广州新塘", "新塘南"], minutes: [20, 30], note: "国铁新塘枢纽与城际新塘南衔接，按现场指引换乘并重新检票。" },
  { names: ["虎门", "虎门北"], minutes: [25, 35], note: "高铁虎门与穗深城际虎门北处于同一综合枢纽，仍需出闸及进站。" },
] as const;
const CITY_GROUPS = [["长沙南", "长沙"], ["株洲西", "株洲"], ["湘潭北", "湘潭"]] as const;
const GD_CITIES = new Set(["广州", "佛山", "肇庆", "东莞", "惠州", "深圳", "清远", "中山", "珠海", "江门"]);
const HN_CITIES = new Set(["长沙", "株洲", "湘潭"]);
const GD_HUBS = ["广州南", "番禺", "佛山西", "东莞西", "广州新塘", "新塘南", "虎门", "虎门北", "广州北", "广州白云", "广州东", "肇庆", "肇庆东", "鼎湖东", "深圳北", "常平"];
const HN_HUBS = ["长沙南", "长沙", "暮云", "株洲", "株洲西", "湘潭", "湘潭北", "株洲南", "长沙西", "大丰"];
const NATIONAL_HUBS = ["北京南", "北京西", "天津南", "石家庄", "济南西", "徐州东", "郑州东", "南京南", "合肥南", "杭州东", "上海虹桥", "武汉", "长沙南", "南昌西", "广州南", "深圳北", "西安北", "成都东", "重庆北", "昆明南", "贵阳北", "南宁东"];
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
  if (allowCity) for (const group of CITY_GROUPS.filter(g => g.some(n => n === station.name))) {
    for (const name of group) for (const member of stations.filter(s => s.name === name)) result.set(member.code, member);
  }
  return [...result.values()];
}
export function transferLink(from: Station, to: Station, minimum: number, allowCity = false, cityMinutes = 90): TransferLink | null {
  if (from.code === to.code) return { from, to, kind: "same", minimum, note: "同站换乘，预留换站台和检票时间；便捷通道是否开放以现场为准。" };
  const group = WALK_GROUPS.find(g => g.names.some(n => n === from.name) && g.names.some(n => n === to.name));
  if (group) return { from, to, kind: "walk", minimum: Math.max(minimum, group.minutes[group.names[0] === from.name ? 0 : 1]), note: group.note };
  if (allowCity && CITY_GROUPS.some(g => g.some(n => n === from.name) && g.some(n => n === to.name))) return {
    from, to, kind: "city", minimum: Math.max(minimum, cityMinutes), note: "站外换乘：需地铁、公交或打车，交通费用另计。预留时间为规划值，并非实时路况预测。",
  };
  return null;
}
export function candidateHubs(from: Station, to: Station, stations: Station[], official: Station[], allowCity: boolean) {
  const cities = [from.city || "", to.city || ""], names: string[] = [];
  if (cities.some(city => HN_CITIES.has(city))) names.push(...HN_HUBS);
  if (cities.some(city => GD_CITIES.has(city))) names.push(...GD_HUBS);
  const regional = names.flatMap(name => stations.filter(s => s.name === name));
  if (!regional.length && !official.length) names.push(...NATIONAL_HUBS);
  const fallback = regional.length || official.length ? [] : names.flatMap(name => stations.filter(s => s.name === name));
  const result = new Map<string, Station>();
  // Both regional networks are searched, including a cross-region intercity connection at either end.
  for (const hub of [...regional, ...official, ...fallback]) {
    for (const station of stationVariants(hub, stations)) result.set(station.code, station);
    if (allowCity) for (const group of CITY_GROUPS.filter(g => g.some(n => n === hub.name))) {
      for (const name of group) for (const station of stations.filter(s => s.name === name)) result.set(station.code, station);
    }
  }
  return [...result.values()].filter(s => s.code !== from.code && s.code !== to.code);
}
